import type { WordEntry } from "./types.js";

/**
 * 取位掩码中「已成功推送到不背单词」对应的位（bit0）。
 */
export const BBDC_PUSHED_FLAG = 1 << 0;

/**
 * 创建一个新词条，flags 默认为 0（全部待推）。
 *
 * 占位函数：后续工单会替换为真正的提取管线（NFKC → 分词 → 过滤 → 词形还原 → 去重）。
 */
export function createWordEntry(lemma: string, flags: number = 0): WordEntry {
  const normalized = lemma.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("lemma must not be empty");
  }
  return { lemma: normalized, flags };
}

/**
 * 包版本号（占位常量）。core 的对外契约会在后续工单里扩展。
 */
export const CORE_VERSION = "0.1.0" as const;