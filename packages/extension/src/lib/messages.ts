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
 * - content → popup：sendResponse 回 `CollectResponse`（同步应答，携带确认页预览）
 * - content → background：`WORDS_COLLECTED`（runtime.sendMessage，携带词条；
 *   SW 只把批次驻留内存（待确认批次）并应答新词 diff，不写库不推送）
 * - popup → background：`GET_COUNTS`（查 total/pending）+ `MARK_PUSHED`（标记已推）
 *   + `CONFIRM_COLLECTED`（确认：批次合并入词库 + 触发一轮推送全部待推）
 *   + `DISCARD_COLLECTED`（取消：丢弃待确认批次）
 * - popup → background（T11）：`EXPORT_CSV`（导出词库为 CSV 文本）
 *   + `IMPORT_CSV`（CSV 文本同过确认闸门：驻留待确认批次，不直接入库）
 *
 * background 是 WORDS_COLLECTED / GET_COUNTS / MARK_PUSHED / CONFIRM_COLLECTED /
 * DISCARD_COLLECTED / EXPORT_CSV / IMPORT_CSV 的唯一接收方
 * （独占 IndexedDB 写入 + 推送调度 + 所有 HTTP）。
 */

export const COLLECT_WORDS = "COLLECT_WORDS" as const;
export const WORDS_COLLECTED = "WORDS_COLLECTED" as const;
export const CONFIRM_COLLECTED = "CONFIRM_COLLECTED" as const;
export const DISCARD_COLLECTED = "DISCARD_COLLECTED" as const;
export const GET_COUNTS = "GET_COUNTS" as const;
export const MARK_PUSHED = "MARK_PUSHED" as const;
export const CHECK_LOGIN = "CHECK_LOGIN" as const;
export const RETRY_PUSH = "RETRY_PUSH" as const;
export const GET_PUSH_STATUS = "GET_PUSH_STATUS" as const;
export const EXPORT_CSV = "EXPORT_CSV" as const;
export const IMPORT_CSV = "IMPORT_CSV" as const;
export const UPLOAD_FILE = "UPLOAD_FILE" as const;
export const CONSUME_UPLOAD_TARGET = "CONSUME_UPLOAD_TARGET" as const;

/**
 * 上传文件采集允许的纯文本后缀（issue #24 验收修订：放宽到各类纯文本）。
 * popup 文件选择器的 accept 过滤与 SW 的后缀校验共用这一份清单。
 *
 * 注意：这里的 .csv 走自然语言提取管线（extractWordEntries，从文本中
 * 提词），不是 IMPORT_CSV 的 lemma,flags 结构化解析——用户明确决策：
 * 上传入口一律当纯文本，结构化词表只走导入入口。
 */
export const UPLOAD_TEXT_SUFFIXES = [
  "txt",
  "md",
  "markdown",
  "csv",
  "log",
  "text",
  "json",
] as const;

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

/** content → background：一次采集的词条结果（SW 只驻留内存，不入库）。 */
export interface WordsCollectedMessage {
  type: typeof WORDS_COLLECTED;
  entries: WordEntry[];
}

/**
 * 确认页预览：新词 = 与本地词库的 lemma diff（零网络请求）。
 * SW 收到 WORDS_COLLECTED 后应答此结构；content 透传给 popup。
 */
export interface BatchPreview {
  /** 本次采集词条总数。 */
  total: number;
  /** 新词数（本地词库没有的 lemma）。 */
  newCount: number;
}

/** popup → background：确认待确认批次（合并入词库 + 触发一轮推送全部待推）。 */
export interface ConfirmCollectedMessage {
  type: typeof CONFIRM_COLLECTED;
}

/** popup → background：取消（丢弃 SW 内存中的待确认批次）。 */
export interface DiscardCollectedMessage {
  type: typeof DISCARD_COLLECTED;
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
 * popup → background（T11，review S-3 改走确认闸门）：导入一份 CSV 文本。
 * 解析 + 新词 diff 后只驻留待确认批次（与采集批次同形态），应答
 * `BatchPreview`；合并入库与推送仅由 `CONFIRM_COLLECTED` 触发。
 * 解析失败时不产生任何写入，应答 {ok:false,error}（含文件名与行号）。
 */
export interface ImportCsvMessage {
  type: typeof IMPORT_CSV;
  csvText: string;
  /** 源文件名，仅用于错误提示包装。 */
  fileName: string;
}

/**
 * popup → background（issue #24）：消费右键菜单「上传文件」目标标记。
 *
 * 标记由 collect-menu 写入 storage.local（菜单点击发生在 SW 上下文）；
 * 但 chrome.storage 跨上下文传播是最终一致的——popup 若直读 storage，
 * 可能赶在提交落地前读到空值（真机验收 #24：选择器从未弹出）。
 * 改由 popup 发本消息、SW 在同一上下文里读并清掉标记（写读同上下文，
 * 严格有序），应答 `ConsumeUploadTargetResponse`。
 */
export interface ConsumeUploadTargetMessage {
  type: typeof CONSUME_UPLOAD_TARGET;
}

/** service worker → popup 的标记消费应答：true 表示本次打开走上传文件目标。 */
export type ConsumeUploadTargetResponse =
  | { ok: true; uploadRequested: boolean }
  | { ok: false; error: string };

/**
 * popup → background（issue #24 验收修订）：上传一份本地纯文本文件
 * （后缀见 UPLOAD_TEXT_SUFFIXES：txt/md/markdown/csv/log/text/json）。
 * 走与网页采集相同的 core 提取管线（extractWordEntries），提取结果只驻留
 * 待确认批次（与采集/导入批次同形态），应答 `BatchPreview`；入库与推送仅由
 * `CONFIRM_COLLECTED` 触发。与 IMPORT_CSV（lemma,flags CSV）语义不同：
 * 这是自然语言文本，不是结构化词表——即便上传 .csv 也当纯文本提词，
 * 不走结构化解析（用户明确决策）。文件名后缀不合法时零写入，
 * 应答 {ok:false,error}。
 */
export interface UploadFileMessage {
  type: typeof UPLOAD_FILE;
  /** 文件的完整文本（popup 侧 FileReader 读出）。 */
  text: string;
  /** 源文件名：校验后缀（UPLOAD_TEXT_SUFFIXES）+ 错误提示包装。 */
  fileName: string;
}

/** service worker → popup 的导出应答。 */
export type ExportCsvResponse =
  | { ok: true; csv: string }
  | { ok: false; error: string };

/** service worker → popup 的导入应答：成功为待确认批次预览，失败为错误。 */
export type ImportCsvResponse = BatchPreview | { ok: false; error: string };

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
  | ConfirmCollectedMessage
  | DiscardCollectedMessage
  | GetCountsMessage
  | MarkPushedMessage
  | CheckLoginMessage
  | RetryPushMessage
  | GetPushStatusMessage
  | ExportCsvMessage
  | ImportCsvMessage
  | UploadFileMessage
  | ConsumeUploadTargetMessage;

/**
 * content → popup 的同步应答：成功携带确认页预览（总数 + 新词数），
 * 失败携带错误。
 */
export type CollectResponse =
  | ({ ok: true } & BatchPreview)
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

export function isBatchPreview(value: unknown): value is BatchPreview {
  return (
    isObject(value) &&
    typeof value.total === "number" &&
    typeof value.newCount === "number"
  );
}

export function isConfirmCollectedMessage(
  value: unknown,
): value is ConfirmCollectedMessage {
  return isObject(value) && value.type === CONFIRM_COLLECTED;
}

export function isDiscardCollectedMessage(
  value: unknown,
): value is DiscardCollectedMessage {
  return isObject(value) && value.type === DISCARD_COLLECTED;
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

export function isUploadFileMessage(
  value: unknown,
): value is UploadFileMessage {
  return (
    isObject(value) &&
    value.type === UPLOAD_FILE &&
    typeof value.text === "string" &&
    typeof value.fileName === "string"
  );
}

export function isConsumeUploadTargetMessage(
  value: unknown,
): value is ConsumeUploadTargetMessage {
  return isObject(value) && value.type === CONSUME_UPLOAD_TARGET;
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
  if (value.ok === true) return isBatchPreview(value);
  if (value.ok === false) return typeof value.error === "string";
  return false;
}
