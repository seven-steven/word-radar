/**
 * E2E 全局 teardown：收掉 global-setup 挂的 caffeinate 防睡眠断言
 * （正常路径；runner 被硬杀时由 setup 侧 `-t 3600` 兜底自动过期）。
 */
const GLOBAL_KEY = "__wordRadarE2eCaffeinate__";

export default function globalTeardown(): void {
  const child = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
    | { kill: () => void }
    | undefined;
  child?.kill();
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}
