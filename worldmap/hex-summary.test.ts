/**
 * #1898 — hex summaries: a cheap picture of every hex in the known world (radius 4, 61 hexes), read
 * off the world's cell fields (`worldCell`, #1896) with no rivers yet
 * (docs/spikes/artificer-hex-world.md §3 "Eager vs lazy", §6 Views).
 *
 * One test per acceptance scenario that is about summaries (2, 3, 5, 6); the naming scenarios
 * (1, 4) are in hex-names.test.ts. The start hex's summary must agree with the Reach it lies in (2),
 * camp must sit in that hex (3), the seat must be the hex's best cell to settle (5), and summarising
 * the known world must be cheap enough to do on the first view of it (6). A few checks the scenarios
 * lean on follow them: the copy of provinces.ts's SETTLE table, the land names and the hex order.
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect } from 'vitest';
import { hexSummary, summariesAround, KNOWN_RADIUS, SETTLE } from './hex-summary';
import { worldCell } from './cells';
import { cellsOfHex, hexDistance, hexOfCell, packCell, type CellXY } from './coords';
import { generateReach, REACH_W, REACH_H, type Biome } from './reach';
import { seedOf } from './rng';
import { SETTLE as PROVINCE_SETTLE } from '../src/artificer/world/provinces';

const HW_SEEDS = Array.from({ length: 20 }, (_, i) => seedOf(`hw${i}`));

/** The order of the `Biome` union in reach.ts: a tie between two biomes goes to the earlier one. */
const BIOME_ORDER: readonly Biome[] = ['lake', 'river', 'marsh', 'meadow', 'heath', 'birch', 'pine', 'scree', 'fell', 'snow'];

const inReach = (c: CellXY) => c.cx >= 0 && c.cx < REACH_W && c.cy >= 0 && c.cy < REACH_H;

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * How good a cell is to settle, by provinces.ts's own table (the original, not the copy): its
 * SETTLE value, +0.5 with a lake or river among its four world neighbours; -Infinity if it doesn't
 * score at all.
 */
function settleScore(seed: number, c: CellXY): number {
  const base = PROVINCE_SETTLE[worldCell(seed, c).biome];
  if (base === undefined) return -Infinity;
  const water = STEPS.some(([dx, dy]) => {
    const b = worldCell(seed, { cx: c.cx + dx, cy: c.cy + dy }).biome;
    return b === 'lake' || b === 'river';
  });
  return base + (water ? 0.5 : 0);
}

describe('worldmap/hex-summary: what each hex of the known world is like (#1898)', () => {
  it('scenario 2: given any seed, hexSummary(seed, (0,0)) has the most common non-river biome and the min/max height of generateReach(seed).cells at cellsOfHex((0,0)), which lies wholly in the Reach (205/205)', () => {
    const start = cellsOfHex({ q: 0, r: 0 });
    expect(start).toHaveLength(205);
    expect(start.filter(inReach)).toHaveLength(205);

    for (const seed of [seedOf('w-vega'), seedOf('w-astrid'), ...HW_SEEDS]) {
      const reach = generateReach(seed);
      const cells = start.map(c => reach.cells[c.cy * REACH_W + c.cx]);
      const counts = new Map<Biome, number>();
      for (const c of cells) if (c.biome !== 'river') counts.set(c.biome, (counts.get(c.biome) ?? 0) + 1);
      // The most common; strictly more to replace, so a tie keeps the earlier biome in the order.
      let expected: Biome = 'lake', n = -1;
      for (const b of BIOME_ORDER) if ((counts.get(b) ?? 0) > n) { expected = b; n = counts.get(b) ?? 0; }

      const s = hexSummary(seed, { q: 0, r: 0 });
      const counted = [...counts.entries()].map(([b, k]) => `${b} ${k}`).join(', ');
      expect(s.biome, `seed ${seed}: ${counted}`).toBe(expected);
      expect(s.height.min, `seed ${seed}`).toBe(Math.min(...cells.map(c => c.height)));
      expect(s.height.max, `seed ${seed}`).toBe(Math.max(...cells.map(c => c.height)));
    }
  });

  it('scenario 3: given 20 seeds hw0..hw19, hexOfCell(generateReach(seed).camp) is (0,0) for every seed: camp is in the start hex', () => {
    for (const seed of HW_SEEDS) {
      const { camp } = generateReach(seed);
      expect(hexOfCell({ cx: camp.x, cy: camp.y }), `seed ${seed}, camp (${camp.x}, ${camp.y})`).toEqual({ q: 0, r: 0 });
    }
  });

  it("scenario 5: given a summary with a seat, the seat cell's biome is one of meadow, birch, heath, pine, marsh, scree, fell, and no other cell of that hex scores higher", () => {
    const SETTLERS: readonly Biome[] = ['meadow', 'birch', 'heath', 'pine', 'marsh', 'scree', 'fell'];
    let seats = 0;
    const wrong: string[] = [];
    for (const seed of [seedOf('w-vega'), ...HW_SEEDS.slice(0, 5)]) {
      for (const s of summariesAround(seed)) {
        if (!s.seat) continue;
        seats++;
        const where = `seed ${seed}, hex (${s.hex.q}, ${s.hex.r}), seat (${s.seat.cx}, ${s.seat.cy})`;
        const own = cellsOfHex(s.hex);
        if (!own.some(c => c.cx === s.seat?.cx && c.cy === s.seat?.cy)) wrong.push(`${where}: not a cell of the hex`);
        const biome = worldCell(seed, s.seat).biome;
        if (!SETTLERS.includes(biome)) wrong.push(`${where}: biome ${biome}`);
        const best = settleScore(seed, s.seat);
        for (const c of own) {
          const score = settleScore(seed, c);
          if (score > best) wrong.push(`${where}: (${c.cx}, ${c.cy}) scores ${score} > ${best}`);
          // Ties go to the lower packCell, so an equal score elsewhere must be on a higher one.
          if (score === best && packCell(c) < packCell(s.seat)) wrong.push(`${where}: (${c.cx}, ${c.cy}) ties ${score} on a lower packCell`);
        }
      }
    }
    expect(seats).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it('scenario 6: given a warm-up call on one seed, summariesAround for a fresh seed takes under 100 ms', () => {
    summariesAround(seedOf('w-warmup')); // let the JIT warm up first
    const t0 = performance.now();
    const summaries = summariesAround(seedOf('w-timing')); // a seed no other test here uses, so nothing of it is remembered
    const ms = performance.now() - t0;
    console.log(`summariesAround: ${ms.toFixed(1)} ms for ${summaries.length} hexes on a fresh seed`);
    expect(summaries).toHaveLength(61);
    expect(ms).toBeLessThan(100);
  });

  it("SETTLE is provinces.ts's table, copied value for value", () => {
    // worldmap/ may not import from src/, so hex-summary.ts keeps a copy. A copy can drift: this
    // pins it, so a change to one that isn't made to the other fails here.
    expect(SETTLE).toEqual(PROVINCE_SETTLE);
  });

  it("each summary's land follows its biome, and its height and lake count are its cells'", () => {
    const LAND: Readonly<Record<Biome, string>> = {
      fell: 'fells', snow: 'fells', scree: 'heights', pine: 'pinewood', birch: 'birch-valley',
      marsh: 'marsh', lake: 'lakes', meadow: 'meadows', heath: 'heath', river: 'lakes',
    };
    const seed = seedOf('w-vega');
    for (const s of summariesAround(seed)) {
      expect(s.biome, `hex (${s.hex.q}, ${s.hex.r})`).not.toBe('river');
      expect(s.land, `hex (${s.hex.q}, ${s.hex.r}), biome ${s.biome}`).toBe(LAND[s.biome]);
      const cells = cellsOfHex(s.hex).map(c => worldCell(seed, c));
      const heights = cells.map(c => c.height);
      expect(s.height.min).toBe(Math.min(...heights));
      expect(s.height.max).toBe(Math.max(...heights));
      expect(s.height.mean).toBeCloseTo(heights.reduce((a, b) => a + b, 0) / heights.length, 12);
      expect(s.lakeCells).toBe(cells.filter(c => c.biome === 'lake').length);
    }
  });

  it('summariesAround lists every hex within the radius of (0,0) once, in (q, r) order', () => {
    expect(KNOWN_RADIUS).toBe(4);
    const seed = seedOf('w-vega');
    for (const radius of [0, 1, 4]) {
      const hexes = summariesAround(seed, radius).map(s => s.hex);
      expect(hexes, `radius ${radius}`).toHaveLength(1 + 3 * radius * (radius + 1));
      expect(hexes.every(h => hexDistance(h, { q: 0, r: 0 }) <= radius)).toBe(true);
      const sorted = [...hexes].sort((a, b) => a.q - b.q || a.r - b.r);
      expect(hexes).toEqual(sorted);
      expect(new Set(hexes.map(h => `${h.q},${h.r}`)).size).toBe(hexes.length);
    }
    expect(summariesAround(seed, 0)[0].hex).toEqual({ q: 0, r: 0 });
  });
});
