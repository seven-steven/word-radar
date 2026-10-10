import nlp from "compromise";
import { isEnglishWord } from "./predicate.js";
import { LEXICON } from "./lexicon.js";

/** 判断 token（保留原始大小写）是否为 compromise 识别的专名。 */
export function isProperNoun(token: string): boolean {
  return nlp(token).has("#ProperNoun");
}

/**
 * 不规则动词表（小写：变形 → 原形）。
 * compromise 覆盖了大部分，但常见高频词显式建表，保证确定性；
 * 表优先于 compromise 判定，避免 POS 误判把 went 当名词。
 */
const IRREGULAR_VERBS: Readonly<Record<string, string>> = {
  // be
  am: "be", is: "be", are: "be", was: "be", were: "be", been: "be",
  // have / do
  has: "have", had: "have", does: "do", did: "do", done: "do",
  // go / come
  go: "go", goes: "go", went: "go", gone: "go", came: "come", come: "come",
  // take / give / get
  took: "take", taken: "take", gave: "give", given: "give",
  got: "get", gotten: "get",
  // see / say / tell / know / think
  saw: "see", seen: "see", said: "say", told: "tell", knew: "know",
  known: "know", thought: "think",
  // make / find / feel / leave / keep / hold
  made: "make", found: "find", felt: "feel", left: "leave", kept: "keep",
  held: "hold",
  // bring / begin / build / break / choose / drive
  brought: "bring", began: "begin", begun: "begin", built: "build",
  broke: "break", broken: "break", chose: "choose", chosen: "choose",
  drove: "drive", driven: "drive",
  // eat / write / speak / read(同形) / wake / wear
  ate: "eat", eaten: "eat", wrote: "write", written: "write",
  spoke: "speak", spoken: "speak", woke: "wake", worn: "wear", wore: "wear",
  // run / sit / stand / lose / meet / win / sing / swim / sleep
  ran: "run", sat: "sit", stood: "stand", lost: "lose", met: "meet",
  won: "win", sang: "sing", sung: "sing", swam: "swim", swum: "swim",
  slept: "sleep",
  // catch / buy / teach / forget / hide / pay / send / spend / sell / grow / fly / fall
  caught: "catch", bought: "buy", taught: "teach", forgot: "forget",
  forgotten: "forget", hid: "hide", hidden: "hide", paid: "pay",
  sent: "send", spent: "spend", sold: "sell", grew: "grow", grown: "grow",
  flew: "fly", flown: "fly", fell: "fall", fallen: "fall",
  // drink / blow / throw / draw / bear
  drank: "drink", drunk: "drink", blew: "blow", blown: "blow",
  threw: "throw", thrown: "throw", drew: "draw", drawn: "draw",
  bore: "bear", born: "bear",
};

/**
 * 不规则 f/fe 复数表（小写：复数 → 名词词元），issue #55。
 *
 * compromise toSingular 已知失误的显式修正。失误模式：双 POS 撞形——动词与
 * 名词两条上下文输出同词，名词词元被高频动词形吞并（lives 两侧都给 live，
 * 而 lives 作为名词复数的词元是 life）。与 IRREGULAR_VERBS 同构：表优先于
 * compromise 判定，保证确定性。注意勿为撞形词开「-ves 拼接优先」通道——
 * gif/cafe/prof/strife 都在词典，拼接通道会把 gives/caves/proves/strives
 * 一并改写（见 chooseLexicalLemma 的候选序）；新发现撞形失误时增补本表。
 */
const IRREGULAR_VES_NOUNS: Readonly<Record<string, string>> = {
  lives: "life",
};

/**
 * 保守后缀 fallback 规则（仅当 compromise 未识别出词性时使用）。
 * 每条 = [后缀, 剥离后是否需要额外处理]；stem 必须仍是合法英文词元。
 */
const SUFFIX_RULES: ReadonlyArray<{ suffix: string; fix: (stem: string) => string }> = [
  { suffix: "ies", fix: (s) => s + "y" }, // studies → study
  { suffix: "ses", fix: (s) => s }, // uses → use（es 剥离）
  { suffix: "xes", fix: (s) => s },
  { suffix: "zes", fix: (s) => s },
  { suffix: "ches", fix: (s) => s },
  { suffix: "shes", fix: (s) => s },
  { suffix: "ing", fix: (s) => s }, // 剥 ing；双写辅音在下方统一处理
  { suffix: "ed", fix: (s) => s }, // 剥 ed；双写辅音在下方统一处理
  { suffix: "s", fix: (s) => s },
];

/** 合并双写辅音：running→runn→run、stopped→stopp→stop；但 keep 之类不受影响（无后缀剥离发生）。 */
function dedupConsonant(stem: string): string {
  if (
    stem.length >= 3 &&
    stem.at(-1) === stem.at(-2) &&
    !"aeioulsz".includes(stem.at(-1)!)
  ) {
    return stem.slice(0, -1);
  }
  return stem;
}

/** 词元合法性：仍是英文词形，且 compromise 在极简上下文里能认作动词或名词。 */
function isValidStem(stem: string): boolean {
  if (stem.length < 2 || !isEnglishWord(stem)) return false;
  if (nlp(`he ${stem}`).verbs().found) return true;
  if (nlp(`the ${stem}`).nouns().found) return true;
  return false;
}

/** 去掉 compromise 输出里的句读与极简上下文前缀（"the knife" → "knife"）。 */
function clean(out: string): string {
  return out
    .replace(/^the\s+/i, "")
    .replace(/^he\s+/i, "")
    .replace(/[.'-]+$/g, "");
}

/**
 * 动词上下文收集（"he X." → toInfinitive）：极简句子上下文提升 POS 判断
 * 稳定性；无识别或产物非法（非英文词形）时返回 null。
 */
function collectVerbLemma(lower: string): string | null {
  const doc = nlp(`he ${lower}`).verbs();
  if (!doc.found) return null;
  const out = doc.toInfinitive().out("array")[0];
  const lemma = out ? clean(out) : "";
  return lemma !== "" && isEnglishWord(lemma) ? lemma : null;
}

/**
 * 名词上下文收集（"the X." → toSingular）：此前因动词路径短路而不可达
 * （issue #55 打开）；实测对 f/fe 复数家族质量可靠（wolves→wolf、
 * leaves→leaf、halves→half），失误词（lives→live）由 IRREGULAR_VES_NOUNS
 * 显式修正。
 */
function collectNounLemma(lower: string): string | null {
  const doc = nlp(`the ${lower}`).nouns();
  if (!doc.found) return null;
  const out = doc.toSingular().out("array")[0];
  const lemma = out ? clean(out) : "";
  return lemma !== "" && isEnglishWord(lemma) ? lemma : null;
}

/** 词典级守门：还原输出是否为真实英文词（Norvig top-20000 截选，见 lexicon.ts）。 */
function inLexicon(word: string): boolean {
  return LEXICON.has(word);
}

/**
 * 词典候选政策（issue #55 / ADR-0003）：双上下文产物按显式优先序裁决。
 * 返回 null 表示两条路径都无产物，交由后缀 fallback。
 *
 * 1. -as 负启发（issue #50）前置：原词 -as 而动词输出 -ave 是 compromise
 *    的拉丁式伪变位（pyjamave/arenave），伪输出不得参与词典裁决，直接回退
 *    原词形。真实英语变位只有 -ave→-aves 与 has→have，后者由
 *    IRREGULAR_VERBS 前置拦截，故此规则零误伤。
 * 2. 词典内词元：动词+名词双上下文的输出中，词典词优先于一切拼接；与原词
 *    形相同的输出视为「无还原」、不作候选（否则 walked 会以词典内词形身份
 *    劫走 walked→walk 的动词还原）。动词词元与名词词元都命中词典的平局
 *    判给名词（lives→life、leaves→leaf）。
 * 3. 原词形在词典 → 回退原词形（thi→this 类：畸形输出 + 词典原词）。
 * 4. -f/-fe 拼接救援（issue #48）降为无词典命中时的兜底：对输出尝试
 *    -ve/-ves → -f/-fe 变体，仅当拼接形态本身在词典才采用。词典内输出与
 *    原词形都排在其前——wolfe/gif 类词典噪声不再有穿透通道。
 * 5. 双冷僻（输出与原词形都不在典，截选外冷僻词）→ 放行名词输出，其次
 *    动词输出（issue #48 的「零误杀」：不丢弃、保持还原输出；名词优先是
 *    平局政策的自然延伸）。
 */
function chooseLexicalLemma(
  verbOut: string | null,
  nounOut: string | null,
  original: string,
): string | null {
  if (verbOut === null && nounOut === null) return null;
  if (/as$/.test(original) && verbOut !== null && /ave$/.test(verbOut)) {
    return original;
  }
  const nounLexeme = nounOut !== null && nounOut !== original && inLexicon(nounOut) ? nounOut : null;
  const verbLexeme = verbOut !== null && verbOut !== original && inLexicon(verbOut) ? verbOut : null;
  if (nounLexeme !== null) return nounLexeme;
  if (verbLexeme !== null) return verbLexeme;
  if (inLexicon(original)) return original;
  for (const out of [nounOut, verbOut]) {
    if (out === null || !/ves?$/.test(out)) continue;
    const rescued = [
      out.replace(/ves$/, "f"),
      out.replace(/ves$/, "fe"),
      out.replace(/ve$/, "fe"),
      out.replace(/ve$/, "f"),
    ].find((c) => c !== out && inLexicon(c));
    if (rescued !== undefined) return rescued;
  }
  return nounOut ?? verbOut ?? original;
}

/**
 * 后缀 fallback 产物的精简守门：stem 在典直取；原词形在典回退（this 的
 * 剥 s 产物 thi 非典、this 在典 → this）；否则放行 stem。-as 负启发不在此
 * 层重复——-ave 伪输出的唯一产源是 compromise 动词路径，已在
 * chooseLexicalLemma 前置拦截。
 */
function finalizeStem(stem: string, original: string): string {
  if (inLexicon(stem)) return stem;
  if (inLexicon(original)) return original;
  return stem;
}

/**
 * 单词词形还原（输入为已通过过滤的合法英文词，保留原大小写仅用于诊断）。
 *
 * 顺序：不规则动词表 → 不规则 f/fe 复数表 → compromise 双上下文并发收集
 * （动词 "he X." / 名词 "the X."，不再让「动词先跑、命中即返回」的代码顺序
 * 决定结果）→ 词典候选政策裁决（chooseLexicalLemma）→ 保守后缀 fallback
 * → 原词。
 */
export function lemmatizeWord(word: string): string {
  const lower = word.toLowerCase();

  // 缩写 / 复合词（don't、well-known）不做还原，直接小写。
  if (/['-]/.test(lower)) return lower;

  // 1. 不规则动词表优先。
  const irregular = IRREGULAR_VERBS[lower];
  if (irregular) return irregular;

  // 2. 不规则 f/fe 复数表（toSingular 撞形失误的显式修正）。
  const vesNoun = IRREGULAR_VES_NOUNS[lower];
  if (vesNoun) return vesNoun;

  // 3. compromise 双上下文并发收集（issue #55），产出统一过词典候选政策。
  const chosen = chooseLexicalLemma(collectVerbLemma(lower), collectNounLemma(lower), lower);
  if (chosen !== null) return chosen;

  // 4. 保守后缀 fallback。
  for (const rule of SUFFIX_RULES) {
    if (!lower.endsWith(rule.suffix) || lower.length <= rule.suffix.length + 1) {
      continue;
    }
    let stem = rule.fix(lower.slice(0, lower.length - rule.suffix.length));
    if (rule.suffix === "ing" || rule.suffix === "ed") {
      stem = dedupConsonant(stem);
    }
    if (isValidStem(stem)) return finalizeStem(stem, lower);
  }

  // 5. 找不到可靠词元，保守返回小写原词。
  return lower;
}
