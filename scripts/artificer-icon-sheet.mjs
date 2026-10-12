#!/usr/bin/env node
/**
 * artificer-icon-sheet.mjs — contact sheet of the Artificer's item icons (#1674).
 *
 * Reads src/artificer/content/art-briefs.json and lays out every item that has
 * an `icon`: the icon at 4× (nearest-neighbour, so the pixels stay square),
 * the same icon at 1× beside it (how it really reads), and the item id
 * underneath. Kept Homestead icons get a grey id, new ones a dark id, and
 * tier-1 items (card first, icon provisional) a "T1" tag.
 *
 * Usage:
 *   node scripts/artificer-icon-sheet.mjs                       # → docs/art/contact-sheet-items.png
 *   node scripts/artificer-icon-sheet.mjs --out some/file.png
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : 'docs/art/contact-sheet-items.png');

const briefs = JSON.parse(readFileSync(join(ROOT, 'src/artificer/content/art-briefs.json'), 'utf8')).items;
const items = Object.entries(briefs).filter(([, b]) => b.icon);

const SCALE = 4;
const ICON = 32;
const BIG = ICON * SCALE;      // 128
const PAD = 12;
const LABEL_H = 18;
const CELL_W = BIG + ICON + PAD * 3;
const CELL_H = BIG + LABEL_H + PAD * 2;
const COLS = 6;
const ROWS = Math.ceil(items.length / COLS);
const HEADER = 34;
const W = COLS * CELL_W;
const H = HEADER + ROWS * CELL_H;

// A kept icon is one of the old Homestead files (item-*.png); new ones are named by item id.
const isKept = (icon) => /\/item-[^/]+\.png$/.test(icon);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const composites = [];
const labels = [];
for (const [n, [id, b]] of items.entries()) {
  const x = (n % COLS) * CELL_W;
  const y = HEADER + Math.floor(n / COLS) * CELL_H;
  const file = join(ROOT, 'public', b.icon);
  const big = await sharp(file).resize(BIG, BIG, { kernel: 'nearest' }).png().toBuffer();
  composites.push({ input: big, left: x + PAD, top: y + PAD });
  composites.push({ input: file, left: x + PAD * 2 + BIG, top: y + PAD + BIG - ICON });
  const colour = isKept(b.icon) ? '#797e83' : '#2a1f1e';
  const tag = b.tier === 1 ? ' · T1' : '';
  labels.push(`<text x="${x + PAD}" y="${y + PAD + BIG + 14}" fill="${colour}">${esc(id)}${tag}</text>`);
}

const kept = items.filter(([, b]) => isKept(b.icon)).length;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <style>text { font-family: DejaVu Sans Mono, monospace; font-size: 12px; }</style>
  <text x="${PAD}" y="22" fill="#2a1f1e" style="font-size:14px">Artificer item icons — ${items.length} (${kept} kept in grey, ${items.length - kept} new) · 4× and 1× · T1 = tier 1, provisional until its card</text>
  ${labels.join('\n  ')}
</svg>`;

mkdirSync(dirname(OUT), { recursive: true });
await sharp({ create: { width: W, height: H, channels: 4, background: '#d8d0c2' } })
  .composite([...composites, { input: Buffer.from(svg), left: 0, top: 0 }])
  .png()
  .toFile(OUT);
console.log(`Contact sheet: ${relative(ROOT, OUT)} (${items.length} icons, ${W}×${H})`);
