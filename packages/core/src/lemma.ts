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
  // lie / die（对抗审查补：lies/dies 的名词侧 toSingular 伪造 ly/dy 且恰在
  // 词典，名词优先平局会让伪词元吞并在典动词词元——三单进表前置拦截）
  lies: "lie", dies: "die",
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
 * -as 专名形表（对抗审查发现，2026-10-10）：语料里几乎全是专名第二词的
 * -as 形（Las Vegas 的 vegas），还原到在典单数（vega 织女星）是伪需求——
 * 负启发分支前置回退原词形。单独 'Vegas' 不被 PASCAL_RE（需 ≥2 大写）与
 * compromise 专名判定拦截，上游防线对它失效。
 */
const AS_PROPER_NOUN_FORMS: ReadonlySet<string> = new Set(["vegas"]);

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
 * 1. -as 负启发（issue #50，消毒式）前置：原词 -as 而动词输出 -ave 是
 *    compromise 的拉丁式伪变位（pyjamave/arenave），伪输出不得参与词典裁决——
 *    只消毒动词侧：名词侧在典单数（cameras→camera）照常胜出，无在典产物则
 *    回退原词形。真实英语变位只有 -ave→-aves 与 has→have，后者由
 *    IRREGULAR_VERBS 前置拦截，故此规则零误伤。名词侧候选带剥 s 补位
 *    （toSingular 对 cinemas/dramas/agendas 空转时用「剥 s 在典」补）；
 *    专名形例外表（AS_PROPER_NOUN_FORMS，vegas）前置回退。
 * 2. 词典内词元：动词+名词双上下文的输出中，词典词优先于一切拼接；词元
 *    统一过 realLexeme 判据（在典且含元音——无元音串是在典词频表缩写噪声
 *    cs/gp/xs，css→cs 类剥尾 s 伪还原由此拒绝）；与原词
 *    形相同的输出视为「无还原」、不作候选（否则 walked 会以词典内词形身份
 *    劫走 walked→walk 的动词还原）。动词词元与名词词元都命中词典的平局
 *    判给名词（lives→life、leaves→leaf）。
 * 3. 原词形在词典 → 回退原词形（thi→this 类：畸形输出 + 词典原词）。
 * 4. -f/-fe 拼接救援（issue #48）降为无词典命中时的兜底：对输出尝试
 *    -ve → -f/-fe 变体，仅当拼接形态本身在词典才采用（-ves 结尾通道在
 *    语料探针 0 命中，issue #58 删除）。词典内输出与原词形都排在其前
 *    ——wolfe/gif 类词典噪声不再有穿透通道。
 * 5. 双冷僻（输出与原词形都不在典，截选外冷僻词）→ 放行名词输出，其次
 *    动词输出（issue #48 的「零误杀」：不丢弃、保持还原输出；名词优先是
 *    平局政策的自然延伸）——但输出为超短串/无元音串的伪形（cs/gp 类
 *    toSingular 剥尾 s 伪产物）时回退原词形。
 */
function chooseLexicalLemma(
  verbOut: string | null,
  nounOut: string | null,
  original: string,
): string | null {
  if (verbOut === null && nounOut === null) return null;
  // 词元合法性统一判据：在典且含元音——无元音串的「在典」词元是词频表缩写
  // 噪声（cs/gp/xs/c 类，Norvig 词频表混入的技术缩写），不是真词词元；
  // css→cs、cs→c 的剥尾 s 伪还原由此拒绝。ly/dy 含 y 不属此类（y 算元音），
  // 它们的拦截靠 IRREGULAR_VERBS 表前置。2 字符真词（it/by/my）全含元音，
  // 不受此判据影响（its→it 保持）。
  const realLexeme = (out: string): boolean => inLexicon(out) && /[aeiouy]/.test(out);
  // 1. -as 负启发（issue #50，2026-10-10 grilling 改消毒式）：原词 -as 而动词
  //    输出 -ave 是 compromise 的拉丁式伪变位（pyjamave/arenave），伪输出不得
  //    参与词典裁决——但只消毒动词侧，不回退整词：名词侧在典单数
  //    （cameras→camera）是词典证据、照常胜出，与 wolves→wolf 的聚合政策对齐；
  //    名词侧无在典产物时保守回退原词形（pyjamas→pyjamas，#50 原语义——
  //    伪变位是 POS 误判产物，此时名词侧输出同样不可信）。真实英语变位只有
  //    -ave→-aves 与 has→have，后者由 IRREGULAR_VERBS 前置拦截，零误伤。
  if (/as$/.test(original) && verbOut !== null && /ave$/.test(verbOut)) {
    // 专名对例外：小写 vegas 语料几乎全是 Las Vegas 专名第二词（单独 'Vegas'
    // 不被 PASCAL_RE/专名判定拦截），还原成织女星词元 vega 属伪需求。
    if (AS_PROPER_NOUN_FORMS.has(original)) return original;
    // 名词侧在典单数候选：toSingular 对部分 -as 复数空转（cinemas/dramas/
    // agendas 原样返回，对抗审查发现），nounOut 缺位时用「剥 s 在典」显式
    // 补位（与 realLexeme 同判据，词元须含元音）。
    const singular =
      nounOut !== null && nounOut !== original && realLexeme(nounOut)
        ? nounOut
        : realLexeme(original.slice(0, -1))
          ? original.slice(0, -1)
          : null;
    return singular ?? original;
  }
  // 2. 词典内词元：动词+名词双上下文的输出中，词典词优先于一切拼接；与原词
  //    形相同的输出视为「无还原」、不作候选（否则 walked 会以词典内词形身份
  //    劫走 walked→walk 的动词还原）。动词词元与名词词元都命中词典的平局
  //    判给名词（lives→life、leaves→leaf）。
  const nounLexeme = nounOut !== null && nounOut !== original && realLexeme(nounOut) ? nounOut : null;
  const verbLexeme = verbOut !== null && verbOut !== original && realLexeme(verbOut) ? verbOut : null;
  if (nounLexeme !== null) return nounLexeme;
  if (verbLexeme !== null) return verbLexeme;
  if (inLexicon(original)) return original;
  for (const out of [nounOut, verbOut]) {
    if (out === null || !/ves?$/.test(out)) continue;
    // -ves → -f/-fe 通道已删（issue #58）：能抵达此处的 out 实测只有动词形
    // -ve 结尾（halve/shelve/calve/wive/thieve），-ves 结尾输出在词典候选
    // 第 2/3 步已全部消化（2026-10-10 语料探针：1949 个 -ve/-ves 词上
    // ves→f/ves→fe 均 0 命中，钉测 lemma.test.ts issue #58 块固化）。
    const rescued = [
      out.replace(/ve$/, "fe"),
      out.replace(/ve$/, "f"),
    ].find((c) => c !== out && inLexicon(c));
    if (rescued !== undefined) return rescued;
  }
  // 5. 双冷僻放行（名词优先；双输出皆无的入口在函数开头已分流到 fallback），
  //    加伪形守卫（2026-10-10 grilling）：超短串（≤2 字符）或无元音串比原词形
  //    更不像词（css/gps 的 toSingular 剥尾 s 伪产物 cs/gp，cs 再还原甚至成单
  //    字母 c）——这类输出回退原词形；canvases→canvase 类长形有元音的放行
  //    语义不变（issue #48 零误杀）。
  const pseudoForm = (out: string): boolean => out.length <= 2 || !/[aeiouy]/.test(out);
  const passable = [nounOut, verbOut].filter(
    (out): out is string => out !== null && !pseudoForm(out),
  );
  return passable[0] ?? original;
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
 *
 * 模块级缓存：词形→词元是纯函数（依赖静态词典与 compromise），但双上下文
 * 并发收集比旧的动词短路路径多一次 nlp() parse——大页面重复词形多（去重前
 * 每 token 都会路过这里），缓存后每词形只算一次。上限防无界增长，超出整清
 * （简单优于 LRU）。
 */
const LEMMA_CACHE_LIMIT = 5000;
const lemmaCache = new Map<string, string>();

export function lemmatizeWord(word: string): string {
  const cached = lemmaCache.get(word);
  if (cached !== undefined) return cached;
  const lemma = lemmatizeWordUncached(word);
  if (lemmaCache.size >= LEMMA_CACHE_LIMIT) lemmaCache.clear();
  lemmaCache.set(word, lemma);
  return lemma;
}

function lemmatizeWordUncached(word: string): string {
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
