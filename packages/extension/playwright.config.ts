import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E 配置（Playwright）。与 vitest 单测天然隔离：
 * vitest 只收 test 目录下的 .test.ts；本目录是 test/e2e 下的 .spec.ts。
 *
 * 关键点：
 * - MV3 扩展必须 persistent context + Chromium（在 fixtures.ts 里启动），
 *   所以这里不配 use:baseURL / projects 的常规浏览器启动。
 * - outputDir 指向 run-e2e.mjs 分配的 run 目录（dist/e2e-artifacts/<runId>/raw），
 *   trace / 截图全部落在同一处，AI 直接读该目录。
 * - workers: 1 — 单一持久 context 共享同一份扩展状态（IndexedDB / chrome.storage），
 *   并行会互相污染；串行是正确性选择。
 */
const runDir = process.env.E2E_RUN_DIR;
const outputDir = runDir
  ? resolve(runDir, "raw")
  : resolve("test-results"); // 直接跑 playwright test 时的默认落点

mkdirSync(outputDir, { recursive: true });

export default defineConfig({
  testDir: "./test/e2e",
  outputDir,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.E2E_REPORTER ?? "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // fixtures.ts 里决定 headless（new headless 支持 --load-extension）；
    // E2E_HEADED=1 / E2E_CHANNEL=chrome 可切换真浏览器观察。
    headless: !process.env.E2E_HEADED,
    channel: process.env.E2E_CHANNEL || undefined,
  },
});
