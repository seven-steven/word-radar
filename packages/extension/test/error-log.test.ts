/**
 * error-log 单测（issue #25）：环形淘汰、并发写入不丢已提交记录、
 * 容错（坏数据 / storage 故障）、可读文本导出。
 */
import { describe, expect, it, vi } from "vitest";
import {
  ERROR_LOG_CAP,
  ERROR_LOG_KEY,
  createErrorLogger,
  formatErrorLog,
  readErrorLog,
  type ErrorLogStorage,
} from "../src/lib/error-log.js";

/** 内存版 storage（chrome.storage.local 的最小面）。 */
function makeStorage(): ErrorLogStorage & {
  data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      return data.get(key);
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
  };
}

/** get 延迟 resolve 的 storage，用于暴露读-改-写竞态。 */
function makeSlowStorage(delayMs: number): ErrorLogStorage & {
  data: Map<string, unknown>;
} {
  const base = makeStorage();
  return {
    data: base.data,
    async get(key) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return base.get(key);
    },
    async set(items) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await base.set(items);
    },
  };
}

/** log() 是 fire-and-forget，这里等写队列排空（轮询 readErrorLog 到稳定）。 */
async function drain(storage: ErrorLogStorage, expected: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const records = await readErrorLog(storage);
    if (records.length === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`drain timeout: expected ${expected} records`);
}

describe("createErrorLogger（环形缓冲）", () => {
  it("追加一条：含 time/stage/word/summary，旧 → 新排序", async () => {
    const storage = makeStorage();
    const logger = createErrorLogger(storage, 200, () => 1_700_000_000_000);
    logger.log({ stage: "push", word: "run", summary: "网络错误" });
    await drain(storage, 1);
    const records = await readErrorLog(storage);
    expect(records).toEqual([
      { time: 1_700_000_000_000, stage: "push", word: "run", summary: "网络错误" },
    ]);
  });

  it("超出容量自动淘汰最旧记录（容量 3 写 5 条，保留最后 3 条）", async () => {
    const storage = makeStorage();
    const logger = createErrorLogger(storage, 3, () => 0);
    for (let i = 0; i < 5; i += 1) {
      logger.log({ stage: "push", summary: `错误 ${i}` });
    }
    await drain(storage, 3);
    const records = await readErrorLog(storage);
    expect(records.map((record) => record.summary)).toEqual(["错误 2", "错误 3", "错误 4"]);
  });

  it("默认容量为 ERROR_LOG_CAP（200）", () => {
    expect(ERROR_LOG_CAP).toBe(200);
  });

  it("并发写入不丢已提交记录（慢 storage 下 10 条并发全部落盘）", async () => {
    const storage = makeSlowStorage(10);
    const logger = createErrorLogger(storage, 200, () => 0);
    for (let i = 0; i < 10; i += 1) {
      logger.log({ stage: "push", word: `w${i}`, summary: `并发 ${i}` });
    }
    await drain(storage, 10);
    const records = await readErrorLog(storage);
    expect(records).toHaveLength(10);
    // 串行化保证提交顺序 = 调用顺序
    expect(records.map((record) => record.word)).toEqual(
      Array.from({ length: 10 }, (_, i) => `w${i}`),
    );
  });

  it("storage 故障静默吞掉：log 不抛错、不影响后续写入", async () => {
    const storage = makeStorage();
    const fail: ErrorLogStorage = {
      get: () => Promise.reject(new Error("boom")),
      set: () => Promise.reject(new Error("boom")),
    };
    const logger = createErrorLogger(fail, 200, () => 0);
    expect(() => logger.log({ stage: "push", summary: "x" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const healthy = createErrorLogger(storage, 200, () => 1);
    healthy.log({ stage: "push", summary: "y" });
    await drain(storage, 1);
    expect((await readErrorLog(storage)).map((r) => r.summary)).toEqual(["y"]);
  });

  it("读端容错：键缺失 / 非法形态记录被过滤", async () => {
    const storage = makeStorage();
    await storage.set({
      [ERROR_LOG_KEY]: [
        { time: 1, stage: "push", summary: "ok" },
        "garbage",
        { time: 2, summary: "缺 stage" },
      ],
    });
    const records = await readErrorLog(storage);
    expect(records).toEqual([{ time: 1, stage: "push", summary: "ok" }]);
  });
});

describe("formatErrorLog（可读文本导出）", () => {
  it("一行一条：[ISO 时间] 阶段 [词] 摘要；无词时省略 [] 段", () => {
    const text = formatErrorLog([
      { time: Date.UTC(2026, 0, 2, 3, 4, 5), stage: "push", word: "run", summary: "网络错误" },
      { time: Date.UTC(2026, 0, 2, 3, 4, 6), stage: "confirm", summary: "合并失败" },
    ]);
    const lines = text.split("\n");
    expect(lines).toEqual([
      "[2026-01-02T03:04:05.000Z] push [run] 网络错误",
      "[2026-01-02T03:04:06.000Z] confirm 合并失败",
    ]);
  });

  it("空日志导出为空字符串", () => {
    expect(formatErrorLog([])).toBe("");
  });
});
