/**
 * token 形态判定的零依赖纯函数：判断一个候选 token 是否为合法英文词。
 * 与 lemma/extract 无 import 关系（拆 extract↔lemma 环的单点，issue #54）。
 */

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
/**
 * PascalCase（混合大小写形态）：首字母大写、后续仍出现大写、且含小写
 * （GitHub、XMLHttpRequest、App 组件名）。纯全大写（LONDON、FOX）不在此列
 * ——放行后由提取管线的大小写折叠按小写形继续采集（issue #56，ADR-0003
 * 关联决策；App.tsx 类含路径/数字的仍被上游判据挡掉）。
 */
const PASCAL_RE = /^[A-Z](?=.*[A-Z])(?=.*[a-z])/;
/** 含 `$`（模板变量、jQuery 等）。 */
const DOLLAR_RE = /\$/;
/** 含数字（含纯数字、v2、IPv4 等）。 */
const DIGIT_RE = /\d/;
/** 合法英文词：纯字母，内部可含 `'` / `-`。 */
const WORD_RE = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;

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
