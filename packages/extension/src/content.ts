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

function broadcast(message: WordsCollectedMessage): void {
  // background 是常驻接收方（MV3 下 sendMessage 会唤醒 service worker）；
  // 采集结果不依赖回执，投递失败静默忽略。
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

const listener = createContentListener(() =>
  runCollection({
    collectText: () => collectPageText(document, window).text,
    broadcast,
  }),
);

chrome.runtime.onMessage.addListener(listener);

export {};
