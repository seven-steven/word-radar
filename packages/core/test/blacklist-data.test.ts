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

  it("keeps everyday content words out of the blacklist (issue #49 fox false-kill, guard raised to top-5000)", () => {
    // fox@Norvig3222：v2.2 提界前守卫上限 top-1400 圈外，Wiktionary 缩略族
    // 定义行（"fox." 处方拉丁缩写义等）带入榜误杀；pass@1493/cat@1760 为
    // 提界后构造性覆盖的同批样本；dog@1047 一直在守卫圈内。
    // wolf@5073/hound@16452 在 top-5000 界外（GUARD_TOP_MAX 钉死，再大会误保
    // app@5355 类高频真缩略词）——守卫不覆盖，本断言兜底监测：再生成后若
    // Wiktionary 数据漂移带入榜，这里先红。
    for (const word of ["fox", "cat", "pass", "dog", "wolf", "hound"]) {
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

  it("v3 lowercase-page veto removed everyday-word false kills (issue #51 修复回归守卫)", () => {
    // sad 类真词只有全大写缩写变体页（SAD）入类目，v2.1 小写否决不可达而
    // 静默误杀；v3（2026-10-10）主动拉小写词条页，reason==="mixed"（词条
    // 真实存在且混合词义）即否决。样本取自分桶报告误杀榜（含终裁翻案词
    // til/fg/das——til 是古英语独立存活词形而非 until 截短）。
    for (const word of ["sad", "silent", "egg", "wash", "juice", "steam", "eve", "til", "fg", "das"]) {
      expect(ABBREVIATION_BLACKLIST.has(word), `everyday false-kill survived: "${word}"`).toBe(false);
    }
    // 真缩写留存：小写形无独立词条（redirect / no-english）或大小写变体页
    // （alt case / alternative form of 指向大写缩写词条——身份传递）不构成
    // 否决。不钉的已知出榜项（判据 proxy 粗糙面，大写形态由专名排除兜底）：
    // nato（小写页含口语化行）、asap/aka（词汇化）、hrs（plural of 模板
    // 目标身份不可判定）、tvs（lemma→tv 死条目，剔除无损失）。
    for (const word of ["fbi", "ssl", "rpm", "img", "dns", "gpu", "ssd"]) {
      expect(ABBREVIATION_BLACKLIST.has(word), `true abbreviation lost: "${word}"`).toBe(true);
    }
    // 词汇化边界家族留榜（纯度线射程外，判据分歧留 grilling）：
    // sim/sync 小写页全义标 clipping（pure）；turbo 小写页半缩略（占比过线）
    for (const word of ["sim", "sync", "turbo"]) {
      expect(ABBREVIATION_BLACKLIST.has(word), `lexicalized clip unexpectedly removed: "${word}"`).toBe(true);
    }
  });

  it("seeds well-known initialisms the guard mis-passed (2026-10-10 grilling C1-i+C2)", () => {
    // Norvig top-5000 守卫无法区分「高频真词」与「高频真缩写」，这批知名
    // initialism 从未进榜：css/gps 误放后经 toSingular 剥尾 s 产出伪词 cs/gp
    // 入库（管线守卫另修，见 lemma 测试）；bbc/nasa/usa 补齐后与 fbi 统一走
    // 计数拦截（原先靠 compromise 专名判定的零反馈排除，口径不一）。
    // 与 v3 出榜的词汇化缩写（asap/aka/cpu/usb/pdf…，A2 认出榜）划清界限：
    // 本批是从未进榜的漏收，不是回捞。
    for (const word of ["css", "gps", "bbc", "nasa", "usa", "html", "api", "sql", "url", "ceo"]) {
      expect(ABBREVIATION_BLACKLIST.has(word), `seed initialism missing: "${word}"`).toBe(true);
    }
    // 管线级（含 #56 大小写折叠链）：全大写 CSS/GPS 过黑名单预查计数拦截，
    // 不再入库为剥尾 s 伪词 cs/gp；NASA 与 FBI 同口径计数拦截。
    // 高频功能词（and/the）明确不过滤（ADR-0002），uses 还原为 use。
    const out = extractWordEntries("NASA uses CSS and GPS like the FBI does", {
      excludeProperNouns: true,
    });
    expect(out.filteredCount).toBe(4);
    expect(out.entries.map((e) => e.lemma)).toEqual(["use", "and", "like", "the", "do"]);
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
    // 种子豁免（2026-10-10 grilling C1-i+C2）：usa@361/url@798/html@975 是
    // top-1000 内的人工裁决种子（scripts/build-blacklist.mjs SEED_WORDS）——
    // 拦截是裁决结果而非误杀，与 build 侧 guardExempt 同语义。
    const SEEDS_IN_TOP_1000 = new Set(["usa", "url", "html"]);
    const blocked: string[] = [];
    for (const word of fixtureWords) {
      if (SEEDS_IN_TOP_1000.has(word)) continue;
      const out = extractWordEntries(word, { excludeProperNouns: false });
      if (out.filteredCount > 0 || out.entries.length === 0) blocked.push(word);
    }
    expect(blocked).toEqual([]);
  }, 300_000);
});
