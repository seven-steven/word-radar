import { describe, expect, it, vi } from "vitest";
import { createBackgroundListener } from "../src/lib/background-listener.js";
import {
  GET_COUNTS,
  MARK_PUSHED,
  WORDS_COLLECTED,
} from "../src/lib/messages.js";
import type { BackgroundRepository } from "../src/lib/background-listener.js";
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