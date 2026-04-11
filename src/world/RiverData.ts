/**
 * River band definitions for Level 1 (FIL-100).
 *
 * Each river is a horizontal strip of water tiles 3 rows (96 px) tall that cuts
 * across the SW→NE diagonal corridor from the mountain zone to the ocean. Two
 * crossing types per river:
 *
 *   - Bridge: a wooden plank platform over the water (full speed).
 *   - Wading ford: open shallow crossing (PathType 'wading', 0.55× speed).
 *
 * RIVER_BRIDGE_POSITIONS is exported for FIL-101 (roads) so the coastal road
 * aligns at each crossing.
 */

/** Must stay in sync with TILE_SIZE in GameScene.ts. */
const TILE_SIZE = 32;

export interface RiverBand {
  /** Centre tile row (ty). World y = tyCentre × TILE_SIZE. */
  tyCentre: number;
  /** Half-width in tile rows. Band spans tyCentre ± halfTiles (2*halfTiles+1 total rows). */
  halfTiles: number;
  /** World-pixel x where the bridge crossing gap begins. */
  bridgeX: number;
  /** Bridge gap width in pixels. */
  bridgeW: number;
  /** World-pixel x where the wading crossing gap begins. */
  wadingX: number;
  /** Wading gap width in pixels. */
  wadingW: number;
}

export const RIVER_BANDS: ReadonlyArray<RiverBand> = [
  {
    // River A — "Southern River", centre at y ≈ 2080 (tyCentre 65).
    // Replaces the tileSprite river visual that was in createNavigationBarrierVisuals().
    // Bridge ford (x 540–668) aligns with dirt-sw-3 path and the original ford gap.
    // Wading ford (x 350–478) adds a second crossing west of the bridge.
    tyCentre: 65,
    halfTiles: 1,
    bridgeX: 540,
    bridgeW: 128,
    wadingX: 350,
    wadingW: 128,
  },
  {
    // River B — mid-corridor river, centre at y ≈ 1504 (tyCentre 47).
    // Sits between the Forest Belt navigation barrier (y 1240–1340) and the
    // Southern River (y 2060–2160), crossing a clean stretch of corridor.
    // Bridge ford (x 1500–1596) aligns with the animal-trail-3 vertical path.
    // Wading ford (x 1700–1828) is east of the bridge.
    tyCentre: 47,
    halfTiles: 1,
    bridgeX: 1500,
    bridgeW: 96,
    wadingX: 1700,
    wadingW: 128,
  },
] as const;

/**
 * World-pixel centre coordinates of each river's bridge crossing.
 * Import in FIL-101 (road generation) to align road segments at crossings.
 */
export const RIVER_BRIDGE_POSITIONS: ReadonlyArray<{ x: number; y: number }> =
  RIVER_BANDS.map(r => ({ x: r.bridgeX + r.bridgeW / 2, y: r.tyCentre * TILE_SIZE }));
