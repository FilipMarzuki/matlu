#!/usr/bin/env node
/**
 * Seed macro-world tables in Supabase from local JSON files.
 * Uses service_role key (bypasses RLS).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-macro-world.mjs
 *
 * Or with .env:
 *   node --env-file=.env scripts/seed-macro-world.mjs
 *
 * Issue: #793
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Supabase client (service_role)
// ---------------------------------------------------------------------------

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key);

// ---------------------------------------------------------------------------
// Load JSON
// ---------------------------------------------------------------------------

const load = (rel) => JSON.parse(readFileSync(resolve(root, rel), 'utf-8'));
const raceData     = load('macro-world/race-affinities.json');
const cultureData  = load('macro-world/cultures.json');
const traitData    = load('macro-world/culture-traits.json');
const archData     = load('macro-world/architecture.json');
const fashionData  = load('macro-world/fashion.json');

// ---------------------------------------------------------------------------
// People name → ancestry slug mapping
// cultures.json uses TitleCase "People" names; ancestries use lowercase slugs.
// Adjust this mapping if entries don't match your intent.
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
};

// ---------------------------------------------------------------------------
// Architecture style → culture slug mapping (many-to-many)
// ---------------------------------------------------------------------------

const ARCH_TO_CULTURES = {
  'ARCH-1':  ['mountainhold'],
  'ARCH-2':  ['mountainhold'],
  'ARCH-3':  ['sylvan-enclave'],
  'ARCH-4':  ['sylvan-enclave', 'grovekin', 'thicket-dwellers'],
  'ARCH-5':  ['coastborn', 'ridgefolk', 'fieldborn'],
  'ARCH-6':  ['coastborn', 'ridgefolk', 'fieldborn', 'harborfolk'],
  'ARCH-7':  ['steppe-camp', 'caravan-folk'],
  'ARCH-8':  ['windfarer-eyrie'],
  'ARCH-9':  ['ironborne-encampment', 'workshop-collective'],
  'ARCH-10': ['waterstead'],
  'ARCH-11': ['harborfolk'],
  'ARCH-12': ['reefborn'],
  'ARCH-13': ['bazaar-folk'],
  'ARCH-14': ['crystal-resonance'],
  'ARCH-15': ['steading'],
  'ARCH-16': ['dragonkin-remnant'],
  'ARCH-17': ['refuge-keepers'],
  'ARCH-18': ['workshop-collective'],
  'ARCH-19': ['refuge-keepers'],
  'ARCH-20': ['wallborn'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert rows and return them (with generated UUIDs). Throws on error. */
async function insert(table, rows) {
  if (!rows.length) return [];
  const { data, error } = await sb.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

/** Build slug→uuid lookup from inserted rows. */
function slugMap(rows) {
  const m = {};
  for (const r of rows) m[r.slug] = r.id;
  return m;
}

function titleToSlug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding macro-world tables...\n');

  // 1. Biomes
  const biomeRows = raceData._biomes.map(b => ({
    slug: b,
    name: b.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }));
  const biomes = await insert('biomes', biomeRows);
  const biomeMap = slugMap(biomes);
  console.log(`  biomes: ${biomes.length}`);

  // 2. Geographic features (collect all unique feature keys from race data)
  const featureSet = new Set();
  for (const r of raceData.races) {
    if (r.featureBonus) Object.keys(r.featureBonus).forEach(k => featureSet.add(k));
  }
  const featureRows = [...featureSet].map(f => ({
    slug: f,
    name: f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }));
  const features = await insert('geographic_features', featureRows);
  const featureMap = slugMap(features);
  console.log(`  geographic_features: ${features.length}`);

  // 3. Ancestries
  const ancestryRows = raceData.races.map(r => ({
    slug:                r.id,
    name:                r.name,
    description:         r.description,
    elevation_ideal_min: r.elevationAffinity?.ideal?.[0] ?? null,
    elevation_ideal_max: r.elevationAffinity?.ideal?.[1] ?? null,
    elevation_tol_min:   r.elevationAffinity?.tolerance?.[0] ?? null,
    elevation_tol_max:   r.elevationAffinity?.tolerance?.[1] ?? null,
    moisture_ideal_min:  r.moistureAffinity?.ideal?.[0] ?? null,
    moisture_ideal_max:  r.moistureAffinity?.ideal?.[1] ?? null,
    moisture_tol_min:    r.moistureAffinity?.tolerance?.[0] ?? null,
    moisture_tol_max:    r.moistureAffinity?.tolerance?.[1] ?? null,
    clustering:          r.clustering,
    population_weight:   r.populationWeight,
    mixing_behavior:     r.mixingBehavior,
    naming_base:         r.namingBase,
  }));
  const ancestries = await insert('ancestries', ancestryRows);
  const ancestryMap = slugMap(ancestries);
  console.log(`  ancestries: ${ancestries.length}`);

  // 4. Ancestry biome affinities
  const biomeAffRows = [];
  for (const r of raceData.races) {
    for (const [biome, score] of Object.entries(r.biomeAffinity || {})) {
      biomeAffRows.push({
        ancestry_id: ancestryMap[r.id],
        biome_id:    biomeMap[biome],
        score,
      });
    }
  }
  await insert('ancestry_biome_affinities', biomeAffRows);
  console.log(`  ancestry_biome_affinities: ${biomeAffRows.length}`);

  // 5. Ancestry feature bonuses
  const featureBonRows = [];
  for (const r of raceData.races) {
    for (const [feat, bonus] of Object.entries(r.featureBonus || {})) {
      featureBonRows.push({
        ancestry_id: ancestryMap[r.id],
        feature_id:  featureMap[feat],
        bonus,
      });
    }
  }
  await insert('ancestry_feature_bonuses', featureBonRows);
  console.log(`  ancestry_feature_bonuses: ${featureBonRows.length}`);

  // 6. Culture traits
  const traitEntries = Object.entries(traitData).filter(([k]) => !k.startsWith('_'));
  const traitRows = traitEntries.map(([slug, desc]) => ({ slug, description: desc }));
  const traits = await insert('culture_traits', traitRows);
  const traitMap = slugMap(traits);
  console.log(`  culture_traits: ${traits.length}`);

  // 7. Cultures
  const cultureRows = cultureData.cultures.map(c => ({
    slug:                c.id,
    name:                c.name,
    spacing:             c.spacing,
    organicness:         c.organicness,
    hierarchy_scale:     c.hierarchyScale,
    perimeter_awareness: c.perimeterAwareness,
    facing_bias:         c.facingBias,
    verticality:         c.verticality,
    preferred_shapes:    c.preferredShapes,
    roof_style:          c.roofStyle,
    street_pattern:      c.streetPattern,
  }));
  const cultures = await insert('cultures', cultureRows);
  const cultureMap = slugMap(cultures);
  console.log(`  cultures: ${cultures.length}`);

  // 8. Culture → ancestry preferences
  const prefRows = [];
  for (const c of cultureData.cultures) {
    for (const [peopleName, weight] of Object.entries(c.racePreferences || {})) {
      const ancestrySlug = PEOPLE_TO_ANCESTRY[peopleName];
      if (!ancestrySlug) {
        console.warn(`    WARN: no ancestry mapping for People "${peopleName}" (culture: ${c.id})`);
        continue;
      }
      if (!ancestryMap[ancestrySlug]) {
        console.warn(`    WARN: ancestry slug "${ancestrySlug}" not found (people: ${peopleName})`);
        continue;
      }
      prefRows.push({
        culture_id:  cultureMap[c.id],
        ancestry_id: ancestryMap[ancestrySlug],
        weight,
      });
    }
  }
  await insert('culture_ancestry_preferences', prefRows);
  console.log(`  culture_ancestry_preferences: ${prefRows.length}`);

  // 9. Culture → trait assignments
  const traitAssignRows = [];
  for (const c of cultureData.cultures) {
    for (const t of c.traits || []) {
      if (!traitMap[t]) {
        console.warn(`    WARN: trait slug "${t}" not found (culture: ${c.id})`);
        continue;
      }
      traitAssignRows.push({
        culture_id: cultureMap[c.id],
        trait_id:   traitMap[t],
      });
    }
  }
  await insert('culture_trait_assignments', traitAssignRows);
  console.log(`  culture_trait_assignments: ${traitAssignRows.length}`);

  // 10. Architecture styles
  const archRows = archData.styles.map(s => ({
    slug:                    s.id.toLowerCase(),
    name:                    s.name,
    primary_material:        s.primaryMaterial,
    construction_method:     s.constructionMethod,
    form_language:           s.formLanguage,
    ground_relation:         s.groundRelation,
    window_style:            s.windowStyle,
    ornament_level:          s.ornamentLevel,
    structural_principle:    s.structuralPrinciple,
    climate_response:        s.climateResponse,
    description:             s.description,
    prompt_keywords:         s.promptKeywords,
    real_world_inspiration:  s.realWorldInspiration,
  }));
  const archStyles = await insert('architecture_styles', archRows);
  const archMap = slugMap(archStyles);
  console.log(`  architecture_styles: ${archStyles.length}`);

  // 11. Architecture blocks
  const blockRows = [];
  for (const s of archData.styles) {
    (s.blocks || []).forEach((b, i) => {
      blockRows.push({
        style_id:   archMap[s.id.toLowerCase()],
        block_type: b.type,
        name:       b.name,
        sprite_key: b.sprite || null,
        sort_order: i,
      });
    });
  }
  // Insert in batches (Supabase has row limits per request)
  for (let i = 0; i < blockRows.length; i += 100) {
    await insert('architecture_blocks', blockRows.slice(i, i + 100));
  }
  console.log(`  architecture_blocks: ${blockRows.length}`);

  // 12. Culture → architecture assignments
  const archAssignRows = [];
  for (const [archId, cultureSlugs] of Object.entries(ARCH_TO_CULTURES)) {
    const archUuid = archMap[archId.toLowerCase()];
    if (!archUuid) continue;
    for (const cs of cultureSlugs) {
      const cultureUuid = cultureMap[cs];
      if (!cultureUuid) {
        console.warn(`    WARN: culture slug "${cs}" not found (arch: ${archId})`);
        continue;
      }
      archAssignRows.push({
        culture_id:            cultureUuid,
        architecture_style_id: archUuid,
      });
    }
  }
  await insert('culture_architecture_assignments', archAssignRows);
  console.log(`  culture_architecture_assignments: ${archAssignRows.length}`);

  // 13. Fashion styles
  const fashionRows = [];
  for (const f of fashionData.fashions) {
    const cultureUuid = cultureMap[f.cultureId];
    if (!cultureUuid) {
      console.warn(`    WARN: culture slug "${f.cultureId}" not found for fashion`);
      continue;
    }
    fashionRows.push({
      culture_id:             cultureUuid,
      real_world_inspiration: f.realWorldFashionInspiration,
      base_materials:         f.base.materials,
      base_palette:           f.base.palette,
      base_motifs:            f.base.motifs,
    });
  }
  const fashionStyles = await insert('fashion_styles', fashionRows);
  // Build culture_id → fashion_style.id map
  const fashionByCulture = {};
  for (const fs of fashionStyles) fashionByCulture[fs.culture_id] = fs.id;
  console.log(`  fashion_styles: ${fashionStyles.length}`);

  // 14. Fashion variants
  const variantRows = [];
  for (const f of fashionData.fashions) {
    const cultureUuid = cultureMap[f.cultureId];
    const fashionId = cultureUuid ? fashionByCulture[cultureUuid] : null;
    if (!fashionId) continue;
    for (const v of f.variants || []) {
      variantRows.push({
        fashion_style_id: fashionId,
        role:             v.role,
        silhouette:       v.silhouette || null,
        headwear:         v.headwear || null,
        footwear:         v.footwear || null,
        accessories:      v.accessories || [],
        notes:            v.notes || null,
      });
    }
  }
  await insert('fashion_variants', variantRows);
  console.log(`  fashion_variants: ${variantRows.length}`);

  console.log('\nDone!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
