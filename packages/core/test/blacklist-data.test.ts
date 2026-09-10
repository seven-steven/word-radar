import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ABBREVIATION_BLACKLIST } from "../src/blacklist.js";
import { extractWordEntries } from "../src/extract.js";

/**
 * 黑名单数据验收（第二道防线，校验已提交产物本身；
 * 第一道是构建脚本 scripts/build-blacklist.mjs 生成时的自检断言）。
 * 验收线见 docs/adr/0002-word-intake-filter-blacklist.md：
 * md/doc/stat 命中，serendipity/monorepo 放行，闭类高频词零误杀。
 * v2 增加管线级回归守卫：Norvig top-1000 高频词过真实提取管线必须零过滤。
 */
describe("ABBREVIATION_BLACKLIST data", () => {
  it("hits the acceptance-line abbreviation targets (seed, clipping, abbreviation channels)", () => {
    expect(ABBREVIATION_BLACKLIST.has("md")).toBe(true); // 手工种子（埃及语转写通道漏网）
    expect(ABBREVIATION_BLACKLIST.has("doc")).toBe(true); // clipping 通道 + 定义行纯度过滤
    expect(ABBREVIATION_BLACKLIST.has("stat")).toBe(true); // clipping/缩写通道 + 定义行纯度过滤
  });

  it("does not hit formal rare words (anti over-blocking regression)", () => {
    expect(ABBREVIATION_BLACKLIST.has("serendipity")).toBe(false);
    expect(ABBREVIATION_BLACKLIST.has("monorepo")).toBe(false);
  });

  it("rescues everyday words whose all-caps homograph pages cannot vouch for them (lowercase-real-word-page veto, v2.1)", () => {
    // cat: 来源 {cat, CAT}——小写真词页 7/78 未过纯度线，全大写 CAT 页(18/23)
    // 不得为其担保（2026-09-10 裁决）；van/pet 为同批被救的守卫外日常词样本。
    for (const word of ["cat", "van", "pet"]) {
      expect(ABBREVIATION_BLACKLIST.has(word), `everyday word leaked: "${word}"`).toBe(false);
    }
  });

  it("excludes closed-class function words (guard-table sample, anti high-frequency false kill)", () => {
    const guardSample = [
      "is", "am", "no", "why", "by", "the", "she", "may", "will", "can",
    ];
    for (const word of guardSample) {
      expect(ABBREVIATION_BLACKLIST.has(word), `guard word leaked: "${word}"`).toBe(false);
    }
  });

  it("contains only lowercase pure-letter single tokens (matching semantics: post-lemmatization exact match)", () => {
    const invalid = [...ABBREVIATION_BLACKLIST].filter((word) => !/^[a-z]+$/.test(word));
    expect(invalid).toEqual([]);
  });

  it("is a substantial dataset, not a truncated or empty artifact", () => {
    expect(ABBREVIATION_BLACKLIST.size).toBeGreaterThanOrEqual(1000);
  });

  it("keeps every Norvig top-1000 word unfiltered by the abbreviation blacklist (anti high-frequency false kill tripwire)", () => {
    const fixtureWords = readFileSync(
      fileURLToPath(new URL("./fixtures/top-words-1000.txt", import.meta.url)),
      "utf8",
    )
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(fixtureWords.length).toBeGreaterThanOrEqual(1000);

    // excludeProperNouns:false 隔离黑名单维度——fixture 全是纯字母词（无缩合形式、
    // 不触发专名排除与 URL/数字形态拒绝），词形还原后唯一可能的丢弃源是黑名单命中。
    // 默认选项下 compromise 会把 ebay/john/canada 等专名排除（那是专名排除维度的
    // 职责，有自己的测试），不能与黑名单误杀混在一起断言。
    const blocked: string[] = [];
    for (const word of fixtureWords) {
      const out = extractWordEntries(word, { excludeProperNouns: false });
      if (out.filteredCount > 0 || out.entries.length === 0) blocked.push(word);
    }
    expect(blocked).toEqual([]);
  }, 300_000);
});
