/**
 * 扩展配置（chrome.storage.local）。
 *
 * 确认闸门定稿（issue #22）后「自动推送」开关已彻底移除：确认即推送是
 * 唯一路径。本模块现只负责清理旧版本遗留在 chrome.storage.local 的
 * `autoPush` 键，避免残留数据。chrome.* 调用收在可注入网关后面，便于单测。
 */

/** 旧「自动推送」开关的存储键（v0.1.0 及更早写入）。 */
export const LEGACY_AUTO_PUSH_KEY = "autoPush";

/** chrome.storage.local 的最小可注入面。 */
export interface SettingsStorage {
  remove(key: string): Promise<void>;
}

export const chromeSettingsStorage: SettingsStorage = {
  remove(key: string): Promise<void> {
    return chrome.storage.local.remove(key);
  },
};

/** 测试等无 chrome 环境下的兜底（移除操作丢弃）。 */
const fallbackSettingsStorage: SettingsStorage = {
  remove: async () => undefined,
};

export function defaultSettingsStorage(): SettingsStorage {
  return typeof chrome !== "undefined" && chrome.storage?.local
    ? chromeSettingsStorage
    : fallbackSettingsStorage;
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
