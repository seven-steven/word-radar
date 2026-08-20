/**
 * 商店截图尺寸硬校验（issue #19）的纯函数层。
 *
 * 直接解析 PNG 字节（签名 + IHDR 的 width/height，各 4 字节 big-endian），
 * 不依赖任何图像库、不信截图脚本日志 —— 校验对象永远是磁盘产物的真实像素。
 *
 * 供 run-screenshots.mjs（生成后逐张校验，不符非零退出）与
 * packages/extension/test/png-size.test.ts（fixture 单测）共用。
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_OFFSET = 16; // 8 签名 + 4 length + 4 "IHDR"

export const STORE_SCREENSHOT_WIDTH = 1280;
export const STORE_SCREENSHOT_HEIGHT = 800;

/**
 * 从 PNG buffer 读出真实像素尺寸。
 * @throws buffer 过短 / 签名不符 / chunk 名不是 IHDR
 */
export function readPngSize(buffer) {
  if (!buffer || buffer.length < IHDR_OFFSET + 8) {
    throw new Error(`not a PNG: buffer too short (${buffer ? buffer.length : 0} bytes)`);
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG: bad signature");
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG: first chunk is not IHDR");
  }
  return {
    width: buffer.readUInt32BE(IHDR_OFFSET),
    height: buffer.readUInt32BE(IHDR_OFFSET + 4),
  };
}

/**
 * 断言一张商店截图恰好 1280×800。
 * 返回 { ok, errors }（不抛 —— runner 要一次汇总全部不符项后统一退出）。
 */
export function assertStoreScreenshotSize(buffer, fileName) {
  try {
    const { width, height } = readPngSize(buffer);
    if (width !== STORE_SCREENSHOT_WIDTH || height !== STORE_SCREENSHOT_HEIGHT) {
      return {
        ok: false,
        errors: [
          `${fileName}: ${width}x${height} ≠ required ${STORE_SCREENSHOT_WIDTH}x${STORE_SCREENSHOT_HEIGHT}`,
        ],
      };
    }
    return { ok: true, errors: [] };
  } catch (err) {
    return { ok: false, errors: [`${fileName}: ${err instanceof Error ? err.message : String(err)}`] };
  }
}
