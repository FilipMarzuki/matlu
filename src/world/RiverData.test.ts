/**
 * RiverData unit tests — run with `npm run unit` (Vitest).
 *
 * These tests cover the pure-TypeScript river tracing pipeline:
 * gradient descent → Catmull-Rom smoothing → crossing discovery → tile grids.
 * No Phaser or browser globals required.
 *
 * Key properties verified:
 *  - Every step flows strictly downhill (gradient descent invariant)
 *  - No tile is revisited (visited-set prevents loops on flat terrain)
 *  - River terminates in finite steps
 *  - Bridge/ford crossing indices land within the smoothed-path array
 *  - Ford is upstream (earlier index) of bridge
 *  - Waterfall detections coincide with drops > WATERFALL_THRESHOLD
 *  - Crossing tiles are cleared from the river-tile grid (they stay passable)
 */

import { describe, it, expect } from 'vitest';
import {
  traceRiverPath,
  buildRiverTileGrids,
  WATERFALL_THRESHOLD,
  type DiagonalRiver,
} from './RiverData';

// ─── Synthetic grid helpers ───────────────────────────────────────────────────

/**
 * Elevation grid that decreases diagonally from (0,0) to (tilesX-1, tilesY-1),
 * reaching sea level (~0.2) near the far corner.
 * A source in the NW quadrant will always have lower-elevation neighbours to
 * the SE, so gradient descent flows deterministically toward the SE edge.
 */
function makeDiagonalGrid(tilesX: number, tilesY: number): Float32Array {
  const grid = new Float32Array(tilesX * tilesY);
  const denom = tilesX + tilesY - 2;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      grid[ty * tilesX + tx] = 1.0 - (tx + ty) / denom * 0.8;
    }
  }
  return grid;
}

/**
 * Elevation grid with a gentle rightward slope and a hard cliff at column
 * `cliffCol`.  Left of the cliff: elev = 1.0 − tx×0.02.
 * Right of the cliff: elev = 0.1 (below sea level so descent stops there).
 * A tiny row-based bias (ty×0.001) ensures the river prefers to go right
 * rather than sideways, so it always crosses the cliff.
 */
function makeCliffGrid(tilesX: number, tilesY: number, cliffCol: number): Float32Array {
  const grid = new Float32Array(tilesX * tilesY);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const rowBias = ty * 0.001;
      grid[ty * tilesX + tx] = tx < cliffCol
        ? 1.0 - tx * 0.02 - rowBias
        : 0.1;
    }
  }
  return grid;
}

/** Minimal DiagonalRiver for testing. */
function testRiver(tx = 1, ty = 1): DiagonalRiver {
  return {
    id: 'test',
    sourceTile:  { tx, ty },
    halfWidth:   48,
    bridge: { pathIndex: 0, width: 96  },
    ford:   { pathIndex: 0, width: 128 },
  };
}

// ─── traceRiverPath ───────────────────────────────────────────────────────────

describe('traceRiverPath', () => {
  const TILES_X = 30;
  const TILES_Y = 30;
  const diagonalGrid = makeDiagonalGrid(TILES_X, TILES_Y);

  it('raw path starts at the source tile', () => {
    const result = traceRiverPath(testRiver(2, 3), diagonalGrid, TILES_X, TILES_Y);
    expect(result.rawPath[0].tx).toBe(2);
    expect(result.rawPath[0].ty).toBe(3);
  });

  it('elevation is monotonically non-increasing along the raw path', () => {
    // Each gradient-descent step only moves to a strictly lower neighbour,
    // so elev[i] >= elev[i+1] for all i.  A regression here means the
    // descent is going uphill — physically impossible for a real river.
    const result = traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y);
    const { rawPath } = result;
    for (let i = 1; i < rawPath.length; i++) {
      expect(rawPath[i].elev).toBeLessThanOrEqual(rawPath[i - 1].elev);
    }
  });

  it('no tile is visited twice (no infinite loops)', () => {
    // The visited-set in traceRiverPath prevents cycling on flat terrain.
    // A regression here would hang the game when loading a level.
    const result = traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y);
    const seen = new Set<string>();
    for (const step of result.rawPath) {
      const key = `${step.tx},${step.ty}`;
      expect(seen.has(key), `tile (${step.tx},${step.ty}) revisited`).toBe(false);
      seen.add(key);
    }
  });

  it('terminates and produces a non-empty, finite path', () => {
    const result = traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y);
    expect(result.rawPath.length).toBeGreaterThan(0);
    expect(result.rawPath.length).toBeLessThanOrEqual(TILES_X * TILES_Y);
  });

  it('smoothed points array is proportional in length to raw path', () => {
    // catmullRomSmooth inserts SMOOTH_STEPS=3 points per segment + the final point.
    // So points.length should be roughly rawPath.length × SMOOTH_STEPS.
    const SMOOTH_STEPS = 3;
    const result = traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y);
    const n = result.rawPath.length;
    expect(result.points.length).toBeGreaterThanOrEqual(n);          // at least one per step
    expect(result.points.length).toBeLessThanOrEqual(n * SMOOTH_STEPS + 1);
  });

  it('bridge pathIndex is within the smoothed path bounds', () => {
    const result = traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y);
    expect(result.river.bridge.pathIndex).toBeGreaterThanOrEqual(0);
    expect(result.river.bridge.pathIndex).toBeLessThan(result.points.length);
  });

  it('ford pathIndex is within the smoothed path bounds', () => {
    const result = traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y);
    expect(result.river.ford.pathIndex).toBeGreaterThanOrEqual(0);
    expect(result.river.ford.pathIndex).toBeLessThan(result.points.length);
  });

  it('ford pathIndex ≤ bridge pathIndex (ford is upstream)', () => {
    // Ford is placed ~10 raw steps upstream from the bridge.
    // If ford > bridge, the player would have to swim downstream to reach the ford.
    const result = traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y);
    expect(result.river.ford.pathIndex).toBeLessThanOrEqual(result.river.bridge.pathIndex);
  });

  it('waterfalls are detected when the drop exceeds WATERFALL_THRESHOLD', () => {
    // The cliff grid has a hard drop (≈0.7) at cliffCol=10, well above the
    // 0.12 threshold.  At least one waterfall must be detected as the river
    // crosses the cliff.
    const cliffGrid = makeCliffGrid(TILES_X, TILES_Y, 10);
    const result = traceRiverPath(testRiver(1, Math.floor(TILES_Y / 2)), cliffGrid, TILES_X, TILES_Y);

    expect(result.waterfalls.length).toBeGreaterThan(0);

    for (const { pathIndex } of result.waterfalls) {
      expect(pathIndex).toBeGreaterThanOrEqual(0);
      expect(pathIndex).toBeLessThan(result.rawPath.length);

      const beforeElev = result.rawPath[pathIndex].elev;
      const afterElev  = result.rawPath[pathIndex + 1]?.elev ?? 0;
      expect(beforeElev - afterElev).toBeGreaterThan(WATERFALL_THRESHOLD);
    }
  });

  it('no waterfalls on a smooth gradient (no abrupt drops)', () => {
    // The diagonal grid decreases by ≈0.8/(30+30−2) ≈ 0.014 per step — well
    // below WATERFALL_THRESHOLD (0.12).  No waterfalls should be detected.
    const result = traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y);
    expect(result.waterfalls.length).toBe(0);
  });
});

// ─── buildRiverTileGrids ──────────────────────────────────────────────────────

describe('buildRiverTileGrids', () => {
  const TILES_X = 30;
  const TILES_Y = 30;
  const TILE_SIZE = 32; // must match the constant in RiverData.ts

  const diagonalGrid = makeDiagonalGrid(TILES_X, TILES_Y);
  const traced = [traceRiverPath(testRiver(), diagonalGrid, TILES_X, TILES_Y)];

  it('output arrays have the correct length (tilesX × tilesY)', () => {
    const { isRiverTile, isWaterfallTile } = buildRiverTileGrids(traced, TILES_X, TILES_Y);
    expect(isRiverTile.length).toBe(TILES_X * TILES_Y);
    expect(isWaterfallTile.length).toBe(TILES_X * TILES_Y);
  });

  it('all values are 0 or 1 (valid bitmask)', () => {
    const { isRiverTile } = buildRiverTileGrids(traced, TILES_X, TILES_Y);
    for (const v of isRiverTile) {
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('at least some tiles are marked as river (the path has non-zero width)', () => {
    const { isRiverTile } = buildRiverTileGrids(traced, TILES_X, TILES_Y);
    const riverCount = Array.from(isRiverTile).filter(v => v === 1).length;
    expect(riverCount).toBeGreaterThan(0);
  });

  it('bridge crossing centre tile is NOT a river tile (crossing stays passable)', () => {
    // This is the core gameplay invariant: bridges must always be crossable.
    // If the crossing gap isn't cleared, the player walks into a solid river
    // with no way through — equivalent to an impassable barrier with no bridge.
    const { isRiverTile } = buildRiverTileGrids(traced, TILES_X, TILES_Y);

    const { river, points } = traced[0];
    const bridgePt = points[river.bridge.pathIndex];
    const bridgeTx = Math.floor(bridgePt.x / TILE_SIZE);
    const bridgeTy = Math.floor(bridgePt.y / TILE_SIZE);

    if (bridgeTx >= 0 && bridgeTx < TILES_X && bridgeTy >= 0 && bridgeTy < TILES_Y) {
      expect(isRiverTile[bridgeTy * TILES_X + bridgeTx]).toBe(0);
    }
  });

  it('ford crossing centre tile is NOT a river tile (ford stays passable)', () => {
    const { isRiverTile } = buildRiverTileGrids(traced, TILES_X, TILES_Y);

    const { river, points } = traced[0];
    const fordPt = points[river.ford.pathIndex];
    const fordTx = Math.floor(fordPt.x / TILE_SIZE);
    const fordTy = Math.floor(fordPt.y / TILE_SIZE);

    if (fordTx >= 0 && fordTx < TILES_X && fordTy >= 0 && fordTy < TILES_Y) {
      expect(isRiverTile[fordTy * TILES_X + fordTx]).toBe(0);
    }
  });

  it('empty traced array produces all-zero grids', () => {
    const { isRiverTile, isWaterfallTile } = buildRiverTileGrids([], TILES_X, TILES_Y);
    expect(Array.from(isRiverTile).every(v => v === 0)).toBe(true);
    expect(Array.from(isWaterfallTile).every(v => v === 0)).toBe(true);
  });
});
