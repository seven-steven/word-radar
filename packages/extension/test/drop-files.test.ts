// @vitest-environment jsdom
/**
 * 拖放文件收集与上传闸门单测（issue #41 v1.1-T4，jsdom）。
 *
 * e2e 的合成 DataTransfer 无法产生 webkitGetAsEntry / 真实 FileSystemHandle
 * （浏览器限制），目录递归只能在 DOM 边界层测：注入 fake entry / handle 树
 * 覆盖嵌套目录 / 空目录 / readEntries 分批循环（>100 项的经典坑）/ 三级
 * 回退（handle → entry → files）；真实形状的 handle 树由 test/e2e/
 * opfs-collect.spec.ts 的 OPFS 探针补验。filterUploadFiles 为纯函数，直接
 * 测白名单过滤与双上限整批拒绝。
 */
import { describe, expect, it } from "vitest";
import {
  collectDroppedFiles,
  collectFilesFromEntries,
  collectFilesFromHandles,
  filterUploadFiles,
  MAX_TRAVERSE_FILES,
  NO_SUFFIX,
  readAllEntries,
  type EntryLike,
  type GetEntries,
  type HandleLike,
  type ReadEntriesCallback,
} from "../src/lib/drop-files.js";

/** 构造 fake File（jsdom 的 File/Blob 自带 size 元数据）。 */
function fakeFile(name: string, content: string): File {
  return new File([content], name, { type: "text/plain" });
}

/** fake 文件 entry：file() 直接回 Promise 形态（回调式 DOM 形态由 collectDroppedFiles 的专用用例覆盖）。 */
function fakeFileEntry(name: string, file: File): EntryLike {
  return { name, isFile: true, isDirectory: false, file: async () => file };
}

/**
 * fake 目录 entry：createReader 每次从头迭代（与 DOM 语义一致），readEntries
 * 每次返回至多 batch 项并记录调用次数——验证 readAllEntries 的循环收尾。
 */
function fakeDirEntry(
  name: string,
  children: EntryLike[],
  batch = 2,
  onReadCalls?: (calls: number) => void,
): EntryLike {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let cursor = 0;
      let calls = 0;
      return {
        readEntries(success: ReadEntriesCallback) {
          const slice = children.slice(cursor, cursor + batch);
          cursor += slice.length;
          calls += 1;
          onReadCalls?.(calls);
          success(slice);
        },
      };
    },
  };
}

/** fake DataTransfer：只需 items（webkitGetAsEntry / getAsFileSystemHandle）与 files 两个结构面。 */
function fakeDataTransfer(
  items: Array<{
    webkitGetAsEntry?: () => EntryLike | null;
    getAsFileSystemHandle?: () => Promise<HandleLike | null>;
  }>,
  files: File[] = [],
): DataTransfer {
  return { items, files } as unknown as DataTransfer;
}

/** fake 文件 handle：getFile 直回 Promise（真实 FileSystemFileHandle.getFile 同形）。 */
function fakeFileHandle(name: string, file: File): HandleLike {
  return { kind: "file", name, getFile: async () => file };
}

/** fake 目录 handle：values() 是 async generator（真实 FileSystemDirectoryHandle.values() 同形）。 */
function fakeDirHandle(name: string, children: HandleLike[]): HandleLike {
  return {
    kind: "directory",
    name,
    values: async function* () {
      yield* children;
    },
  };
}

describe("readAllEntries（readEntries 分批循环坑）", () => {
  it("单次 batch=100、共 250 项：循环调用直到空数组，收齐全量", async () => {
    const calls: number[] = [];
    const dir = fakeDirEntry(
      "big",
      Array.from({ length: 250 }, (_, i) =>
        fakeFileEntry(`f${i}.txt`, fakeFile(`f${i}.txt`, "w")),
      ),
      100,
      (n) => calls.push(n),
    );
    const entries = await readAllEntries(dir.createReader!);
    expect(entries).toHaveLength(250);
    // 250 项 batch=100 → 3 次有货调用 + 1 次空批收尾 = 4 次
    expect(calls.at(-1)).toBe(4);
  });

  it("恰好整批（200 项 batch=100）：第 3 次空批收尾，不漏不多", async () => {
    const dir = fakeDirEntry(
      "even",
      Array.from({ length: 200 }, (_, i) =>
        fakeFileEntry(`f${i}.txt`, fakeFile(`f${i}.txt`, "w")),
      ),
      100,
    );
    const entries = await readAllEntries(dir.createReader!);
    expect(entries).toHaveLength(200);
  });

  it("空目录：首次 readEntries 即返回空，直接收敛", async () => {
    const dir = fakeDirEntry("empty", []);
    await expect(readAllEntries(dir.createReader!)).resolves.toHaveLength(0);
  });
});

describe("collectFilesFromEntries（可注入 getEntries 的递归核心）", () => {
  it("嵌套目录 + 空目录 + 散文件：只收文件不收目录，深度优先顺序", async () => {
    const a1 = fakeFile("a1.txt", "alpha");
    const a2 = fakeFile("a2.md", "bravo");
    const c1 = fakeFile("c1.txt", "charlie");
    const loose = fakeFile("loose.txt", "delta");
    const tree: EntryLike[] = [
      fakeDirEntry("a", [fakeFileEntry("a1.txt", a1), fakeFileEntry("a2.md", a2)]),
      fakeDirEntry("b", [
        fakeDirEntry("c", [fakeFileEntry("c1.txt", c1)]),
        fakeDirEntry("empty", []),
      ]),
      fakeFileEntry("loose.txt", loose),
    ];
    // 注入恒等读取器：目录已在内存，仍走 readEntries 分批循环保持同一路径
    const getEntries: GetEntries = async (dir) =>
      dir.createReader ? readAllEntries(dir.createReader) : [];
    const files = await collectFilesFromEntries(tree, getEntries);
    expect(files).toEqual([a1, a2, c1, loose]);
  });

  it("目录遍历中途失败：错误向上冒泡（由 collectDroppedFiles 兜底）", async () => {
    const ok = fakeFile("ok.txt", "keep");
    const tree: EntryLike[] = [
      fakeFileEntry("ok.txt", ok),
      { name: "boom", isFile: false, isDirectory: true },
    ];
    await expect(
      collectFilesFromEntries(tree, async () => {
        throw new Error("permission denied");
      }),
    ).rejects.toThrow("permission denied");
  });

  it("遍历熔断：> MAX_TRAVERSE_FILES 个文件的 fake 树提前终止且不抛（返回恰为上限个）", async () => {
    const total = MAX_TRAVERSE_FILES + 500;
    const tree: EntryLike[] = [
      fakeDirEntry(
        "huge",
        Array.from({ length: total }, (_, i) =>
          fakeFileEntry(`f${i}.txt`, fakeFile(`f${i}.txt`, "w")),
        ),
        100,
      ),
    ];
    const getEntries: GetEntries = async (dir) =>
      dir.createReader ? readAllEntries(dir.createReader) : [];
    const files = await collectFilesFromEntries(tree, getEntries);
    expect(files).toHaveLength(MAX_TRAVERSE_FILES);
    expect(() => files).not.toThrow();
  });
});

describe("collectDroppedFiles（drop 事件入口）", () => {
  it("items 带 entry：走递归全树（e2e 无法覆盖的目录路径在此收口）", async () => {
    const inner = fakeFile("inner.txt", "deep");
    const dt = fakeDataTransfer(
      [{ webkitGetAsEntry: () => fakeDirEntry("dir", [fakeFileEntry("inner.txt", inner)]) }],
      [],
    );
    await expect(collectDroppedFiles(dt)).resolves.toEqual([inner]);
  });

  it("回调式 file(success, error) 的 DOM entry：snapshotEntries 包成 Promise 后可收集（真实拖放形态）", async () => {
    const real = fakeFile("cb.txt", "callback");
    // 模拟真实 DOM：file 是回调式方法（Promise 形态的类型声明是
    // snapshotEntries 边界适配后的形状；此前原样透传会让 await 得 undefined）
    const domEntry = {
      name: "cb.txt",
      isFile: true,
      isDirectory: false,
      file: (success: (f: File) => void, error?: (e: unknown) => void): void => {
        void error;
        setTimeout(() => success(real), 0); // 真实 DOM 总是异步回调
      },
    };
    const entry = domEntry as unknown as EntryLike;
    const dt = fakeDataTransfer([{ webkitGetAsEntry: () => entry }], []);
    await expect(collectDroppedFiles(dt)).resolves.toEqual([real]);
  });

  it("回调式 file 的 error 路径：reject 后由 collectDroppedFiles 兜底走 files 回退", async () => {
    const top = fakeFile("fallback.txt", "flat");
    const domEntry = {
      name: "boom.txt",
      isFile: true,
      isDirectory: false,
      file: (success: (f: File) => void, error?: (e: unknown) => void): void => {
        void success;
        setTimeout(() => error?.(new Error("read failed")), 0);
      },
    };
    const dt = fakeDataTransfer(
      [{ webkitGetAsEntry: () => domEntry as unknown as EntryLike }],
      [top],
    );
    await expect(collectDroppedFiles(dt)).resolves.toEqual([top]);
  });

  it("items 为空：回退 dataTransfer.files 顶层文件", async () => {
    const top = fakeFile("top.txt", "flat");
    const dt = fakeDataTransfer([], [top]);
    await expect(collectDroppedFiles(dt)).resolves.toEqual([top]);
  });

  it("webkitGetAsEntry 恒 null（合成事件）：回退 dataTransfer.files", async () => {
    const top = fakeFile("synthetic.txt", "flat");
    const dt = fakeDataTransfer(
      [{ webkitGetAsEntry: () => null }, { webkitGetAsEntry: () => null }],
      [top],
    );
    await expect(collectDroppedFiles(dt)).resolves.toEqual([top]);
  });

  it("items 带 getAsFileSystemHandle：handle 第一级优先，entry 路径不再跑", async () => {
    const fromHandle = fakeFile("from-handle.txt", "handle");
    const fromEntry = fakeFile("from-entry.txt", "entry");
    const dt = fakeDataTransfer(
      [
        {
          // 两路都给：handle 收集成功时结果只含 handle 侧文件（真实环境拖
          // 目录的正路；entry 曾在真实 Chromium 拖目录时收集为空）
          webkitGetAsEntry: () => fakeFileEntry("from-entry.txt", fromEntry),
          getAsFileSystemHandle: async () =>
            fakeDirHandle("dir", [fakeFileHandle("from-handle.txt", fromHandle)]),
        },
      ],
      [],
    );
    await expect(collectDroppedFiles(dt)).resolves.toEqual([fromHandle]);
  });

  it("getAsFileSystemHandle 全 null：回退 webkitGetAsEntry 路径（第二级）", async () => {
    const inner = fakeFile("entry-inner.txt", "entry");
    const dt = fakeDataTransfer(
      [
        {
          webkitGetAsEntry: () =>
            fakeDirEntry("dir", [fakeFileEntry("entry-inner.txt", inner)]),
          getAsFileSystemHandle: async () => null,
        },
      ],
      [],
    );
    await expect(collectDroppedFiles(dt)).resolves.toEqual([inner]);
  });

  it("getAsFileSystemHandle reject：单条目失败不放大，逐级回退到 files", async () => {
    const top = fakeFile("reject-fallback.txt", "flat");
    const dt = fakeDataTransfer(
      [
        {
          webkitGetAsEntry: () => null,
          getAsFileSystemHandle: () => Promise.reject(new Error("store gone")),
        },
      ],
      [top],
    );
    await expect(collectDroppedFiles(dt)).resolves.toEqual([top]);
  });

  it("handle 遍历中途 values() 抛错但已收集非空：提前返回 partial，不下钻第二级", async () => {
    const loose = fakeFile("loose.txt", "partial");
    const dt = fakeDataTransfer(
      [
        {
          // entry 路径给 null：若误下钻第二级只会收空 → 结果非空即证明
          // partial 来自第一级的提前返回，而非任何回退路径的产物
          webkitGetAsEntry: () => null,
          getAsFileSystemHandle: async () => fakeFileHandle("loose.txt", loose),
        },
        {
          getAsFileSystemHandle: async () => ({
            kind: "directory",
            name: "boom",
            values: async function* (): AsyncIterableIterator<HandleLike> {
              throw new Error("values rejected");
            },
          }),
        },
      ],
      [],
    );
    // 抛错被 collectDroppedFiles 兜底：已收集的散文件保住（catch 清空或
    // files.length>0 门写反 → 本例拿到 [] 而红）
    await expect(collectDroppedFiles(dt)).resolves.toEqual([loose]);
  });

  it("handle 首个 getFile 即抛错（收集为 0）：穿透 entry 级第二级回退", async () => {
    // 根 entry 须用回调式 file(success, error) 形态：snapshotEntries 会把根
    // 过 toAsyncEntry 包成回调 Promise，Promise 形态的 fakeFileEntry 作根会
    // 永不 settle（子节点不做适配，才可用 Promise 形态）
    const inner = fakeFile("entry-inner.txt", "entry");
    const domEntry = {
      name: "entry-inner.txt",
      isFile: true,
      isDirectory: false,
      file: (success: (f: File) => void, error?: (e: unknown) => void): void => {
        void error;
        setTimeout(() => success(inner), 0);
      },
    };
    const dt = fakeDataTransfer(
      [
        {
          webkitGetAsEntry: () => domEntry as unknown as EntryLike,
          getAsFileSystemHandle: async () => ({
            kind: "file",
            name: "boom.txt",
            getFile: async () => {
              throw new Error("getFile rejected");
            },
          }),
        },
      ],
      [],
    );
    // 0 收集 ≠ 部分成功：必须继续下钻 entry 级（穿透门写坏 → 本例拿到 [] 而红）
    await expect(collectDroppedFiles(dt)).resolves.toEqual([inner]);
  });
});

describe("collectFilesFromHandles（File System Access handle 递归核心）", () => {
  it("嵌套目录 + 空目录 + 散文件的混合树：深度优先只收文件，保序", async () => {
    const f1 = fakeFile("f1.txt", "one");
    const f2 = fakeFile("f2.md", "two");
    const f3 = fakeFile("f3.txt", "three");
    const loose = fakeFile("loose.txt", "four");
    const tree: HandleLike[] = [
      fakeFileHandle("f1.txt", f1),
      fakeDirHandle("d1", [
        fakeFileHandle("f2.md", f2),
        fakeDirHandle("d2", [
          fakeFileHandle("f3.txt", f3),
          fakeDirHandle("empty", []),
        ]),
      ]),
      fakeFileHandle("loose.txt", loose),
    ];
    const files = await collectFilesFromHandles(tree);
    expect(files).toEqual([f1, f2, f3, loose]);
  });

  it("空目录：返回空数组", async () => {
    await expect(
      collectFilesFromHandles([fakeDirHandle("empty", [])]),
    ).resolves.toHaveLength(0);
  });

  it("遍历熔断：> MAX_TRAVERSE_FILES 个文件的 fake 树提前终止且不抛（返回恰为上限个）", async () => {
    const total = MAX_TRAVERSE_FILES + 500;
    const files = await collectFilesFromHandles([
      fakeDirHandle(
        "huge",
        Array.from({ length: total }, (_, i) =>
          fakeFileHandle(`f${i}.txt`, fakeFile(`f${i}.txt`, "w")),
        ),
      ),
    ]);
    expect(files).toHaveLength(MAX_TRAVERSE_FILES);
  });

  it("getFile 抛错：错误向上冒泡（由 collectDroppedFiles 兜底），已收集部分仍在入少数组", async () => {
    const ok = fakeFile("ok.txt", "keep");
    const files: File[] = [];
    const tree: HandleLike[] = [
      fakeFileHandle("ok.txt", ok),
      {
        kind: "file",
        name: "boom.txt",
        getFile: async () => {
          throw new Error("read failed");
        },
      },
    ];
    await expect(collectFilesFromHandles(tree, files)).rejects.toThrow(
      "read failed",
    );
    expect(files).toEqual([ok]);
  });

  it("values() 中途抛错：错误向上冒泡，此前收集的部分仍在入少数组", async () => {
    const ok = fakeFile("ok.txt", "keep");
    const files: File[] = [];
    const tree: HandleLike[] = [
      fakeFileHandle("ok.txt", ok),
      {
        kind: "directory",
        name: "boom",
        values: async function* () {
          yield fakeFileHandle("got.txt", fakeFile("got.txt", "partial"));
          throw new Error("values boom");
        },
      },
    ];
    await expect(collectFilesFromHandles(tree, files)).rejects.toThrow(
      "values boom",
    );
    // 物化子数组先于递归：迭代器中途抛错时该目录颗粒无收（与 entry 路径
    // readEntries 分批失败的语义对齐），但先行的散文件保住
    expect(files.map((file) => file.name)).toEqual(["ok.txt"]);
  });
});

describe("filterUploadFiles（白名单过滤 + 双上限整批拒绝）", () => {
  // 测试专用小上限（上限常量可调，量级断言不绑死 200 / 20MB）
  const limits = { maxFiles: 3, maxTotalBytes: 10 };

  it("白名单过滤：非白名单只记后缀类别（小写去重排序），无后缀记 NO_SUFFIX", () => {
    const outcome = filterUploadFiles(
      [
        fakeFile("a.txt", "1"),
        fakeFile("b.PNG", "22"),
        fakeFile("c.exe", "333"),
        fakeFile("README", "4"),
        fakeFile(".ds_store", "5"),
      ],
      limits,
    );
    expect(outcome.accepted.map((file) => file.name)).toEqual(["a.txt"]);
    expect(outcome.ignoredSuffixes).toEqual([NO_SUFFIX, "exe", "png"]);
    expect(outcome.limitError).toBeNull();
  });

  it("超文件数上限：整批拒绝（limitError 带实际 count/bytes），不截断", () => {
    const outcome = filterUploadFiles(
      [
        fakeFile("a.txt", "1"),
        fakeFile("b.txt", "22"),
        fakeFile("c.txt", "333"),
        fakeFile("d.txt", "4444"),
      ],
      limits,
    );
    expect(outcome.accepted).toHaveLength(4);
    expect(outcome.limitError).toEqual({ count: 4, bytes: 1 + 2 + 3 + 4 });
  });

  it("超总字节上限：整批拒绝", () => {
    const outcome = filterUploadFiles([fakeFile("a.txt", "12345678901")], limits);
    expect(outcome.limitError).toEqual({ count: 1, bytes: 11 });
  });

  it("恰好在限内：通过（count == maxFiles 且 bytes == maxTotalBytes）", () => {
    const outcome = filterUploadFiles(
      [fakeFile("a.txt", "1234"), fakeFile("b.txt", "123456")],
      limits,
    );
    expect(outcome.accepted).toHaveLength(2);
    expect(outcome.limitError).toBeNull();
  });

  it("忽略文件不计入上限（只有白名单内文件算量）", () => {
    const big = fakeFile("blob.bin", "x".repeat(100));
    const ok = fakeFile("ok.txt", "1");
    const outcome = filterUploadFiles([big, ok], limits);
    expect(outcome.accepted).toEqual([ok]);
    expect(outcome.limitError).toBeNull();
  });
});
