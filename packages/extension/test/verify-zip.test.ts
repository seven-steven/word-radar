import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { listZipEntries, readZipEntry, verifyZipContents } from "../../../scripts/verify-zip.mjs";

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

describe("verify-zip: readZipEntry（供 verify-manifest 提取 zip 内 manifest.json）", () => {
  /** 构造最小 zip：支持 stored(0) / deflate(8) 混合条目，central directory 记录真实 local offset。 */
  function buildZip(entries: Array<{ name: string; data: Buffer; method?: number }>) {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
      const name = Buffer.from(e.name);
      const method = e.method ?? 0;
      const comp = method === 8 ? deflateRawSync(e.data) : e.data;
      const crc = 0; // readZipEntry 不依赖 CRC，省略计算
      const local = Buffer.alloc(30 + name.length + comp.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(method, 8);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(comp.length, 18);
      local.writeUInt32LE(e.data.length, 22);
      local.writeUInt16LE(name.length, 26);
      name.copy(local, 30);
      comp.copy(local, 30 + name.length);
      const central = Buffer.alloc(46 + name.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(method, 10);
      central.writeUInt32LE(comp.length, 20);
      central.writeUInt32LE(e.data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      name.copy(central, 46);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
  }

  it("extracts a stored entry", () => {
    const zip = buildZip([{ name: "manifest.json", data: Buffer.from('{"version":"0.1.0"}') }]);
    expect(readZipEntry(zip, "manifest.json").toString("utf8")).toBe('{"version":"0.1.0"}');
  });

  it("extracts a deflated entry", () => {
    const zip = buildZip([
      { name: "manifest.json", data: Buffer.from('{"version":"0.1.0"}'), method: 8 },
      { name: "src/a.png", data: Buffer.from("png"), method: 8 },
    ]);
    expect(readZipEntry(zip, "manifest.json").toString("utf8")).toBe('{"version":"0.1.0"}');
  });

  it("throws when the entry does not exist", () => {
    const zip = buildZip([{ name: "a.txt", data: Buffer.from("x") }]);
    expect(() => readZipEntry(zip, "manifest.json")).toThrow(/not found/i);
  });
});
