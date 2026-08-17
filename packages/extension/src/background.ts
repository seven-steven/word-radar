/**
 * Background service worker 入口。
 *
 * 本张职责（T08 起独占以下能力）：
 * - 唯一 IndexedDB 写入方（通过 WordRepository）
 * - 接收 WORDS_COLLECTED 后与词库合并
 * - 接收 GET_COUNTS / MARK_PUSHED 消息并应答
 *
 * T09 起本入口会再叠加：登录检查 + PushCoordinator 调度 + 所有 HTTP。
 */
import { createBackgroundListener } from "./lib/background-listener.js";
import { createWordRepository } from "./lib/word-repository.js";

const HEARTBEAT_KEY = "word-radar-installed";

// 仓库在 SW 启动时实例化；MV3 SW 可能被反复唤醒/休眠，
// 但每次唤醒都会执行本顶层模块，重建仓库引用是廉价的。
const repository = createWordRepository();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ [HEARTBEAT_KEY]: true });
});

chrome.runtime.onMessage.addListener(
  createBackgroundListener({ repository }),
);

export {};