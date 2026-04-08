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

export const CHUNKS: ChunkDef[] = [FOREST_COPSE, CLEARING, RUINS, WATERING_HOLE];

/** How many chunks to place across the world */
export const CHUNK_COUNT = 28;

/**
 * Positions that must remain clear of chunks.
 * Player spawn, portal, and a buffer around the start area.
 */
export const CHUNK_AVOID_ZONES: Array<{ x: number; y: number; r: number }> = [
  { x:  400, y: 1000, r: 200 },  // player spawn
  { x: 2100, y:  220, r: 150 },  // portal
  { x:  800, y:  800, r: 160 },  // collectible zone 1
  { x: 1400, y:  600, r: 160 },  // collectible zone 2
  { x: 1900, y:  400, r: 160 },  // collectible zone 3
];
