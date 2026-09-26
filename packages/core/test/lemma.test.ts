import { describe, expect, it } from "vitest";
import { extractWordEntries, isProperNoun, lemmatizeWord } from "../src/index.js";

/** 空黑名单：机制测试与真实黑名单数据隔离（spec：不依赖真实数据文件）。 */
const EMPTY_BLACKLIST = new Set<string>();

/** 便捷：只取 lemma 列表（注入空黑名单，本文件测的是还原/专名机制而非黑名单）。 */
function lemmas(text: string): string[] {
  return extractWordEntries(text, {
    abbreviationBlacklist: EMPTY_BLACKLIST,
  }).entries.map((e) => e.lemma);
}

describe("lemmatizeWord", () => {
  it("aggregates running/ran/runs into run", () => {
    expect(lemmas("Running ran runs")).toEqual(["run"]);
  });

  it("lemmatizes regular verbs to infinitive", () => {
    expect(lemmatizeWord("walked")).toBe("walk");
    expect(lemmatizeWord("walking")).toBe("walk");
    expect(lemmatizeWord("studies")).toBe("study");
  });

  it("covers common irregular verbs", () => {
    expect(lemmatizeWord("went")).toBe("go");
    expect(lemmatizeWord("took")).toBe("take");
    expect(lemmatizeWord("saw")).toBe("see");
    expect(lemmatizeWord("was")).toBe("be");
    expect(lemmatizeWord("had")).toBe("have");
    expect(lemmatizeWord("made")).toBe("make");
    expect(lemmatizeWord("thought")).toBe("think");
    expect(lemmatizeWord("knew")).toBe("know");
  });

  it("singularizes plural nouns", () => {
    expect(lemmatizeWord("cats")).toBe("cat");
    expect(lemmatizeWord("boxes")).toBe("box");
    expect(lemmatizeWord("knives")).toBe("knife");
    expect(lemmatizeWord("studies")).toBe("study");
  });

  it("keeps contractions and hyphenated words as-is (lowercased)", () => {
    expect(lemmatizeWord("don't")).toBe("don't");
    expect(lemmatizeWord("well-known")).toBe("well-known");
  });

  it("falls back to the lowercased word when no reliable lemma is found", () => {
    expect(lemmatizeWord("xylophone")).toBe("xylophone");
  });
});

describe("issue #48 lemma distortion regression (dictionary-gated lemmatization)", () => {
  it("keeps common -ve words as themselves (fixF no longer fabricates -fe)", () => {
    expect(lemmatizeWord("active")).toBe("active");
    expect(lemmatizeWord("give")).toBe("give");
    expect(lemmatizeWord("love")).toBe("love");
    expect(lemmatizeWord("have")).toBe("have");
    expect(lemmatizeWord("solve")).toBe("solve");
    expect(lemmatizeWord("serve")).toBe("serve");
    expect(lemmatizeWord("negative")).toBe("negative");
    expect(lemmatizeWord("thrive")).toBe("thrive");
  });

  it("reduces inflected -ve words to their correct lemma", () => {
    expect(lemmatizeWord("survived")).toBe("survive");
  });

  it("does not strip a trailing s into a non-word (this → this)", () => {
    expect(lemmatizeWord("this")).toBe("this");
  });

  it("keeps the knives → knife rescue as a positive control", () => {
    expect(lemmatizeWord("knives")).toBe("knife");
  });

  it("pipeline level: issue reproduction sentence yields real-word lemmas", () => {
    expect(
      lemmas("this active survived negative thrive give love have solve serve"),
    ).toEqual([
      "this",
      "active",
      "survive",
      "negative",
      "thrive",
      "give",
      "love",
      "have",
      "solve",
      "serve",
    ]);
  });

  it("zero behavior change for words outside the dictionary excerpt (anti over-blocking)", () => {
    // serendipity 不在 Norvig top-20000 截选（count_1w 排名 29310 > 20000）：
    // 还原输出与原词形都不在词典 → 必须保持既有还原输出，不许丢弃或改写。
    expect(lemmatizeWord("serendipity")).toBe("serendipity");
  });

  it("blacklist matching keeps exact-lemma semantics (docs → doc still filtered)", () => {
    // 若守门把 docs 回退成原词形 docs，精确匹配会漏掉 {doc}——此用例锁死该回归。
    const out = extractWordEntries("docs", {
      abbreviationBlacklist: new Set(["doc"]),
    });
    expect(out.entries).toEqual([]);
    expect(out.filteredCount).toBe(1);
  });
});

describe("issue #50 pyjamas→pyjamave regression (Latin -as→-ave negative heuristic)", () => {
  it("keeps -as words as themselves instead of fabricated -ave infinitives", () => {
    // compromise 把 -as 结尾词误判为动词三单后套拉丁式 -as→-ave 规则
    // （pyjamave 类伪词）。真实英语变位只有 -ave→-aves 与 has→have
    // （后者由不规则表前置拦截，不进 finalize），故此负启发零误伤。
    expect(lemmatizeWord("pyjamas")).toBe("pyjamas");
    expect(lemmatizeWord("pajamas")).toBe("pajamas");
  });

  it("rescues plural -as nouns misread as verbs (scan-verified wider blast radius)", () => {
    // 2026-09-26 Norvig -as 词全量扫描：top-20000 复数排名外的 -as 复数
    // 同样中招（动词出口先于名词出口短路 + 双冷僻放行）。
    expect(lemmatizeWord("arenas")).toBe("arenas");
    expect(lemmatizeWord("umbrellas")).toBe("umbrellas");
    expect(lemmatizeWord("pizzas")).toBe("pizzas");
    expect(lemmatizeWord("orchestras")).toBe("orchestras");
  });

  it("keeps legitimate -as words and the has→have path intact", () => {
    expect(lemmatizeWord("canvas")).toBe("canvas");
    expect(lemmatizeWord("alias")).toBe("alias");
    expect(lemmatizeWord("has")).toBe("have");
  });
});

describe("proper noun exclusion", () => {
  it("excludes proper nouns by default", () => {
    expect(isProperNoun("Alice")).toBe(true);
    expect(isProperNoun("London")).toBe(true);
    const out = lemmas("Alice and Bob visited London yesterday");
    expect(out).not.toContain("alice");
    expect(out).not.toContain("bob");
    expect(out).not.toContain("london");
    expect(out).toContain("visit");
    expect(out).toContain("yesterday");
  });

  it("keeps proper nouns when excludeProperNouns is false", () => {
    const out = extractWordEntries("Alice visited London", {
      excludeProperNouns: false,
      abbreviationBlacklist: EMPTY_BLACKLIST,
    }).entries.map((e) => e.lemma);
    expect(out).toContain("alice");
    expect(out).toContain("london");
    expect(out).toContain("visit");
  });

  it("does not treat sentence-initial common words as proper nouns", () => {
    const out = lemmas("Running is fun. Cats are cute.");
    expect(out).toContain("run");
    expect(out).toContain("cat");
  });
});

describe("T02 filter regression (URL/email/identifiers still rejected)", () => {
  it("still rejects URL, email, path, snake/camel/Pascal, $scope, v2", () => {
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
});
