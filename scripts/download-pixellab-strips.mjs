#!/usr/bin/env node
/**
 * Download PixelLab character ZIPs and assemble animation frames into
 * horizontal strip PNGs matching the wolf sprite convention.
 *
 * Output: public/assets/sprites/wildlife/{species}/{anim}_{dir}.png
 *   e.g.  public/assets/sprites/wildlife/lynx/idle_s.png   (8 frames × 48px = 384×48)
 *         public/assets/sprites/wildlife/lynx/run_se.png   (6 frames × 48px = 288×48)
 *
 * Usage:
 *   node scripts/download-pixellab-strips.mjs --species=lynx
 *   node scripts/download-pixellab-strips.mjs --all
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WILDLIFE_DIR = path.join(ROOT, 'public/assets/sprites/wildlife');
const IDS_FILE = path.join(WILDLIFE_DIR, 'pixellab-ids.json');
const TMP_DIR = path.join(ROOT, '.tmp-pixellab');

const DIR_ABBREV = {
  'south': 's', 'south-east': 'se', 'east': 'e', 'north-east': 'ne',
  'north': 'n', 'north-west': 'nw', 'west': 'w', 'south-west': 'sw'
};

// PixelLab ZIP animation folder names → our strip prefix
const ANIM_REMAP = {
  // Idle variants
  'idle': 'idle',
  'idle-shaking-head': 'idle',           // horse template
  'shaking_head': 'idle',               // horse ZIP folder
  'idle-resting': 'idle',               // bear template
  'resting': 'idle',                    // bear ZIP folder
  'resting_idle': 'idle',               // bear ZIP variant
  'Seated_on_Belly_Idle': 'idle',       // cat variant
  // Run variants
  'running': 'run',
  'running-6-frames': 'run',            // horse/cat template
  'running-4-frames': 'run',            // bear template
  'Run': 'run',
  'Slow_Run': 'run',
  // Walk variants
  'walk-cycle': 'walk',                 // horse template
  'walking': 'walk',                    // v3 custom
  // Eat variants
  'eating': 'eat',
  'Eating': 'eat',
  'Licking': 'eat',
  // Drink variants
  'drinking': 'drink',
  'drinking_head_lowered_to_water': 'drink',  // v3 custom
  // Sleep variants
  'sleeping': 'sleep',
  'going-to-sleep': 'sleep',            // bear template
  'going_to_sleep': 'sleep',            // ZIP folder
  'sitting': 'sleep',                   // cat template
  'sitting_down': 'sleep',              // v3 custom
  'rest-idle': 'sleep',                 // horse template
  // Death variants
  'dying': 'death',
  // Alert variants (v3 custom — match prefix)
  'alert_ears_up_body_tense_looking_around': 'alert',
  'alert_head_raised_high_ears_forward_body_rigid': 'alert',
  'alert_standing_tall_looking_around_cautiously': 'alert',
  // Sneak variants (v3 custom — match prefix)
  'sneaking_stealthily_low_crouch_slow_careful_movement': 'sneak',
  // Attack variants
  'biting_attacking_lunging_forward': 'attack',
  'attacking_left': 'attack',
  'attack-left': 'attack',
  // Flight (birds)
  'flying_with_wings_spread_soaring_through_the_air': 'fly',
  'flying_with_wings_flapping': 'fly',
  'flying': 'fly',
};

// For v3 custom animations, the ZIP folder name is the full action description
// truncated. Try prefix matching if exact match fails.
function remapAnimName(folderName) {
  if (ANIM_REMAP[folderName]) return ANIM_REMAP[folderName];
  // Try prefix match (v3 names get truncated in ZIP folders)
  for (const [key, val] of Object.entries(ANIM_REMAP)) {
    if (folderName.startsWith(key)) return val;
  }
  return null; // unknown — skip or keep raw
}

async function processSpecies(name, charId, size, customOutDir) {
  console.log(`\n── ${name} (${charId}) ──`);
  const zipUrl = `https://api.pixellab.ai/mcp/characters/${charId}/download`;
  const zipPath = path.join(TMP_DIR, `${name}.zip`);
  const extractDir = path.join(TMP_DIR, name);
  const outDir = customOutDir || path.join(WILDLIFE_DIR, name);

  // Download ZIP
  console.log(`  Downloading...`);
  try {
    execSync(`curl -sL "${zipUrl}" -o "${zipPath}"`, { stdio: 'pipe' });
  } catch (e) {
    console.log(`  ✗ Download failed (character may have pending jobs)`);
    return { name, status: 'download-failed' };
  }

  // Check it's actually a ZIP
  const header = fs.readFileSync(zipPath).slice(0, 4).toString('hex');
  if (header !== '504b0304') {
    console.log(`  ✗ Not a valid ZIP (HTTP error or pending jobs)`);
    fs.unlinkSync(zipPath);
    return { name, status: 'not-zip' };
  }

  // Extract — use PowerShell on Windows, unzip on Unix
  fs.mkdirSync(extractDir, { recursive: true });
  if (process.platform === 'win32') {
    execSync(`powershell -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${extractDir}'"`, { stdio: 'pipe' });
  } else {
    execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });
  }

  // Find the character folder (PixelLab uses display name like "Eurasian_Lynx")
  const charFolders = fs.readdirSync(extractDir).filter(f =>
    fs.statSync(path.join(extractDir, f)).isDirectory()
  );
  if (charFolders.length === 0) {
    console.log(`  ✗ No character folder in ZIP`);
    return { name, status: 'empty-zip' };
  }
  const charFolder = path.join(extractDir, charFolders[0]);
  const animsFolder = path.join(charFolder, 'animations');

  if (!fs.existsSync(animsFolder)) {
    console.log(`  ⚠ No animations folder — character has no animations yet`);
    return { name, status: 'no-anims' };
  }

  fs.mkdirSync(outDir, { recursive: true });
  let assembled = 0;
  let skipped = 0;

  // Each subfolder in animations/ is an animation type
  for (const animFolder of fs.readdirSync(animsFolder)) {
    const animPath = path.join(animsFolder, animFolder);
    if (!fs.statSync(animPath).isDirectory()) continue;

    const stripName = ANIM_REMAP[animFolder] || animFolder;

    // Each subfolder is a direction
    for (const dirFolder of fs.readdirSync(animPath)) {
      const dirPath = path.join(animPath, dirFolder);
      if (!fs.statSync(dirPath).isDirectory()) continue;

      const dirAbbrev = DIR_ABBREV[dirFolder];
      if (!dirAbbrev) { console.log(`  ⚠ Unknown dir: ${dirFolder}`); continue; }

      const outFile = path.join(outDir, `${stripName}_${dirAbbrev}.png`);

      // Skip if exists
      if (fs.existsSync(outFile)) {
        skipped++;
        continue;
      }

      // Get sorted frames
      const frames = fs.readdirSync(dirPath)
        .filter(f => f.endsWith('.png'))
        .sort()
        .map(f => path.join(dirPath, f));

      if (frames.length === 0) continue;

      // Read first frame to get actual pixel size
      const meta = await sharp(frames[0]).metadata();
      const frameW = meta.width;
      const frameH = meta.height;

      // Assemble horizontal strip
      const composites = [];
      for (let i = 0; i < frames.length; i++) {
        composites.push({
          input: frames[i],
          left: i * frameW,
          top: 0,
        });
      }

      await sharp({
        create: {
          width: frameW * frames.length,
          height: frameH,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      }).composite(composites).png().toFile(outFile);

      console.log(`  ✓ ${stripName}_${dirAbbrev}.png (${frames.length}f × ${frameW}px)`);
      assembled++;
    }
  }

  if (skipped > 0) console.log(`  · ${skipped} strips already existed`);
  return { name, status: 'done', assembled, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const speciesArg = args.find(a => a.startsWith('--species='))?.split('=')[1];
  const directId = args.find(a => a.startsWith('--id='))?.split('=')[1];
  const outDirArg = args.find(a => a.startsWith('--outdir='))?.split('=')[1];
  const doAll = args.includes('--all');

  if (!speciesArg && !doAll && !directId) {
    console.log('Usage:');
    console.log('  --species=lynx                    # download by species name (from pixellab-ids.json)');
    console.log('  --all                             # download all wildlife');
    console.log('  --id=UUID --outdir=path --name=X  # direct download by character ID');
    process.exit(1);
  }

  let targets = [];

  if (directId) {
    // Direct mode: download a specific character by ID to a custom output dir
    const name = args.find(a => a.startsWith('--name='))?.split('=')[1] || 'character';
    const size = parseInt(args.find(a => a.startsWith('--size='))?.split('=')[1] || '32', 10);
    targets.push({ name, id: directId, size, outDir: outDirArg });
  } else {
    const ids = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));

    if (speciesArg) {
      const entry = ids.quadrupeds[speciesArg] || ids.birds[speciesArg];
      if (!entry) { console.error(`Unknown species: ${speciesArg}`); process.exit(1); }
      targets.push({ name: speciesArg, id: entry.id, size: entry.size });
    } else {
      for (const [name, entry] of Object.entries(ids.quadrupeds)) {
        targets.push({ name, id: entry.id, size: entry.size });
      }
      for (const [name, entry] of Object.entries(ids.birds)) {
        targets.push({ name, id: entry.id, size: entry.size });
      }
    }
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  console.log(`Processing ${targets.length} species...\n`);

  const results = [];
  for (const t of targets) {
    results.push(await processSpecies(t.name, t.id, t.size, t.outDir));
  }

  // Cleanup
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  console.log('\n══ Summary ══');
  let totalNew = 0;
  for (const r of results) {
    const detail = r.assembled ? `${r.assembled} new` : r.status;
    console.log(`  ${r.name}: ${detail}`);
    totalNew += r.assembled || 0;
  }
  console.log(`\n  Total new strips: ${totalNew}`);
}

main().catch(e => { console.error(e); process.exit(1); });
