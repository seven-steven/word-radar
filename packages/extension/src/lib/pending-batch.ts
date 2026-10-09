import type { WordEntry } from "@word-radar/core";

/**
 * 待确认批次的来源手势（issue #54 Wave D）：SW 四个生产分支（网页采集 /
 * CSV 导入 / 上传文件 / 上传粘贴文本）共用同一驻留批，来源随最新一次
 * 驻留动作记录。
 */
export type BatchSource = "collect" | "import" | "upload";

/** peek 返回的驻留批快照：条目 + 来源（无驻留批时为 null）。 */
export interface PendingBatchState {
  entries: WordEntry[];
  source: BatchSource;
}

/**
 * 待确认批次（CONTEXT.md 领域词）的 SW 内存仓储——单例驻留语义。
 *
 * 领域不变量（issue #22，正式 module 化见 issue #54 Wave D）：
 * - 只存活于 service worker 内存：SW 被杀即丢弃，**永不持久化**；
 * - 单驻留：新批 set 覆盖旧批（采集/导入/上传任一来源）；
 * - 确认消费语义：peek 只读不消费——合并成功才 clear，失败保留批次
 *   （用户重按「确认推送」即可重试，review St-1）；
 * - badge 联动：set / clear 触发 onChange（注册多次按序调用），badge
 *   重算不再由各消息分支手工触发（issue #23 的 "?" 提示）。
 */
export interface PendingBatch {
  /** 驻留新批（单驻留语义：覆盖任何旧批）。 */
  set(entries: WordEntry[], source: BatchSource): void;
  /** 查看当前批次（无则 null）。不消费：确认合并成功才 clear，失败保留。 */
  peek(): PendingBatchState | null;
  /** 清空（确认成功 / DISCARD 共用）。无驻留批时为幂等空操作。 */
  clear(): void;
  /** 当前驻留批来源（无驻留 = null）——popup 覆盖闸门的真相查询。 */
  source(): BatchSource | null;
  /** badge 联动订阅：set / clear 后同步回调（注册多次按序调用）。 */
  onChange(listener: () => void): void;
}

export function createPendingBatch(): PendingBatch {
  let state: PendingBatchState | null = null;
  const listeners: Array<() => void> = [];

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    set(entries, source) {
      state = { entries, source };
      emit();
    },
    peek() {
      // 浅拷贝出站：调用方改返回值不影响驻留批本身
      return state === null ? null : { entries: [...state.entries], source: state.source };
    },
    clear() {
      if (state === null) return; // 幂等：无批可清时不触发 onChange
      state = null;
      emit();
    },
    source() {
      return state === null ? null : state.source;
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
