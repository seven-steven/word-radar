/**
 * Background service worker 入口（tracer bullet 版）。
 *
 * 本张职责：消费 WORDS_COLLECTED，把最近一次采集摘要写入 storage.local
 * （证明 content → background 链路打通）。不写 DB、不发 HTTP；
 * T08 起这里独占 IndexedDB 写入 + 推送调度 + 所有 HTTP。
 */
import { createBackgroundListener } from "./lib/background-listener.js";

const HEARTBEAT_KEY = "word-radar-installed";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ [HEARTBEAT_KEY]: true });
});

chrome.runtime.onMessage.addListener(
  createBackgroundListener({
    recordCollection: (record) => {
      void chrome.storage.local.set({ lastCollection: record });
    },
  }),
);

export {};
