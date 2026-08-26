/**
 * Locale invariant tests: ensure en, zh_CN, and zh_TW have identical key sets
 * and that all i18n keys used in code exist in all three locale files.
 */
import { describe, expect, it } from "vitest";

// Load locale files
const enMessages: Record<string, { message: string; description: string }> =
  await import("../_locales/en/messages.json", {
    assert: { type: "json" },
  }).then((m) => m.default);

const zhCnMessages: Record<string, { message: string; description: string }> =
  await import("../_locales/zh_CN/messages.json", {
    assert: { type: "json" },
  }).then((m) => m.default);

const zhTwMessages: Record<string, { message: string; description: string }> =
  await import("../_locales/zh_TW/messages.json", {
    assert: { type: "json" },
  }).then((m) => m.default);

describe("locale invariants", () => {
  it("en, zh_CN, and zh_TW have identical key sets", () => {
    const enKeys = new Set(Object.keys(enMessages));
    const zhCnKeys = new Set(Object.keys(zhCnMessages));
    const zhTwKeys = new Set(Object.keys(zhTwMessages));

    // Keys in English but not in Chinese locales
    const missingInZhCn = [...enKeys].filter((key) => !zhCnKeys.has(key));
    const missingInZhTw = [...enKeys].filter((key) => !zhTwKeys.has(key));
    // Keys in Chinese locales but not in English
    const missingInEnFromZhCn = [...zhCnKeys].filter((key) => !enKeys.has(key));
    const missingInEnFromZhTw = [...zhTwKeys].filter((key) => !enKeys.has(key));

    expect(
      missingInZhCn,
      `Keys missing in zh_CN: ${missingInZhCn.join(", ")}`
    ).toHaveLength(0);

    expect(
      missingInZhTw,
      `Keys missing in zh_TW: ${missingInZhTw.join(", ")}`
    ).toHaveLength(0);

    expect(
      missingInEnFromZhCn,
      `Keys missing in en from zh_CN: ${missingInEnFromZhCn.join(", ")}`
    ).toHaveLength(0);

    expect(
      missingInEnFromZhTw,
      `Keys missing in en from zh_TW: ${missingInEnFromZhTw.join(", ")}`
    ).toHaveLength(0);

    // Total key counts should match across all locales
    expect(enKeys.size).toBe(zhCnKeys.size);
    expect(enKeys.size).toBe(zhTwKeys.size);
    expect(zhCnKeys.size).toBe(zhTwKeys.size);
  });

  it("all keys used in code exist in all three locales", () => {
    // These are all the i18n keys used throughout the codebase
    // (extracted from grep analysis of t(), t1(), t2(), t3() calls)
    const usedKeys = [
      // Static UI keys (from issue #30)
      "extName",
      "extDescription",
      "extTooltip",
      "popupTitle",
      "popupHeading",
      "countTotal",
      "countPushed",
      "countPending",
      "statusCollecting",
      "btnRecollect",
      "btnConfirmPush",
      "btnCancel",
      "pushStatusIdle",
      "pushSuccess",
      "pushExisting",
      "pushFailed",
      "btnRetryPending",
      "btnExportCsv",
      "btnImportCsv",
      "btnUploadFile",
      "btnExportLog",
      "loginStatusUnknown",
      "btnCheckLogin",
      "btnOpenBbdc",
      // Dynamic keys (from issue #31)
      "sourceCollect",
      "sourceImport",
      "sourceUpload",
      "statusLoggedIn",
      "statusLoggedOut",
      "pushRunning",
      "pushPaused",
      "pushPausedWithError",
      "pushCompleted",
      "pushIdle",
      "exporting",
      "exportCsvSuccess",
      "exportFailed",
      "noErrorLogs",
      "exportedLogCount",
      "exportLogFailed",
      "importingFile",
      "importParsedPending",
      "importFailed",
      "uploadCollectingFile",
      "uploadParsedPending",
      "uploadFailed",
      "confirmSummary",
      "pendingConfirm",
      "confirmFailed",
      "confirmedPushStarted",
      "cancelled",
      "checkingLogin",
      "errorNoActiveTab",
      "errorCannotInject",
      "errorInvalidContentResponse",
      "errorRecollectNeeded",
      "errorOnlyTextFiles",
      "errorConfirmMergeFailed",
      "errorImportFailed",
      "errorUploadFailed",
    ];

    const enKeys = new Set(Object.keys(enMessages));
    const zhCnKeys = new Set(Object.keys(zhCnMessages));
    const zhTwKeys = new Set(Object.keys(zhTwMessages));

    for (const key of usedKeys) {
      expect(
        enKeys.has(key),
        `Key "${key}" used in code but missing in en/messages.json`
      ).toBe(true);

      expect(
        zhCnKeys.has(key),
        `Key "${key}" used in code but missing in zh_CN/messages.json`
      ).toBe(true);

      expect(
        zhTwKeys.has(key),
        `Key "${key}" used in code but missing in zh_TW/messages.json`
      ).toBe(true);
    }
  });

  it("brand name is localized: 单词雷达 in zh locales, WordRadar in en", () => {
    // issue #28：中文环境（zh_CN/zh_TW）所有面向用户的名称显示点都是「单词雷达」，
    // 英文环境兜底 WordRadar。manifest 三字段之外，popup 标题/主标题是用户
    // 原始反馈里最显眼的名称显示点（见 issue 截图），锁住三个 locale 的值。
    for (const key of ["extName", "extTooltip", "popupTitle", "popupHeading"]) {
      expect(enMessages[key].message).toBe("WordRadar");
      expect(zhCnMessages[key].message).toBe("单词雷达");
      expect(zhTwMessages[key].message).toBe("单词雷达");
    }
  });

  it("all locale entries have required fields", () => {
    const validateEntry = (locale: string, messages: typeof enMessages) => {
      for (const [key, entry] of Object.entries(messages)) {
        expect(entry.message, `${locale}/${key}: missing "message" field`).toBeDefined();
        expect(typeof entry.message, `${locale}/${key}: "message" must be string`).toBe("string");
        expect(entry.description, `${locale}/${key}: missing "description" field`).toBeDefined();
        expect(typeof entry.description, `${locale}/${key}: "description" must be string`).toBe("string");
      }
    };

    validateEntry("en", enMessages);
    validateEntry("zh_CN", zhCnMessages);
    validateEntry("zh_TW", zhTwMessages);
  });
});
