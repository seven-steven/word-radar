/**
 * E2E 全局 teardown：收掉 global-setup 挂的 caffeinate 防睡眠断言与续期
 * 定时器（正常路径；runner 被硬杀时由 setup 侧 `-t 3600` 兜底自动过期，
 * 续期定时器随进程死亡消失）。
 */
const GLOBAL_KEY = "__wordRadarE2eCaffeinate__";

export default function globalTeardown(): void {
  const guard = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
    | { child: { kill: () => void }; timer: { unref: () => void } | undefined }
    | undefined;
  clearInterval(guard?.timer as NodeJS.Timeout | undefined);
  guard?.child.kill(); // 对已退出进程是 no-op
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}
