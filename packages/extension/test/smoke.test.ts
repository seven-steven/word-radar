import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.json" with { type: "json" };

describe("@word-radar/extension", () => {
  it("ships a valid MV3 manifest", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBeTypeOf("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("requests only minimal permissions", () => {
    // 第一版不申请 cookies/notifications 等敏感权限（spec §Out of Scope）。
    const perms = manifest.permissions ?? [];
    expect(perms).not.toContain("cookies");
    expect(perms).not.toContain("notifications");
  });

  it("declares the bbdc host permission", () => {
    const hosts = manifest.host_permissions ?? [];
    expect(hosts.some((h) => h.startsWith("https://bbdc.cn"))).toBe(true);
  });
});