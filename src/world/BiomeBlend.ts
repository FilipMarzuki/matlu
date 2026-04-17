/**
 * BiomeBlend — biome-boundary detection for feathered transition strips.
 *
 * FIL-177: At each tile boundary where two different biomes meet, the
 * higher-priority biome draws a narrow feathered strip on the lower-priority
 * side.  This module handles the pure detection pass; rendering is done in
 * GameScene.drawBiomeBlendStrips(), following the same module + call-site
 * pattern as CliffSystem.ts / drawCliffEdges().
 *
 * ## Priority order
 * Priority is a measure of how visually dominant a biome is.  Higher-priority
 * biomes "bleed" colour into lower-priority neighbours — e.g. forest bleeds
 * into heath, mountain biomes bleed into forest, sea never bleeds into anything.
 * When two biomes share the same priority they are treated as peers and no strip
 * is emitted.
 *
 * ## Boundary directions
 * Only east (→) and south (↓) neighbour pairs are scanned.  Both sides of each
 * shared edge are emitted (one descriptor per tile that sits on the lower-priority
 * side), so the strip always appears on the lower-priority tile regardless of
 * which direction the dominant neighbour lies.
 *
 * ## Terminology
 * "Lower tile"  — the lower-priority tile; it *receives* the blend strip.
 * "Higher tile" — the higher-priority tile; its colour *bleeds* into the lower.
 * "Side"        — which edge of the lower tile the strip is drawn against,
 *                 always the edge that faces the higher-priority neighbour.
 */

/** Priority per biome index (0–10).  Higher value = more visually dominant. */
export const BIOME_PRIORITY: readonly number[] = [
  0,  // 0  Sea           — lowest, never bleeds into anything
  2,  // 1  Rocky shore
  1,  // 2  Sandy shore
  3,  // 3  Marsh / bog
  4,  // 4  Dry heath
  5,  // 5  Coastal heath
  6,  // 6  Forest
  7,  // 7  Spruce
  8,  // 8  Cold granite
  9,  // 9  Bare summit
  10, // 10 Snow field    — highest
];

/**
 * Blend colour per biome index — matches BIOME_OVERLAY_COLORS in GameScene
 * so the feathered strip uses the same hue as the biome colour wash layer.
 */
export const BLEND_COLORS: readonly number[] = [
  0x1a4f7a, // 0  Sea
  0x8b6914, // 1  Rocky shore
  0xe8c870, // 2  Sandy shore
  0x4a7a3a, // 3  Marsh / bog
  0xb8904a, // 4  Dry heath
  0x7a9a3a, // 5  Coastal heath
  0x2a7a2a, // 6  Forest
  0x1a5a1a, // 7  Spruce
  0x7a7a7a, // 8  Cold granite
  0x9a9898, // 9  Bare summit
  0xd8e8f8, // 10 Snow field
];

/**
 * A single detected biome-boundary strip descriptor.
 *
 * Records the lower-priority tile and which of its edges faces the
 * higher-priority neighbour, so the renderer can place a feathered strip
 * without repeating the priority logic.
 */
export interface BiomeBoundary {
  /** Grid column of the lower-priority tile (the one receiving the blend strip). */
  tx: number;
  /** Grid row of the lower-priority tile. */
  ty: number;
  /**
   * Which edge of the lower tile faces the higher-priority neighbour.
   * Determines where along the tile the strip rectangle is placed:
   *   'north' — strip at the top of the tile    (dominant neighbour is above)
   *   'south' — strip at the bottom of the tile (dominant neighbour is below)
   *   'west'  — strip at the left of the tile   (dominant neighbour is to the left)
   *   'east'  — strip at the right of the tile  (dominant neighbour is to the right)
   */
  side: 'north' | 'south' | 'east' | 'west';
  /** Biome index of the higher-priority (bleeding) tile. */
  higherBiome: number;
}

/**
 * Scan the biome index grid and return one BiomeBoundary descriptor for
 * every tile edge where two biomes of different priority meet.
 *
 * Only east (→) and south (↓) neighbour pairs are examined, but both sides
 * of each shared edge are emitted so the strip always lands on the correct
 * (lower-priority) tile.
 *
 * @param biomeIdxGrid  Flat row-major biome indices (0–10), one per tile.
 * @param tilesX        World width in tiles.
 * @param tilesY        World height in tiles.
 */
export function detectBoundaries(
  biomeIdxGrid: Uint8Array,
  tilesX: number,
  tilesY: number,
): BiomeBoundary[] {
  const boundaries: BiomeBoundary[] = [];

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const here      = biomeIdxGrid[ty * tilesX + tx];
      const prioHere  = BIOME_PRIORITY[here];

      // ── East neighbour (tx+1, ty) ────────────────────────────────────────────
      // Check which of the pair is dominant; the lower-priority tile receives
      // a strip on the edge that faces its dominant neighbour.
      if (tx + 1 < tilesX) {
        const east     = biomeIdxGrid[ty * tilesX + (tx + 1)];
        const prioEast = BIOME_PRIORITY[east];
        if (here !== east && prioHere !== prioEast) {
          if (prioHere > prioEast) {
            // Here is dominant → east tile's 'west' edge receives the strip
            boundaries.push({ tx: tx + 1, ty, side: 'west', higherBiome: here });
          } else {
            // East is dominant → here tile's 'east' edge receives the strip
            boundaries.push({ tx, ty, side: 'east', higherBiome: east });
          }
        }
      }

      // ── South neighbour (tx, ty+1) ───────────────────────────────────────────
      if (ty + 1 < tilesY) {
        const south     = biomeIdxGrid[(ty + 1) * tilesX + tx];
        const prioSouth = BIOME_PRIORITY[south];
        if (here !== south && prioHere !== prioSouth) {
          if (prioHere > prioSouth) {
            // Here is dominant → south tile's 'north' edge receives the strip
            boundaries.push({ tx, ty: ty + 1, side: 'north', higherBiome: here });
          } else {
            // South is dominant → here tile's 'south' edge receives the strip
            boundaries.push({ tx, ty, side: 'south', higherBiome: south });
          }
        }
      }
    }
  }

  return boundaries;
}
