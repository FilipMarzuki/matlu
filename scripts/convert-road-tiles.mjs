#!/usr/bin/env node
/**
 * Convert SBS Isometric Pathways Pack spritesheets from magenta color-key
 * to proper RGBA transparency, then downscale each 128×64 frame to 32×16
 * (nearest-neighbor) and reassemble into a single-row spritesheet.
 *
 * Usage: node scripts/convert-road-tiles.mjs
 *
 * Input:  public/assets/packs/sbs_-_isometric_pathways_pack_-_small/Exterior Small 128x64/<Terrain>/
 * Output: public/assets/sprites/tilesets/roads/road-<type>.png  (32×16 per frame, single row)
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const SBS_BASE = path.join(
  root,
  'public/assets/packs/sbs_-_isometric_pathways_pack_-_small/Exterior Small 128x64',
);

const OUT_DIR = path.join(root, 'public/assets/sprites/tilesets/roads');

// Source frame size and target frame size
const SRC_W = 128, SRC_H = 64;
const DST_W = 32,  DST_H = 16;
const COLS = 4, ROWS = 3;
const FRAMES = COLS * ROWS; // 12

// Map each road type key to an SBS terrain folder and sheet number.
// Keys become the file name: road-<key>.png and the Phaser texture key.
const ROAD_MAP = {
  // Original types
  'dirt':         { terrain: 'Dry',      sheet: 3  },
  'forest':       { terrain: 'Flora',    sheet: 1  },
  'animal':       { terrain: 'Rocky',    sheet: 1  },
  // Stone/paved variants
  'stones-03':    { terrain: 'Stones',   sheet: 3  },
  'stones-05':    { terrain: 'Stones',   sheet: 5  },
  'stones-06':    { terrain: 'Stones',   sheet: 6  },
  'stones-10':    { terrain: 'Stones',   sheet: 10 },
  'stones-19':    { terrain: 'Stones',   sheet: 19 },
  'stones-20':    { terrain: 'Stones',   sheet: 20 },
  'stones-24':    { terrain: 'Stones',   sheet: 24 },
  'stones-32':    { terrain: 'Stones',   sheet: 32 },
  // Rocky variants
  'rocky-29':     { terrain: 'Rocky',    sheet: 29 },
  'rocky-33':     { terrain: 'Rocky',    sheet: 33 },
  // Ice variants
  'ice-15':       { terrain: 'Ice',      sheet: 15 },
  'ice-17':       { terrain: 'Ice',      sheet: 17 },
  'ice-28':       { terrain: 'Ice',      sheet: 28 },
  // Elements
  'elements-34':  { terrain: 'Elements', sheet: 34 },
  // Dry variants
  'dry-02':       { terrain: 'Dry',      sheet: 2  },
  'dry-24':       { terrain: 'Dry',      sheet: 24 },
  'dry-32':       { terrain: 'Dry',      sheet: 32 },
};

async function convertSheet(roadKey, { terrain, sheet }) {
  const sheetNum = String(sheet).padStart(2, '0');
  const srcFile = path.join(SBS_BASE, terrain, `Path_${terrain}_${sheetNum}-128x64.png`);
  const dst = path.join(OUT_DIR, `road-${roadKey}.png`);

  console.log(`  ${roadKey}: ${terrain} sheet ${sheetNum}`);

  // Load the full spritesheet as raw RGBA
  const image = sharp(srcFile).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  // Replace magenta (255, 0, 255) with transparent
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }

  // Extract each 128×64 frame, downscale to 32×16, collect as buffers
  const smallFrames = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const frame = sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .extract({ left: col * SRC_W, top: row * SRC_H, width: SRC_W, height: SRC_H })
        .resize(DST_W, DST_H, { kernel: sharp.kernel.nearest })
        .raw();

      const buf = await frame.toBuffer();
      smallFrames.push(buf);
    }
  }

  // Assemble into a single-row spritesheet: FRAMES × DST_W wide, DST_H tall
  const outW = FRAMES * DST_W;
  const outH = DST_H;
  const outBuf = Buffer.alloc(outW * outH * 4);

  for (let f = 0; f < FRAMES; f++) {
    const frameBuf = smallFrames[f];
    for (let y = 0; y < DST_H; y++) {
      const srcOff = y * DST_W * 4;
      const dstOff = (y * outW + f * DST_W) * 4;
      frameBuf.copy(outBuf, dstOff, srcOff, srcOff + DST_W * 4);
    }
  }

  await sharp(outBuf, { raw: { width: outW, height: outH, channels: 4 } })
    .png()
    .toFile(dst);

  console.log(`    -> ${path.relative(root, dst)} (${outW}x${outH})`);
}

console.log('Converting SBS Isometric Pathways tiles...\n');

for (const [key, cfg] of Object.entries(ROAD_MAP)) {
  await convertSheet(key, cfg);
}

// Export the road type keys so other scripts/code can reference them
console.log(`\n${Object.keys(ROAD_MAP).length} road types converted.`);
console.log('Keys:', Object.keys(ROAD_MAP).join(', '));
