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

/**
 * 补轮可观测窗口（issue #57）：轮 A 的 completed 回执（「推送完成 成功 N」）
 * 先停留一个弹窗轮询周期以上（popup ~500ms 拉一次状态），getStatus 轮询至少
 * 能观察到一次完成态，再被轮 B 开头的 emptyProgress 重置吞掉。600ms 对
 * 500ms 轮询留出调度余量；不宜过长——窗口期 BUSY 确认的新词要等窗口结束
 * 才被补轮推走。
 */
export const FOLLOW_UP_DELAY_MS = 600;

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

  /**
   * 恢复路径的起轮（issue #57 门控）：仅空闲（无轮在跑、无补轮排队）时触发
   * start()；BUSY 期返回 null——不置补轮标记。补轮标记只属于真实改动待推池
   * 的调用方（确认合并/导入），登录恢复不得借 BUSY 去重制造空转补轮
   * （#36 零词轮守卫语义的延伸：BUSY 期弹窗 boot 的 CHECK_LOGIN 曾无条件
   * 置标记，每次开弹窗都空转出一轮 0/0/0 回执）。
   *
   * 忙判定看 running promise 而非 phase：paused（登录失效暂停）与 completed
   * （轮刚收尾，failed 词仍待推）时 running 已清、轮并未在跑——登录恢复恰是
   * paused 遗留待推的重推入口；补轮可观测窗口期 running 被 deferred promise
   * 占位，同样视为 BUSY。
   */
  startIfIdle(): Promise<PushProgress> | null {
    if (this.running) return null;
    return this.start();
  }

  /**
   * 单轮生命周期 + 收尾分派（补轮或清理）。running 字段只在此收尾处变更。
   */
  private async runLoop(): Promise<PushProgress> {
    try {
      const finished = await this.run();
      if (finished.phase === "completed" && this.needsAnotherRound) {
        // 补轮从 run() 开头完整重跑：emptyProgress 重置计数（空轮的
        // 「推送完成 0」回执正是确认闸门两段式期望的语义）。补轮延迟一个
        // 可观测窗口 spawn（issue #57）：先让轮 A 的 completed 回执被弹窗
        // 轮询观察到，再进轮 B 的 running 重置。窗口期 this.running 已被
        // deferred promise 占位：期间的并发 start() 仍走 BUSY 去重（置
        // 标记、返回同一 deferred promise），「确认即推送」不回归。
        // 补轮链是 fire-and-forget：防御分支（run() 外异常）不得悬空成
        // unhandled rejection，此 catch 正常不可达。
        this.needsAnotherRound = false;
        const next = this.deferredFollowUp();
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

  /** 补轮延迟 spawn：可观测窗口过后完整重跑 runLoop（含后续补轮链）。 */
  private async deferredFollowUp(): Promise<PushProgress> {
    await this.sleep(FOLLOW_UP_DELAY_MS);
    return this.runLoop();
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
