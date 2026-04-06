/**
 * Generates placeholder 16×16px sprite sheets for the Blåmes (blue tit).
 * Each animation is a horizontal strip of 16×16 frames.
 *
 * Palette colours used:
 *   #1a1025  dark outline
 *   #4a7abf  blue (head, wing)
 *   #90b8e8  light blue (wing highlight)
 *   #f0ead6  warm white (cheek patch)
 *   #f0a020  warm yellow (breast)
 *   #1a3320  dark green (back)
 *   #2d1b33  very dark (eye, mask)
 *   #2d6b2e  mid green (unused here)
 *
 * Run with: node scripts/generate-bird-sprites.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'sprites', 'environment');

// Palette shorthand (RGBA arrays)
const D = [0x1a, 0x10, 0x25, 255]; // dark outline
const B = [0x4a, 0x7a, 0xbf, 255]; // blue head/wing
const L = [0x90, 0xb8, 0xe8, 255]; // light blue wing highlight
const W = [0xf0, 0xea, 0xd6, 255]; // warm white cheek
const Y = [0xf0, 0xa0, 0x20, 255]; // warm yellow breast
const G = [0x1a, 0x33, 0x20, 255]; // dark green back
const E = [0x2d, 0x1b, 0x33, 255]; // very dark eye/mask
const _ = [0, 0, 0, 0];            // transparent

/** Base bird body facing right — 16×16 */
const BASE = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,D,D,D,_,_,_,_,_,_,_,_],
  [_,_,_,_,D,B,B,B,D,_,_,_,_,_,_,_],
  [_,_,_,D,B,B,E,B,B,D,_,_,_,_,_,_],
  [_,_,_,D,B,W,W,B,B,B,D,_,_,_,_,_],
  [_,_,D,G,G,B,B,B,B,B,B,D,_,_,_,_],
  [_,_,D,G,G,G,Y,Y,Y,B,B,D,_,_,_,_],
  [_,_,D,G,G,G,Y,Y,Y,B,D,_,_,_,_,_],
  [_,_,_,D,G,G,Y,Y,Y,D,_,_,_,_,_,_],
  [_,_,_,_,D,D,D,D,D,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** Wing position variants for fly animation */
const WINGS_UP = [
  [_,D,D,L,L,_,_,_,_,_,L,L,D,D,_,_],
  [D,L,L,L,L,D,_,_,D,L,L,L,L,D,_,_],
  [_,D,D,L,B,B,D,D,B,B,L,D,D,_,_,_],
];
const WINGS_MID = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,D,L,L,D,_,_,_,_,D,L,L,D,_,_,_],
  [D,L,L,B,B,D,_,_,D,B,B,L,L,D,_,_],
];
const WINGS_DOWN = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,D,L,B,D,_,_,D,B,L,D,_,_,_,_],
];

function applyWings(base, wingsRows, startRow = 3) {
  const frame = base.map(r => [...r]);
  wingsRows.forEach((row, i) => {
    row.forEach((px, x) => {
      if (px[3] > 0) frame[startRow + i][x] = px;
    });
  });
  return frame;
}

/** Idle frame 1 — sitting upright */
const IDLE_1 = BASE.map(r => [...r]);

/** Idle frame 2 — head tilted slightly (shift head column 1px right) */
const IDLE_2 = BASE.map((r, y) => {
  if (y >= 2 && y <= 4) {
    const row = [...r];
    // small head tilt — shift non-transparent pixels right by 1 in head area
    for (let x = W.length - 1; x > 0; x--) {
      if (x < 10) row[x] = row[x - 1] ?? _;
    }
    row[0] = _;
    return row;
  }
  return [...r];
});

/** Fly frames */
const FLY_FRAMES = [
  applyWings(BASE, WINGS_UP, 2),
  applyWings(BASE, WINGS_MID, 3),
  applyWings(BASE, WINGS_DOWN, 4),
  applyWings(BASE, WINGS_MID, 3),
];

/** Drink frames — bird bends down */
function shiftDown(frame, shiftY) {
  const out = Array.from({ length: 16 }, () => Array(16).fill(_));
  for (let y = 0; y < 16; y++) {
    const srcY = y - shiftY;
    if (srcY >= 0 && srcY < 16) out[y] = [...frame[srcY]];
  }
  return out;
}

const DRINK_FRAMES = [
  BASE,                     // sitting upright
  shiftDown(BASE, 2),       // bending toward water
  shiftDown(BASE, 4),       // head down at water
  shiftDown(BASE, 2),       // lifting back up
];

/** Hop frames — bird hops on ground */
const HOP_FRAMES = [
  BASE,
  shiftDown(BASE, -2),      // lifted up
  BASE,
  shiftDown(BASE, 1),       // landing squat
];

// ─── Rendering helpers ───────────────────────────────────────────────────────

function frameToBuffer(frame) {
  const buf = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const px = frame[y]?.[x] ?? _;
      const i = (y * 16 + x) * 4;
      buf[i]     = px[0];
      buf[i + 1] = px[1];
      buf[i + 2] = px[2];
      buf[i + 3] = px[3];
    }
  }
  return buf;
}

async function writeSheet(filename, frames) {
  const w = 16 * frames.length;
  const buf = Buffer.alloc(w * 16 * 4);
  frames.forEach((frame, fi) => {
    const fb = frameToBuffer(frame);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const src = (y * 16 + x) * 4;
        const dst = (y * w + fi * 16 + x) * 4;
        fb.copy(buf, dst, src, src + 4);
      }
    }
  });
  const out = path.join(OUT_DIR, filename);
  await sharp(buf, { raw: { width: w, height: 16, channels: 4 } }).png().toFile(out);
  console.log(`Written: ${out} (${frames.length} frames, ${w}×16)`);
}

// ─── Generate all sheets ─────────────────────────────────────────────────────

await mkdir(OUT_DIR, { recursive: true });

await writeSheet('bird-bluetit-fly.png',   FLY_FRAMES);
await writeSheet('bird-bluetit-idle.png',  [IDLE_1, IDLE_2]);
await writeSheet('bird-bluetit-drink.png', DRINK_FRAMES);
await writeSheet('bird-bluetit-hop.png',   HOP_FRAMES);

console.log('\nAll Blåmes sprite sheets generated.');
