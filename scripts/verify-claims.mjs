#!/usr/bin/env node
/**
 * verify-claims：断言上架文案与生产 manifest / 隐私口径一致。
 *
 * 1. assertPermissionJustifications(listing, manifest)：
 *    STORE-LISTING 的权限理由块必须逐 token 覆盖生产 manifest 的
 *    permissions 与 host_permissions（权限增删任一方漂移都会被抓住）。
 * 2. assertNoForbiddenClaims(text)：
 *    STORE-LISTING / PRIVACY 不得含 FACTS.md 禁词表中的不可辩护措辞
 *    （如"不上传任何数据"——生词确实发送 bbdc.cn）。
 *
 * 断言逻辑抽纯函数导出，便于单测 fixture 覆盖。
 * CLI 入口读仓库根 packages/extension/src/manifest.json 与
 * docs/chrome-web-store/{STORE-LISTING,PRIVACY}.md，失败非零退出。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/**
 * 隐私禁词表（与 docs/chrome-web-store/FACTS.md「隐私口径与禁词表」一节一一对应；
 * 本常量是该表的唯一执行来源，改表须同步改这里）。
 * 匹配语义：文案中出现这些短语即违规——它们是不可辩护的绝对化声明。
 */
export const FORBIDDEN_CLAIMS = [
  /不(会)?上传任何(用户)?(数据|信息)/,
  /不(会)?收集任何(用户)?(数据|信息)/,
  /不(会)?发送任何(用户)?数据/,
  /不向任何(第三方)?服务器发送/,
  /完全不上传/,
  /无需任何权限/,
];

/**
 * 断言 listing 权限理由块逐 token 覆盖 manifest 权限清单。
 *
 * @param {string} listing - STORE-LISTING 全文
 * @param {{ permissions?: string[], host_permissions?: string[] }} manifest - 生产 manifest 对象
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertPermissionJustifications(listing, manifest) {
  if (typeof listing !== "string" || listing.length === 0) {
    return { ok: false, error: "listing is empty or not a string" };
  }
  const tokens = [
    ...(Array.isArray(manifest?.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : []),
  ];
  if (tokens.length === 0) {
    return { ok: false, error: "manifest has no permissions to verify" };
  }
  const missing = tokens.filter((token) => !listing.includes(token));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `STORE-LISTING permission justification missing tokens: ${missing.join(", ")}`,
    };
  }
  return { ok: true };
}

/**
 * 断言文案不含禁词表中的不可辩护措辞。
 *
 * @param {string} text - STORE-LISTING 或 PRIVACY 全文
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertNoForbiddenClaims(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, error: "text is empty or not a string" };
  }
  const lines = text.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    for (const claim of FORBIDDEN_CLAIMS) {
      if (claim.test(line)) {
        hits.push(`"${line.trim()}" at line ${i + 1}`);
      }
    }
  });
  if (hits.length > 0) {
    return { ok: false, error: `forbidden privacy claim(s) found: ${hits.join("; ")}` };
  }
  return { ok: true };
}

function main() {
  const manifestPath = resolve(REPO_ROOT, "packages/extension/src/manifest.json");
  const listingPath = resolve(REPO_ROOT, "docs/chrome-web-store/STORE-LISTING.md");
  const privacyPath = resolve(REPO_ROOT, "docs/chrome-web-store/PRIVACY.md");

  for (const p of [manifestPath, listingPath, privacyPath]) {
    if (!existsSync(p)) {
      console.error("verify-claims: file not found at", p);
      process.exit(1);
    }
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const listing = readFileSync(listingPath, "utf8");
  const privacy = readFileSync(privacyPath, "utf8");

  const failures = [
    ["permission justifications", assertPermissionJustifications(listing, manifest)],
    ["STORE-LISTING forbidden claims", assertNoForbiddenClaims(listing)],
    ["PRIVACY forbidden claims", assertNoForbiddenClaims(privacy)],
  ].filter(([, result]) => !result.ok);

  if (failures.length > 0) {
    for (const entry of failures) {
      const result = entry[1];
      console.error(`verify-claims [${entry[0]}]:`, result.error);
    }
    process.exit(1);
  }

  console.log("verify-claims: OK — listing covers all manifest permissions; no forbidden claims");
}

try {
  main();
} catch (err) {
  console.error("verify-claims:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
