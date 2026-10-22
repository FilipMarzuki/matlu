/**
 * #1539 — the Reach as a generated map, drawn as text.
 *
 * Phase 1 of the Artificer's generated world (docs/spikes/artificer-generated-world.md): a seeded
 * grid made fresh each run, with no graphics. These tests pin its determinism and keep its land
 * believable across seeds: fells in the north, woods in the valley, rivers that run somewhere.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { seedOf } from '../rng';
import { createExploration, scout } from '../exploration';
import { generateReach, mapRows, sightFor, ringOfHours, describeCell, GLYPH, REACH_W, REACH_H, type Biome, type Reach } from './reach';

const hash = (r: Reach) => createHash('sha256').update(mapRows(r).join('\n')).digest('hex').slice(0, 16);
const share = (r: Reach, ...bs: Biome[]) => r.cells.filter(c => bs.includes(c.biome)).length / r.cells.length;
const SEEDS = Array.from({ length: 20 }, (_, i) => seedOf(`w-test-${i}`));

describe('The Reach as a generated map (#1539)', () => {
  it('makes the same land from the same seed, and different land from another', () => {
    const a = generateReach(seedOf('w-vega'));
    expect(hash(a)).toBe('f9779a07a1a21ff9');
    expect(hash(generateReach(seedOf('w-vega')))).toBe(hash(a));
    expect(hash(generateReach(seedOf('w-astrid')))).toBe('585e1925ea7025e5');
    expect(new Set(SEEDS.map(s => hash(generateReach(s)))).size).toBe(SEEDS.length);
  });

  it('keeps every Reach believable: woods in the valley, fells in the north, some water', () => {
    for (const seed of SEEDS) {
      const r = generateReach(seed);
      expect(r.cells).toHaveLength(REACH_W * REACH_H);
      expect(share(r, 'birch', 'pine'), `woods, seed ${seed}`).toBeGreaterThan(0.25);
      expect(share(r, 'lake', 'river'), `water, seed ${seed}`).toBeGreaterThan(0.03);
      expect(share(r, 'lake', 'river'), `water, seed ${seed}`).toBeLessThan(0.25);
      // The high ground (scree, fell, snow) sits mostly in the northern half.
      const high = r.cells.map((c, i) => ({ c, y: Math.floor(i / r.w) })).filter(({ c }) => c.biome === 'scree' || c.biome === 'fell' || c.biome === 'snow');
      expect(high.length).toBeGreaterThan(0);
      expect(high.reduce((s, { y }) => s + y, 0) / high.length, `upland, seed ${seed}`).toBeLessThan(r.h / 2);
    }
  });

  it('runs every river somewhere: each river cell joins more water or the map edge', () => {
    for (const seed of SEEDS) {
      const r = generateReach(seed);
      const at = (x: number, y: number) => r.cells[y * r.w + x]?.biome;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        if (at(x, y) !== 'river') continue;
        const edge = x === 0 || y === 0 || x === r.w - 1 || y === r.h - 1;
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const b = at(x + dx, y + dy); return b === 'river' || b === 'lake'; });
        expect(edge || wet, `lone river cell at ${x},${y}, seed ${seed}`).toBe(true);
      }
    }
  });

  it('puts camp on walkable land with the rings of a day around it', () => {
    for (const seed of SEEDS) {
      const r = generateReach(seed);
      const camp = r.cells[r.camp.y * r.w + r.camp.x];
      expect(['meadow', 'heath', 'birch', 'pine']).toContain(camp.biome);
      expect(r.hours[r.camp.y * r.w + r.camp.x]).toBe(0);
      // A day's reach (nine hours) covers a good share of the map, and some lies beyond it.
      const day = r.hours.filter(h => h <= 9).length;
      expect(day, `cells within 9h, seed ${seed}`).toBeGreaterThan(150);
      expect(day).toBeLessThan(r.cells.length);
    }
    expect([0, 3, 3.5, 6, 9, 9.5].map(ringOfHours)).toEqual([1, 1, 2, 2, 3, null]);
  });

  it('draws the map as text and hides what the Warden has not seen', () => {
    const r = generateReach(seedOf('w-vega'));
    const all = mapRows(r);
    expect(all).toHaveLength(REACH_H);
    expect(all.every(row => [...row].length === REACH_W)).toBe(true);
    expect(all[r.camp.y][r.camp.x]).toBe(GLYPH.camp);
    const glyphs = new Set(Object.values(GLYPH));
    expect([...all.join('')].every(ch => glyphs.has(ch))).toBe(true);

    // A new Warden sees only what's in view from camp; scouting the near ring opens home ground.
    const fresh = mapRows(r, sightFor(r, createExploration())).join('');
    const scouted = mapRows(r, sightFor(r, scout(createExploration(), 1))).join('');
    const seen = (t: string) => [...t].filter(ch => ch !== GLYPH.unknown).length;
    expect(seen(fresh)).toBeGreaterThan(1);
    expect(seen(scouted)).toBeGreaterThan(seen(fresh));
    expect(seen(scouted)).toBeLessThan(seen(all.join('')));

    expect(describeCell(r, r.camp.x, r.camp.y)).toMatch(/your camp, home ground\. Gives: /);
  });
});
