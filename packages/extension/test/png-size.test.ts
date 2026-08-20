/**
 * 商店截图尺寸硬校验（issue #19）：readPngSize 读 PNG IHDR 真实像素，
 * assertStoreScreenshotSize 对 1280×800 逐张断言。
 * 校验磁盘产物的真实字节，不信截图脚本日志。
 */
import { describe, expect, it } from "vitest";
import {
  assertStoreScreenshotSize,
  readPngSize,
} from "../../../scripts/e2e/png-size.mjs";

/** 构造最小合法 PNG 头：8 字节签名 + IHDR chunk（宽高 big-endian）。 */
function pngWithSize(width: number, height: number, corrupt = false): Buffer {
  const header = Buffer.alloc(24);
  const signature = corrupt
    ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b])
    : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  signature.copy(header, 0);
  header.writeUInt32BE(13, 8); // IHDR length
  header.write("IHDR", 12, "binary");
  header.writeUInt32BE(width >>> 0, 16);
  header.writeUInt32BE(height >>> 0, 20);
  return header;
}

describe("png-size: readPngSize", () => {
  it("reads width/height from a valid PNG IHDR", () => {
    expect(readPngSize(pngWithSize(1280, 800))).toEqual({ width: 1280, height: 800 });
    expect(readPngSize(pngWithSize(640, 400))).toEqual({ width: 640, height: 400 });
  });

  it("rejects a buffer shorter than an IHDR", () => {
    expect(() => readPngSize(Buffer.alloc(10))).toThrow(/too short|PNG/i);
  });

  it("rejects a non-PNG signature", () => {
    expect(() => readPngSize(pngWithSize(1280, 800, true))).toThrow(/signature|PNG/i);
  });
});

describe("png-size: assertStoreScreenshotSize", () => {
  it("returns ok for exact 1280×800", () => {
    expect(
      assertStoreScreenshotSize(pngWithSize(1280, 800), "shot.png"),
    ).toEqual({ ok: true, errors: [] });
  });

  it("reports oversized dimensions with file name and actual size", () => {
    const result = assertStoreScreenshotSize(pngWithSize(2560, 1600), "shot.png");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("shot.png");
    expect(result.errors[0]).toContain("2560x1600");
    expect(result.errors[0]).toContain("1280x800");
  });

  it("reports undersized dimensions", () => {
    const result = assertStoreScreenshotSize(pngWithSize(640, 400), "small.png");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/640x400/);
  });

  it("reports invalid PNG as an error instead of throwing", () => {
    const result = assertStoreScreenshotSize(Buffer.from("not a png"), "bad.png");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("bad.png");
  });
});
