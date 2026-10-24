/**
 * #1905 — the road and Mistheim on the hex map. One test per acceptance scenario that belongs
 * here (1, 2); scenarios 3-6 live in src/artificer/world/provinces.test.ts and history.test.ts.
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect } from 'vitest';
import { MISTHEIM_HEX, ROAD_HEXES, ROAD_VILLAGE_HEXES, roadVillageProvince } from './road';
import { hexDistance } from './coords';
import { outerProvinces } from './provinces';
import { ROUTE } from '../src/artificer/road';
import { seedOf } from './rng';

const SEEDS = ['w-vega', 'w-astrid', 'w-test-0', 'w-test-1'].map(seedOf);

describe('The road and Mistheim on the hex map (#1905)', () => {
  it('scenario 1: the hex distances between consecutive stops (0,0) -> (0,2) -> (0,4) -> (0,6) -> (0,8) equal ROUTE\'s travel legs\' days in order', () => {
    const stops = [{ q: 0, r: 0 }, ROAD_VILLAGE_HEXES.hollowford, ROAD_VILLAGE_HEXES.saltmere, ROAD_VILLAGE_HEXES['kestrel-gate'], MISTHEIM_HEX];
    const legDays = stops.slice(1).map((s, i) => hexDistance(stops[i], s));
    const routeDays = ROUTE.filter(l => l.kind === 'travel').map(l => l.days);
    expect(legDays).toEqual(routeDays);
    expect(legDays).toEqual([2, 2, 2, 2]);
    // ROAD_HEXES itself is (0,0) through (0,8), in order, one apart.
    expect(ROAD_HEXES).toEqual(Array.from({ length: 9 }, (_, r) => ({ q: 0, r })));
  });

  it('scenario 2: roadVillageProvince(seed, id) returns h0/h1/h2 seated at (0,2)/(0,4)/(0,6), and no outer province contains MISTHEIM_HEX', () => {
    for (const seed of SEEDS) {
      const hollowford = roadVillageProvince(seed, 'hollowford');
      const saltmere = roadVillageProvince(seed, 'saltmere');
      const kestrelGate = roadVillageProvince(seed, 'kestrel-gate');
      expect(hollowford.id).toBe('h0');
      expect(hollowford.seat).toEqual({ q: 0, r: 2 });
      expect(saltmere.id).toBe('h1');
      expect(saltmere.seat).toEqual({ q: 0, r: 4 });
      expect(kestrelGate.id).toBe('h2');
      expect(kestrelGate.seat).toEqual({ q: 0, r: 6 });
      for (const p of outerProvinces(seed)) expect(p.hexes).not.toContainEqual(MISTHEIM_HEX);
    }
  });
});
