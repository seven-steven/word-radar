import type { WordEntry } from "./types.js";

/**
 * 取位掩码中「已成功推送到不背单词」对应的位（bit0）。
 */
export const BBDC_PUSHED_FLAG = 1 << 0;

/**
 * 创建一个新词条，flags 默认为 0（全部待推）。
 */
export function createWordEntry(lemma: string, flags: number = 0): WordEntry {
  const normalized = lemma.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("lemma must not be empty");
  }
  return { lemma: normalized, flags };
}

/**
 * 包版本号。
 */
export const CORE_VERSION = "0.1.0" as const;
