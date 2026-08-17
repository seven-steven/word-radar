import { describe, expect, it } from "vitest";
import {
  CHECK_LOGIN,
  COLLECT_WORDS,
  GET_COUNTS,
  MARK_PUSHED,
  WORDS_COLLECTED,
  isCheckLoginMessage,
  isCheckLoginResponse,
  isCollectResponse,
  isCollectWordsMessage,
  isGetCountsMessage,
  isMarkPushedMessage,
  isWordsCollectedMessage,
} from "../src/lib/messages.js";

describe("消息协议常量", () => {
  it("锁定 type 字段字面值", () => {
    expect(COLLECT_WORDS).toBe("COLLECT_WORDS");
    expect(WORDS_COLLECTED).toBe("WORDS_COLLECTED");
    expect(GET_COUNTS).toBe("GET_COUNTS");
    expect(MARK_PUSHED).toBe("MARK_PUSHED");
    expect(CHECK_LOGIN).toBe("CHECK_LOGIN");
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

describe("isGetCountsMessage", () => {
  it("接受合法消息", () => {
    expect(isGetCountsMessage({ type: "GET_COUNTS" })).toBe(true);
  });

  it("拒绝其他 type 与畸形值", () => {
    expect(isGetCountsMessage({ type: "OTHER" })).toBe(false);
    expect(isGetCountsMessage(null)).toBe(false);
    expect(isGetCountsMessage(42)).toBe(false);
  });
});

describe("isMarkPushedMessage", () => {
  it("接受合法消息（含空 lemmas 数组）", () => {
    expect(isMarkPushedMessage({ type: "MARK_PUSHED", lemmas: ["a"] })).toBe(true);
    expect(isMarkPushedMessage({ type: "MARK_PUSHED", lemmas: [] })).toBe(true);
  });

  it("拒绝缺 lemmas、非数组 lemmas 与非字符串元素", () => {
    expect(isMarkPushedMessage({ type: "MARK_PUSHED" })).toBe(false);
    expect(isMarkPushedMessage({ type: "MARK_PUSHED", lemmas: "a,b" })).toBe(false);
    expect(isMarkPushedMessage({ type: "MARK_PUSHED", lemmas: [1, 2] })).toBe(
      false,
    );
    expect(isMarkPushedMessage(null)).toBe(false);
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

describe("isCheckLoginMessage", () => {
  it("接受合法消息", () => {
    expect(isCheckLoginMessage({ type: "CHECK_LOGIN" })).toBe(true);
  });

  it("拒绝其他 type 与畸形值", () => {
    expect(isCheckLoginMessage({ type: "OTHER" })).toBe(false);
    expect(isCheckLoginMessage(null)).toBe(false);
    expect(isCheckLoginMessage(42)).toBe(false);
  });
});

describe("isCheckLoginResponse", () => {
  it("接受 loggedIn=true/false 与 {ok:false,error}", () => {
    expect(isCheckLoginResponse({ loggedIn: true })).toBe(true);
    expect(isCheckLoginResponse({ loggedIn: false })).toBe(true);
    expect(isCheckLoginResponse({ ok: false, error: "boom" })).toBe(true);
  });

  it("拒绝畸形应答", () => {
    expect(isCheckLoginResponse(null)).toBe(false);
    expect(isCheckLoginResponse({ loggedIn: "yes" })).toBe(false);
    expect(isCheckLoginResponse({ ok: false })).toBe(false);
    expect(isCheckLoginResponse({ ok: true })).toBe(false);
  });
});