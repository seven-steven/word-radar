/**
 * Background service worker 入口。
 *
 * 本张职责（T08 起独占以下能力）：
 * - 唯一 IndexedDB 写入方（通过 WordRepository）
 * - 接收 WORDS_COLLECTED 后与词库合并
 * - 接收 GET_COUNTS / MARK_PUSHED 消息并应答
 *
 * T09 起本入口会再叠加：登录检查 + 所有 HTTP（通过 BbdcClient）。
 * 推送调度（PushCoordinator）留给 T10，本工单只覆盖「登录引导」闭环。
 */
import { createBackgroundListener } from "./lib/background-listener.js";
import { createBbdcClient } from "./lib/bbdc-client.js";
import { createWordRepository } from "./lib/word-repository.js";

const HEARTBEAT_KEY = "word-radar-installed";

// 仓库在 SW 启动时实例化；MV3 SW 可能被反复唤醒/休眠，
// 但每次唤醒都会执行本顶层模块，重建仓库引用是廉价的。
const repository = createWordRepository();

// SW 启动时把全局 fetch 注入 BbdcClient；测试场景会直接传 mock fetch。
const bbdcClient = createBbdcClient({ fetch: globalThis.fetch.bind(globalThis) });

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ [HEARTBEAT_KEY]: true });
});

chrome.runtime.onMessage.addListener(
  createBackgroundListener({ repository, bbdcClient }),
);

export {};