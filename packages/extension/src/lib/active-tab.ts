import {
  COLLECT_WORDS,
  isCollectResponse,
  type CollectResponse,
  type CollectWordsMessage,
} from "./messages.js";

/**
 * popup 侧的 Chrome tabs API 边界：全部 chrome.* 调用收在这个小模块，
 * 上层只依赖可注入的 TabsGateway，便于单测。
 *
 * 权限说明：chrome.tabs.query({active,currentWindow}) 只取 tab.id，
 * chrome.tabs.sendMessage 发给我们自己的 content script；
 * 补注入走 chrome.scripting（popup 打开即视为用户手势，activeTab 已授权），
 * 不需要 "tabs" 权限，也不需要任何 <all_urls> host 权限。
 */
export interface TabsGateway {
  queryActiveTabId(): Promise<number | undefined>;
  sendToTab(tabId: number, message: CollectWordsMessage): Promise<unknown>;
  /**
   * 程序化注入 content script（chrome.scripting.executeScript）— 采集主路径。
   * manifest 已无 declarative content script；popup 打开即视为用户手势，
   * activeTab 已授权，每次采集都先注入（content.ts 幂等，重复注入无副作用）。
   */
  injectIntoTab(tabId: number): Promise<void>;
  /** 在新标签页打开 url（popup 内用于「打开不背单词」引导）。 */
  openUrl(url: string): Promise<void>;
}

/**
 * 程序化注入的 content script 产物路径。
 * 构建约定：manifest 已不再声明 declarative content_scripts（activeTab 瘦身，
 * issue #14）。vite.config.ts 的 buildContentScript 插件把 src/content.ts
 * 独立打包为单文件 IIFE，落到稳定路径 assets/content-script.js（不随内容
 * 哈希变化，同步执行 —— crxjs loader 的动态 import 会让紧随的 sendMessage
 * 竞态失败，故不用）。
 * content.ts 侧有幂等守卫，重复注入不会注册重复 listener。
 */
const CONTENT_SCRIPT_FILES = ["assets/content-script.js"];

export const chromeTabsGateway: TabsGateway = {
  async queryActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  },
  sendToTab(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
  },
  async injectIntoTab(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    });
  },
  async openUrl(url) {
    await chrome.tabs.create({ url });
  },
};

/** 采集结果 = 确认页预览（总数 + 新词 diff，issue #22）。 */
export type CollectOutcome =
  | { ok: true; total: number; newCount: number }
  | { ok: false; error: string };

/**
 * 向当前活动标签页请求一次采集：
 * 主路径是先 executeScript 注入再 sendMessage（declarative content script 已移除，
 * activeTab 授权下注入即为正门）；注入或消息任一失败（chrome:// 等不可注入页）
 * 统一归一为 {ok:false}，popup 只负责展示。
 */
export async function requestCollection(
  gateway: TabsGateway,
): Promise<CollectOutcome> {
  const tabId = await gateway.queryActiveTabId();
  if (tabId === undefined) {
    return { ok: false, error: "找不到活动标签页" };
  }
  let raw: unknown;
  try {
    await gateway.injectIntoTab(tabId);
    raw = await gateway.sendToTab(tabId, { type: COLLECT_WORDS });
  } catch {
    return { ok: false, error: "此页面无法采集：chrome:// 等特殊页不支持注入" };
  }
  if (!isCollectResponse(raw)) {
    return { ok: false, error: "content script 未返回有效结果" };
  }
  return narrowToOutcome(raw);
}

function narrowToOutcome(response: CollectResponse): CollectOutcome {
  return response.ok
    ? { ok: true, total: response.total, newCount: response.newCount }
    : { ok: false, error: response.error };
}

/**
 * 「打开不背单词」入口：在新标签页打开目标 URL。
 * 收成可注入函数，便于 popup 单测覆盖（避免直接依赖 chrome.tabs.create）。
 *
 * spec §扩展行为：打开 `https://bbdc.cn/`，不固化深层 login URL。
 * URL 由 popup 决定，本函数只负责转发到网关。
 */
export async function openBbdcHome(
  gateway: TabsGateway,
  url: string,
): Promise<void> {
  await gateway.openUrl(url);
}
