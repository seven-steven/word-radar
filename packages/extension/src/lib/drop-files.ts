/**
 * 拖放文件收集与上传闸门（issue #41 v1.1-T4）：从 drop 事件的 DataTransfer
 * 递归收集文件树（目录深度不限、只收文件），再按上传白名单过滤并做
 * 文件数/总字节双上限整批校验。
 *
 * DOM 依赖面：DataTransfer / DataTransferItem.webkitGetAsEntry / File.size
 * 元数据——不读任何文件内容（内容读取收在 csv-file.ts 的 readUploadFiles，
 * FileReader 一律不出 csv-file.ts）。
 *
 * 测试友好：目录递归核心只依赖可注入的 getEntries 读取器。真实实现
 * domGetEntries 走 createReader().readEntries 的分批循环——readEntries
 * 单次最多返回 100 项，必须循环调用直到返回空数组（经典坑）；jsdom 单测
 * 注入 fake entry 树即可覆盖嵌套 / 分批 / 回退各路径（e2e 的合成 DataTransfer
 * 无法产生 webkitGetAsEntry，目录递归只能在此层测）。
 */
import {
  NO_SUFFIX,
  suffixOf,
  UPLOAD_LIMITS,
  UPLOAD_TEXT_SUFFIXES,
} from "./messages.js";

// NO_SUFFIX 随 suffixOf 收在 messages.ts（popup 展示层与 SW 校验层共用），
// 这里 re-export 维持既有消费方（popup.ts / drop-files.test.ts）的 import 路径。
export { NO_SUFFIX };

/** readEntries 的回调形状（DOM 是回调式而非 Promise）。 */
export type ReadEntriesCallback = (entries: EntryLike[]) => void;

/**
 * 最小文件树节点：真实 DOM 的 FileSystemEntry 与测试 fake 的公共结构形状
 * （结构化类型，不引用 DOM 库类型，fake 树零 cast）。
 */
export interface EntryLike {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  /** 仅文件节点：读出 File（Promise 形态——DOM 的回调式 file(success, error)
   *  由 snapshotEntries 在边界处包成 Promise，collectFilesFromEntries 统一 await）。 */
  readonly file?: () => Promise<File>;
  /** 仅目录节点：建一个 readEntries 读取器（每次 createReader 从头迭代）。 */
  readonly createReader?: () => {
    readEntries(
      success: ReadEntriesCallback,
      error?: (err: unknown) => void,
    ): void;
  };
}

/** 列目录子项的可注入读取器：默认实现 domGetEntries 走分批循环。 */
export type GetEntries = (dir: EntryLike) => Promise<EntryLike[]>;

/**
 * 同一 reader 循环调用 readEntries 直到返回空数组，拼出全量子项
 * （单次最多 100 项；await 逐批取，不并发挤压同一 reader）。
 */
export async function readAllEntries(
  createReader: () => {
    readEntries(
      success: ReadEntriesCallback,
      error?: (err: unknown) => void,
    ): void;
  },
): Promise<EntryLike[]> {
  const reader = createReader();
  const all: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/** 默认读取器：真实 DOM 目录走 createReader().readEntries 分批循环。 */
export const domGetEntries: GetEntries = (dir) =>
  dir.createReader ? readAllEntries(dir.createReader) : Promise.resolve([]);

/**
 * 遍历熔断上限（code-review P1：大目录如 node_modules 全树无界串行遍历会让
 * popup 数十秒无反馈）。与 UPLOAD_LIMITS 双上限的关系：双上限只统计白名单
 * 过滤后的文件（filterUploadFiles），本上限统计遍历中的全部文件——熔断只防
 * 无界遍历，不改变最终判定语义：达上限即停止下钻并照常返回已收集部分，
 * 由 filterUploadFiles 对这批给出准确的白名单/双上限反馈。
 */
export const MAX_TRAVERSE_FILES = 2000;

/**
 * 深度优先递归收集全树文件：目录只展开不收录，文件经 file() 读出后
 * 依序推入 files（复用入少数组，遍历中途抛错时已收集部分仍在）；
 * files.length 达 MAX_TRAVERSE_FILES 即熔断，不再下钻（见上）。
 */
export async function collectFilesFromEntries(
  roots: readonly EntryLike[],
  getEntries: GetEntries,
  files: File[] = [],
): Promise<File[]> {
  const walk = async (nodes: readonly EntryLike[]): Promise<void> => {
    for (const node of nodes) {
      if (files.length >= MAX_TRAVERSE_FILES) return; // 熔断：达上限即停止下钻
      if (node.isFile && node.file) {
        files.push(await node.file());
      } else if (node.isDirectory) {
        await walk(await getEntries(node));
      }
    }
  };
  await walk(roots);
  return files;
}

/**
 * DOM entry → EntryLike 的边界适配（code-review P0：真实拖放死亡修复）。
 * 真实 DOM 的 FileSystemFileEntry.file 是回调式 file(success, error)，
 * 原样透传会让 `await node.file()` 得 undefined → 读 file.name 抛 TypeError
 * （jsdom fake 曾直接给 Promise 形态，类型声明掩盖了这一分歧）。这里对文件
 * 节点把回调包成 Promise，其余字段逐项透传（DOM entry 的 name/isFile 等是
 * 原型访问器，不能用展开语法复制）。
 */
function toAsyncEntry(entry: EntryLike): EntryLike {
  if (!entry.isFile) return entry; // 目录节点无回调适配需求，原样透传
  const domFile = (
    entry as unknown as {
      file?: (
        success: (file: File) => void,
        error?: (err: unknown) => void,
      ) => void;
    }
  ).file;
  return {
    name: entry.name,
    isFile: true,
    isDirectory: false,
    file:
      typeof domFile === "function"
        ? () =>
            new Promise<File>((resolve, reject) => {
              domFile.call(entry, resolve, reject);
            })
        : undefined,
  };
}

/**
 * 同步摘下 entry 引用：DataTransferItem 在事件处理让出事件循环后可能
 * 失效，webkitGetAsEntry 必须在 drop 监听器内同步调用完；摘下的 DOM
 * entry 就地做回调式 file() → Promise 适配（toAsyncEntry）。
 */
function snapshotEntries(dataTransfer: DataTransfer): EntryLike[] {
  const out: EntryLike[] = [];
  const items = dataTransfer.items;
  if (!items) return out;
  for (const item of Array.from(items)) {
    const getter = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => EntryLike | null;
      }
    ).webkitGetAsEntry;
    const entry = typeof getter === "function" ? getter.call(item) : null;
    if (entry) out.push(toAsyncEntry(entry));
  }
  return out;
}

/**
 * drop 事件入口：优先 items 的 webkitGetAsEntry 递归全树；entry 不可得
 * （合成事件 / 浏览器不支持）或遍历一无所获时回退 dataTransfer.files
 * 顶层文件；目录遍历中途失败则尽力返回已收集部分（不重复不放大）。
 */
export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<File[]> {
  // files 同步快照（code-review P1，snapshotEntries 同款先例）：fallback
  // 闭包若在首个 await 之后才读 dataTransfer.files，drag data store 已被
  // 释放、永远拿到空——必须在函数顶部同步摘下。
  const filesSnapshot = Array.from(dataTransfer.files ?? []);
  const fallback = (): File[] => filesSnapshot;
  const roots = snapshotEntries(dataTransfer);
  if (roots.length === 0) return fallback();
  const files: File[] = [];
  try {
    await collectFilesFromEntries(roots, domGetEntries, files);
  } catch {
    // 目录读取中途失败（权限等）：保留已收集部分，由下方空判走回退
  }
  return files.length > 0 ? files : fallback();
}

export interface UploadLimits {
  maxFiles: number;
  maxTotalBytes: number;
}

export interface UploadFilterOutcome {
  /** 白名单内的文件（保持原顺序）。 */
  accepted: File[];
  /** 被忽略文件的后缀类别（小写、去重、排序；无后缀记为 NO_SUFFIX）。 */
  ignoredSuffixes: string[];
  /** 双上限超出时的本批量（纯 size 元数据，不读内容）；未超限为 null。 */
  limitError: { count: number; bytes: number } | null;
}

/**
 * 上传文件闸门（issue #41 决议 A6/A7）：先按 UPLOAD_TEXT_SUFFIXES 白名单
 * 过滤（非白名单不报错，只记后缀类别供「已收录 N 个，忽略 M 个（.x .y）」
 * 计数摘要），再对白名单内文件做文件数/总字节双上限检查（File.size 元
 * 数据，不读内容）。超限 = 整批拒绝（limitError 非空），绝不静默截断。
 * 后缀判定用 messages.ts 的 suffixOf（与 SW 校验同源，点开头一律 NO_SUFFIX）。
 */
export function filterUploadFiles(
  files: readonly File[],
  limits: UploadLimits = UPLOAD_LIMITS,
): UploadFilterOutcome {
  const allow = new Set<string>(UPLOAD_TEXT_SUFFIXES);
  const accepted: File[] = [];
  const ignored = new Set<string>();
  for (const file of files) {
    const suffix = suffixOf(file.name);
    if (allow.has(suffix)) {
      accepted.push(file);
    } else {
      ignored.add(suffix);
    }
  }
  const totalBytes = accepted.reduce((sum, file) => sum + file.size, 0);
  const limitError =
    accepted.length > limits.maxFiles || totalBytes > limits.maxTotalBytes
      ? { count: accepted.length, bytes: totalBytes }
      : null;
  return { accepted, ignoredSuffixes: [...ignored].sort(), limitError };
}
