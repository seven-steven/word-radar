#!/usr/bin/env node
// 生成雷达风格占位图标（16/48/128 px PNG），供 manifest icons / action.default_icon 使用。
// 零外部依赖：手写 PNG 编码（zlib + CRC32）。后续换正式图标时，直接替换
// packages/extension/src/assets/icons/ 下同名文件即可，无需改本脚本或 manifest。
//
// 用法：node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../packages/extension/src/assets/icons");
const SIZES = [16, 48, 128];

// 品牌占位色：深蓝底 + 白色雷达图形（同心圆 + 扫描扇形 + 中心点）
const BG = [26, 35, 74];
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 判断像素 (x,y) 是否属于白色雷达图形（以 (c,c) 为圆心，尺寸 n 的画布）。 */
function isRadarPixel(x, y, n) {
  const c = (n - 1) / 2;
  const dx = x - c;
  const dy = y - c;
  const r = Math.hypot(dx, dy);
  const outer = n * 0.42; // 最外同心圆
  const ringWidth = Math.max(1, n / 16);

  // 三条同心圆弧（半径 0.42n / 0.28n / 0.14n 的环带）
  for (const f of [0.42, 0.28, 0.14]) {
    const ring = n * f;
    if (Math.abs(r - ring) <= ringWidth / 2) return true;
  }

  // 扫描扇形：半径在 [0.14n, 0.42n] 之间、角度朝右上（-90° ~ -30°）的 1/6 圆
  if (r > n * 0.14 && r < outer) {
    let a = Math.atan2(-dy, dx); // 数学角度，y 向下故取负
    if (a < 0) a += Math.PI * 2;
    const start = Math.PI / 2; // 90°（正上）
    const end = (Math.PI * 5) / 6; // 150°（右上偏右）
    if (a >= start && a <= end) return true;
  }

  // 中心点：半径 0.06n 的实心圆
  return r <= n * 0.06;
}

function renderIcon(n) {
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) {
    const rowStart = y * (n * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < n; x++) {
      const [r, g, b] = isRadarPixel(x, y, n) ? FG : BG;
      const o = rowStart + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const n of SIZES) {
  const png = renderIcon(n);
  const out = resolve(OUT_DIR, `icon-${n}.png`);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}
