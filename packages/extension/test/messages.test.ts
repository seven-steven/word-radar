import { describe, expect, it } from "vitest";
import {
  COLLECT_WORDS,
  WORDS_COLLECTED,
  isCollectResponse,
  isCollectWordsMessage,
  isWordsCollectedMessage,
} from "../src/lib/messages.js";

describe("消息协议常量", () => {
  it("锁定 type 字段字面值", () => {
    expect(COLLECT_WORDS).toBe("COLLECT_WORDS");
    expect(WORDS_COLLECTED).toBe("WORDS_COLLECTED");
  });
});

describe("isCollectWordsMessage", () => {
  it("接受合法消息", () => {
    expect(isCollectWordsMessage({ type: "COLLECT_WORDS" })).toBe(true);
  });

  it("拒绝非对象与错误 type", () => {
    expect(isCollectWordsMessage(null)).toBe(false);
    expect(isCollectWordsMessage(undefined)).toBe(false);
    expect(isCollectWordsMessage("COLLECT_WORDS")).toBe(false);
    expect(isCollectWordsMessage({})).toBe(false);
    expect(isCollectWordsMessage({ type: "WORDS_COLLECTED" })).toBe(false);
    expect(isCollectWordsMessage({ type: 42 })).toBe(false);
  });
});

describe("isWordsCollectedMessage", () => {
  it("接受合法消息（含空词条数组）", () => {
    expect(
      isWordsCollectedMessage({
        type: "WORDS_COLLECTED",
        entries: [{ lemma: "run", flags: 0 }],
      }),
    ).toBe(true);
    expect(isWordsCollectedMessage({ type: "WORDS_COLLECTED", entries: [] })).toBe(
      true,
    );
  });

  it("拒绝缺 entries、非数组 entries 与畸形词条", () => {
    expect(isWordsCollectedMessage({ type: "WORDS_COLLECTED" })).toBe(false);
    expect(
      isWordsCollectedMessage({ type: "WORDS_COLLECTED", entries: "run" }),
    ).toBe(false);
    expect(
      isWordsCollectedMessage({
        type: "WORDS_COLLECTED",
        entries: [{ lemma: "run" }],
      }),
    ).toBe(false);
    expect(
      isWordsCollectedMessage({
        type: "WORDS_COLLECTED",
        entries: [{ lemma: 1, flags: 0 }],
      }),
    ).toBe(false);
    expect(isWordsCollectedMessage(null)).toBe(false);
  });
});

describe("isCollectResponse", () => {
  it("接受成功与失败两种形态", () => {
    expect(isCollectResponse({ ok: true, count: 3 })).toBe(true);
    expect(isCollectResponse({ ok: false, error: "boom" })).toBe(true);
  });

  it("拒绝畸形应答", () => {
    expect(isCollectResponse({ ok: true })).toBe(false);
    expect(isCollectResponse({ ok: true, count: "3" })).toBe(false);
    expect(isCollectResponse({ ok: false })).toBe(false);
    expect(isCollectResponse(null)).toBe(false);
    expect(isCollectResponse("ok")).toBe(false);
  });
});
