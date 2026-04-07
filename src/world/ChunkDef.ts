/**
 * ChunkDef — the TypeScript-native hand-authored chunk format (FIL-45).
 *
 * A "chunk" is a small pre-designed cluster of objects stamped into the
 * procedural world at seeded positions. This replaces the need for a full
 * Tiled import in the near term; the format is intentionally compatible with
 * what a Tiled JSON export would produce so the migration path is cheap.
 *
 * ## Object kinds
 *
 * | Kind          | Phaser object created               | Physics             |
 * |---------------|-------------------------------------|---------------------|
 * | `tree`        | SolidObject (placeholder texture)   | StaticBody (trunk)  |
 * | `rock`        | SolidObject (placeholder texture)   | StaticBody          |
 * | `decoration`  | Decoration (tinted __WHITE sprite)  | none                |
 * | `structure`   | Colored rectangle obstacle          | StaticBody          |
 *
 * ## Authoring chunks
 *
 * Positions are relative to the chunk's top-left corner (0,0).
 * The chunk `w`/`h` defines the bounding box used for overlap checks —
 * objects can technically fall outside it, but the stamper won't place
 * another chunk within that bounding box.
 *
 * ## Future: Tiled integration
 *
 * When real Tiled chunks are ready, add a `tiledJsonUrl` field to ChunkDef
 * and write a loader that maps Tiled layer objects to ChunkItems. The
 * stamping logic in GameScene stays unchanged.
 */

export type ChunkItemKind = 'tree' | 'rock' | 'decoration' | 'structure';

export interface ChunkItem {
  kind: ChunkItemKind;
  /** Relative to chunk origin in px */
  x: number;
  y: number;
  /** Width — only used for `structure` kind */
  w?: number;
  /** Height — only used for `structure` kind */
  h?: number;
  /** Fill color override (structures and decorations) */
  color?: number;
}

export interface ChunkDef {
  id: string;
  /** Bounding box width in px — used for overlap checks */
  w: number;
  /** Bounding box height in px — used for overlap checks */
  h: number;
  /**
   * Relative probability weight for random selection.
   * A chunk with weight 4 is twice as likely to be picked as one with weight 2.
   */
  weight: number;
  items: ChunkItem[];
}

// ─── Built-in chunks ─────────────────────────────────────────────────────────

/**
 * A tight cluster of trees forming a natural copse.
 * Most common chunk — appears 4× as often as ruins.
 */
const FOREST_COPSE: ChunkDef = {
  id: 'forest_copse',
  w: 200, h: 200,
  weight: 4,
  items: [
    { kind: 'tree', x: 20,  y: 60  },
    { kind: 'tree', x: 80,  y: 20  },
    { kind: 'tree', x: 160, y: 50  },
    { kind: 'tree', x: 40,  y: 140 },
    { kind: 'tree', x: 120, y: 170 },
    { kind: 'tree', x: 180, y: 120 },
    { kind: 'tree', x: 100, y: 80  },
    { kind: 'rock', x: 90,  y: 130 },
    { kind: 'decoration', x: 70, y: 95,  color: 0x4ab84a }, // grass tuft
    { kind: 'decoration', x: 130, y: 100, color: 0x4ab84a },
  ],
};

/**
 * Partial stone walls — remnants of a building that no longer stands.
 */
const RUINS: ChunkDef = {
  id: 'ruins',
  w: 240, h: 180,
  weight: 2,
  items: [
    // Horizontal wall fragment
    { kind: 'structure', x: 20,  y: 40, w: 80, h: 14, color: 0x7a7265 },
    // Vertical wall fragment
    { kind: 'structure', x: 20,  y: 40, w: 14, h: 90, color: 0x7a7265 },
    // Shorter rubble section
    { kind: 'structure', x: 110, y: 100, w: 60, h: 14, color: 0x6e6860 },
    { kind: 'rock', x: 55,  y: 60  },
    { kind: 'rock', x: 130, y: 50  },
    { kind: 'rock', x: 170, y: 110 },
    { kind: 'tree', x: 185, y: 30  },
    { kind: 'tree', x: 160, y: 145 },
    { kind: 'decoration', x: 75,  y: 80,  color: 0xff88cc }, // flowers in the ruin
    { kind: 'decoration', x: 100, y: 90,  color: 0xff88cc },
    { kind: 'decoration', x: 88,  y: 110, color: 0x4ab84a },
  ],
};

/**
 * Open glade surrounded by trees on all sides — a natural resting place.
 */
const CLEARING: ChunkDef = {
  id: 'clearing',
  w: 200, h: 200,
  weight: 3,
  items: [
    // Border trees on all four sides
    { kind: 'tree', x: 10,  y: 10  },
    { kind: 'tree', x: 180, y: 15  },
    { kind: 'tree', x: 5,   y: 165 },
    { kind: 'tree', x: 175, y: 170 },
    { kind: 'tree', x: 95,  y: 5   },
    { kind: 'tree', x: 5,   y: 90  },
    { kind: 'tree', x: 185, y: 90  },
    // Interior flowers
    { kind: 'decoration', x: 60,  y: 70,  color: 0xff88cc },
    { kind: 'decoration', x: 95,  y: 80,  color: 0xff88cc },
    { kind: 'decoration', x: 130, y: 65,  color: 0xffcc44 }, // yellow flowers
    { kind: 'decoration', x: 80,  y: 120, color: 0xffcc44 },
    { kind: 'rock', x: 115, y: 125 },
  ],
};

/**
 * Small watering hole — a cluster of blue ground tiles hinting at a pond,
 * ringed by trees. Animals will naturally gravitate here.
 */
const WATERING_HOLE: ChunkDef = {
  id: 'watering_hole',
  w: 180, h: 180,
  weight: 2,
  items: [
    // Pond tiles (blue decorations)
    { kind: 'decoration', x: 50, y: 55, color: 0x4a7fbf },
    { kind: 'decoration', x: 78, y: 45, color: 0x5a91cc },
    { kind: 'decoration', x: 108, y: 60, color: 0x4a7fbf },
    { kind: 'decoration', x: 60, y: 85, color: 0x5a91cc },
    { kind: 'decoration', x: 95, y: 90, color: 0x4a7fbf },
    // Ring of trees
    { kind: 'tree', x: 10,  y: 35  },
    { kind: 'tree', x: 145, y: 25  },
    { kind: 'tree', x: 10,  y: 130 },
    { kind: 'tree', x: 148, y: 140 },
    { kind: 'tree', x: 80,  y: 5   },
  ],
};

/** All built-in chunk definitions. Stamper picks from this list using weighted random. */
export const CHUNKS: ChunkDef[] = [FOREST_COPSE, RUINS, CLEARING, WATERING_HOLE];

/** How many chunks to stamp per world. Seeded positions prevent overlap. */
export const CHUNK_COUNT = 14;

/**
 * Zones that chunks must stay clear of.
 * `r` is the minimum distance from the zone centre to the chunk centre.
 */
export const CHUNK_AVOID_ZONES: Array<{ x: number; y: number; r: number }> = [
  { x: 400,  y: 1000, r: 450 }, // player spawn
  { x: 2100, y: 220,  r: 220 }, // portal
  { x: 350,  y: 1020, r: 180 }, // Level 1 — Jordens item
  { x: 980,  y: 830,  r: 180 }, // Level 1 — Spinolandet item
  { x: 2050, y: 430,  r: 180 }, // Level 1 — Vattenpandalandet item
];
