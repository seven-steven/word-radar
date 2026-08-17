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
}

export const chromeTabsGateway: TabsGateway = {
  async queryActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  },
  sendToTab(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
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
