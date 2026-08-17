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
 * chrome.tabs.sendMessage 发给我们自己的 content script，
 * 两者都不需要 "tabs"/"activeTab" 权限，manifest 保持最小。
 */
export interface TabsGateway {
  queryActiveTabId(): Promise<number | undefined>;
  sendToTab(tabId: number, message: CollectWordsMessage): Promise<unknown>;
  /** 在新标签页打开 url（popup 内用于「打开不背单词」引导）。 */
  openUrl(url: string): Promise<void>;
}

export const chromeTabsGateway: TabsGateway = {
  async queryActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  },
  sendToTab(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
  },
  async openUrl(url) {
    await chrome.tabs.create({ url });
  },
};

export type CollectOutcome =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * 向当前活动标签页请求一次采集：
 * 无活动标签 / content script 未注入（chrome:// 等）/ 应答形态非法
 * 都归一为 {ok:false}，popup 只负责展示。
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
    raw = await gateway.sendToTab(tabId, { type: COLLECT_WORDS });
  } catch {
    return { ok: false, error: "此页面无法采集（content script 未注入）" };
  }
  if (!isCollectResponse(raw)) {
    return { ok: false, error: "content script 未返回有效结果" };
  }
  return narrowToOutcome(raw);
}

function narrowToOutcome(response: CollectResponse): CollectOutcome {
  return response.ok
    ? { ok: true, count: response.count }
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
