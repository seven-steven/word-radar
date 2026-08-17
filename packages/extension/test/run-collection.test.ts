import { describe, expect, it, vi } from "vitest";
import { runCollection } from "../src/lib/run-collection.js";
import { WORDS_COLLECTED, type WordsCollectedMessage } from "../src/lib/messages.js";

describe("runCollection 编排", () => {
  it("收集文本 → core 提取 → 广播 WORDS_COLLECTED → 应答词数", () => {
    const events: string[] = [];
    const broadcast = vi.fn((message: WordsCollectedMessage) => {
      events.push(`broadcast:${message.type}`);
    });

    const response = runCollection({
      collectText: () => {
        events.push("collect");
        return "Running ran runs";
      },
      broadcast,
    });

    // 真实 core 提取：running/runs/ran → lemma "run" 一行
    expect(response).toEqual({ ok: true, count: 1 });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: WORDS_COLLECTED,
      entries: [{ lemma: "run", flags: 0 }],
    });
    // 顺序锁定：先收集后广播
    expect(events).toEqual(["collect", "broadcast:WORDS_COLLECTED"]);
  });

  it("空文本提取出 0 词，仍广播空 entries", () => {
    const broadcast = vi.fn();

    const response = runCollection({ collectText: () => "12345", broadcast });

    expect(response).toEqual({ ok: true, count: 0 });
    expect(broadcast).toHaveBeenCalledWith({
      type: WORDS_COLLECTED,
      entries: [],
    });
  });

  it("可注入 extract 覆盖 core 默认实现", () => {
    const broadcast = vi.fn();
    const extract = vi.fn(() => [{ lemma: "custom", flags: 0 }]);

    const response = runCollection({
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
});
