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
import { UPLOAD_LIMITS, UPLOAD_TEXT_SUFFIXES } from "./messages.js";

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
  /** 仅文件节点：读出 File（DOM 为 file(success) 回调，这里包成 Promise）。 */
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
 * 深度优先递归收集全树文件：目录只展开不收录，文件经 file() 读出后
 * 依序推入 files（复用入少数组，遍历中途抛错时已收集部分仍在）。
 */
export async function collectFilesFromEntries(
  roots: readonly EntryLike[],
  getEntries: GetEntries,
  files: File[] = [],
): Promise<File[]> {
  const walk = async (nodes: readonly EntryLike[]): Promise<void> => {
    for (const node of nodes) {
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
 * 同步摘下 entry 引用：DataTransferItem 在事件处理让出事件循环后可能
 * 失效，webkitGetAsEntry 必须在 drop 监听器内同步调用完。
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
    if (entry) out.push(entry);
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
  const fallback = (): File[] => Array.from(dataTransfer.files ?? []);
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

/** 无后缀文件（含 .gitignore 式点开头隐藏文件）的类别占位：空串排序最前，展示层转 i18n 文案。 */
export const NO_SUFFIX = "";

export interface UploadFilterOutcome {
  /** 白名单内的文件（保持原顺序）。 */
  accepted: File[];
  /** 被忽略文件的后缀类别（小写、去重、排序；无后缀记为 NO_SUFFIX）。 */
  ignoredSuffixes: string[];
  /** 双上限超出时的本批量（纯 size 元数据，不读内容）；未超限为 null。 */
  limitError: { count: number; bytes: number } | null;
}

/** 文件名后缀小写化；点开头 / 以点结尾 / 无点一律视为无后缀。 */
function suffixOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return NO_SUFFIX;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * 上传文件闸门（issue #41 决议 A6/A7）：先按 UPLOAD_TEXT_SUFFIXES 白名单
 * 过滤（非白名单不报错，只记后缀类别供「已收录 N 个，忽略 M 个（.x .y）」
 * 计数摘要），再对白名单内文件做文件数/总字节双上限检查（File.size 元
 * 数据，不读内容）。超限 = 整批拒绝（limitError 非空），绝不静默截断。
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
