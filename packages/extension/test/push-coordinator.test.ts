/**
 * PushCoordinator 单测：覆盖编排顺序（已存在→标记、成功→标记、失败→保持 pending、
 * 未登录→暂停、并发守卫、4xx 不重试、网络错误重试 3 次、词间 400ms 节奏、可恢复续推）。
 *
 * 所有外部依赖（client / repository / 时钟）都通过构造注入，避免假睡眠与真实 IndexedDB。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BbdcAuthError, BbdcHttpError } from "../src/lib/bbdc-client.js";
import { PushCoordinator } from "../src/lib/push-coordinator.js";

interface FakeEntry {
  lemma: string;
  flags: number;
}

function makeEntry(lemma: string): FakeEntry {
  return { lemma, flags: 0 };
}

interface FakeClient {
  checkLogin: ReturnType<typeof vi.fn>;
  checkExisting: ReturnType<typeof vi.fn>;
  lookupDefinition: ReturnType<typeof vi.fn>;
  addWord: ReturnType<typeof vi.fn>;
}

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    checkLogin: vi.fn(async () => ({ loggedIn: true, resultCode: 200 })),
    checkExisting: vi.fn(async () => ({ exists: false })),
    lookupDefinition: vi.fn(async () => null),
    addWord: vi.fn(async () => undefined),
    ...overrides,
  };
}

interface FakeRepository {
  listPending: ReturnType<typeof vi.fn>;
  markPushed: ReturnType<typeof vi.fn>;
}

function makeRepository(entries: FakeEntry[] = []): FakeRepository {
  return {
    listPending: vi.fn(async () => entries.map((e) => ({ lemma: e.lemma, flags: e.flags }))),
    markPushed: vi.fn(async () => ({ total: 0, pending: 0 })),
  };
}

function makeSleep(): { sleep: ReturnType<typeof vi.fn>; calls: number[] } {
  const calls: number[] = [];
  const sleep = vi.fn(async (milliseconds: number) => {
    calls.push(milliseconds);
  });
  return { sleep, calls };
}

describe("PushCoordinator 基本编排", () => {
  it("启动一次：checkLogin → 逐词 checkExisting → lookupDefinition → addWord → markPushed", async () => {
    const client = makeClient();
    const repository = makeRepository([makeEntry("run"), makeEntry("garden")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    await coordinator.start();

    expect(client.checkLogin).toHaveBeenCalledTimes(1);
    expect(client.checkExisting).toHaveBeenCalledTimes(2);
    expect(client.checkExisting).toHaveBeenNthCalledWith(1, "run");
    expect(client.checkExisting).toHaveBeenNthCalledWith(2, "garden");
    expect(client.lookupDefinition).toHaveBeenCalledTimes(2);
    expect(client.addWord).toHaveBeenCalledTimes(2);
    expect(client.addWord).toHaveBeenNthCalledWith(1, "run", "");
    expect(client.addWord).toHaveBeenNthCalledWith(2, "garden", "");
    expect(repository.markPushed).toHaveBeenCalledTimes(2);
    expect(repository.markPushed).toHaveBeenNthCalledWith(1, ["run"]);
    expect(repository.markPushed).toHaveBeenNthCalledWith(2, ["garden"]);
  });

  it("lookupDefinition 返回释义时透传给 addWord 的 info 字段", async () => {
    const client = makeClient({
      lookupDefinition: vi.fn(async () => ({ interpret: "奔跑 / run 跑" })),
    });
    const repository = makeRepository([makeEntry("run")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    await coordinator.start();

    expect(client.addWord).toHaveBeenCalledWith("run", "奔跑 / run 跑");
  });

  it("pending 为空时不下发任何 HTTP，直接 completed", async () => {
    const client = makeClient();
    const repository = makeRepository([]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(client.checkLogin).toHaveBeenCalledTimes(1);
    expect(client.checkExisting).not.toHaveBeenCalled();
    expect(result.phase).toBe("completed");
    expect(result.total).toBe(0);
    expect(result.pending).toBe(0);
  });
});

describe("PushCoordinator 状态分类与计数", () => {
  it("远端已存在：计入 existing，仍标记已推，不下发 lookupDefinition/addWord", async () => {
    const client = makeClient({
      checkExisting: vi.fn(async () => ({ exists: true })),
    });
    const repository = makeRepository([makeEntry("run"), makeEntry("garden")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(client.lookupDefinition).not.toHaveBeenCalled();
    expect(client.addWord).not.toHaveBeenCalled();
    expect(repository.markPushed).toHaveBeenCalledTimes(2);
    expect(result.existing).toBe(2);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("成功推送：计入 succeeded，markPushed 触发", async () => {
    const client = makeClient();
    const repository = makeRepository([makeEntry("run")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(repository.markPushed).toHaveBeenCalledWith(["run"]);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("addWord 重试 3 次仍失败：该词计入 failed，循环继续到下一词；失败词保留在 pending 留给下次 run", async () => {
    // 让 addWord 对 "run" 始终抛网络错误；对 "garden" 正常。
    const client = makeClient({
      addWord: vi.fn(async (word: string) => {
        if (word === "run") throw new TypeError("network boom");
      }),
    });
    const entries = [makeEntry("run"), makeEntry("garden")];
    const repository = makeRepository(entries);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    // "run" 重试 3 次都失败 → 不 markPushed；"garden" 成功 → markPushed。
    expect(client.addWord).toHaveBeenCalledTimes(4); // run×3 + garden×1
    expect(repository.markPushed).toHaveBeenCalledTimes(1);
    expect(repository.markPushed).toHaveBeenCalledWith(["garden"]);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    // repository.listPending 每次 run 只被读一次（首屏快照），剩余的失败词下次再启动会再读。
    expect(repository.listPending).toHaveBeenCalledTimes(1);
  });
});

describe("PushCoordinator 暂停与续推", () => {
  it("checkLogin 抛 BbdcAuthError 立即暂停整循环，pending 保留", async () => {
    const client = makeClient({
      checkLogin: vi.fn(async () => {
        throw new BbdcAuthError("bbdc HTTP 401", { kind: "http", status: 401 });
      }),
    });
    const repository = makeRepository([makeEntry("run"), makeEntry("garden")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(result.phase).toBe("paused");
    expect(result.error).toContain("401");
    expect(client.checkExisting).not.toHaveBeenCalled();
    expect(client.addWord).not.toHaveBeenCalled();
    expect(repository.markPushed).not.toHaveBeenCalled();
  });

  it("中途 addWord 抛 BbdcAuthError 立即暂停循环，未处理词保留 pending", async () => {
    const client = makeClient({
      addWord: vi.fn(async () => {
        throw new BbdcAuthError("session expired", { kind: "check-login", resultCode: 401 });
      }),
    });
    const repository = makeRepository([makeEntry("run"), makeEntry("garden")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(result.phase).toBe("paused");
    expect(result.error).toContain("session expired");
    expect(repository.markPushed).not.toHaveBeenCalled();
  });

  it("暂停后再次 start：恢复推送，pending 中仍未推的词被继续处理", async () => {
    let loginOk = false;
    const client = makeClient({
      checkLogin: vi.fn(async () => {
        if (!loginOk) throw new BbdcAuthError("auth", { kind: "http", status: 401 });
        return { loggedIn: true, resultCode: 200 };
      }),
    });
    const repository = makeRepository([makeEntry("run"), makeEntry("garden")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const paused = await coordinator.start();
    expect(paused.phase).toBe("paused");

    // 模拟「重新登录」：repository 返回的 pending 不变
    loginOk = true;
    const resumed = await coordinator.start();

    expect(resumed.phase).toBe("completed");
    expect(repository.markPushed).toHaveBeenCalledTimes(2);
    expect(resumed.succeeded).toBe(2);
  });
});

describe("PushCoordinator 单例守卫", () => {
  it("start 并发调用只起一个 run；返回同一 promise", async () => {
    const client = makeClient();
    const repository = makeRepository([makeEntry("run")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const first = coordinator.start();
    const second = coordinator.start();

    expect(second).toBe(first);
    await first;

    expect(client.checkLogin).toHaveBeenCalledTimes(1);
    expect(client.checkExisting).toHaveBeenCalledTimes(1);
  });

  it("前一次完成后再次 start 才会开新循环", async () => {
    const client = makeClient();
    const repository = makeRepository([makeEntry("run")]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    await coordinator.start();
    expect(client.checkExisting).toHaveBeenCalledTimes(1);

    repository.listPending = vi.fn(async () => [makeEntry("garden")]);
    await coordinator.start();
    expect(client.checkExisting).toHaveBeenCalledTimes(2);
  });
});

describe("PushCoordinator 重试策略", () => {
  it("网络错误（TypeError）按 0/800/2000ms 重试 3 次，4xx 不重试", async () => {
    let networkCalls = 0;
    const client = makeClient({
      checkExisting: vi.fn(async () => {
        networkCalls += 1;
        if (networkCalls < 3) throw new TypeError("net down");
        return { exists: false };
      }),
    });
    const repository = makeRepository([makeEntry("run")]);
    const { sleep, calls } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    await coordinator.start();

    expect(networkCalls).toBe(3);
    // 第一次失败后 sleep 800ms，第二次失败后 sleep 2000ms，第三次成功后无 sleep
    expect(calls).toEqual([800, 2000]);
  });

  it("4xx（BbdcAuthError 或带 status 的错误）不重试，立即抛出", async () => {
    const authError = new BbdcAuthError("bbdc HTTP 403", { kind: "http", status: 403 });
    const client = makeClient({
      checkExisting: vi.fn(async () => {
        throw authError;
      }),
    });
    const repository = makeRepository([makeEntry("run"), makeEntry("garden")]);
    const { sleep, calls } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(client.checkExisting).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(0);
    expect(result.phase).toBe("paused");
  });

  it("网络错误重试 3 次仍失败，计入 failed 并继续下一词", async () => {
    const client = makeClient({
      addWord: vi.fn(async () => {
        throw new TypeError("net down");
      }),
    });
    const repository = makeRepository([makeEntry("run")]);
    const { sleep, calls } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(client.addWord).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([800, 2000]);
    expect(result.failed).toBe(1);
    expect(repository.markPushed).not.toHaveBeenCalled();
  });
});

describe("PushCoordinator 节奏", () => {
  it("词间间隔 400ms（注入 sleep 断言）；首尾词无需 sleep", async () => {
    const client = makeClient();
    const repository = makeRepository([
      makeEntry("a"),
      makeEntry("b"),
      makeEntry("c"),
    ]);
    const { sleep, calls } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    await coordinator.start();

    // 三词：两段 400ms 间隔
    expect(calls.filter((value) => value === 400)).toEqual([400, 400]);
  });
});

describe("PushCoordinator 进度回调", () => {
  it("onProgress 在 phase/idle/running/completed/paused 转换时各回调一次", async () => {
    const client = makeClient();
    const repository = makeRepository([makeEntry("run")]);
    const { sleep } = makeSleep();
    const phases: string[] = [];
    const coordinator = new PushCoordinator({
      client,
      repository,
      sleep,
      onProgress: (progress) => phases.push(progress.phase),
    });

    await coordinator.start();

    expect(phases[0]).toBe("running");
    expect(phases[phases.length - 1]).toBe("completed");
  });

  it("进度事件按词发射且分类正确：成功/已存在/失败逐词累加，pending 递减（issue #23）", async () => {
    const client = makeClient({
      checkExisting: vi.fn(async (word: string) => {
        if (word === "dup") return { exists: true };
        if (word === "boom") throw new BbdcHttpError("bbdc HTTP 404", 404);
        return { exists: false };
      }),
    });
    const repository = makeRepository([
      makeEntry("run"),   // 成功
      makeEntry("dup"),   // 远端已存在
      makeEntry("boom"),  // 4xx 不重试 → 失败
    ]);
    const { sleep } = makeSleep();
    const events: Array<{ processed: number; succeeded: number; existing: number; failed: number; pending: number; current?: string }> = [];
    const coordinator = new PushCoordinator({
      client,
      repository,
      sleep,
      onProgress: (p) => events.push({
        processed: p.processed,
        succeeded: p.succeeded,
        existing: p.existing,
        failed: p.failed,
        pending: p.pending,
        current: p.current,
      }),
    });

    const result = await coordinator.start();

    // 每词处理完成后各有一条 processed 递增的事件（current=undefined 的
    // 词粒度事件），分类计数逐词累加、pending 递减
    const perWord = events.filter((e) => e.processed > 0 && e.current === undefined);
    expect(perWord.slice(0, 3).map((e) => e.processed)).toEqual([1, 2, 3]);
    expect(perWord.slice(0, 3).map((e) => e.succeeded)).toEqual([1, 1, 1]);
    expect(perWord.slice(0, 3).map((e) => e.existing)).toEqual([0, 1, 1]);
    expect(perWord.slice(0, 3).map((e) => e.failed)).toEqual([0, 0, 1]);
    expect(perWord.slice(0, 3).map((e) => e.pending)).toEqual([2, 1, 0]);
    expect(result.phase).toBe("completed");
  });
});

describe("PushCoordinator 初始 getStatus", () => {
  it("未启动时返回 idle 快照", () => {
    const client = makeClient();
    const repository = makeRepository();
    const coordinator = new PushCoordinator({ client, repository });

    const status = coordinator.getStatus();

    expect(status.phase).toBe("idle");
    expect(status.pending).toBe(0);
    expect(status.total).toBe(0);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
describe("PushCoordinator HTTP 4xx 状态码分流", () => {
  it("HTTP 404（带 status 的 BbdcHttpError）不重试，计 failed 并继续下一词", async () => {
    const client = makeClient({
      checkExisting: vi.fn(async () => {
        throw new BbdcHttpError("bbdc HTTP 404", 404);
      }),
    });
    const repository = makeRepository([makeEntry("run"), makeEntry("garden")]);
    const { sleep, calls } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    // 每词只尝试 1 次（无 800/2000 重试延迟），只有词间 400ms 间隔
    expect(client.checkExisting).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([400]);
    expect(result.failed).toBe(2);
    expect(result.phase).toBe("completed");
    expect(repository.markPushed).not.toHaveBeenCalled();
  });

  it("HTTP 429（带 status 的错误）不重试，立即失败计数", async () => {
    const client = makeClient({
      addWord: vi.fn(async () => {
        throw new BbdcHttpError("bbdc HTTP 429", 429);
      }),
    });
    const repository = makeRepository([makeEntry("run")]);
    const { sleep, calls } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(client.addWord).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(result.failed).toBe(1);
  });

  it("HTTP 401（BbdcAuthError）暂停推送而非计入 failed", async () => {
    const client = makeClient({
      checkExisting: vi.fn(async () => {
        throw new BbdcAuthError("bbdc HTTP 401", { kind: "http", status: 401 });
      }),
    });
    const repository = makeRepository([makeEntry("run"), makeEntry("garden")]);
    const { sleep, calls } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(result.phase).toBe("paused");
    expect(result.failed).toBe(0);
    expect(calls).toEqual([]);
    expect(repository.markPushed).not.toHaveBeenCalled();
  });
});

describe("PushCoordinator 确认闸门后的推送输入（issue #22）", () => {
  it("推送输入 = listPending 快照的整个待推池（本次采集 + CSV 存量，不区分来源）", async () => {
    const client = makeClient();
    // 待推池混合来源：本次采集确认的新词 + CSV 导入的存量，都由 listPending 返回
    const repository = makeRepository([
      { lemma: "serendipity", flags: 0 }, // 本次采集（确认后入库）
      { lemma: "legacy-csv", flags: 0 }, // CSV 导入存量
      { lemma: "older-retry", flags: 0 }, // 历史失败保留
    ]);
    const { sleep } = makeSleep();
    const coordinator = new PushCoordinator({ client, repository, sleep });

    const result = await coordinator.start();

    expect(repository.listPending).toHaveBeenCalledTimes(1); // 一次运行只读一次快照
    expect(client.checkExisting).toHaveBeenCalledTimes(3);
    expect(client.addWord).toHaveBeenCalledTimes(3);
    expect(result.total).toBe(3);
    expect(result.phase).toBe("completed");
    expect(result.pending).toBe(0);
  });

  it("构造后未确认触发 start 前不下发任何 HTTP（推送仅由确认动作驱动）", async () => {
    const client = makeClient();
    const repository = makeRepository([makeEntry("run")]);
    const coordinator = new PushCoordinator({ client, repository, sleep: async () => undefined });

    expect(client.checkLogin).not.toHaveBeenCalled();
    expect(coordinator.getStatus().phase).toBe("idle");
    expect(repository.listPending).not.toHaveBeenCalled();
  });
});

describe("PushCoordinator 错误日志钩子（issue #25）", () => {
  it("单词推送失败（重试耗尽）：onError 收到 stage=push + 词 + 摘要", async () => {
    const client = makeClient({
      addWord: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const repository = makeRepository([makeEntry("run")]);
    const onError = vi.fn();
    const coordinator = new PushCoordinator({ client, repository, sleep: makeSleep().sleep, onError });

    const result = await coordinator.start();

    expect(result.failed).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith({ stage: "push", word: "run", summary: "network down" });
  });

  it("登录失效暂停：onError 收到 stage=push-pause + 词", async () => {
    const authError = new BbdcAuthError("bbdc HTTP 401", { kind: "http", status: 401 });
    const client = makeClient({
      checkExisting: vi.fn(async () => {
        throw authError;
      }),
    });
    const repository = makeRepository([makeEntry("run")]);
    const onError = vi.fn();
    const coordinator = new PushCoordinator({ client, repository, sleep: makeSleep().sleep, onError });

    const result = await coordinator.start();

    expect(result.phase).toBe("paused");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith({
      stage: "push-pause",
      word: "run",
      summary: "bbdc HTTP 401",
    });
  });

  it("checkLogin 登录失效：onError 收到 stage=push-pause（无词）", async () => {
    const client = makeClient({
      checkLogin: vi.fn(async () => {
        throw new BbdcAuthError("not logged in", { kind: "http", status: 401 });
      }),
    });
    const repository = makeRepository([makeEntry("run")]);
    const onError = vi.fn();
    const coordinator = new PushCoordinator({ client, repository, sleep: makeSleep().sleep, onError });

    const result = await coordinator.start();

    expect(result.phase).toBe("paused");
    expect(onError).toHaveBeenCalledWith({ stage: "push-pause", summary: "not logged in" });
  });

  it("成功路径不上报 onError", async () => {
    const client = makeClient();
    const repository = makeRepository([makeEntry("run")]);
    const onError = vi.fn();
    const coordinator = new PushCoordinator({ client, repository, sleep: makeSleep().sleep, onError });

    await coordinator.start();

    expect(onError).not.toHaveBeenCalled();
  });
});
