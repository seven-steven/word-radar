/**
 * 扩展配置（chrome.storage.local）。
 *
 * spec §存储：配置（自动推送开关等）存 chrome.storage.local，与词库
 * （IndexedDB）分离。chrome.* 调用收在本模块的可注入网关后面，
 * 便于单测；popup 与 service worker 共用同一读写函数。
 */

/** chrome.storage.local 的最小可注入面。 */
export interface SettingsStorage {
  getAutoPush(): Promise<unknown>;
  setAutoPush(value: boolean): Promise<void>;
}

export const chromeSettingsStorage: SettingsStorage = {
  getAutoPush(): Promise<unknown> {
    return chrome.storage.local.get("autoPush").then((items) => items.autoPush);
  },
  setAutoPush(value: boolean): Promise<void> {
    return chrome.storage.local.set({ autoPush: value });
  },
};

/** 测试等无 chrome 环境下的兜底（始终返回默认开，写入丢弃）。 */
const fallbackSettingsStorage: SettingsStorage = {
  getAutoPush: async () => undefined,
  setAutoPush: async () => undefined,
};

export function defaultSettingsStorage(): SettingsStorage {
  return typeof chrome !== "undefined" && chrome.storage?.local
    ? chromeSettingsStorage
    : fallbackSettingsStorage;
}

/**
 * 读取自动推送开关。未设置 / 类型异常时默认开启（true）。
 * 「重试待推」按钮不受该开关影响，由调用方自行保证始终可用。
 */
export async function readAutoPush(
  storage: SettingsStorage = defaultSettingsStorage(),
): Promise<boolean> {
  const value = await storage.getAutoPush();
  return typeof value === "boolean" ? value : true;
}

/** 写入自动推送开关（popup 切换时调用）。 */
export async function writeAutoPush(
  value: boolean,
  storage: SettingsStorage = defaultSettingsStorage(),
): Promise<void> {
  await storage.setAutoPush(value);
}
