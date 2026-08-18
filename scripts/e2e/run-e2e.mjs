#!/usr/bin/env node
/**
 * E2E runner：AI 自验证的单一入口。
 *
 * 用法：
 *   node scripts/e2e/run-e2e.mjs [--no-build] [--grep <pattern>] [--headed] [--channel <name>] [-- <playwright args>]
 *   pnpm e2e                # 全量（build + 跑全部场景）
 *   pnpm e2e --no-build     # 跳过 build（刚 build 过时用）
 *   pnpm e2e -- --grep push # 只跑 push 层
 *
 * 产出（AI 优先读 result.json）：
 *   dist/e2e-artifacts/<runId>/result.json   — 机器可读汇总（场景 pass/fail + 错误 + artifact 相对路径）
 *   dist/e2e-artifacts/<runId>/raw/          — Playwright outputDir（trace.zip / 失败截图 / sw-console 附件）
 *   dist/e2e-artifacts/<runId>/stdout.log    — 全量 stdout/stderr
 *
 * 保留最近 5 个 run，更旧的自动清理。
 *
 * 实现注记（spike 验证点 1 的回退方案落点）：
 * 若 context.route() 无法拦截 service worker 发起的 fetch，本脚本预留
 * E2E_PROXY_ORIGIN 环境变量：基座可改为起本地 mock server + CDP 域名重定向，
 * 无需改 spec。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const EXTENSION_DIR = resolve(REPO_ROOT, "packages/extension");
const ARTIFACTS_ROOT = resolve(REPO_ROOT, "dist/e2e-artifacts");
const KEEP_RUNS = 5;

const argv = process.argv.slice(2);
const noBuild = argv.includes("--no-build");
const headed = argv.includes("--headed");
const grepIndex = argv.indexOf("--grep");
const channelIndex = argv.indexOf("--channel");
const passthroughIndex = argv.indexOf("--");
const playwrightArgs = passthroughIndex >= 0 ? argv.slice(passthroughIndex + 1) : [];
const passthroughGrep =
  passthroughIndex >= 0 && playwrightArgs.indexOf("--grep") >= 0
    ? playwrightArgs[playwrightArgs.indexOf("--grep") + 1]
    : undefined;

function runId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function cleanupOldRuns() {
  if (!existsSync(ARTIFACTS_ROOT)) return;
  const runs = readdirSync(ARTIFACTS_ROOT)
    .filter((name) => /^\d{8}-\d{6}/.test(name))
    .sort();
  while (runs.length > KEEP_RUNS - 1) {
    const victim = runs.shift();
    if (victim) rmSync(resolve(ARTIFACTS_ROOT, victim), { recursive: true, force: true });
  }
}

function exec(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...opts });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const id = runId();
  const runDir = resolve(ARTIFACTS_ROOT, id);
  mkdirSync(runDir, { recursive: true });
  cleanupOldRuns();

  // 1) build（--no-build 跳过）
  if (!noBuild) {
    console.log(`[e2e] building all packages …`);
    exec("pnpm", ["build"], { cwd: REPO_ROOT });
  } else if (!existsSync(resolve(EXTENSION_DIR, "dist/manifest.json"))) {
    console.error("[e2e] --no-build given but packages/extension/dist/manifest.json is missing. Run build first.");
    process.exit(1);
  }

  // 2) 跑 Playwright（json reporter 到 stdout，同时 tee 到 log）
  const env = {
    ...process.env,
    E2E_RUN_DIR: runDir,
    E2E_REPORTER: "json",
    ...(headed ? { E2E_HEADED: "1" } : {}),
    ...(channelIndex >= 0 ? { E2E_CHANNEL: argv[channelIndex + 1] } : {}),
  };
  const grep = passthroughGrep ?? (grepIndex >= 0 ? argv[grepIndex + 1] : undefined);
  // 直接用 node 跑 playwright cli（避免后台/沙箱环境 spawn pnpm 的 PATH 问题）
  const playwrightCli = resolve(
    EXTENSION_DIR,
    "node_modules/@playwright/test/cli.js",
  );
  const testArgs = [playwrightCli, "test", ...playwrightArgs];
  if (grep && passthroughIndex < 0) testArgs.push("--grep", grep);

  console.log(`[e2e] run dir: ${runDir}`);
  const child = spawn(process.execPath, testArgs, { cwd: EXTENSION_DIR, env, shell: false });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });
  const exitCode = await new Promise((resolveExit) => child.on("exit", resolveExit));
  writeFileSync(resolve(runDir, "stdout.log"), `${stdout}\n--- stderr ---\n${stderr}`);

  // 3) 解析 json reporter 输出 → result.json（json 在 stdout 末尾，从第一个 '{' 起）
  const jsonStart = stdout.indexOf("{");
  let result;
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(stdout.slice(jsonStart));
      const tests = [];
      for (const suite of parsed.suites ?? []) {
        collectTests(suite, tests);
      }
      result = {
        runId: id,
        exitCode,
        passed: (parsed.stats?.expected ?? 0),
        failed: (parsed.stats?.unexpected ?? 0),
        skipped: (parsed.stats?.skipped ?? 0),
        flaky: (parsed.stats?.flaky ?? 0),
        durationMs: parsed.stats?.duration ?? 0,
        tests,
        artifactsDir: runDir,
      };
    } catch (err) {
      result = { runId: id, exitCode, parseError: String(err), artifactsDir: runDir };
    }
  } else {
    result = { runId: id, exitCode, error: "no json output from playwright", artifactsDir: runDir };
  }
  const resultPath = resolve(runDir, "result.json");
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(`[e2e] result: ${resultPath} (passed=${result.passed ?? "?"} failed=${result.failed ?? "?"})`);
  process.exit(exitCode ?? 1);
}

function collectTests(suite, out) {
  for (const s of suite.suites ?? []) collectTests(s, out);
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const latest = test.results?.[test.results.length - 1];
      out.push({
        title: [...(suite.title ? [suite.title] : []), spec.title].join(" › "),
        file: test.location ? `${test.location.file}:${test.location.line}` : undefined,
        status: test.status,
        durationMs: latest?.duration ?? 0,
        error: latest?.error?.message,
      });
    }
  }
}

main().catch((err) => {
  console.error("[e2e]", err);
  process.exit(1);
});
