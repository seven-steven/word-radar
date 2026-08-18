/**
 * 不背单词（bbdc.cn + langeasy.com.cn）HTTP 客户端。
 *
 * 封装 spec §不背单词对接 实测的 6 个端点，全部以 `credentials: "include"`
 * 发送，依赖浏览器原生 HttpOnly cookie，不读取/转发/上传 cookie。
 *
 * 设计要点：
 * - 构造注入 fetch，便于单测 mock；生产由调用方注入全局 fetch
 *   （service worker 持有 `self.fetch` / `globalThis.fetch`）。
 * - 加词请求不手动设 Content-Type，让浏览器带 multipart boundary（spec 要求）。
 * - 鉴权失败（HTTP 401/403，或 check-login 的非 200）抛 `BbdcAuthError`；
 *   其他 result_code 失败抛 `BbdcApiError`；解析失败抛 `Error`。
 */
import type { WordEntry } from "@word-radar/core";

const BBDC_ORIGIN = "https://bbdc.cn";
const LEXIS_ORIGIN = "https://langeasy.com.cn";

/** 鉴权失败：HTTP 401/403 或 check-login 的非 200 result_code。 */
export class BbdcAuthError extends Error {
  readonly kind: "http" | "check-login";
  readonly status?: number;
  readonly resultCode?: number;

  constructor(
    message: string,
    details:
      | { kind: "http"; status: number }
      | { kind: "check-login"; resultCode: number } = { kind: "http", status: 0 },
  ) {
    super(message);
    this.name = "BbdcAuthError";
    this.kind = details.kind;
    if (details.kind === "http") this.status = details.status;
    else this.resultCode = details.resultCode;
  }
}

/** API 业务失败：HTTP 200 但 result_code !== 200。 */
export class BbdcApiError extends Error {
  readonly resultCode: number;
  constructor(message: string, resultCode: number) {
    super(message);
    this.name = "BbdcApiError";
    this.resultCode = resultCode;
  }
}

/**
 * HTTP 层失败：非 2xx 且非 401/403 的响应（如 404/429/500）。
 * 携带 `status`（HTTP 状态码），供推送编排器按 4xx 不重试分流。
 */
export class BbdcHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BbdcHttpError";
    this.status = status;
  }
}

export interface CheckLoginResult {
  loggedIn: boolean;
  resultCode: number;
}

export interface DefinitionLookupResult {
  interpret: string;
}

/** addWord / removeWords / listNewWords 的统一响应壳：保留 result_code 与 data_body。 */
export interface BbdcResponseBody {
  result_code?: number;
  resultCode?: number;
  data_body?: { list?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface BbdcClient {
  /**
   * 登录检查：`GET /api/check-login`。已登录（result_code 200）返回 `{loggedIn:true}`；
   * result_code 非 200 抛 `BbdcAuthError`，HTTP 401/403 抛 `BbdcAuthError`。
   */
  checkLogin(): Promise<CheckLoginResult>;

  /**
   * 查词释义：`GET langeasy.com.cn/loadLexisList.action?strict=1&word=<w>`。
   * 命中 wordlist[0].interpret 时返回 `{interpret}`；wordlist 为空返回 `null`。
   */
  lookupDefinition(word: string): Promise<DefinitionLookupResult | null>;

  /**
   * 查重：`GET /api/check-new-word?word=<w>&infoidx=100`。
   * `data_body.list` 非空 → `{exists:true}`。
   */
  checkExisting(word: string): Promise<{ exists: boolean }>;

  /**
   * 加词：`POST /api/user-new-word`，FormData 字段 `newwordlist` = JSON 串
   * `{word, info, course:"*", wordidx:"*", infoidx:"100", selection:"*", opcode:"1"}`。
   * 不手动设 Content-Type（spec 要求）。result_code !== 200 抛 `BbdcApiError`。
   */
  addWord(word: string, info: string): Promise<void>;

  /**
   * 生词列表：`GET /api/user-new-word?page=<N>`，返回远端 JSON 整体
   * （含 result_code + data_body），让上层按 data_body.list 解析。
   */
  listNewWords(page: number): Promise<BbdcResponseBody>;

  /**
   * 删词：`POST /api/remove-user-new-word`，FormData 字段 `newwordlist` = 逗号分隔词串。
   * 鉴权失败抛 `BbdcAuthError`；result_code !== 200 抛 `BbdcApiError`。
   */
  removeWords(words: string[]): Promise<void>;
}

export interface BbdcClientOptions {
  /** 注入 fetch（默认使用全局 fetch）。生产由 SW 启动时把全局 fetch 注入。 */
  fetch?: typeof fetch;
}

export function createBbdcClient(options: BbdcClientOptions = {}): BbdcClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    async checkLogin(): Promise<CheckLoginResult> {
      const response = await send(
        fetchImpl,
        `${BBDC_ORIGIN}/api/check-login`,
        { method: "GET", credentials: "include" },
      );
      assertAcceptableStatus(response);
      const body = await parseJson(response);
      const resultCode = readResultCode(body);
      if (resultCode !== 200) {
        throw new BbdcAuthError(
          `check-login failed: result_code=${String(resultCode)}`,
          { kind: "check-login", resultCode },
        );
      }
      return { loggedIn: true, resultCode };
    },

    async lookupDefinition(word: string): Promise<DefinitionLookupResult | null> {
      const url = `${LEXIS_ORIGIN}/loadLexisList.action?strict=1&word=${encodeURIComponent(word)}`;
      const response = await send(
        fetchImpl,
        url,
        { method: "GET", credentials: "include" },
      );
      assertAcceptableStatus(response);
      const body = await parseJson(response);
      const interpret = readFirstInterpret(body);
      return interpret === null ? null : { interpret };
    },

    async checkExisting(word: string): Promise<{ exists: boolean }> {
      const url = `${BBDC_ORIGIN}/api/check-new-word?word=${encodeURIComponent(word)}&infoidx=100`;
      const response = await send(
        fetchImpl,
        url,
        { method: "GET", credentials: "include" },
      );
      assertAcceptableStatus(response);
      const body = await parseJson(response);
      const list = readDataBodyList(body);
      return { exists: Array.isArray(list) && list.length > 0 };
    },

    async addWord(word: string, info: string): Promise<void> {
      const newWordList = JSON.stringify([
        {
          word,
          info,
          course: "*",
          wordidx: "*",
          infoidx: "100",
          selection: "*",
          opcode: "1",
        },
      ]);
      const form = new FormData();
      form.set("newwordlist", newWordList);
      const response = await send(
        fetchImpl,
        `${BBDC_ORIGIN}/api/user-new-word`,
        {
          method: "POST",
          credentials: "include",
          body: form,
          // 不手动设 Content-Type，让浏览器带 multipart boundary。
        },
      );
      assertAcceptableStatus(response);
      const body = await parseJson(response);
      const resultCode = readResultCode(body);
      if (resultCode !== 200) {
        throw new BbdcApiError(
          `addWord failed: result_code=${String(resultCode)}`,
          resultCode,
        );
      }
    },

    async listNewWords(page: number): Promise<BbdcResponseBody> {
      const url = `${BBDC_ORIGIN}/api/user-new-word?page=${encodeURIComponent(String(page))}`;
      const response = await send(
        fetchImpl,
        url,
        { method: "GET", credentials: "include" },
      );
      assertAcceptableStatus(response);
      return (await parseJson(response)) as BbdcResponseBody;
    },

    async removeWords(words: string[]): Promise<void> {
      const form = new FormData();
      form.set("newwordlist", words.join(","));
      const response = await send(
        fetchImpl,
        `${BBDC_ORIGIN}/api/remove-user-new-word`,
        {
          method: "POST",
          credentials: "include",
          body: form,
        },
      );
      assertAcceptableStatus(response);
      const body = await parseJson(response);
      const resultCode = readResultCode(body);
      if (resultCode !== 200) {
        throw new BbdcApiError(
          `removeWords failed: result_code=${String(resultCode)}`,
          resultCode,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface RequestInit {
  method: "GET" | "POST";
  credentials: "include";
  body?: FormData;
}

async function send(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  // 故意不设 headers：让浏览器自行加 Content-Type（multipart/form-data 含 boundary）。
  // 这是 spec §不背单词对接 对加词端点的硬性要求。
  return fetchImpl(url, init);
}

function assertAcceptableStatus(response: Response): void {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new BbdcAuthError(`bbdc HTTP ${String(response.status)}`, {
      kind: "http",
      status: response.status,
    });
  }
  throw new BbdcHttpError(`bbdc HTTP ${String(response.status)}`, response.status);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(
      `bbdc response not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function readResultCode(body: unknown): number {
  if (typeof body !== "object" || body === null) return Number.NaN;
  const obj = body as Record<string, unknown>;
  if (typeof obj.result_code === "number") return obj.result_code;
  if (typeof obj.resultCode === "number") return obj.resultCode;
  return Number.NaN;
}

function readDataBodyList(body: unknown): unknown[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const dataBody = (body as Record<string, unknown>).data_body;
  if (typeof dataBody !== "object" || dataBody === null) return undefined;
  const list = (dataBody as Record<string, unknown>).list;
  return Array.isArray(list) ? list : undefined;
}

function readFirstInterpret(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const wordlist = (body as Record<string, unknown>).wordlist;
  if (!Array.isArray(wordlist) || wordlist.length === 0) return null;
  const first = wordlist[0];
  if (typeof first !== "object" || first === null) return null;
  const interpret = (first as Record<string, unknown>).interpret;
  return typeof interpret === "string" ? interpret : null;
}

// ---------------------------------------------------------------------------
// 列出当前导出，便于模块可见性自检
// ---------------------------------------------------------------------------

export type { WordEntry };