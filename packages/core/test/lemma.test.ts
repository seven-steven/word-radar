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

  it("rescues plural -as nouns to their in-lexicon singulars (sanitizing heuristic, 2026-10-10 grilling)", () => {
    // 2026-09-26 Norvig -as 词全量扫描发现误读；#50 定稿整词回退，2026-10-10
    // grilling 改消毒式：负启发只丢弃动词侧伪输出（arenave 类拉丁式变位），
    // 名词侧在典单数照常胜出——与 wolves→wolf 的聚合政策对齐。名词侧无在典
    // 单数时仍整词回退（见下一用例 pyjamas）。
    expect(lemmatizeWord("arenas")).toBe("arena");
    expect(lemmatizeWord("umbrellas")).toBe("umbrella");
    expect(lemmatizeWord("pizzas")).toBe("pizza");
    expect(lemmatizeWord("orchestras")).toBe("orchestra");
    expect(lemmatizeWord("cameras")).toBe("camera");
    expect(lemmatizeWord("ideas")).toBe("idea");
    expect(lemmatizeWord("areas")).toBe("area");
  });

  it("keeps -as words without an in-lexicon singular as themselves (pyjamas path)", () => {
    // 消毒后名词侧产物（pyjama 类冷僻变体）不在典——伪变位是 POS 误判的
    // 产物，此时名词侧输出同样不可信，保守回退原词形（#50 原语义保持）。
    expect(lemmatizeWord("pyjamas")).toBe("pyjamas");
    expect(lemmatizeWord("pajamas")).toBe("pajamas");
  });

  it("fills the singular candidate when toSingular no-ops on -as plurals (adversarial review finding)", () => {
    // 对抗审查（2026-10-10）：toSingular 对 cinemas/dramas/agendas 空转
    // （原样返回复数），名词侧候选缺位——剥 s 在典显式补位，修复面不漏。
    expect(lemmatizeWord("cinemas")).toBe("cinema");
    expect(lemmatizeWord("dramas")).toBe("drama");
    expect(lemmatizeWord("agendas")).toBe("agenda");
  });

  it("keeps -as proper-noun forms as themselves (vegas: Las Vegas corpus-dominant)", () => {
    // 对抗审查发现：单独 'Vegas'/'vegas' 不被 PASCAL_RE（需 ≥2 大写）与
    // compromise 专名判定拦截，'Las Vegas' 短语两词都会还原成织女星词元
    // vega——专名形例外表前置回退。
    expect(lemmatizeWord("vegas")).toBe("vegas");
    expect(lemmatizeWord("Vegas")).toBe("vegas");
    const out = extractWordEntries("Las Vegas hotels");
    expect(out.entries.map((e) => e.lemma)).toContain("vegas");
    expect(out.entries.map((e) => e.lemma)).not.toContain("vega");
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

  it("pseudo-form guard on the dual-rare pass-through (2026-10-10 grilling: CSS→cs regression)", () => {
    // css/gps 不在词典截选（缩写词），toSingular 把「辅音串+s」误判复数剥尾 s
    // 产出 cs/gp——双冷僻放行曾把这类「比原词形更不像词」的伪词放进词库
    // （cs 再采一次甚至还原成单字母 c）。守卫：双冷僻放行时，输出为超短串
    // （≤2 字符）或无元音串则回退原词形。canvases→canvase 类长形有元音的
    // 零误杀语义不变（issue #48）。
    expect(lemmatizeWord("css")).toBe("css");
    expect(lemmatizeWord("gps")).toBe("gps");
    expect(lemmatizeWord("canvases")).toBe("canvase");
  });
});

describe("issue #55 lemma 候选政策（双上下文并发 + 词典内输出优先 + 名词平局）", () => {
  it("f/fe 家族复数还原为名词词元", () => {
    expect(lemmatizeWord("wolves")).toBe("wolf");
    expect(lemmatizeWord("lives")).toBe("life");
    expect(lemmatizeWord("leaves")).toBe("leaf");
  });

  it("平局集钉死：动词/名词词元都在词典的判给名词（ADR-0003）", () => {
    // 机制归因（对抗审查勘误）：leaves 是真平局——名词 toSingular 输出 leaf
    // （在典）、动词输出 leave（在典），chooseLexicalLemma 名词优先选出 leaf；
    // lives 的 toSingular 失误输出 live（撞形），life 由 IRREGULAR_VES_NOUNS
    // 表前置兑现（去表条目则平局政策产出 live）——撞形保障靠表不靠政策。
    // halves/shelves/calves 的动词形（halve/shelve/calve）不在典，名词词元
    // 直接胜出。
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

  it("lies/dies 不被名词侧伪造短词元吞并（对抗审查发现的 ly/dy 噪声词元回归）", () => {
    // compromise 名词上下文对 lies/dies 伪造输出 ly/dy（toSingular 失误），
    // 而 ly/dy 恰在词典（Norvig 噪声）且命中缩略词黑名单——名词优先平局会让
    // 伪词元压过在典动词词元 lie/die，extract 管线下词条更是被黑名单静默
    // 吞掉。与 goes/does 同型：高频不规则动词三单显式进表前置拦截。
    expect(lemmatizeWord("lies")).toBe("lie");
    expect(lemmatizeWord("dies")).toBe("die");
    // 管线级：词条不消失（ly/dy 命中黑名单的静默拦截不可达）
    const out = extractWordEntries("the truth lies here and hope dies last");
    const lemmasOut = out.entries.map((e) => e.lemma);
    expect(lemmasOut).toContain("lie");
    expect(lemmasOut).toContain("die");
  });

  it("-ies 家族其余词名词路径输出正确词元（ties→tie、cries→cry、skies→sky）", () => {
    expect(lemmatizeWord("ties")).toBe("tie");
    expect(lemmatizeWord("cries")).toBe("cry");
    expect(lemmatizeWord("flies")).toBe("fly");
    expect(lemmatizeWord("skies")).toBe("sky");
    expect(lemmatizeWord("stories")).toBe("story");
  });
});

describe("issue #58 -ve/-ves 词形全管线输出钉测（拼接救援表基线）", () => {
  // 期望值先以一次性探针走真实 lemmatizeWord 管线固化（2026-10-10），
  // 用于钉死第 4 步拼接救援表收紧（删除死通道）前后的行为等价。
  it("f/fe 复数家族：第 2 步名词 toSingular 直出在典词元，不经拼接救援", () => {
    expect(lemmatizeWord("wolves")).toBe("wolf");
    expect(lemmatizeWord("knives")).toBe("knife");
    expect(lemmatizeWord("calves")).toBe("calf");
    expect(lemmatizeWord("halves")).toBe("half");
    expect(lemmatizeWord("loaves")).toBe("loaf");
    expect(lemmatizeWord("thieves")).toBe("thief");
    expect(lemmatizeWord("shelves")).toBe("shelf");
    expect(lemmatizeWord("wives")).toBe("wife");
    expect(lemmatizeWord("lives")).toBe("life");
    expect(lemmatizeWord("leaves")).toBe("leaf");
    expect(lemmatizeWord("dwarves")).toBe("dwarf");
    expect(lemmatizeWord("elves")).toBe("elf");
    expect(lemmatizeWord("scarves")).toBe("scarf");
    expect(lemmatizeWord("wharves")).toBe("wharf");
  });

  it("三单 -ves 家族：第 2 步动词 toInfinitive 直出在典词元，不经拼接救援", () => {
    expect(lemmatizeWord("gives")).toBe("give");
    expect(lemmatizeWord("caves")).toBe("cave");
    expect(lemmatizeWord("proves")).toBe("prove");
    expect(lemmatizeWord("strives")).toBe("strive");
    expect(lemmatizeWord("solves")).toBe("solve");
  });

  it("冷僻动词形 -ve（第 4 步 ve→f 通道）", () => {
    // halve/shelve/calve/thieve 不在词典截选，双输出（原形）不在典 →
    // 走到第 4 步拼接救援，ve→f 拼接形态在典被采纳。
    expect(lemmatizeWord("halve")).toBe("half");
    expect(lemmatizeWord("shelve")).toBe("shelf");
    expect(lemmatizeWord("calve")).toBe("calf");
    expect(lemmatizeWord("thieve")).toBe("thief");
  });

  it("冷僻动词形 -ve（第 4 步 ve→fe 通道）", () => {
    expect(lemmatizeWord("wive")).toBe("wife");
  });

  it("在典 -ve 原词形不动（第 3 步词典原词形回退）", () => {
    expect(lemmatizeWord("solve")).toBe("solve");
    expect(lemmatizeWord("dissolve")).toBe("dissolve");
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
