/**
 * #1896 — the world beyond the Reach: world-wide cell fields, with the Reach laid over them as the
 * start patch and a 6-cell band blending one into the other (docs/spikes/artificer-hex-world.md §3).
 *
 * One test per acceptance scenario. The Reach must come through untouched (1, 2), the fields must
 * be pure (3), the band must not leave a cliff at the Reach's edge (4), and the land around the
 * start hex must look like land (5) that tilts from the northern fells to the southern lowlands (6).
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { worldCell, worldHeight } from './cells';
import { generateReach, REACH_W, REACH_H, type Biome, type Reach } from './reach';
import { cellsOfHex, hexDistance, type CellXY, type Hex } from './coords';
import { seedOf } from './rng';
import { mapRows } from '../src/artificer/world/reach';

/** The Reach's golden hash, computed exactly as src/artificer/world/reach.test.ts does. */
const hash = (r: Reach) => createHash('sha256').update(mapRows(r).join('\n')).digest('hex').slice(0, 16);

const HW_SEEDS = Array.from({ length: 20 }, (_, i) => seedOf(`hw${i}`));

const inReach = (cx: number, cy: number) => cx >= 0 && cx < REACH_W && cy >= 0 && cy < REACH_H;

/** Chebyshev distance from a cell to the Reach rectangle: 0 inside, 1 on the ring just outside it. */
function reachDistance(cx: number, cy: number): number {
  const dx = cx < 0 ? -cx : cx >= REACH_W ? cx - (REACH_W - 1) : 0;
  const dy = cy < 0 ? -cy : cy >= REACH_H ? cy - (REACH_H - 1) : 0;
  return Math.max(dx, dy);
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

describe('worldmap/cells: world cell fields and the Reach start patch (#1896)', () => {
  it('scenario 1: given w-vega and w-astrid, worldCell on all 1,536 Reach cells deep-equals generateReach(seed).cells', () => {
    for (const name of ['w-vega', 'w-astrid']) {
      const seed = seedOf(name);
      const reach = generateReach(seed);
      for (let cy = 0; cy < REACH_H; cy++)
        for (let cx = 0; cx < REACH_W; cx++)
          expect(worldCell(seed, { cx, cy }), `${name} (${cx}, ${cy})`).toEqual(reach.cells[cy * REACH_W + cx]);
    }
  });

  it("scenario 2: given w-vega, after 1,000 worldCell calls outside the Reach, the Reach's golden hash is unchanged", () => {
    // The first 1,000 cells outside the Reach in the box around it: the whole 6-cell band (which
    // reads the Reach's edge) and two rings beyond it (pure world noise).
    const outside: CellXY[] = [];
    for (let cy = -8; cy < REACH_H + 8 && outside.length < 1000; cy++)
      for (let cx = -8; cx < REACH_W + 8 && outside.length < 1000; cx++) if (!inReach(cx, cy)) outside.push({ cx, cy });
    expect(outside).toHaveLength(1000);

    for (const [name, golden] of [['w-vega', 'f9779a07a1a21ff9'], ['w-astrid', '585e1925ea7025e5']] as const) {
      const seed = seedOf(name);
      for (const c of outside) worldCell(seed, c);
      expect(hash(generateReach(seed)), name).toBe(golden);
    }
  });

  it('scenario 3: given (100, -50) and (-30, 80), worldCell returns identical values before and after the Reach, in either order', async () => {
    const seed = seedOf('w-vega');
    const a: CellXY = { cx: 100, cy: -50 };
    const b: CellXY = { cx: -30, cy: 80 };
    const band: CellXY = { cx: 50, cy: 33 }; // also one band cell, which reads the memoised Reach
    // A fresh copy of the module each time, so its memo starts empty and "before" really is first.
    const fresh = async () => {
      vi.resetModules();
      return import('./cells');
    };
    const touchReach = (wc: typeof worldCell, s: number) => {
      for (let cy = 0; cy < REACH_H; cy++) for (let cx = 0; cx < REACH_W; cx++) wc(s, { cx, cy });
    };

    // Order 1: the far cells first, then the Reach, then the far cells again.
    const m1 = await fresh();
    const first = [m1.worldCell(seed, a), m1.worldCell(seed, b), m1.worldCell(seed, band)];
    touchReach(m1.worldCell, seed);
    expect([m1.worldCell(seed, a), m1.worldCell(seed, b), m1.worldCell(seed, band)]).toEqual(first);

    // Order 2: the Reach first, then the far cells the other way round.
    const m2 = await fresh();
    touchReach(m2.worldCell, seed);
    expect([m2.worldCell(seed, band), m2.worldCell(seed, b), m2.worldCell(seed, a)]).toEqual([first[2], first[1], first[0]]);

    // Other seeds push this one out of the memo: asking again gives the same cells.
    for (const s of HW_SEEDS.slice(0, 3)) touchReach(m2.worldCell, s);
    expect([m2.worldCell(seed, a), m2.worldCell(seed, b), m2.worldCell(seed, band)]).toEqual(first);
  });

  it("scenario 4: given 20 seeds, every 4-neighbour step touching the band is at most max(0.12, the Reach's largest step)", () => {
    for (const seed of HW_SEEDS) {
      const reach = generateReach(seed);
      let reachStep = 0;
      for (let cy = 0; cy < REACH_H; cy++)
        for (let cx = 0; cx < REACH_W; cx++)
          for (const [dx, dy] of STEPS) {
            const nx = cx + dx, ny = cy + dy;
            if (!inReach(nx, ny)) continue;
            reachStep = Math.max(reachStep, Math.abs(reach.cells[cy * REACH_W + cx].height - reach.cells[ny * REACH_W + nx].height));
          }
      const allowed = Math.max(0.12, reachStep);

      // Every cell in the band (Chebyshev distance 1–6), against each of its 4 neighbours, which
      // may be in the Reach (distance 0), in the band, or just beyond it (distance 7).
      let worst = 0, at = '';
      for (let cy = -6; cy < REACH_H + 6; cy++)
        for (let cx = -6; cx < REACH_W + 6; cx++) {
          const d = reachDistance(cx, cy);
          if (d < 1 || d > 6) continue;
          const h = worldCell(seed, { cx, cy }).height;
          for (const [dx, dy] of STEPS) {
            const step = Math.abs(h - worldCell(seed, { cx: cx + dx, cy: cy + dy }).height);
            if (step > worst) { worst = step; at = `(${cx}, ${cy}) → (${cx + dx}, ${cy + dy})`; }
          }
        }
      expect(worst, `seed ${seed}: worst band step ${worst.toFixed(3)} at ${at}, allowed ${allowed.toFixed(3)}`).toBeLessThanOrEqual(allowed);
    }
  });

  it('scenario 5: given 20 seeds, the cells of hexes within 2 of (0,0) outside the Reach have 1–35% lake, no biome over 60%, 5+ biomes, no river', () => {
    const hexes: Hex[] = [];
    for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) if (hexDistance({ q, r }, { q: 0, r: 0 }) <= 2) hexes.push({ q, r });
    expect(hexes).toHaveLength(19);
    const cells = hexes.flatMap(h => cellsOfHex(h)).filter(c => !inReach(c.cx, c.cy));
    expect(cells.length).toBeGreaterThan(1000);

    for (const seed of HW_SEEDS) {
      const counts = new Map<Biome, number>();
      for (const c of cells) {
        const b = worldCell(seed, c).biome;
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
      const share = (b: Biome) => (counts.get(b) ?? 0) / cells.length;
      const shares = [...counts.entries()].map(([b, n]) => `${b} ${((100 * n) / cells.length).toFixed(1)}%`).join(', ');
      expect(share('lake'), `lake, seed ${seed}: ${shares}`).toBeGreaterThanOrEqual(0.01);
      expect(share('lake'), `lake, seed ${seed}: ${shares}`).toBeLessThanOrEqual(0.35);
      expect(Math.max(...[...counts.values()]) / cells.length, `largest biome, seed ${seed}: ${shares}`).toBeLessThanOrEqual(0.6);
      expect(counts.size, `distinct biomes, seed ${seed}: ${shares}`).toBeGreaterThanOrEqual(5);
      expect(counts.has('river'), `river, seed ${seed}`).toBe(false);
    }
  });

  it('scenario 6: given (24, -60) and (24, 140), worldHeight averaged over 20 seeds is at least 0.2 higher in the north', () => {
    const mean = (cx: number, cy: number) => HW_SEEDS.reduce((s, seed) => s + worldHeight(seed, cx, cy), 0) / HW_SEEDS.length;
    const north = mean(24, -60);
    const south = mean(24, 140);
    expect(north - south, `north ${north.toFixed(3)}, south ${south.toFixed(3)}`).toBeGreaterThanOrEqual(0.2);
  });
});

