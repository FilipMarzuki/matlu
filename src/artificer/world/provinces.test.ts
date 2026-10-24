/**
 * #1905 — provincesOf's `roadAnchors` option: with `hex-world` on, the three road villages move
 * out onto the hex map (worldmap/road.ts), so `placeAnchors` is skipped here. Scenario 3 of #1905;
 * scenarios 1 and 2 are worldmap/road.test.ts, 4-6 are history.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { seedOf } from '../rng';
import { generateReach } from './reach';
import { provincesOf } from './provinces';

const SEEDS = ['w-vega', 'w-astrid'].map(seedOf);

describe("provincesOf's roadAnchors option (#1905)", () => {
  it("scenario 3: given seeds w-vega and w-astrid, provincesOf(reach, { roadAnchors: 'hexes' }) matches provincesOf(reach) in ids, seats and cells, but anchors none and names none Hollowford, Saltmere or Kestrel Gate", () => {
    for (const seed of SEEDS) {
      const reach = generateReach(seed);
      const today = provincesOf(reach);
      const hexes = provincesOf(reach, { roadAnchors: 'hexes' });

      expect(hexes.list.map(p => p.id)).toEqual(today.list.map(p => p.id));
      expect(hexes.list.map(p => p.seat)).toEqual(today.list.map(p => p.seat));
      expect(hexes.list.map(p => p.cells)).toEqual(today.list.map(p => p.cells));
      expect([...hexes.at]).toEqual([...today.at]);

      for (const p of hexes.list) {
        expect(p.anchor).toBeUndefined();
        expect(['Hollowford', 'Saltmere', 'Kestrel Gate']).not.toContain(p.name);
      }
      // Without the option (or with 'reach'), the villages are seated as they are today.
      expect(today.list.some(p => p.anchor === 'hollowford')).toBe(true);
      expect(today.list.some(p => p.anchor === 'saltmere')).toBe(true);
      expect(today.list.some(p => p.anchor === 'kestrel-gate')).toBe(true);
    }
  });
});
