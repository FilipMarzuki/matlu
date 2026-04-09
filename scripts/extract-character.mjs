/**
 * extract-character.mjs
 *
 * Downloads a PixelLab character ZIP, inspects its structure, and renames
 * the frames into the project's raw naming convention so assemble-sprites.mjs
 * can process them.
 *
 * Usage:
 *   node scripts/extract-character.mjs --id skald --zip-url <url>
 *
 * The ZIP URL comes from get_character() → "Download as ZIP" link.
 * Run after ALL animations for the character are complete.
 *
 * Output:
 *   public/assets/sprites/_raw/[id]/anim_[animName]_[direction]_[frameIndex].png
 *
 * Animation mapping strategy (in order of priority):
 *   1. asset-lock.json (if present) — maps internal folder names → animId
 *   2. Prefix matching — PixelLab encodes the template name into the folder prefix
 *      (e.g. "jab_attack-<hash>" → "lead-jab", "falling_backward-<hash>" → "falling-back-death")
 *   3. Pixel variance — for generic "animating-<hash>" folders with the same frame count,
 *      the one with higher inter-frame variance is the walk/run animation (more movement)
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const RAW_DIR   = join(ROOT, 'public/assets/sprites/_raw');
const SPEC_PATH = join(ROOT, 'src/ai/asset-spec.json');
const LOCK_PATH = join(ROOT, 'src/ai/asset-lock.json');

// Known PixelLab folder prefix → template ID mappings (from observation).
// These are derived from PixelLab's internal animation naming convention.
const PREFIX_TO_TEMPLATE = {
  'jab_attack':        'lead-jab',
  'falling_backward':  'falling-back-death',
  'cross_punch':       'cross-punch',
  'roundhouse_kick':   'roundhouse-kick',
  'high_kick':         'high-kick',
  'running':           null, // ambiguous (running-4-frames / running-6-frames etc.)
  'jumping':           'jumping-1',
  'crouching':         'crouching',
  'fight_stance':      'fight-stance-idle-8-frames',
  'scary_walk':        'scary-walk',
  'getting_up':        'getting-up',
};

// Template names that indicate high-motion (walk/run) vs low-motion (idle/breathing).
// Used to break ties when pixel variance is the only differentiator.
const HIGH_MOTION_KEYWORDS = ['walk', 'run', 'attack', 'fight', 'jab', 'kick', 'punch', 'jump', 'death', 'scary'];
const LOW_MOTION_KEYWORDS  = ['idle', 'breath', 'crouch', 'drink'];

// ── CLI args ──────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const id      = args.includes('--id')      ? args[args.indexOf('--id') + 1]      : null;
const zipUrl  = args.includes('--zip-url') ? args[args.indexOf('--zip-url') + 1] : null;
const inspect = args.includes('--inspect'); // just show ZIP contents + mapping, don't copy

if (!id || !zipUrl) {
  console.error('Usage: node scripts/extract-character.mjs --id <id> --zip-url <url> [--inspect]');
  process.exit(1);
}

// ── Load spec & find character ────────────────────────────────────────────────

const spec     = JSON.parse(await readFile(SPEC_PATH, 'utf8'));
const charSpec = spec.characters.find(c => c.id === id);
if (!charSpec) {
  console.error(`Character "${id}" not found in asset-spec.json`);
  process.exit(1);
}

// Build template → animId map: e.g. { 'breathing-idle': 'idle', 'walking-4-frames': 'walk' }
const templateToAnimId = Object.fromEntries(
  charSpec.animations.map(a => [a.template, a.id])
);
console.log('Animation spec mapping:', templateToAnimId);

// ── Load asset-lock.json (optional) ──────────────────────────────────────────

// asset-lock.json format: { "<characterId>": { "<internalFolderName>": "<animId>" } }
// Agents should write this when queuing animations (animate_character returns a job ID
// whose first 8 hex chars appear in the folder name as "animating-<8chars>").
let lockMapping = null; // internalFolderName → animId, for this character
if (existsSync(LOCK_PATH)) {
  const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'));
  if (lock[id]) {
    lockMapping = lock[id];
    console.log('Using asset-lock.json for animation mapping:', lockMapping);
  }
}

// ── Download ZIP ──────────────────────────────────────────────────────────────

const tmpZip = join(ROOT, `tmp_${id}.zip`);
const tmpDir = join(ROOT, `tmp_${id}_extracted`);

console.log(`\nDownloading ZIP from PixelLab...`);
const res = await fetch(zipUrl);
if (!res.ok) {
  console.error(`Failed to download ZIP: HTTP ${res.status}`);
  const text = await res.text();
  console.error(text.slice(0, 500));
  process.exit(1);
}

const buf = await res.arrayBuffer();
if (buf.byteLength < 1024) {
  console.error(`ZIP too small (${buf.byteLength} bytes) — likely an error response, not a real ZIP`);
  const text = new TextDecoder().decode(buf);
  console.error(text.slice(0, 500));
  process.exit(1);
}

await writeFile(tmpZip, Buffer.from(buf));
console.log(`Downloaded: ${(buf.byteLength / 1024).toFixed(1)} KB`);

// ── Extract ZIP ───────────────────────────────────────────────────────────────

await mkdir(tmpDir, { recursive: true });
const unzipper = await import('unzipper');
await unzipper.Open.file(tmpZip).then(d => d.extract({ path: tmpDir }));

// ── Read metadata.json ────────────────────────────────────────────────────────

const metaPath = join(tmpDir, 'metadata.json');
if (!existsSync(metaPath)) {
  console.error('No metadata.json found in ZIP — unexpected ZIP structure.');
  process.exit(1);
}

const meta = JSON.parse(await readFile(metaPath, 'utf8'));
const animFolders = meta.frames?.animations ?? {};
const folderNames = Object.keys(animFolders);

console.log(`\nZIP animation folders (${folderNames.length}):`);
for (const folder of folderNames) {
  const dirs = Object.keys(animFolders[folder]);
  const frameCount = animFolders[folder][dirs[0]]?.length ?? 0;
  console.log(`  ${folder}  (${frameCount} frames × ${dirs.length} dirs)`);
}

if (inspect) {
  console.log('\n[--inspect mode] Stopping here. Clean up tmp files manually.');
  process.exit(0);
}

// ── Build internal folder → animId mapping ────────────────────────────────────

const folderToAnimId = {};
const unmappedFolders = [];

for (const folder of folderNames) {
  // 1. Check asset-lock.json
  if (lockMapping && lockMapping[folder]) {
    folderToAnimId[folder] = lockMapping[folder];
    console.log(`  lock: ${folder} → ${lockMapping[folder]}`);
    continue;
  }

  // 2. Prefix matching: extract the prefix part before the "-<hash>" suffix
  const prefix = folder.replace(/-[0-9a-f]{8}$/, '').replace(/-/g, '_');
  // Also try the original hyphenated form
  const prefixHyphen = folder.replace(/-[0-9a-f]{8}$/, '');

  const matchedTemplate = PREFIX_TO_TEMPLATE[prefix] ?? PREFIX_TO_TEMPLATE[prefixHyphen] ?? null;

  // Also try direct prefix → template name matching
  // e.g. if prefix exactly contains a template keyword
  let resolvedTemplate = matchedTemplate;
  if (!resolvedTemplate) {
    // Try substring match against all known templates
    for (const template of Object.keys(templateToAnimId)) {
      const templateSlug = template.replace(/-/g, '_');
      if (prefix.includes(templateSlug) || templateSlug.includes(prefix)) {
        resolvedTemplate = template;
        break;
      }
    }
  }

  if (resolvedTemplate && templateToAnimId[resolvedTemplate]) {
    folderToAnimId[folder] = templateToAnimId[resolvedTemplate];
    console.log(`  prefix: ${folder} → ${resolvedTemplate} → ${templateToAnimId[resolvedTemplate]}`);
  } else {
    unmappedFolders.push(folder);
  }
}

// 3. Pixel variance fallback for remaining unresolved folders
if (unmappedFolders.length > 0) {
  console.log(`\n  Resolving ${unmappedFolders.length} ambiguous folder(s) via pixel variance...`);

  // Group by frame count (same-frame-count folders compete with same-frame-count spec animations)
  const unmappedByFrameCount = {};
  for (const folder of unmappedFolders) {
    const dirs = Object.keys(animFolders[folder]);
    const fc = animFolders[folder][dirs[0]]?.length ?? 0;
    if (!unmappedByFrameCount[fc]) unmappedByFrameCount[fc] = [];
    unmappedByFrameCount[fc].push(folder);
  }

  // Find spec animations not yet mapped
  const mappedAnimIds = new Set(Object.values(folderToAnimId));
  const remainingAnimations = charSpec.animations.filter(a => !mappedAnimIds.has(a.id));

  for (const [fc, folders] of Object.entries(unmappedByFrameCount)) {
    const frameCount = parseInt(fc);
    const candidates = remainingAnimations.filter(a => {
      // We don't know exact frame count from spec, but we can check what's in the ZIP
      // Match candidates that have the same frame count
      return true; // include all remaining for now, narrow by frame count match
    });

    if (folders.length === 1 && candidates.length === 1) {
      // Unambiguous: only one folder and one remaining spec animation
      folderToAnimId[folders[0]] = candidates[0].id;
      console.log(`  unique: ${folders[0]} → ${candidates[0].id} (only remaining)`);
    } else if (folders.length > 1) {
      // Compute pixel variance for each folder (mean absolute diff between frame 0 and frame 1, south)
      const variances = await Promise.all(
        folders.map(async folder => {
          const files = animFolders[folder];
          const dir = Object.keys(files)[0]; // use first available direction
          const framePaths = files[dir];
          if (framePaths.length < 2) return { folder, variance: 0 };

          const f0 = await sharp(join(tmpDir, framePaths[0])).raw().toBuffer();
          const f1 = await sharp(join(tmpDir, framePaths[1])).raw().toBuffer();
          let diff = 0;
          for (let i = 0; i < f0.length; i++) diff += Math.abs(f0[i] - f1[i]);
          return { folder, variance: diff };
        })
      );

      // Sort by variance descending (most motion first)
      variances.sort((a, b) => b.variance - a.variance);
      console.log('  Variance ranking:', variances.map(v => `${v.folder}=${v.variance}`).join(', '));

      // Sort remaining animations: high-motion first (walk/run before idle/breathing)
      const sortedCandidates = [...candidates].sort((a, b) => {
        const aHigh = HIGH_MOTION_KEYWORDS.some(k => (a.template + a.id).toLowerCase().includes(k));
        const bHigh = HIGH_MOTION_KEYWORDS.some(k => (b.template + b.id).toLowerCase().includes(k));
        if (aHigh && !bHigh) return -1;
        if (!aHigh && bHigh) return  1;
        return 0;
      });

      // Match highest-variance folder to most-active animation, and so on
      for (let i = 0; i < Math.min(variances.length, sortedCandidates.length); i++) {
        folderToAnimId[variances[i].folder] = sortedCandidates[i].id;
        console.log(`  variance: ${variances[i].folder} → ${sortedCandidates[i].id}`);
      }
    }
  }
}

// Check if any spec animations are still unmapped
const finalMappedIds = new Set(Object.values(folderToAnimId));
const stillMissing = charSpec.animations.filter(a => !finalMappedIds.has(a.id));
if (stillMissing.length > 0) {
  console.warn(`\n  ⚠ Could not map: ${stillMissing.map(a => a.id).join(', ')}`);
  console.warn('  Consider adding entries to src/ai/asset-lock.json manually.');
}

console.log('\nFinal folder → animId mapping:');
for (const [folder, animId] of Object.entries(folderToAnimId)) {
  console.log(`  ${folder} → ${animId}`);
}

// ── Copy frames to raw dir ────────────────────────────────────────────────────

const outDir = join(RAW_DIR, id);
await mkdir(outDir, { recursive: true });

let copied = 0;
let skipped = 0;

for (const [folder, animId] of Object.entries(folderToAnimId)) {
  const dirFrames = animFolders[folder];
  for (const [direction, framePaths] of Object.entries(dirFrames)) {
    for (let frameIndex = 0; frameIndex < framePaths.length; frameIndex++) {
      const srcPath = join(tmpDir, framePaths[frameIndex]);
      const outName = `anim_${animId}_${direction}_${frameIndex}.png`;
      const outPath = join(outDir, outName);
      const { copyFile } = await import('fs/promises');
      await copyFile(srcPath, outPath);
      copied++;
    }
  }
}
console.log(`\nCopied ${copied} frames, skipped ${skipped}`);

// Also copy base rotations if present
if (meta.frames?.rotations) {
  for (const [dir, relPath] of Object.entries(meta.frames.rotations)) {
    const srcPath = join(tmpDir, relPath);
    if (existsSync(srcPath)) {
      const outName = `base_${dir}.png`;
      const { copyFile } = await import('fs/promises');
      await copyFile(srcPath, join(outDir, outName));
      console.log(`  ✓ ${outName} (base rotation)`);
    }
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

await import('fs').then(fs => fs.promises.rm(tmpZip, { force: true }));
await import('fs').then(fs => fs.promises.rm(tmpDir, { recursive: true, force: true }));
console.log('Cleaned up temp files.');
console.log(`\nRaw frames ready at: ${outDir}`);
console.log(`Next: npm run sprites:assemble -- --id ${id}`);
