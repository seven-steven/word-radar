import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.json" with { type: "json" };

describe("@word-radar/extension", () => {
  it("ships a valid MV3 manifest", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBeTypeOf("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("requests only minimal permissions", () => {
    // 权限锁定（spec §Out of Scope 基础上的一处扩权，2026-08-19 用户拍板）：
    // storage + activeTab/scripting —— 后两者用于「旧标签未注入时 executeScript 补注入」
    // （popup 打开即用户手势，activeTab 只作用于当前标签，无 <all_urls> host 权限）。
    // 仍不申请 cookies/notifications/tabs 等敏感权限。
    expect(manifest.permissions).toEqual(["storage", "activeTab", "scripting"]);
    const perms = manifest.permissions ?? [];
    for (const forbidden of ["cookies", "notifications", "tabs"]) {
      expect(perms).not.toContain(forbidden);
    }
    expect(manifest.host_permissions).toEqual([
      "https://bbdc.cn/*",
      "https://langeasy.com.cn/*",
    ]);
  });

  it("declares the bbdc host permission", () => {
    const hosts = manifest.host_permissions ?? [];
    expect(hosts.some((h) => h.startsWith("https://bbdc.cn"))).toBe(true);
  });

  it("declares no declarative content scripts (activeTab 瘦身, issue #14)", () => {
    // declarative content_scripts（<all_urls>）已移除：采集主路径是 popup 打开时
    // 的 chrome.scripting.executeScript 注入（activeTab + scripting），
    // 安装时权限提示不再包含「读取和更改所有网站上的数据」。
    expect(manifest.content_scripts).toBeUndefined();
  });

  it("uses an MV3 module service worker and a popup action", () => {
    expect(manifest.background?.service_worker).toBeTypeOf("string");
    expect(manifest.background?.type).toBe("module");
    expect(manifest.action?.default_popup).toBeTypeOf("string");
  });
});
