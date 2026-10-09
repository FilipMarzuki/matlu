/**
 * RockScatter — deterministic rock/boulder obstacle placement (#937).
 *
 * Pure placement logic, decoupled from Phaser so it can be unit-tested
 * without a scene or browser. The caller (HomesteadScene) supplies grid
 * accessors, then applies the returned placements: mark the footprint
 * blocked in its walkGrid and render a sprite.
 *
 * Same deterministic-hash approach as HomesteadScene's tree scatter — no
 * RNG, so the same grid always produces the same rocks.
 */

export interface RockScatterGrid {
  gridW: number;
  gridH: number;
  /** Elevation at a tile. >= 1 means cliff/granite/summit — not placeable. */
  elevationAt: (tx: number, ty: number) => number;
  /** True if the tile is already impassable (water, cliff, etc.). */
  isBlocked: (tx: number, ty: number) => boolean;
  isRoad: (tx: number, ty: number) => boolean;
  /** True if a building footprint occupies the tile. */
  isOccupied: (tx: number, ty: number) => boolean;
  /** True if a gatherable resource node sits on the tile. */
  isResourceNode: (tx: number, ty: number) => boolean;
  /** True if the tile is within the shore/water-edge band. */
  isNearShore: (tx: number, ty: number) => boolean;
  /** Player spawn tile — kept clear (plus a 1-tile buffer) so rocks can never trap the player. */
  spawnTx: number;
  spawnTy: number;
}

export interface RockPlacement {
  tx: number;
  ty: number;
  /** 1 = small rock (1×1 footprint), 2 = boulder (2×2 footprint). */
  size: 1 | 2;
}

/** Deterministic per-tile hash, same formula as HomesteadScene's tree scatter. */
export function hashTile(a: number, b: number, salt: number): number {
  return (((a * 2654435761 + b * 2246822519 + salt) >>> 0) & 0x7fffffff);
}

/**
 * Decide rock/boulder placements for a grid. Zone-based spawn chance:
 * dense near cliff edges, moderate along the shore, sparse in open meadow.
 */
export function scatterRocks(grid: RockScatterGrid): RockPlacement[] {
  const { gridW, gridH, elevationAt, isBlocked, isRoad, isOccupied, isResourceNode, isNearShore, spawnTx, spawnTy } = grid;

  // Tiles claimed by a placement already decided this pass (boulders are 2×2).
  const claimed = new Set<string>();

  const freeForRock = (tx: number, ty: number): boolean => {
    if (tx < 1 || ty < 1 || tx >= gridW - 1 || ty >= gridH - 1) return false;
    if (Math.abs(tx - spawnTx) <= 1 && Math.abs(ty - spawnTy) <= 1) return false;
    if (isBlocked(tx, ty)) return false;
    if (isRoad(tx, ty)) return false;
    if (isOccupied(tx, ty)) return false;
    if (isResourceNode(tx, ty)) return false;
    if (claimed.has(`${tx},${ty}`)) return false;
    return true;
  };

  const placements: RockPlacement[] = [];

  for (let tx = 1; tx < gridW - 1; tx++) {
    for (let ty = 1; ty < gridH - 1; ty++) {
      if (!freeForRock(tx, ty)) continue;

      // Flat ground only — never place a rock sprite on a cliff/granite tile.
      if (elevationAt(tx, ty) >= 1) continue;

      // Near a cliff / elevation transition: any neighbour tile is raised.
      let nearCliff = false;
      for (let dx = -1; dx <= 1 && !nearCliff; dx++) {
        for (let dy = -1; dy <= 1 && !nearCliff; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = tx + dx, ny = ty + dy;
          if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
            if (elevationAt(nx, ny) > 0) nearCliff = true;
          }
        }
      }

      const nearShore = isNearShore(tx, ty);

      // Zone-based spawn chance — dense near cliffs/shore, sparse in open meadow.
      const chance = nearCliff ? 0.22 : nearShore ? 0.16 : 0.02;
      const roll = (hashTile(tx, ty, 0xD00D) % 1000) / 1000;
      if (roll > chance) continue;

      // Boulders (2×2) are rarer and only cluster near cliff faces.
      const wantsBoulder = nearCliff && (hashTile(tx, ty, 0x5125) % 100) < 25;
      const size: 1 | 2 = wantsBoulder
        && freeForRock(tx + 1, ty) && freeForRock(tx, ty + 1) && freeForRock(tx + 1, ty + 1)
        ? 2 : 1;

      for (let dx = 0; dx < size; dx++) {
        for (let dy = 0; dy < size; dy++) {
          claimed.add(`${tx + dx},${ty + dy}`);
        }
      }
      placements.push({ tx, ty, size });
    }
  }

  return placements;
}
