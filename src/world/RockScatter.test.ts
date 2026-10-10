import { describe, it, expect } from 'vitest';
import { scatterRocks, type RockScatterGrid } from './RockScatter';

const GRID_W = 60;
const GRID_H = 60;

/** Build a default all-clear, all-meadow grid; override accessors per test. */
function makeGrid(overrides: Partial<RockScatterGrid> = {}): RockScatterGrid {
  return {
    gridW: GRID_W,
    gridH: GRID_H,
    elevationAt: () => 0,
    isBlocked: () => false,
    isRoad: () => false,
    isOccupied: () => false,
    isResourceNode: () => false,
    isNearShore: () => false,
    spawnTx: 15,
    spawnTy: 20,
    ...overrides,
  };
}

describe('scatterRocks', () => {
  it('given every tile marked as a road, when scattering rocks, then no rock spawns on any tile', () => {
    const grid = makeGrid({ isRoad: () => true });
    expect(scatterRocks(grid)).toHaveLength(0);
  });

  it('given every tile marked as a building footprint, when scattering rocks, then no rock spawns on any tile', () => {
    const grid = makeGrid({ isOccupied: () => true });
    expect(scatterRocks(grid)).toHaveLength(0);
  });

  it('given every tile marked as a resource node, when scattering rocks, then no rock spawns on any tile', () => {
    const grid = makeGrid({ isResourceNode: () => true });
    expect(scatterRocks(grid)).toHaveLength(0);
  });

  it('given every tile already blocked (water/cliff), when scattering rocks, then no rock spawns on any tile', () => {
    const grid = makeGrid({ isBlocked: () => true });
    expect(scatterRocks(grid)).toHaveLength(0);
  });

  it('given a tile with elevation >= 1 (rock/granite/summit floor), when scattering rocks, then no rock spawns there even if unblocked', () => {
    const grid = makeGrid({ elevationAt: () => 1 });
    expect(scatterRocks(grid)).toHaveLength(0);
  });

  it('given the player spawn tile and its 1-tile buffer, when scattering rocks near a cliff, then the spawn area always stays clear so the player can never be trapped', () => {
    // Force every tile to be "near a cliff" (high chance) by raising every
    // other tile's elevation, maximizing pressure on the spawn buffer.
    const grid = makeGrid({
      elevationAt: (tx, ty) => ((tx + ty) % 2 === 0 ? 1 : 0),
      spawnTx: 15,
      spawnTy: 20,
    });
    const placements = scatterRocks(grid);
    for (const p of placements) {
      for (let dx = 0; dx < p.size; dx++) {
        for (let dy = 0; dy < p.size; dy++) {
          const tx = p.tx + dx, ty = p.ty + dy;
          const withinBuffer = Math.abs(tx - 15) <= 1 && Math.abs(ty - 20) <= 1;
          expect(withinBuffer).toBe(false);
        }
      }
    }
  });

  it('given identical grid inputs, when scattering rocks twice, then the placements are identical (deterministic, no RNG)', () => {
    const grid = makeGrid({
      elevationAt: (tx) => (tx > 40 ? 1 : 0),
      isNearShore: (_tx, ty) => ty > 45,
    });
    expect(scatterRocks(grid)).toEqual(scatterRocks(grid));
  });

  it('given a band of tiles adjacent to an elevation transition (cliff edge) and a plain meadow band, when scattering rocks, then the cliff-adjacent band has a higher rock density — rocks are visible near cliffs', () => {
    // Raised terrain for tx >= 40 (cliff). tx 35-39 sit directly beside it
    // (nearCliff=true). tx 5-34 are plain meadow, far from any elevation
    // change or shore.
    const grid = makeGrid({
      elevationAt: (tx) => (tx >= 40 ? 2 : 0),
    });
    const placements = scatterRocks(grid);
    const cliffBand = placements.filter(p => p.tx >= 35 && p.tx <= 39);
    const meadowBand = placements.filter(p => p.tx >= 5 && p.tx <= 34);

    const cliffDensity = cliffBand.length / (5 * GRID_H);
    const meadowDensity = meadowBand.length / (30 * GRID_H);

    expect(cliffDensity).toBeGreaterThan(meadowDensity);
    expect(cliffBand.length).toBeGreaterThan(0);
  });

  it('given a shore band and a plain meadow band, when scattering rocks, then the shore band has a higher rock density — rocks are visible along the shore', () => {
    const grid = makeGrid({
      isNearShore: (_tx, ty) => ty >= 45 && ty <= 47,
    });
    const placements = scatterRocks(grid);
    const shoreBand = placements.filter(p => p.ty >= 45 && p.ty <= 47);
    const meadowBand = placements.filter(p => p.ty >= 5 && p.ty <= 40);

    const shoreDensity = shoreBand.length / (3 * GRID_W);
    const meadowDensity = meadowBand.length / (36 * GRID_W);

    expect(shoreDensity).toBeGreaterThan(meadowDensity);
    expect(shoreBand.length).toBeGreaterThan(0);
  });

  it('given rocks have been placed, when inspecting every placement footprint, then no two placements claim the same tile (player always has a path around, never two overlapping obstacles)', () => {
    const grid = makeGrid({
      elevationAt: (tx, ty) => ((tx * 7 + ty * 13) % 5 === 0 ? 1 : 0),
    });
    const placements = scatterRocks(grid);

    const claimedCells = new Set<string>();
    for (const p of placements) {
      for (let dx = 0; dx < p.size; dx++) {
        for (let dy = 0; dy < p.size; dy++) {
          const key = `${p.tx + dx},${p.ty + dy}`;
          expect(claimedCells.has(key)).toBe(false);
          claimedCells.add(key);
        }
      }
    }
  });

  it('given a road running through a would-be boulder footprint, when scattering rocks, then no placement overlaps the road — rocks never block the road', () => {
    // Road at tx=36 the entire height; cliff at tx>=40 drives boulder chance up.
    const grid = makeGrid({
      elevationAt: (tx) => (tx >= 40 ? 2 : 0),
      isRoad: (tx) => tx === 36,
    });
    const placements = scatterRocks(grid);
    for (const p of placements) {
      for (let dx = 0; dx < p.size; dx++) {
        expect(p.tx + dx).not.toBe(36);
      }
    }
  });
});
