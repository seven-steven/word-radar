import { ABBREVIATION_BLACKLIST } from "./blacklist.js";

/**
 * 收词过滤的选项。
 *
 * - `filterAbbreviations`（默认 `true`）：缩略词黑名单判据开关。
 * - `filterContractions`（默认 `true`）：缩合形式判据开关。
 * - `abbreviationBlacklist`：注入替代内置黑名单（测试用）；缺省用
 *   `ABBREVIATION_BLACKLIST`。黑名单内容用户不可增删。
 */
export interface IntakeFilterOptions {
  /** 过滤缩略词（黑名单精确命中），默认 true。 */
  filterAbbreviations?: boolean;
  /** 过滤缩合形式（剥离所有格后仍含撇号），默认 true。 */
  filterContractions?: boolean;
  /** 注入替代内置缩略词黑名单（测试用），缺省用 ABBREVIATION_BLACKLIST。 */
  abbreviationBlacklist?: ReadonlySet<string>;
}

/**
 * 收词过滤双判据（ADR-0002 的 word-intake-filter）：缩合形式 + 缩略词黑名单。
 * 这是 extract 管线内部 seam，不上 barrel；测试直载。
 *
 * 判据一（缩合形式）：token（已剥所有格）仍含撇号即拦截——don't、aren't、
 * o'clock；不展开成分词。判据二（缩略词黑名单）：小写 lemma 精确命中即拦截
 * ——docs → doc 命中。
 *
 * 不变量：所有格剥离属归一化，发生在进入本过滤器之前，不受任何开关控制。
 */
export interface IntakeFilter {
  /** 缩合判据：token 应被拦截时返回 true 并计数。 */
  rejectsContraction(token: string): boolean;
  /** 黑名单判据：lemma 应被拦截时返回 true 并计数。 */
  rejectsAbbreviation(lemma: string): boolean;
  /** 拦截的词条数（两判据共享一个 Set 去重，同一词只计一次）。 */
  readonly filteredCount: number;
}

/**
 * 创建收词过滤器。两开关默认全开，缺省黑名单为内置 ABBREVIATION_BLACKLIST；
 * 拦截计数内部用 Set 记账（语义与 extract 管线的 filtered 一致）。
 */
export function createIntakeFilter(
  options?: IntakeFilterOptions,
): IntakeFilter {
  const filterAbbreviations = options?.filterAbbreviations ?? true;
  const filterContractions = options?.filterContractions ?? true;
  const blacklist = options?.abbreviationBlacklist ?? ABBREVIATION_BLACKLIST;
  const filtered = new Set<string>();
  return {
    rejectsContraction(token) {
      // 剥离所有格后仍含撇号 → 缩合形式（缩合计 token 小写）。
      if (!filterContractions || !token.includes("'")) return false;
      filtered.add(token.toLowerCase());
      return true;
    },
    rejectsAbbreviation(lemma) {
      // 词形还原后按小写 lemma 精确命中（黑名单计 lemma）。
      if (!filterAbbreviations || !blacklist.has(lemma)) return false;
      filtered.add(lemma);
      return true;
    },
    get filteredCount() {
      return filtered.size;
    },
  };
}
