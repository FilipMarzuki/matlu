/**
 * Special places (#1909, plan: docs/spikes/artificer-hex-world.md "Core Warden's maps today").
 * Step 16 of the hex world (#1873).
 *
 * The hand-made levels (`src/world/Level1.ts`–`Level5.ts`, `Spinolandet.ts`, and the GameScene map
 * itself — 141 × 94 tiles, a sliver of one cell) become special places in the world rather than
 * being replaced: the same idea as the Reach patch (`reach.ts`, docs §3 "The start patch"), one
 * level down. Inside a place's rectangle, Core Warden draws its hand-made content; the
 * `BLEND_TILES` tiles around it blend that content into the generated land.
 *
 * Phaser-free, like the rest of `worldmap/`: it imports nothing from `src/`. Drawing the hand-made
 * content and the blend itself is GameScene's job (#1908's window); this module only says where a
 * place is and how far its blend reaches.
 */

import type { Tile } from './coords';

export type SpecialPlaceSource = 'level1' | 'level2' | 'level3' | 'level4' | 'level5' | 'spinolandet';

export interface SpecialPlace {
  id: string;
  /** World tile origin — the place's (0, 0) in window-local coordinates once offset. */
  at: Tile;
  /** Width, in tiles. */
  w: number;
  /** Height, in tiles. */
  h: number;
  source: SpecialPlaceSource;
}

/**
 * Start with Level1 only (levels 2–5 and Spinolandet are later issues, once Level1 looks right).
 *
 * Placed at the origin of Reach cell (20, 21): inside the start hex (`worldmap/coords.ts`
 * `HEX_ORIGIN` sits at cell (24.5, 19.5)). Away from camp by construction, whichever cell camp
 * lands in: `GameScene.createWorldMode` spawns at its cell's *centre* (tile offset 1024, 1024 of
 * the cell's 2048 × 2048), while this rectangle sits in its cell's *origin corner* (tiles 0..140,
 * 0..93) — about 900 tiles short of the centre on both axes even if camp's cell is (20, 21) itself.
 */
export const SPECIAL_PLACES: readonly SpecialPlace[] = [
  { id: 'level1', at: { tx: 20 * 2048, ty: 21 * 2048 }, w: 141, h: 94, source: 'level1' },
];

/** Tiles around a place's rectangle that blend its edge biome into the generated land. */
export const BLEND_TILES = 16;

/** The special place a tile lies in, or null. */
export function specialPlaceAt(tx: number, ty: number): SpecialPlace | null {
  for (const place of SPECIAL_PLACES) {
    if (tx >= place.at.tx && tx < place.at.tx + place.w && ty >= place.at.ty && ty < place.at.ty + place.h) {
      return place;
    }
  }
  return null;
}

/** A tile's distance from a place's rectangle: 0 inside it, else tiles to the nearest edge. */
function edgeDistance(place: SpecialPlace, tx: number, ty: number): number {
  const dx = tx < place.at.tx ? place.at.tx - tx : tx >= place.at.tx + place.w ? tx - (place.at.tx + place.w - 1) : 0;
  const dy = ty < place.at.ty ? place.at.ty - ty : ty >= place.at.ty + place.h ? ty - (place.at.ty + place.h - 1) : 0;
  return Math.max(dx, dy);
}

export interface BlendBand {
  place: SpecialPlace;
  /** The nearest in-place tile, in the place's own local coordinates (0..w-1, 0..h-1). */
  edge: Tile;
  /** Tiles from this tile to the place's rectangle, 1..BLEND_TILES. */
  dist: number;
}

/**
 * The blend band a tile outside every place's rectangle falls in, or null if it's further than
 * `BLEND_TILES` from all of them (or inside one — callers check `specialPlaceAt` first).
 */
export function blendBandAt(tx: number, ty: number): BlendBand | null {
  for (const place of SPECIAL_PLACES) {
    const dist = edgeDistance(place, tx, ty);
    if (dist < 1 || dist > BLEND_TILES) continue;
    const edgeTx = Math.min(Math.max(tx, place.at.tx), place.at.tx + place.w - 1);
    const edgeTy = Math.min(Math.max(ty, place.at.ty), place.at.ty + place.h - 1);
    return { place, edge: { tx: edgeTx - place.at.tx, ty: edgeTy - place.at.ty }, dist };
  }
  return null;
}

/**
 * Whether a blend-band tile at distance `dist` (1..BLEND_TILES) takes the place's edge biome
 * rather than the generated one: `hash(tx, ty) % BLEND_TILES >= dist`, so the chance of keeping
 * the edge biome fades from near-certain right at the rectangle to zero at `BLEND_TILES` out.
 */
export function blendsToPlace(tx: number, ty: number, dist: number): boolean {
  const hash = (Math.imul(tx, 374761393) ^ Math.imul(ty, 668265263)) >>> 0;
  return hash % BLEND_TILES >= dist;
}
