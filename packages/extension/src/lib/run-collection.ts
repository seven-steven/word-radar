import {
  extractWordEntries,
  type ExtractOptions,
  type ExtractResult,
} from "@word-radar/core";
import {
  WORDS_COLLECTED,
  isBatchPreview,
  type CollectResponse,
  type WordsCollectedMessage,
} from "./messages.js";
import { getIntakeFilterSettings, DEFAULT_INTAKE_FILTER_SETTINGS, type IntakeFilterSettings } from "./settings.js";
import { t } from "./i18n.js";

/**
 * 采集编排（content script 的核心动作，可注入依赖便于单测）：
 *   读收词过滤开关 → 收集文本 → core 提取词条（带开关）→ 广播
 *   WORDS_COLLECTED 给 background → 等 SW 驻留待确认批次并回预览
 *   （总数 + 新词 diff + 过滤数）→ 应答确认页预览
 *
 * 架构约束：这里只做提取与发消息，不写 DB、不发 HTTP（spec §扩展行为）；
 * 采集结果不落库——SW 只把批次驻留内存，等用户「确认」才合并入库（issue #22）。
 */
export interface RunCollectionDeps {
  collectText: () => string;
  /** 广播采集结果给 SW；resolve 在 SW 应答预览后（新词 diff 由词库查询得出）。 */
  broadcast: (message: WordsCollectedMessage) => Promise<unknown>;
  /** 默认 core 的 extractWordEntries。 */
  extract?: (text: string, options?: ExtractOptions) => ExtractResult;
  /**
   * 收词过滤开关读取（issue #43）：默认从 settings 模块读
   * （getIntakeFilterSettings，缺省即全开）；注入仅用于单测。
   */
  getFilterSettings?: () => Promise<IntakeFilterSettings>;
}

export async function runCollection(deps: RunCollectionDeps): Promise<CollectResponse> {
  const extract = deps.extract ?? extractWordEntries;
  const getFilterSettings = deps.getFilterSettings ?? getIntakeFilterSettings;
  // 开关读取失败降级为缺省全开（issue #53-3）：storage 读拒绝（后端损坏/
  // 磁盘 I/O 错误）直接中止采集、裸异常字符串渲染进状态行，比「按缺省
  // 开关多滤/少滤几个词」伤害更大——缺省即全开与 settings.ts 的承诺一致。
  // 取舍与 SW 上传路径（extractWithFilters 不降级、走 upload-failed 显式
  // 反馈）不同：采集批次驻留内存、重试成本低，且失败反馈通道只有状态行。
  const filterSettings = await getFilterSettings().catch(
    () => DEFAULT_INTAKE_FILTER_SETTINGS,
  );
  const text = deps.collectText();
  // 两开关透传给 core；开关语义见 core intake-filter。IntakeFilterSettings 即
  // ExtractOptions 的过滤子集，直传即可——SW 上传路径（background-listener
  // 的 extractWithFilters）同款
  const { entries, filteredCount } = extract(text, filterSettings);
  const ack = await deps.broadcast({ type: WORDS_COLLECTED, entries, filteredCount });
  // SW 应答必须是有放回驻留批次的合法 BatchPreview；ack 异常（SW 重启竞态等）
  // 意味着 SW 内存中没有待确认批次，确认页语义已失效——不能谎报
  // newCount=total（review S-4），显式要求用户重新采集。
  if (!isBatchPreview(ack)) {
    return { ok: false, error: t("errorRecollectNeeded") };
  }
  // filteredCount 是提取发生地的统计：SW 只透传（BatchPreview 回程原样带回），
  // 缺省（undefined）时保持缺省，popup 对缺省与 0 都不渲染过滤行
  return { ok: true, total: entries.length, newCount: ack.newCount, filteredCount: ack.filteredCount };
}
