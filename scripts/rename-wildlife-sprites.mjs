#!/usr/bin/env node
/**
 * rename-wildlife-sprites.mjs — Normalize verbose PixelLab animation filenames.
 *
 * v3 custom animations download with the full action description as filename.
 * This script renames them to clean standard names matching the wolf convention.
 *
 * Usage:
 *   node scripts/rename-wildlife-sprites.mjs          # dry run (show what would rename)
 *   node scripts/rename-wildlife-sprites.mjs --apply   # actually rename files
 */

import { readdirSync, renameSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WILDLIFE_DIR = join(ROOT, 'public/assets/sprites/wildlife');
const APPLY = process.argv.includes('--apply');

// Map verbose PixelLab filenames to clean names
// Pattern: if filename starts with (or contains) the key, rename to the value
const RENAME_RULES = [
  // Alert variants (all templates)
  { match: /^alert_ears_up.*/, target: 'alert' },
  { match: /^alert_head_raised.*/, target: 'alert' },
  { match: /^alert_standing_tall.*/, target: 'alert' },
  // Hash-suffixed alert duplicates
  { match: /^alert-[a-f0-9]{6,}/, target: 'alert' },
  { match: /^alert_standing_tall_looking_around_cautiously-[a-f0-9]+/, target: 'alert' },
  { match: /^alert_head_raised_high_ears_forward_body_rigid-[a-f0-9]+/, target: 'alert' },
  { match: /^alert_ears_up_body_tense_looking_around-[a-f0-9]+/, target: 'alert' },
  // Sneak variants
  { match: /^sneaking_stealthily.*/, target: 'sneak' },
  { match: /^sneaking.*/, target: 'sneak' },
  // Attack variants
  { match: /^biting_attacking.*/, target: 'attack' },
  { match: /^attacking_left.*/, target: 'attack' },
  { match: /^attack_left.*/, target: 'attack' },
  // Walk variants
  { match: /^walking_on_the_ground.*/, target: 'walk' },  // bird walk
  { match: /^walking-[a-f0-9]{6,}/, target: 'walk' },     // hash-suffixed walk duplicates
  { match: /^walking_/, target: 'walk' },
  // Sleep variants
  { match: /^sitting_down.*/, target: 'sleep' },
  { match: /^going_to_sleep.*/, target: 'sleep' },
  { match: /^resting_idle-[a-f0-9]{6,}/, target: 'sleep' },  // hash-suffixed bear idle→sleep
  { match: /^resting_idle.*/, target: 'sleep' },
  // Drink variants
  { match: /^drinking_head_lowered.*/, target: 'drink' },
  { match: /^drinking.*/, target: 'drink' },
  // Death variants
  { match: /^dying.*/, target: 'death' },
  // Decompose
  { match: /^decomposing_after_death.*/, target: 'decompose' },
  // Eat variants
  { match: /^pecking_at_the_ground.*/, target: 'eat' },   // bird eat
  { match: /^Eating_/, target: 'eat' },
  { match: /^eating_/, target: 'eat' },
  // Idle variants
  { match: /^Seated_on_Belly_Idle/, target: 'idle' },
  { match: /^idle-[a-f0-9]{6,}/, target: 'idle' },        // hash-suffixed idle duplicates
  { match: /^shaking_head-[a-f0-9]+/, target: 'idle' },   // horse idle renamed
  // Run variants
  { match: /^Slow_Run/, target: 'run' },
  { match: /^Run_/, target: 'run' },
  { match: /^running-[a-f0-9]{6,}/, target: 'run' },      // hash-suffixed run duplicates
  // Licking → eat
  { match: /^Licking/, target: 'eat' },
  // Flight
  { match: /^flying_with_wings_spread.*/, target: 'fly' },
  { match: /^flying_with_wings_flapping.*/, target: 'fly' },
  { match: /^flying.*/, target: 'fly' },
  // Bird ground behaviors
  { match: /^swimming_on_water.*/, target: 'swim' },
  { match: /^landing_wings_spread.*/, target: 'land' },
  { match: /^taking_off_jumping.*/, target: 'takeoff' },
  { match: /^perched_on_a_branch.*/, target: 'perch' },
];

// Direction suffixes to preserve
const DIR_PATTERN = /_(s|se|e|ne|n|nw|w|sw|south|south-east|east|north-east|north|north-west|west|south-west)\.png$/;
const DIR_NORMALIZE = {
  'south': 's', 'south-east': 'se', 'east': 'e', 'north-east': 'ne',
  'north': 'n', 'north-west': 'nw', 'west': 'w', 'south-west': 'sw',
};

let renames = 0;
let skipped = 0;
let already = 0;

const speciesDirs = readdirSync(WILDLIFE_DIR).filter(f => {
  const p = join(WILDLIFE_DIR, f);
  try { return statSync(p).isDirectory() && f !== 'portraits'; } catch { return false; }
});

for (const species of speciesDirs) {
  const dir = join(WILDLIFE_DIR, species);
  const files = readdirSync(dir).filter(f => f.endsWith('.png'));

  for (const file of files) {
    // Extract direction suffix
    const dirMatch = file.match(DIR_PATTERN);
    if (!dirMatch) continue; // skip files without direction suffix (like idle.png base)

    let rawDir = dirMatch[1];
    const cleanDir = DIR_NORMALIZE[rawDir] || rawDir;

    // Get the prefix (everything before the direction suffix)
    const prefix = file.replace(DIR_PATTERN, '');

    // Check if it matches any rename rule
    let newPrefix = null;
    for (const rule of RENAME_RULES) {
      if (rule.match.test(prefix)) {
        newPrefix = rule.target;
        break;
      }
    }

    if (!newPrefix) continue; // no rename needed

    const newFile = `${newPrefix}_${cleanDir}.png`;
    if (newFile === file) { already++; continue; }

    const oldPath = join(dir, file);
    const newPath = join(dir, newFile);

    if (existsSync(newPath)) {
      // Target already exists — skip to avoid overwriting
      skipped++;
      continue;
    }

    if (APPLY) {
      renameSync(oldPath, newPath);
      console.log(`  ${species}/${file} → ${newFile}`);
    } else {
      console.log(`  [DRY] ${species}/${file} → ${newFile}`);
    }
    renames++;
  }
}

console.log(`\n${APPLY ? 'Renamed' : 'Would rename'}: ${renames} files`);
console.log(`Skipped (target exists): ${skipped}`);
console.log(`Already correct: ${already}`);
if (!APPLY && renames > 0) {
  console.log('\nRun with --apply to execute renames');
}
