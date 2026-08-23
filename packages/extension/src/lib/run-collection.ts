import { extractWordEntries, type WordEntry } from "@word-radar/core";
import {
  WORDS_COLLECTED,
  isBatchPreview,
  type CollectResponse,
  type WordsCollectedMessage,
} from "./messages.js";

/**
 * 采集编排（content script 的核心动作，可注入依赖便于单测）：
 *   收集文本 → core 提取词条 → 广播 WORDS_COLLECTED 给 background →
 *   等 SW 驻留待确认批次并回预览（总数 + 新词 diff）→ 应答确认页预览
 *
 * 架构约束：这里只做提取与发消息，不写 DB、不发 HTTP（spec §扩展行为）；
 * 采集结果不落库——SW 只把批次驻留内存，等用户「确认」才合并入库（issue #22）。
 */
export interface RunCollectionDeps {
  collectText: () => string;
  /** 广播采集结果给 SW；resolve 在 SW 应答预览后（新词 diff 由词库查询得出）。 */
  broadcast: (message: WordsCollectedMessage) => Promise<unknown>;
  /** 默认 core 的 extractWordEntries。 */
  extract?: (text: string) => WordEntry[];
}

export async function runCollection(deps: RunCollectionDeps): Promise<CollectResponse> {
  const extract = deps.extract ?? extractWordEntries;
  const text = deps.collectText();
  const entries = extract(text);
  const ack = await deps.broadcast({ type: WORDS_COLLECTED, entries });
  const total = entries.length;
  // SW 应答 {total,newCount}；ack 异常（SW 重启竞态等）时保守按全部为新词，
  // 确认页仍可用，diff 数值以 SW 正常应答为准。
  const newCount = isBatchPreview(ack) ? ack.newCount : total;
  return { ok: true, total, newCount };
}
