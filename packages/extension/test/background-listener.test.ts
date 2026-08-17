import { describe, expect, it, vi } from "vitest";
import { createBackgroundListener } from "../src/lib/background-listener.js";
import { WORDS_COLLECTED } from "../src/lib/messages.js";

describe("createBackgroundListener", () => {
  it("收到 WORDS_COLLECTED 记录最近一次采集摘要", () => {
    const recordCollection = vi.fn();
    const listener = createBackgroundListener({
      recordCollection,
      now: () => new Date("2026-08-17T10:00:00.000Z"),
    });

    const keepChannel = listener(
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

    expect(keepChannel).toBe(false);
    expect(recordCollection).toHaveBeenCalledTimes(1);
    expect(recordCollection).toHaveBeenCalledWith({
      count: 2,
      at: "2026-08-17T10:00:00.000Z",
    });
  });

  it("忽略其他消息与畸形 WORDS_COLLECTED", () => {
    const recordCollection = vi.fn();
    const listener = createBackgroundListener({ recordCollection });

    listener({ type: "OTHER" }, {}, vi.fn());
    listener({ type: WORDS_COLLECTED, entries: "bad" }, {}, vi.fn());

    expect(recordCollection).not.toHaveBeenCalled();
  });
});
