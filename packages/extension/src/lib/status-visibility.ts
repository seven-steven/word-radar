/**
 * D 状态行互斥的可见性规则（issue #35 重做返工锁定）：确认卡可见时中性
 * （info）状态行隐藏——采集/确认流程以确认卡为主反馈；但 error 态豁免，
 * 始终可见——确认失败时卡片仍开着，错误不能被互斥吞掉（旧版可见，重做
 * 曾引入回归）。
 *
 * 抽成纯函数：popup.ts 是 DOM 胶水层无法单测，语义锁在单测里
 * （test/status-visibility.test.ts）。
 */
export function isStatusLineVisible(
  confirmOpen: boolean,
  tone: string | undefined,
): boolean {
  return !confirmOpen || tone === "error";
}
