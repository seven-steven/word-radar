/**
 * Locale invariant tests: ensure en and zh_CN have identical key sets
 * and that all i18n keys used in code exist in both locale files.
 */
import { describe, expect, it } from "vitest";

// Load locale files
const enMessages: Record<string, { message: string; description: string }> =
  await import("../_locales/en/messages.json", {
    assert: { type: "json" },
  }).then((m) => m.default);

const zhMessages: Record<string, { message: string; description: string }> =
  await import("../_locales/zh_CN/messages.json", {
    assert: { type: "json" },
  }).then((m) => m.default);

describe("locale invariants", () => {
  it("en and zh_CN have identical key sets", () => {
    const enKeys = new Set(Object.keys(enMessages));
    const zhKeys = new Set(Object.keys(zhMessages));

    // Keys in English but not in Chinese
    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key));
    // Keys in Chinese but not in English
    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key));

    expect(
      missingInZh,
      `Keys missing in zh_CN: ${missingInZh.join(", ")}`
    ).toHaveLength(0);

    expect(
      missingInEn,
      `Keys missing in en: ${missingInEn.join(", ")}`
    ).toHaveLength(0);

    // Total key counts should match
    expect(enKeys.size).toBe(zhKeys.size);
  });

  it("all keys used in code exist in both locales", () => {
    // These are all the i18n keys used throughout the codebase
    // (extracted from grep analysis of t(), t1(), t2(), t3(), t4() calls)
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
    const zhKeys = new Set(Object.keys(zhMessages));

    for (const key of usedKeys) {
      expect(
        enKeys.has(key),
        `Key "${key}" used in code but missing in en/messages.json`
      ).toBe(true);

      expect(
        zhKeys.has(key),
        `Key "${key}" used in code but missing in zh_CN/messages.json`
      ).toBe(true);
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
    validateEntry("zh_CN", zhMessages);
  });
});
