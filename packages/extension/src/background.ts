/**
 * Background service worker 入口。
 *
 * 职责（确认闸门定稿，issue #22）：
 * - 唯一 IndexedDB 写入方（通过 WordRepository）
 * - WORDS_COLLECTED 只把批次驻留内存（待确认批次）并应答新词 diff
 * - CONFIRM_COLLECTED：批次合并入词库 + 触发一轮推送全部待推
 * - 接收 GET_COUNTS / MARK_PUSHED / CHECK_LOGIN / CSV 导入导出等消息
 * - 独占所有 HTTP（BbdcClient）
 */
import { createBackgroundListener } from "./lib/background-listener.js";
import {
  setupCollectMenu,
  handleCollectMenuClick,
} from "./lib/collect-menu.js";
import { createBbdcClient } from "./lib/bbdc-client.js";
import { createWordRepository } from "./lib/word-repository.js";
import { cleanupLegacyAutoPush } from "./lib/settings.js";

const HEARTBEAT_KEY = "word-radar-installed";

// 仓库在 SW 启动时实例化；MV3 SW 可能被反复唤醒/休眠，
// 但每次唤醒都会执行本顶层模块，重建仓库引用是廉价的。
const repository = createWordRepository();

// SW 启动时把全局 fetch 注入 BbdcClient；测试场景会直接传 mock fetch。
const bbdcClient = createBbdcClient({ fetch: globalThis.fetch.bind(globalThis) });

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ [HEARTBEAT_KEY]: true });
  // 采集目标菜单（issue #24）：右键图标出现「上传文件」目标
  void setupCollectMenu(chrome.contextMenus);
});

// context menu 跨 SW 重启持久，但浏览器重启后 onInstalled 不触发——
// onStartup 时补注册（setupCollectMenu 幂等）。
chrome.runtime.onStartup.addListener(() => {
  void setupCollectMenu(chrome.contextMenus);
});

// 右键菜单点「上传文件」：写标记 + best-effort 弹出 popup（popup 消费标记
// 直接进入文件选择器，跳过默认的当前页采集）。
chrome.contextMenus.onClicked.addListener((info) => {
  void handleCollectMenuClick(info, {
    menus: chrome.contextMenus,
    storage: chrome.storage.local,
    action: chrome.action,
  });
});

// 「自动推送」开关已移除（issue #22）：每次 SW 启动清理旧存储键（幂等）。
void cleanupLegacyAutoPush();

chrome.runtime.onMessage.addListener(
  // resumeOnStart（issue #26）：SW 冷启动时待推池非空且无轮在跑 → 自动起
  // 一轮推送（浏览器启动/扩展更新/事件唤醒 SW 都会执行本顶层模块）。
  createBackgroundListener({ repository, bbdcClient, resumeOnStart: true }),
);

export {};