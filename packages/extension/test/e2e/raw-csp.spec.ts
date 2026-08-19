/**
 * raw.githubusercontent.com 采集回归锁（用户实测症状）。
 *
 * 结论修正（2026-08-19 对照实验）：raw 域的 CSP `sandbox` 响应头【不】阻断
 * content script（本地 fixture + 真实 URL 双验证），早先「CSP 阻断」结论是
 * e2e 标签顺序 bug（bringToFront 早于开 popup → active tab 变成 popup 自身）造成的假阳性。
 * 用户报错的真实机制：扩展（重）加载后旧标签不补注入 declarative content script，
 * 已由 active-tab.ts 的 executeScript 补注入兜底修复（单测锁分支）。
 *
 * 本 spec 锁两件事：
 * 1. 真实 raw URL（text/plain + CSP sandbox 头）整页采集成功
 * 2. 注意标签顺序：popup 必须先开，再把目标页 bringToFront，否则 active tab 是 popup 自己
 */
import { test, expect } from "./fixtures.js";

const RAW_URL =
  "https://raw.githubusercontent.com/mattpocock/skills/refs/heads/main/skills/productivity/grill-me/SKILL.md";

test("real raw.githubusercontent.com page collects (pre-text with CSP sandbox header)", async ({
  extContext,
  popupUrl,
}) => {
  const raw = await extContext.newPage();
  const resp = await raw.goto(RAW_URL, { timeout: 30_000 });
  // 前置事实锁：真实站点确实带 CSP sandbox 头（若 GitHub 改了头，本锁提醒重审）
  expect(resp?.headers()["content-security-policy"] ?? "").toContain("sandbox");
  await raw.waitForTimeout(500);

  // 先开 popup 再 bringToFront：后开者才是 active tab（raw-pre.spec 同款顺序）
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await raw.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("status")).toHaveText(/本次采集 \d+ 词/, {
    timeout: 15_000,
  });
  await popup.close();
  await raw.close();
});
