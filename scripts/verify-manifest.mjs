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
const I18N_PLACEHOLDER_PATTERN = /^__MSG_(\w+)__$/;
const I18N_REQUIRED_LOCALES = ["en", "zh_CN", "zh_TW"];

/**
 * 校验三方版本一致性 + MV3 形态（对 src 与 zip 内 manifest 各查一遍）。
 *
 * @param {{ rootVersion: string, srcManifest: object | null, zipManifest: object | null, zipBuffer?: Buffer }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verifyManifest({ rootVersion, srcManifest, zipManifest, zipBuffer }) {
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

  // i18n structure validation (src only)
  errors.push(...checkI18nStructureSrc(srcManifest));

  // i18n validation in zip (if buffer provided)
  if (zipBuffer) {
    errors.push(...checkI18nInZip(zipBuffer, srcManifest));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 检查 src manifest 的 i18n 结构：占位符格式、default_locale、_locales 目录和 key 一致性。
 */
function checkI18nStructureSrc(manifest) {
  const errors = [];

  // Check default_locale
  if (manifest.default_locale !== "en") {
    errors.push(`src manifest: default_locale must be "en", got "${manifest.default_locale || ""}"`);
  }

  // Extract message keys from manifest placeholders
  const messageKeys = new Set();

  // Check name field
  const nameMatch = manifest.name?.match(I18N_PLACEHOLDER_PATTERN);
  if (!nameMatch) {
    errors.push(`src manifest: name must be an i18n placeholder like __MSG_extName__, got "${manifest.name || ""}"`);
  } else {
    messageKeys.add(nameMatch[1]);
  }

  // Check description field
  const descMatch = manifest.description?.match(I18N_PLACEHOLDER_PATTERN);
  if (!descMatch) {
    errors.push(`src manifest: description must be an i18n placeholder like __MSG_extDescription__, got "${manifest.description || ""}"`);
  } else {
    messageKeys.add(descMatch[1]);
  }

  // Check action.default_title field
  const titleMatch = manifest.action?.default_title?.match(I18N_PLACEHOLDER_PATTERN);
  if (!titleMatch) {
    errors.push(`src manifest: action.default_title must be an i18n placeholder like __MSG_extTooltip__, got "${manifest.action?.default_title || ""}"`);
  } else {
    messageKeys.add(titleMatch[1]);
  }

  // Check _locales directories and message files - parse each once and reuse
  const extensionRoot = resolve(REPO_ROOT, "packages/extension");
  const localeData = {};

  for (const locale of I18N_REQUIRED_LOCALES) {
    const messagesPath = resolve(extensionRoot, "_locales", locale, "messages.json");
    if (!existsSync(messagesPath)) {
      errors.push(`src _locales: missing ${locale}/messages.json at ${messagesPath}`);
      continue;
    }

    try {
      const messages = JSON.parse(readFileSync(messagesPath, "utf8"));
      localeData[locale] = messages;

      // Check that all referenced keys exist
      for (const key of messageKeys) {
        if (!(key in messages)) {
          errors.push(`src _locales: ${locale}/messages.json missing key "${key}" referenced by manifest`);
        }
      }
    } catch (err) {
      errors.push(`src _locales: failed to parse ${locale}/messages.json - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Check key consistency across locales using the parsed data
  if (messageKeys.size > 0 && localeData["en"] && localeData["zh_CN"] && localeData["zh_TW"]) {
    const enKeys = new Set(Object.keys(localeData["en"]));
    const zhCnKeys = new Set(Object.keys(localeData["zh_CN"]));
    const zhTwKeys = new Set(Object.keys(localeData["zh_TW"]));

    // Check all Chinese keys match English
    for (const key of enKeys) {
      if (!zhCnKeys.has(key)) {
        errors.push(`src _locales: key "${key}" exists in en but missing in zh_CN`);
      }
      if (!zhTwKeys.has(key)) {
        errors.push(`src _locales: key "${key}" exists in en but missing in zh_TW`);
      }
    }

    // Check for extra keys in Chinese locales
    for (const key of zhCnKeys) {
      if (!enKeys.has(key)) {
        errors.push(`src _locales: key "${key}" exists in zh_CN but missing in en`);
      }
    }
    for (const key of zhTwKeys) {
      if (!enKeys.has(key)) {
        errors.push(`src _locales: key "${key}" exists in zh_TW but missing in en`);
      }
    }

    // Verify zh_CN and zh_TW have identical key sets
    if (zhCnKeys.size !== zhTwKeys.size) {
      errors.push(`src _locales: zh_CN has ${zhCnKeys.size} keys but zh_TW has ${zhTwKeys.size} keys`);
    }
  }

  return errors;
}

/**
 * 检查 ZIP 包内的 i18n 文件结构：_locales 目录和 key 一致性。
 */
function checkI18nInZip(zipBuffer, manifest) {
  const errors = [];

  // Extract message keys from manifest placeholders
  const messageKeys = new Set();
  const nameMatch = manifest.name?.match(I18N_PLACEHOLDER_PATTERN);
  const descMatch = manifest.description?.match(I18N_PLACEHOLDER_PATTERN);
  const titleMatch = manifest.action?.default_title?.match(I18N_PLACEHOLDER_PATTERN);

  if (nameMatch) messageKeys.add(nameMatch[1]);
  if (descMatch) messageKeys.add(descMatch[1]);
  if (titleMatch) messageKeys.add(titleMatch[1]);

  // Check each locale in the zip
  const localeData = {};
  for (const locale of I18N_REQUIRED_LOCALES) {
    const messagesPath = `_locales/${locale}/messages.json`;
    try {
      const messagesContent = readZipEntry(zipBuffer, messagesPath).toString("utf8");
      const messages = JSON.parse(messagesContent);
      localeData[locale] = messages;

      // Check that all referenced keys exist
      for (const key of messageKeys) {
        if (!(key in messages)) {
          errors.push(`zip _locales: ${locale}/messages.json missing key "${key}" referenced by manifest`);
        }
      }
    } catch (err) {
      errors.push(`zip _locales: ${locale}/messages.json error - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Check key consistency across locales in the zip
  if (messageKeys.size > 0 && localeData["en"] && localeData["zh_CN"] && localeData["zh_TW"]) {
    const enKeys = new Set(Object.keys(localeData["en"]));
    const zhCnKeys = new Set(Object.keys(localeData["zh_CN"]));
    const zhTwKeys = new Set(Object.keys(localeData["zh_TW"]));

    // Check all Chinese keys match English
    for (const key of enKeys) {
      if (!zhCnKeys.has(key)) {
        errors.push(`zip _locales: key "${key}" exists in en but missing in zh_CN`);
      }
      if (!zhTwKeys.has(key)) {
        errors.push(`zip _locales: key "${key}" exists in en but missing in zh_TW`);
      }
    }

    // Check for extra keys in Chinese locales
    for (const key of zhCnKeys) {
      if (!enKeys.has(key)) {
        errors.push(`zip _locales: key "${key}" exists in zh_CN but missing in en`);
      }
    }
    for (const key of zhTwKeys) {
      if (!enKeys.has(key)) {
        errors.push(`zip _locales: key "${key}" exists in zh_TW but missing in en`);
      }
    }

    // Verify zh_CN and zh_TW have identical key sets
    if (zhCnKeys.size !== zhTwKeys.size) {
      errors.push(`zip _locales: zh_CN has ${zhCnKeys.size} keys but zh_TW has ${zhTwKeys.size} keys`);
    }
  }

  return errors;
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
  let zipBuffer = null;
  try {
    zipBuffer = readFileSync(zipPath);
    zipManifest = JSON.parse(readZipEntry(zipBuffer, "manifest.json").toString("utf8"));
  } catch (err) {
    console.error("verify-manifest: failed to read manifest.json from", zipPath, "-", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Verify with i18n validation including zip contents
  const result = verifyManifest({ rootVersion, srcManifest, zipManifest, zipBuffer });
  if (!result.ok) {
    console.error("verify-manifest: FAILED");
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log(`verify-manifest: OK — version ${rootVersion} consistent across package.json / src manifest / zip manifest (${zipPath}), MV3 shape valid, i18n structure valid (src + zip)`);
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
