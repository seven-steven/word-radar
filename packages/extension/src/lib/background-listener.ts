import {
  extractWordEntries,
  parseWordListCsv,
  stringifyWordListCsv,
  type ExtractOptions,
  type ExtractResult,
  type WordEntry,
} from "@word-radar/core";
import {
  isCheckLoginMessage,
  isConfirmCollectedMessage,
  isDiscardCollectedMessage,
  isExportCsvMessage,
  isGetBatchStateMessage,
  isGetCountsMessage,
  isImportCsvMessage,
  isUploadFileMessage,
  isUploadTextMessage,
  isWordsCollectedMessage,
  isRetryPushMessage,
  isGetPushStatusMessage,
  suffixOf,
  UPLOAD_TEXT_SUFFIXES,
  type BatchPreview,
  type BatchStateResponse,
  type CheckLoginResponse,
  type Counts,
  type ExportCsvResponse,
  type ImportCsvResponse,
  type PushStatus,
  type UploadedFilePart,
  type WordsCollectedMessage,
} from "./messages.js";
import { createBbdcClient, type BbdcClient } from "./bbdc-client.js";
import { chromeActionBadge, composeBadge } from "./action-badge.js";
import { createPendingBatch, type BatchSource } from "./pending-batch.js";
import { admitPushRound } from "./push-trigger.js";
import { PushCoordinator } from "./push-coordinator.js";
import { createErrorLogger, type ErrorLogger } from "./error-log.js";
import { getIntakeFilterSettings, type IntakeFilterSettings } from "./settings.js";
import { t1, t2 } from "./i18n.js";

/** background 写入的 IndexedDB 仓储边界（service worker 独占）。 */
export interface BackgroundRepository {
  mergeCollected(entries: WordEntry[]): Promise<Counts>;
  /** 确认页新词 diff（lemma 对比本地词库，零网络请求）。 */
  countNew(entries: WordEntry[]): Promise<number>;
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
  set(text: string | null, color?: string): Promise<void>;
}

export interface BackgroundListenerDeps {
  repository: BackgroundRepository;
  /** 注入 BbdcClient（默认 lazy 创建，使用全局 fetch）。 */
  bbdcClient?: BackgroundBbdcClient;
  /** 注入 action badge 网关（默认 lazy 创建 chromeActionBadge）。 */
  actionBadge?: ActionBadgeGateway;
  pushCoordinator?: PushCoordinator;
  /**
   * SW 冷启动推送自动恢复（issue #26）：true 时构造即检查待推池，
   * 非空且无轮在跑则自动起一轮推送（与登录恢复并列的恢复路径，
   * 不是自动推送开关）。仅由 SW 入口 background.ts 传入；单测默认关闭。
   */
  resumeOnStart?: boolean;
  /** 错误日志（issue #25）：默认写 chrome.storage.local 环形缓冲。 */
  errorLogger?: ErrorLogger;
  /**
   * 文本提取管线（issue #24）：默认 core 的 extractWordEntries（与网页采集
   * 同一管线）；注入仅用于单测。SW 只做纯提取，无网络请求。
   */
  extract?: (text: string, options?: ExtractOptions) => ExtractResult;
  /**
   * 收词过滤开关读取（issue #43）：上传两通道提取前从 settings 读
   * （缺省即全开）；注入仅用于单测。网页采集的开关在 content script 侧读，
   * 不经此处。
   */
  getFilterSettings?: () => Promise<IntakeFilterSettings>;
}

/**
 * service worker 的消息分发器（确认闸门定稿，issue #22）：
 * - WORDS_COLLECTED：批次只驻留内存（待确认批次），不写库不推送；
 *   用词库 lemma diff 算新词数，应答 {total,newCount}（零网络请求）
 * - CONFIRM_COLLECTED：确认——批次合并入词库（成功才清空待确认批次，
 *   失败保留以便重试），随后非阻塞触发一轮推送
 *   （覆盖整个待推池，含 CSV 导入的存量）；应答最新计数
 * - DISCARD_COLLECTED：取消——丢弃内存中的待确认批次，不持有通道
 * - GET_COUNTS：返回当前计数
 * - CHECK_LOGIN（T09）：调 BbdcClient.checkLogin；应答 {loggedIn}。
 *   登录状态不写 badge（issue #26）——未登录只在推送 paused 时经 "!" 表达
 * - EXPORT_CSV（T11）：getAll → core stringify，应答 {ok:true,csv}
 * - IMPORT_CSV（review S-3 改走确认闸门）：core parse（失败即应答错误，
 *   零写入）→ countNew 算新词 diff → 驻留待确认批次（与采集批次同形态，
 *   覆盖任何旧批次）→ 应答 {total,newCount}；不写库、不推送，入库与
 *   推送仅由 CONFIRM_COLLECTED 触发
 * - UPLOAD_FILE（issue #24，验收修订；#38 改文件批）：本地纯文本文件批
 *   （UPLOAD_TEXT_SUFFIXES 17 项）整批 = 一次采集——文本合并后走同一 core
 *   提取管线，驻留待确认批次（同采集语义）；任一文件后缀非法 → 整批拒绝、
 *   零写入 + 错误日志 stage=upload。html/xml 已由 popup 侧预处理为纯文本，
 *   这里收到的 text 一律当纯文本。注意：.csv 在这里当纯文本提词，不做
 *   IMPORT_CSV 的结构化解析
 * - UPLOAD_TEXT（issue #42 v1.1-T5 决议 A3）：画布粘贴的纯文本——无文件名/
 *   后缀概念、不过白名单、无双上限，text 直接进同一 core 提取管线，驻留
 *   待确认批次（覆盖旧批次）；错误同样写 stage=upload。粘贴的文件走
 *   UPLOAD_FILE（决议 A4，与拖放同语义），不经本消息
 *
 * 其他消息一律忽略（返回 false，不持有消息通道）。
 *
 * 异步应答（WORDS_COLLECTED / CONFIRM_COLLECTED / GET_COUNTS / CHECK_LOGIN /
 * EXPORT_CSV / IMPORT_CSV / UPLOAD_FILE / UPLOAD_TEXT）通过
 * return true 保持消息通道，sendResponse 在仓库 promise resolve 时调用。
 */
export function createBackgroundListener(deps: BackgroundListenerDeps) {
  const bbdcClient = deps.bbdcClient ?? defaultBbdcClient();
  const actionBadge = deps.actionBadge ?? defaultActionBadge();
  const errorLogger = deps.errorLogger ?? createErrorLogger();
  const getFilterSettings = deps.getFilterSettings ?? getIntakeFilterSettings;
  const pushCoordinator = deps.pushCoordinator ?? new PushCoordinator({
    client: bbdcClient,
    repository: deps.repository,
    // MV3 SW idle keepalive：纯 fetch 循环不会重置 SW 的 30s idle 计时器，
    // 长词表推送到一半 SW 会被静默杀掉。穿插一次扩展 API 调用即可重置。
    sleep: swKeepAliveSleep,
    // badge 进度（issue #23）：每词进度事件驱动 x/y 数字进度。
    onProgress: () => renderBadge(),
    // 错误日志（issue #25）：推送失败/登录失效暂停写入环形缓冲。
    onError: (event) => errorLogger.log(event),
  });
  /**
   * 待确认批次（issue #54 Wave D module 化）：只存活于 SW 内存（issue #22），
   * SW 被杀即丢弃——永不持久化；单驻留（下一次采集/导入/上传覆盖旧批）；
   * peek 只读不消费，确认合并成功才 clear（失败保留重试）。驻留 / 清空的
   * badge 联动由 onChange 订阅统一驱动，生产分支不再手工 renderBadge。
   */
  const pendingBatch = createPendingBatch();

  /** 按优先级合成并写入 badge：推送 x/y > 暂停/完成回执 > 待确认 ?。 */
  const renderBadge = (): void => {
    const spec = composeBadge({
      push: pushCoordinator.getStatus(),
      hasPendingBatch: pendingBatch.source() !== null,
    });
    // badge 写失败不阻塞消息处理（SW 重启后 chrome.action 短暂不可用等）
    void (spec ? actionBadge.set(spec.text, spec.color) : actionBadge.set(null))
      .catch(() => undefined);
  };

  // badge 联动单一挂点（issue #54 Wave D）：批次 set / clear 自动重算。
  pendingBatch.onChange(renderBadge);

  /** 生产分支工作结果的统一形状：成功驻留批 + 预览，失败为已格式化错误。 */
  type ResideOutcome =
    | { entries: WordEntry[]; preview: BatchPreview }
    | { ok: false; error: string };

  /**
   * 四个生产分支（采集/导入/上传文件/上传文本）共用的驻留尾段（issue #54
   * Wave D）：工作 promise 落定后，「驻留 + badge 联动 + 预览应答」只经
   * pendingBatch module 一处（badge 重算由 onChange 订阅自动触发，分支内
   * 不再手工 renderBadge）。
   * - 结果 {ok:false}（解析/校验拒绝，零写入）：错误写环形缓冲 + 原样应答；
   * - 管线异常（reject）：错误写环形缓冲（stage/文案随分支）+ errback 字面量；
   * - 采集分支 stage=null：预览失败无更多细节可报、不写日志（历史语义保持）。
   */
  function resideAndRespond(
    work: Promise<ResideOutcome>,
    branch: {
      source: BatchSource;
      stage: "import" | "upload" | null;
      failText: (error: unknown) => string;
      errback: string;
    },
    respond: (response: BatchPreview | { ok: false; error: string }) => void,
  ): void {
    void work
      .then((result) => {
        if ("entries" in result) {
          pendingBatch.set(result.entries, branch.source);
          respond(result.preview);
          return;
        }
        if (branch.stage !== null) {
          errorLogger.log({ stage: branch.stage, summary: result.error });
        }
        respond(result);
      }, (error: unknown) => {
        if (branch.stage !== null) {
          errorLogger.log({ stage: branch.stage, summary: branch.failText(error) });
        }
        respond({ ok: false, error: branch.errback });
      })
      .catch(() => undefined);
  }

  // SW 冷启动推送自动恢复（issue #26）：待推池非空且无轮在跑 → 自动起一轮。
  if (deps.resumeOnStart === true) {
    void resumePendingPush({ repository: deps.repository, pushCoordinator });
  }

  return (
    message: unknown,
    _sender: unknown,
    sendResponse: (
      response:
        | BatchPreview
        | Counts
        | CheckLoginResponse
        | PushStatus
        | ExportCsvResponse
        | ImportCsvResponse
        | BatchStateResponse
        | { ok: false; error: string },
    ) => void,
  ): boolean => {
    if (isWordsCollectedMessage(message)) {
      // 驻留待确认批次 + 算新词 diff（纯词库查询，零网络）；
      // 持有通道保证 content 侧应答在预览就绪后才返回（popup 确认页拿到
      // 的 total/newCount 一定与本批次一致）。filteredCount 在提取发生地
      // （content script）产生，SW 不消费、只随预览原样回传（issue #43）。
      resideAndRespond(
        handleWordsCollected(message, deps.repository).then(
          (preview): ResideOutcome => ({ entries: message.entries, preview }),
        ),
        { source: "collect", stage: null, failText: () => "", errback: "preview-failed" },
        sendResponse,
      );
      return true;
    }
    if (isConfirmCollectedMessage(message)) {
      const batch = pendingBatch.peek();
      if (batch === null) {
        sendResponse({ ok: false, error: "no-pending-batch" });
        return false;
      }
      // 不在此清空批次（review St-1）：mergeCollected 失败时批次必须保留，
      // 用户重按「确认推送」即可重试；仅在合并成功后 clear。
      void handleConfirm(batch.entries, deps.repository)
        .then((counts) => {
          pendingBatch.clear(); // 合并成功，批次生命周期结束（badge 由 onChange 联动）
          sendResponse(counts);
          // 确认即推送（issue #22 主路径）：合并完成后非阻塞起一轮推送
          // 全部待推（含 CSV 导入的存量）——准入策略见 lib/push-trigger.ts
          void admitPushRound("confirm", { repository: deps.repository, pushCoordinator });
        }, (error: unknown) => {
          // 确认失败（issue #25）：批次保留 + 错误写环形缓冲
          errorLogger.log({
            stage: "confirm",
            summary: t2("errorConfirmMergeFailed", batch.entries.length, errorSummary(error)),
          });
          sendResponse({ ok: false, error: "confirm-failed" });
        })
        .catch(() => undefined);
      return true;
    }
    if (isDiscardCollectedMessage(message)) {
      pendingBatch.clear(); // 批次丢弃：撤销 "?" 提示（badge 由 onChange 联动）
      return false;
    }
    if (isGetBatchStateMessage(message)) {
      // 覆盖闸门的真相查询（issue #54 Wave D）：popup 不再养影子记账
      sendResponse({ source: pendingBatch.source() });
      return false;
    }
    if (isGetCountsMessage(message)) {
      deps.repository
        .getCounts()
        .then(sendResponse, () => sendResponse({ ok: false, error: "counts-failed" }))
        .catch(() => undefined);
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
      handleCheckLogin(bbdcClient, pushCoordinator, deps.repository)
        .then(({ loggedIn }) => {
          // badge 与登录状态解耦（issue #26）：未登录不亮 badge，登录失效经
          // 推送 paused 的 "!" 表达；CHECK_LOGIN 不再写 badge。
          sendResponse(loggedIn ? { loggedIn: true } : { loggedIn: false });
        }, () => {
          sendResponse({ ok: false, error: "check-login-failed" });
        })
        .catch(() => undefined);
      return true;
    }
    if (isExportCsvMessage(message)) {
      handleExportCsv(deps.repository)
        .then(sendResponse, () => sendResponse({ ok: false, error: "export-failed" }))
        .catch(() => undefined);
      return true;
    }
    if (isImportCsvMessage(message)) {
      // CSV 导入同过确认闸门（review S-3）：解析 + 新词 diff → 驻留待确认
      // 批次 → 应答预览。不写库、不推送；入库与推送仅由确认动作触发。
      resideAndRespond(
        handleImportCsv(message.csvText, message.fileName, deps.repository),
        {
          source: "import",
          stage: "import",
          failText: (error) => t1("errorImportFailed", errorSummary(error)),
          errback: "import-failed",
        },
        sendResponse,
      );
      return true;
    }
    if (isUploadFileMessage(message)) {
      // 上传文件采集（issue #24；#38 改文件批）：一次上传的全部文件整批
      // 算一次采集——文本合并后走与网页采集同一 core 提取管线，提取结果只
      // 驻留待确认批次（不写库、不推送，确认动作是唯一入库路径）。
      // html/xml 已由 popup 侧预处理为纯文本，这里收到的 text 一律当纯文本。
      // 与 IMPORT_CSV 的区别：这是自然语言文本，不是 lemma,flags 结构化词表。
      // 提取前读收词过滤开关（issue #43），与网页采集同一判据。
      resideAndRespond(
        handleUploadFile(message.files, {
          repository: deps.repository,
          extract: deps.extract ?? extractWordEntries,
          getFilterSettings,
        }),
        {
          source: "upload",
          stage: "upload",
          failText: (error) => t1("errorUploadFailed", errorSummary(error)),
          errback: "upload-failed",
        },
        sendResponse,
      );
      return true;
    }
    if (isUploadTextMessage(message)) {
      // 上传粘贴文本（issue #42 决议 A3）：text 无文件名/后缀概念，直接进
      // 与网页采集同一 core 提取管线，提取结果只驻留待确认批次（不写库、
      // 不推送，确认动作是唯一入库路径）；驻留即覆盖旧批次。错误日志与
      // UPLOAD_FILE 同 stage=upload（同属上传手势）。提取前读收词过滤开关
      // （issue #43），与网页采集同一判据。
      resideAndRespond(
        handleUploadText(message.text, {
          repository: deps.repository,
          extract: deps.extract ?? extractWordEntries,
          getFilterSettings,
        }),
        {
          source: "upload",
          stage: "upload",
          failText: (error) => t1("errorUploadFailed", errorSummary(error)),
          errback: "upload-failed",
        },
        sendResponse,
      );
      return true;
    }
    return false;
  };
}

/**
 * 采集结果只算预览：新词 = 与本地词库的 lemma diff（零网络请求），
 * 不写库、不推送——入库仅由确认动作（CONFIRM_COLLECTED）触发。
 * filteredCount（issue #43）是提取发生地的统计：SW 不消费、只原样透传进
 * 回程 BatchPreview（保持 popup 侧单一形状）。
 */
async function handleWordsCollected(
  message: WordsCollectedMessage,
  repository: BackgroundRepository,
): Promise<BatchPreview> {
  const newCount = await repository.countNew(message.entries);
  return {
    total: message.entries.length,
    newCount,
    filteredCount: message.filteredCount,
  };
}

/** 确认：待确认批次合并入词库，返回最新计数（推送由调用方在应答后触发）。 */
async function handleConfirm(
  entries: WordEntry[],
  repository: BackgroundRepository,
): Promise<Counts> {
  return repository.mergeCollected(entries);
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
 * T11 导入（review S-3 改走确认闸门）：先整体解析（core parseWordListCsv），
 * 解析失败直接返回 {ok:false,error}（包装文件名 + core 报的行号），不产生
 * 任何写入、不覆盖待确认批次；解析成功算新词 diff（同采集预览，零网络），
 * 返回 {entries,preview} 由调用方驻留为待确认批次——不直接 mergeCollected。
 * （确认后的合并语义：同词 flags 按位或，已推不洗回待推。）
 */
async function handleImportCsv(
  csvText: string,
  fileName: string,
  repository: BackgroundRepository,
): Promise<
  | { entries: WordEntry[]; preview: BatchPreview }
  | { ok: false; error: string }
> {
  let entries: WordEntry[];
  try {
    entries = parseWordListCsv(csvText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${fileName}: ${detail}` };
  }
  const newCount = await repository.countNew(entries);
  return { entries, preview: { total: entries.length, newCount } };
}

/**
 * 上传文件采集（issue #24，验收修订；#38 v1.1-T1 改文件批）：一次上传的
 * 全部文件整批 = 一次采集。先逐文件校验后缀属于 UPLOAD_TEXT_SUFFIXES
 * （17 项纯文本）——任何一个非法 → 整批拒绝、零提取零写入（错误文案含
 * 首个非法文件名与支持后缀清单）；合法则全部文本以空行连接成单文本，
 * 走 core 提取管线（与网页采集同源）→ countNew 算新词 diff（零网络请求），
 * 返回 {entries,preview} 由调用方驻留为待确认批次（驻留即覆盖旧批次，
 * 单驻留语义不变）——不直接 mergeCollected。
 *
 * .csv 特例（用户明确决策）：上传入口的 .csv 走自然语言提取管线（从文本中
 * 提词），不是 IMPORT_CSV 的 lemma,flags 结构化解析——结构化词表只走导入。
 */
async function handleUploadFile(
  files: UploadedFilePart[],
  deps: {
    repository: BackgroundRepository;
    extract: (text: string, options?: ExtractOptions) => ExtractResult;
    getFilterSettings: () => Promise<IntakeFilterSettings>;
  },
): Promise<
  | { entries: WordEntry[]; preview: BatchPreview }
  | { ok: false; error: string }
> {
  // 空批防御（code-review P1）：popup 三入口已挡空数组，这里兜底——空批
  // 穿透会在 SW 驻留 0 词批次（0 词确认卡 + "?" badge）。零写入零驻留。
  if (files.length === 0) {
    return { ok: false, error: "empty-upload-batch" };
  }
  // 后缀校验前置：任何文件非法 → 整批拒绝（issue #38 验收：错误含文件名与清单）。
  // 后缀判定用 messages.ts 的 suffixOf，与 popup 拖放过滤同源（code-review P0：
  // 此前 lower.endsWith(".suffix") 会把点开头的 ".txt" 误判为合法）。
  const allow = new Set<string>(UPLOAD_TEXT_SUFFIXES);
  for (const file of files) {
    if (!allow.has(suffixOf(file.name))) {
      const list = UPLOAD_TEXT_SUFFIXES.map((suffix) => `.${suffix}`).join(" / ");
      return { ok: false, error: t2("errorOnlyTextFiles", file.name, list) };
    }
  }
  // 整批 = 一次采集：全部文件文本合并成单文本，只跑一次提取；
  // 提取前读收词过滤开关（issue #43），与网页采集同一判据
  const text = files.map((file) => file.text).join("\n\n");
  const { entries, filteredCount } = await extractWithFilters(text, deps);
  const newCount = await deps.repository.countNew(entries);
  return { entries, preview: { total: entries.length, newCount, filteredCount } };
}

/**
 * 上传粘贴文本（issue #42 决议 A3）：text 不过白名单、无后缀校验、无上限
 * ——与网页采集的整页文本同一待遇，直接进 core 提取管线 → countNew 算新词
 * diff（零网络请求），返回 {entries,preview} 由调用方驻留为待确认批次
 * （驻留即覆盖旧批次，单驻留语义不变）——不直接 mergeCollected。
 * 空文本防御（sweeper #26，与 UPLOAD_FILE 的空批防御对称）：popup 侧
 * uploadFromPaste 已挡空串，这里是 SW 防御层——全空白文本拒绝，零驻留
 * 零写入。注意：非空文本提取 0 词是合法结果，照常驻留出 0 词卡（与网页
 * 采集空页语义一致），不拦。
 */
async function handleUploadText(
  text: string,
  deps: {
    repository: BackgroundRepository;
    extract: (text: string, options?: ExtractOptions) => ExtractResult;
    getFilterSettings: () => Promise<IntakeFilterSettings>;
  },
): Promise<
  | { entries: WordEntry[]; preview: BatchPreview }
  | { ok: false; error: string }
> {
  if (text.trim() === "") {
    return { ok: false, error: "empty-upload-text" };
  }
  const { entries, filteredCount } = await extractWithFilters(text, deps);
  const newCount = await deps.repository.countNew(entries);
  return { entries, preview: { total: entries.length, newCount, filteredCount } };
}

/**
 * 上传两通道共用的提取段（issue #43）：读收词过滤开关 → 两开关传进
 * extractWordEntries 的 options。开关读取失败按提取失败走 upload-failed
 * 路径（与 countNew 故障同级，不静默降级——过滤语义错比采集失败更糟）。
 */
async function extractWithFilters(
  text: string,
  deps: {
    extract: (text: string, options?: ExtractOptions) => ExtractResult;
    getFilterSettings: () => Promise<IntakeFilterSettings>;
  },
): Promise<ExtractResult> {
  const filterSettings = await deps.getFilterSettings();
  return deps.extract(text, {
    filterAbbreviations: filterSettings.filterAbbreviations,
    filterContractions: filterSettings.filterContractions,
  });
}

/**
 * T09 登录检查：返回 {loggedIn}。badge 与登录状态已解耦（issue #26）——
 * 未登录不写 badge，登录失效由推送 paused 的 "!" 表达。
 */
async function handleCheckLogin(
  bbdcClient: BackgroundBbdcClient,
  pushCoordinator: PushCoordinator,
  repository: Pick<BackgroundRepository, "listPending">,
): Promise<{ loggedIn: boolean }> {
  try {
    const result = await bbdcClient.checkLogin();
    if (result.loggedIn) {
      // 登录恢复轮的准入策略（空池跳过 / 查库失败跳过）已代码化在
      // lib/push-trigger.ts——「确认即推送是唯一路径」的不变量锚点也在那里。
      await admitPushRound("login-recovery", { repository, pushCoordinator });
      return { loggedIn: true };
    }
    return { loggedIn: false };
  } catch {
    // 任何 BbdcAuthError / BbdcApiError / 网络错误：保守视为未登录
    return { loggedIn: false };
  }
}

/**
 * 推送自动恢复（issue #26，spec「推送自动恢复」）：SW 冷启动时若待推池
 * 非空且无推送轮在跑（status 为 idle），自动起一轮推送。覆盖浏览器启动、
 * 扩展安装/更新、任何事件唤醒 SW 的场景；PushCoordinator.start() 自带
 * 去重（已运行时返回同一 promise），调用方无需额外守卫。查库失败静默——
 * 下次 SW 唤醒会再试。
 */
export async function resumePendingPush(
  deps: { repository: Pick<BackgroundRepository, "listPending">; pushCoordinator: PushCoordinator },
): Promise<void> {
  await admitPushRound("cold-start", deps);
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

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 带扩展 API 心跳的 sleep：距上次心跳超过 20s 时调一次
 * `chrome.runtime.getPlatformInfo()`（无副作用的扩展 API 调用会重置 MV3
 * SW 的 idle 计时器），防止长推送循环被 idle kill。非扩展环境（单测）
 * 退化为纯 sleep。
 */
const KEEPALIVE_INTERVAL = 20_000;
let lastKeepalive = 0;

export async function swKeepAliveSleep(milliseconds: number): Promise<void> {
  const runtimeApi = (globalThis as { chrome?: { runtime?: { getPlatformInfo?: () => Promise<unknown> } } })
    .chrome?.runtime;
  if (runtimeApi?.getPlatformInfo && Date.now() - lastKeepalive > KEEPALIVE_INTERVAL) {
    lastKeepalive = Date.now();
    try {
      await runtimeApi.getPlatformInfo();
    } catch {
      // 心跳失败不影响 sleep 语义
    }
  }
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}