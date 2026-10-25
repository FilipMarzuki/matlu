/**
 * #1897 — rivers across hexes: springs in each hex, traced downhill over the world's height, and a
 * hex's full cells with every river that crosses it (docs/spikes/artificer-hex-world.md §3,
 * "Rivers"). Step 4 of the hex world (#1873).
 *
 * One test per acceptance scenario. A hex must look the same however you reached it (1). Every
 * trace must be a real river course (2) that stays within RIVER_RADIUS hexes of its spring (3), so
 * a hex can find every river that reaches it. The Reach must come through untouched (4), and its
 * rivers must carry on past its edge (5). Springs must be pure and sit on high ground (6).
 *
 * #1964 adds lakes near the start: a trace that would have to climb pools in the hollow it's in
 * instead. The `#1964 criterion N` tests below map to that issue's own numbered acceptance
 * criteria, not #1897's "scenario N" ones above.
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { RIVER_MAX, RIVER_RADIUS, POOL_MAX, springsOfHex, edgeSprings, traceRiver, hexCells } from './rivers';
import { worldCell } from './cells';
import { generateReach, REACH_W, REACH_H } from './reach';
import { HEX_DIRS, hexDistance, hexOfCell, packCell, type CellXY, type Hex } from './coords';
import { seedOf } from './rng';
import { mapRows } from '../src/artificer/world/reach';

const HW_SEEDS = Array.from({ length: 20 }, (_, i) => seedOf(`hw${i}`));
const ENDS = ['lake', 'reach', 'tarn', 'max', 'pool'];

const inReach = (c: CellXY) => c.cx >= 0 && c.cx < REACH_W && c.cy >= 0 && c.cy < REACH_H;

/** Every hex within `radius` of (0,0), in a fixed order (q, then r). */
function hexesWithin(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++)
    for (let r = -radius; r <= radius; r++) if (hexDistance({ q, r }, { q: 0, r: 0 }) <= radius) out.push({ q, r });
  return out;
}

/** The springs scenarios 2 and 3 examine for a seed: those of every hex within 3 of (0,0), then the Reach's edge springs. */
const springsNearStart = (seed: number): CellXY[] => [...hexesWithin(3).flatMap(h => springsOfHex(seed, h)), ...edgeSprings(seed)];

/**
 * The cell just outside the Reach across the edge a border cell lies on (the y edge at a corner),
 * worked out here from the Reach itself rather than read from `edgeSprings`.
 */
function outsideAcross(x: number, y: number): CellXY {
  if (y === 0) return { cx: x, cy: -1 };
  if (y === REACH_H - 1) return { cx: x, cy: REACH_H };
  if (x === 0) return { cx: -1, cy: y };
  return { cx: REACH_W, cy: y };
}

/** The Reach's river cells on its border, as their outside neighbours. */
function borderRiversOut(seed: number): CellXY[] {
  const reach = generateReach(seed);
  const out: CellXY[] = [];
  for (let y = 0; y < REACH_H; y++)
    for (let x = 0; x < REACH_W; x++) {
      const onBorder = x === 0 || y === 0 || x === REACH_W - 1 || y === REACH_H - 1;
      if (onBorder && reach.cells[y * REACH_W + x].biome === 'river') out.push(outsideAcross(x, y));
    }
  return out;
}

/** A cell's land, read through `hexCells` of the hex that owns it. */
function landAt(seed: number, c: CellXY) {
  const hex = hexCells(seed, hexOfCell(c));
  const i = hex.cells.findIndex(o => o.cx === c.cx && o.cy === c.cy);
  expect(i, `(${c.cx}, ${c.cy}) is a cell of its own hex`).toBeGreaterThanOrEqual(0);
  return hex.land[i];
}

describe('worldmap/rivers: rivers across hexes (#1897)', () => {
  it("scenario 1: given a seed and H = (2, 1), hexCells(seed, H) from an empty cache deep-equals hexCells(seed, H) after clearing the cache and computing H's six neighbours first", async () => {
    const H: Hex = { q: 2, r: 1 };
    // A fresh copy of the module each time, so every cache in it (and in cells.ts) starts empty.
    const fresh = async () => {
      vi.resetModules();
      return import('./rivers');
    };
    for (const name of ['w-vega', 'w-astrid']) {
      const seed = seedOf(name);

      const m1 = await fresh();
      const first = m1.hexCells(seed, H);

      const m2 = await fresh();
      for (const d of Object.values(HEX_DIRS)) m2.hexCells(seed, { q: H.q + d.q, r: H.r + d.r });
      const second = m2.hexCells(seed, H);

      expect(second, name).toEqual(first);
      // Not vacuous: H has its cells, one land cell each.
      expect(first.cells.length, name).toBeGreaterThan(200);
      expect(first.land).toHaveLength(first.cells.length);
    }
  });

  it('scenario 2: given 20 seeds, every trace from springsOfHex (hexes within 3 of (0,0)) and edgeSprings ends in lake, reach, tarn, pool or max, holds at most 60 cells, is 4-connected, visits no cell twice and has no cell inside the Reach', () => {
    expect(RIVER_MAX).toBe(60);
    let traces = 0;
    for (const seed of HW_SEEDS) {
      for (const spring of springsNearStart(seed)) {
        const { cells, end } = traceRiver(seed, spring);
        const at = `seed ${seed}, spring (${spring.cx}, ${spring.cy})`;
        traces++;
        expect(ENDS, at).toContain(end);
        expect(cells.length, at).toBeGreaterThanOrEqual(1);
        expect(cells.length, at).toBeLessThanOrEqual(RIVER_MAX);
        expect(cells[0], at).toEqual(spring);
        for (let i = 1; i < cells.length; i++) {
          const step = Math.abs(cells[i].cx - cells[i - 1].cx) + Math.abs(cells[i].cy - cells[i - 1].cy);
          expect(step, `${at}: step ${i}`).toBe(1);
        }
        expect(new Set(cells.map(packCell)).size, at).toBe(cells.length);
        for (const c of cells) expect(inReach(c), `${at}: (${c.cx}, ${c.cy}) in the Reach`).toBe(false);
      }
    }
    expect(traces).toBeGreaterThan(0);
  });

  it("scenario 3: given those traces, the hex distance from each spring's hex to each of its cells' hexes never exceeds RIVER_RADIUS (4)", () => {
    expect(RIVER_RADIUS).toBe(4);
    for (const seed of HW_SEEDS) {
      for (const spring of springsNearStart(seed)) {
        const home = hexOfCell(spring);
        let farthest = 0;
        for (const c of traceRiver(seed, spring).cells) farthest = Math.max(farthest, hexDistance(home, hexOfCell(c)));
        expect(farthest, `seed ${seed}, spring (${spring.cx}, ${spring.cy})`).toBeLessThanOrEqual(RIVER_RADIUS);
      }
    }
  });

  it('scenario 4: given w-vega and w-astrid, hexCells for every hex overlapping the Reach gives every cell inside the Reach exactly as generateReach(seed).cells', () => {
    for (const name of ['w-vega', 'w-astrid']) {
      const seed = seedOf(name);
      const reach = generateReach(seed);
      // The hexes overlapping the Reach: the owners of its cells, each once, in a fixed order.
      const hexes = new Map<string, Hex>();
      for (let cy = 0; cy < REACH_H; cy++)
        for (let cx = 0; cx < REACH_W; cx++) {
          const h = hexOfCell({ cx, cy });
          hexes.set(`${h.q},${h.r}`, h);
        }
      let seen = 0;
      for (const h of hexes.values()) {
        const { cells, land } = hexCells(seed, h);
        cells.forEach((c, i) => {
          if (!inReach(c)) return;
          seen++;
          expect(land[i], `${name} (${c.cx}, ${c.cy})`).toEqual(reach.cells[c.cy * REACH_W + c.cx]);
        });
      }
      expect(seen, name).toBe(REACH_W * REACH_H);
    }
  });

  it("scenario 5: given a seed whose Reach has a river cell on its border, the outside neighbour across that edge is river or lake through hexCells", () => {
    // Every seed among the 20 that has one, and every such cell in it.
    const found = HW_SEEDS.map(seed => ({ seed, outs: borderRiversOut(seed) })).filter(s => s.outs.length > 0);
    expect(found.length, 'a seed among hw0…hw19 with a river on its border').toBeGreaterThan(0);
    for (const { seed, outs } of found)
      for (const c of outs) expect(['river', 'lake'], `seed ${seed}, (${c.cx}, ${c.cy})`).toContain(landAt(seed, c).biome);
  });

  it("#1963: given 20 seeds, every step of every trace from springsOfHex (hexes within 3 of (0,0)) classified by direction goes south at most 50% of the time", () => {
    let south = 0, steps = 0;
    for (const seed of HW_SEEDS) {
      for (const h of hexesWithin(3)) {
        for (const spring of springsOfHex(seed, h)) {
          const { cells } = traceRiver(seed, spring);
          for (let i = 1; i < cells.length; i++) {
            steps++;
            if (cells[i].cy - cells[i - 1].cy === 1) south++;
          }
        }
      }
    }
    expect(steps).toBeGreaterThan(0);
    expect(south / steps).toBeLessThanOrEqual(0.5);
  });

  it('scenario 6: given the same seed and hex, springsOfHex twice gives identical springs: 0–3 of them, all scree or fell, outside the Reach', () => {
    let some = 0;
    for (const seed of HW_SEEDS)
      for (const h of hexesWithin(3)) {
        const at = `seed ${seed}, hex (${h.q}, ${h.r})`;
        const a = springsOfHex(seed, h);
        const b = springsOfHex(seed, h);
        expect(b, at).toEqual(a);
        expect(a.length, at).toBeLessThanOrEqual(3);
        for (const s of a) {
          expect(['scree', 'fell'], `${at}: (${s.cx}, ${s.cy})`).toContain(worldCell(seed, s).biome);
          expect(inReach(s), `${at}: (${s.cx}, ${s.cy}) in the Reach`).toBe(false);
          expect(hexOfCell(s), `${at}: (${s.cx}, ${s.cy}) is the hex's own cell`).toEqual(h);
        }
        expect(new Set(a.map(packCell)).size, `${at}: no spring twice`).toBe(a.length);
        some += a.length;
      }
    // Not vacuous: some hexes near the start have springs.
    expect(some).toBeGreaterThan(0);
  });

  it('#1964 criterion 1: given the 20 seeds, lake is 1–35% of each seed’s cells in hexes within 2 of (0,0) outside the Reach', () => {
    for (const seed of HW_SEEDS) {
      let lake = 0, total = 0;
      for (const h of hexesWithin(2)) {
        const { cells, land } = hexCells(seed, h);
        cells.forEach((c, i) => {
          if (inReach(c)) return;
          total++;
          if (land[i].biome === 'lake') lake++;
        });
      }
      const at = `seed ${seed}`;
      expect(total, at).toBeGreaterThan(0);
      const pct = (lake / total) * 100;
      expect(pct, at).toBeGreaterThanOrEqual(1);
      expect(pct, at).toBeLessThanOrEqual(35);
    }
  });

  it('#1964 criterion 2: given every trace from springsOfHex (hexes within 3 of (0,0)) on those seeds, each pool has at most 16 cells, none inside the Reach, all lower than its outlet, and the trace plus pool holds at most RIVER_MAX cells', () => {
    let pools = 0;
    for (const seed of HW_SEEDS) {
      for (const spring of springsNearStart(seed)) {
        const river = traceRiver(seed, spring);
        if (river.end !== 'pool') continue;
        pools++;
        const at = `seed ${seed}, spring (${spring.cx}, ${spring.cy})`;
        const pool = river.pool;
        expect(pool, at).toBeDefined();
        expect(river.outlet, at).toBeDefined();
        expect(pool!.length, at).toBeGreaterThan(0);
        expect(pool!.length, at).toBeLessThanOrEqual(POOL_MAX);
        for (const c of pool!) {
          expect(inReach(c), `${at}: (${c.cx}, ${c.cy}) in the Reach`).toBe(false);
          expect(worldCell(seed, c).height, `${at}: (${c.cx}, ${c.cy})`).toBeLessThan(river.outlet!);
        }
        const union = new Set([...river.cells.map(packCell), ...pool!.map(packCell)]);
        expect(union.size, at).toBeLessThanOrEqual(RIVER_MAX);
      }
    }
    // Not vacuous: some springs near the start pool.
    expect(pools).toBeGreaterThan(0);
  });

  it('#1964 criterion 4: given w-vega and w-astrid, generateReach is unchanged after rivers.ts has run for that seed', () => {
    const hash = (seed: number) => createHash('sha256').update(mapRows(generateReach(seed)).join('\n')).digest('hex').slice(0, 16);
    for (const [name, golden] of [['w-vega', 'f9779a07a1a21ff9'], ['w-astrid', '585e1925ea7025e5']] as const) {
      const seed = seedOf(name);
      for (const h of hexesWithin(3)) hexCells(seed, h);
      expect(hash(seed), name).toBe(golden);
    }
  });
});
