import type { WordEntry } from "@word-radar/core";

/**
 * 扩展内部消息协议。
 *
 * 流向：
 * - popup → content：`COLLECT_WORDS`（tabs.sendMessage，触发当前页提取）
 * - content → popup：sendResponse 回 `CollectResponse`（同步应答，携带词数）
 * - content → background：`WORDS_COLLECTED`（runtime.sendMessage，携带词条）
 * - popup → background：`GET_COUNTS`（查 total/pending）+ `MARK_PUSHED`（标记已推）
 *
 * background 是 WORDS_COLLECTED / GET_COUNTS / MARK_PUSHED 的唯一接收方
 * （独占 IndexedDB 写入 + 推送调度 + 所有 HTTP）。
 */

export const COLLECT_WORDS = "COLLECT_WORDS" as const;
export const WORDS_COLLECTED = "WORDS_COLLECTED" as const;
export const GET_COUNTS = "GET_COUNTS" as const;
export const MARK_PUSHED = "MARK_PUSHED" as const;
export const CHECK_LOGIN = "CHECK_LOGIN" as const;

export interface Counts {
  total: number;
  pending: number;
}

/** popup → content：请求对当前活动标签页执行一次采集。 */
export interface CollectWordsMessage {
  type: typeof COLLECT_WORDS;
}

/** content → background：一次采集的词条结果。 */
export interface WordsCollectedMessage {
  type: typeof WORDS_COLLECTED;
  entries: WordEntry[];
}

/** popup → background：查询词库累计 / 待推计数。 */
export interface GetCountsMessage {
  type: typeof GET_COUNTS;
}

/** popup → background：把指定 lemma 标记为「不背单词已推」。 */
export interface MarkPushedMessage {
  type: typeof MARK_PUSHED;
  lemmas: string[];
}

/**
 * popup → background：触发一次 `bbdc.cn/api/check-login`，
 * 由 SW 唯一持有 HTTP（spec §扩展行为）。
 * 应答：`CheckLoginResponse`（见下）。
 */
export interface CheckLoginMessage {
  type: typeof CHECK_LOGIN;
}

/**
 * service worker → popup 的登录检查应答：
 * - `{loggedIn:true}` — 确认已登录
 * - `{loggedIn:false}` — 未登录或接口非 200 result_code
 * - `{ok:false, error}` — 网络/解析失败（auth 错误归一到 loggedIn:false，由 SW 兜底）
 */
export type CheckLoginResponse =
  | { loggedIn: true }
  | { loggedIn: false }
  | { ok: false; error: string };

export type ExtensionMessage =
  | CollectWordsMessage
  | WordsCollectedMessage
  | GetCountsMessage
  | MarkPushedMessage
  | CheckLoginMessage;

/** content → popup 的同步应答。 */
export type CollectResponse =
  | { ok: true; count: number }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWordEntry(value: unknown): value is WordEntry {
  if (!isObject(value)) return false;
  return typeof value.lemma === "string" && typeof value.flags === "number";
}

export function isCollectWordsMessage(value: unknown): value is CollectWordsMessage {
  return isObject(value) && value.type === COLLECT_WORDS;
}

export function isWordsCollectedMessage(
  value: unknown,
): value is WordsCollectedMessage {
  return (
    isObject(value) &&
    value.type === WORDS_COLLECTED &&
    Array.isArray(value.entries) &&
    value.entries.every(isWordEntry)
  );
}

export function isGetCountsMessage(value: unknown): value is GetCountsMessage {
  return isObject(value) && value.type === GET_COUNTS;
}

export function isMarkPushedMessage(
  value: unknown,
): value is MarkPushedMessage {
  return (
    isObject(value) &&
    value.type === MARK_PUSHED &&
    Array.isArray(value.lemmas) &&
    value.lemmas.every((lemma) => typeof lemma === "string")
  );
}

export function isCheckLoginMessage(value: unknown): value is CheckLoginMessage {
  return isObject(value) && value.type === CHECK_LOGIN;
}

export function isCheckLoginResponse(
  value: unknown,
): value is CheckLoginResponse {
  if (!isObject(value)) return false;
  if (value.loggedIn === true) return true;
  if (value.loggedIn === false) return true;
  if (value.ok === false) return typeof value.error === "string";
  return false;
}

export function isCollectResponse(value: unknown): value is CollectResponse {
  if (!isObject(value)) return false;
  if (value.ok === true) return typeof value.count === "number";
  if (value.ok === false) return typeof value.error === "string";
  return false;
}