import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.json" with { type: "json" };

describe("@word-radar/extension", () => {
  it("ships a valid MV3 manifest", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBeTypeOf("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("requests only minimal permissions", () => {
    // 第一版权限锁定为 ["storage"]（spec §Out of Scope）：
    // 不申请 cookies/notifications/tabs/activeTab 等敏感权限。
    // popup 采集只靠 chrome.tabs.query({active}) + tabs.sendMessage，无需额外权限。
    expect(manifest.permissions).toEqual(["storage"]);
    const perms = manifest.permissions ?? [];
    for (const forbidden of ["cookies", "notifications", "tabs", "activeTab"]) {
      expect(perms).not.toContain(forbidden);
    }
  });

  it("declares the bbdc host permission", () => {
    const hosts = manifest.host_permissions ?? [];
    expect(hosts.some((h) => h.startsWith("https://bbdc.cn"))).toBe(true);
  });

  it("declares exactly one content script entry on all urls", () => {
    expect(manifest.content_scripts).toHaveLength(1);
    const [cs] = manifest.content_scripts;
    expect(cs?.matches).toContain("<all_urls>");
    expect(cs?.js).toHaveLength(1);
  });

  it("uses an MV3 module service worker and a popup action", () => {
    expect(manifest.background?.service_worker).toBeTypeOf("string");
    expect(manifest.background?.type).toBe("module");
    expect(manifest.action?.default_popup).toBeTypeOf("string");
  });
});
