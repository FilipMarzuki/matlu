/**
 * ChunkDef — hand-authored "set piece" templates for procedural stamping.
 *
 * A chunk is a small cluster of objects (trees, rocks, decorations) defined with
 * relative x/y offsets from a center point. When `stampProceduralChunks()` places
 * a chunk it adds the chunk's center coordinates to each item's offset.
 *
 * ## Why chunks at all?
 * Pure procedural scatter (every object placed independently) produces uniform
 * noise — there are no landmarks, no memorable spots. Hand-authored chunks create
 * intentional compositions: a clearing ringed by trees, a ruin with rocks growing
 * through it, a watering hole. The chunk *templates* are authored; their *positions*
 * are still procedurally chosen.
 *
 * ## Item kinds
 * - `tree`       → SolidObject with narrow trunk collider (blocks movement)
 * - `rock`       → SolidObject with flat collider (blocks movement)
 * - `decoration` → Decoration sprite (no physics, purely visual)
 * - `puddle`     → Decoration sprite using puddle/water textures
 */

export type ChunkItemKind = 'tree' | 'rock' | 'decoration' | 'puddle';

export interface ChunkItem {
  kind: ChunkItemKind;
  /** Offset from chunk center in pixels */
  dx: number;
  dy: number;
  /** Texture key — must be loaded in GameScene.preload() */
  texture: string;
  /** Uniform scale applied to the sprite */
  scale?: number;
  /**
   * Spritesheet frame index (0-based). Omit for single-image textures.
   * Passed as the fourth argument to this.add.image(x, y, key, frame).
   */
  frame?: number;
  /** Collision box width (for tree/rock only) */
  colliderWidth?: number;
  /** Collision box height (for tree/rock only) */
  colliderHeight?: number;
  /** Vertical offset for collision box (for tree/rock only) */
  colliderOffsetY?: number;
}

export interface ChunkDef {
  id: string;
  /**
   * Relative weight for random selection — higher = more common.
   * forest_copse is most common (4), ruins are rare (2).
   */
  weight: number;
  /**
   * Approximate bounding radius in pixels.
   * Used for overlap rejection during placement — chunks within this distance
   * of each other or of avoid zones are skipped.
   */
  radius: number;
  /**
   * Terrain noise range [0–1] where this chunk is eligible for placement.
   * Mirrors the terrainColor() breakpoints in GameScene:
   *   < 0.37  water/shore  → WATERING_HOLE
   *   < 0.65  light meadow → CLEARING
   *   < 0.81  forest edge  → FOREST_COPSE
   *   ≥ 0.81  dense forest → RUINS
   *
   * Defaults to [0, 1] (always eligible) when not set.
   */
  biomeMin?: number;
  biomeMax?: number;
  /**
   * FIL-154: optional temperature and moisture constraints [0–1].
   * When set, the chunk only spawns where temp/moist noise falls within this range.
   * Omitting either field defaults to [0, 1] (no constraint) — backward compatible.
   *
   * Example: a RUINS chunk with moistureMin=0.5 only appears in wetter terrain,
   * giving moss-covered ruins in damp forests vs dry-stone ruins elsewhere.
   */
  temperatureMin?: number;
  temperatureMax?: number;
  moistureMin?: number;
  moistureMax?: number;
  items: ChunkItem[];
}

// ── Chunk templates ────────────────────────────────────────────────────────────

/** Tight cluster of spruce/pine trees — feels like a natural grove */
const FOREST_COPSE: ChunkDef = {
  id: 'forest_copse',
  weight: 4,
  radius: 120,
  biomeMin: 0.42, biomeMax: 1.0,  // birch-spruce → dense forest (wider forest eligibility)
  items: [
    { kind: 'tree', dx:   0, dy:   0, texture: 'tree-spruce',     scale: 2.8, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  60, dy: -20, texture: 'tree-pine',       scale: 2.5, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -55, dy:  10, texture: 'tree-spruce',     scale: 2.6, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  20, dy:  60, texture: 'tree-birch',      scale: 2.4, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -30, dy: -60, texture: 'tree-spruce',     scale: 2.3, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  80, dy:  50, texture: 'tree-birch-2',    scale: 2.4, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -80, dy: -30, texture: 'tree-pine',       scale: 2.5, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'rock', dx:  30, dy:  30, texture: 'rock-grass',      scale: 2.0, colliderWidth: 14, colliderHeight: 8 },
    { kind: 'decoration', dx: -20, dy:  40, texture: 'mushroom',  scale: 1.8 },
    { kind: 'decoration', dx:  50, dy: -40, texture: 'grass-tuft-3', scale: 1.5 },
  ],
};

/** Ring of border trees surrounding a flower meadow — an open clearing */
const CLEARING: ChunkDef = {
  id: 'clearing',
  weight: 3,
  radius: 150,
  biomeMin: 0.30, biomeMax: 0.65,  // coastal heath → birch-spruce
  items: [
    // Border trees
    { kind: 'tree', dx: -100, dy:   0, texture: 'tree-birch',     scale: 2.5, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  100, dy:   0, texture: 'tree-birch-2',   scale: 2.5, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  -60, dy: -80, texture: 'tree-oak',       scale: 2.4, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:   60, dy: -80, texture: 'tree-normal',    scale: 2.6, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  -60, dy:  80, texture: 'tree-oak-small', scale: 2.3, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:   60, dy:  80, texture: 'tree-spruce',    scale: 2.4, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    // Meadow interior — flowers and grass
    { kind: 'decoration', dx:   0, dy:   0, texture: 'flower-1-yellow', scale: 1.6 },
    { kind: 'decoration', dx:  25, dy: -20, texture: 'flower-1-blue',   scale: 1.5 },
    { kind: 'decoration', dx: -30, dy:  15, texture: 'flower-1-red',    scale: 1.5 },
    { kind: 'decoration', dx:  10, dy:  30, texture: 'flower-1-purple', scale: 1.4 },
    { kind: 'decoration', dx: -15, dy: -30, texture: 'grass-tuft-2',    scale: 1.6 },
    { kind: 'decoration', dx:  35, dy:  20, texture: 'grass-tuft-4',    scale: 1.5 },
  ],
};

/**
 * Ruined structure — rocks scattered as if walls have fallen,
 * with flowers growing through the cracks.
 */
const RUINS: ChunkDef = {
  id: 'ruins',
  weight: 2,
  radius: 100,
  biomeMin: 0.65, biomeMax: 1.0,  // forest edge → dense forest
  items: [
    // Scattered rocks suggesting fallen walls
    { kind: 'rock', dx: -50, dy:  -30, texture: 'rock-grass',   scale: 2.2, colliderWidth: 16, colliderHeight: 10 },
    { kind: 'rock', dx:  40, dy:  -40, texture: 'rock-grass',   scale: 2.0, colliderWidth: 14, colliderHeight: 8 },
    { kind: 'rock', dx: -30, dy:   50, texture: 'rock-grass',   scale: 2.4, colliderWidth: 16, colliderHeight: 10 },
    { kind: 'rock', dx:  60, dy:   30, texture: 'rock-grass',   scale: 1.8, colliderWidth: 12, colliderHeight: 8 },
    { kind: 'rock', dx:   0, dy:  -60, texture: 'rock-grass',   scale: 2.0, colliderWidth: 14, colliderHeight: 8 },
    { kind: 'rock', dx:  70, dy:  -20, texture: 'rock-grass',   scale: 2.1, colliderWidth: 14, colliderHeight: 9 },
    // Nature reclaiming the ruin
    { kind: 'decoration', dx:  -10, dy:  10, texture: 'mushroom',       scale: 1.8 },
    { kind: 'decoration', dx:   20, dy: -10, texture: 'flower-1-yellow', scale: 1.4 },
    { kind: 'decoration', dx:  -40, dy:  20, texture: 'mushrooms-red',   scale: 1.6 },
    { kind: 'decoration', dx:   30, dy:  60, texture: 'grass-tuft-1',    scale: 1.5 },
    // A lone surviving tree
    { kind: 'tree', dx: -70, dy: -50, texture: 'tree-oak-small', scale: 2.3, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
  ],
};

/**
 * Watering hole — puddles on grass ringed by trees.
 * Wildlife and the player naturally pause here.
 */
const WATERING_HOLE: ChunkDef = {
  id: 'watering_hole',
  weight: 2,
  radius: 130,
  biomeMin: 0.0, biomeMax: 0.44,  // water → wet shore
  items: [
    // Puddles (no physics — purely visual)
    { kind: 'puddle', dx:   0, dy:   0, texture: 'puddle-grass-1', scale: 2.5 },
    { kind: 'puddle', dx:  30, dy:  15, texture: 'puddle-grass-2', scale: 2.0 },
    { kind: 'puddle', dx: -20, dy:  20, texture: 'puddle-grass-3', scale: 1.8 },
    // Surrounding trees
    { kind: 'tree', dx: -90, dy: -20, texture: 'tree-birch',     scale: 2.5, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  90, dy: -10, texture: 'tree-birch-2',   scale: 2.4, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -40, dy: -80, texture: 'tree-normal',    scale: 2.5, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  50, dy: -80, texture: 'tree-oak',       scale: 2.4, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -70, dy:  60, texture: 'tree-spruce',    scale: 2.3, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  80, dy:  55, texture: 'tree-oak-small', scale: 2.2, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    // Reeds/grass at the water's edge
    { kind: 'decoration', dx:  -15, dy:  35, texture: 'grass-tuft-5', scale: 1.6 },
    { kind: 'decoration', dx:   25, dy:  40, texture: 'grass-tuft-3', scale: 1.5 },
  ],
};

/**
 * FIL-129: Hidden hollow — marks a secret collectible spot.
 * weight:0 = manual placement only via stampSecretAreas().
 * Three trees ring a small clearing; flowers and a mushroom hint at a sheltered,
 * undisturbed place worth stopping at.
 */
export const HIDDEN_HOLLOW: ChunkDef = {
  id: 'hidden_hollow',
  weight: 0,  // manual placement only
  radius: 60,
  items: [
    { kind: 'tree', dx: -50, dy: -20, texture: 'tree-oak-small', scale: 2.2, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  45, dy: -30, texture: 'tree-birch',     scale: 2.1, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -30, dy:  50, texture: 'tree-spruce',    scale: 2.0, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'decoration', dx:   5, dy:   5, texture: 'flower-1-purple', scale: 1.5 },
    { kind: 'decoration', dx: -15, dy:  20, texture: 'mushroom',        scale: 1.4 },
  ],
};

/**
 * FIL-129: Stone waymarker — 2–3 upright rocks placed at zone transition points.
 * weight:0 = manual placement only via stampZoneBoundaries().
 * A cluster of rocks with a grass tuft — like an old trail marker worn down by time.
 */
export const WAYMARKER_STONE: ChunkDef = {
  id: 'waymarker_stone',
  weight: 0,  // manual placement only
  radius: 50,
  items: [
    { kind: 'rock', dx:   0, dy:   0, texture: 'rock-grass', scale: 2.4, colliderWidth: 12, colliderHeight: 10 },
    { kind: 'rock', dx:  30, dy:  15, texture: 'rock-grass', scale: 1.8, colliderWidth: 10, colliderHeight:  8 },
    { kind: 'rock', dx: -25, dy:  20, texture: 'rock-grass', scale: 2.0, colliderWidth: 11, colliderHeight:  8 },
    { kind: 'decoration', dx:  10, dy: -25, texture: 'grass-tuft-3', scale: 1.4 },
  ],
};

/**
 * FIL-128: Corrupted clearing — used only at hand-authored CORRUPTED_LANDMARKS
 * positions (weight 0 means it's never placed by stampProceduralChunks).
 * Rocks and dark mushrooms suggest a "dead zone" where corruption lingers.
 */
export const CORRUPTED_CLEARING: ChunkDef = {
  id: 'corrupted_clearing',
  weight: 0,  // manual placement only
  radius: 80,
  items: [
    { kind: 'rock', dx: -40, dy: -20, texture: 'rock-grass', scale: 2.0, colliderWidth: 14, colliderHeight: 8 },
    { kind: 'rock', dx:  30, dy:  10, texture: 'rock-grass', scale: 1.8, colliderWidth: 12, colliderHeight: 8 },
    { kind: 'rock', dx:   0, dy:  40, texture: 'rock-grass', scale: 2.2, colliderWidth: 14, colliderHeight: 9 },
    { kind: 'rock', dx:  55, dy: -35, texture: 'rock-grass', scale: 1.6, colliderWidth: 10, colliderHeight: 7 },
    { kind: 'decoration', dx:  10, dy: -10, texture: 'mushrooms-red', scale: 1.8 },
    { kind: 'decoration', dx: -20, dy:  20, texture: 'mushroom',      scale: 1.6 },
    { kind: 'decoration', dx:  35, dy:  45, texture: 'grass-tuft-1',  scale: 1.4 },
  ],
};

/**
 * FIL-128: Three hand-placed corrupted landmark positions along the SW→NE corridor.
 * Each gets a CORRUPTED_CLEARING chunk + a dark aura circle to signal "dead zone".
 */
export const CORRUPTED_LANDMARKS: Array<{ x: number; y: number; label: string }> = [
  { x: 1200, y: 2200, label: 'Fallen Grove'    },
  { x: 2600, y: 1800, label: 'Bleached Hollow' },
  { x: 3400, y:  900, label: 'Ash Ring'        },
];

/**
 * Birch shore — open coastal cluster of birch and oak trees with scattered flowers.
 * Appears only in the rocky shore and coastal heath biomes, giving the shoreline
 * distinct character vs the spruce-heavy interior.
 */
const BIRCH_SHORE: ChunkDef = {
  id: 'birch_shore',
  weight: 3,
  radius: 110,
  biomeMin: 0.25, biomeMax: 0.45,
  items: [
    { kind: 'tree', dx:   0, dy:   0, texture: 'tree-birch',     scale: 2.5, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  70, dy: -15, texture: 'tree-birch-2',   scale: 2.3, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -65, dy:  10, texture: 'tree-birch',     scale: 2.4, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  20, dy:  70, texture: 'tree-oak-small', scale: 2.1, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'decoration', dx: -20, dy:  30, texture: 'grass-tuft-5',    scale: 1.6 },
    { kind: 'decoration', dx:  35, dy: -30, texture: 'flower-1-yellow', scale: 1.4 },
    { kind: 'rock', dx: -40, dy: -40, texture: 'rock-grass', scale: 1.8, colliderWidth: 12, colliderHeight: 8 },
  ],
};

/**
 * Spruce highland — dense cluster of spruce and pine in the deep forest / highland edge.
 * Only spawns at higher biome values so it feels like the dark interior of the forest,
 * distinct from the mixed-tree clearings at lower elevations.
 */
const SPRUCE_HIGHLAND: ChunkDef = {
  id: 'spruce_highland',
  weight: 2,
  radius: 100,
  biomeMin: 0.65, biomeMax: 0.90,
  temperatureMin: 0.40,  // warmer highland grows spruce; colder stays bare rock
  items: [
    { kind: 'tree', dx:   0, dy:   0, texture: 'tree-spruce',  scale: 3.0, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  65, dy: -25, texture: 'tree-pine',    scale: 2.8, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -60, dy:  20, texture: 'tree-spruce',  scale: 2.7, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  30, dy:  55, texture: 'tree-pine',    scale: 2.6, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx: -35, dy: -60, texture: 'tree-spruce',  scale: 2.5, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'decoration', dx:  10, dy:  15, texture: 'mushroom',   scale: 1.6 },
    { kind: 'decoration', dx: -25, dy:  40, texture: 'stump-1',    scale: 2.4 },
    { kind: 'rock', dx:  50, dy:  40, texture: 'rock-grass', scale: 2.2, colliderWidth: 14, colliderHeight: 9 },
  ],
};

/**
 * Abandoned camp — remnants of an old hunter's or traveller's camp.
 * Chests (frame 0 = closed state) surrounded by overgrown vegetation.
 * Rare — a special find worth investigating.
 */
const ABANDONED_CAMP: ChunkDef = {
  id: 'abandoned_camp',
  weight: 1,
  radius: 90,
  biomeMin: 0.33, biomeMax: 0.65,
  items: [
    // Two closed chests — frame 0 is the closed state on both sheets
    { kind: 'decoration', dx:  30, dy: -10, texture: 'mw-chest-01', frame: 0, scale: 2.0 },
    { kind: 'decoration', dx: -20, dy:  20, texture: 'mw-chest-02', frame: 0, scale: 2.0 },
    // Nature reclaiming the site
    { kind: 'decoration', dx: -30, dy: -30, texture: 'mushrooms-red',   scale: 1.6 },
    { kind: 'decoration', dx:  40, dy:  40, texture: 'grass-tuft-2',    scale: 1.5 },
    { kind: 'decoration', dx: -55, dy:  35, texture: 'flower-1-purple', scale: 1.4 },
    { kind: 'decoration', dx:  60, dy: -35, texture: 'stump-1',         scale: 2.5 },
    // Shelter trees
    { kind: 'tree', dx: -80, dy: -40, texture: 'tree-birch', scale: 2.4, colliderWidth: 7, colliderHeight: 8, colliderOffsetY: -2 },
    { kind: 'tree', dx:  80, dy:  30, texture: 'tree-oak',   scale: 2.3, colliderWidth: 8, colliderHeight: 8, colliderOffsetY: -2 },
    // Rocks as firepit seats
    { kind: 'rock', dx:  20, dy:  30, texture: 'rock-grass', scale: 1.8, colliderWidth: 10, colliderHeight: 8 },
    { kind: 'rock', dx: -15, dy:  25, texture: 'rock-grass', scale: 1.6, colliderWidth: 10, colliderHeight: 7 },
  ],
};

export const CHUNKS: ChunkDef[] = [FOREST_COPSE, CLEARING, RUINS, WATERING_HOLE, BIRCH_SHORE, SPRUCE_HIGHLAND, ABANDONED_CAMP];

/** How many chunks to place across the world */
export const CHUNK_COUNT = 28;

/**
 * Positions that must remain clear of chunks.
 * Player spawn, portal, and a buffer around the start area.
 */
export const CHUNK_AVOID_ZONES: Array<{ x: number; y: number; r: number }> = [
  { x:  300, y: 2650, r: 220 },  // player spawn (SW)
  { x: 4100, y:  350, r: 160 },  // portal (NE)
  { x:  450, y: 2820, r: 160 },  // Strandviken settlement
  { x: 2300, y: 1400, r: 200 },  // Skogsgläntan settlement
  { x: 3900, y:  620, r: 140 },  // Klippbyn settlement
  { x:  400, y: 2600, r: 120 },  // collectible 1
  { x: 2200, y: 1450, r: 120 },  // collectible 2
  { x: 3900, y:  500, r: 120 },  // collectible 3
  { x:  750, y: 1600, r: 100 },  // FIL-129 secret-1 Vittnesstenen
  { x: 3100, y: 2100, r: 100 },  // FIL-129 secret-2 Ödestornet
];
