import type { WordEntry } from "./types.js";
import { isProperNoun, lemmatizeWord } from "./lemma.js";

/**
 * extractWordEntries 的选项。
 *
 * - `excludeProperNouns`（默认 `true`）：用 compromise `#ProperNoun` 排除专名
 *   （人名、地名、品牌名等）；关闭后专名按普通词收录。
 */
export interface ExtractOptions {
  /** 排除专名，默认 true。 */
  excludeProperNouns?: boolean;
}

/**
 * 候选 token 扫描正则。
 *
 * 一次性把「英文词（含内部 ' / -）」以及「URL / email / 路径 / 代码标识符」
 * 都抓成单个候选，避免把 https/example/com 拆成三个词；垃圾候选交给
 * filterToken 拒绝。
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

/** URL：带 scheme 或 www. 前缀。 */
const URL_RE = /^(https?:\/\/|www\.)/i;
/** email：任意 `x@y` 形态。 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
/** 路径：含 `/`（URL 已先行拒绝）。 */
const PATH_RE = /\//;
/** snake_case：含 `_`。 */
const SNAKE_RE = /_/;
/** camelCase：小写后紧跟大写。 */
const CAMEL_RE = /[a-z][A-Z]/;
/** PascalCase：首字母大写且内部再出现大写（如 App.tsx 已被含数字/路径挡掉，此处兜底 XMLHttpRequest）。 */
const PASCAL_RE = /^[A-Z][a-z]*[A-Z]/;
/** 含 `$`（模板变量、jQuery 等）。 */
const DOLLAR_RE = /\$/;
/** 含数字（含纯数字、v2、IPv4 等）。 */
const DIGIT_RE = /\d/;
/** 合法英文词：纯字母，内部可含 `'` / `-`。 */
const WORD_RE = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;

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
 * 判断一个候选 token 是否应被接受为英文词。
 * 拒绝顺序按工单：URL → email → 路径 → snake/camel/Pascal → `$` → 含数字 → 形态校验。
 */
export function isEnglishWord(token: string): boolean {
  if (URL_RE.test(token)) return false;
  if (EMAIL_RE.test(token)) return false;
  if (PATH_RE.test(token)) return false;
  if (SNAKE_RE.test(token)) return false;
  if (CAMEL_RE.test(token)) return false;
  if (PASCAL_RE.test(token)) return false;
  if (DOLLAR_RE.test(token)) return false;
  if (DIGIT_RE.test(token)) return false;
  return WORD_RE.test(token);
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
 * 提取管线（v2，含词形还原与专名排除）：
 * NFKC 规范化 → 候选分词 → 过滤非英文词（+ 可选专名排除）
 * → 词形还原（lemma 聚合前）→ 按 lemma 去重 → `{lemma, flags:0}[]`。
 *
 * 词形还原：compromise（不规则动词表优先 + 保守后缀 fallback），详见 lemma.ts。
 * 纯函数，仅依赖 compromise（纯 JS），扩展与 Node 共用。
 */
export function extractWordEntries(
  text: string,
  options?: ExtractOptions,
): WordEntry[] {
  const excludeProperNouns = options?.excludeProperNouns ?? true;
  const normalized = normalizeText(text);
  const seen = new Set<string>();
  const entries: WordEntry[] = [];
  for (const token of tokenize(normalized)) {
    if (!isEnglishWord(token)) continue;
    if (excludeProperNouns && isProperNoun(token)) continue;
    const lemma = lemmatizeWord(token);
    if (seen.has(lemma)) continue;
    seen.add(lemma);
    entries.push({ lemma, flags: 0 });
  }
  return entries;
}
