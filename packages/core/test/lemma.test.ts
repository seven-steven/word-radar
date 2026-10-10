import { describe, expect, it } from "vitest";
import { extractWordEntries } from "../src/index.js";
import { isProperNoun, lemmatizeWord } from "../src/lemma.js";

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

  it("keeps correct rare-word inflection reduction on the dual-rare path (guards against widening the heuristic)", () => {
    // seafarers/seafarer、backpackers/backpacker 双双或部分在典外且非 -as→-ave，
    // 走 finalize 第 4 步「保持还原输出」——正确还原必须保留。若未来有人把
    // 负启发扩大成「双冷僻一律回退原词形」（issue #50 否决的方向 A），此用例先红。
    expect(lemmatizeWord("seafarers")).toBe("seafarer");
    expect(lemmatizeWord("backpackers")).toBe("backpacker");
  });
});

describe("issue #55 lemma 候选政策（双上下文并发 + 词典内输出优先 + 名词平局）", () => {
  it("f/fe 家族复数还原为名词词元", () => {
    expect(lemmatizeWord("wolves")).toBe("wolf");
    expect(lemmatizeWord("lives")).toBe("life");
    expect(lemmatizeWord("leaves")).toBe("leaf");
  });

  it("平局集钉死：动词/名词词元都在词典的判给名词（ADR-0003）", () => {
    // lives(live/life)、leaves(leave/leaf) 双词元在典；halves/shelves/calves
    // 的动词形（halve/shelve/calve）不在典，名词词元直接胜出。
    expect(lemmatizeWord("lives")).toBe("life");
    expect(lemmatizeWord("leaves")).toBe("leaf");
    expect(lemmatizeWord("halves")).toBe("half");
    expect(lemmatizeWord("shelves")).toBe("shelf");
    expect(lemmatizeWord("calves")).toBe("calf");
  });

  it("hooves 不返回拼接伪词（hoof 不在词典截选，放行 toSingular 真实输出）", () => {
    const out = lemmatizeWord("hooves");
    // hoof 是 toSingular 的真实还原（非拼接形、非伪词）；若实现选择回退
    // 原词形 hooves 也符合验收（允许项），但绝不允许 hoove/hoofe 类伪词。
    expect(out === "hoof" || out === "hooves").toBe(true);
  });

  it("词典噪声不穿透：ve+s 家族的伪拼接形态不再有通道", () => {
    // gif/cafe/prof/strife 都在词典（Norvig 姓名/缩写/高频词噪声），
    // 任何「-ves 拼接优先」通道都会把三单/规则复数改写成它们。
    expect(lemmatizeWord("gives")).toBe("give");
    expect(lemmatizeWord("caves")).toBe("cave");
    expect(lemmatizeWord("proves")).toBe("prove");
    expect(lemmatizeWord("strives")).toBe("strive");
  });

  it("动词词元仍在：名词路径不得劫走动词还原", () => {
    // walked 在词典（词形级），若把「无还原的原词形」当名词词元候选，
    // walked→walk 会被平局判名词劫成 walked。
    expect(lemmatizeWord("walked")).toBe("walk");
    expect(lemmatizeWord("survived")).toBe("survive");
  });

  it(" wives/elves/dwarves 等无动词同形的 f/fe 复数照常还原", () => {
    expect(lemmatizeWord("wives")).toBe("wife");
    expect(lemmatizeWord("elves")).toBe("elf");
    expect(lemmatizeWord("dwarves")).toBe("dwarf");
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
