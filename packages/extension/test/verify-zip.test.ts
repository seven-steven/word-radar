import { describe, expect, it } from "vitest";
import { listZipEntries, verifyZipContents } from "../../../scripts/verify-zip.mjs";

const goodEntries = [
  "manifest.json",
  "service-worker-loader.js",
  "src/assets/icons/icon-16.png",
  "src/assets/icons/icon-48.png",
  "src/assets/icons/icon-128.png",
  "src/background.ts",
];

describe("verify-zip: verifyZipContents", () => {
  describe("success path", () => {
    it("returns ok for a well-formed entry list", () => {
      const result = verifyZipContents(goodEntries);
      expect(result).toEqual({ ok: true, errors: [] });
    });
  });

  describe("manifest at root", () => {
    it("fails when manifest.json is nested, not at root", () => {
      const result = verifyZipContents(goodEntries.filter((e) => e !== "manifest.json").concat("dist/manifest.json"));
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /manifest\.json.*root|root.*manifest\.json/i.test(e))).toBe(true);
    });

    it("fails when manifest.json is missing entirely", () => {
      const result = verifyZipContents(goodEntries.filter((e) => e !== "manifest.json"));
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /manifest\.json/.test(e))).toBe(true);
    });
  });

  describe("icons", () => {
    it("fails when an icon size is missing from the zip", () => {
      const result = verifyZipContents(goodEntries.filter((e) => e !== "src/assets/icons/icon-128.png"));
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /icon-128\.png/.test(e))).toBe(true);
    });
  });

  describe("source map leak", () => {
    it("fails when any .map file is present", () => {
      const result = verifyZipContents([...goodEntries, "src/background.ts.map"]);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /\.map/.test(e))).toBe(true);
    });
  });
});

describe("verify-zip: listZipEntries (pure Node central-directory parse)", () => {
  it("parses an empty zip (EOCD only)", () => {
    const buf = Buffer.alloc(22);
    buf.writeUInt32LE(0x06054b50, 0);
    expect(listZipEntries(buf)).toEqual([]);
  });

  it("throws on a non-zip buffer", () => {
    expect(() => listZipEntries(Buffer.from("not a zip"))).toThrow();
  });

  it("parses entries written by the pure-Node writer in package.mjs", async () => {
    // 构造一个与 package.mjs writeZip 同构的最小 zip（STORE 单文件）
    const { deflateRawSync } = await import("node:zlib");
    const content = Buffer.from("hello");
    const name = Buffer.from("manifest.json");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(local.length + content.length, 42);
    name.copy(central, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(local.length + content.length, 16);
    const zip = Buffer.concat([local, content, central, eocd]);
    // deflateRawSync 引入仅为对齐实现细节，避免未使用告警
    expect(deflateRawSync(content).length).toBeGreaterThan(0);
    expect(listZipEntries(zip)).toEqual(["manifest.json"]);
  });
});
