/**
 * #1540 — the Reach's generated history.
 *
 * Phase 2 of the Artificer's generated world (docs/spikes/artificer-generated-world.md): the grid
 * is split into provinces, and the history engine (`storytelling/`) lives through 150 years of
 * them. These tests pin that the same seed always tells the same history, and keep the provinces
 * and the starting world sound across seeds.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { seedOf } from '../rng';
import { generateReach } from './reach';
import { provincesOf } from './provinces';
import { reachSpec, simulateReach, runHistory, eventLogKey, HISTORY_YEARS } from './history';

const SEEDS = Array.from({ length: 12 }, (_, i) => seedOf(`w-test-${i}`));
const logHash = (seed: number) => createHash('sha256').update(eventLogKey(simulateReach(seed).world.events)).digest('hex').slice(0, 16);

describe('The Reach split into provinces (#1540)', () => {
  it('puts every cell in exactly one province, each grown from its own seat in one piece', () => {
    for (const seed of SEEDS) {
      const reach = generateReach(seed);
      const { list, at } = provincesOf(reach);
      expect(list.length, `seed ${seed}`).toBeGreaterThanOrEqual(8);
      expect(list.length, `seed ${seed}`).toBeLessThanOrEqual(12);
      expect([...at].every(p => p >= 0 && p < list.length)).toBe(true);
      expect(list.reduce((s, p) => s + p.cells.length, 0)).toBe(reach.cells.length);
      for (const [k, p] of list.entries()) {
        expect(at[p.seat.y * reach.w + p.seat.x], `${p.name} holds its seat`).toBe(k);
        // In one piece: a flood from the seat through the province's own cells reaches all of them.
        const mine = new Set(p.cells), seen = new Set([p.seat.y * reach.w + p.seat.x]);
        let frontier = [...seen];
        while (frontier.length) {
          const next: number[] = [];
          for (const i of frontier) {
            const x = i % reach.w, y = Math.floor(i / reach.w);
            for (const j of [x > 0 ? i - 1 : -1, x < reach.w - 1 ? i + 1 : -1, y > 0 ? i - reach.w : -1, y < reach.h - 1 ? i + reach.w : -1]) {
              if (j >= 0 && mine.has(j) && !seen.has(j)) { seen.add(j); next.push(j); }
            }
          }
          frontier = next;
        }
        expect(seen.size, `${p.name} is in one piece (seed ${seed})`).toBe(p.cells.length);
      }
    }
  });

  it('gives provinces unique names, borders both ways, and the Reach more than one people', () => {
    for (const seed of SEEDS) {
      const { list } = provincesOf(generateReach(seed));
      expect(new Set(list.map(p => p.name)).size).toBe(list.length);
      // The hand-written places are never reused.
      for (const anchor of ['Hollowford', 'Saltmere', 'Kestrel Gate', 'Mistheim']) expect(list.map(p => p.name)).not.toContain(anchor);
      for (const p of list) {
        expect(p.neighbors.length, `${p.name} has a neighbour`).toBeGreaterThan(0);
        for (const n of p.neighbors) expect(list.find(q => q.id === n)!.neighbors).toContain(p.id);
      }
      expect(new Set(list.map(p => p.culture)).size, `cultures, seed ${seed}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("The Reach's generated history (#1540)", () => {
  it('starts every lordship with a house holding it, under two or three realms', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const reach = generateReach(seed);
      const provinces = provincesOf(reach);
      const spec = reachSpec(reach, provinces);
      const realms = spec.titles.filter(t => t.liege === null);
      expect(realms.length).toBeGreaterThanOrEqual(2);
      expect(realms.length).toBeLessThanOrEqual(3);
      // One title seated in each province, each held by a character of its own house.
      expect(new Set(spec.titles.map(t => t.seat))).toEqual(new Set(provinces.list.map(p => p.id)));
      for (const t of spec.titles) {
        const holder = spec.characters.find(c => c.holds === t.id);
        expect(holder, t.name).toBeDefined();
        expect(spec.dynasties.find(d => d.id === holder!.dynasty)?.culture).toBe(provinces.list.find(p => p.id === t.seat)!.culture);
      }
      // Parents come before their children (the engine creates them in order).
      spec.characters.forEach((c, i) => {
        for (const parent of [c.father, c.mother]) if (parent) expect(spec.characters.findIndex(p => p.id === parent)).toBeLessThan(i);
      });
    }
  });

  // The pin moves when the generator or the engine changes what happens: a change to the grid, the
  // provinces or the houses, or to storytelling/'s random stream (when its golden hashes in
  // testkit.ts are rebaselined, rebaseline this too). Bump HISTORY_VERSION with it, so a kept
  // history from the old code is told again.
  it('tells the same history from the same seed, and a different one from another', () => {
    const a = logHash(seedOf('w-vega'));
    expect(a).toBe('ba3826528d478d00');
    expect(logHash(seedOf('w-vega'))).toBe(a);
    expect(logHash(seedOf('w-astrid'))).not.toBe(a);
  });

  it('writes the history up: a chronicle, and what happened in each province', () => {
    const h = runHistory(seedOf('w-vega'));
    expect(h.year).toBe(HISTORY_YEARS + 1);
    expect(h.told).toBeGreaterThan(100);
    expect(h.chronicle).toContain('THE CHRONICLE');
    expect(h.chronicle).toContain('LIVING MEMORY');
    // Most provinces have something to remember, and every line names a year in the history.
    expect(h.provinces.filter(p => p.lines.length > 0).length).toBeGreaterThan(h.provinces.length / 2);
    for (const p of h.provinces) {
      expect(p.title).toContain(p.name);
      for (const l of p.lines) expect(l.year).toBeGreaterThanOrEqual(1);
    }
    // Plain data: it survives the trip from the worker and back out of storage unchanged.
    expect(JSON.parse(JSON.stringify(h))).toEqual(h);
  });
});
