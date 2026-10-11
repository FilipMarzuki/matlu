/**
 * ElevationWalk unit tests — run with `npm run unit:src` (Vitest).
 * Pure-TypeScript, no Phaser or browser globals required (#936).
 *
 * The issue's acceptance criteria are prose, not Given/When/Then — these
 * tests translate them: "player can walk on highland terrain" (flat
 * elevated tiles are not cliff-blocked), "cliff edges block movement"
 * (the half-tile strip nearest a drop is blocked), and "at least one ramp
 * connects lowland to the highland strip" (a ramp tile bypasses the block
 * and interpolates elevation for a smooth climb).
 */
import { describe, it, expect } from 'vitest';
import {
  cliffDrops,
  isCliffBlocked,
  buildRampSet,
  buildRampMap,
  rampElevation,
  effectiveElevation,
  type RampDef,
} from './ElevationWalk';
import type { IntGridLayer } from './MapData';

/** cols x rows height grid; `elevs` maps "tx,ty" -> elevation, default 0. */
function heightGrid(cols: number, rows: number, elevs: Record<string, number> = {}): IntGridLayer {
  const values = new Array(cols * rows).fill(0);
  for (const [key, e] of Object.entries(elevs)) {
    const [tx, ty] = key.split(',').map(Number);
    values[ty * cols + tx] = e;
  }
  return { identifier: 'HeightMap', cellSize: 32, cols, rows, values };
}

const TILE = 32;
const HALF = 16;

describe('cliffDrops', () => {
  it('given a flat tile with no lower neighbours, when computing drops, then all drops are zero', () => {
    const grid = heightGrid(5, 5, { '2,2': 1, '2,3': 1, '3,2': 1, '1,2': 1 });
    expect(cliffDrops(grid, 2, 2)).toEqual({ south: 0, east: 0, west: 0 });
  });

  it('given a tile one level above its south neighbour, when computing drops, then south drop is 1', () => {
    const grid = heightGrid(5, 5, { '2,2': 1 }); // (2,3) defaults to 0
    expect(cliffDrops(grid, 2, 2).south).toBe(1);
  });

  it('given the homestead/WorldForge seam column, when computing drops, then the west comparison is skipped', () => {
    const grid = heightGrid(5, 5, { '30,2': 2, '29,2': 0 });
    expect(cliffDrops(grid, 30, 2, 30).west).toBe(0);
  });
});

describe('isCliffBlocked', () => {
  it('given a flat elevated tile with no neighbouring drop, when checking any position inside it, then it is not blocked', () => {
    const grid = heightGrid(5, 5, { '2,2': 1, '2,1': 1, '2,3': 1, '1,2': 1, '3,2': 1 });
    const ramps = buildRampSet([]);
    expect(isCliffBlocked(grid, ramps, 2, 2, HALF, HALF, TILE)).toBe(false);
  });

  it('given a tile with a south-facing cliff edge, when standing in its south half, then movement is blocked', () => {
    // East/west neighbours match elevation so only the south drop is live.
    const grid = heightGrid(5, 5, { '2,2': 1, '1,2': 1, '3,2': 1 }); // south neighbour (2,3) is lower
    const ramps = buildRampSet([]);
    expect(isCliffBlocked(grid, ramps, 2, 2, HALF, HALF + 1, TILE)).toBe(true);
  });

  it('given a tile with a south-facing cliff edge, when standing in its north half, then movement is not blocked', () => {
    const grid = heightGrid(5, 5, { '2,2': 1, '1,2': 1, '3,2': 1 });
    const ramps = buildRampSet([]);
    expect(isCliffBlocked(grid, ramps, 2, 2, HALF, HALF - 1, TILE)).toBe(false);
  });

  it('given a ramp tile overlapping a cliff edge, when checking any position inside it, then movement is never blocked', () => {
    const grid = heightGrid(5, 5, { '2,2': 1, '1,2': 1, '3,2': 1 });
    const ramps = buildRampSet([{ tx: 2, ty: 2 }]);
    expect(isCliffBlocked(grid, ramps, 2, 2, HALF, HALF + 1, TILE)).toBe(false);
    expect(isCliffBlocked(grid, ramps, 2, 2, HALF, HALF - 1, TILE)).toBe(false);
  });
});

describe('rampElevation', () => {
  const ramp: RampDef = { tx: 0, ty: 5, fromElev: 0, toElev: 1 };

  it('given a ramp tile, when standing at its low (south) edge, then elevation matches fromElev', () => {
    expect(rampElevation(ramp, TILE, TILE)).toBe(0);
  });

  it('given a ramp tile, when standing at its high (north) edge, then elevation matches toElev', () => {
    expect(rampElevation(ramp, 0, TILE)).toBe(1);
  });

  it('given a ramp tile, when standing halfway up it, then elevation is halfway between the two levels', () => {
    expect(rampElevation(ramp, TILE / 2, TILE)).toBeCloseTo(0.5);
  });
});

describe('effectiveElevation', () => {
  it('given a lowland tile connecting to a highland strip via a ramp, when walking from the ramp base to its top, then elevation climbs smoothly from the lowland to the highland level', () => {
    const grid = heightGrid(1, 7, { '0,4': 1, '0,5': 1 }); // highland rows 0-4, ramp at row 5, lowland row 6
    const ramps = buildRampMap([{ tx: 0, ty: 5, fromElev: 0, toElev: 1 }]);
    const base = effectiveElevation(grid, ramps, 0 * TILE + HALF, 5 * TILE + TILE - 1, TILE);
    const top = effectiveElevation(grid, ramps, 0 * TILE + HALF, 5 * TILE + 1, TILE);
    expect(base).toBeCloseTo(0, 1);
    expect(top).toBeCloseTo(1, 1);
  });
});
