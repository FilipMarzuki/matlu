/**
 * Generates a 16×32px placeholder top-down character sprite.
 * Uses palette colours from docs/matlu-palette.hex.
 * Output: public/assets/sprites/player/character.png
 *
 * Run with: node scripts/generate-character.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'assets', 'sprites', 'player', 'character.png');

// Palette entries (R, G, B)
const DARK   = [0x1a, 0x10, 0x25]; // #1a1025 dark outline
const SKIN   = [0xf0, 0xea, 0xd6]; // #f0ead6 warm off-white skin
const SHIRT  = [0x4a, 0x7a, 0xbf]; // #4a7abf mid blue shirt
const PANTS  = [0x2d, 0x1b, 0x33]; // #2d1b33 dark purple pants
const HAIR   = [0x6b, 0x4c, 0x2a]; // #6b4c2a brown hair
const CLEAR  = [0, 0, 0];          // used as transparent placeholder (will be set alpha=0)

// 16×32 pixel map (each entry is a palette key)
// Top-down 3/4 view: head at top, feet at bottom
const D = 'D'; // dark outline
const S = 'S'; // skin
const H = 'H'; // hair
const C = 'C'; // shirt/clothes
const P = 'P'; // pants
const _ = '_'; // transparent

const pixels = [
  // Row 0-1: empty above head
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  // Row 2-3: hair top
  [_,_,_,_,D,D,D,D,D,D,D,D,_,_,_,_],
  [_,_,_,D,H,H,H,H,H,H,H,H,D,_,_,_],
  // Row 4-5: face
  [_,_,D,H,S,S,S,S,S,S,S,H,H,D,_,_],
  [_,_,D,S,S,S,S,S,S,S,S,S,H,D,_,_],
  // Row 6: neck
  [_,_,_,D,S,S,S,S,S,S,S,S,D,_,_,_],
  [_,_,_,_,D,D,S,S,S,D,D,_,_,_,_,_],
  // Row 8-11: torso / shirt
  [_,_,D,D,C,C,C,C,C,C,C,C,D,D,_,_],
  [_,_,D,C,C,C,C,C,C,C,C,C,C,D,_,_],
  [_,_,D,C,C,C,C,C,C,C,C,C,C,D,_,_],
  [_,_,D,C,C,C,C,C,C,C,C,C,C,D,_,_],
  // Row 12-13: belt / waist
  [_,_,D,C,C,D,D,D,D,D,D,C,C,D,_,_],
  [_,_,_,D,D,P,P,P,P,P,P,D,D,_,_,_],
  // Row 14-17: legs / pants
  [_,_,D,P,P,P,_,_,_,_,P,P,P,D,_,_],
  [_,_,D,P,P,P,_,_,_,_,P,P,P,D,_,_],
  [_,_,D,P,P,P,_,_,_,_,P,P,P,D,_,_],
  [_,_,D,P,P,P,_,_,_,_,P,P,P,D,_,_],
  // Row 18-19: lower legs
  [_,_,_,D,P,P,D,_,_,D,P,P,D,_,_,_],
  [_,_,_,D,P,P,D,_,_,D,P,P,D,_,_,_],
  // Row 20-21: ankles
  [_,_,_,_,D,D,_,_,_,_,D,D,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  // Rows 22-31: empty below feet
  ...(Array(10).fill([_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_])),
];

const W = 16, H_PX = 32;
const buf = Buffer.alloc(W * H_PX * 4); // RGBA

const colourMap = { D: DARK, S: SKIN, H: HAIR, C: SHIRT, P: PANTS, _: CLEAR };

for (let y = 0; y < H_PX; y++) {
  for (let x = 0; x < W; x++) {
    const key = pixels[y]?.[x] ?? '_';
    const [r, g, b] = colourMap[key] ?? CLEAR;
    const alpha = key === '_' ? 0 : 255;
    const i = (y * W + x) * 4;
    buf[i]     = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = alpha;
  }
}

await mkdir(path.dirname(OUT), { recursive: true });
await sharp(buf, { raw: { width: W, height: H_PX, channels: 4 } })
  .png()
  .toFile(OUT);

console.log(`Character sprite written to ${OUT}`);
