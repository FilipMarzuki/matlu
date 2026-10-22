/**
 * #1904 — provinces outside the Reach: hexes clustered into `OuterProvince`s, seated and grown on
 * the hex graph (docs/spikes/artificer-hex-world.md §7). One test per acceptance scenario.
 *
 * (A test may import from src/ and from macro-world/: tests are not part of worldmap's build, see
 * worldmap/tsconfig.json.)
 */

import { describe, it, expect } from 'vitest';
import { outerProvinces, KNOWN_HEXES, REACH_HEXES, OUTER_HEXES, type OuterCulture } from './provinces';
import { hexDistance, hexKey, cellsOfHex, type Hex } from './coords';
import { worldCell } from './cells';
import { generateReach, type Biome } from './reach';
import { seedOf } from './rng';
import { provincesOf } from '../src/artificer/world/provinces';
import cultures from '../macro-world/cultures.json';

const CULTURE_IDS = new Set(cultures.cultures.map(c => c.id));

const HW_SEEDS = Array.from({ length: 20 }, (_, i) => seedOf(`hw${i}`));

describe('worldmap/provinces: provinces outside the Reach (#1904)', () => {
  it('scenario 1: given a seed, outerProvinces(seed) called twice deep-equals', () => {
    const seed = seedOf('w-vega');
    expect(outerProvinces(seed)).toEqual(outerProvinces(seed));
  });

  it('scenario 2: given 20 seeds hw0..hw19, every one of the 58 outer hexes appears in exactly one province, and no Reach hex appears in any', () => {
    expect(OUTER_HEXES).toHaveLength(58);
    const reachKeys = new Set(REACH_HEXES.map(hexKey));

    for (const seed of HW_SEEDS) {
      const provinces = outerProvinces(seed);
      const seen = new Map<string, string>();
      for (const p of provinces) {
        for (const h of p.hexes) {
          const key = hexKey(h);
          expect(reachKeys.has(key), `seed ${seed}: province ${p.id} has Reach hex (${h.q},${h.r})`).toBe(false);
          expect(seen.has(key), `seed ${seed}: hex (${h.q},${h.r}) in both ${seen.get(key)} and ${p.id}`).toBe(false);
          seen.set(key, p.id);
        }
      }
      for (const h of OUTER_HEXES) expect(seen.has(hexKey(h)), `seed ${seed}: outer hex (${h.q},${h.r}) unclaimed`).toBe(true);
      expect(seen.size, `seed ${seed}`).toBe(58);
    }
  });

  it('scenario 3: given those provinces, h0/h1/h2 are seated at (0,2)/(0,4)/(0,6), there are at most 19 seats, every pair of seats is >= 2 hexes apart, and each seat hex is in its own province', () => {
    for (const seed of HW_SEEDS) {
      const provinces = outerProvinces(seed);
      const byId = new Map(provinces.map(p => [p.id, p]));
      expect(byId.get('h0')?.seat, `seed ${seed}`).toEqual({ q: 0, r: 2 });
      expect(byId.get('h1')?.seat, `seed ${seed}`).toEqual({ q: 0, r: 4 });
      expect(byId.get('h2')?.seat, `seed ${seed}`).toEqual({ q: 0, r: 6 });

      expect(provinces.length, `seed ${seed}`).toBeLessThanOrEqual(19);

      for (let i = 0; i < provinces.length; i++) {
        for (let j = i + 1; j < provinces.length; j++) {
          const d = hexDistance(provinces[i].seat, provinces[j].seat);
          expect(d, `seed ${seed}: ${provinces[i].id} and ${provinces[j].id} are ${d} apart`).toBeGreaterThanOrEqual(2);
        }
      }

      for (const p of provinces) {
        const own = p.hexes.some(h => h.q === p.seat.q && h.r === p.seat.r);
        expect(own, `seed ${seed}: ${p.id}'s seat (${p.seat.q},${p.seat.r}) not in its own hexes`).toBe(true);
      }
    }
  });

  it("scenario 4: given each province, its culture matches the land-fit rule recomputed from its cells, and the id exists in macro-world/cultures.json", () => {
    const expectedCulture = (biomes: readonly Biome[]): OuterCulture => {
      const share = (...bs: Biome[]) => biomes.filter(b => bs.includes(b)).length / biomes.length;
      if (share('fell', 'snow') >= 0.3) return 'mountainhold';
      if (share('lake', 'marsh') >= 0.25) return 'waterstead';
      if (share('meadow', 'heath') >= 0.4) return 'fieldborn';
      return 'ridgefolk';
    };

    for (const seed of HW_SEEDS) {
      for (const p of outerProvinces(seed)) {
        expect(CULTURE_IDS.has(p.culture), `culture ${p.culture} missing from cultures.json`).toBe(true);
        const biomes = p.hexes.flatMap(h => cellsOfHex(h).map(c => worldCell(seed, c).biome));
        expect(p.culture, `seed ${seed}, ${p.id}`).toBe(expectedCulture(biomes));
      }
    }
  });

  it('scenario 5: given two provinces that share a hex border, neighbors lists each symmetrically, in id order', () => {
    for (const seed of HW_SEEDS.slice(0, 5)) {
      const provinces = outerProvinces(seed);
      const at = new Map<string, string>();
      for (const p of provinces) for (const h of p.hexes) at.set(hexKey(h), p.id);

      const touching = new Map<string, Set<string>>();
      for (const p of provinces) {
        for (const h of p.hexes) {
          for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const) {
            const other = at.get(hexKey({ q: h.q + d[0], r: h.r + d[1] }));
            if (other && other !== p.id) {
              (touching.get(p.id) ?? touching.set(p.id, new Set()).get(p.id)!).add(other);
            }
          }
        }
      }

      for (const p of provinces) {
        const expected = [...(touching.get(p.id) ?? new Set())].sort();
        expect(new Set(p.neighbors), `seed ${seed}, ${p.id}`).toEqual(new Set(expected));
        // Symmetric: every neighbour lists this province back.
        for (const nb of p.neighbors) {
          const other = provinces.find(q => q.id === nb)!;
          expect(other.neighbors, `seed ${seed}: ${p.id} lists ${nb}, but ${nb} doesn't list ${p.id} back`).toContain(p.id);
        }
        // In id order: ascending by the numeric suffix.
        const sorted = [...p.neighbors].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
        expect(p.neighbors, `seed ${seed}, ${p.id}`).toEqual(sorted);
      }
    }
  });

  it("scenario 6: given seeds w-vega and w-astrid, provincesOf(generateReach(seed)) deep-equals before and after calling outerProvinces(seed)", () => {
    for (const label of ['w-vega', 'w-astrid']) {
      const seed = seedOf(label);
      const before = provincesOf(generateReach(seed));
      outerProvinces(seed);
      const after = provincesOf(generateReach(seed));
      expect(after, label).toEqual(before);

      // And the Reach's provinces are unmoved from before this module existed: same ids, seats, cells.
      expect(before.list.map(p => p.id), label).toEqual(before.list.map((_p, i) => `p${i}`));
      expect(before.list.map(p => p.seat), label).toEqual(provincesOf(generateReach(seed)).list.map(p => p.seat));
      expect(before.list.map(p => p.cells), label).toEqual(provincesOf(generateReach(seed)).list.map(p => p.cells));
    }
  });

  it('KNOWN_HEXES is 64 hexes (61 within radius 4, plus the 3 road hexes), REACH_HEXES is the 6 given by #1894, and OUTER_HEXES is the other 58', () => {
    expect(KNOWN_HEXES).toHaveLength(64);
    expect(new Set(KNOWN_HEXES.map(hexKey)).size).toBe(64);
    expect(REACH_HEXES).toHaveLength(6);
    expect(OUTER_HEXES).toHaveLength(58);
    const expectedReach: Hex[] = [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 1 }, { q: 1, r: 0 }];
    expect([...REACH_HEXES].sort((a, b) => a.q - b.q || a.r - b.r))
      .toEqual([...expectedReach].sort((a, b) => a.q - b.q || a.r - b.r));
    for (const h of [{ q: 0, r: 5 }, { q: 0, r: 6 }, { q: 0, r: 7 }]) {
      expect(KNOWN_HEXES.some(k => k.q === h.q && k.r === h.r), `(${h.q},${h.r})`).toBe(true);
    }
  });
});
