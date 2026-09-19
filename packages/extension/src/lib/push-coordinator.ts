/**
 * 不背单词逐词推送编排器。
 *
 * 该模块不依赖 chrome.*，所有外部动作均由构造参数注入，便于测试和在
 * service worker 中复用。一次运行只读取一次 pending 快照；失败词保持 pending，
 * 下一次运行会重新读取。运行中的轮若收到新的 start 请求，轮正常完成（completed）
 * 后自动补一轮（issue #47），保证「确认即推送」的词不因 BUSY 去重被滞留。
 */
import { BbdcAuthError, type BbdcClient } from "./bbdc-client.js";
import type { ErrorLogEvent } from "./error-log.js";
import type { WordEntry } from "@word-radar/core";

export type PushPhase = "idle" | "running" | "paused" | "completed";

export interface PushProgress {
  phase: PushPhase;
  total: number;
  processed: number;
  succeeded: number;
  existing: number;
  failed: number;
  pending: number;
  current?: string;
  error?: string;
}

export interface PushRepository {
  listPending(): Promise<WordEntry[]>;
  markPushed(lemmas: string[]): Promise<{ total: number; pending: number }>;
}

export interface PushCoordinatorOptions {
  client: Pick<
    BbdcClient,
    "checkLogin" | "checkExisting" | "lookupDefinition" | "addWord"
  >;
  repository: PushRepository;
  sleep?: (milliseconds: number) => Promise<void>;
  onProgress?: (progress: PushProgress) => void;
  /** 错误日志钩子（issue #25）：接口失败/重试耗尽/登录失效暂停时上报。 */
  onError?: (event: ErrorLogEvent) => void;
}

const RETRY_DELAYS: readonly [number, number, number] = [0, 800, 2000];
const WORD_GAP = 400;

export class PushCoordinator {
  private readonly client: PushCoordinatorOptions["client"];
  private readonly repository: PushRepository;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly onProgress?: (progress: PushProgress) => void;
  private readonly onError?: (event: ErrorLogEvent) => void;
  private running: Promise<PushProgress> | null = null;
  /**
   * BUSY 期间被拒的 start 请求标记（issue #47）：运行中的轮正常完成（completed）
   * 后自动再起一轮补推，使轮运行期间新入池的词不被滞留到下次触发。
   * paused/异常收尾不补轮（登录失效时用户应先处理登录，pause 语义优先）。
   */
  private needsAnotherRound = false;
  private progress: PushProgress = emptyProgress();

  constructor(options: PushCoordinatorOptions) {
    this.client = options.client;
    this.repository = options.repository;
    this.sleep = options.sleep ?? defaultSleep;
    this.onProgress = options.onProgress;
    this.onError = options.onError;
  }

  getStatus(): PushProgress {
    return { ...this.progress };
  }

  /**
   * 已运行时返回同一个 promise，保证同一时刻只有一条循环；BUSY 期间的请求
   * 不被吞（issue #47）——置补轮标记，当前轮正常完成后自动再起一轮，把
   * 运行期间新入池的词推走（空轮 drain 亦自然停止，无新请求即无补轮）。
   */
  start(): Promise<PushProgress> {
    if (this.running) {
      this.needsAnotherRound = true;
      return this.running;
    }
    this.running = this.runLoop();
    return this.running;
  }

  /** 单轮生命周期 + 收尾分派（补轮或清理）。running 字段只在此收尾处变更。 */
  private async runLoop(): Promise<PushProgress> {
    try {
      const finished = await this.run();
      if (finished.phase === "completed" && this.needsAnotherRound) {
        // 补轮从 run() 开头完整重跑：emptyProgress 重置计数（空轮的
        // 「推送完成 0」回执正是确认闸门两段式期望的语义）。补轮是
        // fire-and-forget：防御分支（run() 外异常）不得悬空成 unhandled
        // rejection，此 catch 正常不可达。
        this.needsAnotherRound = false;
        const next = this.runLoop();
        next.catch(() => undefined);
        this.running = next;
        return finished;
      }
      this.needsAnotherRound = false;
      this.running = null;
      return finished;
    } catch (error) {
      // 防御性兜底（run() 内部已全捕获，正常不达）：必须清 running，
      // 否则后续 start 永远返回一个已挂死的 promise。
      this.needsAnotherRound = false;
      this.running = null;
      throw error;
    }
  }

  private async run(): Promise<PushProgress> {
    this.update({ ...emptyProgress(), phase: "running" });
    try {
      await this.request("checkLogin");
      const pending = await this.repository.listPending();
      this.update({ ...this.progress, total: pending.length, pending: pending.length });
      let processed = 0;
      for (const entry of pending) {
        this.update({ ...this.progress, current: entry.lemma });
        try {
          const existing = await this.request("checkExisting", entry.lemma);
          if (existing.exists) {
            await this.repository.markPushed([entry.lemma]);
            this.update({ ...this.progress, existing: this.progress.existing + 1 });
          } else {
            const definition = await this.request("lookupDefinition", entry.lemma);
            await this.request("addWord", entry.lemma, definition?.interpret ?? "");
            await this.repository.markPushed([entry.lemma]);
            this.update({ ...this.progress, succeeded: this.progress.succeeded + 1 });
          }
        } catch (error) {
          if (isAuthError(error)) {
            this.onError?.({ stage: "push-pause", word: entry.lemma, summary: errorMessage(error) });
            return this.pause(error);
          }
          this.onError?.({ stage: "push", word: entry.lemma, summary: errorMessage(error) });
          this.update({
            ...this.progress,
            failed: this.progress.failed + 1,
            error: errorMessage(error),
          });
        }
        processed += 1;
        this.update({
          ...this.progress,
          processed,
          pending: Math.max(0, pending.length - processed),
          current: undefined,
        });
        if (processed < pending.length) await this.sleep(WORD_GAP);
      }
      const final = { ...this.progress, phase: "completed" as const, current: undefined };
      this.update(final);
      return final;
    } catch (error) {
      if (isAuthError(error)) {
        this.onError?.({ stage: "push-pause", summary: errorMessage(error) });
        return this.pause(error);
      }
      this.onError?.({ stage: "push", summary: errorMessage(error) });
      const paused = {
        ...this.progress,
        phase: "paused" as const,
        current: undefined,
        error: errorMessage(error),
      };
      this.update(paused);
      return paused;
    }
  }

  private async request<K extends keyof PushCoordinatorOptions["client"]>(
    method: K,
    ...args: Parameters<PushCoordinatorOptions["client"][K]>
  ): Promise<Awaited<ReturnType<PushCoordinatorOptions["client"][K]>>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
      const delay = RETRY_DELAYS[attempt] ?? 0;
      if (delay > 0) await this.sleep(delay);
      try {
        const fn = this.client[method] as (...values: unknown[]) => Promise<unknown>;
        return (await fn(...args)) as Awaited<ReturnType<PushCoordinatorOptions["client"][K]>>;
      } catch (error) {
        lastError = error;
        if (isAuthError(error) || isFourHundredError(error) || attempt === RETRY_DELAYS.length - 1) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private pause(error: unknown): PushProgress {
    const paused = {
      ...this.progress,
      phase: "paused" as const,
      current: undefined,
      error: errorMessage(error),
    };
    this.update(paused);
    return paused;
  }

  private update(progress: PushProgress): void {
    this.progress = progress;
    this.onProgress?.({ ...progress });
  }
}

function emptyProgress(): PushProgress {
  return {
    phase: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    existing: 0,
    failed: 0,
    pending: 0,
  };
}

function isAuthError(error: unknown): boolean {
  return error instanceof BbdcAuthError || (error instanceof Error && error.name === "BbdcAuthError");
}

function isFourHundredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown }).status;
  const resultCode = (error as Error & { resultCode?: unknown }).resultCode;
  return (typeof status === "number" && status >= 400 && status < 500) ||
    (typeof resultCode === "number" && resultCode >= 400 && resultCode < 500);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
