#!/usr/bin/env node
/**
 * Audit wildlife sprite completeness per species.
 *
 * Reads fauna-registry.json, checks which sprite files exist on disk,
 * and reports completeness percentage per species + per animation.
 *
 * Usage: node scripts/audit-wildlife-sprites.js
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', 'public', 'macro-world', 'fauna-registry.json');
const SPRITES_DIR = path.join(__dirname, '..', 'public', 'assets', 'sprites', 'wildlife');

const STANDARD_ANIMS = ['idle', 'walk', 'run', 'eat', 'sleep', 'sneak', 'alert', 'death', 'drink'];
const DIRS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

let totalSpecies = 0;
let totalComplete = 0;

console.log('Wildlife Sprite Audit');
console.log('='.repeat(70));

for (const species of registry.fauna) {
  if (species.class !== 'ground') continue;
  totalSpecies++;

  const speciesDir = path.join(SPRITES_DIR, species.id);
  const hasDir = fs.existsSync(speciesDir);

  if (!hasDir) {
    console.log(`\n${species.name} (${species.id}): NO SPRITES`);
    continue;
  }

  const files = fs.readdirSync(speciesDir).filter(f => f.endsWith('.png'));

  let animCount = 0;
  let animTotal = 0;
  let dirCount = 0;
  let dirTotal = 0;
  const details = [];

  for (const anim of STANDARD_ANIMS) {
    animTotal++;
    // Check base (SE-only) strip
    const baseName = `${anim}_se.png`;
    const baseExists = files.includes(baseName) || files.includes(`${anim}.png`);

    // Check all 8 directions
    let dirsFound = 0;
    for (const d of DIRS) {
      dirTotal++;
      if (files.includes(`${anim}_${d}.png`)) {
        dirsFound++;
        dirCount++;
      }
    }

    if (baseExists || dirsFound > 0) {
      animCount++;
      const dirLabel = dirsFound === 8 ? '8/8 dirs' : dirsFound === 1 ? 'SE only' : `${dirsFound}/8 dirs`;
      details.push(`  ${anim.padEnd(8)} ✅ ${dirLabel}`);
    } else {
      details.push(`  ${anim.padEnd(8)} ❌ missing`);
    }
  }

  // Check for registry sprite entries
  const registryAnims = Object.keys(species.sprites || {});

  const animPct = Math.round((animCount / animTotal) * 100);
  const dirPct = Math.round((dirCount / dirTotal) * 100);
  const isComplete = animCount === animTotal;
  if (isComplete) totalComplete++;

  console.log(`\n${species.name} (${species.id}): ${animCount}/${animTotal} anims (${animPct}%), ${dirCount}/${dirTotal} dirs (${dirPct}%)`);
  console.log(`  Registry sprites: [${registryAnims.join(', ')}]`);
  for (const d of details) console.log(d);
}

console.log('\n' + '='.repeat(70));
console.log(`Species: ${totalComplete}/${totalSpecies} fully animated`);
console.log(`\nRun: node scripts/audit-wildlife-sprites.js`);
