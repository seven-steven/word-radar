import type { WordEntry } from "./types.js";

/**
 * 将多个 WordEntry 列表按 lemma 合并，flags 按位 OR。
 * lemma 比较大小写不敏感，结果统一小写。
 * 返回新数组，不修改输入。
 */
export function mergeWordEntries(...lists: WordEntry[][]): WordEntry[] {
  const map = new Map<string, number>();
  for (const list of lists) {
    for (const entry of list) {
      const key = entry.lemma.toLowerCase();
      const prev = map.get(key);
      map.set(key, prev === undefined ? entry.flags : prev | entry.flags);
    }
  }
  const result: WordEntry[] = [];
  for (const [lemma, flags] of map) {
    result.push({ lemma, flags });
  }
  return result;
}
