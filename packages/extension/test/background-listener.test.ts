import { describe, expect, it, vi } from "vitest";
import {
  createBackgroundListener,
  type BackgroundBbdcClient,
  type ActionBadgeGateway,
} from "../src/lib/background-listener.js";
import {
  CHECK_LOGIN,
  CONFIRM_COLLECTED,
  DISCARD_COLLECTED,
  EXPORT_CSV,
  GET_COUNTS,
  IMPORT_CSV,
  MARK_PUSHED,
  RETRY_PUSH,
  GET_PUSH_STATUS,
  WORDS_COLLECTED,
} from "../src/lib/messages.js";
import type { BackgroundRepository } from "../src/lib/background-listener.js";
import type { PushStatus } from "../src/lib/messages.js";
import type { PushCoordinator } from "../src/lib/push-coordinator.js";
import type { WordEntry } from "@word-radar/core";

function fakeRepository(): BackgroundRepository & {
  mergeCollected: ReturnType<typeof vi.fn>;
  countNew: ReturnType<typeof vi.fn>;
  getCounts: ReturnType<typeof vi.fn>;
  markPushed: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
  listPending: ReturnType<typeof vi.fn>;
} {
  return {
    mergeCollected: vi.fn(async (entries: WordEntry[]) => ({
      total: entries.length,
      pending: entries.length,
    })),
    // 默认 diff：前 1 个是新词，其余为旧词（用例可覆盖）
    countNew: vi.fn(async (entries: WordEntry[]) => Math.min(entries.length, 1)),
    getCounts: vi.fn(async () => ({ total: 3, pending: 2 })),
    markPushed: vi.fn(async (lemmas: string[]) => ({
      total: 3,
      pending: 3 - lemmas.length,
    })),
    getAll: vi.fn(async (): Promise<WordEntry[]> => [
      { lemma: "garden", flags: 0 },
      { lemma: "run", flags: 1 },
    ]),
    listPending: vi.fn(async (): Promise<WordEntry[]> => [
      { lemma: "garden", flags: 0 },
    ]),
  };
}

function fakeBbdcClient(overrides: Partial<BackgroundBbdcClient> = {}): BackgroundBbdcClient {
  // 先给出全部方法的默认实现（满足 BackgroundBbdcClient 的必选面），
  // 再摊开 overrides；否则 Partial 展开后其余属性是 `| undefined`，
  // 与必选签名不兼容（TS2322）。
  const defaults: BackgroundBbdcClient = {
    checkLogin: vi.fn(async () => ({ loggedIn: true, resultCode: 200 })),
    listNewWords: vi.fn(async () => ({ result_code: 0, data_body: {} })),
    checkExisting: vi.fn(async () => ({ exists: false })),
    lookupDefinition: vi.fn(async () => null),
    addWord: vi.fn(async () => undefined),
  };
  return { ...defaults, ...overrides };
}

function fakeActionBadge(): ActionBadgeGateway & {
  set: ReturnType<typeof vi.fn>;
} {
  return {
    set: vi.fn(async () => undefined),
  };
}

function fakePushCoordinator(): PushCoordinator & {
  start: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
} {
  const idle: PushStatus = {
    phase: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    existing: 0,
    failed: 0,
    pending: 0,
  };
  // listener 只消费 start/getStatus；类其余成员（client/repository 等私有
  // 状态）不在依赖面内，故以结构化 mock + 单点 as 断言收窄，避免伪造整套类。
  return {
    start: vi.fn(async () => idle),
    getStatus: vi.fn(() => idle),
  } as unknown as PushCoordinator & {
    start: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };
}

describe("createBackgroundListener", () => {
  it("WORDS_COLLECTED 只驻留待确认批次：调 countNew 算 diff、不合并、应答 {total,newCount}；持有通道", async () => {
    const repository = fakeRepository();
    repository.countNew = vi.fn(async () => 1);
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({ repository, pushCoordinator: push });
    const sendResponse = vi.fn();

    const keepChannel = listener(
      {
        type: WORDS_COLLECTED,
        entries: [
          { lemma: "run", flags: 0 },
          { lemma: "serendipity", flags: 0 },
        ],
      },
      {},
      sendResponse,
    );

    expect(keepChannel).toBe(true); // 异步应答，持有消息通道
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(repository.countNew).toHaveBeenCalledWith([
      { lemma: "run", flags: 0 },
      { lemma: "serendipity", flags: 0 },
    ]);
    // 确认闸门：采集消息不再直接触发入库，也不触发推送
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(push.start).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ total: 2, newCount: 1 });
  });

  it("GET_COUNTS 异步应答当前计数；返回 true 持有通道", async () => {
    const repository = fakeRepository();
    const listener = createBackgroundListener({ repository });
    const sendResponse = vi.fn();

    const keepChannel = listener({ type: GET_COUNTS }, {}, sendResponse);

    expect(keepChannel).toBe(true);
    await Promise.resolve();
    expect(repository.getCounts).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ total: 3, pending: 2 });
  });

  it("MARK_PUSHED 转发 lemmas 给 repository；异步返回新计数", async () => {
    const repository = fakeRepository();
    const listener = createBackgroundListener({ repository });
    const sendResponse = vi.fn();

    const keepChannel = listener(
      { type: MARK_PUSHED, lemmas: ["a", "b"] },
      {},
      sendResponse,
    );

    expect(keepChannel).toBe(true);
    await Promise.resolve();
    expect(repository.markPushed).toHaveBeenCalledWith(["a", "b"]);
    expect(sendResponse).toHaveBeenCalledWith({ total: 3, pending: 1 });
  });

  it("MARK_PUSHED 仓库失败时 sendResponse 收到 {ok:false,error}", async () => {
    const repository = fakeRepository();
    repository.markPushed = vi.fn(async () => {
      throw new Error("db boom");
    });
    const listener = createBackgroundListener({ repository });
    const sendResponse = vi.fn();

    listener({ type: MARK_PUSHED, lemmas: ["x"] }, {}, sendResponse);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "mark-failed" });
  });

  it("GET_COUNTS 仓库失败时 sendResponse 收到 {ok:false,error}", async () => {
    const repository = fakeRepository();
    repository.getCounts = vi.fn(async () => {
      throw new Error("db boom");
    });
    const listener = createBackgroundListener({ repository });
    const sendResponse = vi.fn();

    listener({ type: GET_COUNTS }, {}, sendResponse);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "counts-failed" });
  });

  it("忽略其他消息与畸形消息；不调 repository，不持有通道", async () => {
    const repository = fakeRepository();
    const listener = createBackgroundListener({ repository });
    const sendResponse = vi.fn();

    expect(listener({ type: "OTHER" }, {}, sendResponse)).toBe(false);
    expect(
      listener({ type: WORDS_COLLECTED, entries: "bad" }, {}, sendResponse),
    ).toBe(false);
    expect(
      listener({ type: MARK_PUSHED, lemmas: "bad" }, {}, sendResponse),
    ).toBe(false);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(repository.markPushed).not.toHaveBeenCalled();
    expect(repository.getCounts).not.toHaveBeenCalled();
  });
});

describe("createBackgroundListener CHECK_LOGIN（T09 + T10）", () => {
  it("已登录 → 应答 {loggedIn:true} + 清除 badge + 非阻塞触发 pushCoordinator.start()", async () => {
    const repository = fakeRepository();
    const bbdcClient = fakeBbdcClient({
      checkLogin: vi.fn(async () => ({ loggedIn: true, resultCode: 200 })),
    });
    const badge = fakeActionBadge();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      bbdcClient,
      actionBadge: badge,
      pushCoordinator: push,
    });
    const sendResponse = vi.fn();

    const keepChannel = listener({ type: CHECK_LOGIN }, {}, sendResponse);

    expect(keepChannel).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(bbdcClient.checkLogin).toHaveBeenCalledTimes(1);
    expect(badge.set).toHaveBeenCalledWith(null);
    expect(sendResponse).toHaveBeenCalledWith({ loggedIn: true });
    expect(push.start).toHaveBeenCalledTimes(1);
  });

  it("check-login result_code 非 200 → 应答 {loggedIn:false} + 设 badge \"!\" + 不触发 push", async () => {
    const repository = fakeRepository();
    const bbdcClient = fakeBbdcClient({
      checkLogin: vi.fn(async () => ({ loggedIn: false, resultCode: 401 })),
    });
    const badge = fakeActionBadge();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      bbdcClient,
      actionBadge: badge,
      pushCoordinator: push,
    });
    const sendResponse = vi.fn();

    listener({ type: CHECK_LOGIN }, {}, sendResponse);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(badge.set).toHaveBeenCalledWith("!");
    expect(sendResponse).toHaveBeenCalledWith({ loggedIn: false });
    expect(push.start).not.toHaveBeenCalled();
  });

  it("BbdcAuthError（HTTP 401/403）→ 保守视为未登录 + 设 badge \"!\"", async () => {
    class FakeAuthError extends Error {}
    const repository = fakeRepository();
    const bbdcClient = fakeBbdcClient({
      checkLogin: vi.fn(async () => {
        throw new FakeAuthError("auth");
      }),
    });
    const badge = fakeActionBadge();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      bbdcClient,
      actionBadge: badge,
      pushCoordinator: push,
    });
    const sendResponse = vi.fn();

    listener({ type: CHECK_LOGIN }, {}, sendResponse);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(badge.set).toHaveBeenCalledWith("!");
    expect(sendResponse).toHaveBeenCalledWith({ loggedIn: false });
    expect(push.start).not.toHaveBeenCalled();
  });

  it("未知错误（解析/网络）也保守视为未登录", async () => {
    const repository = fakeRepository();
    const bbdcClient = fakeBbdcClient({
      checkLogin: vi.fn(async () => {
        throw new Error("network boom");
      }),
    });
    const badge = fakeActionBadge();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      bbdcClient,
      actionBadge: badge,
      pushCoordinator: push,
    });
    const sendResponse = vi.fn();

    listener({ type: CHECK_LOGIN }, {}, sendResponse);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(badge.set).toHaveBeenCalledWith("!");
    expect(sendResponse).toHaveBeenCalledWith({ loggedIn: false });
    expect(push.start).not.toHaveBeenCalled();
  });

  it("CHECK_LOGIN 异步：返回 true 持有消息通道", async () => {
    const repository = fakeRepository();
    const bbdcClient = fakeBbdcClient({
      checkLogin: vi.fn(
        async (): Promise<{ loggedIn: boolean; resultCode: number }> =>
          new Promise((resolve) => setTimeout(() => resolve({ loggedIn: true, resultCode: 200 }), 5)),
      ),
    });
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      bbdcClient,
      pushCoordinator: push,
    });
    const sendResponse = vi.fn();

    expect(listener({ type: CHECK_LOGIN }, {}, sendResponse)).toBe(true);
  });
});

describe("createBackgroundListener T10 push 消息", () => {
  it("WORDS_COLLECTED 不触发 pushCoordinator.start()（推送仅由确认驱动）", async () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({ repository, pushCoordinator: push });

    listener(
      { type: WORDS_COLLECTED, entries: [{ lemma: "run", flags: 0 }] },
      {},
      vi.fn(),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(push.start).not.toHaveBeenCalled();
  });

  it("RETRY_PUSH 转发给 pushCoordinator.start()；不持有通道", () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({ repository, pushCoordinator: push });
    const sendResponse = vi.fn();

    const keepChannel = listener({ type: RETRY_PUSH }, {}, sendResponse);

    expect(keepChannel).toBe(false);
    expect(push.start).toHaveBeenCalledTimes(1);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("GET_PUSH_STATUS 同步返回 pushCoordinator.getStatus() 快照", () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();
    push.getStatus = vi.fn(() => ({
      phase: "running" as const,
      total: 5,
      processed: 2,
      succeeded: 1,
      existing: 1,
      failed: 0,
      pending: 3,
      current: "garden",
    }));
    const listener = createBackgroundListener({ repository, pushCoordinator: push });
    const sendResponse = vi.fn();

    const keepChannel = listener({ type: GET_PUSH_STATUS }, {}, sendResponse);

    expect(keepChannel).toBe(false);
    expect(push.getStatus).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      phase: "running",
      total: 5,
      processed: 2,
      succeeded: 1,
      existing: 1,
      failed: 0,
      pending: 3,
      current: "garden",
    });
  });
});

describe("createBackgroundListener T11 CSV 导入/导出", () => {
  it("EXPORT_CSV：getAll → stringify 应答 {ok:true,csv}（含已推位）；持有通道", async () => {
    const repository = fakeRepository();
    const listener = createBackgroundListener({ repository });
    const sendResponse = vi.fn();

    const keepChannel = listener({ type: EXPORT_CSV }, {}, sendResponse);

    expect(keepChannel).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(repository.getAll).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      csv: "lemma,flags\ngarden,0\nrun,1\n",
    });
  });

  it("EXPORT_CSV 仓库失败时应答 {ok:false,error}", async () => {
    const repository = fakeRepository();
    repository.getAll = vi.fn(async () => {
      throw new Error("db boom");
    });
    const listener = createBackgroundListener({ repository });
    const sendResponse = vi.fn();

    listener({ type: EXPORT_CSV }, {}, sendResponse);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "export-failed" });
  });

  it("IMPORT_CSV：解析后调 mergeCollected（flags 按 CSV 值传入）并应答新计数；非阻塞触发推送", async () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({ repository, pushCoordinator: push });
    const sendResponse = vi.fn();

    const keepChannel = listener(
      { type: IMPORT_CSV, csvText: "lemma,flags\nrun,0\nother,1\n", fileName: "in.csv" },
      {},
      sendResponse,
    );

    expect(keepChannel).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(repository.mergeCollected).toHaveBeenCalledWith([
      { lemma: "run", flags: 0 },
      { lemma: "other", flags: 1 },
    ]);
    expect(sendResponse).toHaveBeenCalledWith({ total: 2, pending: 2 });
    expect(push.start).toHaveBeenCalledTimes(1);
  });

  it("IMPORT_CSV 坏 CSV：应答 {ok:false} 且错误含文件名与行号；不产生任何写入", async () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({ repository, pushCoordinator: push });
    const sendResponse = vi.fn();

    listener(
      {
        type: IMPORT_CSV,
        csvText: "lemma,flags\nrun,0\n,oops\n",
        fileName: "broken.csv",
      },
      {},
      sendResponse,
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const response = sendResponse.mock.calls[0]?.[0] as {
      ok: false;
      error: string;
    };
    expect(response.ok).toBe(false);
    expect(response.error).toContain("broken.csv");
    expect(response.error).toContain("line 3");
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(push.start).not.toHaveBeenCalled();
  });

  it("IMPORT_CSV 空 CSV（仅表头）：按空列表合并，不报错", async () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({ repository, pushCoordinator: push });
    const sendResponse = vi.fn();

    listener(
      { type: IMPORT_CSV, csvText: "lemma,flags\n", fileName: "empty.csv" },
      {},
      sendResponse,
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(repository.mergeCollected).toHaveBeenCalledWith([]);
    expect(sendResponse).toHaveBeenCalledWith({ total: 0, pending: 0 });
  });

  it("IMPORT_CSV 仓库写入失败时应答 {ok:false,error}", async () => {
    const repository = fakeRepository();
    repository.mergeCollected = vi.fn(async () => {
      throw new Error("db boom");
    });
    const listener = createBackgroundListener({ repository });
    const sendResponse = vi.fn();

    listener(
      { type: IMPORT_CSV, csvText: "lemma,flags\nrun,0\n", fileName: "a.csv" },
      {},
      sendResponse,
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "import-failed" });
  });
});
describe("createBackgroundListener 确认闸门（issue #22）", () => {
  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  it("确认（CONFIRM_COLLECTED）：批次合并入词库 + 非阻塞触发一轮推送；应答最新计数", async () => {
    const repository = fakeRepository();
    repository.mergeCollected = vi.fn(async () => ({ total: 5, pending: 5 }));
    const coordinator = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: coordinator,
    });

    // 先采集（驻留待确认批次）
    listener(
      {
        type: WORDS_COLLECTED,
        entries: [
          { lemma: "run", flags: 0 },
          { lemma: "serendipity", flags: 0 },
        ],
      },
      {},
      vi.fn(),
    );
    await flush();
    expect(repository.mergeCollected).not.toHaveBeenCalled();

    const sendResponse = vi.fn();
    const keep = listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);
    expect(keep).toBe(true);
    await flush();

    expect(repository.mergeCollected).toHaveBeenCalledTimes(1);
    expect(repository.mergeCollected).toHaveBeenCalledWith([
      { lemma: "run", flags: 0 },
      { lemma: "serendipity", flags: 0 },
    ]);
    expect(coordinator.start).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ total: 5, pending: 5 });
  });

  it("无待确认批次时确认应答 {ok:false,error}，不合并不推送", async () => {
    const repository = fakeRepository();
    const coordinator = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: coordinator,
    });
    const sendResponse = vi.fn();

    const keep = listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);

    expect(keep).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "no-pending-batch" });
    await flush();
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
  });

  it("取消（DISCARD_COLLECTED）：丢弃批次，随后确认应答 no-pending-batch", async () => {
    const repository = fakeRepository();
    const coordinator = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: coordinator,
    });

    listener(
      { type: WORDS_COLLECTED, entries: [{ lemma: "run", flags: 0 }] },
      {},
      vi.fn(),
    );
    await flush();

    const keep = listener({ type: DISCARD_COLLECTED }, {}, vi.fn());
    expect(keep).toBe(false);

    const sendResponse = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);
    await flush();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "no-pending-batch" });
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
  });

  it("再次采集覆盖旧批次：确认只合并最后一次的词条", async () => {
    const repository = fakeRepository();
    const coordinator = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: coordinator,
    });

    listener(
      { type: WORDS_COLLECTED, entries: [{ lemma: "first", flags: 0 }] },
      {},
      vi.fn(),
    );
    await flush();
    listener(
      { type: WORDS_COLLECTED, entries: [{ lemma: "second", flags: 0 }] },
      {},
      vi.fn(),
    );
    await flush();

    listener({ type: CONFIRM_COLLECTED }, {}, vi.fn());
    await flush();

    expect(repository.mergeCollected).toHaveBeenCalledTimes(1);
    expect(repository.mergeCollected).toHaveBeenCalledWith([
      { lemma: "second", flags: 0 },
    ]);
  });

  it("确认后批次清空：再次确认应答 no-pending-batch", async () => {
    const repository = fakeRepository();
    const coordinator = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: coordinator,
    });

    listener(
      { type: WORDS_COLLECTED, entries: [{ lemma: "run", flags: 0 }] },
      {},
      vi.fn(),
    );
    await flush();
    listener({ type: CONFIRM_COLLECTED }, {}, vi.fn());
    await flush();

    const sendResponse = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);
    await flush();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "no-pending-batch" });
    expect(repository.mergeCollected).toHaveBeenCalledTimes(1);
    expect(coordinator.start).toHaveBeenCalledTimes(1);
  });

  it("IMPORT_CSV 合并完成后仍触发一轮推送（待推池不区分来源，无开关）", async () => {
    const repository = fakeRepository();
    const coordinator = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: coordinator,
    });

    listener(
      { type: IMPORT_CSV, csvText: "lemma,flags\nrun,0\n", fileName: "a.csv" },
      {},
      vi.fn(),
    );
    await flush();

    expect(repository.mergeCollected).toHaveBeenCalledTimes(1);
    expect(coordinator.start).toHaveBeenCalledTimes(1);
  });
});
