#!/usr/bin/env node
/**
 * Export macro-world tables from Supabase → JSON snapshot files.
 * These JSON files serve as offline/CI fallback for the game client.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export-macro-world.mjs
 *
 * Or with .env:
 *   node --env-file=.env scripts/export-macro-world.mjs
 *
 * Issue: #793
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const mw = (...p) => resolve(root, 'macro-world', ...p);

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key);

/** Fetch all rows from a table. */
async function fetchAll(table) {
  const { data, error } = await sb.from(table).select('*');
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function main() {
  console.log('Exporting macro-world from Supabase...\n');

  // Fetch everything in parallel
  const [
    ancestries, biomes, features, traits, cultures,
    archStyles, archBlocks, fashionStyles, fashionVariants,
    buildings, popArchetypes,
    biomeAffs, featureBons, culturePref, traitAssign, archAssign,
  ] = await Promise.all([
    fetchAll('ancestries'),
    fetchAll('biomes'),
    fetchAll('geographic_features'),
    fetchAll('culture_traits'),
    fetchAll('cultures'),
    fetchAll('architecture_styles'),
    fetchAll('architecture_blocks'),
    fetchAll('fashion_styles'),
    fetchAll('fashion_variants'),
    fetchAll('buildings'),
    fetchAll('population_archetypes'),
    fetchAll('ancestry_biome_affinities'),
    fetchAll('ancestry_feature_bonuses'),
    fetchAll('culture_ancestry_preferences'),
    fetchAll('culture_trait_assignments'),
    fetchAll('culture_architecture_assignments'),
  ]);

  // Build lookup maps
  const biomeById = Object.fromEntries(biomes.map(b => [b.id, b.slug]));
  const featureById = Object.fromEntries(features.map(f => [f.id, f.slug]));
  const traitById = Object.fromEntries(traits.map(t => [t.id, t.slug]));
  const ancestryById = Object.fromEntries(ancestries.map(a => [a.id, a]));
  const cultureById = Object.fromEntries(cultures.map(c => [c.id, c]));

  // ── race-affinities.json ──────────────────────────────────────────────
  const raceAffinities = {
    _doc: 'Exported from Supabase. Do not edit — run npm run macro:export to regenerate.',
    _biomes: biomes.map(b => b.slug),
    races: ancestries.map(a => {
      const biomeAffinity = {};
      for (const ba of biomeAffs.filter(x => x.ancestry_id === a.id)) {
        biomeAffinity[biomeById[ba.biome_id]] = Number(ba.score);
      }
      const featureBonus = {};
      for (const fb of featureBons.filter(x => x.ancestry_id === a.id)) {
        featureBonus[featureById[fb.feature_id]] = Number(fb.bonus);
      }
      return {
        id: a.slug,
        name: a.name,
        description: a.description,
        biomeAffinity,
        elevationAffinity: {
          ideal: [a.elevation_ideal_min, a.elevation_ideal_max],
          tolerance: [a.elevation_tol_min, a.elevation_tol_max],
        },
        moistureAffinity: {
          ideal: [a.moisture_ideal_min, a.moisture_ideal_max],
          tolerance: [a.moisture_tol_min, a.moisture_tol_max],
        },
        featureBonus,
        clustering: a.clustering,
        populationWeight: Number(a.population_weight),
        mixingBehavior: a.mixing_behavior,
        namingBase: a.naming_base,
      };
    }),
  };
  writeFileSync(mw('race-affinities.json'), JSON.stringify(raceAffinities, null, 2) + '\n');
  console.log(`  race-affinities.json: ${raceAffinities.races.length} ancestries`);

  // ── cultures.json ─────────────────────────────────────────────────────
  const culturesOut = {
    _doc: 'Exported from Supabase. Do not edit — run npm run macro:export to regenerate.',
    cultures: cultures.map(c => {
      // Resolve ancestry preferences
      const racePreferences = {};
      for (const cp of culturePref.filter(x => x.culture_id === c.id)) {
        const anc = ancestryById[cp.ancestry_id];
        if (anc) racePreferences[anc.name] = Number(cp.weight);
      }
      // Resolve trait slugs
      const traitSlugs = traitAssign
        .filter(x => x.culture_id === c.id)
        .map(x => traitById[x.trait_id])
        .filter(Boolean);
      return {
        id: c.slug,
        name: c.name,
        racePreferences,
        spacing: Number(c.spacing),
        organicness: Number(c.organicness),
        hierarchyScale: Number(c.hierarchy_scale),
        perimeterAwareness: Number(c.perimeter_awareness),
        facingBias: c.facing_bias,
        verticality: Number(c.verticality),
        preferredShapes: c.preferred_shapes,
        roofStyle: c.roof_style,
        streetPattern: c.street_pattern,
        traits: traitSlugs,
      };
    }),
  };
  writeFileSync(mw('cultures.json'), JSON.stringify(culturesOut, null, 2) + '\n');
  console.log(`  cultures.json: ${culturesOut.cultures.length} cultures`);

  // ── culture-traits.json ───────────────────────────────────────────────
  const traitsOut = {
    _doc: 'Exported from Supabase. Do not edit — run npm run macro:export to regenerate.',
  };
  for (const t of traits) traitsOut[t.slug] = t.description;
  writeFileSync(mw('culture-traits.json'), JSON.stringify(traitsOut, null, 2) + '\n');
  console.log(`  culture-traits.json: ${traits.length} traits`);

  // ── architecture.json ─────────────────────────────────────────────────
  const archOut = {
    _doc: 'Exported from Supabase. Do not edit — run npm run macro:export to regenerate.',
    styles: archStyles.map(s => {
      const blocks = archBlocks
        .filter(b => b.style_id === s.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(b => {
          const out = { type: b.block_type, name: b.name };
          if (b.sprite_key) out.sprite = b.sprite_key;
          return out;
        });
      return {
        id: s.slug.toUpperCase(),
        name: s.name,
        primaryMaterial: s.primary_material,
        constructionMethod: s.construction_method,
        formLanguage: s.form_language,
        groundRelation: s.ground_relation,
        windowStyle: s.window_style,
        ornamentLevel: s.ornament_level,
        structuralPrinciple: s.structural_principle,
        climateResponse: s.climate_response,
        description: s.description,
        promptKeywords: s.prompt_keywords,
        realWorldInspiration: s.real_world_inspiration,
        blocks,
      };
    }),
  };
  writeFileSync(mw('architecture.json'), JSON.stringify(archOut, null, 2) + '\n');
  console.log(`  architecture.json: ${archOut.styles.length} styles`);

  // ── fashion.json ──────────────────────────────────────────────────────
  const fashionOut = {
    _doc: 'Exported from Supabase. Do not edit — run npm run macro:export to regenerate.',
    fashions: fashionStyles.map(f => {
      const culture = cultureById[f.culture_id];
      const variants = fashionVariants
        .filter(v => v.fashion_style_id === f.id)
        .map(v => ({
          role: v.role,
          silhouette: v.silhouette,
          headwear: v.headwear,
          footwear: v.footwear,
          accessories: v.accessories ?? [],
          notes: v.notes,
        }));
      return {
        cultureId: culture?.slug ?? f.culture_id,
        realWorldFashionInspiration: f.real_world_inspiration,
        base: {
          materials: f.base_materials ?? [],
          palette: f.base_palette ?? [],
          motifs: f.base_motifs ?? [],
        },
        variants,
      };
    }),
  };
  writeFileSync(mw('fashion.json'), JSON.stringify(fashionOut, null, 2) + '\n');
  console.log(`  fashion.json: ${fashionOut.fashions.length} fashions`);

  // ── building-registry.json ─────────────────────────────────────────
  const buildingById = Object.fromEntries(buildings.map(b => [b.id, b]));
  const buildingRegistryOut = {
    _doc: 'Exported from Supabase. Do not edit — run npm run macro:export to regenerate.',
    buildings: buildings.map(b => {
      const out = {
        id: b.slug,
        name: b.name,
        role: b.role,
        category: b.category,
        minTier: b.min_tier,
        zone: b.zone,
        baseSizeRange: [b.base_size_min, b.base_size_max],
        heightHint: b.height_hint,
        unlockConditions: b.unlock_conditions ?? {},
        count: b.count ?? {},
        placementHints: b.placement_hints ?? [],
        loreHook: b.lore_hook,
      };
      if (b.base_depth_min != null) out.baseDepthRange = [b.base_depth_min, b.base_depth_max];
      return out;
    }),
  };
  writeFileSync(mw('building-registry.json'), JSON.stringify(buildingRegistryOut, null, 2) + '\n');
  console.log(`  building-registry.json: ${buildingRegistryOut.buildings.length} buildings`);

  // ── population-archetypes.json ────────────────────────────────────────
  // Group by building
  const buildingArchetypes = [];
  const buildingGroups = {};
  for (const pa of popArchetypes.filter(a => !a.is_ambient)) {
    const bSlug = pa.building_id ? buildingById[pa.building_id]?.slug : null;
    if (!bSlug) continue;
    if (!buildingGroups[bSlug]) buildingGroups[bSlug] = [];
    buildingGroups[bSlug].push(pa);
  }
  for (const [bSlug, archetypes] of Object.entries(buildingGroups)) {
    buildingArchetypes.push({
      buildingId: bSlug,
      archetypes: archetypes.map(a => {
        const out = {
          role: a.role,
          name: a.name,
          fashionVariant: a.fashion_variant,
          count: a.count_min === a.count_max ? a.count_min : [a.count_min, a.count_max],
          spriteNotes: a.sprite_notes,
        };
        if (a.animations?.length) out.animations = a.animations;
        return out;
      }),
    });
  }
  const ambientArchetypes = popArchetypes
    .filter(a => a.is_ambient)
    .map(a => ({
      role: a.role,
      name: a.name,
      fashionVariant: a.fashion_variant,
      countPerTier: a.count_per_tier,
      spriteNotes: a.sprite_notes,
      animations: a.animations ?? [],
    }));
  const popArchOut = {
    _doc: 'Exported from Supabase. Do not edit — run npm run macro:export to regenerate.',
    buildingArchetypes,
    ambientArchetypes,
  };
  writeFileSync(mw('population-archetypes.json'), JSON.stringify(popArchOut, null, 2) + '\n');
  console.log(`  population-archetypes.json: ${popArchetypes.length} archetypes`);

  console.log('\nDone!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
