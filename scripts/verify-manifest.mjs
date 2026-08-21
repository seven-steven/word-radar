#!/usr/bin/env node
/**
 * verify-manifest：断言三方 version 一致 + MV3 基本形态合规。
 *
 * 三方：根 package.json / packages/extension/src/manifest.json /
 * dist/word-radar-<version>-chrome.zip 内的 manifest.json（verify-zip 提供
 * 纯 Node zip 解析；zip 缺失时提示先 build/package，非零退出）。
 *
 * 断言逻辑抽纯函数 `verifyManifest(...)`，便于单测 fixture 覆盖失败路径。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChromeZip, readZipEntry } from "./verify-zip.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SRC_MANIFEST = resolve(REPO_ROOT, "packages/extension/src/manifest.json");
const OUT_DIR = resolve(REPO_ROOT, "dist");

const ICON_SIZES = ["16", "48", "128"];

/**
 * 校验三方版本一致性 + MV3 形态（对 src 与 zip 内 manifest 各查一遍）。
 *
 * @param {{ rootVersion: string, srcManifest: object | null, zipManifest: object | null }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verifyManifest({ rootVersion, srcManifest, zipManifest }) {
  const errors = [];

  if (typeof rootVersion !== "string" || rootVersion.length === 0) {
    errors.push("root package.json version is empty or missing");
  }
  if (!srcManifest || typeof srcManifest !== "object") {
    errors.push("src manifest.json is missing or unreadable");
  }
  if (!zipManifest || typeof zipManifest !== "object") {
    errors.push("manifest.json in word-radar-<version>-chrome.zip is missing — run 'pnpm build && pnpm package' first");
  }
  if (errors.length > 0) return { ok: false, errors };

  const versions = [
    ["root package.json", rootVersion],
    ["src manifest.json", srcManifest.version],
    ["zip manifest.json", zipManifest.version],
  ];
  for (const [label, v] of versions) {
    if (typeof v !== "string" || v.length === 0) {
      errors.push(`${label} version is empty or missing`);
    }
  }
  const [r, s, z] = versions.map(([, v]) => v);
  if (r && s && r !== s) {
    errors.push(`version mismatch: root package.json is ${r} but src manifest.json is ${s}`);
  }
  if (r && z && r !== z) {
    errors.push(`version mismatch: root package.json is ${r} but zip manifest.json is ${z}`);
  }
  if (s && z && s !== z) {
    errors.push(`version mismatch: src manifest.json is ${s} but zip manifest.json is ${z}`);
  }

  errors.push(...checkMv3Shape(srcManifest, "src"));
  errors.push(...checkMv3Shape(zipManifest, "zip"));

  return { ok: errors.length === 0, errors };
}

/**
 * 断言 MV3 基本形态：manifest_version=3、name、version、action.default_popup、
 * background.service_worker、icons 三尺寸（16/48/128）。
 */
function checkMv3Shape(manifest, label) {
  const errors = [];
  if (manifest.manifest_version !== 3) {
    errors.push(`${label} manifest: manifest_version must be 3, got ${String(manifest.manifest_version)}`);
  }
  if (!manifest.name) errors.push(`${label} manifest: missing "name"`);
  if (!manifest.version) errors.push(`${label} manifest: missing "version"`);
  if (!manifest.action?.default_popup) errors.push(`${label} manifest: missing "action.default_popup"`);
  if (!manifest.background?.service_worker) {
    errors.push(`${label} manifest: missing "background.service_worker"`);
  }
  for (const size of ICON_SIZES) {
    if (!manifest.icons?.[size]) errors.push(`${label} manifest: missing icons["${size}"]`);
  }
  return errors;
}

function main() {
  const packageJsonPath = resolve(REPO_ROOT, "package.json");
  if (!existsSync(packageJsonPath)) {
    console.error("verify-manifest: package.json not found at", packageJsonPath);
    process.exit(1);
  }
  if (!existsSync(SRC_MANIFEST)) {
    console.error("verify-manifest: src manifest.json not found at", SRC_MANIFEST);
    process.exit(1);
  }

  let zipPath;
  try {
    zipPath = findChromeZip(OUT_DIR);
  } catch (err) {
    console.error("verify-manifest:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const rootVersion = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
  const srcManifest = JSON.parse(readFileSync(SRC_MANIFEST, "utf8"));
  let zipManifest = null;
  try {
    zipManifest = JSON.parse(readZipEntry(readFileSync(zipPath), "manifest.json").toString("utf8"));
  } catch (err) {
    console.error("verify-manifest: failed to read manifest.json from", zipPath, "-", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const result = verifyManifest({ rootVersion, srcManifest, zipManifest });
  if (!result.ok) {
    console.error("verify-manifest: FAILED");
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log(`verify-manifest: OK — version ${rootVersion} consistent across package.json / src manifest / zip manifest (${zipPath}), MV3 shape valid`);
}

// 仅作为 CLI 直接执行时运行 main（被测试 import 时不执行）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error("verify-manifest:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
