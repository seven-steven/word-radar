/**
 * Background service worker 占位：仅注册一个 install 监听器。
 * 后续工单会在这里接管 IndexedDB 写入、推送调度、所有 HTTP 调用。
 */

const HEARTBEAT_KEY = "word-radar-installed";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ [HEARTBEAT_KEY]: true });
});

chrome.runtime.onMessage.addListener((_msg, _sender, _sendResponse) => {
  // 占位：什么都不做，等后续工单接上消息协议。
  return false;
});

export {};