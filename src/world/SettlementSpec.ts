/**
 * SettlementSpec — data types for the runtime settlement generation system.
 *
 * A settlement is fully described by its site (why here), geography (what
 * biome), purpose (what people do), tier (how big), culture (how they build),
 * and any anomalies (unique one-off buildings or events).
 *
 * The generator reads a SettlementSite from the macro map, derives purpose
 * and tier, rolls secondary traits and anomalies, then hands the full
 * SettlementSpec to the layout engine which produces placed buildings.
 */

// ── Geography ─────────────────────────────────────────────────────────────────

/** Biome-level geography — determines available materials and visual palette. */
export type Geography =
  | 'coastal'
  | 'forest'
  | 'mountain'
  | 'plains'
  | 'tundra'
  | 'desert'
  | 'wetland'
  | 'volcanic';

// ── Site features ─────────────────────────────────────────────────────────────

/** Strategic or geographic features detected from the macro map at this location. */
export type SiteFeature =
  | 'river-crossing'
  | 'harbour'
  | 'mountain-pass'
  | 'crossroads'
  | 'hilltop'
  | 'river-confluence'
  | 'resource-deposit'
  | 'defensible-ridge'
  | 'wilderness-edge'
  | 'sacred-site'
  | 'corruption-boundary'
  | 'earth-ruin'
  | 'trade-route';

/** Resources detectable in adjacent tiles from the macro map. */
export type AdjacentResource =
  | 'timber'
  | 'ore'
  | 'fish'
  | 'fertile-soil'
  | 'salt'
  | 'clay'
  | 'stone'
  | 'game'       // huntable wildlife
  | 'crystal'
  | 'peat';

// ── Purpose ───────────────────────────────────────────────────────────────────

/** Why the settlement was originally founded — drives core building programme. */
export type SettlementPurpose =
  | 'fishing'
  | 'logging'
  | 'mining'
  | 'trading-hub'
  | 'frontier'
  | 'refuge'
  | 'shrine'
  | 'farming'
  | 'herding'
  | 'port'
  | 'garrison';

// ── Secondary traits ──────────────────────────────────────────────────────────

/**
 * Economic activities that a settlement acquires as it grows or due to
 * resource adjacency. Each adds buildings to the layout without replacing
 * the original purpose.
 */
export type SecondaryTrait =
  | 'trading'
  | 'agricultural'
  | 'military'
  | 'religious'
  | 'smithing'
  | 'scholarly'
  | 'brewing';

// ── Anomalies ─────────────────────────────────────────────────────────────────

/**
 * Rare unique buildings or events rolled during generation. These add a
 * special building outside the normal programme — placed at the settlement
 * edge, on high ground, or in a gap in the layout.
 */
export type AnomalyType =
  | 'retired-hero'
  | 'mage-tower'
  | 'earth-ruin-incorporated'
  | 'cursed-plot'
  | 'oversized-relic'
  | 'refugee-quarter'
  | 'strange-shrine'
  | 'mechanical-oddity';

export interface Anomaly {
  type: AnomalyType;
  /** Where to place relative to settlement core. */
  placement: 'edge' | 'high-ground' | 'gap' | 'outside';
}

// ── Tier ──────────────────────────────────────────────────────────────────────

/**
 * Settlement size tier. Drives building count, plaza existence, and which
 * building types are unlocked.
 *
 *   1 = Outpost   (2–3 buildings, campfire, no plaza)
 *   2 = Hamlet    (4–7 buildings, small plaza)
 *   3 = Village   (8–12 buildings, medium plaza, inn unlocked)
 *   4 = Town      (13–20 buildings, large plaza + secondary square)
 *   5 = Stronghold (20+ buildings, fortified courtyard, walls)
 */
export type SettlementTier = 1 | 2 | 3 | 4 | 5;

// ── Site analysis (input from macro map) ──────────────────────────────────────

/** Raw site data extracted from the macro map before generation. */
export interface SettlementSite {
  /** World position. */
  x: number;
  y: number;
  /** Biome at this location. */
  geography: Geography;
  /** Strategic / geographic features at this exact spot. */
  features: SiteFeature[];
  /** Resources available within a few tiles. */
  adjacentResources: AdjacentResource[];
  /** Is the corruption boundary nearby? */
  nearCorruption: boolean;
  /** How many trade routes pass through or near this site. */
  tradeRouteCount: number;
  /** How many other settlements are within interaction range. */
  nearbySettlements: number;
  /** Settlement-culture id from settlement-cultures.json — assigned by the macro map. Race-agnostic: multiple races may share a settlement culture. */
  cultureId: string;
  /**
   * Optional weighted race preferences for this settlement, inherited from the
   * culture's `racePreferences` map. Keys are race ids; values are relative
   * weights (e.g. `{ human: 0.6, pandor: 0.3 }`). Absent or empty means the
   * generator samples races from regional demographics only.
   */
  racePreferences?: { [raceId: string]: number };
}

// ── Full settlement spec (output of generation) ──────────────────────────────

/** Complete settlement definition ready for the layout engine. */
export interface SettlementSpec {
  id: string;
  /** Display name — generated or hand-authored. */
  name: string;
  /** World position (snapped to tile grid by layout engine). */
  x: number;
  y: number;
  /** Size tier — derived from site strategic value + macro map population. */
  tier: SettlementTier;
  /** Biome geography. */
  geography: Geography;
  /** Founding purpose — derived from site features + adjacent resources. */
  purpose: SettlementPurpose;
  /** Acquired economic activities from growth and adjacency. */
  secondary: SecondaryTrait[];
  /** Culture id — drives layout modifiers and building shapes. Race-agnostic: multiple races may share one culture. */
  cultureId: string;
  /**
   * Optional weighted race preferences for this settlement. Keys are race ids;
   * values are relative weights (e.g. `{ human: 0.6, pandor: 0.3 }`). Absent
   * or empty means the generator samples races from regional demographics only.
   */
  racePreferences?: { [raceId: string]: number };
  /** Rare unique buildings / events. */
  anomalies: Anomaly[];
  /** Approximate radius in world pixels for the layout engine. */
  radius: number;
}
