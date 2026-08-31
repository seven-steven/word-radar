/**
 * Locale invariant tests: ensure en, zh_CN, and zh_TW have identical key sets
 * and that all i18n keys used in code exist in all three locale files.
 *
 * 代码引用的 key 集合从 src 机械推导（review 发现：手工冻结的清单会在新增
 * key 时静默失效，违背 issue #28 用户故事 12「缺 key 在测试层被拦截」）。
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyStaticI18n } from "../src/lib/i18n.js";

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

/**
 * 从 src 机械推导代码引用的全部 i18n key（issue #28 用户故事 12：
 * 缺 key 必须在测试层被拦截，手工清单会随新增 key 静默失效）。
 * 三个来源：t/t1/t2/t3 调用的字符串字面量、popup.html 的 data-i18n、
 * manifest 的 __MSG_*__ 占位符。
 */
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src");

/** 经由联合类型参数动态派发、字面量扫描不可见的 key（renderConfirmPage 的来源措辞）。 */
const DYNAMICALLY_DISPATCHED_KEYS = ["sourceCollect", "sourceImport", "sourceUpload"];

function collectUsedI18nKeys(): Set<string> {
  const keys = new Set<string>();
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|html|json)$/.test(entry.name)) files.push(full);
    }
  };
  walk(SRC_DIR);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\b(?:t|t1|t2|t3)\(\s*"([A-Za-z0-9_]+)"/g)) {
      keys.add(match[1]);
    }
    for (const match of text.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) {
      keys.add(match[1]);
    }
    for (const match of text.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

describe("locale invariants", () => {
  it("en, zh_CN, and zh_TW have identical key sets", () => {
    const enKeys = new Set(Object.keys(enMessages));
    const zhCnKeys = new Set(Object.keys(zhCnMessages));
    const zhTwKeys = new Set(Object.keys(zhTwMessages));

    expect([...enKeys].filter((key) => !zhCnKeys.has(key)), "missing in zh_CN").toHaveLength(0);
    expect([...enKeys].filter((key) => !zhTwKeys.has(key)), "missing in zh_TW").toHaveLength(0);
    expect([...zhCnKeys].filter((key) => !enKeys.has(key)), "zh_CN extra vs en").toHaveLength(0);
    expect([...zhTwKeys].filter((key) => !enKeys.has(key)), "zh_TW extra vs en").toHaveLength(0);
    expect(enKeys.size).toBe(zhCnKeys.size);
    expect(zhCnKeys.size).toBe(zhTwKeys.size);
  });

  it("every i18n key referenced in src exists in all three locales (mechanically derived)", () => {
    const usedKeys = collectUsedI18nKeys();
    // 提取器健全性锁：正则失效（静默扫出 0 个）会让本测试形同虚设
    expect(usedKeys.size).toBeGreaterThanOrEqual(50);

    const enKeys = new Set(Object.keys(enMessages));
    const zhCnKeys = new Set(Object.keys(zhCnMessages));
    const zhTwKeys = new Set(Object.keys(zhTwMessages));

    for (const key of usedKeys) {
      expect(
        enKeys.has(key),
        `Key "${key}" referenced in src but missing in en/messages.json`
      ).toBe(true);
      expect(
        zhCnKeys.has(key),
        `Key "${key}" referenced in src but missing in zh_CN/messages.json`
      ).toBe(true);
      expect(
        zhTwKeys.has(key),
        `Key "${key}" referenced in src but missing in zh_TW/messages.json`
      ).toBe(true);
    }
  });

  it("no stale locale keys: every key not referenced in src is on the dynamic-dispatch allowlist", () => {
    const usedKeys = collectUsedI18nKeys();
    const stale = Object.keys(enMessages).filter(
      (key) => !usedKeys.has(key) && !DYNAMICALLY_DISPATCHED_KEYS.includes(key),
    );
    expect(
      stale,
      `Keys present in locales but unreachable from code (dead translations or update the allowlist): ${stale.join(", ")}`
    ).toHaveLength(0);
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

  it("zh_TW is a verbatim copy of zh_CN (issue #32: 复制简体，不做繁体翻译)", () => {
    // key 集合一致不够——#32 的决策是文案整份复制，任何一侧的单边编辑都该被拦下
    expect(zhTwMessages).toEqual(zhCnMessages);
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

describe("applyStaticI18n", () => {
  /** 最小假 DOM：applyStaticI18n 只依赖 documentElement.setAttribute + querySelectorAll。 */
  function fakeDoc(elements: Array<{ getAttribute: () => string; textContent: string }>) {
    return {
      documentElement: { setAttribute: vi.fn() },
      querySelectorAll: () => elements,
    } as unknown as Document;
  }

  it("backfills data-i18n elements with resolved messages (setup.ts mock reads en)", () => {
    const heading = { getAttribute: () => "popupHeading", textContent: "" };
    const label = { getAttribute: () => "countTotal", textContent: "" };
    applyStaticI18n(fakeDoc([heading, label]));
    expect(heading.textContent).toBe("WordRadar");
    expect(label.textContent).toBe("Total words");
  });

  it("maps html lang to the rendering locale, not the raw UI locale (review finding)", () => {
    const i18n = chrome.i18n as { getUILanguage?: () => string };
    // setup.ts 未 mock getUILanguage → 缺省走 en 兜底（与 default_locale 一致）
    const doc = fakeDoc([]);
    applyStaticI18n(doc);
    expect(doc.documentElement.setAttribute).toHaveBeenCalledWith("lang", "en");

    // zh 系 UI（含 zh-TW/zh-HK）渲染 zh_CN 文案 → lang 声明为 zh-CN
    i18n.getUILanguage = () => "zh-TW";
    try {
      const zhDoc = fakeDoc([]);
      applyStaticI18n(zhDoc);
      expect(zhDoc.documentElement.setAttribute).toHaveBeenCalledWith("lang", "zh-CN");
    } finally {
      delete i18n.getUILanguage;
    }
  });
});
