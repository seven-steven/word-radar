import { describe, expect, it, vi } from "vitest";
import { runCollection } from "../src/lib/run-collection.js";
import { WORDS_COLLECTED, type WordsCollectedMessage } from "../src/lib/messages.js";

describe("runCollection 编排", () => {
  it("收集文本 → core 提取 → 广播 WORDS_COLLECTED → 等 SW 驻留批次 → 应答确认页预览", async () => {
    const events: string[] = [];
    const broadcast = vi.fn(async (_message: WordsCollectedMessage) => {
      events.push("broadcast-ack");
      return { total: 1, newCount: 1, filteredCount: 3 };
    });

    const response = await runCollection({
      collectText: () => {
        events.push("collect");
        return "Running ran runs";
      },
      broadcast,
    });

    expect(response).toEqual({
      ok: true,
      total: 1,
      newCount: 1,
      filteredCount: 3,
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: WORDS_COLLECTED,
      entries: [{ lemma: "run", flags: 0 }],
      filteredCount: 0,
    });
    expect(events).toEqual(["collect", "broadcast-ack"]);
  });

  it("空文本提取出 0 词，仍广播空 entries（filteredCount: 0）", async () => {
    const broadcast = vi.fn(async () => ({ total: 0, newCount: 0, filteredCount: 0 }));

    const response = await runCollection({ collectText: () => "12345", broadcast });

    expect(response).toEqual({ ok: true, total: 0, newCount: 0, filteredCount: 0 });
    expect(broadcast).toHaveBeenCalledWith({
      type: WORDS_COLLECTED,
      entries: [],
      filteredCount: 0,
    });
  });

  it("可注入 extract 覆盖 core 默认实现（ExtractResult 形状）", async () => {
    const broadcast = vi.fn(async () => ({ total: 1, newCount: 1, filteredCount: 0 }));
    const extract = vi.fn(() => ({ entries: [{ lemma: "custom", flags: 0 }], filteredCount: 4 }));

    const response = await runCollection({
      collectText: () => "whatever",
      broadcast,
      extract,
    });

    expect(extract).toHaveBeenCalledWith("whatever", {
      filterAbbreviations: true,
      filterContractions: true,
    });
    expect(response).toEqual({
      ok: true,
      total: 1,
      newCount: 1,
      filteredCount: 0,
    });
    expect(broadcast).toHaveBeenCalledWith({
      type: WORDS_COLLECTED,
      entries: [{ lemma: "custom", flags: 0 }],
      filteredCount: 4,
    });
  });

  it("getFilterSettings 读出的两开关透传给 extract 的 options（issue #43）", async () => {
    const extract = vi.fn(() => ({ entries: [], filteredCount: 0 }));
    const broadcast = vi.fn(async () => ({ total: 0, newCount: 0, filteredCount: 0 }));

    await runCollection({
      collectText: () => "whatever",
      broadcast,
      extract,
      getFilterSettings: async () => ({
        filterAbbreviations: false,
        filterContractions: false,
      }),
    });

    expect(extract).toHaveBeenCalledWith("whatever", {
      filterAbbreviations: false,
      filterContractions: false,
    });
  });

  it("缺省 getFilterSettings 时开关按缺省全开传给 extract", async () => {
    const extract = vi.fn(() => ({ entries: [], filteredCount: 0 }));
    const broadcast = vi.fn(async () => ({ total: 0, newCount: 0, filteredCount: 0 }));

    await runCollection({ collectText: () => "x", broadcast, extract });

    expect(extract).toHaveBeenCalledWith("x", {
      filterAbbreviations: true,
      filterContractions: true,
    });
  });

  it("SW 应答畸形（非 {total,newCount}）时不谎报预览：应答 {ok:false,请重新采集}", async () => {
    const broadcast = vi.fn(async () => undefined); // SW 重启竞态：ack 丢失

    const response = await runCollection({ collectText: () => "run", broadcast });

    // review S-4：批次未驻留时确认页语义已失效，不能按 newCount=total 谎报
    expect(response).toEqual({ ok: false, error: "Please collect again" });
  });

  it("SW 应答缺 newCount 字段同样归入请重新采集", async () => {
    const broadcast = vi.fn(async () => ({ total: 1 }));

    const response = await runCollection({ collectText: () => "run", broadcast });

    expect(response).toEqual({ ok: false, error: "Please collect again" });
  });

  it("SW 应答的 filteredCount 缺省时响应保持缺省（popup 不渲染过滤行）", async () => {
    const broadcast = vi.fn(async () => ({ total: 1, newCount: 1 })); // 无 filteredCount

    const response = await runCollection({ collectText: () => "run", broadcast });

    expect(response).toEqual({ ok: true, total: 1, newCount: 1 });
    expect("filteredCount" in response ? response.filteredCount : undefined).toBeUndefined();
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
