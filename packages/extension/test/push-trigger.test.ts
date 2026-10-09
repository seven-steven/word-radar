import { describe, expect, it, vi } from "vitest";
import { admitPushRound } from "../src/lib/push-trigger.js";
import type { PushTriggerDeps } from "../src/lib/push-trigger.js";
import type { PushCoordinator } from "../src/lib/push-coordinator.js";
import type { WordEntry } from "@word-radar/core";

const entry = (lemma: string): WordEntry => ({ lemma, flags: 0 });

/** 纯函数注入的 fake：待推池 / 查库失败 / coordinator 相位均可摆设。 */
function fakeDeps(overrides: {
  pool?: WordEntry[];
  poolRejects?: boolean;
  phase?: "idle" | "running" | "paused" | "completed";
} = {}) {
  const start = vi.fn();
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
  const pushCoordinator = { start, getStatus } as unknown as PushCoordinator;
  const deps: PushTriggerDeps = { repository: { listPending }, pushCoordinator };
  return { deps, start, listPending, getStatus };
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

  describe("login-recovery（登录恢复，issue #36 零词轮不空转）", () => {
    it("待推池为空 → 跳过（不起轮）", async () => {
      const f = fakeDeps({ pool: [] });
      await admitPushRound("login-recovery", f.deps);
      expect(f.start).not.toHaveBeenCalled();
      expect(f.listPending).toHaveBeenCalledTimes(1);
    });

    it("查库 reject → 跳过（吞错不传播，与 resume 语义一致）", async () => {
      const f = fakeDeps({ poolRejects: true });
      await admitPushRound("login-recovery", f.deps);
      expect(f.start).not.toHaveBeenCalled();
    });

    it("待推池非空 → 起轮（非阻塞 fire-and-forget）", async () => {
      const f = fakeDeps({ pool: [entry("garden"), entry("run")] });
      await admitPushRound("login-recovery", f.deps);
      expect(f.start).toHaveBeenCalledTimes(1);
    });

    it("非空 + 非 idle → 仍起轮（login-recovery 不查相位，BUSY 去重归 coordinator）", async () => {
      const f = fakeDeps({ phase: "running" });
      await admitPushRound("login-recovery", f.deps);
      expect(f.start).toHaveBeenCalledTimes(1);
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
