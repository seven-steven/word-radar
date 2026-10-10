/**
 * E2E 全局 setup：给整场 Playwright run 挂一条 macOS 防睡眠断言。
 *
 * 为什么（2026-09-10 push.spec 冻结回归的根因取证）：本机 `pmset sleep 1`
 * ——空闲 1 分钟即系统睡眠。Agent 无人值守跑 e2e 时，CLI 的临时 caffeinate
 * 断言随时死亡（pmset 日志 05:56:21 "ClientDied"），跑一半机器进 Sleep
 * Service DarkWake 窗口，窗口到期整机回睡（05:57:22 "Entering Sleep state
 * due to 'Sleep Service Back to Sleep'"）——Chromium/Node/Playwright 全部
 * 冻结在原地，180s 墙钟超时后测试被收割，表现为「推送循环停在词间、
 * push-status 冻结、无新请求、无 SW 重启」的假性回归。
 *
 * 因此 run 期间由 harness 自持断言（`caffeinate -is`），不依赖外部进程的
 * 存活。`-t 3600` 只是「runner 被硬杀时断言最多泄漏 1 小时自动消失」的
 * 兜底，**不是 run 时长上限**（issue #53-1）：长 run（>1h）里 `-t` 到期后
 * 断言静默失效、无任何告警，假回归会原样复发——故定期检查、退出即续
 * spawn，保护线随 run 长度自动延长。非 darwin（CI/Linux）或 caffeinate
 * 缺失时静默跳过。
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const GLOBAL_KEY = "__wordRadarE2eCaffeinate__";

/** 断言续期检查间隔：远小于 `-t 3600` 的 1h 泄漏兜底，长 run 中最多暴露
 *  30 分钟无保护窗口的边缘（恰好检查点前后到期）。 */
const RESPAWN_INTERVAL_MS = 30 * 60 * 1000;

/** globalThis 上挂的守护句柄（teardown 收尾用）。 */
interface CaffeinateGuard {
  child: ChildProcess;
  timer: NodeJS.Timeout;
}

function spawnCaffeinate(): ChildProcess {
  const child = spawn("caffeinate", ["-is", "-t", "3600"], {
    stdio: "ignore",
  });
  child.on("error", () => undefined); // ENOENT 等：无防睡眠能力就裸跑
  return child;
}

export default function globalSetup(): void {
  if (process.platform !== "darwin") return;
  if (spawnSync("caffeinate", ["-v"], { stdio: "ignore" }).error) return;
  const guard: CaffeinateGuard = {
    child: spawnCaffeinate(),
    timer: undefined as unknown as NodeJS.Timeout,
  };
  guard.timer = setInterval(() => {
    // 续期更新 guard.child 本体（teardown kill 的必须是最新实例）
    if (guard.child.exitCode !== null || guard.child.signalCode !== null) {
      guard.child = spawnCaffeinate();
    }
  }, RESPAWN_INTERVAL_MS);
  guard.timer.unref(); // 不阻止 runner 进程自然退出；teardown 仍显式清理
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = guard;
}
