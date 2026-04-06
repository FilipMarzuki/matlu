/**
 * generate-palette.ts
 * Reads docs/matlu-palette.hex and writes a 32×1px PNG to docs/matlu-palette.png.
 * Run with: node scripts/generate-palette.mjs  (use the .mjs companion for direct execution)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const hexPath = resolve(root, 'docs', 'matlu-palette.hex');
const pngPath = resolve(root, 'docs', 'matlu-palette.png');

const lines = readFileSync(hexPath, 'utf8')
  .split('\n')
  .map((l: string) => l.trim())
  .filter((l: string) => l.length === 6);

if (lines.length !== 32) {
  console.error(`Expected 32 colours, got ${lines.length}`);
  process.exit(1);
}

// Build a raw RGB buffer — 32 pixels wide, 1 pixel tall, 3 bytes per pixel.
const buf = Buffer.alloc(32 * 3);
for (let i = 0; i < lines.length; i++) {
  const hex = lines[i];
  buf[i * 3 + 0] = parseInt(hex.slice(0, 2), 16);
  buf[i * 3 + 1] = parseInt(hex.slice(2, 4), 16);
  buf[i * 3 + 2] = parseInt(hex.slice(4, 6), 16);
}

await sharp(buf, { raw: { width: 32, height: 1, channels: 3 } })
  .png()
  .toFile(pngPath);

console.log(`Palette written to ${pngPath}`);
