/**
 * #1910 — settlements from the shared world: one mapgen settlement at each outer province's seat,
 * drawn at MAPGEN_TILE tiles per grid square (docs/spikes/artificer-hex-world.md §7 "Villages").
 *
 * Exempt (`world`, `art`): the issue's own acceptance is a screenshot, not Given/When/Then. These
 * tests cover the pure logic worldmap/settlements.ts owns — determinism, naming and sizing — the
 * part a screenshot can't check on every seed.
 */

import { describe, it, expect } from 'vitest';
import { settlementForProvince, settlementTileOrigin, MAPGEN_TILE } from './settlements';
import { outerProvinces, type OuterProvince } from './provinces';
import { hexName } from './hex-names';
import { cellOrigin, CELL_TILES } from './coords';
import { seedOf } from './rng';

const HW_SEEDS = Array.from({ length: 10 }, (_, i) => seedOf(`hw${i}`));

/** Every outer province on `seed`, well past the three road seats (h0–h2), the issue's "h3 or later". */
const nonRoadProvinces = (seed: number): OuterProvince[] => outerProvinces(seed).filter(p => p.id !== 'h0' && p.id !== 'h1' && p.id !== 'h2');

describe('worldmap/settlements: settlements from the shared world (#1910)', () => {
  it('scenario 1: given a seed and a province, settlementForProvince called twice deep-equals ("the same seed gives the same village on reload")', () => {
    const seed = seedOf('w-vega');
    for (const p of outerProvinces(seed)) {
      expect(settlementForProvince(seed, p)).toEqual(settlementForProvince(seed, p));
    }
  });

  it('scenario 2: a settlement\'s name is the Artificer\'s own name for its seat hex (hexName)', () => {
    for (const seed of HW_SEEDS) {
      for (const p of outerProvinces(seed)) {
        expect(settlementForProvince(seed, p).name).toBe(hexName(seed, p.seat, 'en'));
      }
    }
  });

  it("scenario 3: a settlement's culture is its province's culture", () => {
    for (const seed of HW_SEEDS) {
      for (const p of outerProvinces(seed)) {
        expect(settlementForProvince(seed, p).culture).toBe(p.culture);
      }
    }
  });

  it('scenario 4: settlementTileOrigin centres the grid on the seat cell\'s centre tile', () => {
    for (const seed of HW_SEEDS.slice(0, 3)) {
      for (const p of nonRoadProvinces(seed)) {
        const settlement = settlementForProvince(seed, p);
        const origin = settlementTileOrigin(p, settlement);
        const seatOrigin = cellOrigin(p.seatCell);
        const mid = Math.floor(settlement.gridSize / 2);
        expect(origin.tx).toBe(seatOrigin.tx + CELL_TILES / 2 - mid * MAPGEN_TILE);
        expect(origin.ty).toBe(seatOrigin.ty + CELL_TILES / 2 - mid * MAPGEN_TILE);
        // Grid square (mid, mid) — where placeBuildings centres its own layout — lands on the
        // seat cell's own centre tile, to the nearest MAPGEN_TILE.
        expect(Math.abs(origin.tx + mid * MAPGEN_TILE - (seatOrigin.tx + CELL_TILES / 2))).toBeLessThan(MAPGEN_TILE);
      }
    }
  });

  it('scenario 5: every settlement has at least one building, sized for a 40–120 m village (a wider margin either side)', () => {
    for (const seed of HW_SEEDS.slice(0, 5)) {
      for (const p of nonRoadProvinces(seed)) {
        const settlement = settlementForProvince(seed, p);
        expect(settlement.buildings.length).toBeGreaterThan(0);
        const spanTiles = settlement.gridSize * MAPGEN_TILE;
        expect(spanTiles).toBeGreaterThan(10);
        expect(spanTiles).toBeLessThan(400);
      }
    }
  });
});
