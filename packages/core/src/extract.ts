import type { WordEntry } from "./types.js";
import { createWordEntry } from "./entry.js";
import { isProperNoun, lemmatizeWord } from "./lemma.js";
import { isEnglishWord } from "./predicate.js";
import { createIntakeFilter } from "./intake-filter.js";

/**
 * extractWordEntries 的选项。
 *
 * - `excludeProperNouns`（默认 `true`）：用 compromise `#ProperNoun` 排除专名
 *   （人名、地名、品牌名等）；关闭后专名按普通词收录。
 * - `filterAbbreviations`（默认 `true`）：收词过滤判据之一——词形还原后按
 *   小写 lemma 精确命中缩略词黑名单的词条丢弃（docs → doc 命中）。
 * - `filterContractions`（默认 `true`）：收词过滤判据之二——所有格剥离后
 *   仍含撇号的缩合形式丢弃（don't、aren't、o'clock）；不展开成分词。
 * - `abbreviationBlacklist`：注入替代内置黑名单（测试用；缺省用
 *   `ABBREVIATION_BLACKLIST`）。黑名单内容用户不可增删。
 */
export interface ExtractOptions {
  /** 排除专名，默认 true。 */
  excludeProperNouns?: boolean;
  /** 过滤缩略词（黑名单精确命中），默认 true。 */
  filterAbbreviations?: boolean;
  /** 过滤缩合形式（剥离所有格后仍含撇号），默认 true。 */
  filterContractions?: boolean;
  /** 注入替代内置缩略词黑名单（测试用），缺省用 ABBREVIATION_BLACKLIST。 */
  abbreviationBlacklist?: ReadonlySet<string>;
}

/** extractWordEntries 的返回：词条 + 收词过滤统计。 */
export interface ExtractResult {
  entries: WordEntry[];
  /** 收词过滤拦截的词条数（按去重后 lemma/token 计，不重复计）。 */
  filteredCount: number;
}

/**
 * 候选 token 扫描正则。
 *
 * 一次性把「英文词（含内部 ' / -）」以及「URL / email / 路径 / 代码标识符」
 * 都抓成单个候选，避免把 https/example/com 拆成三个词；垃圾候选交给
 * isEnglishWord 拒绝。
 *
 * - 起始字符：字母/数字/`$`（`$scope`、`v2` 作为整体候选进过滤）
 * - 后续字符：字母/数字/`$`/`.`/`'`/`@`/`/`/`_`/`-`
 * - 标点（逗号、括号、引号包裹等）天然被排除在候选之外
 */
const CANDIDATE_RE = /[A-Za-z0-9$][A-Za-z0-9$.:'@/_-]*/g;

/**
 * token 末尾可裁掉的标点：句点、撇号、连字符
 * （如 `"word."` 扫描出的候选 `word.`、`don't'` 裁成 `don't`）。
 */
const TRAILING_PUNCT_RE = /[.'-]+$/;

/** 所有格后缀：词尾 `'s`（弯撇号已在 normalizeText 归一为直撇号）。 */
const POSSESSIVE_RE = /'s$/;

/**
 * 显式字符替换表：弯引号 / Unicode 连字符。
 * 这些字符没有 NFKC 兼容分解（U+2019、U+2013 等均无 decomposition mapping），
 * 仅靠 normalize("NFKC") 不会变成 ASCII，必须在 NFKC 之前手工替换。
 */
const PRE_NFKC_REPLACEMENTS: readonly [RegExp, string][] = [
  [/[‘’ʼ‛]/g, "'"], // 弯单引号 ' ' ʻ '
  [/[“”]/g, '"'], // 弯双引号 “ ”
  [/[‐‑‒–—―−­]/g, "-"], // 各类 Unicode 连字符/减号
];

/** Unicode 清洗：显式替换 + NFKC 规范化。 */
export function normalizeText(text: string): string {
  let out = text;
  for (const [re, replacement] of PRE_NFKC_REPLACEMENTS) {
    out = out.replace(re, replacement);
  }
  return out.normalize("NFKC");
}

/**
 * 分词：返回候选 token 列表（含待过滤的 URL/email/标识符等）。
 * 输入应先做 NFKC 规范化。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(CANDIDATE_RE)) {
    const token = match[0].replace(TRAILING_PUNCT_RE, "");
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

/**
 * 提取管线（v3，含词形还原、专名排除与收词过滤）：
 * NFKC 规范化 → 候选分词 → 所有格剥离（归一化，永不受开关控制）
 * → 过滤非英文词 → 可选专名排除 → 可选缩合形式拦截
 * → 词形还原（lemma 聚合前）→ 可选缩略词黑名单拦截
 * → 按 lemma 去重 → `{ entries, filteredCount }`。
 *
 * 词形还原：compromise（不规则动词表优先 + 保守后缀 fallback），详见 lemma.ts。
 * 纯函数，仅依赖 compromise（纯 JS），扩展与 Node 共用。
 */
export function extractWordEntries(
  text: string,
  options?: ExtractOptions,
): ExtractResult {
  const excludeProperNouns = options?.excludeProperNouns ?? true;
  // 收词过滤（缩合 + 黑名单双判据）收拢为 intake-filter seam（issue #54）。
  const intake = createIntakeFilter(options);
  const normalized = normalizeText(text);
  const seen = new Set<string>();
  const entries: WordEntry[] = [];
  for (const rawToken of tokenize(normalized)) {
    // 所有格剥离属归一化：剥 's 后按普通词条继续（dog's → dog、it's → it）。
    const token = rawToken.replace(POSSESSIVE_RE, "");
    if (token.length === 0) continue; // 裸 's 不产生词条
    if (!isEnglishWord(token)) continue;
    if (excludeProperNouns && isProperNoun(token)) continue;
    if (intake.rejectsContraction(token)) continue;
    const lemma = lemmatizeWord(token);
    if (intake.rejectsAbbreviation(lemma)) continue;
    if (seen.has(lemma)) continue;
    seen.add(lemma);
    entries.push(createWordEntry(lemma));
  }
  return { entries, filteredCount: intake.filteredCount };
}
