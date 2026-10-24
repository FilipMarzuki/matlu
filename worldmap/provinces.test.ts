/**
 * #1904 — provinces outside the Reach: hexes clustered into `OuterProvince`s, seated and grown on
 * the hex graph (docs/spikes/artificer-hex-world.md §7). One test per acceptance scenario.
 *
 * (A test may import from src/ and from macro-world/: tests are not part of worldmap's build, see
 * worldmap/tsconfig.json.)
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { outerProvinces, KNOWN_HEXES, REACH_HEXES, OUTER_HEXES, type OuterCulture } from './provinces';
import { hexDistance, hexKey, hexOfCell, cellsOfHex, type CellXY, type Hex } from './coords';
import { worldCell } from './cells';
import { hexSummary, SETTLE } from './hex-summary';
import { generateReach, REACH_W, REACH_H, type Biome } from './reach';
import { seedOf } from './rng';
import { provincesOf, type Provinces } from '../src/artificer/world/provinces';
import cultures from '../macro-world/cultures.json';

/**
 * The noise rig, for the seat-noise test: while `rig.stream` is set, the generator for that one
 * seed hands out a known sequence instead of mulberry32, and counts its draws. Every other stream
 * (the cells' noise fields, the Reach's own) goes to the real generator untouched, so the rest of
 * this file sees the real world. `vi.hoisted` because `vi.mock` is moved above the imports.
 */
const rig = vi.hoisted(() => ({ stream: undefined as number | undefined, draws: 0 }));
/**
 * The rigged k-th draw: every value 0, 10 … 570 once in 58 draws, in a scrambled order (23 and 58
 * share no factor). Steps of 10 make `0.3 * noise` move a score by at least 3, more than any seat's
 * own score (0 to 1.5), so the noise alone ranks the seats.
 */
const rigged = vi.hoisted(() => (k: number) => 10 * ((23 * k) % 58));
vi.mock('./rng', async importOriginal => {
  const real = await importOriginal<typeof import('./rng')>();
  return {
    ...real,
    generator: (s: number) => (s === rig.stream ? () => rigged(rig.draws++) : real.generator(s)),
  };
});

const CULTURE_IDS = new Set(cultures.cultures.map(c => c.id));

const HW_SEEDS = Array.from({ length: 20 }, (_, i) => seedOf(`hw${i}`));

/** The Reach rectangle's cells belong to the Reach's own provinces, even where an outer hex covers them. */
const inReach = (c: CellXY) => c.cx >= 0 && c.cx < REACH_W && c.cy >= 0 && c.cy < REACH_H;

const byQR = (a: Hex, b: Hex) => a.q - b.q || a.r - b.r;

/**
 * The Reach's provinces as a short digest of what scenario 6 says must not move: each one's id,
 * seat and cells. Hashed the way reach.test.ts hashes its map.
 */
const reachDigest = (ps: Provinces) =>
  createHash('sha256')
    .update(ps.list.map(p => `${p.id} ${p.seat.x},${p.seat.y} ${p.cells.join(',')}`).join('\n'))
    .digest('hex')
    .slice(0, 16);

/**
 * `reachDigest` of `provincesOf(generateReach(seed))` computed on main (a3bd4f69), which has no
 * worldmap/provinces.ts: scenario 6's "same ids, seats and cells as on main", pinned. If one of
 * these moves, something changed the Reach's provinces, which this step must never do.
 */
const REACH_ON_MAIN: Record<string, string> = { 'w-vega': '6c13ca3708fadd10', 'w-astrid': 'd1033e77e36b9b49' };

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
        // "Its cells": the cells of its hexes outside the Reach rectangle. Those inside are a
        // Reach province's, so they don't count towards an outer province's people.
        const biomes = p.hexes.flatMap(h => cellsOfHex(h).filter(c => !inReach(c)).map(c => worldCell(seed, c).biome));
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

      // And the Reach's provinces are unmoved from main, before this module existed: same ids,
      // seats and cells. Compared with values taken from main, not with another call on this
      // branch, which would agree with itself whatever it did.
      expect(reachDigest(after), label).toBe(REACH_ON_MAIN[label]);
    }
  });

  it('seat noise: drawn once per outer hex in (q, r) order, the road hexes (0,5), (0,6), (0,7) in place rather than last', () => {
    const seed = seedOf('w-vega');
    rig.stream = seedOf(`${seed}|hexworld|provinces`);
    rig.draws = 0;
    let seats: Hex[];
    try {
      seats = outerProvinces(seed).map(p => p.seat);
    } finally {
      rig.stream = undefined;
    }
    expect(rig.draws).toBe(58);

    // The rule with that noise: the k-th outer hex in (q, r) order takes the k-th draw; after the
    // road's three, seats go highest noise first, at least 2 hexes apart, up to 19 in all, and
    // only to a hex with a cell outside the Reach that anyone would settle.
    const order = [...OUTER_HEXES].sort(byQR);
    const noise = new Map(order.map((h, k) => [hexKey(h), rigged(k)]));
    const settles = (h: Hex) => cellsOfHex(h).some(c => !inReach(c) && SETTLE[worldCell(seed, c).biome] !== undefined);
    const expected: Hex[] = [{ q: 0, r: 2 }, { q: 0, r: 4 }, { q: 0, r: 6 }];
    for (const h of [...order].sort((a, b) => noise.get(hexKey(b))! - noise.get(hexKey(a))!)) {
      if (expected.length >= 19) break;
      if (expected.some(s => hexDistance(s, h) < 2) || !settles(h)) continue;
      expected.push(h);
    }
    expect(seats!).toEqual(expected);
  });

  it("seat cells: never inside the Reach rectangle (a Reach province's land), always in the seat hex, and hexSummary's seat wherever that lies outside the Reach", () => {
    for (const seed of HW_SEEDS) {
      for (const p of outerProvinces(seed)) {
        const at = `seed ${seed}: ${p.id} at (${p.seat.q},${p.seat.r}), seat cell (${p.seatCell.cx},${p.seatCell.cy})`;
        expect(inReach(p.seatCell), at).toBe(false);
        expect(hexOfCell(p.seatCell), at).toEqual(p.seat);
        const summary = hexSummary(seed, p.seat).seat;
        if (summary && !inReach(summary)) expect(p.seatCell, at).toEqual(summary);
      }
    }
  });

  it('KNOWN_HEXES is 64 hexes (61 within radius 4, plus the 3 road hexes), REACH_HEXES is the 6 given by #1894, and OUTER_HEXES is the other 58', () => {
    expect(KNOWN_HEXES).toHaveLength(64);
    expect(new Set(KNOWN_HEXES.map(hexKey)).size).toBe(64);
    expect(KNOWN_HEXES, 'in (q, r) order').toEqual([...KNOWN_HEXES].sort(byQR));
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
