import {
  parseWordListCsv,
  stringifyWordListCsv,
  type WordEntry,
} from "@word-radar/core";
import {
  isCheckLoginMessage,
  isExportCsvMessage,
  isGetCountsMessage,
  isImportCsvMessage,
  isMarkPushedMessage,
  isWordsCollectedMessage,
  isRetryPushMessage,
  isGetPushStatusMessage,
  type CheckLoginResponse,
  type Counts,
  type ExportCsvResponse,
  type ImportCsvResponse,
  type PushStatus,
} from "./messages.js";
import { createBbdcClient, type BbdcClient } from "./bbdc-client.js";
import { chromeActionBadge } from "./action-badge.js";
import { PushCoordinator } from "./push-coordinator.js";
import { defaultSettingsStorage, readAutoPush, type SettingsStorage } from "./settings.js";

/** background 写入的 IndexedDB 仓储边界（service worker 独占）。 */
export interface BackgroundRepository {
  mergeCollected(entries: WordEntry[]): Promise<Counts>;
  getCounts(): Promise<Counts>;
  markPushed(lemmas: string[]): Promise<Counts>;
  listPending(): Promise<WordEntry[]>;
  /** T11：导出全量词条（CSV 导出用）。 */
  getAll(): Promise<WordEntry[]>;
}

/**
 * BbdcClient 的最小面（spec §不背单词对接）。
 * background 持有客户端实例，注入 fetch；上层只调 checkLogin。
 * T10 起会被扩展到 lookupDefinition / checkExisting / addWord / 等。
 */
export interface BackgroundBbdcClient {
  checkLogin(): Promise<{ loggedIn: boolean; resultCode: number }>;
  listNewWords(page: number): Promise<ReturnType<BbdcClient["listNewWords"]> extends Promise<infer T> ? T : never>;
  checkExisting(word: string): ReturnType<BbdcClient["checkExisting"]>;
  lookupDefinition(word: string): ReturnType<BbdcClient["lookupDefinition"]>;
  addWord(word: string, info: string): ReturnType<BbdcClient["addWord"]>;
}

export interface ActionBadgeGateway {
  set(text: string | null): Promise<void>;
}

export interface BackgroundListenerDeps {
  repository: BackgroundRepository;
  /** 注入 BbdcClient（默认 lazy 创建，使用全局 fetch）。 */
  bbdcClient?: BackgroundBbdcClient;
  /** 注入 action badge 网关（默认 lazy 创建 chromeActionBadge）。 */
  actionBadge?: ActionBadgeGateway;
  pushCoordinator?: PushCoordinator;
  /** 注入配置存储（默认 chrome.storage.local 网关）。 */
  settingsStorage?: SettingsStorage;
}

/**
 * service worker 的消息分发器：
 * - WORDS_COLLECTED：合并入 IndexedDB 仓储，返回最新计数（不主动 push 给 sender；
 *   popup 按需用 GET_COUNTS 拉，T09/T10 的推送循环再独立调度）
 * - GET_COUNTS：返回当前计数
 * - MARK_PUSHED：标记指定 lemma 已推，返回最新计数
 * - CHECK_LOGIN（T09）：调 BbdcClient.checkLogin；成功 → 清除 badge；
 *   失败 → 设 badge "!" 并应答 {loggedIn:false}
 * - EXPORT_CSV（T11）：getAll → core stringify，应答 {ok:true,csv}
 * - IMPORT_CSV（T11）：core parse（失败即应答错误，零写入）→ 合并 → 应答新计数
 *
 * 其他消息一律忽略（返回 false，不持有消息通道）。
 *
 * 异步应答（GET_COUNTS / MARK_PUSHED / CHECK_LOGIN / EXPORT_CSV / IMPORT_CSV）
 * 通过 return true 保持消息通道，sendResponse 在仓库 promise resolve 时调用。
 */
export function createBackgroundListener(deps: BackgroundListenerDeps) {
  const bbdcClient = deps.bbdcClient ?? defaultBbdcClient();
  const actionBadge = deps.actionBadge ?? defaultActionBadge();
  const pushCoordinator = deps.pushCoordinator ?? new PushCoordinator({
    client: bbdcClient,
    repository: deps.repository,
  });
  const settingsStorage = deps.settingsStorage ?? defaultSettingsStorage();

  /** 自动合并后是否自动启动推送（受「自动推送」开关控制，默认开）。 */
  const maybeStartPush = async (): Promise<void> => {
    if (await readAutoPush(settingsStorage)) {
      void pushCoordinator.start();
    }
  };

  return (
    message: unknown,
    _sender: unknown,
    sendResponse: (
      response:
        | Counts
        | CheckLoginResponse
        | PushStatus
        | ExportCsvResponse
        | ImportCsvResponse
        | { ok: false; error: string },
    ) => void,
  ): boolean => {
    if (isWordsCollectedMessage(message)) {
      void handleWordsCollected(message.entries, deps.repository, maybeStartPush).catch(() => undefined);
      return false;
    }
    if (isGetCountsMessage(message)) {
      deps.repository
        .getCounts()
        .then(sendResponse, () => sendResponse({ ok: false, error: "counts-failed" }));
      return true;
    }
    if (isMarkPushedMessage(message)) {
      deps.repository
        .markPushed(message.lemmas)
        .then(sendResponse, () => sendResponse({ ok: false, error: "mark-failed" }));
      return true;
    }
    if (isRetryPushMessage(message)) {
      void pushCoordinator.start();
      return false;
    }
    if (isGetPushStatusMessage(message)) {
      sendResponse(pushCoordinator.getStatus());
      return false;
    }
    if (isCheckLoginMessage(message)) {
      handleCheckLogin(bbdcClient, actionBadge, pushCoordinator)
        .then(sendResponse, () => sendResponse({ ok: false, error: "check-login-failed" }));
      return true;
    }
    if (isExportCsvMessage(message)) {
      handleExportCsv(deps.repository)
        .then(sendResponse, () => sendResponse({ ok: false, error: "export-failed" }));
      return true;
    }
    if (isImportCsvMessage(message)) {
      handleImportCsv(message.csvText, message.fileName, deps.repository, maybeStartPush)
        .then(sendResponse, () => sendResponse({ ok: false, error: "import-failed" }));
      return true;
    }
    return false;
  };
}

async function handleWordsCollected(
  entries: WordEntry[],
  repository: BackgroundRepository,
  maybeStartPush: () => Promise<void>,
): Promise<void> {
  await repository.mergeCollected(entries);
  await maybeStartPush();
}

/**
 * T11 导出：getAll → core stringifyWordListCsv（含已推位）。
 * 与 CLI merge 的消费端同源，导出的 CSV 可直接喂给 CLI。
 */
async function handleExportCsv(
  repository: BackgroundRepository,
): Promise<ExportCsvResponse> {
  const entries = await repository.getAll();
  return { ok: true, csv: stringifyWordListCsv(entries) };
}

/**
 * T11 导入：先整体解析（core parseWordListCsv），解析失败直接应答
 * {ok:false,error}（包装文件名 + core 报的行号），不产生任何写入；
 * 解析成功才走 mergeCollected（同词 flags 按位或：已推不洗回待推，
 * 新词按 CSV 自带 flags 值进库），随后对齐 WORDS_COLLECTED 非阻塞触发推送。
 */
async function handleImportCsv(
  csvText: string,
  fileName: string,
  repository: BackgroundRepository,
  maybeStartPush: () => Promise<void>,
): Promise<ImportCsvResponse> {
  let entries: WordEntry[];
  try {
    entries = parseWordListCsv(csvText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${fileName}: ${detail}` };
  }
  const counts = await repository.mergeCollected(entries);
  await maybeStartPush();
  return counts;
}

async function handleCheckLogin(
  bbdcClient: BackgroundBbdcClient,
  actionBadge: ActionBadgeGateway,
  pushCoordinator: PushCoordinator,
): Promise<CheckLoginResponse> {
  try {
    const result = await bbdcClient.checkLogin();
    if (result.loggedIn) {
      // 已登录：清空 badge（用户之前若被标"!"，现在撤销）
      await actionBadge.set(null);
      void pushCoordinator.start();
      return { loggedIn: true };
    }
    await actionBadge.set("!");
    return { loggedIn: false };
  } catch {
    // 任何 BbdcAuthError / BbdcApiError / 网络错误：保守视为未登录 + 提示 badge
    await actionBadge.set("!");
    return { loggedIn: false };
  }
}

// ---------------------------------------------------------------------------
// 默认实现（lazy）：只在注入缺失时构造，避免生产代码额外传参。
// ---------------------------------------------------------------------------

function defaultBbdcClient(): BackgroundBbdcClient {
  return createBbdcClient();
}

function defaultActionBadge(): ActionBadgeGateway {
  return chromeActionBadge;
}