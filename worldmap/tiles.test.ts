/**
 * #1907 — tile chunks for Core Warden: elevation/moisture/temperature bilinearly interpolated
 * between cell centres, a cell's character held by most of its tiles (`REACH_TO_CW_BIOME`), fine
 * noise breaking through it here and there, and rivers drawn as a 3-tile-wide line between
 * edge-keyed crossing points (docs/spikes/artificer-hex-world.md §3, "Tiles (Core Warden)"). Step
 * 14 of the hex world (#1873).
 *
 * One test per acceptance scenario: `tileChunk` is pure (1), a land cell mostly keeps its cell's
 * character (2), two neighbouring river cells agree on their shared crossing (3), a river's water
 * is unbroken across its own chunks (4). Scenario 5 (the `cw-biomes.ts` pin) lives in
 * `cw-biomes.test.ts`, and scenario 6 (no `src/` imports) is read by eye below.
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect, vi } from 'vitest';
import { tileChunk, CHUNK, REACH_TO_CW_BIOME, type TileChunk } from './tiles';
import { hexCells } from './rivers';
import { hexOfCell, packCell, CELL_TILES, type CellXY } from './coords';
import { seedOf } from './rng';
import type { Biome } from './reach';

const CHUNKS_PER_CELL = CELL_TILES / CHUNK; // 32

/** A cell's land (biome, with rivers), the same way tiles.ts reads it. */
function cellLand(seed: number, c: CellXY): Biome {
  const hex = hexOfCell(c);
  const hc = hexCells(seed, hex);
  const i = hc.cells.findIndex(o => o.cx === c.cx && o.cy === c.cy);
  return hc.land[i].biome;
}

/** Every cell's full tile chunk, assembled into one `CELL_TILES` × `CELL_TILES` array (row by row). */
function assembleCell(seed: number, cell: CellXY, pick: (tc: TileChunk) => Uint8Array): Uint8Array {
  const out = new Uint8Array(CELL_TILES * CELL_TILES);
  for (let cy = 0; cy < CHUNKS_PER_CELL; cy++)
    for (let cx = 0; cx < CHUNKS_PER_CELL; cx++) {
      const tc = tileChunk(seed, cell, { x: cx, y: cy });
      const arr = pick(tc);
      for (let ly = 0; ly < CHUNK; ly++)
        for (let lx = 0; lx < CHUNK; lx++)
          out[(cy * CHUNK + ly) * CELL_TILES + (cx * CHUNK + lx)] = arr[ly * CHUNK + lx];
    }
  return out;
}

/** `tiles.ts`'s private edge-keyed crossing point, recomputed here to check against it independently. */
function edgePoint(seed: number, a: CellXY, b: CellXY): number {
  const pa = packCell(a), pb = packCell(b);
  const id = pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
  return seedOf(`${seed}|hexworld|tiles|edge|${id}`) % CELL_TILES;
}

/** 4-connected flood fill over a dense `CELL_TILES` × `CELL_TILES` 0/1 array: does it reach `target` from `start`? */
function floodReaches(water: Uint8Array, start: { x: number; y: number }, target: { x: number; y: number }): boolean {
  const w = CELL_TILES;
  if (!water[start.y * w + start.x]) return false;
  const visited = new Uint8Array(w * w);
  const qx = new Int32Array(w * w), qy = new Int32Array(w * w);
  let head = 0, tail = 0;
  qx[tail] = start.x; qy[tail] = start.y; tail++;
  visited[start.y * w + start.x] = 1;
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (head < tail) {
    const x = qx[head], y = qy[head]; head++;
    if (x === target.x && y === target.y) return true;
    for (const [dx, dy] of steps) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= w) continue;
      const idx = ny * w + nx;
      if (visited[idx] || !water[idx]) continue;
      visited[idx] = 1;
      qx[tail] = nx; qy[tail] = ny; tail++;
    }
  }
  return false;
}

const SEEDS = ['tiles-aspen', 'tiles-birch', 'tiles-cedar'].map(seedOf);

/** `count` distinct cells (scanning row by row from (0, 0)) whose land is neither lake nor river. */
function findLandCells(seed: number, count: number): CellXY[] {
  const out: CellXY[] = [];
  for (let cy = 60; cy < 200 && out.length < count; cy++)
    for (let cx = 60; cx < 200 && out.length < count; cx++) {
      const land = cellLand(seed, { cx, cy });
      if (land !== 'lake' && land !== 'river') out.push({ cx, cy });
    }
  return out;
}

describe('worldmap/tiles: tile chunks for Core Warden (#1907)', () => {
  it('scenario 1: given a seed, a cell and a chunk, tileChunk called twice, with the LRU cleared in between, is byte-identical', async () => {
    const seed = seedOf('tiles-1');
    const cell: CellXY = { cx: 12, cy: -7 };
    const chunk = { x: 5, y: 19 };
    const fresh = async () => {
      vi.resetModules();
      return import('./tiles');
    };
    const m1 = await fresh();
    const first = m1.tileChunk(seed, cell, chunk);
    const m2 = await fresh();
    const second = m2.tileChunk(seed, cell, chunk);
    expect(Array.from(second.biome)).toEqual(Array.from(first.biome));
    expect(Array.from(second.water)).toEqual(Array.from(first.water));
  });

  it('scenario 2: given 20 land cells (not lake, not river) across 3 seeds, at least 70% of each cell\'s tiles have REACH_TO_CW_BIOME[cell biome]', () => {
    for (const seed of SEEDS) {
      const cells = findLandCells(seed, 20);
      expect(cells, `seed ${seed}`).toHaveLength(20);
      for (const cell of cells) {
        const cwBase = REACH_TO_CW_BIOME[cellLand(seed, cell)];
        let matches = 0, total = 0;
        for (let cy = 0; cy < CHUNKS_PER_CELL; cy++)
          for (let cx = 0; cx < CHUNKS_PER_CELL; cx++) {
            const tc = tileChunk(seed, cell, { x: cx, y: cy });
            for (let i = 0; i < tc.biome.length; i++) {
              total++;
              if (tc.biome[i] === cwBase) matches++;
            }
          }
        expect(matches / total, `seed ${seed}, cell (${cell.cx}, ${cell.cy})`).toBeGreaterThanOrEqual(0.7);
      }
    }
  }, 60_000);

  it("scenario 3: given two 4-neighbouring river cells A and B, A's chunk on the shared edge and B's facing one mark the same 3 tiles around edgePoint", () => {
    // The Reach (0 ≤ cx < 48, 0 ≤ cy < 32) always has a few rivers of its own, so a 4-neighbouring
    // river pair is found inside it without a blind search over the wider world.
    const DIRS4 = [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]] as const;
    let found: { a: CellXY; b: CellXY; dir: 'n' | 's' | 'e' | 'w' } | undefined;
    for (const seed of SEEDS) {
      for (let cy = 0; cy < 32 && !found; cy++)
        for (let cx = 0; cx < 48 && !found; cx++) {
          const a = { cx, cy };
          if (cellLand(seed, a) !== 'river') continue;
          for (const [dir, dx, dy] of DIRS4) {
            const b = { cx: a.cx + dx, cy: a.cy + dy };
            if (cellLand(seed, b) === 'river') { found = { a, b, dir }; break; }
          }
        }
      if (found) {
        const { a, b, dir } = found;
        const e = edgePoint(seed, a, b);
        const last = CELL_TILES - 1;
        const waterA = assembleCell(seed, a, tc => tc.water);
        const waterB = assembleCell(seed, b, tc => tc.water);

        // The column (n/s: x = e varies by row; e/w: y = e varies by column) each cell holds at
        // its own edge facing the other, read along the border, offset 0..CELL_TILES - 1.
        const colA = (dir === 'n' || dir === 's')
          ? Array.from({ length: CELL_TILES }, (_, x) => waterA[(dir === 'n' ? 0 : last) * CELL_TILES + x])
          : Array.from({ length: CELL_TILES }, (_, y) => waterA[y * CELL_TILES + (dir === 'w' ? 0 : last)]);
        const colB = (dir === 'n' || dir === 's')
          ? Array.from({ length: CELL_TILES }, (_, x) => waterB[(dir === 'n' ? last : 0) * CELL_TILES + x])
          : Array.from({ length: CELL_TILES }, (_, y) => waterB[y * CELL_TILES + (dir === 'w' ? last : 0)]);

        expect(colA, `seed ${seed}`).toEqual(colB);
        for (const off of [-1, 0, 1]) {
          const i = e + off;
          if (i < 0 || i > last) continue;
          expect(colA[i], `seed ${seed}, offset ${off} around edgePoint ${e}`).toBe(1);
        }
        return;
      }
    }
    expect(found, 'a 4-neighbouring river pair across the tried seeds').toBeDefined();
  }, 60_000);

  it("scenario 4: given a river cell, its water tiles flood-filled from one crossing point across its chunks reach the other", () => {
    let picked: { cell: CellXY; a: { x: number; y: number }; b: { x: number; y: number } } | undefined;
    for (const seed of SEEDS) {
      for (let cy = 0; cy < 32 && !picked; cy++)
        for (let cx = 0; cx < 48 && !picked; cx++) {
          const cell = { cx, cy };
          if (cellLand(seed, cell) !== 'river') continue;
          const dirs = [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]] as const;
          const crossings: { x: number; y: number }[] = [];
          for (const [dir, dx, dy] of dirs) {
            const n = { cx: cell.cx + dx, cy: cell.cy + dy };
            if (cellLand(seed, n) !== 'river') continue;
            const e = edgePoint(seed, cell, n);
            const last = CELL_TILES - 1;
            crossings.push(dir === 'n' ? { x: e, y: 0 } : dir === 's' ? { x: e, y: last } : dir === 'w' ? { x: 0, y: e } : { x: last, y: e });
          }
          if (crossings.length >= 2) picked = { cell, a: crossings[0], b: crossings[1] };
        }
      if (picked) {
        const water = assembleCell(seed, picked.cell, tc => tc.water);
        expect(floodReaches(water, picked.a, picked.b), `seed ${seed}, cell (${picked.cell.cx}, ${picked.cell.cy})`).toBe(true);
        return;
      }
    }
    expect(picked, 'a river cell with 2+ river neighbours across the tried seeds').toBeDefined();
  }, 60_000);

  it("a caller's write into a returned chunk doesn't reach the next call (the cache hands out copies)", () => {
    const seed = seedOf('tiles-copy');
    const cell: CellXY = { cx: 3, cy: 40 };
    const chunk = { x: 2, y: 7 };
    const first = tileChunk(seed, cell, chunk);
    const biome = Array.from(first.biome), water = Array.from(first.water);
    first.biome.fill(255);
    first.water.fill(1);
    const again = tileChunk(seed, cell, chunk); // a cache hit
    expect(again.biome).not.toBe(first.biome);
    expect(Array.from(again.biome)).toEqual(biome);
    expect(Array.from(again.water)).toEqual(water);
    again.biome[0] = 254; // and a write into a hit's copy doesn't reach the cache either
    expect(tileChunk(seed, cell, chunk).biome[0]).toBe(biome[0]);
  });

  // Scenario 5 (cw-biomes.ts pinned equal to src/world/biomes.ts) lives in cw-biomes.test.ts.

  it('scenario 6: tiles.ts imports nothing from src/', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(new URL('./tiles.ts', import.meta.url), 'utf8');
    const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec.startsWith('../src') || spec === 'src' || spec.includes('/src/'), spec).toBe(false);
  });
});
