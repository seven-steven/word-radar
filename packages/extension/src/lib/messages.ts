import type { WordEntry } from "@word-radar/core";
import type { Counts } from "./word-repository.js";

/**
 * 词库计数。唯一定义在 word-repository（数据层），此处 re-export 供
 * 消息协议使用方免于直连仓储模块。
 */
export type { Counts };

/**
 * 扩展内部消息协议。
 *
 * 流向：
 * - popup → content：`COLLECT_WORDS`（tabs.sendMessage，触发当前页提取）
 * - content → popup：sendResponse 回 `CollectResponse`（同步应答，携带词数）
 * - content → background：`WORDS_COLLECTED`（runtime.sendMessage，携带词条）
 * - popup → background：`GET_COUNTS`（查 total/pending）+ `MARK_PUSHED`（标记已推）
 * - popup → background（T11）：`EXPORT_CSV`（导出词库为 CSV 文本）
 *   + `IMPORT_CSV`（CSV 文本与词库合并，flags 按位或）
 *
 * background 是 WORDS_COLLECTED / GET_COUNTS / MARK_PUSHED / EXPORT_CSV /
 * IMPORT_CSV 的唯一接收方（独占 IndexedDB 写入 + 推送调度 + 所有 HTTP）。
 */

export const COLLECT_WORDS = "COLLECT_WORDS" as const;
export const WORDS_COLLECTED = "WORDS_COLLECTED" as const;
export const GET_COUNTS = "GET_COUNTS" as const;
export const MARK_PUSHED = "MARK_PUSHED" as const;
export const CHECK_LOGIN = "CHECK_LOGIN" as const;
export const RETRY_PUSH = "RETRY_PUSH" as const;
export const GET_PUSH_STATUS = "GET_PUSH_STATUS" as const;
export const EXPORT_CSV = "EXPORT_CSV" as const;
export const IMPORT_CSV = "IMPORT_CSV" as const;

export interface PushStatus {
  phase: "idle" | "running" | "paused" | "completed";
  total: number;
  processed: number;
  succeeded: number;
  existing: number;
  failed: number;
  pending: number;
  current?: string;
  error?: string;
}

export interface RetryPushMessage { type: typeof RETRY_PUSH }
export interface GetPushStatusMessage { type: typeof GET_PUSH_STATUS }

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
 * popup → background（T11）：导出整个词库为 `lemma,flags` CSV 文本。
 * 编解码复用 core 的 stringifyWordListCsv，与 CLI merge 同源。
 * 应答：`ExportCsvResponse`。
 */
export interface ExportCsvMessage {
  type: typeof EXPORT_CSV;
}

/**
 * popup → background（T11）：导入一份 CSV 文本，与现有词库同词合并、
 * flags 按位或（已推词不会被洗回待推；新词按 CSV 自带 flags 值进库）。
 * 解析失败时不产生任何写入，应答 {ok:false,error}（含文件名与行号）。
 * 应答：成功返回最新 `Counts`，失败返回 `{ok:false,error}`。
 */
export interface ImportCsvMessage {
  type: typeof IMPORT_CSV;
  csvText: string;
  /** 源文件名，仅用于错误提示包装。 */
  fileName: string;
}

/** service worker → popup 的导出应答。 */
export type ExportCsvResponse =
  | { ok: true; csv: string }
  | { ok: false; error: string };

/** service worker → popup 的导入应答：成功为最新计数，失败为错误。 */
export type ImportCsvResponse = Counts | { ok: false; error: string };

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
  | CheckLoginMessage
  | RetryPushMessage
  | GetPushStatusMessage
  | ExportCsvMessage
  | ImportCsvMessage;

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

export function isRetryPushMessage(value: unknown): value is RetryPushMessage {
  return isObject(value) && value.type === RETRY_PUSH;
}

export function isGetPushStatusMessage(value: unknown): value is GetPushStatusMessage {
  return isObject(value) && value.type === GET_PUSH_STATUS;
}

export function isExportCsvMessage(value: unknown): value is ExportCsvMessage {
  return isObject(value) && value.type === EXPORT_CSV;
}

export function isImportCsvMessage(
  value: unknown,
): value is ImportCsvMessage {
  return (
    isObject(value) &&
    value.type === IMPORT_CSV &&
    typeof value.csvText === "string" &&
    typeof value.fileName === "string"
  );
}

export function isExportCsvResponse(value: unknown): value is ExportCsvResponse {
  if (!isObject(value)) return false;
  if (value.ok === true) return typeof value.csv === "string";
  if (value.ok === false) return typeof value.error === "string";
  return false;
}

  export function isCheckLoginResponse(value: unknown): value is CheckLoginResponse {
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