#!/usr/bin/env node
/**
 * merge-items.mjs — One-time script to build the unified item-registry.json.
 *
 * Merges:
 *  1. macro-world/resources.json (130 crafting items)
 *  2. macro-world/item-registry.json (49 NPC tools-of-the-trade)
 *  3. BaseForgeScene TOOLBAR (13 structures, hard-coded below)
 *  4. ShopScene VENDOR_INVENTORIES (3 unique shop consumables)
 *
 * Output: macro-world/item-registry.json (unified, ~200 items)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const ICONS_DIR = join(ROOT, 'public/assets/sprites/icons/items');

// ── Load sources ─────────────────────────────────────────────────────────────

const resources = JSON.parse(
  readFileSync(join(ROOT, 'macro-world/resources.json'), 'utf8'),
).resources;

const npcItems = JSON.parse(
  readFileSync(join(ROOT, 'macro-world/item-registry.json'), 'utf8'),
).items;

// ── BaseForgeScene TOOLBAR (extracted from src/scenes/BaseForgeScene.ts) ─────

const structures = [
  { id: 'campfire',             name: 'Campfire',       color: '0xff6633', spriteKey: 'iki-campfire' },
  { id: 'lean-to',             name: 'Lean-To',        color: '0x8b6914' },
  { id: 'tent',                name: 'Tent',           color: '0xaa8844' },
  { id: 'struct-workbench',    name: 'Workbench',      color: '0xcc8844' },
  { id: 'struct-storage-chest',name: 'Storage Chest',  color: '0x666699' },
  { id: 'struct-drying-rack',  name: 'Drying Rack',    color: '0x996633' },
  { id: 'struct-rain-catcher', name: 'Rain Catcher',   color: '0x4488cc' },
  { id: 'struct-field-forge',  name: 'Field Forge',    color: '0xcc4444' },
  { id: 'struct-palisade',     name: 'Palisade',       color: '0x5a3a1a' },
  { id: 'struct-watchtower',   name: 'Watchtower',     color: '0x888844' },
  { id: 'struct-generator',    name: 'Generator',      color: '0x44aacc' },
  { id: 'struct-mech-dock',    name: 'Mech Dock',      color: '0x4466aa' },
  { id: 'struct-beacon',       name: 'Beacon',         color: '0xffaa33' },
];

// ── ShopScene unique consumables ─────────────────────────────────────────────

const shopItems = [
  { id: 'heal-small',    name: 'Herbal Remedy',  effect: 'heal',        value: 25, cost: 8 },
  { id: 'heal-large',    name: 'Root Tonic',     effect: 'heal',        value: 60, cost: 18 },
  { id: 'cleanse-boost', name: 'Grove Blessing', effect: 'cleanse_pct', value: 5,  cost: 22 },
];

// ── Helper: resolve icon filename ────────────────────────────────────────────

function resolveIcon(id) {
  // Try item-[id].png first (established convention), then bare [id].png
  const prefixed = `item-${id}.png`;
  const bare = `${id}.png`;
  if (existsSync(join(ICONS_DIR, prefixed))) return prefixed;
  if (existsSync(join(ICONS_DIR, bare))) return bare;
  return null;
}

// ── Build unified items ──────────────────────────────────────────────────────

const allItems = [];
const seenIds = new Set();

function addItem(item) {
  if (seenIds.has(item.id)) {
    console.warn(`⚠ Duplicate ID: "${item.id}" — skipping`);
    return;
  }
  seenIds.add(item.id);
  allItems.push(item);
}

// 1. Resources (crafting materials) — playerObtainable: true
for (const r of resources) {
  addItem({
    id: r.id,
    name: r.name,
    category: r.category,
    stackMax: r.stackMax,
    playerObtainable: true,
    icon: resolveIcon(r.id),
    ...(r.slot && { slot: r.slot }),
    ...(r.source && { source: r.source }),
    ...(r.biomes && { biomes: r.biomes }),
  });
}

// 2. NPC tools-of-the-trade — playerObtainable: false (unless it overlaps)
for (const n of npcItems) {
  addItem({
    id: n.id,
    name: n.name,
    category: n.category,
    stackMax: 1,
    playerObtainable: false,
    icon: resolveIcon(n.id),
    description: n.description,
    associatedRole: n.associatedRole,
    building: n.building,
    useInGame: n.useInGame,
    ...(n.iconDescription && { iconDescription: n.iconDescription }),
  });
}

// 3. Structures — playerObtainable: true, placeable: true
for (const s of structures) {
  addItem({
    id: s.id,
    name: s.name,
    category: 'structure',
    stackMax: 1,
    playerObtainable: true,
    icon: resolveIcon(s.id),
    placeable: true,
    placeColor: s.color,
    ...(s.spriteKey && { placeSpriteKey: s.spriteKey }),
  });
}

// 4. Shop consumables — playerObtainable: true
for (const s of shopItems) {
  addItem({
    id: s.id,
    name: s.name,
    category: 'consumable',
    stackMax: 5,
    playerObtainable: true,
    icon: resolveIcon(s.id),
    shopEffect: s.effect,
    shopValue: s.value,
  });
}

// ── Sort: by category, then alphabetically by id ─────────────────────────────

const CATEGORY_ORDER = [
  'raw', 'refined', 'component', 'consumable', 'equipment',
  'structure', 'deployable', 'lore-fragment',
  'tool', 'weapon', 'document', 'sacred', 'authority',
  'instrument', 'container', 'crafted', 'quest',
];

allItems.sort((a, b) => {
  const ca = CATEGORY_ORDER.indexOf(a.category);
  const cb = CATEGORY_ORDER.indexOf(b.category);
  if (ca !== cb) return ca - cb;
  return a.id.localeCompare(b.id);
});

// ── Stats ────────────────────────────────────────────────────────────────────

const categories = {};
let withIcon = 0;
for (const item of allItems) {
  categories[item.category] = (categories[item.category] || 0) + 1;
  if (item.icon) withIcon++;
}

// ── Write output ─────────────────────────────────────────────────────────────

const output = {
  _doc: 'Unified item registry for Core Warden. Every item that exists in the game — craftable, tradeable, NPC prop, structure, quest reward. Other files (recipes.json, shop-inventories.json, loot-tables.json) reference item IDs from this registry.',
  _schema: {
    id: 'Unique kebab-case identifier',
    name: 'Display name',
    category: `One of: ${CATEGORY_ORDER.join(', ')}`,
    stackMax: 'Max quantity per inventory slot (default 1)',
    playerObtainable: 'true = can enter player inventory; false = NPC-only prop',
    icon: 'Filename in public/assets/sprites/icons/items/ (null = pending)',
    slot: '(optional) Equipment slot: weapon | body | offhand | back',
    source: '(optional) How player obtains: mining, gathering, hunting, loot, etc.',
    biomes: '(optional) Where it spawns in the world',
    associatedRole: '(optional) NPC role that uses this item',
    building: '(optional) Building where this is found',
    useInGame: '(optional) Gameplay contexts for this item',
    placeable: '(optional) true for structures/deployables',
    placeColor: '(optional) Hex color for toolbar preview',
    placeSpriteKey: '(optional) Phaser texture key for placed structure',
    shopEffect: '(optional) Consumable effect type (heal, cleanse_pct)',
    shopValue: '(optional) Effect magnitude',
    iconDescription: '(optional) PixelLab prompt for generating missing icons',
    description: '(optional) Flavor/lore text',
  },
  _stats: {
    totalItems: allItems.length,
    categories,
    withIcon,
    pendingIcon: allItems.length - withIcon,
  },
  items: allItems,
};

const outPath = join(ROOT, 'macro-world/item-registry.json');
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

console.log(`✓ Wrote ${allItems.length} items to ${outPath}`);
console.log(`  Categories: ${JSON.stringify(categories)}`);
console.log(`  Icons: ${withIcon} found, ${allItems.length - withIcon} pending`);
