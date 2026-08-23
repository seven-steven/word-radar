/**
 * Content script 入口：只做 chrome 接线。
 *
 * 不自动跑——等 popup 发来 COLLECT_WORDS 才执行一次采集：
 * 收集可见文本 → core 提取 → WORDS_COLLECTED 广播给 background → 应答词数。
 * 架构约束：不写 DB、不发 HTTP（spec §扩展行为）。
 */
import { collectPageText } from "./lib/collect.js";
import { createContentListener } from "./lib/content-listener.js";
import { runCollection } from "./lib/run-collection.js";
import type { WordsCollectedMessage } from "./lib/messages.js";

function broadcast(message: WordsCollectedMessage): Promise<unknown> {
  // 应答预览（SW 驻留待确认批次 + 新词 diff，不写库）；content-listener
  // 持有消息通道直到预览落地，popup 确认页拿到的 total/newCount 与批次一致。
  return chrome.runtime.sendMessage(message);
}

const listener = createContentListener(() =>
  runCollection({
    collectText: () => collectPageText(document, window).text,
    broadcast,
  }),
);

// 幂等守卫：executeScript 是采集主路径（activeTab 瘦身，issue #14），
// 每次采集都会注入本脚本；同一页面的 isolated world 保留全局状态，
// 已注册过 listener 就不再注册，避免重复采集 / 重复广播。
if (!(globalThis as { __wordRadarInjected?: boolean }).__wordRadarInjected) {
  (globalThis as { __wordRadarInjected?: boolean }).__wordRadarInjected = true;
  chrome.runtime.onMessage.addListener(listener);
}

export {};
