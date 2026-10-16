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
  tx: number,
  ty: number,
  isRoad: (tx: number, ty: number) => boolean,
  isWater: (tx: number, ty: number) => boolean,
  isBridgeTile: (tx: number, ty: number) => boolean,
): boolean {
  if (!isRoad(tx, ty) || isBridgeTile(tx, ty)) return false;
  if (!isWater(tx, ty)) return true;
  return (
    isBridgeTile(tx - 1, ty) ||
    isBridgeTile(tx + 1, ty) ||
    isBridgeTile(tx, ty - 1) ||
    isBridgeTile(tx, ty + 1)
  );
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

/**
 * Flood-fills `isDenseCanopy` (4-connected) and blocks every tile in any
 * connected component whose size reaches `minClusterSize`. Smaller patches,
 * and the gaps between clusters, are left untouched so they read as natural
 * clearings/paths through the forest (#935).
 *
 * The caller decides what counts as "dense canopy" (forest blend ≈ 0, high
 * tree-cluster density) and should already exclude roads, water, and other
 * tiles that must stay walkable — this function only grows and thresholds
 * whatever candidate mask it's given.
 */
export function blockDenseForestZones(
  walkGrid:       Uint8Array,
  isDenseCanopy:  Uint8Array,
  gridW:          number,
  gridH:          number,
  minClusterSize: number,
): void {
  const total = gridW * gridH;
  const visited = new Uint8Array(total);
  const component: number[] = [];

  for (let start = 0; start < total; start++) {
    if (isDenseCanopy[start] === 0 || visited[start] === 1) continue;

    component.length = 0;
    visited[start] = 1;
    component.push(start);
    let head = 0;
    while (head < component.length) {
      const idx = component[head++];
      const tx = idx % gridW;
      const ty = Math.floor(idx / gridW);

      const neighbours = [
        ty > 0          ? idx - gridW : -1, // N
        ty < gridH - 1  ? idx + gridW : -1, // S
        tx > 0          ? idx - 1     : -1, // W
        tx < gridW - 1  ? idx + 1     : -1, // E
      ];
      for (const nIdx of neighbours) {
        if (nIdx < 0 || visited[nIdx] === 1 || isDenseCanopy[nIdx] === 0) continue;
        visited[nIdx] = 1;
        component.push(nIdx);
      }
    }

    if (component.length >= minClusterSize) {
      for (const idx of component) walkGrid[idx] = 1;
    }
  }
}
