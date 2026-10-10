import { describe, expect, it } from "vitest";
import {
  extractWordEntries,
  tokenize,
  type ExtractOptions,
} from "../src/extract.js";
import { isEnglishWord } from "../src/predicate.js";

/** 空黑名单：机制测试与真实黑名单数据隔离（spec：不依赖真实数据文件）。 */
const EMPTY_BLACKLIST = new Set<string>();

/** 便捷：只取 lemma 列表（机制测试用，注入空黑名单保持数据无关）。 */
function lemmas(text: string): string[] {
  return extractWordEntries(text, {
    abbreviationBlacklist: EMPTY_BLACKLIST,
  }).entries.map((e) => e.lemma);
}

/** 测试注入的固定黑名单（不依赖 blacklist.ts 真实内容）。 */
const TEST_BLACKLIST = new Set(["md", "doc", "stat"]);

/** 注入固定黑名单的提取（其余开关沿用默认）。 */
function extractWithBlacklist(text: string, options?: ExtractOptions) {
  return extractWordEntries(text, {
    ...options,
    abbreviationBlacklist: TEST_BLACKLIST,
  });
}

describe("tokenize", () => {
  it("keeps URL as one candidate, not three words", () => {
    expect(tokenize("see https://example.com/foo now")).toEqual([
      "see",
      "https://example.com/foo",
      "now",
    ]);
  });

  it("keeps email, path and identifiers as single candidates", () => {
    expect(tokenize("a foo@example.com b src/components/App.tsx c")).toEqual([
      "a",
      "foo@example.com",
      "b",
      "src/components/App.tsx",
      "c",
    ]);
  });

  it("trims trailing punctuation like sentence periods", () => {
    expect(tokenize("word. don't' well-known--")).toEqual([
      "word",
      "don't",
      "well-known",
    ]);
  });
});

describe("isEnglishWord", () => {
  it.each([
    ["don't", true],
    ["well-known", true],
    ["mother-in-law", true],
    ["https://example.com/foo", false],
    ["foo@example.com", false],
    ["src/components/App.tsx", false],
    ["snake_case", false],
    ["camelCase", false],
    ["PascalCase", false],
    ["$scope", false],
    ["v2", false],
    ["42", false],
    ["XMLHttpRequest", false],
  ])("%s → %s", (token, expected) => {
    expect(isEnglishWord(token)).toBe(expected);
  });
});

describe("extractWordEntries", () => {
  it("filters contractions and strips possessives under default switches", () => {
    const out = extractWordEntries(
      "He said don't panic; it's a well-known fact.",
      { abbreviationBlacklist: EMPTY_BLACKLIST },
    );
    expect(out.entries.map((e) => e.lemma)).toEqual([
      "he",
      "say",
      "panic",
      "it",
      "a",
      "well-known",
      "fact",
    ]);
    expect(out.filteredCount).toBe(1); // don't
  });

  it("rejects URL, email, path, snake/camel/Pascal, $scope, v2", () => {
    const out = lemmas(
      "Visit https://example.com/foo or mail foo@example.com; " +
        "see src/components/App.tsx, snake_case, camelCase, PascalCase, " +
        "$scope and v2 for details.",
    );
    for (const bad of [
      "https://example.com/foo",
      "https",
      "example",
      "com",
      "foo@example.com",
      "src/components/app.tsx",
      "src",
      "tsx",
      "snake_case",
      "camelcase",
      "pascalcase",
      "$scope",
      "scope",
      "v2",
    ]) {
      expect(out).not.toContain(bad);
    }
    expect(out).toContain("visit");
    expect(out).toContain("detail");
  });

  it("NFKC normalizes curly quotes and unicode hyphens", () => {
    const curly = extractWordEntries("It’s a well–known “fact”.", {
      abbreviationBlacklist: EMPTY_BLACKLIST,
    });
    const straight = extractWordEntries("It's a well-known \"fact\".", {
      abbreviationBlacklist: EMPTY_BLACKLIST,
    });
    expect(curly.entries).toEqual(straight.entries);
    const words = curly.entries.map((e) => e.lemma);
    expect(words).toContain("it"); // it's → 所有格剥离归一化
    expect(words).toContain("well-known");
  });

  it("returns {lemma, flags:0} entries deduplicated by lemma", () => {
    const entries = extractWordEntries("Run run RUN Runs runs", {
      abbreviationBlacklist: EMPTY_BLACKLIST,
    }).entries;
    expect(entries).toEqual([{ lemma: "run", flags: 0 }]);
  });

  it("lemmatizes verbs and aggregates by lemma (running/runs/ran → run)", () => {
    expect(lemmas("Running ran runs")).toEqual(["run"]);
    expect(lemmas("running runs")).toEqual(["run"]);
  });

  it("handles empty input", () => {
    expect(extractWordEntries("").entries).toEqual([]);
    expect(extractWordEntries("").filteredCount).toBe(0);
    expect(extractWordEntries("12345 !!! ...").entries).toEqual([]);
  });

  it("dirty mixed-text end-to-end case", () => {
    const dirty =
      "The React app (v2) renders <div/> via https://react.dev/learn — " +
      "contact jane.doe@corp.io or edit src/utils/parse.ts. " +
      "Watch out for NULL_PTR in fetchData($scope), " +
      "but don't worry: it’s a well-known issue affecting 3000 seafarers. " +
      "Visit www.example.com for more.";
    const out = extractWordEntries(dirty);
    const words = out.entries.map((e) => e.lemma);
    for (const bad of [
      "v2",
      "https://react.dev/learn",
      "www.example.com",
      "jane.doe@corp.io",
      "src/utils/parse.ts",
      "null_ptr",
      "fetchdata",
      "$scope",
      "scope",
      "3000",
      "don't",
    ]) {
      expect(words).not.toContain(bad);
    }
    expect(words).toContain("the");
    expect(words).toContain("it"); // it’s → 所有格剥离归一化
    expect(words).toContain("well-known");
    expect(words).toContain("seafarer"); // seafarers → 复数还原
    // all flags zero
    expect(out.entries.every((e) => e.flags === 0)).toBe(true);
    // deduplicated
    expect(new Set(words).size).toBe(words.length);
    // 缩合过滤至少拦下 don't；真实黑名单还会拦其它内容词（数据演进不定，
    // 精确计数由下方注入固定黑名单的专项用例覆盖），故只断下限。
    expect(out.filteredCount).toBeGreaterThanOrEqual(1);
  });
});

describe("issue #56 归一化：所有格剥离大小写不敏感 + 全大写折叠采集", () => {
  it("dog'S 剥离为大写不敏感所有格：采集 dog、不误计 filteredCount", () => {
    const out = extractWithBlacklist("the dog'S bone");
    expect(out.entries.map((e) => e.lemma)).toEqual(["the", "dog", "bone"]);
    expect(out.filteredCount).toBe(0);
  });

  it("filterContractions:false 时 dog'S 也不产生伪 lemma（dog's 不入库）", () => {
    const out = extractWithBlacklist("the dog'S bone", { filterContractions: false });
    const words = out.entries.map((e) => e.lemma);
    expect(words).toContain("dog");
    expect(words).not.toContain("dog's");
  });

  it("全大写词形按小写形继续管线（THE→the、FOX→fox、JUMPS→jump）", () => {
    const out = extractWithBlacklist(
      "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG",
    );
    expect(out.entries.map((e) => e.lemma)).toEqual([
      "the",
      "quick",
      "brown",
      "fox",
      "jump",
      "over",
      "lazy",
      "dog",
    ]);
  });

  it("全大写仍过原始大小写的专名检查：LONDON 被排除；缩略词 BBC 先走黑名单拦截（计数）", () => {
    // compromise 把 BBC 判为 #ProperNoun——缩略词黑名单判据必须先于专名
    // 排除给全大写词机会（CONTEXT「大小写折叠」：黑名单照常拦截），否则
    // FBI/NASA/BBC 类缩略词全部零反馈死于专名排除。
    const out = extractWordEntries("Visit LONDON and BBC with FOX.", {
      abbreviationBlacklist: new Set(["bbc"]),
    });
    expect(out.entries.map((e) => e.lemma)).toEqual(["visit", "and", "with", "fox"]);
    expect(out.filteredCount).toBe(1); // bbc
  });

  it("PASCAL 判定只拒混合大小写：全大写放行、GitHub/XMLHttpRequest 仍拒", () => {
    expect(isEnglishWord("LONDON")).toBe(true);
    expect(isEnglishWord("THE")).toBe(true);
    expect(isEnglishWord("FOX")).toBe(true);
    expect(isEnglishWord("GitHub")).toBe(false);
    expect(isEnglishWord("XMLHttpRequest")).toBe(false);
    expect(isEnglishWord("Running")).toBe(true); // 句首普通词不受影响
    expect(isEnglishWord("PascalCase")).toBe(false); // 既有拒绝语义保持
  });
});

describe("extraction filtering (ADR-0002)", () => {
  it("filters blacklisted lemmas after lemmatization (docs → doc)", () => {
    const out = extractWithBlacklist("The md file and the docs describe each doc.");
    const words = out.entries.map((e) => e.lemma);
    expect(words).not.toContain("md");
    expect(words).not.toContain("doc");
    expect(words).not.toContain("docs");
    expect(words).toContain("file");
    expect(words).toContain("describe");
    // md + docs(doc) + doc 去重后 = {md, doc}
    expect(out.filteredCount).toBe(2);
  });

  it("does not filter derived words: exact match only", () => {
    // statistical 词形还原后仍是 statistical，精确匹配不命中 stat。
    const out = extractWithBlacklist("statistical stats stat");
    const words = out.entries.map((e) => e.lemma);
    expect(words).toEqual(["statistical"]);
    // stats→stat 与 stat 同 lemma，去重后只计 1
    expect(out.filteredCount).toBe(1);
  });

  it("filters contractions and counts them", () => {
    const out = extractWithBlacklist("You've said don't panic; they aren't here.");
    const words = out.entries.map((e) => e.lemma);
    expect(words).toEqual(["say", "panic", "they", "here"]);
    expect(out.filteredCount).toBe(3); // you've / don't / aren't
  });

  it("lets apostrophe-free and possessive words through", () => {
    const out = extractWithBlacklist("serendipity's dog's bone and a well-known monorepo");
    expect(out.entries.map((e) => e.lemma)).toEqual([
      "serendipity",
      "dog",
      "bone",
      "and",
      "a",
      "well-known",
      "monorepo",
    ]);
    expect(out.filteredCount).toBe(0);
  });

  it("dedupes filteredCount by lemma and stacks across categories", () => {
    const out = extractWithBlacklist("Docs docs DOC you've you've");
    expect(out.entries).toEqual([]);
    expect(out.filteredCount).toBe(2); // {doc} + {you've}
  });

  it("filterAbbreviations:false releases blacklist hits but still filters contractions", () => {
    const out = extractWithBlacklist("The md and docs; you've gone.", {
      filterAbbreviations: false,
    });
    const words = out.entries.map((e) => e.lemma);
    expect(words).toContain("md");
    expect(words).toContain("doc");
    expect(words).toContain("go"); // gone → 不规则动词还原
    expect(words).not.toContain("you've");
    expect(out.filteredCount).toBe(1); // you've
  });

  it("filterContractions:false releases contractions but still filters abbreviations", () => {
    const out = extractWithBlacklist("You've aren't md docs", {
      filterContractions: false,
    });
    const words = out.entries.map((e) => e.lemma);
    // 保留撇号原形：lemmatizeWord 对含撇号词直接小写
    expect(words).toContain("you've");
    expect(words).toContain("aren't");
    expect(words).not.toContain("md");
    expect(words).not.toContain("doc");
    expect(out.filteredCount).toBe(2); // {md, doc}
  });

  it("both switches off releases everything, possessive stripping still applies", () => {
    const out = extractWithBlacklist("md docs you've aren't the dog's bone", {
      filterAbbreviations: false,
      filterContractions: false,
    });
    expect(out.entries.map((e) => e.lemma)).toEqual([
      "md",
      "doc",
      "you've",
      "aren't",
      "the",
      "dog",
      "bone",
    ]);
    expect(out.filteredCount).toBe(0);
  });

  it("bare possessive leaves no apostrophe residue", () => {
    // 裸 's 在 tokenize 层即落成单字母残枝 "s"（撇号非候选起始字符，既有行为），
    // 剥离空防御分支（token 恰为 's → 丢）在管线内保留，当前外部输入不可达。
    // 注入空黑名单：意图是剥离守卫，与黑名单数据无关（"s" 恰为真实黑名单成员）。
    const out = extractWordEntries("'s", {
      abbreviationBlacklist: EMPTY_BLACKLIST,
    });
    expect(out.entries.map((e) => e.lemma)).toEqual(["s"]);
    expect(out.filteredCount).toBe(0);
  });

  it("o'clock meets proper-noun exclusion first, contraction filter second", () => {
    // 默认开关：compromise 把 o'clock 判为专名，先走专名排除，不计数。
    const byProper = extractWithBlacklist("o'clock");
    expect(byProper.entries).toEqual([]);
    expect(byProper.filteredCount).toBe(0);
    // 关闭专名排除后 o'clock 到达缩合判定，被拦并计数。
    const byContraction = extractWithBlacklist("o'clock", {
      excludeProperNouns: false,
    });
    expect(byContraction.entries).toEqual([]);
    expect(byContraction.filteredCount).toBe(1);
  });
});
