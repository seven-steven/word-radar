import { describe, expect, it } from "vitest";
import {
  CHECK_LOGIN,
  COLLECT_WORDS,
  CONFIRM_COLLECTED,
  DISCARD_COLLECTED,
  EXPORT_CSV,
  GET_COUNTS,
  IMPORT_CSV,
  MARK_PUSHED,
  WORDS_COLLECTED,
  isCheckLoginMessage,
  isCheckLoginResponse,
  isConfirmCollectedMessage,
  isDiscardCollectedMessage,
  isCollectResponse,
  isCollectWordsMessage,
  isExportCsvMessage,
  isExportCsvResponse,
  isGetCountsMessage,
  isImportCsvMessage,
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
    expect(CONFIRM_COLLECTED).toBe("CONFIRM_COLLECTED");
    expect(DISCARD_COLLECTED).toBe("DISCARD_COLLECTED");
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

describe("isCollectResponse（确认页预览）", () => {
  it("接受成功（total + newCount）与失败两种形态", () => {
    expect(isCollectResponse({ ok: true, total: 3, newCount: 2 })).toBe(true);
    expect(isCollectResponse({ ok: true, total: 0, newCount: 0 })).toBe(true);
    expect(isCollectResponse({ ok: false, error: "boom" })).toBe(true);
  });

  it("拒绝畸形应答", () => {
    expect(isCollectResponse({ ok: true })).toBe(false);
    expect(isCollectResponse({ ok: true, total: "3", newCount: 0 })).toBe(false);
    expect(isCollectResponse({ ok: true, total: 3 })).toBe(false); // 缺 newCount
    expect(isCollectResponse({ ok: false })).toBe(false);
    expect(isCollectResponse(null)).toBe(false);
    expect(isCollectResponse("ok")).toBe(false);
  });
});

describe("isConfirmCollectedMessage", () => {
  it("接受合法消息、拒绝其他 type 与畸形值", () => {
    expect(isConfirmCollectedMessage({ type: "CONFIRM_COLLECTED" })).toBe(true);
    expect(isConfirmCollectedMessage({ type: "OTHER" })).toBe(false);
    expect(isConfirmCollectedMessage(null)).toBe(false);
    expect(isConfirmCollectedMessage(42)).toBe(false);
  });
});

describe("isDiscardCollectedMessage", () => {
  it("接受合法消息、拒绝其他 type 与畸形值", () => {
    expect(isDiscardCollectedMessage({ type: "DISCARD_COLLECTED" })).toBe(true);
    expect(isDiscardCollectedMessage({ type: "CONFIRM_COLLECTED" })).toBe(false);
    expect(isDiscardCollectedMessage(null)).toBe(false);
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

describe("T11 导入/导出消息协议", () => {
  it("锁定 type 字段字面值", () => {
    expect(EXPORT_CSV).toBe("EXPORT_CSV");
    expect(IMPORT_CSV).toBe("IMPORT_CSV");
  });
});

describe("isExportCsvMessage", () => {
  it("接受合法消息", () => {
    expect(isExportCsvMessage({ type: "EXPORT_CSV" })).toBe(true);
  });

  it("拒绝其他 type 与畸形值", () => {
    expect(isExportCsvMessage({ type: "IMPORT_CSV" })).toBe(false);
    expect(isExportCsvMessage(null)).toBe(false);
    expect(isExportCsvMessage("EXPORT_CSV")).toBe(false);
    expect(isExportCsvMessage(42)).toBe(false);
  });
});

describe("isImportCsvMessage", () => {
  it("接受合法消息（含空 csvText）", () => {
    expect(
      isImportCsvMessage({ type: "IMPORT_CSV", csvText: "lemma,flags\n", fileName: "a.csv" }),
    ).toBe(true);
    expect(
      isImportCsvMessage({ type: "IMPORT_CSV", csvText: "", fileName: "a.csv" }),
    ).toBe(true);
  });

  it("拒绝缺字段、非字符串 csvText / fileName 与畸形值", () => {
    expect(isImportCsvMessage({ type: "IMPORT_CSV" })).toBe(false);
    expect(isImportCsvMessage({ type: "IMPORT_CSV", csvText: "x" })).toBe(false);
    expect(
      isImportCsvMessage({ type: "IMPORT_CSV", csvText: 1, fileName: "a.csv" }),
    ).toBe(false);
    expect(
      isImportCsvMessage({ type: "IMPORT_CSV", csvText: "x", fileName: 42 }),
    ).toBe(false);
    expect(isImportCsvMessage(null)).toBe(false);
  });
});

describe("isExportCsvResponse", () => {
  it("接受 {ok:true,csv} 与 {ok:false,error}", () => {
    expect(isExportCsvResponse({ ok: true, csv: "lemma,flags\n" })).toBe(true);
    expect(isExportCsvResponse({ ok: false, error: "boom" })).toBe(true);
  });

  it("拒绝畸形应答", () => {
    expect(isExportCsvResponse(null)).toBe(false);
    expect(isExportCsvResponse({ ok: true })).toBe(false);
    expect(isExportCsvResponse({ ok: true, csv: 1 })).toBe(false);
    expect(isExportCsvResponse({ ok: false })).toBe(false);
    expect(isExportCsvResponse("csv")).toBe(false);
  });
});