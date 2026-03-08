#!/usr/bin/env node
'use strict';
/**
 * Generates images/icon.png for the VS Code extension.
 * No external dependencies — pure Node.js (zlib + fs).
 *
 * Design: two concentric usage rings (Activity-ring style) on a dark background.
 *   Outer ring = 5-hour usage (coral),  ~68% filled
 *   Inner ring = 7-day usage  (blue),   ~32% filled
 * Both rings have a 60° gap at the bottom, filled left-to-right over the top.
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 128, H = 128;
const rgba = Buffer.alloc(W * H * 4, 0); // RGBA, all transparent

/* ------------------------------------------------------------------ */
/* Pixel helpers                                                         */
/* ------------------------------------------------------------------ */

function blendPx(x, y, r, g, b, alpha) {
  if (x < 0 || x >= W || y < 0 || y >= H || alpha <= 0) return;
  const i = (y * W + x) * 4;
  const sa = alpha / 255;
  const da = rgba[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  rgba[i]     = Math.round((r * sa + rgba[i]     * da * (1 - sa)) / oa);
  rgba[i + 1] = Math.round((g * sa + rgba[i + 1] * da * (1 - sa)) / oa);
  rgba[i + 2] = Math.round((b * sa + rgba[i + 2] * da * (1 - sa)) / oa);
  rgba[i + 3] = Math.round(oa * 255);
}

function solidPx(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
}

function inRoundRect(x, y, cr) {
  if (x < 0 || x >= W || y < 0 || y >= H) return false;
  if (x <    cr && y <    cr) return (x -    cr) ** 2 + (y -    cr) ** 2 <= cr * cr;
  if (x >= W-cr && y <    cr) return (x - (W-cr)) ** 2 + (y -    cr) ** 2 <= cr * cr;
  if (x <    cr && y >= H-cr) return (x -    cr) ** 2 + (y - (H-cr)) ** 2 <= cr * cr;
  if (x >= W-cr && y >= H-cr) return (x - (W-cr)) ** 2 + (y - (H-cr)) ** 2 <= cr * cr;
  return true;
}

/* ------------------------------------------------------------------ */
/* Background                                                            */
/* ------------------------------------------------------------------ */

for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (inRoundRect(x, y, 26))
      solidPx(x, y, 0x18, 0x18, 0x28); // deep navy

/* ------------------------------------------------------------------ */
/* Arc geometry                                                          */
/* ------------------------------------------------------------------ */

const CX = 64, CY = 64;

// 300° arc, gap of 60° centred on the bottom.
// In atan2 screen-coords (right=0, down=+π/2), the arc starts at the
// lower-left (2π/3) and sweeps clockwise through left→top→right to
// lower-right (π/3).
const ARC_START = (2 * Math.PI) / 3; // ≈ 120°  lower-left
const ARC_SPAN  = (5 * Math.PI) / 3; // 300°

/**
 * Returns 'fill' | 'track' | 'gap' for offset (dx,dy) from centre.
 * fill = filled portion; track = unfilled portion; gap = the open bottom.
 */
function arcCat(dx, dy, fillFrac) {
  let a = Math.atan2(dy, dx); // [-π, π]
  // Clockwise progress from ARC_START, normalised to [0, 2π)
  let pos = ((a - ARC_START) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (pos > ARC_SPAN) return 'gap';
  return pos <= ARC_SPAN * fillFrac ? 'fill' : 'track';
}

/** Convert clockwise arc-position (0…ARC_SPAN) back to atan2 angle. */
function arcPosToAngle(pos) {
  let a = ARC_START + pos;
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/* ------------------------------------------------------------------ */
/* Ring drawing with 4×4 supersampling (anti-aliasing)                  */
/* ------------------------------------------------------------------ */

function drawRing(iR, oR, fillFrac, fr, fg, fb, tr, tg, tb) {
  const G = 4, G2 = G * G;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let fN = 0, tN = 0;
      for (let sy = 0; sy < G; sy++) {
        for (let sx = 0; sx < G; sx++) {
          const dx = x - CX + (sx + 0.5) / G - 0.5;
          const dy = y - CY + (sy + 0.5) / G - 0.5;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d >= iR && d <= oR) {
            const cat = arcCat(dx, dy, fillFrac);
            if (cat === 'fill')  fN++;
            if (cat === 'track') tN++;
          }
        }
      }
      if (tN > 0) blendPx(x, y, tr, tg, tb, Math.round(tN / G2 * 255));
      if (fN > 0) blendPx(x, y, fr, fg, fb, Math.round(fN / G2 * 255));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Solid circle (for rounded end-caps)                                  */
/* ------------------------------------------------------------------ */

function solidCircle(cx, cy, r, r_c, g_c, b_c) {
  const r2 = r * r;
  for (let y = Math.ceil(cy - r); y <= Math.floor(cy + r); y++)
    for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2)
        solidPx(x, y, r_c, g_c, b_c);
}

/* ------------------------------------------------------------------ */
/* Draw the two rings                                                    */
/* ------------------------------------------------------------------ */

// Outer ring: coral #E06C3E, 68% filled
const O_IN = 42, O_OUT = 54, O_FILL = 0.68;
const O_MID = (O_IN + O_OUT) / 2, O_CAP = (O_OUT - O_IN) / 2;

drawRing(O_IN, O_OUT, O_FILL,
  0xE0, 0x6C, 0x3E,   // fill  coral
  0x28, 0x28, 0x45    // track dim navy
);

const oFillAngle = arcPosToAngle(ARC_SPAN * O_FILL);
solidCircle(CX + O_MID * Math.cos(ARC_START),    CY + O_MID * Math.sin(ARC_START),    O_CAP, 0xE0, 0x6C, 0x3E);
solidCircle(CX + O_MID * Math.cos(oFillAngle),   CY + O_MID * Math.sin(oFillAngle),   O_CAP, 0xE0, 0x6C, 0x3E);

// Inner ring: electric blue #5AB4FF, 32% filled
const I_IN = 26, I_OUT = 34, I_FILL = 0.32;
const I_MID = (I_IN + I_OUT) / 2, I_CAP = (I_OUT - I_IN) / 2;

drawRing(I_IN, I_OUT, I_FILL,
  0x5A, 0xB4, 0xFF,   // fill  blue
  0x28, 0x28, 0x45    // track dim navy
);

const iFillAngle = arcPosToAngle(ARC_SPAN * I_FILL);
solidCircle(CX + I_MID * Math.cos(ARC_START),    CY + I_MID * Math.sin(ARC_START),    I_CAP, 0x5A, 0xB4, 0xFF);
solidCircle(CX + I_MID * Math.cos(iFillAngle),   CY + I_MID * Math.sin(iFillAngle),   I_CAP, 0x5A, 0xB4, 0xFF);

/* ------------------------------------------------------------------ */
/* PNG encoding (CRC32 + zlib, no dependencies)                         */
/* ------------------------------------------------------------------ */

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // filter: None
  rgba.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, '..', 'images');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
fs.writeFileSync(outPath, png);
console.log('Icon written to images/icon.png');
