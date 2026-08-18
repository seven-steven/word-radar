import { extractWordEntries, type WordEntry } from "@word-radar/core";
import {
  WORDS_COLLECTED,
  type CollectResponse,
  type WordsCollectedMessage,
} from "./messages.js";

/**
 * 采集编排（content script 的核心动作，可注入依赖便于单测）：
 *   收集文本 → core 提取词条 → 广播 WORDS_COLLECTED 给 background → 应答词数
 *
 * 架构约束：这里只做提取与发消息，不写 DB、不发 HTTP（spec §扩展行为）。
 */
export interface RunCollectionDeps {
  collectText: () => string;
  /** 广播采集结果给 SW；必须 resolve 在 SW 入库完成后（保证下游 counts 刷新一致）。 */
  broadcast: (message: WordsCollectedMessage) => Promise<unknown>;
  /** 默认 core 的 extractWordEntries。 */
  extract?: (text: string) => WordEntry[];
}

export async function runCollection(deps: RunCollectionDeps): Promise<CollectResponse> {
  const extract = deps.extract ?? extractWordEntries;
  const text = deps.collectText();
  const entries = extract(text);
  await deps.broadcast({ type: WORDS_COLLECTED, entries });
  return { ok: true, count: entries.length };
}
