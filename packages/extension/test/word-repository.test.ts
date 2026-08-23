/**
 * WordRepository 单测：用 fake-indexeddb 验证合并语义、计数、跨连接持久化。
 *
 * 不测 idb 库本身，只验证我们的封装合约。
 * 每个用例前 deleteDatabase 清空全局 fake 工厂的状态，确保隔离。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DB_NAME,
  createWordRepository,
  type Counts,
  type WordRepository,
} from "../src/lib/word-repository.js";

/** 新建一个用全局 fake-indexeddb 工厂的 repository（生产代码也走这条路）。 */
function makeRepository(): WordRepository {
  return createWordRepository();
}

async function resetDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("WordRepository.mergeCollected", () => {
  it("空库首次合并后返回正确计数", async () => {
    const repo = makeRepository();

    const counts = await repo.mergeCollected([
      { lemma: "run", flags: 0 },
      { lemma: "serendipity", flags: 0 },
    ]);

    expect(counts).toEqual({ total: 2, pending: 2 });
  });

  it("同 lemma 多次采集不翻倍，flags 按位或", async () => {
    const repo = makeRepository();

    await repo.mergeCollected([
      { lemma: "run", flags: 0 },
      { lemma: "garden", flags: 0 },
    ]);
    // 第二次采集同一组词，外加一个新词
    const counts = await repo.mergeCollected([
      { lemma: "run", flags: 0 },
      { lemma: "serendipity", flags: 0 },
    ]);

    expect(counts).toEqual({ total: 3, pending: 3 });
    const all = await repo.getAll();
    expect(all.map((e) => e.lemma).sort()).toEqual(["garden", "run", "serendipity"]);
    // flags 保持 0（输入都是 0，按位或不变）
    for (const e of all) expect(e.flags).toBe(0);
  });

  it("入参含已推 flags 的词合并后保留已推状态", async () => {
    const repo = makeRepository();

    await repo.mergeCollected([{ lemma: "run", flags: 0 }]);
    // 第二次推送「run」时，从推送协作者侧回流的 flags=1（已推）
    const counts = await repo.mergeCollected([{ lemma: "run", flags: 1 }]);

    expect(counts).toEqual({ total: 1, pending: 0 });
    expect((await repo.getAll())[0]).toEqual({ lemma: "run", flags: 1 });
  });

  it("同一方法多次合并按位或逐步累积 flags", async () => {
    const repo = makeRepository();

    await repo.mergeCollected([{ lemma: "run", flags: 1 }]); // 已推
    await repo.mergeCollected([{ lemma: "run", flags: 0 }]); // 又采集一次，flags 按位或
    await repo.mergeCollected([{ lemma: "run", flags: 0 }]);

    const counts = await repo.getCounts();
    expect(counts).toEqual({ total: 1, pending: 0 });
    expect((await repo.getAll())[0]).toEqual({ lemma: "run", flags: 1 });
  });

  it("空 entries 视为无操作", async () => {
    const repo = makeRepository();

    await repo.mergeCollected([
      { lemma: "run", flags: 0 },
      { lemma: "garden", flags: 0 },
    ]);

    const counts = await repo.mergeCollected([]);
    expect(counts).toEqual({ total: 2, pending: 2 });
    const all = await repo.getAll();
    expect(all).toHaveLength(2);
  });
});

describe("WordRepository 持久化语义", () => {
  it("数据跨 repository 实例（重新 open 连接）保留", async () => {
    // 第一次：用 repo1 写
    const repo1 = makeRepository();
    await repo1.mergeCollected([
      { lemma: "run", flags: 0 },
      { lemma: "serendipity", flags: 1 },
    ]);

    // 第二次：全新 repository 实例（模拟 SW 被杀死后重启）
    const repo2 = makeRepository();
    const all = await repo2.getAll();
    expect(all.map((e) => e.lemma).sort()).toEqual(["run", "serendipity"]);
    const counts = await repo2.getCounts();
    expect(counts).toEqual({ total: 2, pending: 1 });
  });

  it("getCounts 与 getAll 读到的内容一致", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([
      { lemma: "a", flags: 0 },
      { lemma: "b", flags: 0 },
      { lemma: "c", flags: 1 },
    ]);
    const all = await repo.getAll();
    const counts: Counts = await repo.getCounts();
    expect(counts.total).toBe(all.length);
    const pendingFromAll = all.filter((e) => e.flags === 0).length;
    expect(counts.pending).toBe(pendingFromAll);
  });
});

describe("WordRepository.listPending", () => {
  it("仅返回 flags === 0 的词", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([
      { lemma: "pending1", flags: 0 },
      { lemma: "pushed1", flags: 1 },
      { lemma: "pending2", flags: 0 },
    ]);

    const pending = await repo.listPending();
    expect(pending.map((e) => e.lemma).sort()).toEqual(["pending1", "pending2"]);
  });

  it("空库返回空数组", async () => {
    const repo = makeRepository();
    expect(await repo.listPending()).toEqual([]);
  });
});

describe("WordRepository.markPushed", () => {
  it("对给定 lemma 把 flags 置 bit0（已推），返回新计数", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([
      { lemma: "a", flags: 0 },
      { lemma: "b", flags: 0 },
      { lemma: "c", flags: 0 },
    ]);

    const counts = await repo.markPushed(["a", "c"]);

    expect(counts).toEqual({ total: 3, pending: 1 });
    const all = await repo.getAll();
    const flagsByLemma = new Map<string, number>(all.map((e) => [e.lemma, e.flags]));
    expect(flagsByLemma.get("a")).toBe(1);
    expect(flagsByLemma.get("b")).toBe(0);
    expect(flagsByLemma.get("c")).toBe(1);
  });

  it("待推数随 markPushed 逐次下降", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([
      { lemma: "a", flags: 0 },
      { lemma: "b", flags: 0 },
      { lemma: "c", flags: 0 },
    ]);

    expect((await repo.getCounts()).pending).toBe(3);
    await repo.markPushed(["a"]);
    expect((await repo.getCounts()).pending).toBe(2);
    await repo.markPushed(["b"]);
    expect((await repo.getCounts()).pending).toBe(1);
    await repo.markPushed(["c"]);
    expect((await repo.getCounts()).pending).toBe(0);
  });

  it("lemma 大小写不敏感（统一小写）", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([{ lemma: "run", flags: 0 }]);

    await repo.markPushed(["RUN"]);

    const all = await repo.getAll();
    expect(all[0]).toEqual({ lemma: "run", flags: 1 });
  });

  it("对不存在的 lemma 是 no-op，不抛错", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([{ lemma: "a", flags: 0 }]);

    const counts = await repo.markPushed(["nonexistent"]);

    expect(counts).toEqual({ total: 1, pending: 1 });
    expect((await repo.getAll())[0]).toEqual({ lemma: "a", flags: 0 });
  });

  it("对已推词再调用 markPushed，flags 仍是已推（不丢位）", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([{ lemma: "run", flags: 1 }]);

    const counts = await repo.markPushed(["run"]);

    expect(counts).toEqual({ total: 1, pending: 0 });
    expect((await repo.getAll())[0]).toEqual({ lemma: "run", flags: 1 });
  });
});

describe("WordRepository.clear", () => {
  it("清空后 getCounts 归零", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([
      { lemma: "a", flags: 0 },
      { lemma: "b", flags: 1 },
    ]);

    await repo.clear();

    expect(await repo.getCounts()).toEqual({ total: 0, pending: 0 });
    expect(await repo.getAll()).toEqual([]);
    expect(await repo.listPending()).toEqual([]);
  });
});
describe("WordRepository.countNew（确认页新词 diff，issue #22）", () => {
  it("空库：全部是新词", async () => {
    const repo = makeRepository();

    await expect(
      repo.countNew([
        { lemma: "run", flags: 0 },
        { lemma: "garden", flags: 0 },
      ]),
    ).resolves.toBe(2);
  });

  it("全旧：词条都在词库 → 新词 0（含已推词，只看 lemma）", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([
      { lemma: "run", flags: 1 }, // 已推也算「非新词」：判断只看 lemma
      { lemma: "garden", flags: 0 },
    ]);

    await expect(
      repo.countNew([
        { lemma: "run", flags: 0 },
        { lemma: "garden", flags: 0 },
      ]),
    ).resolves.toBe(0);
  });

  it("全新：词条都不在词库 → 新词 = 词条数", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([{ lemma: "run", flags: 0 }]);

    await expect(
      repo.countNew([
        { lemma: "serendipity", flags: 0 },
        { lemma: "ephemeral", flags: 0 },
      ]),
    ).resolves.toBe(2);
  });

  it("混合：只数词库没有的 lemma", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([
      { lemma: "run", flags: 0 },
      { lemma: "garden", flags: 1 },
    ]);

    await expect(
      repo.countNew([
        { lemma: "run", flags: 0 }, // 旧
        { lemma: "serendipity", flags: 0 }, // 新
        { lemma: "garden", flags: 0 }, // 旧
        { lemma: "ephemeral", flags: 0 }, // 新
      ]),
    ).resolves.toBe(2);
  });

  it("lemma 大小写不敏感", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([{ lemma: "run", flags: 0 }]);

    await expect(repo.countNew([{ lemma: "RUN", flags: 0 }])).resolves.toBe(0);
  });

  it("空 entries 返回 0，不触库也可（结果一致）", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([{ lemma: "run", flags: 0 }]);

    await expect(repo.countNew([])).resolves.toBe(0);
  });
});

describe("WordRepository 确认合并入库（issue #22）", () => {
  it("确认合并 = mergeCollected：新词入库、旧词 flags 按位或不丢已推位", async () => {
    const repo = makeRepository();
    await repo.mergeCollected([{ lemma: "run", flags: 1 }]); // 既有已推词

    const counts = await repo.mergeCollected([
      { lemma: "run", flags: 0 }, // 旧词：保持已推（不洗回待推）
      { lemma: "serendipity", flags: 0 }, // 新词：进入待推池
    ]);

    expect(counts).toEqual({ total: 2, pending: 1 });
    const all = await repo.getAll();
    expect(all).toContainEqual({ lemma: "run", flags: 1 });
    expect(all).toContainEqual({ lemma: "serendipity", flags: 0 });
    // 合并后新词进入待推池，供确认后的推送一轮覆盖
    expect((await repo.listPending()).map((e) => e.lemma)).toEqual(["serendipity"]);
  });
});
