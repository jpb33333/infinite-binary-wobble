#!/usr/bin/env node
// Rasterizes the favicon's two-star motif into the PNG sizes iOS and the web
// manifest need (apple-touch-icon 180, manifest 192 + 512). Zero dependencies:
// the repo has no image toolchain and adding one for three static assets
// would violate the no-new-deps rule, so this writes the PNGs byte-by-byte
// (raw RGBA scanlines -> zlib deflate -> PNG chunks with CRC32).
//
// Colors mirror public/favicon.svg / src/theme.ts: voidDeep #1A0F14 ground,
// player1 #E8956F + player2 #D97D3D discs with cream #FFC89B cores.
//
// Run: node scripts/make-touch-icons.mjs   (writes into public/)

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const VOID = [0x1a, 0x0f, 0x14];
const CREAM = [0xff, 0xc8, 0x9b];
const P1 = [0xe8, 0x95, 0x6f];
const P2 = [0xd9, 0x7d, 0x3d];

// Mirror the SVG's geometry (64-unit viewBox): two r=15 discs at (22,32) and
// (42,32), cream core fading to the player color at 55%, transparent at 100%.
const STARS = [
  { cx: 22 / 64, cy: 32 / 64, r: 15 / 64, color: P1 },
  { cx: 42 / 64, cy: 32 / 64, r: 15 / 64, color: P2 },
];

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function renderRGBA(size) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 2x2 supersample per pixel for smooth disc edges at small sizes.
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const u = (x + sx) / size;
        const v = (y + sy) / size;
        let cr = VOID[0];
        let cg = VOID[1];
        let cb = VOID[2];
        for (const s of STARS) {
          const d = Math.hypot(u - s.cx, v - s.cy) / s.r;
          if (d >= 1) continue;
          // 0..0.55: cream -> player color; 0.55..1: player color -> transparent
          const col = d < 0.55 ? lerp3(CREAM, s.color, d / 0.55) : s.color;
          const alpha = d < 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
          // 'lighter'-style additive blend over the void, matching the canvas glow
          cr = Math.min(255, cr * (1 - alpha) + col[0] * alpha + cr * 0.1 * alpha);
          cg = Math.min(255, cg * (1 - alpha) + col[1] * alpha + cg * 0.1 * alpha);
          cb = Math.min(255, cb * (1 - alpha) + col[2] * alpha + cb * 0.1 * alpha);
        }
        r += cr;
        g += cg;
        b += cb;
      }
      const i = (y * size + x) * 4;
      px[i] = r / 4;
      px[i + 1] = g / 4;
      px[i + 2] = b / 4;
      px[i + 3] = 255; // iOS home-screen icons must be opaque
    }
  }
  return px;
}

// ── Minimal PNG encoder (truecolor 8-bit RGBA, no interlace) ──
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // Prefix each scanline with filter byte 0 (None).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  const png = encodePNG(size, renderRGBA(size));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote public/${name} (${size}x${size}, ${png.length} bytes)`);
}
