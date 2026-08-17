/**
 * 不背单词逐词推送编排器。
 *
 * 该模块不依赖 chrome.*，所有外部动作均由构造参数注入，便于测试和在
 * service worker 中复用。一次运行只读取一次 pending 快照；失败词保持 pending，
 * 下一次运行会重新读取。
 */
import { BbdcAuthError, type BbdcClient } from "./bbdc-client.js";
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
}

const RETRY_DELAYS: readonly [number, number, number] = [0, 800, 2000];
const WORD_GAP = 400;

export class PushCoordinator {
  private readonly client: PushCoordinatorOptions["client"];
  private readonly repository: PushRepository;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly onProgress?: (progress: PushProgress) => void;
  private running: Promise<PushProgress> | null = null;
  private progress: PushProgress = emptyProgress();

  constructor(options: PushCoordinatorOptions) {
    this.client = options.client;
    this.repository = options.repository;
    this.sleep = options.sleep ?? defaultSleep;
    this.onProgress = options.onProgress;
  }

  getStatus(): PushProgress {
    return { ...this.progress };
  }

  /** 已运行时返回同一个 promise，保证不会启动第二条循环。 */
  start(): Promise<PushProgress> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
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
            return this.pause(error);
          }
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
      if (isAuthError(error)) return this.pause(error);
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
