#!/usr/bin/env node
/**
 * validate-items.mjs — CI validation for the unified item registry.
 *
 * Checks:
 *  1. No duplicate IDs
 *  2. All recipe input/output IDs resolve to registry entries
 *  3. All playerObtainable items have a valid stackMax
 *  4. All icon fields point to existing files
 *  5. Category values from the allowed set
 *
 * Exit 0 on success, 1 on failure.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const ICONS_DIR = join(ROOT, 'public/assets/sprites/icons/items');

const ALLOWED_CATEGORIES = new Set([
  'raw', 'refined', 'component', 'consumable', 'equipment',
  'structure', 'deployable', 'lore-fragment',
  'tool', 'weapon', 'document', 'sacred', 'authority',
  'instrument', 'container', 'crafted', 'quest',
]);

let errors = 0;

function err(msg) {
  console.error(`  ✗ ${msg}`);
  errors++;
}

// ── Load registry ────────────────────────────────────────────────────────────

const registry = JSON.parse(
  readFileSync(join(ROOT, 'macro-world/item-registry.json'), 'utf8'),
);
const items = registry.items;
const idSet = new Set();
const idMap = new Map();

console.log(`Validating ${items.length} items...`);

// ── 1. Duplicate IDs ─────────────────────────────────────────────────────────

for (const item of items) {
  if (idSet.has(item.id)) {
    err(`Duplicate ID: "${item.id}"`);
  }
  idSet.add(item.id);
  idMap.set(item.id, item);
}

// ── 2. Recipe ID resolution ──────────────────────────────────────────────────

const recipesPath = join(ROOT, 'public/macro-world/recipes.json');
if (existsSync(recipesPath)) {
  // Skip the file's `{ "_tier": "=== … ===" }` section headers.
  const recipes = JSON.parse(readFileSync(recipesPath, 'utf8')).recipes.filter((r) => r.id);
  for (const r of recipes) {
    if (r.output?.item && !idSet.has(r.output.item)) {
      err(`Recipe "${r.id}" output "${r.output.item}" not in registry`);
    }
    for (const input of r.inputs || []) {
      if (input.item && !idSet.has(input.item)) {
        err(`Recipe "${r.id}" input "${input.item}" not in registry`);
      }
    }
  }
  console.log(`  Checked ${recipes.length} recipes`);
}

// ── 3. playerObtainable items need stackMax ──────────────────────────────────

for (const item of items) {
  if (item.playerObtainable && (!item.stackMax || item.stackMax < 1)) {
    err(`"${item.id}" is playerObtainable but has invalid stackMax: ${item.stackMax}`);
  }
}

// ── 4. Icon file existence ───────────────────────────────────────────────────

let iconsMissing = 0;
let iconsFound = 0;
for (const item of items) {
  if (item.icon) {
    const iconPath = join(ICONS_DIR, item.icon);
    if (!existsSync(iconPath)) {
      err(`"${item.id}" icon "${item.icon}" not found at ${iconPath}`);
    } else {
      iconsFound++;
    }
  } else {
    iconsMissing++;
  }
}
console.log(`  Icons: ${iconsFound} found, ${iconsMissing} pending (null)`);

// ── 5. Category validation ───────────────────────────────────────────────────

for (const item of items) {
  if (!ALLOWED_CATEGORIES.has(item.category)) {
    err(`"${item.id}" has unknown category: "${item.category}"`);
  }
}

// ── 6. Required fields ───────────────────────────────────────────────────────

for (const item of items) {
  if (!item.id) err('Item missing id');
  if (!item.name) err(`"${item.id}" missing name`);
  if (!item.category) err(`"${item.id}" missing category`);
  if (item.playerObtainable === undefined) err(`"${item.id}" missing playerObtainable`);
}

// ── Result ───────────────────────────────────────────────────────────────────

if (errors > 0) {
  console.error(`\n✗ ${errors} error(s) found`);
  process.exit(1);
} else {
  console.log(`\n✓ All ${items.length} items valid`);
  process.exit(0);
}
