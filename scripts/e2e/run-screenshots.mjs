#!/usr/bin/env node
/**
 * 商店截图生成入口（issue #19）：`pnpm screenshot`
 *
 * 流程：
 *   1) pnpm build（--no-build 可跳过）
 *   2) Playwright 跑 test/e2e/screenshot.spec.ts（复用 e2e 基座：
 *      persistent context + 真实扩展 + mockBbdc + fixtureServer），
 *      截图直接落 docs/chrome-web-store/screenshots/*.png
 *   3) 尺寸硬校验：逐张读 PNG IHDR 真实像素，非 1280×800 → 汇总报错并
 *      非零退出（不信截图脚本自己的日志）
 *
 * 可重复执行：每次先清掉输出目录里的旧 PNG。
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStoreScreenshotSize } from "./png-size.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const EXTENSION_DIR = resolve(REPO_ROOT, "packages/extension");
const OUTPUT_DIR = resolve(REPO_ROOT, "docs/chrome-web-store/screenshots");

const noBuild = process.argv.includes("--no-build");

function runId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

async function main() {
  // 1) build
  if (!noBuild) {
    console.log("[screenshot] building all packages …");
    const build = spawnSync("pnpm", ["build"], { stdio: "inherit", cwd: REPO_ROOT });
    if (build.status !== 0) process.exit(build.status ?? 1);
  } else if (!readdirSync(EXTENSION_DIR).includes("dist")) {
    console.error("[screenshot] --no-build given but packages/extension/dist is missing");
    process.exit(1);
  }

  // 2) 清旧图 + 跑截图 spec
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const old of readdirSync(OUTPUT_DIR)) {
    if (old.endsWith(".png")) rmSync(resolve(OUTPUT_DIR, old));
  }
  const runDir = resolve(REPO_ROOT, `dist/e2e-artifacts/${runId()}-screenshots`);
  mkdirSync(runDir, { recursive: true });
  const playwrightCli = resolve(EXTENSION_DIR, "node_modules/@playwright/test/cli.js");
  const child = spawn(
    process.execPath,
    [playwrightCli, "test", "screenshot.spec.ts", "--reporter=list"],
    {
      cwd: EXTENSION_DIR,
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_RUN_DIR: runDir,
        E2E_SCREENSHOT_DIR: OUTPUT_DIR,
      },
    },
  );
  const exitCode = await new Promise((r) => child.on("exit", r));
  if (exitCode !== 0) {
    console.error(`[screenshot] playwright exited ${exitCode}; artifacts: ${runDir}`);
    process.exit(exitCode ?? 1);
  }

  // 3) 尺寸硬校验（真实像素，非日志）
  const pngs = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".png")).sort();
  if (pngs.length === 0) {
    console.error("[screenshot] no PNGs produced — failing");
    process.exit(1);
  }
  const errors = [];
  for (const name of pngs) {
    const buffer = await readFile(resolve(OUTPUT_DIR, name));
    const result = assertStoreScreenshotSize(buffer, name);
    if (!result.ok) errors.push(...result.errors);
  }
  if (errors.length > 0) {
    console.error(`[screenshot] size check FAILED:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`[screenshot] ${pngs.length} screenshots verified at 1280x800:`);
  for (const name of pngs) console.log(`  ${resolve(OUTPUT_DIR, name)}`);
}

main().catch((err) => {
  console.error("[screenshot]", err);
  process.exit(1);
});
