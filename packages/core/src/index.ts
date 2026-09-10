export type { WordEntry } from "./types.js";
export {
  BBDC_PUSHED_FLAG,
  CORE_VERSION,
  createWordEntry,
} from "./entry.js";
export {
  extractWordEntries,
  tokenize,
  isEnglishWord,
  normalizeText,
  type ExtractOptions,
  type ExtractResult,
} from "./extract.js";
export { ABBREVIATION_BLACKLIST } from "./blacklist.js";
export { lemmatizeWord, isProperNoun } from "./lemma.js";
export { mergeWordEntries } from "./merge.js";
export { parseWordListCsv, stringifyWordListCsv } from "./csv.js";
