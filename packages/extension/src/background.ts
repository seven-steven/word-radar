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
import { createBbdcClient } from "./lib/bbdc-client.js";
import { createWordRepository } from "./lib/word-repository.js";
import { cleanupLegacyAutoPush } from "./lib/settings.js";
import {
  createContextMenuListener,
  registerContextMenus,
} from "./lib/context-menu.js";

const HEARTBEAT_KEY = "word-radar-installed";

// 仓库在 SW 启动时实例化；MV3 SW 可能被反复唤醒/休眠，
// 但每次唤醒都会执行本顶层模块，重建仓库引用是廉价的。
const repository = createWordRepository();

// SW 启动时把全局 fetch 注入 BbdcClient；测试场景会直接传 mock fetch。
const bbdcClient = createBbdcClient({ fetch: globalThis.fetch.bind(globalThis) });

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ [HEARTBEAT_KEY]: true });
});

// 右键菜单（issue #40 v1.1-T3，ADR 0001）：onInstalled 在扩展更新时会再次
// 触发，registerContextMenus 内部先 removeAll 再 create（幂等）。
chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
});

// 菜单点击：写唤起标记（storage.session openReason）+ openPopup——popup boot
// 读标记分流（collect 自动采集 / upload 直达上传画布），见 lib/open-reason.ts。
chrome.contextMenus.onClicked.addListener(createContextMenuListener());

// 「自动推送」开关已移除（issue #22）：每次 SW 启动清理旧存储键（幂等）。
void cleanupLegacyAutoPush();

chrome.runtime.onMessage.addListener(
  // resumeOnStart（issue #26）：SW 冷启动时待推池非空且无轮在跑 → 自动起
  // 一轮推送（浏览器启动/扩展更新/事件唤醒 SW 都会执行本顶层模块）。
  createBackgroundListener({ repository, bbdcClient, resumeOnStart: true }),
);

export {};