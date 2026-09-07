/**
 * 拖放文件收集与上传闸门（issue #41 v1.1-T4）：从 drop 事件的 DataTransfer
 * 递归收集文件树（目录深度不限、只收文件），再按上传白名单过滤并做
 * 文件数/总字节双上限整批校验。
 *
 * DOM 依赖面：DataTransfer / DataTransferItem.getAsFileSystemHandle（File
 * System Access，Chromium 86+）→ DataTransferItem.webkitGetAsEntry →
 * dataTransfer.files 三级读取 / File.size 元数据——不读任何文件内容（内容
 * 读取收在 csv-file.ts 的 readUploadFiles，FileReader 一律不出 csv-file.ts）。
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
 * File System Access handle 的最小树节点（handle 形态递归核心，bug A/B 定稿
 * 方案）：真实 FileSystemFileHandle / FileSystemDirectoryHandle 与测试 fake
 * 的公共结构形状（结构化类型，不引用 DOM 库类型——getFile/values 声明为可选
 * 成员，真实 handle 与 HandleLike 天然结构同形、可直接传入，无需 toAsyncEntry
 * 式边界包装）。真实 FileSystemDirectoryHandle.values() 是 async generator，
 * 读法必须 for await...of。
 */
export interface HandleLike {
  readonly kind: "file" | "directory";
  readonly name: string;
  /** 仅文件节点：读出 File（真实 FileSystemFileHandle.getFile 即此形态）。 */
  readonly getFile?: () => Promise<File>;
  /** 仅目录节点：异步迭代子 handle（真实 FileSystemDirectoryHandle.values() 即此形态）。 */
  readonly values?: () => AsyncIterableIterator<HandleLike>;
}

/**
 * handle 形态的深度优先递归收集：语义与 collectFilesFromEntries 完全对齐——
 * 目录只展开不收录，文件经 getFile() 读出后依序推入 files（复用入少数组，
 * 遍历中途抛错时已收集部分仍在、错误向上冒泡由 collectDroppedFiles 兜底）；
 * files.length 达 MAX_TRAVERSE_FILES 即熔断，不再下钻（同款语义见上）。
 */
export async function collectFilesFromHandles(
  roots: readonly HandleLike[],
  files: File[] = [],
): Promise<File[]> {
  const walk = async (nodes: readonly HandleLike[]): Promise<void> => {
    for (const node of nodes) {
      if (files.length >= MAX_TRAVERSE_FILES) return; // 熔断：达上限即停止下钻
      if (node.kind === "file" && node.getFile) {
        files.push(await node.getFile());
      } else if (node.kind === "directory" && node.values) {
        // values() 是 async generator，for await...of 逐个摘下；先物化子数组
        // 再递归——迭代器中途抛错时整个目录颗粒无收、先行部分仍在 files，
        // 与 entry 路径 readEntries 分批循环的失败语义对齐
        const children: HandleLike[] = [];
        for await (const child of node.values()) children.push(child);
        await walk(children);
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
 * 同步摘下 handle promise（bug B 修复的第一级原料）：getAsFileSystemHandle
 * 是 async，但「调用本身」必须发生在 drop 监听器的同步执行段内——事件处理
 * 让出事件循环后 drag data store 释放/进入保护态，再调恒 null。popup.ts 的
 * drop 监听器同步起链（collectDroppedFiles 首个 await 之前的同步前缀恰在
 * 监听器同步段运行），所以这里只同步摘下 promise 数组，await 放后段。
 * 单条目失败（非函数 / promise reject / 返回 null）记 null，不放大为整批
 * 失败；真实返回值 FileSystemHandle 与 HandleLike 结构同形（kind/name 字面
 * 量匹配，getFile/values 在运行时原型链上），无需包装。
 */
function snapshotHandlePromises(
  dataTransfer: DataTransfer,
): Array<Promise<HandleLike | null>> {
  const out: Array<Promise<HandleLike | null>> = [];
  const items = dataTransfer.items;
  if (!items) return out;
  for (const item of Array.from(items)) {
    const getter = (
      item as DataTransferItem & {
        getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
      }
    ).getAsFileSystemHandle;
    if (typeof getter !== "function") {
      out.push(Promise.resolve(null)); // 旧引擎 / 合成环境无此 API：该条目记 null
      continue;
    }
    out.push(
      getter
        .call(item)
        .then((handle) =>
          handle && (handle.kind === "file" || handle.kind === "directory")
            ? handle
            : null,
        )
        .catch(() => null),
    );
  }
  return out;
}

/**
 * drop 事件入口（bug B 定稿方案：三级回退）——
 * 1. getAsFileSystemHandle（Chromium 86+，File System Access handle）：真实
 *    环境拖放目录的现役路径（webkitGetAsEntry 的 entry 递归在真实 Chromium
 *    拖目录时曾收集为空，根因未定位，迁移策略绕开）；
 * 2. webkitGetAsEntry entry 递归（原样保留的旧路径，e2e 合成事件 / 旧引擎）；
 * 3. dataTransfer.files 顶层文件快照。
 * 逐级回退条件：该级无原料（全 null / 不可得）、遍历抛错、收集为空。任何
 * 一级失败都不抛出到调用方（与既有 catch 语义一致，尽力返回已收集部分）。
 *
 * 时序约束（关键）：第一/二级的 API 读取都受「drag data store 存活窗口」
 * 约束——getAsFileSystemHandle 虽返回 Promise 但调用本身必须同步、
 * webkitGetAsEntry 是同步 API 也必须在监听器内调用。所以同步前缀（首个
 * await 之前）一次取齐三级原料：files 快照 + handle promise 数组 + entry
 * 快照，await 一律放后段。
 */
export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<File[]> {
  // ── 同步段：三级原料一次取齐（时序约束见上） ──
  const filesSnapshot = Array.from(dataTransfer.files ?? []);
  const fallback = (): File[] => filesSnapshot;
  const handlePromises = snapshotHandlePromises(dataTransfer);
  const entryRoots = snapshotEntries(dataTransfer);

  // ── await 段：第一级 handle（全 null / 抛错 / 收集为空 → 下一级）──
  const handles = (await Promise.all(handlePromises)).filter(
    (handle): handle is HandleLike => handle !== null,
  );
  if (handles.length > 0) {
    const files: File[] = [];
    try {
      await collectFilesFromHandles(handles, files);
    } catch {
      // handle 遍历中途失败（权限等）：保留已收集部分，空则走下一级
    }
    if (files.length > 0) return files;
  }

  // ── 第二级 entry 递归（原样保留的回退路径）──
  if (entryRoots.length > 0) {
    const files: File[] = [];
    try {
      await collectFilesFromEntries(entryRoots, domGetEntries, files);
    } catch {
      // 目录读取中途失败（权限等）：保留已收集部分，空则走下一级
    }
    if (files.length > 0) return files;
  }

  // ── 第三级 dataTransfer.files 顶层文件 ──
  return fallback();
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
