/**
 * mapgenData — Supabase-aware data source for mapgen/SettlementGenerator (#1179).
 *
 * mapgen/ is hermetic — no Phaser, no Supabase, no src/ imports — and takes
 * its culture + building registry data as a plain `MapgenData` argument
 * rather than fetching it. This module does the Supabase fetch (falling
 * back to the bundled JSON snapshot) that used to live inside
 * SettlementGenerator's `initSettlementData()`, and hands scenes the
 * resulting `MapgenData`.
 */

import { loadMacroWorld, getTraitSlugsForCulture } from '../lib/macroWorld';
import type { Culture, Building } from '../lib/macroWorld';
import type { CultureDef, BuildingRegistryEntry, MapgenData } from '../../mapgen/SettlementGenerator';

// ── JSON fallback (bundled by Vite, used when Supabase unavailable) ─────────

import culturesDataFallback from '../../macro-world/cultures.json';
import buildingRegistryData from '../../public/macro-world/building-registry.json';

/** Map a Supabase Culture row to the internal CultureDef shape. */
function cultureToDef(c: Culture): CultureDef {
  return {
    id:                  c.slug,
    name:                c.name,
    spacing:             c.spacing ?? 1.0,
    organicness:         c.organicness ?? 0.5,
    hierarchyScale:      c.hierarchy_scale ?? 1.0,
    perimeterAwareness:  c.perimeter_awareness ?? 0.0,
    facingBias:          c.facing_bias ?? 'random',
    verticality:         c.verticality ?? 0.0,
    preferredShapes:     c.preferred_shapes ?? [],
    roofStyle:           c.roof_style ?? 'thatch',
    streetPattern:       c.street_pattern ?? 'organic',
    traits:              getTraitSlugsForCulture(c.id),
  };
}

/** Map a Supabase Building row to the internal BuildingRegistryEntry shape. */
function buildingToDef(b: Building): BuildingRegistryEntry {
  return {
    id:               b.slug,
    name:             b.name,
    role:             b.role ?? '',
    category:         b.category ?? 'residential',
    minTier:          b.min_tier ?? 1,
    zone:             (b.zone ?? 'middle') as 'inner' | 'middle' | 'outer',
    baseSizeRange:    [b.base_size_min ?? 2, b.base_size_max ?? 3],
    baseDepthRange:   b.base_depth_min != null ? [b.base_depth_min, b.base_depth_max ?? b.base_depth_min] : undefined,
    heightHint:       b.height_hint ?? 'standard',
    unlockConditions: (b.unlock_conditions ?? {}) as Record<string, unknown>,
    count:            (b.count ?? {}) as Record<string, number>,
    placementHints:   b.placement_hints ?? [],
    loreHook:         b.lore_hook ?? '',
  };
}

/** Parse the bundled JSON fallback into CultureDef[]. */
function fallbackCultures(): CultureDef[] {
  return culturesDataFallback.cultures as CultureDef[];
}

/** Parse the bundled JSON fallback into BuildingRegistryEntry[]. */
function fallbackBuildings(): BuildingRegistryEntry[] {
  return (buildingRegistryData.buildings as unknown[])
    .filter((b: unknown) => typeof b === 'object' && b !== null && 'id' in (b as Record<string, unknown>)) as BuildingRegistryEntry[];
}

let DATA: MapgenData = { cultures: fallbackCultures(), buildings: fallbackBuildings() };

/**
 * Load culture + building data from Supabase (falls back to bundled JSON).
 * Call this once during scene init before generating settlements.
 */
export async function initSettlementData(): Promise<void> {
  const mw = await loadMacroWorld();
  if (mw) {
    DATA = { cultures: mw.cultures.map(cultureToDef), buildings: mw.buildings.map(buildingToDef) };
    console.log(`[mapgenData] loaded ${DATA.cultures.length} cultures, ${DATA.buildings.length} buildings from Supabase`);
  } else {
    DATA = { cultures: fallbackCultures(), buildings: fallbackBuildings() };
    console.log(`[mapgenData] using JSON fallback (${DATA.cultures.length} cultures, ${DATA.buildings.length} buildings)`);
  }
}

/** The currently loaded data — pass this into mapgen's generateSettlement(). */
export function getMapgenData(): MapgenData {
  return DATA;
}

/** All loaded cultures — read-only access for UI / debug. */
export function getAllCultures(): readonly CultureDef[] {
  return DATA.cultures;
}

/** All loaded building registry entries — read-only access for UI / debug. */
export function getAllBuildings(): readonly BuildingRegistryEntry[] {
  return DATA.buildings;
}

export function getCulture(cultureId: string): CultureDef | undefined {
  return DATA.cultures.find(c => c.id === cultureId);
}
