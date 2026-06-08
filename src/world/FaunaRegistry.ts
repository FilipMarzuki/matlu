import type { Season } from './SeasonSystem';

/**
 * FaunaRegistry — typed interfaces and helpers for the data-driven fauna registry.
 *
 * The registry JSON lives at `public/macro-world/fauna-registry.json` and is loaded
 * by any scene that needs wildlife data via `this.load.json('fauna-registry', ...)`.
 * This module provides TypeScript types for the JSON shape and converter helpers that
 * produce the exact data structures GameScene's existing spawn/update loops expect,
 * so the migration from hardcoded constants is zero-risk.
 *
 * Pattern follows TreeScatter.ts — typed bridge between JSON and scene code.
 */

// ── JSON shape ──────────────────────────────────────────────────────────────────

export interface SpriteDef {
  key:         string;
  path:        string;
  frameWidth:  number;
  frameHeight: number;
  frames:      number[];
  frameRate:   number;
}

export interface ForagingDef {
  /** Foraging behavior type — determines what terrain feature the animal seeks. */
  type: 'fishing' | 'grubbing' | 'browsing' | 'scavenging' | 'pecking';
  /** Biome indices where this foraging is valid (from biomes.ts). */
  biomes: number[];
  /** Duration range [min, max] in ms for the foraging pause. */
  duration: [number, number];
  /** Cooldown range [min, max] in ms before foraging again. */
  cooldown: [number, number];
}

export type LifeStage = 'young' | 'adult' | 'elder';
export type AnimalSex = 'male' | 'female';

/**
 * Per-stage modifiers applied on top of the base AnimalDef values.
 * Multipliers: 1.0 = no change, 0.7 = 70% of base, 1.3 = 130% of base.
 */
export interface StageDef {
  /** Multiplier on base scale (young ~0.6, elder ~0.93). */
  scaleMult:     number;
  /** Multiplier on roamSpeed (young faster +20%, elder slower -20%). */
  roamSpeedMult: number;
  /** Multiplier on fleeSpeed (young faster +30%, elder slower -15%). */
  fleeSpeedMult: number;
  /** Multiplier on fleeRange (young more skittish 0.7×, elder more cautious 1.3×). */
  fleeRangeMult: number;
  /** Tint applied to the sprite (0xffffff = no tint). */
  tint:          number;
}

/** Default stage modifiers — used when a species doesn't override them. */
export const DEFAULT_STAGES: Record<LifeStage, StageDef> = {
  young: { scaleMult: 0.6, roamSpeedMult: 0.75, fleeSpeedMult: 0.85, fleeRangeMult: 1.5, tint: 0xffffff },
  adult: { scaleMult: 1.0, roamSpeedMult: 1.0, fleeSpeedMult: 1.0, fleeRangeMult: 1.0, tint: 0xffffff },
  elder: { scaleMult: 0.93, roamSpeedMult: 0.8, fleeSpeedMult: 0.85, fleeRangeMult: 1.3, tint: 0xdddddd },
};

export interface FaunaDef {
  id:        string;
  name:      string;
  class:     'ground' | 'bird';
  world:     'earth' | 'spinolandet' | 'mistheim';

  /** Behavior template — informs future AI patterns; informational for now. */
  archetype: 'grazer' | 'predator' | 'critter' | 'flocking';
  /** Day/night activity pattern — informs future sleep/wake cycle. */
  activity:  'diurnal' | 'nocturnal' | 'crepuscular';
  diet:      'herbivore' | 'carnivore' | 'omnivore' | 'insectivore';
  solitary:  boolean;

  body:      { w: number; h: number };
  scale:     number;
  fleeRange: number;
  fleeSpeed: number;
  roamSpeed: number;
  count:     number;

  /** Cluster-based spawn config. null for birds (simple count placement). */
  spawning: {
    clusters:       [number, number];
    perCluster:     [number, number];
    clusterR:       number;
    clusterMinDist: number;
  } | null;

  /** Preferred biome indices (human-readable reference). */
  biomes:    number[];
  /** Continuous terrain-noise affinity. null means spawn everywhere. */
  spawnBias: { optimal: [number, number]; falloff: number } | null;

  sprites:  Record<string, SpriteDef>;
  sounds:   Record<string, { key: string; volume: number; rate: number }>;

  interactions: {
    predatorOf: string[];
    chaseRange: number | null;
    /** Hunt behavior pattern. Defaults to 'pursuit' when omitted. */
    huntStrategy?: 'pursuit' | 'ambush' | 'pack' | 'dive' | 'lure' | null;
  };

  /** Spawn weight per life stage. Omit to use default { young: 0.25, adult: 0.60, elder: 0.15 }. */
  stageWeights?: { young: number; adult: number; elder: number };

  /** Number of visual variants (distinctive markings). 1 = no variation. Default 1. */
  variants?: number;
  /** Aging durations in game-days. Omit to disable aging (stage stays fixed from spawn). */
  aging?: { youngDuration: number; adultDuration: number };

  /** Sex-based differences. Omit for species with no meaningful dimorphism. */
  sexDimorphism?: {
    /** Male scale multiplier relative to base (e.g. 1.15 = 15% larger). */
    maleScaleMult?: number;
    /** Male flee range multiplier (e.g. 0.8 = less cautious). */
    maleFleeRangeMult?: number;
    /** Male roam radius multiplier (e.g. 1.5 = wanders farther). */
    maleRoamMult?: number;
    /** Female flee range multiplier when with young (e.g. 1.3 = more protective). */
    motherFleeRangeMult?: number;
    /** Mating season (which game season triggers reproductive behavior). */
    matingSeason?: Season | Season[];
    /** Pregnancy duration in game-days. */
    pregnancyDays?: number;
    /** Whether males display/fight for mates (enables mating display state). */
    maleDisplays?: boolean;
    /** Whether this species pair-bonds (wolves) vs brief mating (deer). */
    pairBonds?: boolean;
  };

  /** Weather/environmental sensitivity overrides. Omit to use archetype defaults. */
  weatherSensitivity?: {
    /** Flee range multiplier during rain (default: 1.3 for prey, 1.0 for predators). */
    rainFleeRangeMult?: number;
    /** Min temperature (0-1) for activity — below this, seek shelter / sleep. */
    coldThreshold?: number;
    /** Max temperature (0-1) for activity — above this, rest in shade. */
    heatThreshold?: number;
    /** Wind strength (0-1) above which the animal shelters. */
    windShelterThreshold?: number;
  };

  /** Environmental foraging behavior. null = no foraging. */
  foraging: ForagingDef | null;

  /** PixelLab generation guidance for species without sprites yet. */
  designNotes: Record<string, unknown> | null;
}

export interface FaunaRegistryData {
  fauna: FaunaDef[];
}

// ── Backward-compat types matching GameScene's existing code ────────────────────

export interface AnimalDef {
  w: number; h: number;
  fleeRange: number; fleeSpeed: number; roamSpeed: number; count: number;
  scale: number;
  fleeVocal: { key: string; volume: number; rate: number };
}

export interface ClusterConfig {
  clusters:       [number, number];
  perCluster:     [number, number];
  clusterR:       number;
  clusterMinDist: number;
}

// ── Converter helpers ───────────────────────────────────────────────────────────

/**
 * Convert fauna registry entries into the Record<string, AnimalDef> shape
 * that GameScene's placeGroundAnimal / updateGroundAnimals loops expect.
 * Only includes ground animals (class === 'ground').
 */
export function buildAnimalDefs(reg: FaunaRegistryData): Record<string, AnimalDef> {
  const result: Record<string, AnimalDef> = {};
  for (const f of reg.fauna) {
    if (f.class !== 'ground') continue;
    const flee = f.sounds['flee'];
    result[f.id] = {
      w: f.body.w,
      h: f.body.h,
      scale:     f.scale,
      fleeRange: f.fleeRange,
      fleeSpeed: f.fleeSpeed,
      roamSpeed: f.roamSpeed,
      count:     f.count,
      fleeVocal: flee
        ? { key: flee.key, volume: flee.volume, rate: flee.rate }
        : { key: '', volume: 0, rate: 1 },
    };
  }
  return result;
}

/**
 * Convert fauna registry entries into the Record<string, ClusterConfig> shape
 * that GameScene's spawnGroundAnimals loop expects.
 */
export function buildClusterConfig(reg: FaunaRegistryData): Record<string, ClusterConfig> {
  const result: Record<string, ClusterConfig> = {};
  for (const f of reg.fauna) {
    if (f.class !== 'ground' || !f.spawning) continue;
    result[f.id] = { ...f.spawning };
  }
  return result;
}

/**
 * Build a predator→prey lookup from the interactions field.
 * Returns a map of predator id → { prey species ids, chase detection range }.
 */
export type HuntStrategy = 'pursuit' | 'ambush' | 'pack' | 'dive' | 'lure';

export function buildPredatorMap(
  reg: FaunaRegistryData,
): Map<string, { prey: string[]; range: number; strategy: HuntStrategy }> {
  const map = new Map<string, { prey: string[]; range: number; strategy: HuntStrategy }>();
  for (const f of reg.fauna) {
    if (f.interactions.predatorOf.length > 0 && f.interactions.chaseRange != null) {
      map.set(f.id, {
        prey:     f.interactions.predatorOf,
        range:    f.interactions.chaseRange,
        strategy: (f.interactions.huntStrategy as HuntStrategy) ?? 'pursuit',
      });
    }
  }
  return map;
}

/**
 * Build a set of species ids that are prey to at least one predator.
 * Used to know which species need flee-from-predator logic.
 */
export function buildPreySet(reg: FaunaRegistryData): Set<string> {
  const preyIds = new Set<string>();
  for (const f of reg.fauna) {
    for (const id of f.interactions.predatorOf) preyIds.add(id);
  }
  return preyIds;
}

/**
 * Build the animation definition tuples that createAnimalAnimations() expects:
 * [animKey, textureKey, frames, frameRate].
 * Animation keys follow the convention `{id}-{action}-anim`.
 */
export function buildAnimDefs(
  reg: FaunaRegistryData,
): Array<[key: string, texture: string, frames: number[], frameRate: number]> {
  const defs: Array<[string, string, number[], number]> = [];
  for (const f of reg.fauna) {
    for (const [action, sprite] of Object.entries(f.sprites)) {
      defs.push([`${f.id}-${action}-anim`, sprite.key, sprite.frames, sprite.frameRate]);
    }
  }
  return defs;
}

/**
 * Look up the FaunaDef for a terrain noise value. Returns the spawn bias
 * (0–1 probability) for the given species at the given terrain value.
 * Returns 1.0 if the species has no spawnBias (spawn everywhere).
 * Returns 0 if terrain value is below 0.25 (open water).
 */
export function getSpawnBias(def: FaunaDef, terrainValue: number): number {
  if (terrainValue < 0.25) return 0;
  if (!def.spawnBias) return 1.0;
  const [lo, hi] = def.spawnBias.optimal;
  return (terrainValue > lo && terrainValue < hi) ? 1.0 : def.spawnBias.falloff;
}

/**
 * Build a map of species id → archetype string for quick per-sprite lookup.
 * Stored on each sprite at spawn time via setData('archetype', ...).
 */
export function buildArchetypeMap(
  reg: FaunaRegistryData,
): Record<string, FaunaDef['archetype']> {
  const result: Record<string, FaunaDef['archetype']> = {};
  for (const f of reg.fauna) result[f.id] = f.archetype;
  return result;
}

/**
 * Build a map of species id → activity pattern for day/night behavior.
 * Stored on each sprite at spawn time via setData('activity', ...).
 */
export function buildActivityMap(
  reg: FaunaRegistryData,
): Record<string, FaunaDef['activity']> {
  const result: Record<string, FaunaDef['activity']> = {};
  for (const f of reg.fauna) result[f.id] = f.activity;
  return result;
}

/** Filter to ground fauna only. */
export function getGroundFauna(reg: FaunaRegistryData): FaunaDef[] {
  return reg.fauna.filter(f => f.class === 'ground');
}

/** Filter to bird fauna only. */
export function getBirdFauna(reg: FaunaRegistryData): FaunaDef[] {
  return reg.fauna.filter(f => f.class === 'bird');
}
