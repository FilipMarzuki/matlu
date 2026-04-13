/**
 * Shared structural types for the level registry.
 *
 * Each level file (Level1.ts – Level5.ts) declares its own Zone, Collectible,
 * and Settlement interfaces for per-level specificity (e.g. Level 5's Settlement
 * only uses the 'trace' type; Level 3's has 'sanctuary'). Those per-file types
 * are intentional — they give the author precise control over what placements
 * are valid in each level.
 *
 * The base types here use `string` for variable fields so that LevelRegistry
 * can hold all five levels in a single typed array without losing the structure.
 * If you read a level config through the registry you'll have all the data you
 * need; if you import a specific level file directly you get the narrower types.
 */

/** Zone overlay in world space — drives corruption visuals. */
export interface ZoneBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Starting corruption 0–100 */
  corruption: number;
  /** Hex colour of the overlay rectangle (e.g. 0x303030) */
  tintColor: number;
  /** Starting alpha of the overlay (0 = invisible, 1 = opaque) */
  tintAlpha: number;
}

/** Pickup item placed in the world — no map marker, found by curiosity. */
export interface CollectibleBase {
  id: string;
  x: number;
  y: number;
  /** Swedish name shown as a floating label on pickup */
  label: string;
  /** Zone this collectible belongs to. Empty string = secret (no zone). */
  zoneId: string;
}

/**
 * A notable location on the level map — hamlet, outpost, sanctuary, ruin,
 * hybrid meeting-point, or trace. The type field is `string` here so all
 * five levels can be stored in the same array; each level file narrows it
 * to a specific union.
 */
export interface SettlementBase {
  id: string;
  /** Swedish place name shown as a label on the map */
  name: string;
  x: number;
  y: number;
  /** Boundary radius in pixels — used for rendering and proximity checks */
  radius: number;
  type: string;
}

/**
 * Complete configuration for one level in the five-level arc.
 *
 * This is the interface that LevelRegistry assembles from the individual
 * Level*.ts exports. A future level-selection mechanism (e.g. NavScene or a
 * transition manager) will call `getLevelConfig(n)` and pass the result to
 * whatever scene bootstraps the level.
 */
export interface LevelConfig {
  /** 1-based level number (1 = Höga Kusten Varnad, 5 = The Source) */
  level: number;
  /** Human-readable level name matching the FIL-143 arc design */
  name: string;
  zones: ZoneBase[];
  collectibles: CollectibleBase[];
  settlements: SettlementBase[];
  /** Positions of secret collectibles — used to stamp hidden-hollow chunks */
  secretPositions: ReadonlyArray<{ x: number; y: number; label: string }>;
  /** Biome transition markers — stamped with WAYMARKER_STONE chunks */
  zoneBoundaryMarkers: ReadonlyArray<{ x: number; y: number }>;
  /** Proximity trigger radius for the meeting/confrontation dialog (px) */
  meetingRadius: number;
  /** World-space position of the meeting/confrontation trigger */
  meetingPoint: { x: number; y: number };
  /** Three path options presented after the meeting dialog */
  pathChoices: ReadonlyArray<{ id: string; label: string }>;
  /**
   * Returns the opening line of the meeting dialog.
   * Varies based on how many collectibles the player found — reflecting how
   * carefully they explored the level before arriving at the meeting point.
   */
  meetingOpeningLine: (itemsFound: number) => string;
  /** Passive corruption cleanse rate in the level's cleanest zone (% per ms) */
  passiveCleanseRate: number;
  /** Maximum passive cleanse contribution per stay (%) */
  passiveCleanseCap: number;
}
