import nlp from "compromise";
import { isEnglishWord } from "./extract.js";

/**
 * T03 词形还原选项（由 extract.ts 的 ExtractOptions 组合）。
 * `excludeProperNouns`：默认 `true`，用 compromise `#ProperNoun` 排除专名。
 */
export interface LemmatizeOptions {
  excludeProperNouns?: boolean;
}

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

/** 修正 compromise 偶发的 -ves/-ve 误归（knives → knive）：尝试 -f/-fe 形态。 */
function fixF(lemma: string): string {
  if (lemma.endsWith("ves") || lemma.endsWith("ve")) {
    const candidates = [
      lemma.replace(/ves$/, "f"),
      lemma.replace(/ves$/, "fe"),
      lemma.replace(/ve$/, "fe"),
      lemma.replace(/ve$/, "f"),
    ].filter((c) => c !== lemma && isEnglishWord(c) && isValidStem(c));
    if (candidates.length > 0) return candidates[0] ?? lemma;
  }
  return lemma;
}

/**
 * 单词词形还原（输入为已通过过滤的合法英文词，保留原大小写仅用于诊断）。
 *
 * 顺序：不规则动词表 → compromise（极简句子上下文）→ 保守后缀 fallback → 原词。
 */
export function lemmatizeWord(word: string): string {
  const lower = word.toLowerCase();

  // 缩写 / 复合词（don't、well-known）不做还原，直接小写。
  if (/['-]/.test(lower)) return lower;

  // 1. 不规则动词表优先。
  const irregular = IRREGULAR_VERBS[lower];
  if (irregular) return irregular;

  // 2. compromise：放进极简句子上下文提升 POS 判断稳定性。
  //    动词上下文 "he X."，名词上下文 "the X."。
  const vDoc = nlp(`he ${lower}`).verbs();
  if (vDoc.found) {
    const out = vDoc.toInfinitive().out("array")[0];
    const lemma = out ? fixF(clean(out)) : "";
    if (lemma && isEnglishWord(lemma)) return lemma;
  }
  const nDoc = nlp(`the ${lower}`).nouns();
  if (nDoc.found) {
    const out = nDoc.toSingular().out("array")[0];
    const lemma = out ? fixF(clean(out)) : "";
    if (lemma && isEnglishWord(lemma)) return lemma;
  }

  // 3. 保守后缀 fallback。
  for (const rule of SUFFIX_RULES) {
    if (!lower.endsWith(rule.suffix) || lower.length <= rule.suffix.length + 1) {
      continue;
    }
    let stem = rule.fix(lower.slice(0, lower.length - rule.suffix.length));
    if (rule.suffix === "ing" || rule.suffix === "ed") {
      stem = dedupConsonant(stem);
    }
    if (isValidStem(stem)) return stem;
  }

  // 4. 找不到可靠词元，保守返回小写原词。
  return lower;
}
