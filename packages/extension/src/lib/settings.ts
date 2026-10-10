/**
 * 扩展配置（chrome.storage.local）。
 *
 * 确认闸门定稿（issue #22）后「自动推送」开关已彻底移除：确认即推送是
 * 唯一路径。本模块现负责：
 * - 清理旧版本遗留在 chrome.storage.local 的 `autoPush` 键，避免残留数据；
 * - 收词过滤两开关的读写（issue #43）：`filterAbbreviations` /
 *   `filterContractions`，缺省即 true（不写默认值进 storage，读时兜底）。
 * chrome.* 调用收在可注入网关后面，便于单测。
 */

import { defaultStorageGateway } from "./storage-gateway.js";

/** 旧「自动推送」开关的存储键（v0.1.0 及更早写入）。 */
export const LEGACY_AUTO_PUSH_KEY = "autoPush";

/** 收词过滤开关的存储键（issue #43）：键名与开关语义一一对应。 */
export const FILTER_ABBREVIATIONS_KEY = "filterAbbreviations";
export const FILTER_CONTRACTIONS_KEY = "filterContractions";

/** chrome.storage.local 的最小可注入面。 */
export interface SettingsStorage {
  remove(key: string): Promise<void>;
  get(key: string): Promise<unknown>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function defaultSettingsStorage(): SettingsStorage {
  return defaultStorageGateway("local");
}

/**
 * 清理旧「自动推送」开关的存储键。SW 启动时调用一次（幂等）；
 * 键不存在时 chrome.storage.local.remove 是 no-op，不抛错。
 */
export async function cleanupLegacyAutoPush(
  storage: SettingsStorage = defaultSettingsStorage(),
): Promise<void> {
  await storage.remove(LEGACY_AUTO_PUSH_KEY);
}

/** 收词过滤两开关（issue #43）：网页采集与上传采集的提取过滤判据。 */
export interface IntakeFilterSettings {
  filterAbbreviations: boolean;
  filterContractions: boolean;
}

/**
 * 收词过滤开关缺省值（缺省即全开）：读取兜底与采集降级（run-collection
 * 的 storage 读失败 catch）共用一份，缺省语义只此一处、防漂移。
 */
export const DEFAULT_INTAKE_FILTER_SETTINGS: IntakeFilterSettings = {
  filterAbbreviations: true,
  filterContractions: true,
};

/**
 * 读收词过滤两开关。键缺失（从未写过）或值非 boolean（脏数据）一律按
 * true 兜底——「缺省即全开」，与 core 的 `?? true` 语义一致，不写默认值
 * 进 storage。
 */
export async function getIntakeFilterSettings(
  storage: SettingsStorage = defaultSettingsStorage(),
): Promise<IntakeFilterSettings> {
  const [abbreviations, contractions] = await Promise.all([
    storage.get(FILTER_ABBREVIATIONS_KEY),
    storage.get(FILTER_CONTRACTIONS_KEY),
  ]);
  return {
    filterAbbreviations:
      typeof abbreviations === "boolean" ? abbreviations : DEFAULT_INTAKE_FILTER_SETTINGS.filterAbbreviations,
    filterContractions:
      typeof contractions === "boolean" ? contractions : DEFAULT_INTAKE_FILTER_SETTINGS.filterContractions,
  };
}

/**
 * 写单个收词过滤开关（popup checkbox 的 change 事件逐键写回）。
 * 键名即 storage 键（FILTER_*_KEY 常量），不存在「写默认值」的路径。
 */
export async function setIntakeFilterSetting(
  key: "filterAbbreviations" | "filterContractions",
  value: boolean,
  storage: SettingsStorage = defaultSettingsStorage(),
): Promise<void> {
  await storage.set({ [key]: value });
}
