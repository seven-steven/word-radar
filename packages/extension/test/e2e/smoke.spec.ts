/**
 * L1 加载冒烟：扩展加载成功、SW 注册、无致命错误。
 * 全部零外部网络（mockBbdc 已在 worker 层拦截 bbdc / langeasy）。
 */
import { test, expect } from "./fixtures.js";

test("extension loads and service worker registers", async ({
  extContext,
  extensionId,
}) => {
  expect(extensionId).toBeTruthy();
  // 至少有一个存活的 service worker（加载成功的硬标志）
  const workers = extContext.serviceWorkers();
  expect(workers.length).toBeGreaterThan(0);
  expect(workers[0].url()).toContain(extensionId);
});

test("no fatal errors in service worker console at startup", async ({
  swConsole,
}) => {
  const fatal = swConsole.lines.filter(
    (line) => line.includes("[sw] error:") && !line.includes("favicon"),
  );
  // 启动期不允许 error 级 console 输出（favicon 404 之类噪音除外）
  expect(fatal).toEqual([]);
});
