/**
 * assemble-sprites.mjs
 *
 * Takes raw frames downloaded from PixelLab and assembles them into Phaser-ready
 * spritesheets + Aseprite-compatible JSON files. Handles both characters and tilesets.
 *
 * Usage:
 *   npm run sprites:assemble                    — process all pending assets
 *   npm run sprites:assemble -- --id skald      — process one asset by id
 *   npm run sprites:assemble -- --status        — show spec status, exit
 *   npm run sprites:assemble -- --dry-run       — preview without writing files
 *
 * ## Raw frame naming convention (characters)
 *
 *   public/assets/sprites/_raw/[id]/
 *     anim_{animName}_{direction}_{frameIndex}.png
 *
 *   Valid directions: south, north, east, west
 *   Example: anim_idle_south_0.png, anim_walk_north_2.png
 *
 * ## Raw file naming convention (tilesets)
 *
 *   public/assets/sprites/_raw/[id]/
 *     tileset.png   — the full tileset sheet as returned by PixelLab
 *
 * ## Phaser usage (characters)
 *
 *   this.load.aseprite('skald', 'path/to/skald.png', 'path/to/skald.json');
 *   this.anims.createFromAseprite('skald');
 *   sprite.anims.play('skald_walk_south');   // ← prefixed with character ID
 *
 * ## Animation key format
 *
 *   Animation keys are namespaced as `{characterId}_{animId}_{direction}` so
 *   multiple characters can coexist in the same Phaser animation manager without
 *   key collisions. e.g. skald_idle_south, spider_walk_north, crow_attack_east.
 *
 * ## Character spritesheet layout
 *
 *   Row 0 — south: [idle_0..N | walk_0..M | attack_0..P | death_0..Q]
 *   Row 1 — north: [same animation order]
 *   Row 2 — east
 *   Row 3 — west
 */

import { readdir, readFile, writeFile, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const RAW_DIR   = join(ROOT, 'public/assets/sprites/_raw');
const SPEC_PATH = join(ROOT, 'src/ai/asset-spec.json');

const DIRECTIONS = ['south', 'north', 'east', 'west'];

// ── CLI args ──────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const idFilter = args.includes('--id')     ? args[args.indexOf('--id') + 1] : null;
const dryRun   = args.includes('--dry-run');
const status   = args.includes('--status');

// ── Load spec ─────────────────────────────────────────────────────────────────

const spec = JSON.parse(await readFile(SPEC_PATH, 'utf8'));

// ── Status mode ───────────────────────────────────────────────────────────────

if (status) {
  printStatus(spec);
  process.exit(0);
}

// ── Process assets ────────────────────────────────────────────────────────────

let processed = 0;
let skipped   = 0;

const allAssets = [
  ...spec.characters.map(a => ({ ...a, _type: 'character' })),
  ...spec.tilesets.map(a  => ({ ...a, _type: 'tileset'   })),
];

for (const asset of allAssets) {
  if (idFilter && asset.id !== idFilter) continue;
  if (asset.status === 'done') {
    console.log(`✓  ${asset.id}: already done — skipping`);
    skipped++;
    continue;
  }

  const rawDir = join(RAW_DIR, asset.id);
  if (!existsSync(rawDir)) {
    console.log(`⏭  ${asset.id}: no raw frames at ${rawDir} — skipping`);
    skipped++;
    continue;
  }

  console.log(`\n🔧 Assembling [${asset._type}]: ${asset.name} (${asset.id})`);

  try {
    if (asset._type === 'character') {
      await assembleCharacter(asset, rawDir, dryRun);
    } else {
      await assembleTileset(asset, rawDir, dryRun);
    }

    if (!dryRun) {
      await markDone(asset.id, asset._type);
    }

    processed++;
  } catch (err) {
    console.error(`❌ Failed to assemble ${asset.id}:`, err.message);
  }
}

console.log(`\n✅ Done. Processed: ${processed}, Skipped: ${skipped}`);

// ── Character assembly ────────────────────────────────────────────────────────

async function assembleCharacter(charSpec, rawDir, dryRun) {
  const files     = await readdir(rawDir);
  const animFiles = files.filter(f => f.match(/^anim_.+_(south|north|east|west)_\d+\.png$/));

  if (animFiles.length === 0) {
    throw new Error('No anim_*.png files found in raw dir');
  }
  console.log(`   Raw frames: ${animFiles.length}`);

  // Parse frame filenames
  const parsed = animFiles.map(f => {
    const m = f.match(/^anim_(.+)_(south|north|east|west)_(\d+)\.png$/);
    if (!m) throw new Error(`Unexpected filename: ${f}`);
    return { file: f, animId: m[1], direction: m[2], frameIndex: parseInt(m[3]) };
  });

  // Group by animId_direction, sorted by frameIndex
  const groups = {};
  for (const p of parsed) {
    const key = `${p.animId}_${p.direction}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.frameIndex - b.frameIndex);
  }

  const animOrder      = charSpec.animations.map(a => a.id);
  const frameDurations = Object.fromEntries(charSpec.animations.map(a => [a.id, a.frameDurationMs ?? 150]));

  // Frame dimensions from first file
  const { width: fw, height: fh } = await sharp(join(rawDir, animFiles[0])).metadata();
  console.log(`   Frame size: ${fw}×${fh}px`);

  // Build rows: one per direction, animations concatenated in spec order
  const rowFrames = {};
  for (const dir of DIRECTIONS) {
    rowFrames[dir] = [];
    for (const animId of animOrder) {
      const frames = groups[`${animId}_${dir}`] ?? [];
      if (frames.length === 0) console.warn(`   ⚠ Missing frames for ${animId}_${dir}`);
      rowFrames[dir].push(...frames.map(g => ({ ...g, animId })));
    }
  }

  const framesPerRow = Math.max(...Object.values(rowFrames).map(r => r.length));
  const sheetW       = framesPerRow * fw;
  const sheetH       = DIRECTIONS.length * fh;
  console.log(`   Sheet: ${sheetW}×${sheetH}px (${framesPerRow} cols × ${DIRECTIONS.length} rows)`);

  // Build flat frame list and composite operations
  const frameList    = [];
  const compositeOps = [];
  let globalIndex    = 0;

  for (let rowIdx = 0; rowIdx < DIRECTIONS.length; rowIdx++) {
    const dir    = DIRECTIONS[rowIdx];
    const frames = rowFrames[dir];
    for (let colIdx = 0; colIdx < frames.length; colIdx++) {
      const { file, animId } = frames[colIdx];
      const x = colIdx * fw;
      const y = rowIdx * fh;
      compositeOps.push({ input: join(rawDir, file), left: x, top: y });
      frameList.push({
        filename: `${animId}_${dir}_${colIdx}`,
        frame: { x, y, w: fw, h: fh },
        rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
        sourceSize: { w: fw, h: fh },
        duration: frameDurations[animId] ?? 150,
        _animId: animId, _direction: dir, _globalIndex: globalIndex++,
      });
    }
  }

  // Build Aseprite frame tags (one per animId × direction)
  const frameTags = [];
  for (const dir of DIRECTIONS) {
    for (const animId of animOrder) {
      const matching = frameList.filter(f => f._animId === animId && f._direction === dir);
      if (matching.length === 0) continue;
      frameTags.push({
        // Prefix with character ID to avoid key collisions when multiple
        // characters are registered in the same Phaser animation manager.
        name: `${charSpec.id}_${animId}_${dir}`,
        from: matching[0]._globalIndex,
        to:   matching[matching.length - 1]._globalIndex,
        direction: 'forward',
      });
    }
  }

  const cleanFrames = frameList.map(({ _animId, _direction, _globalIndex, ...rest }) => rest);
  const outputName  = charSpec.id;

  const json = {
    frames: cleanFrames,
    meta: {
      app: 'assemble-sprites', version: '1.0',
      image: `${outputName}.png`, format: 'RGBA8888',
      size: { w: sheetW, h: sheetH }, scale: '1',
      frameTags,
    },
  };

  if (dryRun) {
    console.log(`   [dry-run] Would write to ${charSpec.outputDir}/`);
    console.log(`   Frame tags: ${frameTags.map(t => t.name).join(', ')}`);
    return;
  }

  const outDir = join(ROOT, charSpec.outputDir);
  await mkdir(outDir, { recursive: true });
  await sharp({
    create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(compositeOps).png().toFile(join(outDir, `${outputName}.png`));
  await writeFile(join(outDir, `${outputName}.json`), JSON.stringify(json, null, 2));

  console.log(`   ✓ ${charSpec.outputDir}/${outputName}.png`);
  console.log(`   ✓ ${charSpec.outputDir}/${outputName}.json`);
  console.log(`   Frame tags: ${frameTags.map(t => t.name).join(', ')}`);
}

// ── Tileset assembly ──────────────────────────────────────────────────────────

async function assembleTileset(tileSpec, rawDir, dryRun) {
  const srcPath = join(rawDir, 'tileset.png');
  if (!existsSync(srcPath)) {
    throw new Error(`Expected tileset.png in ${rawDir}`);
  }

  const { width, height } = await sharp(srcPath).metadata();
  console.log(`   Tileset: ${width}×${height}px`);

  if (dryRun) {
    console.log(`   [dry-run] Would copy to ${tileSpec.outputDir}/${tileSpec.id}.png`);
    return;
  }

  const outDir  = join(ROOT, tileSpec.outputDir);
  const outPath = join(outDir, `${tileSpec.id}.png`);
  await mkdir(outDir, { recursive: true });
  await copyFile(srcPath, outPath);

  console.log(`   ✓ ${tileSpec.outputDir}/${tileSpec.id}.png`);
}

// ── Status update ─────────────────────────────────────────────────────────────

async function markDone(id, type) {
  // Re-read spec fresh (in case multiple assets were processed and spec changed)
  const current = JSON.parse(await readFile(SPEC_PATH, 'utf8'));
  const list     = type === 'character' ? current.characters : current.tilesets;
  const entry    = list.find(a => a.id === id);
  if (entry) entry.status = 'done';
  await writeFile(SPEC_PATH, JSON.stringify(current, null, 2) + '\n');
}

// ── Status display ────────────────────────────────────────────────────────────

function printStatus(spec) {
  const all = [
    ...spec.characters.map(a => ({ ...a, _type: 'character' })),
    ...spec.tilesets.map(a  => ({ ...a, _type: 'tileset'   })),
  ];

  const icons = { pending: '⏳', generating: '🔄', done: '✅' };
  console.log('\nAsset spec status:\n');

  let lastWorld = null;
  for (const a of all) {
    if (a.world !== lastWorld) {
      console.log(`  ── ${a.world ?? 'unknown'} ──`);
      lastWorld = a.world;
    }
    const icon = icons[a.status] ?? '❓';
    const rawExists = existsSync(join(RAW_DIR, a.id));
    const rawNote   = rawExists ? ' [raw ready]' : '';
    console.log(`  ${icon} [${a._type}] ${a.id}  (${a.status})${rawNote}`);
  }

  const counts = all.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n  Total: ${all.length} — ${Object.entries(counts).map(([k,v]) => `${v} ${k}`).join(', ')}\n`);
}
