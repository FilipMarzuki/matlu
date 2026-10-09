/**
 * CollisionGrid — pure helpers for building/adjusting walk grids used by
 * HomesteadScene. No Phaser or browser globals required.
 */
import { intGridGet, type IntGridLayer } from './MapData';

/**
 * Mutates `walkGrid` in place: blocks any currently-walkable tile that has a
 * water tile (Biome === 0) among its 8 neighbours.
 *
 * The Collision layer's blocked zone doesn't perfectly line up with the
 * Biome layer's water tiles (an SE-offset artifact from how the map was
 * authored), so without this buffer the player can wade a few pixels into
 * the visual shoreline before colliding (#938).
 */
export function bufferShoreline(walkGrid: Uint8Array, biomeGrid: IntGridLayer): void {
  const gridW = biomeGrid.cols;
  const gridH = biomeGrid.rows;
  for (let ty = 0; ty < gridH; ty++) {
    for (let tx = 0; tx < gridW; tx++) {
      const i = ty * gridW + tx;
      if (walkGrid[i] === 1) continue; // already blocked

      let touchesWater = false;
      for (let dy = -1; dy <= 1 && !touchesWater; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
          if (intGridGet(biomeGrid, nx, ny) === 0) { touchesWater = true; break; }
        }
      }
      if (touchesWater) walkGrid[i] = 1;
    }
  }
}

/**
 * Whether a road tile's overlay sprite should render despite the Biome layer
 * classifying it as water (#931).
 *
 * The A* road path and the Biome layer disagree right at a river crossing:
 * tiles the path treats as ordinary walkable ground can still carry the
 * Biome layer's water id, because the biome band is baked slightly wider
 * than the river's actual crossable band. Skipping the overlay on every
 * water-classified tile (the old behaviour) left a 1-tile visual gap where
 * the road touches the bridge. Bank tiles immediately beside a bridge tile
 * are the only water-classified tiles on the road path that are actually
 * walkable ground, so only they get the exception.
 */
export function roadOverlayVisible(
  _tx: number,
  _ty: number,
  _isRoad: (tx: number, ty: number) => boolean,
  _isWater: (tx: number, ty: number) => boolean,
  _isBridgeTile: (tx: number, ty: number) => boolean,
): boolean {
  throw new Error('not implemented');
}

export type TreeSize = 'mature' | 'young' | 'sapling';

/**
 * Mutates `walkGrid` in place: blocks the footprint of a tree planted at
 * (tx, ty) so the player can't walk through it (#934).
 *
 * Mature trees take a 2×2 footprint (trunk plus a 1-tile buffer so the
 * player doesn't clip through the canopy sprite). Young trees block only
 * their own tile. Saplings are decorative and stay walkable.
 */
export function blockTreeFootprint(
  walkGrid: Uint8Array,
  gridW: number,
  gridH: number,
  tx: number,
  ty: number,
  size: TreeSize,
): void {
  if (size === 'sapling') return;
  walkGrid[ty * gridW + tx] = 1;
  if (size !== 'mature') return;
  if (tx + 1 < gridW) walkGrid[ty * gridW + (tx + 1)] = 1;
  if (ty + 1 < gridH) walkGrid[(ty + 1) * gridW + tx] = 1;
  if (tx + 1 < gridW && ty + 1 < gridH) walkGrid[(ty + 1) * gridW + (tx + 1)] = 1;
}
