import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { verifyManifest } from "../../../scripts/verify-manifest.mjs";
import { readZipEntry } from "../../../scripts/verify-zip.mjs";

// verifyManifest 是纯函数：src locale 载荷经 srcLocales 注入，不触文件系统。
// 仅 zip 侧在函数内用 readZipEntry 解析内存 zip buffer，mock 它注入 zip 内容。
vi.mock("../../../scripts/verify-zip.mjs", () => ({
  readZipEntry: vi.fn(),
}));

const validManifest = {
  manifest_version: 3,
  name: "__MSG_extName__",
  version: "0.1.0",
  description: "__MSG_extDescription__",
  action: { default_popup: "src/popup.html", default_title: "__MSG_extTooltip__" },
  background: { service_worker: "src/background.ts" },
  icons: {
    "16": "src/assets/icons/icon-16.png",
    "48": "src/assets/icons/icon-48.png",
    "128": "src/assets/icons/icon-128.png",
  },
  default_locale: "en",
};

const validMessages = {
  extName: { message: "WordRadar", description: "" },
  extDescription: { message: "Extract English words from web pages", description: "" },
  extTooltip: { message: "WordRadar", description: "" },
};

// main() 读文件后构造的 locale 装载结果：{ messages } 成功 / { error } 失败原因
const validSrcLocales = {
  en: { messages: validMessages },
  zh_CN: { messages: validMessages },
  zh_TW: { messages: validMessages },
};

const zhMessages = {
  extName: { message: "单词雷达", description: "" },
  extDescription: { message: "把网页里的英文生词一键提取出来", description: "" },
  extTooltip: { message: "单词雷达", description: "" },
};

describe("verify-manifest: verifyManifest", () => {
  beforeEach(() => {
    vi.mocked(readZipEntry).mockReturnValue(Buffer.from(JSON.stringify(validMessages)));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("success path", () => {
    it("returns ok when all three versions agree and manifest is MV3-shaped", () => {
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: validManifest,
        srcLocales: validSrcLocales,
      });
      expect(result).toEqual({ ok: true, errors: [] });
    });

    it("returns error when the zip manifest is missing (提示先 build/package)", () => {
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: null,
        srcLocales: validSrcLocales,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /build|package/i.test(e))).toBe(true);
    });
  });

  describe("i18n structure", () => {
    it("passes when manifest uses __MSG_*__ placeholders for i18n fields, default_locale is en, and both locales exist", () => {
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: validManifest,
        srcLocales: validSrcLocales,
      });
      expect(result).toEqual({ ok: true, errors: [] });
    });

    it("fails when manifest name is not an i18n placeholder", () => {
      const i18nManifest = {
        ...validManifest,
        name: "WordRadar",
      };

      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: i18nManifest,
        zipManifest: i18nManifest,
        srcLocales: validSrcLocales,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /name.*__MSG_/i.test(e))).toBe(true);
    });

    it("fails when manifest description is not an i18n placeholder", () => {
      const i18nManifest = {
        ...validManifest,
        description: "Not a placeholder",
      };

      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: i18nManifest,
        zipManifest: i18nManifest,
        srcLocales: validSrcLocales,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /description.*__MSG_/i.test(e))).toBe(true);
    });

    it("fails when action.default_title is not an i18n placeholder", () => {
      const i18nManifest = {
        ...validManifest,
        action: { ...validManifest.action, default_title: "Not a placeholder" },
      };

      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: i18nManifest,
        zipManifest: i18nManifest,
        srcLocales: validSrcLocales,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /default_title.*__MSG_/i.test(e))).toBe(true);
    });

    it("fails when default_locale is not 'en'", () => {
      const i18nManifest = {
        ...validManifest,
        default_locale: "zh_CN",
      };

      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: i18nManifest,
        zipManifest: i18nManifest,
        srcLocales: validSrcLocales,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /default_locale.*en/i.test(e))).toBe(true);
    });

    it("fails when _locales file is missing (srcLocales 未提供该 locale)", () => {
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: validManifest,
        srcLocales: {},
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /_locales.*missing/i.test(e))).toBe(true);
    });

    it("fails when a locale file failed to load (srcLocales 带 error 装载结果)", () => {
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: validManifest,
        srcLocales: {
          ...validSrcLocales,
          zh_TW: { error: 'failed to parse zh_TW/messages.json - Unexpected token "z"' },
        },
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /_locales.*failed to parse zh_TW/i.test(e))).toBe(true);
    });

    it("fails when message key is missing from locale file", () => {
      const incomplete = {
        extName: validMessages.extName,
        // Missing extDescription key
        extTooltip: validMessages.extTooltip,
      };

      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: validManifest,
        srcLocales: {
          en: { messages: incomplete },
          zh_CN: { messages: incomplete },
          zh_TW: { messages: incomplete },
        },
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /missing key.*extDescription/i.test(e))).toBe(true);
    });

    it("fails when key sets differ between locales", () => {
      const withoutTooltip = {
        extName: zhMessages.extName,
        extDescription: zhMessages.extDescription,
        // Missing extTooltip
      };

      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: validManifest,
        srcLocales: {
          en: { messages: validMessages },
          zh_CN: { messages: withoutTooltip },
          zh_TW: { messages: zhMessages },
        },
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /extTooltip/.test(e))).toBe(true);
    });

    it("fails when ZIP missing _locales locale file", () => {
      const mockZipBuffer = Buffer.from("fake zip content");

      vi.mocked(readZipEntry).mockImplementation((zipBuf, path) => {
        const pathStr = String(path);
        if (pathStr.includes("_locales")) {
          throw new Error(`zip entry not found: ${pathStr}`);
        }
        return Buffer.from('{"version": "0.1.0"}');
      });

      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: validManifest,
        srcLocales: validSrcLocales,
        zipBuffer: mockZipBuffer,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /zip _locales.*error/i.test(e))).toBe(true);
    });

    it("fails when ZIP locale file is missing a manifest-referenced key", () => {
      const mockZipBuffer = Buffer.from("fake zip content");

      vi.mocked(readZipEntry).mockImplementation((zipBuf, path) => {
        const pathStr = String(path);
        if (pathStr.includes("zh_CN")) {
          return Buffer.from(JSON.stringify({ extName: validMessages.extName, extTooltip: validMessages.extTooltip }));
        }
        return Buffer.from(JSON.stringify(validMessages));
      });

      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        zipManifest: validManifest,
        srcLocales: validSrcLocales,
        zipBuffer: mockZipBuffer,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /zip _locales.*missing key.*extDescription/i.test(e))).toBe(true);
    });
  });

  describe("version mismatch", () => {
    it("fails when root package.json version differs from src manifest", () => {
      const result = verifyManifest({
        rootVersion: "0.2.0",
        srcManifest: { ...validManifest, version: "0.1.0" },
        zipManifest: { ...validManifest, version: "0.1.0" },
        srcLocales: validSrcLocales,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /0\.2\.0.*0\.1\.0/.test(e))).toBe(true);
    });

    it("fails when src manifest and zip manifest versions differ", () => {
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: { ...validManifest, version: "0.1.0" },
        zipManifest: { ...validManifest, version: "0.3.0" },
        srcLocales: validSrcLocales,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("0.1.0") && e.includes("0.3.0"))).toBe(true);
    });
  });

  describe("MV3 shape failures", () => {
    it("fails when manifest_version is not 3", () => {
      const m = { ...validManifest, manifest_version: 2 };
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: m, zipManifest: m, srcLocales: validSrcLocales });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /manifest_version/.test(e))).toBe(true);
    });

    it("fails when name is missing", () => {
      const m = { ...validManifest } as Record<string, unknown>;
      delete m.name;
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: m, zipManifest: validManifest, srcLocales: validSrcLocales });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /name/.test(e))).toBe(true);
    });

    it("fails when action.default_popup is missing", () => {
      const m = { ...validManifest, action: {} };
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: validManifest, zipManifest: m, srcLocales: validSrcLocales });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /default_popup/.test(e))).toBe(true);
    });

    it("fails when background.service_worker is missing", () => {
      const m = { ...validManifest, background: {} };
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: validManifest, zipManifest: m, srcLocales: validSrcLocales });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /service_worker/.test(e))).toBe(true);
    });

    it("fails when an icon size is missing", () => {
      const m = { ...validManifest, icons: { "16": "a.png", "48": "b.png" } };
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: validManifest, zipManifest: m, srcLocales: validSrcLocales });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /128/.test(e))).toBe(true);
    });
  });
});

describe("verify-manifest: CLI 直跑守卫（import 不触发 main）", () => {
  it("importing the module does not call process.exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called on import");
    }) as never);
    try {
      await import("../../../scripts/verify-manifest.mjs");
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});
