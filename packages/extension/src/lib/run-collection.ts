import { extractWordEntries, type WordEntry } from "@word-radar/core";
import {
  WORDS_COLLECTED,
  isBatchPreview,
  type CollectResponse,
  type WordsCollectedMessage,
} from "./messages.js";
import { t } from "./i18n.js";

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
  // SW 应答必须是有放回驻留批次的合法 BatchPreview；ack 异常（SW 重启竞态等）
  // 意味着 SW 内存中没有待确认批次，确认页语义已失效——不能谎报
  // newCount=total（review S-4），显式要求用户重新采集。
  if (!isBatchPreview(ack)) {
    return { ok: false, error: t("errorRecollectNeeded") };
  }
  return { ok: true, total: entries.length, newCount: ack.newCount };
}
