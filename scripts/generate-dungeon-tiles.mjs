/**
 * generate-dungeon-tiles.mjs
 *
 * Creates placeholder 16×16 pixel art tiles for the dungeon wall/doorway/torch
 * assets in the earth palette. These are structural placeholders that keep the
 * full pipeline (assemble → manifest → build) working until PixelLab credentials
 * are configured for high-quality generation.
 *
 * Usage:
 *   node scripts/generate-dungeon-tiles.mjs
 *
 * Output (gitignored raw dir, assembled by npm run sprites:assemble):
 *   public/assets/sprites/_raw/dungeon_wall_top/tileset.png
 *   public/assets/sprites/_raw/dungeon_wall_side/tileset.png
 *   public/assets/sprites/_raw/dungeon_doorway/tileset.png
 *   public/assets/sprites/_raw/dungeon_torch/tileset.png   (48×16, 3-frame strip)
 */

import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'public/assets/sprites/_raw');

// ── Earth palette (dark stone, muted warm tones — matches arena_floor_earth) ──
const V  = [8,   6,   5,  255]; // void / near-black
const M  = [30,  24,  18, 255]; // mortar / grout
const S1 = [48,  40,  32, 255]; // dark stone edge / shadow
const S2 = [62,  52,  42, 255]; // medium stone body
const S3 = [78,  66,  54, 255]; // lighter stone face
const S4 = [92,  78,  64, 255]; // stone highlight
const I1 = [46,  38,  30, 255]; // iron bracket (dark)
const I2 = [60,  50,  40, 255]; // iron bracket (highlight)
const E1 = [120, 45,   8, 255]; // dim ember (dark red)
const F1 = [185,  88,  20, 255]; // medium flame (orange)
const F2 = [215, 145,  38, 255]; // bright flame (amber)
const F3 = [230, 185,  80, 255]; // flame tip (bright yellow-amber)

// ── Pixel buffer builder ──────────────────────────────────────────────────────

function makeTile(w, h, drawFn) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = drawFn(x, y);
      const i = (y * w + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png();
}

async function save(pipeline, id, filename) {
  const dir = join(RAW_DIR, id);
  await mkdir(dir, { recursive: true });
  const out = join(dir, filename);
  await pipeline.toFile(out);
  console.log(`✓  ${out}`);
}

// ── Tile draw functions ───────────────────────────────────────────────────────

/**
 * Wall top face: 2×2 stone block grid viewed from above.
 * Mortar lines at x=0, x=8, y=0, y=8 (1px each).
 * Each 7×7 block has shadow edges and a highlight corner.
 */
function drawWallTop(x, y) {
  if (x === 0 || x === 8 || y === 0 || y === 8) return M;

  // Block-local coords (0–6)
  const bx = x < 8 ? x - 1 : x - 9;
  const by = y < 8 ? y - 1 : y - 9;

  if (bx === 0 || bx === 6 || by === 0 || by === 6) return S1; // shadow edge
  if (bx === 1 && by === 1) return S4;                          // highlight corner
  if (bx === 1 || by === 1) return S3;                          // highlight edge
  return S2;                                                      // body
}

/**
 * Wall side face: horizontal brick courses viewed front-on.
 * 3 courses (5px tall each) with 1px mortar rows and offset vertical mortar.
 *
 * Course 0 (y 1–5):   vertical mortar at x=8
 * Course 1 (y 7–11):  vertical mortar at x=4 and x=12  (offset)
 * Course 2 (y 13–15): partial course (same offsets as course 0)
 */
function drawWallSide(x, y) {
  // Horizontal mortar bands
  if (y === 0 || y === 6 || y === 12) return M;

  const course    = y <= 5 ? 0 : y <= 11 ? 1 : 2;
  const courseY   = y <= 5 ? y - 1 : y <= 11 ? y - 7 : y - 13;
  const mortarCols = course % 2 === 0 ? [8] : [4, 12];

  if (mortarCols.includes(x)) return M;

  // Top highlight and bottom shadow within each course
  if (courseY === 0) return S4;
  if (courseY === 4 || (course === 2 && courseY === 2)) return S1;

  // Left edge shadow
  if (x === 0 || mortarCols.some(m => x === m + 1)) return S1;
  // Right edge shadow
  if (x === 15 || mortarCols.some(m => x === m - 1)) return S1;

  return S2;
}

/**
 * Doorway / arch: 3px stone pillar each side, dark void in centre.
 * Top 3 rows form the arch crown; pillar continues below.
 */
function drawDoorway(x, y) {
  const PILLAR = 3;
  const isLeft  = x < PILLAR;
  const isRight = x >= 16 - PILLAR;

  // Arch crown (top 3 rows): full stone
  if (y < PILLAR) {
    if (isLeft || isRight || y === 0) return S1;
    if (y === 1 && (x === PILLAR || x === 15 - PILLAR)) return S2; // arch inner corner
    if (y === 2) return S1; // lintel
    return S2;
  }

  // Pillar sides
  if (isLeft) {
    if (x === 0)          return S1;
    if (x === PILLAR - 1) return S3;
    return S2;
  }
  if (isRight) {
    if (x === 15)         return S1;
    if (x === 16 - PILLAR) return S1;
    return S2;
  }

  // Central void (doorway opening)
  return V;
}

/**
 * Torch strip (48×16): 3 animation frames side by side.
 * Frame 0: dim ember   (x 0–15)
 * Frame 1: medium flame (x 16–31)
 * Frame 2: bright flame (x 32–47)
 */
function drawTorchStrip(x, y) {
  const frame = Math.floor(x / 16);
  const fx    = x % 16; // x within this frame
  return drawTorchFrame(fx, y, frame);
}

function drawTorchFrame(x, y, frame) {
  // Iron wall-mount bracket: bottom centre, 6px wide, 4px tall
  if (y >= 11 && y <= 14 && x >= 5 && x <= 10) {
    if (x === 5 || x === 10 || y === 11) return I1;
    return I2;
  }

  // Torch body (vertical): 2px wide, middle column, above bracket
  if (y >= 5 && y <= 11 && x >= 7 && x <= 8) {
    return x === 7 ? I1 : I2;
  }

  // Flame / ember — varies by frame
  if (frame === 0) {
    // Dim ember: single pixel cluster
    if (y === 5 && (x === 7 || x === 8)) return E1;
    if (y === 4 && x === 7)              return E1;
  } else if (frame === 1) {
    // Medium flame
    if (y === 5 && (x === 6 || x === 9))              return E1;
    if (y === 5 && (x === 7 || x === 8))              return F1;
    if (y === 4 && x >= 6 && x <= 9)                  return F1;
    if (y === 3 && (x === 7 || x === 8))              return F1;
    if (y === 3 && (x === 6 || x === 9))              return E1;
    if (y === 2 && x === 7)                            return F2;
  } else {
    // Bright flame
    if (y === 5 && (x === 6 || x === 9))              return F1;
    if (y === 5 && (x === 7 || x === 8))              return F1;
    if (y === 4 && (x === 6 || x === 9))              return F1;
    if (y === 4 && (x === 7 || x === 8))              return F2;
    if (y === 3 && (x === 6 || x === 9))              return F1;
    if (y === 3 && (x === 7 || x === 8))              return F2;
    if (y === 2 && (x === 6 || x === 9))              return E1;
    if (y === 2 && (x === 7 || x === 8))              return F3;
    if (y === 1 && x === 7)                            return F3;
    if (y === 1 && (x === 6 || x === 8))              return F2;
    if (y === 0 && x === 7)                            return F2;
  }

  return V;
}

// ── Generate ──────────────────────────────────────────────────────────────────

await save(makeTile(16, 16, drawWallTop),      'dungeon_wall_top',  'tileset.png');
await save(makeTile(16, 16, drawWallSide),     'dungeon_wall_side', 'tileset.png');
await save(makeTile(16, 16, drawDoorway),      'dungeon_doorway',   'tileset.png');
await save(makeTile(48, 16, drawTorchStrip),   'dungeon_torch',     'tileset.png');

console.log('\nDone. Run: npm run sprites:assemble -- --id dungeon_wall_top (etc.)');
