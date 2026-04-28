#!/usr/bin/env node
/**
 * Seed phase 2: buildings, population_archetypes, and ancestry body columns.
 * Run AFTER seed-macro-world.mjs (phase 1) which creates ancestries/cultures/etc.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-macro-world-phase2.mjs
 *
 * Issue: #793
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(url, key);

const load = (rel) => JSON.parse(readFileSync(resolve(root, rel), 'utf-8'));

async function insert(table, rows) {
  if (!rows.length) return [];
  const { data, error } = await sb.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Notion People name → ancestry slug (same mapping as phase 1)
// ---------------------------------------------------------------------------

const PEOPLE_TO_ANCESTRY = {
  'Markfolk':    'human',
  'Bergfolk':    'dvergr',
  'Lövfolk':     'sylphari',
  'Deepwalkers': 'deepwalkers',
  'Goblins':     'goblin',
  'Pandor':      'pandor',
  'Giants':      'half-giants',
  'Dragons':     'draak',
  'Viddfolk':    'steppevarg',
  'Merfolk':     'merfolk',
  'Fae':         'fae',
  'Steinfolk':   'grynfolk',
  'Constructs':  'constructs',
  'Remnants':    'remnants',
  // Direct matches for ancestries not in the People mapping
  'Everstill':   'everstill',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding phase 2: buildings, archetypes, ancestry body...\n');

  // ── 1. Buildings ──────────────────────────────────────────────────────
  const buildingData = load('macro-world/building-registry.json');
  const buildingRows = buildingData.buildings
    .filter(b => b.id) // skip _section markers
    .map(b => ({
      slug:              b.id,
      name:              b.name,
      role:              b.role ?? null,
      category:          b.category ?? null,
      min_tier:          b.minTier ?? null,
      zone:              b.zone ?? null,
      base_size_min:     b.baseSizeRange?.[0] ?? null,
      base_size_max:     b.baseSizeRange?.[1] ?? null,
      base_depth_min:    b.baseDepthRange?.[0] ?? null,
      base_depth_max:    b.baseDepthRange?.[1] ?? null,
      height_hint:       b.heightHint ?? null,
      unlock_conditions: b.unlockConditions ?? null,
      count:             b.count ?? null,
      placement_hints:   b.placementHints ?? [],
      lore_hook:         b.loreHook ?? null,
    }));

  const buildings = await insert('buildings', buildingRows);
  const buildingMap = {};
  for (const b of buildings) buildingMap[b.slug] = b.id;
  console.log(`  buildings: ${buildings.length}`);

  // ── 2. Population archetypes ──────────────────────────────────────────
  const archData = load('macro-world/population-archetypes.json');
  const archetypeRows = [];

  // Building-attached archetypes
  for (const ba of archData.buildingArchetypes) {
    const buildingId = buildingMap[ba.buildingId];
    if (!buildingId) {
      console.warn(`    WARN: building "${ba.buildingId}" not found`);
      continue;
    }
    for (const a of ba.archetypes) {
      const countMin = Array.isArray(a.count) ? a.count[0] : (a.count ?? 1);
      const countMax = Array.isArray(a.count) ? a.count[1] : (a.count ?? 1);
      archetypeRows.push({
        building_id:     buildingId,
        role:            a.role,
        name:            a.name,
        fashion_variant: a.fashionVariant ?? null,
        count_min:       countMin,
        count_max:       countMax,
        count_per_tier:  null,
        sprite_notes:    a.spriteNotes ?? null,
        animations:      a.animations ?? [],
        is_ambient:      false,
      });
    }
  }

  // Ambient archetypes (no building)
  for (const a of archData.ambientArchetypes ?? []) {
    archetypeRows.push({
      building_id:     null,
      role:            a.role,
      name:            a.name,
      fashion_variant: a.fashionVariant ?? null,
      count_min:       1,
      count_max:       1,
      count_per_tier:  a.countPerTier ?? null,
      sprite_notes:    a.spriteNotes ?? null,
      animations:      a.animations ?? [],
      is_ambient:      true,
    });
  }

  // Insert in batches
  for (let i = 0; i < archetypeRows.length; i += 50) {
    await insert('population_archetypes', archetypeRows.slice(i, i + 50));
  }
  console.log(`  population_archetypes: ${archetypeRows.length} (${archData.ambientArchetypes?.length ?? 0} ambient)`);

  // ── 3. Ancestry body columns ──────────────────────────────────────────
  const raceCache = load('data/notion-races-cache.json');
  const draftEntries = raceCache.entries.filter(e => e['Lore Status'] === 'draft');

  // First, check for 'everstill' ancestry — it may not exist yet
  const { data: existingAncestries } = await sb.from('ancestries').select('slug');
  const existingSlugs = new Set(existingAncestries?.map(a => a.slug) ?? []);

  // Add any missing ancestries from Notion draft entries
  const newAncestries = [];
  for (const entry of draftEntries) {
    const slug = PEOPLE_TO_ANCESTRY[entry.Name];
    if (!slug) {
      console.warn(`    WARN: no ancestry mapping for Notion entry "${entry.Name}"`);
      continue;
    }
    if (!existingSlugs.has(slug)) {
      newAncestries.push({
        slug,
        name: entry.Name,
        description: `${entry.Name}. Details pending.`,
      });
    }
  }
  if (newAncestries.length > 0) {
    await insert('ancestries', newAncestries);
    console.log(`  new ancestries added: ${newAncestries.length} (${newAncestries.map(a => a.slug).join(', ')})`);
  }

  // Update body columns for each draft entry
  let updated = 0;
  for (const entry of draftEntries) {
    const slug = PEOPLE_TO_ANCESTRY[entry.Name];
    if (!slug) continue;

    const { error } = await sb.from('ancestries')
      .update({
        body_plan:         entry.bodyPlan ?? null,
        build:             entry.build ?? null,
        surface:           entry.surface ?? null,
        silhouette:        entry.silhouette ?? null,
        head:              entry.head ?? null,
        senses:            entry.senses ?? null,
        anatomy:           entry.anatomy ?? null,
        variation:         entry.variation ?? null,
        sprite_note:       entry.spriteNote ?? null,
        sprite_resolution: entry.spriteResolution ?? null,
        lifespan:          entry.lifespan ?? null,
      })
      .eq('slug', slug);

    if (error) {
      console.warn(`    WARN: failed to update ancestry "${slug}": ${error.message}`);
    } else {
      updated++;
    }
  }
  console.log(`  ancestry body columns updated: ${updated}/${draftEntries.length}`);

  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });
