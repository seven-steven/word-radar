import { describe, expect, it, vi } from "vitest";
import { runCollection } from "../src/lib/run-collection.js";
import { WORDS_COLLECTED, type WordsCollectedMessage } from "../src/lib/messages.js";

describe("runCollection 编排", () => {
  it("收集文本 → core 提取 → 广播 WORDS_COLLECTED → 等 ack → 应答词数", async () => {
    const events: string[] = [];
    const broadcast = vi.fn(async (_message: WordsCollectedMessage) => {
      events.push("broadcast-ack");
    });

    const response = await runCollection({
      collectText: () => {
        events.push("collect");
        return "Running ran runs";
      },
      broadcast,
    });

    expect(response).toEqual({ ok: true, count: 1 });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: WORDS_COLLECTED,
      entries: [{ lemma: "run", flags: 0 }],
    });
    expect(events).toEqual(["collect", "broadcast-ack"]);
  });

  it("空文本提取出 0 词，仍广播空 entries", async () => {
    const broadcast = vi.fn(async () => undefined);

    const response = await runCollection({ collectText: () => "12345", broadcast });

    expect(response).toEqual({ ok: true, count: 0 });
    expect(broadcast).toHaveBeenCalledWith({
      type: WORDS_COLLECTED,
      entries: [],
    });
  });

  it("可注入 extract 覆盖 core 默认实现", async () => {
    const broadcast = vi.fn(async () => undefined);
    const extract = vi.fn(() => [{ lemma: "custom", flags: 0 }]);

    const response = await runCollection({
      collectText: () => "whatever",
      broadcast,
      extract,
    });

    expect(extract).toHaveBeenCalledWith("whatever");
    expect(response).toEqual({ ok: true, count: 1 });
    expect(broadcast).toHaveBeenCalledWith({
      type: WORDS_COLLECTED,
      entries: [{ lemma: "custom", flags: 0 }],
    });
  });

  it("broadcast 抛错时不吞掉", async () => {
    const broadcast = vi.fn(async () => {
      throw new Error("broadcast boom");
    });

    await expect(
      runCollection({
        collectText: () => "whatever",
        broadcast,
      }),
    ).rejects.toThrow("broadcast boom");
  });
});
