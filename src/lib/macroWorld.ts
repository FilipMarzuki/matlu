/**
 * macroWorld.ts — Supabase-backed fetch layer for macro-world data.
 *
 * All data is fetched once and cached in memory (it rarely changes at runtime).
 * Returns null gracefully when Supabase is unavailable (local dev without env vars).
 *
 * Issue: #793
 */

import { supabase } from './supabaseClient';
import type { Tables } from '../types/database.types';

// ── Public row types (re-export for consumers) ─────────────────────────────

export type Ancestry = Tables<'ancestries'>;
export type Biome = Tables<'biomes'>;
export type GeographicFeature = Tables<'geographic_features'>;
export type CultureTrait = Tables<'culture_traits'>;
export type Culture = Tables<'cultures'>;
export type ArchitectureStyle = Tables<'architecture_styles'>;
export type ArchitectureBlock = Tables<'architecture_blocks'>;
export type FashionStyle = Tables<'fashion_styles'>;
export type FashionVariant = Tables<'fashion_variants'>;
export type Building = Tables<'buildings'>;
export type PopulationArchetype = Tables<'population_archetypes'>;

// Join table rows
export type AncestryBiomeAffinity = Tables<'ancestry_biome_affinities'>;
export type AncestryFeatureBonus = Tables<'ancestry_feature_bonuses'>;
export type CultureAncestryPreference = Tables<'culture_ancestry_preferences'>;
export type CultureTraitAssignment = Tables<'culture_trait_assignments'>;
export type CultureArchitectureAssignment = Tables<'culture_architecture_assignments'>;

// ── Cache ──────────────────────────────────────────────────────────────────

interface MacroWorldCache {
  ancestries: Ancestry[];
  biomes: Biome[];
  geographicFeatures: GeographicFeature[];
  cultureTraits: CultureTrait[];
  cultures: Culture[];
  architectureStyles: ArchitectureStyle[];
  architectureBlocks: ArchitectureBlock[];
  fashionStyles: FashionStyle[];
  fashionVariants: FashionVariant[];
  buildings: Building[];
  populationArchetypes: PopulationArchetype[];
  ancestryBiomeAffinities: AncestryBiomeAffinity[];
  ancestryFeatureBonuses: AncestryFeatureBonus[];
  cultureAncestryPreferences: CultureAncestryPreference[];
  cultureTraitAssignments: CultureTraitAssignment[];
  cultureArchitectureAssignments: CultureArchitectureAssignment[];
}

let cache: MacroWorldCache | null = null;
let loading: Promise<MacroWorldCache | null> | null = null;

// ── Fetch all tables once ──────────────────────────────────────────────────

async function fetchAll(): Promise<MacroWorldCache | null> {
  if (!supabase) return null;

  // Fire all queries in parallel
  const [
    ancestries,
    biomes,
    geographicFeatures,
    cultureTraits,
    cultures,
    architectureStyles,
    architectureBlocks,
    fashionStyles,
    fashionVariants,
    buildings,
    populationArchetypes,
    ancestryBiomeAffinities,
    ancestryFeatureBonuses,
    cultureAncestryPreferences,
    cultureTraitAssignments,
    cultureArchitectureAssignments,
  ] = await Promise.all([
    supabase.from('ancestries').select('*'),
    supabase.from('biomes').select('*'),
    supabase.from('geographic_features').select('*'),
    supabase.from('culture_traits').select('*'),
    supabase.from('cultures').select('*'),
    supabase.from('architecture_styles').select('*'),
    supabase.from('architecture_blocks').select('*').order('sort_order'),
    supabase.from('fashion_styles').select('*'),
    supabase.from('fashion_variants').select('*'),
    supabase.from('buildings').select('*'),
    supabase.from('population_archetypes').select('*'),
    supabase.from('ancestry_biome_affinities').select('*'),
    supabase.from('ancestry_feature_bonuses').select('*'),
    supabase.from('culture_ancestry_preferences').select('*'),
    supabase.from('culture_trait_assignments').select('*'),
    supabase.from('culture_architecture_assignments').select('*'),
  ]);

  // Check for any errors
  const results = [
    ancestries, biomes, geographicFeatures, cultureTraits, cultures,
    architectureStyles, architectureBlocks, fashionStyles, fashionVariants,
    buildings, populationArchetypes,
    ancestryBiomeAffinities, ancestryFeatureBonuses, cultureAncestryPreferences,
    cultureTraitAssignments, cultureArchitectureAssignments,
  ];
  for (const r of results) {
    if (r.error) {
      console.error('[macroWorld] fetch error:', r.error.message);
      return null;
    }
  }

  return {
    ancestries: ancestries.data!,
    biomes: biomes.data!,
    geographicFeatures: geographicFeatures.data!,
    cultureTraits: cultureTraits.data!,
    cultures: cultures.data!,
    architectureStyles: architectureStyles.data!,
    architectureBlocks: architectureBlocks.data!,
    fashionStyles: fashionStyles.data!,
    fashionVariants: fashionVariants.data!,
    buildings: buildings.data!,
    populationArchetypes: populationArchetypes.data!,
    ancestryBiomeAffinities: ancestryBiomeAffinities.data!,
    ancestryFeatureBonuses: ancestryFeatureBonuses.data!,
    cultureAncestryPreferences: cultureAncestryPreferences.data!,
    cultureTraitAssignments: cultureTraitAssignments.data!,
    cultureArchitectureAssignments: cultureArchitectureAssignments.data!,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Load all macro-world data from Supabase (or return cached).
 * Returns null if Supabase is unavailable.
 * Safe to call multiple times — deduplicates concurrent requests.
 */
export async function loadMacroWorld(): Promise<MacroWorldCache | null> {
  if (cache) return cache;
  if (!loading) loading = fetchAll();
  cache = await loading;
  loading = null;
  return cache;
}

/** Synchronous access to cached data. Returns null if not yet loaded. */
export function getMacroWorld(): MacroWorldCache | null {
  return cache;
}

/** Force a fresh fetch on next call to loadMacroWorld(). */
export function invalidateMacroWorldCache(): void {
  cache = null;
  loading = null;
}

// ── Convenience lookups ────────────────────────────────────────────────────

/** Find a culture by slug. Requires data to be loaded first. */
export function getCultureBySlug(slug: string): Culture | undefined {
  return cache?.cultures.find(c => c.slug === slug);
}

/** Find an ancestry by slug. Requires data to be loaded first. */
export function getAncestryBySlug(slug: string): Ancestry | undefined {
  return cache?.ancestries.find(a => a.slug === slug);
}

/** Find an architecture style by slug. Requires data to be loaded first. */
export function getArchitectureStyleBySlug(slug: string): ArchitectureStyle | undefined {
  return cache?.architectureStyles.find(a => a.slug === slug);
}

/** Get architecture blocks for a style (by style UUID). */
export function getBlocksForStyle(styleId: string): ArchitectureBlock[] {
  return cache?.architectureBlocks.filter(b => b.style_id === styleId) ?? [];
}

/** Get trait slugs assigned to a culture (by culture UUID). */
export function getTraitSlugsForCulture(cultureId: string): string[] {
  if (!cache) return [];
  const traitIds = cache.cultureTraitAssignments
    .filter(a => a.culture_id === cultureId)
    .map(a => a.trait_id);
  return cache.cultureTraits
    .filter(t => traitIds.includes(t.id))
    .map(t => t.slug);
}

/** Get architecture styles assigned to a culture (by culture UUID). */
export function getArchitectureForCulture(cultureId: string): ArchitectureStyle[] {
  if (!cache) return [];
  const styleIds = cache.cultureArchitectureAssignments
    .filter(a => a.culture_id === cultureId)
    .map(a => a.architecture_style_id);
  return cache.architectureStyles.filter(s => styleIds.includes(s.id));
}

/** Get fashion variants for a culture (by culture UUID). */
export function getFashionForCulture(cultureId: string): {
  style: FashionStyle;
  variants: FashionVariant[];
} | null {
  if (!cache) return null;
  const style = cache.fashionStyles.find(f => f.culture_id === cultureId);
  if (!style) return null;
  const variants = cache.fashionVariants.filter(v => v.fashion_style_id === style.id);
  return { style, variants };
}

/** Find a building by slug. */
export function getBuildingBySlug(slug: string): Building | undefined {
  return cache?.buildings.find(b => b.slug === slug);
}

/** Get population archetypes for a building (by building UUID). */
export function getArchetypesForBuilding(buildingId: string): PopulationArchetype[] {
  return cache?.populationArchetypes.filter(a => a.building_id === buildingId) ?? [];
}

/** Get ambient (non-building) archetypes. */
export function getAmbientArchetypes(): PopulationArchetype[] {
  return cache?.populationArchetypes.filter(a => a.is_ambient) ?? [];
}
