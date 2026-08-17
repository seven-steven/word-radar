import { describe, expect, it, vi } from "vitest";
import {
  createBackgroundListener,
  type BackgroundBbdcClient,
  type ActionBadgeGateway,
} from "../src/lib/background-listener.js";
import {
  CHECK_LOGIN,
  GET_COUNTS,
  MARK_PUSHED,
  RETRY_PUSH,
  GET_PUSH_STATUS,
  WORDS_COLLECTED,
} from "../src/lib/messages.js";
import type { BackgroundRepository } from "../src/lib/background-listener.js";
import type { PushCoordinator } from "../src/lib/push-coordinator.js";
import type { WordEntry } from "@word-radar/core";

function fakeRepository(): BackgroundRepository & {
  mergeCollected: ReturnType<typeof vi.fn>;
  getCounts: ReturnType<typeof vi.fn>;
  markPushed: ReturnType<typeof vi.fn>;
} {
  return {
    mergeCollected: vi.fn(async (entries: WordEntry[]) => ({
      total: entries.length,
      pending: entries.length,
    })),
    getCounts: vi.fn(async () => ({ total: 3, pending: 2 })),
    markPushed: vi.fn(async (lemmas: string[]) => ({
      total: 3,
      pending: 3 - lemmas.length,
    })),
  };
}

function fakeBbdcClient(overrides: Partial<BackgroundBbdcClient> = {}): BackgroundBbdcClient {
  return {
    checkLogin: vi.fn(async () => ({ loggedIn: true, resultCode: 200 })),
    ...overrides,
  };
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
  return {
    start: vi.fn(async () => ({
      phase: "idle" as const,
      total: 0,
      processed: 0,
      succeeded: 0,
      existing: 0,
      failed: 0,
      pending: 0,
    })),
    getStatus: vi.fn(() => ({
      phase: "idle" as const,
      total: 0,
      processed: 0,
      succeeded: 0,
      existing: 0,
      failed: 0,
      pending: 0,
    })),
  };
}

describe("createBackgroundListener", () => {
  it("收到 WORDS_COLLECTED 调 repository.mergeCollected；不持有通道", async () => {
    const repository = fakeRepository();
    const listener = createBackgroundListener({ repository });
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

    expect(keepChannel).toBe(false);
    // 等 microtask：合并是异步的
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(repository.mergeCollected).toHaveBeenCalledWith([
      { lemma: "run", flags: 0 },
      { lemma: "serendipity", flags: 0 },
    ]);
    expect(sendResponse).not.toHaveBeenCalled();
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
        async () => new Promise((resolve) => setTimeout(() => resolve({ loggedIn: true, resultCode: 200 }), 5)),
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
  it("WORDS_COLLECTED 后非阻塞触发 pushCoordinator.start()", async () => {
    const repository = fakeRepository();
    const push = fakePushCoordinator();
    const listener = createBackgroundListener({ repository, pushCoordinator: push });
    const sendResponse = vi.fn();

    listener(
      {
        type: WORDS_COLLECTED,
        entries: [{ lemma: "run", flags: 0 }],
      },
      {},
      sendResponse,
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(repository.mergeCollected).toHaveBeenCalled();
    expect(push.start).toHaveBeenCalledTimes(1);
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