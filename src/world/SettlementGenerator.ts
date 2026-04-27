/**
 * SettlementGenerator — runtime settlement generation from site data.
 *
 * Takes a SettlementSite (macro map input) and a seeded PRNG, then:
 *   1. Derives purpose from site features and adjacent resources
 *   2. Derives tier from strategic value
 *   3. Rolls secondary economic traits based on tier + adjacency
 *   4. Rolls anomalies (rare unique buildings)
 *   5. Selects buildings from the building registry
 *   6. Returns a fully resolved SettlementSpec + building list
 *
 * The generator reads cultures.json and building-registry.json as static
 * imports (bundled by Vite). It never switches on culture id — all culture
 * effects come from numeric modifiers.
 *
 * ## Output compatibility
 * The output includes a `resolvedBuildings` array that maps to the same
 * PlacedBuilding interface the existing SettlementLayout system uses, so
 * GameScene can consume it without changes.
 */

import type {
  SettlementSite,
  SettlementSpec,
  SettlementTier,
  SettlementPurpose,
  SecondaryTrait,
  Anomaly,
  AnomalyType,
  SiteFeature,
  AdjacentResource,
} from './SettlementSpec';

// ── Static data imports (bundled by Vite) ────────────────────────────────────

import culturesData from '../../macro-world/cultures.json';
import buildingRegistryData from '../../macro-world/building-registry.json';

// ── Types for JSON data ──────────────────────────────────────────────────────

interface CultureDef {
  id: string;
  name: string;
  spacing: number;
  organicness: number;
  hierarchyScale: number;
  perimeterAwareness: number;
  facingBias: string;
  verticality: number;
  preferredShapes: string[];
  roofStyle: string;
  streetPattern: string;
  traits: string[];
}

interface BuildingRegistryEntry {
  id: string;
  name: string;
  role: string;
  category: string;
  minTier: number;
  zone: 'inner' | 'middle' | 'outer';
  baseSizeRange: [number, number];
  heightHint: string;
  unlockConditions: Record<string, unknown>;
  count: Record<string, number>;
  placementHints: string[];
  loreHook: string;
}

/** A building selected by the generator, ready for the layout engine. */
export interface ResolvedBuilding {
  /** Registry id (e.g. 'smithy', 'cottage'). */
  id: string;
  /** Human-readable role. */
  role: string;
  /** Category for layout ordering. */
  category: string;
  /** Preferred zone ring. */
  zone: 'inner' | 'middle' | 'outer';
  /** Footprint width in iso blocks (1 block = 1 grid tile). */
  w: number;
  /** Height hint for depth sorting. */
  heightHint: string;
  /** Soft placement suggestions. */
  placementHints: string[];
  /** Lore hook for tooltips. */
  loreHook: string;
}

// ── Parse static data ────────────────────────────────────────────────────────

const CULTURES: CultureDef[] = culturesData.cultures as CultureDef[];

const BUILDINGS: BuildingRegistryEntry[] = (buildingRegistryData.buildings as unknown[])
  .filter((b: unknown) => typeof b === 'object' && b !== null && 'id' in (b as Record<string, unknown>)) as BuildingRegistryEntry[];

// ── Purpose derivation ───────────────────────────────────────────────────────

/**
 * Weighted rules for deriving purpose from site features and resources.
 * First match wins — order matters (most specific first).
 */
const PURPOSE_RULES: Array<{
  purpose: SettlementPurpose;
  features?: SiteFeature[];
  resources?: AdjacentResource[];
  requireCorruption?: boolean;
}> = [
  // Strategic locations override resource-based purposes
  { purpose: 'garrison',    requireCorruption: true },
  { purpose: 'garrison',    features: ['mountain-pass', 'defensible-ridge'] },
  { purpose: 'shrine',      features: ['sacred-site'] },
  { purpose: 'port',        features: ['harbour'] },
  { purpose: 'trading-hub', features: ['crossroads'] },
  { purpose: 'trading-hub', features: ['river-confluence'] },
  { purpose: 'frontier',    features: ['wilderness-edge'] },

  // Resource-based purposes
  { purpose: 'fishing',     resources: ['fish'] },
  { purpose: 'mining',      resources: ['ore'] },
  { purpose: 'mining',      resources: ['crystal'] },
  { purpose: 'logging',     resources: ['timber'] },
  { purpose: 'farming',     resources: ['fertile-soil'] },
  { purpose: 'herding',     resources: ['game'] },

  // Feature-based fallbacks
  { purpose: 'trading-hub', features: ['trade-route', 'river-crossing'] },
  { purpose: 'refuge',      features: ['earth-ruin'] },
];

/**
 * Derive the founding purpose from site data.
 * Checks rules in priority order — first match wins.
 */
export function derivePurpose(site: SettlementSite): SettlementPurpose {
  for (const rule of PURPOSE_RULES) {
    // Corruption check
    if (rule.requireCorruption !== undefined) {
      if (rule.requireCorruption !== site.nearCorruption) continue;
      if (!rule.features && !rule.resources) return rule.purpose;
    }

    // Feature match — site must have at least one of the listed features
    if (rule.features) {
      const hasFeature = rule.features.some(f => site.features.includes(f));
      if (!hasFeature) continue;
      return rule.purpose;
    }

    // Resource match — site must have at least one of the listed resources
    if (rule.resources) {
      const hasResource = rule.resources.some(r => site.adjacentResources.includes(r));
      if (!hasResource) continue;
      return rule.purpose;
    }
  }

  // Fallback: most generic purpose based on geography
  switch (site.geography) {
    case 'coastal':  return 'fishing';
    case 'mountain': return 'mining';
    case 'plains':   return 'farming';
    case 'forest':   return 'logging';
    case 'desert':   return 'trading-hub';
    case 'tundra':   return 'herding';
    case 'wetland':  return 'fishing';
    case 'volcanic': return 'mining';
    default:         return 'refuge';
  }
}

// ── Tier derivation ──────────────────────────────────────────────────────────

/**
 * Derive settlement tier from strategic value of the site.
 * More features, trade routes, and neighbors → larger settlement.
 */
export function deriveTier(site: SettlementSite, rng: () => number): SettlementTier {
  let score = 0;

  // Each feature adds strategic value
  score += site.features.length * 1.5;

  // Trade routes are a strong growth driver
  score += site.tradeRouteCount * 2;

  // Nearby settlements enable specialization and trade
  score += site.nearbySettlements * 0.5;

  // Resource diversity drives growth
  score += site.adjacentResources.length * 0.8;

  // Key features are extra valuable
  const highValueFeatures: SiteFeature[] = ['crossroads', 'harbour', 'river-confluence'];
  for (const f of highValueFeatures) {
    if (site.features.includes(f)) score += 2;
  }

  // Corruption suppresses growth
  if (site.nearCorruption) score -= 2;

  // Add some randomness (±1.5 points)
  score += (rng() - 0.5) * 3;

  // Map score to tier
  if (score < 2)  return 1;
  if (score < 5)  return 2;
  if (score < 9)  return 3;
  if (score < 14) return 4;
  return 5;
}

// ── Secondary trait rolls ────────────────────────────────────────────────────

/**
 * Secondary traits a settlement can acquire through growth or adjacency.
 * Each has a base probability modified by tier and site conditions.
 */
const SECONDARY_CANDIDATES: Array<{
  trait: SecondaryTrait;
  baseChance: number;
  boostFeatures?: SiteFeature[];
  boostResources?: AdjacentResource[];
  /** Purposes where this secondary is redundant (already covered). */
  excludePurposes?: SettlementPurpose[];
}> = [
  {
    trait: 'trading',
    baseChance: 0.15,
    boostFeatures: ['trade-route', 'crossroads', 'river-crossing', 'harbour'],
    excludePurposes: ['trading-hub', 'port'],
  },
  {
    trait: 'agricultural',
    baseChance: 0.12,
    boostResources: ['fertile-soil'],
    excludePurposes: ['farming'],
  },
  {
    trait: 'military',
    baseChance: 0.10,
    boostFeatures: ['corruption-boundary', 'mountain-pass', 'wilderness-edge'],
    excludePurposes: ['garrison', 'frontier'],
  },
  {
    trait: 'religious',
    baseChance: 0.08,
    boostFeatures: ['sacred-site'],
    excludePurposes: ['shrine'],
  },
  {
    trait: 'smithing',
    baseChance: 0.10,
    boostResources: ['ore', 'stone'],
    excludePurposes: ['mining'],
  },
  {
    trait: 'scholarly',
    baseChance: 0.05,
    boostFeatures: ['earth-ruin', 'sacred-site'],
  },
  {
    trait: 'brewing',
    baseChance: 0.08,
    boostResources: ['fertile-soil'],
  },
];

/**
 * Roll secondary economic traits for a settlement.
 * Probability increases with tier and is boosted by matching features/resources.
 */
export function rollSecondaryTraits(
  site: SettlementSite,
  purpose: SettlementPurpose,
  tier: SettlementTier,
  rng: () => number,
): SecondaryTrait[] {
  const result: SecondaryTrait[] = [];

  // Tier multiplier: higher tier → more likely to diversify
  //   T1: 0.3x, T2: 0.6x, T3: 1.0x, T4: 1.5x, T5: 2.0x
  const tierMult = [0, 0.3, 0.6, 1.0, 1.5, 2.0][tier];

  // Max secondary traits: T1=0, T2=1, T3=1, T4=2, T5=3
  const maxTraits = [0, 0, 1, 1, 2, 3][tier];

  for (const candidate of SECONDARY_CANDIDATES) {
    if (result.length >= maxTraits) break;

    // Skip if this trait is redundant with the primary purpose
    if (candidate.excludePurposes?.includes(purpose)) continue;

    let chance = candidate.baseChance * tierMult;

    // Boost from matching features
    if (candidate.boostFeatures) {
      const matchCount = candidate.boostFeatures.filter(f => site.features.includes(f)).length;
      chance += matchCount * 0.15;
    }

    // Boost from matching resources
    if (candidate.boostResources) {
      const matchCount = candidate.boostResources.filter(r => site.adjacentResources.includes(r)).length;
      chance += matchCount * 0.12;
    }

    // Boost from nearby settlements (trade and specialization)
    if (candidate.trait === 'trading') {
      chance += site.nearbySettlements * 0.05;
    }

    if (rng() < chance) {
      result.push(candidate.trait);
    }
  }

  return result;
}

// ── Anomaly rolls ────────────────────────────────────────────────────────────

const ANOMALY_TABLE: Array<{
  type: AnomalyType;
  chance: number;
  minTier: number;
  placement: Anomaly['placement'];
}> = [
  { type: 'retired-hero',            chance: 0.05, minTier: 2, placement: 'edge' },
  { type: 'mage-tower',              chance: 0.04, minTier: 2, placement: 'high-ground' },
  { type: 'earth-ruin-incorporated', chance: 0.03, minTier: 1, placement: 'gap' },
  { type: 'cursed-plot',             chance: 0.03, minTier: 2, placement: 'gap' },
  { type: 'oversized-relic',         chance: 0.02, minTier: 2, placement: 'edge' },
  { type: 'refugee-quarter',         chance: 0.02, minTier: 3, placement: 'outside' },
  { type: 'strange-shrine',          chance: 0.02, minTier: 2, placement: 'edge' },
  { type: 'mechanical-oddity',       chance: 0.01, minTier: 1, placement: 'gap' },
];

/**
 * Roll anomalies for a settlement. Higher tiers can have more.
 * T1-2: max 1, T3: max 1, T4: max 2, T5: max 3.
 */
export function rollAnomalies(
  tier: SettlementTier,
  rng: () => number,
): Anomaly[] {
  const result: Anomaly[] = [];
  const maxAnomalies = [0, 1, 1, 1, 2, 3][tier];

  // Higher tiers get a multiplier on anomaly chances
  const tierMult = [0, 0.8, 1.0, 1.2, 1.5, 2.0][tier];

  for (const entry of ANOMALY_TABLE) {
    if (result.length >= maxAnomalies) break;
    if (tier < entry.minTier) continue;

    if (rng() < entry.chance * tierMult) {
      result.push({ type: entry.type, placement: entry.placement });
    }
  }

  return result;
}

// ── Building selection ───────────────────────────────────────────────────────

/**
 * Check if a building's unlock conditions are satisfied.
 * Conditions use OR logic — any matching field unlocks the building.
 */
function isUnlocked(
  entry: BuildingRegistryEntry,
  purpose: SettlementPurpose,
  tier: SettlementTier,
  secondary: SecondaryTrait[],
  site: SettlementSite,
  anomalies: Anomaly[],
): boolean {
  const cond = entry.unlockConditions;
  if (!cond || Object.keys(cond).length === 0) return true;

  // Tier gate
  if (tier < entry.minTier) return false;

  // maxTier gate (campfire only at small settlements)
  if ('maxTier' in cond && typeof cond.maxTier === 'number') {
    if (tier > cond.maxTier) return false;
  }

  // Anomaly buildings require their anomaly to have been rolled
  if ('_anomaly' in cond) {
    return anomalies.some(a => a.type === cond._anomaly);
  }

  // For regular buildings, check OR across conditions
  let hasConditions = false;
  let anyMatch = false;

  // Purpose match
  const purposes = cond.purposes as string[] | null | undefined;
  if (purposes !== undefined) {
    if (purposes === null) {
      // null = any purpose qualifies
      anyMatch = true;
    } else {
      hasConditions = true;
      if (purposes.includes(purpose)) anyMatch = true;
    }
  }

  // Secondary trait match
  const secondaryReq = cond.secondary as string[] | undefined;
  if (secondaryReq) {
    hasConditions = true;
    if (secondaryReq.some(s => secondary.includes(s as SecondaryTrait))) {
      anyMatch = true;
    }
  }

  // Feature match
  const features = cond.features as string[] | undefined;
  if (features) {
    hasConditions = true;
    if (features.some(f => site.features.includes(f as SiteFeature))) {
      anyMatch = true;
    }
  }

  // Adjacent resource match
  const resources = cond.adjacentResources as string[] | undefined;
  if (resources) {
    hasConditions = true;
    if (resources.some(r => site.adjacentResources.includes(r as AdjacentResource))) {
      anyMatch = true;
    }
  }

  // If there were no specific conditions beyond tier, it's unlocked
  if (!hasConditions) return true;

  return anyMatch;
}

/**
 * Select and resolve buildings from the registry for a settlement.
 * Returns buildings in placement priority order (inner/civic first).
 */
export function selectBuildings(
  site: SettlementSite,
  purpose: SettlementPurpose,
  tier: SettlementTier,
  secondary: SecondaryTrait[],
  anomalies: Anomaly[],
  culture: CultureDef | undefined,
  rng: () => number,
): ResolvedBuilding[] {
  const result: ResolvedBuilding[] = [];

  for (const entry of BUILDINGS) {
    if (!isUnlocked(entry, purpose, tier, secondary, site, anomalies)) continue;

    // How many of this building at this tier?
    const tierKey = String(tier);
    const count = entry.count[tierKey] ?? 0;
    if (count === 0) continue;

    for (let i = 0; i < count; i++) {
      // Size in iso blocks — pick randomly within the registry range.
      // baseSizeRange is [min, max] in whole block counts.
      const [minW, maxW] = entry.baseSizeRange;
      let w = Math.round(minW + rng() * (maxW - minW));

      // Culture hierarchy scale: the most important building gets bigger
      if (culture && i === 0 && result.length === 0 && entry.category === 'civic') {
        w = Math.round(w * culture.hierarchyScale);
      }

      result.push({
        id: entry.id,
        role: entry.role,
        category: entry.category,
        zone: entry.zone,
        w,
        heightHint: entry.heightHint,
        placementHints: entry.placementHints,
        loreHook: entry.loreHook,
      });
    }
  }

  // Sort by placement priority: inner civic/military first, then middle, then outer
  const zonePriority: Record<string, number> = { inner: 0, middle: 1, outer: 2 };
  const categoryPriority: Record<string, number> = {
    civic: 0, military: 1, religious: 2, commerce: 3,
    industry: 4, residential: 5, infrastructure: 6, anomaly: 7,
  };

  result.sort((a, b) => {
    const zoneA = zonePriority[a.zone] ?? 1;
    const zoneB = zonePriority[b.zone] ?? 1;
    if (zoneA !== zoneB) return zoneA - zoneB;
    const catA = categoryPriority[a.category] ?? 5;
    const catB = categoryPriority[b.category] ?? 5;
    return catA - catB;
  });

  return result;
}

// ── Radius derivation ────────────────────────────────────────────────────────

/** Base radius in world pixels per tier. Culture spacing scales this.
 *  Sized for WORLD_TILE_SIZE=32 buildings (2x scale from original 16px). */
const TIER_RADIUS: Record<SettlementTier, number> = {
  1: 120,
  2: 200,
  3: 300,
  4: 420,
  5: 560,
};

// ── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate a complete settlement spec from a site definition.
 *
 * @param site  Raw site data from the macro map
 * @param name  Display name for the settlement
 * @param rng   Seeded PRNG (mulberry32) — must be dedicated to this settlement
 * @returns     Full spec + resolved building list
 */
export function generateSettlement(
  site: SettlementSite,
  name: string,
  rng: () => number,
  /** Optional tier override — if provided, skips deriveTier(). */
  overrideTier?: SettlementTier,
): { spec: SettlementSpec; buildings: ResolvedBuilding[] } {
  // 1. Derive purpose from site features and resources
  const purpose = derivePurpose(site);

  // 2. Derive tier from strategic value (or use override)
  const tier = overrideTier ?? deriveTier(site, rng);

  // 3. Roll secondary economic traits
  const secondary = rollSecondaryTraits(site, purpose, tier, rng);

  // 4. Roll anomalies
  const anomalies = rollAnomalies(tier, rng);

  // 5. Look up culture
  const culture = CULTURES.find(c => c.id === site.cultureId);

  // 6. Derive radius (culture spacing scales the base)
  const spacingMult = culture?.spacing ?? 1.0;
  const radius = Math.round(TIER_RADIUS[tier] * spacingMult);

  // 7. Select buildings
  const buildings = selectBuildings(site, purpose, tier, secondary, anomalies, culture, rng);

  // 8. Build the spec
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const spec: SettlementSpec = {
    id,
    name,
    x: site.x,
    y: site.y,
    tier,
    geography: site.geography,
    purpose,
    secondary,
    cultureId: site.cultureId,
    anomalies,
    radius,
  };

  return { spec, buildings };
}

// ── Utility: look up a culture by id ─────────────────────────────────────────

export function getCulture(cultureId: string): CultureDef | undefined {
  return CULTURES.find(c => c.id === cultureId);
}

/** All loaded cultures — read-only access for UI / debug. */
export function getAllCultures(): readonly CultureDef[] {
  return CULTURES;
}

/** All loaded building registry entries — read-only access for UI / debug. */
export function getAllBuildings(): readonly BuildingRegistryEntry[] {
  return BUILDINGS;
}
