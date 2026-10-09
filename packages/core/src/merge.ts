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
    // 不走 createWordEntry：它 trim 且对空白 lemma 抛错，而 merge 接受任意
    // 输入词条（不 trim、原样小写），替换会改变对未规范化输入的行为。
    result.push({ lemma, flags });
  }
  return result;
}
