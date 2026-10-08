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
