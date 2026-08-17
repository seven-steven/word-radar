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
} from "./extract.js";
export { lemmatizeWord, isProperNoun } from "./lemma.js";
