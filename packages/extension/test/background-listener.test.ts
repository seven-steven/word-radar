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
    // CHECK_LOGIN 不再写 badge（issue #26）
    expect(badge.set).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ loggedIn: true });
    expect(push.start).toHaveBeenCalledTimes(1);
  });

  it("check-login result_code 非 200 → 应答 {loggedIn:false} + 不触发 push；badge 不亮（issue #26：未登录不写 badge）", async () => {
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

    // CHECK_LOGIN 不写 badge（issue #26）
    expect(badge.set).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ loggedIn: false });
    expect(push.start).not.toHaveBeenCalled();
  });

  it("BbdcAuthError（HTTP 401/403）→ 保守视为未登录；badge 不亮", async () => {
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

    expect(badge.set).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ loggedIn: false });
    expect(push.start).not.toHaveBeenCalled();
  });

  it("未知错误（解析/网络）也保守视为未登录；badge 不亮", async () => {
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

    expect(badge.set).not.toHaveBeenCalled();
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

  it("IMPORT_CSV：解析成功只驻留待确认批次（countNew 算 diff），不合并、不推送，应答 {total,newCount}；持有通道", async () => {
    const repository = fakeRepository();
    repository.countNew = vi.fn(async () => 1);
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
    // review S-3：导入同过确认闸门，不直接入库，也不自动触发推送
    expect(repository.countNew).toHaveBeenCalledWith([
      { lemma: "run", flags: 0 },
      { lemma: "other", flags: 1 },
    ]);
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(push.start).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ total: 2, newCount: 1 });
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
    expect(repository.countNew).not.toHaveBeenCalled();
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(push.start).not.toHaveBeenCalled();
  });

  it("IMPORT_CSV 空 CSV（仅表头）：应答 {total:0,newCount:0}，仍只驻留不合并", async () => {
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
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ total: 0, newCount: 0 });
  });

  it("IMPORT_CSV 仓库查询失败（countNew 抛错）时应答 {ok:false,error}", async () => {
    const repository = fakeRepository();
    repository.countNew = vi.fn(async () => {
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
    expect(repository.mergeCollected).not.toHaveBeenCalled();
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

  it("合并失败时保留待确认批次（review St-1）：应答 confirm-failed、不推送；重试确认成功后才清空", async () => {
    const repository = fakeRepository();
    repository.mergeCollected = vi.fn(async () => {
      throw new Error("db boom");
    });
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

    // 第一次确认：合并失败
    const failResponse = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, failResponse);
    await flush();
    expect(failResponse).toHaveBeenCalledWith({ ok: false, error: "confirm-failed" });
    expect(coordinator.start).not.toHaveBeenCalled();

    // 批次仍在：修复仓库后重试确认成功，批次才被清空
    const retryMerge = vi.fn(async () => ({ total: 1, pending: 1 }));
    repository.mergeCollected = retryMerge;
    const okResponse = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, okResponse);
    await flush();
    expect(retryMerge).toHaveBeenCalledTimes(1);
    expect(retryMerge).toHaveBeenCalledWith([
      { lemma: "run", flags: 0 },
    ]);
    expect(okResponse).toHaveBeenCalledWith({ total: 1, pending: 1 });
    expect(coordinator.start).toHaveBeenCalledTimes(1);

    // 成功后批次清空
    const third = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, third);
    expect(third).toHaveBeenCalledWith({ ok: false, error: "no-pending-batch" });
  });

  it("IMPORT_CSV 后确认：合并导入批次 + 触发一轮推送（导入不自动推送，确认才推）", async () => {
    const repository = fakeRepository();
    repository.mergeCollected = vi.fn(async () => ({ total: 1, pending: 1 }));
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
    // review S-3：导入只驻留批次，合并不发生、推送不触发
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();

    listener({ type: CONFIRM_COLLECTED }, {}, vi.fn());
    await flush();
    expect(repository.mergeCollected).toHaveBeenCalledTimes(1);
    expect(repository.mergeCollected).toHaveBeenCalledWith([
      { lemma: "run", flags: 0 },
    ]);
    expect(coordinator.start).toHaveBeenCalledTimes(1);
  });

  it("IMPORT_CSV 后取消：丢弃导入批次，不合并不推送", async () => {
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

    listener({ type: DISCARD_COLLECTED }, {}, vi.fn());
    const sendResponse = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);
    await flush();

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "no-pending-batch" });
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
  });
});

describe("createBackgroundListener 错误日志（issue #25）", () => {
  const flush = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  function fakeErrorLogger(): { log: ReturnType<typeof vi.fn> } {
    return { log: vi.fn() };
  }

  it("确认失败（mergeCollected 抛错）：应答 confirm-failed 且批次保留，错误写日志", async () => {
    const repository = fakeRepository();
    repository.mergeCollected = vi.fn(async () => {
      throw new Error("idb write failed");
    });
    const errorLogger = fakeErrorLogger();
    const coordinator = fakePushCoordinator();
    const listener = createBackgroundListener({ repository, pushCoordinator: coordinator, errorLogger });

    listener({ type: WORDS_COLLECTED, entries: [{ lemma: "run", flags: 0 }] }, {}, vi.fn());
    await flush();

    const sendResponse = vi.fn();
    const keep = listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);
    expect(keep).toBe(true);
    await flush();

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "confirm-failed" });
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(errorLogger.log).toHaveBeenCalledTimes(1);
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string; summary: string };
    expect(event.stage).toBe("confirm");
    expect(event.summary).toContain("idb write failed");
    // 批次保留：再确认仍会尝试合并
    listener({ type: CONFIRM_COLLECTED }, {}, vi.fn());
    await flush();
    expect(repository.mergeCollected).toHaveBeenCalledTimes(2);
  });

  it("IMPORT_CSV 解析失败：应答错误且错误（含文件名）写日志", async () => {
    const repository = fakeRepository();
    const errorLogger = fakeErrorLogger();
    const listener = createBackgroundListener({ repository, pushCoordinator: fakePushCoordinator(), errorLogger });
    const sendResponse = vi.fn();

    const keep = listener(
      {
        type: IMPORT_CSV,
        csvText: "lemma,flags\nbroken-no-flags\n",
        fileName: "bad.csv",
      },
      {},
      sendResponse,
    );
    expect(keep).toBe(true);
    await flush();

    expect(sendResponse.mock.calls[0]?.[0]).toMatchObject({ ok: false });
    expect(errorLogger.log).toHaveBeenCalledTimes(1);
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string; summary: string };
    expect(event.stage).toBe("import");
    expect(event.summary).toContain("bad.csv");
    expect(repository.mergeCollected).not.toHaveBeenCalled();
  });

  it("IMPORT_CSV 仓库查询失败：错误写日志", async () => {
    const repository = fakeRepository();
    repository.countNew = vi.fn(async () => {
      throw new Error("countNew boom");
    });
    const errorLogger = fakeErrorLogger();
    const listener = createBackgroundListener({ repository, pushCoordinator: fakePushCoordinator(), errorLogger });
    const sendResponse = vi.fn();

    listener(
      { type: IMPORT_CSV, csvText: "lemma,flags\nrun,0\n", fileName: "a.csv" },
      {},
      sendResponse,
    );
    await flush();

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "import-failed" });
    expect(errorLogger.log).toHaveBeenCalledTimes(1);
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string; summary: string };
    expect(event.stage).toBe("import");
    expect(event.summary).toContain("countNew boom");
  });
});

describe("createBackgroundListener 推送进度 + badge 回执（issue #23）", () => {
  const flush = async (ms = 0): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  };

  /** 慢速 client：每个请求延迟 ms，模拟真实网络下的长推送轮。 */
  function slowBbdcClient(ms: number, overrides: Partial<BackgroundBbdcClient> = {}): BackgroundBbdcClient {
    const delay = async <T>(value: T): Promise<T> => {
      await flush(ms);
      return value;
    };
    return fakeBbdcClient({
      checkExisting: vi.fn(async () => delay({ exists: false })),
      lookupDefinition: vi.fn(async () => delay(null)),
      addWord: vi.fn(async () => delay(undefined)),
      ...overrides,
    });
  }

  /** 真实 PushCoordinator（不注入 mock）：驱动 listener 内部推送轮。 */
  function listenerWithRealCoordinator(
    repository: ReturnType<typeof fakeRepository>,
    bbdcClient: BackgroundBbdcClient,
    badge: ReturnType<typeof fakeActionBadge>,
  ) {
    return createBackgroundListener({ repository, bbdcClient, actionBadge: badge });
  }

  /** 采集（等批次驻留）→ 确认，推送轮非阻塞启动。 */
  async function confirmBatch(
    listener: ReturnType<typeof createBackgroundListener>,
    entries: WordEntry[],
  ): Promise<void> {
    listener({ type: WORDS_COLLECTED, entries }, {}, vi.fn());
    await flush(); // WORDS_COLLECTED 异步驻留批次，确认前必须等它落位
    listener({ type: CONFIRM_COLLECTED }, {}, vi.fn());
    await flush(); // 确认异步链（合并 → 触发推送轮）完成，phase 离开 idle
  }

  function queryStatus(
    listener: ReturnType<typeof createBackgroundListener>,
  ): PushStatus {
    let status: PushStatus | undefined;
    listener({ type: GET_PUSH_STATUS }, {}, (value: PushStatus) => {
      status = value;
    });
    expect(status).toBeDefined();
    return status as PushStatus;
  }

  /** 轮询等待推送轮离开 running（真实 coordinator 默认 400ms 词间节奏）。 */
  async function waitForTerminal(
    listener: ReturnType<typeof createBackgroundListener>,
    timeoutMs = 8_000,
  ): Promise<PushStatus> {
    const start = Date.now();
    for (;;) {
      const status = queryStatus(listener);
      if (status.phase !== "running") return status;
      if (Date.now() - start > timeoutMs) throw new Error(`push still running: ${JSON.stringify(status)}`);
      await flush(100);
    }
  }

  it("推送中 GET_PUSH_STATUS 反映实时进度；重开弹窗（再次查询）连上同一轮的当前进度", async () => {
    const repository = fakeRepository();
    repository.mergeCollected = vi.fn(async () => ({ total: 3, pending: 3 }));
    repository.listPending = vi.fn(async () => [
      { lemma: "a", flags: 0 },
      { lemma: "b", flags: 0 },
      { lemma: "c", flags: 0 },
    ]);
    const badge = fakeActionBadge();
    const listener = listenerWithRealCoordinator(repository, slowBbdcClient(15), badge);

    await confirmBatch(listener, [{ lemma: "a", flags: 0 }]);

    // 轮次进行中多次查询（模拟 popup 关闭再重开）：phase=running 且
    // processed 单调不减、计数持续前进
    const seen: number[] = [];
    for (let i = 0; i < 12 && seen.filter((v, idx, arr) => idx === 0 || v > arr[idx - 1]).length < 3; i += 1) {
      const status = queryStatus(listener);
      expect(status.phase === "running" || status.phase === "completed").toBe(true);
      if (status.phase === "running") {
        seen.push(status.processed);
        expect(status.total).toBe(3);
        expect(status.processed + status.pending).toBe(3);
        expect(status.succeeded + status.existing + status.failed).toBe(status.processed);
      }
      await flush(20);
    }
    expect(seen.length).toBeGreaterThanOrEqual(2); // 至少两次 running 快照（重开连上）

    // 推送在 SW 侧自行跑完（popup 早已"关闭"）
    const final = await waitForTerminal(listener);
    expect(final.phase).toBe("completed");
    expect(final.processed).toBe(3);
    expect(final.succeeded).toBe(3);
  });

  it("badge：待确认批次 \"?\" → 推送中 x/y → 完成 \"✓\"（绿）", async () => {
    const repository = fakeRepository();
    repository.mergeCollected = vi.fn(async () => ({ total: 2, pending: 2 }));
    repository.listPending = vi.fn(async () => [
      { lemma: "a", flags: 0 },
      { lemma: "b", flags: 0 },
    ]);
    const badge = fakeActionBadge();
    const listener = listenerWithRealCoordinator(repository, slowBbdcClient(10), badge);

    // 采集驻留 → badge "?"
    listener({ type: WORDS_COLLECTED, entries: [{ lemma: "a", flags: 0 }] }, {}, vi.fn());
    await flush();
    expect(badge.set).toHaveBeenLastCalledWith("?", "#888888");

    // 确认 → 推送轮启动 → badge 逐步 x/y
    listener({ type: CONFIRM_COLLECTED }, {}, vi.fn());
    await flush(30);
    const texts = badge.set.mock.calls.map((call) => call[0]);
    expect(texts.some((t) => /^\d+\/2$/.test(String(t)))).toBe(true);

    await waitForTerminal(listener);
    expect(badge.set).toHaveBeenLastCalledWith("✓", "#0a7d2c");
  });

  it("badge：登录失效暂停 → \"!\"（红）回执", async () => {
    const repository = fakeRepository();
    repository.mergeCollected = vi.fn(async () => ({ total: 1, pending: 1 }));
    repository.listPending = vi.fn(async () => [{ lemma: "a", flags: 0 }]);
    const badge = fakeActionBadge();
    const bbdcClient = slowBbdcClient(5, {
      checkExisting: vi.fn(async () => {
        throw new (await import("../src/lib/bbdc-client.js")).BbdcAuthError("401", {
          kind: "http",
          status: 401,
        });
      }),
    });
    const listener = listenerWithRealCoordinator(repository, bbdcClient, badge);

    await confirmBatch(listener, [{ lemma: "a", flags: 0 }]);
    const final = await waitForTerminal(listener);

    expect(final.phase).toBe("paused");
    expect(badge.set).toHaveBeenLastCalledWith("!", "#b00000");
  });

  it("badge：取消丢弃待确认批次 → \"?\" 提示撤销", async () => {
    const repository = fakeRepository();
    const badge = fakeActionBadge();
    const listener = listenerWithRealCoordinator(repository, slowBbdcClient(5), badge);

    listener({ type: WORDS_COLLECTED, entries: [{ lemma: "a", flags: 0 }] }, {}, vi.fn());
    await flush();
    expect(badge.set).toHaveBeenLastCalledWith("?", "#888888");

    listener({ type: DISCARD_COLLECTED }, {}, vi.fn());
    expect(badge.set).toHaveBeenLastCalledWith(null);
  });
});

describe("createBackgroundListener 推送自动恢复（issue #26 resumeOnStart）", () => {
  it("resumeOnStart：待推池非空且 idle → 构造即自动起一轮推送", async () => {
    const repository = fakeRepository(); // 默认 listPending 返回 1 条待推
    const push = fakePushCoordinator();

    createBackgroundListener({ repository, pushCoordinator: push, resumeOnStart: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(repository.listPending).toHaveBeenCalledTimes(1);
    expect(push.start).toHaveBeenCalledTimes(1);
  });

  it("resumeOnStart：待推池为空 → 不起推送", async () => {
    const repository = fakeRepository();
    repository.listPending = vi.fn(async () => []);
    const push = fakePushCoordinator();

    createBackgroundListener({ repository, pushCoordinator: push, resumeOnStart: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(push.start).not.toHaveBeenCalled();
  });

  it("resumeOnStart：推送轮已在跑（非 idle）→ 不重复起轮", async () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();
    push.getStatus = vi.fn(() => ({
      phase: "running", total: 2, processed: 0, succeeded: 0, existing: 0, failed: 0, pending: 2,
    }));

    createBackgroundListener({ repository, pushCoordinator: push, resumeOnStart: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(push.start).not.toHaveBeenCalled();
  });

  it("resumeOnStart：查库失败静默（下次 SW 唤醒再试），不抛错", async () => {
    const repository = fakeRepository();
    repository.listPending = vi.fn(async () => {
      throw new Error("db boom");
    });
    const push = fakePushCoordinator();

    expect(() =>
      createBackgroundListener({ repository, pushCoordinator: push, resumeOnStart: true }),
    ).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(push.start).not.toHaveBeenCalled();
  });

  it("默认（未传 resumeOnStart）：构造不查待推池——单测与既有路径不受影响", async () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();

    createBackgroundListener({ repository, pushCoordinator: push });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(repository.listPending).not.toHaveBeenCalled();
    expect(push.start).not.toHaveBeenCalled();
  });
});
