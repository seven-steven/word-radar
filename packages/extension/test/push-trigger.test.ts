import { describe, expect, it, vi } from "vitest";
import { admitPushRound } from "../src/lib/push-trigger.js";
import type { PushTriggerDeps } from "../src/lib/push-trigger.js";
import type { PushCoordinator } from "../src/lib/push-coordinator.js";
import type { WordEntry } from "@word-radar/core";

const entry = (lemma: string): WordEntry => ({ lemma, flags: 0 });

/** 纯函数注入的 fake：待推池 / 查库失败 / coordinator 忙闲均可摆设。 */
function fakeDeps(overrides: {
  pool?: WordEntry[];
  poolRejects?: boolean;
  phase?: "idle" | "running" | "paused" | "completed";
  busy?: boolean;
} = {}) {
  const start = vi.fn();
  // startIfIdle 的 BUSY 判定独立于 phase（看的是 running promise），
  // fake 用显式 busy 开关模拟，缺省按 phase 派生。
  const busy = overrides.busy ?? (overrides.phase ? overrides.phase === "running" : false);
  const startIfIdle = vi.fn(() => (busy ? null : Promise.resolve({
    phase: "completed" as const,
    total: 0,
    processed: 0,
    succeeded: 0,
    existing: 0,
    failed: 0,
    pending: 0,
  })));
  const listPending = overrides.poolRejects
    ? vi.fn(async (): Promise<WordEntry[]> => {
        throw new Error("db boom");
      })
    : vi.fn(async (): Promise<WordEntry[]> => overrides.pool ?? [entry("garden")]);
  const getStatus = vi.fn(() => ({
    phase: overrides.phase ?? "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    existing: 0,
    failed: 0,
    pending: 0,
  }));
  const pushCoordinator = { start, startIfIdle, getStatus } as unknown as PushCoordinator;
  const deps: PushTriggerDeps = { repository: { listPending }, pushCoordinator };
  return { deps, start, startIfIdle, listPending, getStatus };
}

describe("admitPushRound", () => {
  describe("confirm（确认即推送的唯一主路径，issue #22）", () => {
    it("恒起轮：不查待推池、不看相位——空池、非 idle 照样无条件 start", async () => {
      const empty = fakeDeps({ pool: [] });
      await admitPushRound("confirm", empty.deps);
      expect(empty.start).toHaveBeenCalledTimes(1);
      expect(empty.listPending).not.toHaveBeenCalled();

      const running = fakeDeps({ phase: "running" });
      await admitPushRound("confirm", running.deps);
      expect(running.start).toHaveBeenCalledTimes(1);
      expect(running.listPending).not.toHaveBeenCalled();
    });
  });

  describe("login-recovery（登录恢复，issue #36 零词轮不空转 + #57 门控）", () => {
    it("待推池为空 → 跳过（不起轮）", async () => {
      const f = fakeDeps({ pool: [] });
      await admitPushRound("login-recovery", f.deps);
      expect(f.startIfIdle).not.toHaveBeenCalled();
      expect(f.listPending).toHaveBeenCalledTimes(1);
    });

    it("查库 reject → 跳过（吞错不传播，与 resume 语义一致）", async () => {
      const f = fakeDeps({ poolRejects: true });
      await admitPushRound("login-recovery", f.deps);
      expect(f.startIfIdle).not.toHaveBeenCalled();
    });

    it("待推池非空且空闲 → 起轮（startIfIdle，非阻塞 fire-and-forget）", async () => {
      const f = fakeDeps({ pool: [entry("garden"), entry("run")] });
      await admitPushRound("login-recovery", f.deps);
      expect(f.startIfIdle).toHaveBeenCalledTimes(1);
      expect(f.start).not.toHaveBeenCalled();
    });

    it("BUSY（有轮在跑/补轮排队）→ 不起轮、不置补轮标记（issue #57 门控）", async () => {
      // 弹窗 boot 的 CHECK_LOGIN 走本路径：BUSY 期无条件 start() 会置补轮
      // 标记，轮 A 收尾后空转出一轮 0/0/0 回执（#36 语义回归）。退化规则：
      // 只由真实改动待推池的调用方（confirm）置补轮标记。
      const f = fakeDeps({ phase: "running", busy: true });
      await admitPushRound("login-recovery", f.deps);
      expect(f.startIfIdle).toHaveBeenCalledTimes(1); // 查过忙闲
      const result = await f.startIfIdle.mock.results[0]?.value;
      expect(result).toBeNull(); // startIfIdle 返回 null = 未起轮
      expect(f.start).not.toHaveBeenCalled(); // 不走置标记的 start()
    });

    it("paused/completed 收尾后（无轮在跑）→ 照常起轮：登录恢复是 paused 遗留待推的重推入口", async () => {
      // startIfIdle 的忙判定看 running promise 而非 phase：paused（登录失效
      // 暂停）与 completed（轮刚完成，failed 词仍待推）都不是 BUSY。
      const f = fakeDeps({ phase: "paused", busy: false });
      await admitPushRound("login-recovery", f.deps);
      expect(f.startIfIdle).toHaveBeenCalledTimes(1);
      expect(f.start).not.toHaveBeenCalled();
    });
  });

  describe("cold-start（SW 冷启动恢复，issue #26）", () => {
    it("待推池为空 → 跳过（不起轮、不查相位）", async () => {
      const f = fakeDeps({ pool: [] });
      await admitPushRound("cold-start", f.deps);
      expect(f.start).not.toHaveBeenCalled();
      expect(f.getStatus).not.toHaveBeenCalled();
    });

    it("非空但已有轮在跑（非 idle）→ 不抢轮，跳过", async () => {
      const f = fakeDeps({ phase: "running" });
      await admitPushRound("cold-start", f.deps);
      expect(f.start).not.toHaveBeenCalled();
    });

    it("非空 + idle → 起轮", async () => {
      const f = fakeDeps();
      await admitPushRound("cold-start", f.deps);
      expect(f.start).toHaveBeenCalledTimes(1);
    });

    it("查库 reject → 跳过（下次 SW 唤醒再试）", async () => {
      const f = fakeDeps({ poolRejects: true });
      await admitPushRound("cold-start", f.deps);
      expect(f.start).not.toHaveBeenCalled();
    });
  });
});
