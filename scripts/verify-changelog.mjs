#!/usr/bin/env node
/**
 * verify-changelog：断言 CHANGELOG.md 含 package.json 当前版本对应条目。
 *
 * 断言逻辑抽纯函数 `assertVersionEntry(changelog, version)`，便于单测 fixture 覆盖。
 * CLI 入口读仓库根 CHANGELOG.md 与 package.json，缺失即非零退出。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/**
 * 断言 CHANGELOG 文本含指定版本条目。
 *
 * @param {string} changelog - CHANGELOG.md 全文
 * @param {string} version - 语义化版本号（如 "0.1.0"）
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertVersionEntry(changelog, version) {
  if (typeof changelog !== "string" || changelog.length === 0) {
    return { ok: false, error: "CHANGELOG is empty or not a string" };
  }
  if (typeof version !== "string" || version.length === 0) {
    return { ok: false, error: "version is empty or not a string" };
  }
  // Keep a Changelog 格式：## [0.1.0] 或 ## [0.1.0] - 2026-08-20
  const pattern = new RegExp(`^## \\[${escapeRegExp(version)}\\]`, "m");
  if (pattern.test(changelog)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `CHANGELOG.md missing entry for version ${version} (expected "## [${version}]")`,
  };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const changelogPath = resolve(REPO_ROOT, "CHANGELOG.md");
  const packageJsonPath = resolve(REPO_ROOT, "package.json");

  if (!existsSync(changelogPath)) {
    console.error("verify-changelog: CHANGELOG.md not found at", changelogPath);
    process.exit(1);
  }
  if (!existsSync(packageJsonPath)) {
    console.error("verify-changelog: package.json not found at", packageJsonPath);
    process.exit(1);
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const version = pkg.version;

  const result = assertVersionEntry(changelog, version);
  if (!result.ok) {
    console.error("verify-changelog:", result.error);
    process.exit(1);
  }

  console.log(`verify-changelog: OK — CHANGELOG.md contains entry for v${version}`);
}

try {
  main();
} catch (err) {
  console.error("verify-changelog:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
