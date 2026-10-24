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
 * `cw-biomes.test.ts`, and scenario 6 (no `src/` imports) is read by eye below. The tests between
 * scenario 4 and 6 pin what review found: chunk range checks, fields read from the cells' own
 * height and moisture, a river cell's land, lakes as open water, rivers reaching their lakes, and
 * crossings exactly 3 tiles wide on both sides of every edge.
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect, vi } from 'vitest';
import { tileChunk, riverLineTiles, cellMoist, CHUNK, REACH_TO_CW_BIOME, type TileChunk, type RiverCrossing } from './tiles';
import { hexCells } from './rivers';
import { worldCell } from './cells';
import { hexOfCell, packCell, CELL_TILES, type CellXY } from './coords';
import { seedOf } from './rng';
import { generateReach, biomeOf, REACH_W, REACH_H, type Biome } from './reach';

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

  it('tileChunk throws a RangeError for a chunk that is not an integer in 0..31, instead of reading another cell', () => {
    const seed = seedOf('tiles-range');
    const cell: CellXY = { cx: 3, cy: 40 };
    const bad = [{ x: 32, y: 0 }, { x: 0, y: 32 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0.5, y: 0 }, { x: 0, y: NaN }, { x: Infinity, y: 0 }];
    for (const chunk of bad) expect(() => tileChunk(seed, cell, chunk), JSON.stringify(chunk)).toThrow(RangeError);
    expect(() => tileChunk(seed, cell, { x: 31, y: 31 })).not.toThrow();
  });

  it("a tile's elevation is its cells' own height: a Reach snowfield whose cell and 8 neighbours all stand at 0.8 or more is Snow Field throughout", () => {
    // In the Reach's north the Reach stands near 1 where the world's raw noise (worldHeight) is
    // about 0.5. Between cells all at 0.8 or more the elevation is 0.8 or more everywhere, and
    // there tileBiomeIdx has one answer (temperature = 1 − elevation ≤ 0.2): 11, Snow Field. So a
    // tile breaking from its cell's character can't be anything else, unless it read the raw field.
    const SNOW_FIELD = 11;
    let checked = 0;
    for (const seed of SEEDS) {
      let cell: CellXY | undefined;
      for (let cy = 0; cy < 4 && !cell; cy++)
        for (let cx = 0; cx < REACH_W && !cell; cx++) {
          if (cellLand(seed, { cx, cy }) !== 'snow') continue;
          let high = true;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) if (worldCell(seed, { cx: cx + dx, cy: cy + dy }).height < 0.8) high = false;
          if (high) cell = { cx, cy };
        }
      if (!cell) continue;
      const biome = assembleCell(seed, cell, tc => tc.biome);
      let other = 0;
      for (const b of biome) if (b !== SNOW_FIELD) other++;
      expect(other, `seed ${seed}, cell (${cell.cx}, ${cell.cy}): tiles that aren't Snow Field`).toBe(0);
      checked++;
    }
    expect(checked, 'a Reach snowfield ringed by high cells, across the tried seeds').toBeGreaterThan(0);
  }, 60_000);

  it("cellMoist is the moisture each cell's biome was classified with: biomeOf(height, cellMoist) gives back every Reach and band cell's own biome", () => {
    // Inside the Reach, cellMoist repeats generateReach's moisture (which the Reach doesn't hand
    // out); this pins that copy. Rivers and tarns are written over the land, and a lake's biome
    // doesn't depend on moisture, so those are skipped. Outside the Reach worldCell has no rivers.
    const wrong: string[] = [];
    let checked = 0;
    for (const seed of [...SEEDS, ...['moist-a', 'moist-b', 'moist-c'].map(seedOf)]) {
      const reach = generateReach(seed);
      reach.cells.forEach((c, i) => {
        if (c.biome === 'river' || c.biome === 'lake') return;
        const cell = { cx: i % REACH_W, cy: Math.floor(i / REACH_W) };
        checked++;
        if (biomeOf(c.height, cellMoist(seed, cell)) !== c.biome) wrong.push(`seed ${seed}, Reach cell (${cell.cx}, ${cell.cy})`);
      });
      for (let cy = -8; cy < REACH_H + 8; cy++)
        for (let cx = -8; cx < REACH_W + 8; cx++) {
          if (cx >= 0 && cx < REACH_W && cy >= 0 && cy < REACH_H) continue;
          const wc = worldCell(seed, { cx, cy });
          checked++;
          if (biomeOf(wc.height, cellMoist(seed, { cx, cy })) !== wc.biome) wrong.push(`seed ${seed}, band cell (${cx}, ${cy})`);
        }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(wrong).toEqual([]);
  });

  it("a river cell's character is the land under its river: its tiles away from the water mostly carry that land's Core Warden biome, not Meadow", () => {
    // Outside the Reach worldCell has no rivers (hexCells lays them on), so its biome is the land
    // under the river, worked out here without tiles.ts. Cells over meadow are skipped: Meadow is
    // what every river cell used to be, so they'd pass either way.
    const HEXES = [{ q: 0, r: -2 }, { q: -1, r: -1 }, { q: 1, r: -2 }, { q: 0, r: -3 }];
    let checked = 0;
    for (const seed of SEEDS) {
      const cells: CellXY[] = [];
      for (const h of HEXES) {
        const hc = hexCells(seed, h);
        hc.cells.forEach((c, i) => {
          const outside = c.cx < 0 || c.cx >= REACH_W || c.cy < 0 || c.cy >= REACH_H;
          if (cells.length < 2 && outside && hc.land[i].biome === 'river' && worldCell(seed, c).biome !== 'meadow') cells.push(c);
        });
      }
      for (const cell of cells) {
        const want = REACH_TO_CW_BIOME[worldCell(seed, cell).biome];
        let matches = 0, land = 0;
        for (let cy = 0; cy < CHUNKS_PER_CELL; cy++)
          for (let cx = 0; cx < CHUNKS_PER_CELL; cx++) {
            const tc = tileChunk(seed, cell, { x: cx, y: cy });
            for (let i = 0; i < tc.biome.length; i++) {
              if (tc.water[i]) continue;
              land++;
              if (tc.biome[i] === want) matches++;
            }
          }
        expect(matches / land, `seed ${seed}, cell (${cell.cx}, ${cell.cy}), over ${worldCell(seed, cell).biome}`).toBeGreaterThanOrEqual(0.7);
        checked++;
      }
    }
    expect(checked, 'river cells over land other than meadow, across the tried seeds').toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('a lake cell is open water throughout, a high tarn too: the fine noise makes no islands in it', () => {
    // A tarn is a river's last cell turned lake (boxed in by its own course), so it can stand well
    // above lake level: this one, in the Reach of seed 'tarn-40', stands at 0.34.
    const SEA = REACH_TO_CW_BIOME.lake;
    const tarnSeed = seedOf('tarn-40');
    const tarn: CellXY = { cx: 40, cy: 13 };
    expect(cellLand(tarnSeed, tarn)).toBe('lake');
    expect(worldCell(tarnSeed, tarn).height).toBeGreaterThan(0.3);

    const seed = SEEDS[0];
    let lake: CellXY | undefined;
    for (let cy = REACH_H - 1; cy >= 0 && !lake; cy--)
      for (let cx = 0; cx < REACH_W && !lake; cx++) if (cellLand(seed, { cx, cy }) === 'lake') lake = { cx, cy };
    expect(lake, 'a lake in the Reach').toBeDefined();

    for (const [s, cell] of [[tarnSeed, tarn], [seed, lake!]] as const) {
      const biome = assembleCell(s, cell, tc => tc.biome);
      let other = 0;
      for (const b of biome) if (b !== SEA) other++;
      expect(other, `seed ${s}, cell (${cell.cx}, ${cell.cy}): tiles that aren't Sea`).toBe(0);
    }
  }, 60_000);

  it('a river that ends in a lake reaches it: its last cell carries the water on to the border it shares with the lake', () => {
    // A trace stops one cell short of the lake it runs into, so its last cell (one river
    // neighbour, or none) has a lake beside it. The Reach's rivers end in its southern lakes.
    const last = CELL_TILES - 1;
    const centre = { x: CELL_TILES / 2, y: CELL_TILES / 2 };
    const DIRS4 = [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]] as const;
    let checked = 0;
    for (const seed of SEEDS) {
      let mouth: { cell: CellXY; lakes: Array<{ dir: 'n' | 's' | 'e' | 'w'; n: CellXY }> } | undefined;
      for (let cy = 0; cy < REACH_H && !mouth; cy++)
        for (let cx = 0; cx < REACH_W && !mouth; cx++) {
          const cell = { cx, cy };
          if (cellLand(seed, cell) !== 'river') continue;
          let rivers = 0;
          const lakes: Array<{ dir: 'n' | 's' | 'e' | 'w'; n: CellXY }> = [];
          for (const [dir, dx, dy] of DIRS4) {
            const n = { cx: cx + dx, cy: cy + dy };
            const land = cellLand(seed, n);
            if (land === 'river') rivers++;
            else if (land === 'lake') lakes.push({ dir, n });
          }
          if (rivers <= 1 && lakes.length > 0) mouth = { cell, lakes };
        }
      if (!mouth) continue;
      const water = assembleCell(seed, mouth.cell, tc => tc.water);
      const reached = mouth.lakes.filter(({ dir, n }) => {
        const e = edgePoint(seed, mouth.cell, n);
        const at = dir === 'n' ? { x: e, y: 0 } : dir === 's' ? { x: e, y: last } : dir === 'w' ? { x: 0, y: e } : { x: last, y: e };
        return water[at.y * CELL_TILES + at.x] === 1 && floodReaches(water, at, centre);
      });
      expect(reached.length, `seed ${seed}, cell (${mouth.cell.cx}, ${mouth.cell.cy}): lake sides its water reaches`).toBe(1);
      checked++;
    }
    expect(checked, 'a river mouth beside a lake, across the tried seeds').toBeGreaterThan(0);
  }, 60_000);

  it('every crossing point, on every side: the border line holds water at exactly at − 1..at + 1, the other border lines none, and the line is unbroken', () => {
    // Both cells on a shared edge draw their own half of the river, so this is what makes them
    // agree there: cell A's 'n' and cell B's 's' (or 'e' and 'w') at the same point must each hold
    // exactly the 3 tiles around it. Checked for all 2,048 points on all 4 sides.
    const last = CELL_TILES - 1;
    const SIDES = ['n', 's', 'e', 'w'] as const;
    const onLine = (dir: RiverCrossing['dir'], x: number, y: number) =>
      dir === 'n' ? y === 0 : dir === 's' ? y === last : dir === 'w' ? x === 0 : x === last;
    const along = (dir: RiverCrossing['dir'], x: number, y: number) => (dir === 'n' || dir === 's' ? x : y);
    const failures: string[] = [];
    for (const dir of SIDES)
      for (let at = 0; at < CELL_TILES; at++) {
        const water = riverLineTiles([{ dir, at }]);
        const want = [at - 1, at, at + 1].filter(i => i >= 0 && i <= last);
        const got: number[] = [];
        for (const p of water) {
          const x = p % CELL_TILES, y = Math.floor(p / CELL_TILES);
          if (onLine(dir, x, y)) got.push(along(dir, x, y));
          // Any other border line: only the stamp's own corner tile, which lies on both.
          else if (x === 0 || y === 0 || x === last || y === last) failures.push(`${dir} ${at}: water on another border at (${x}, ${y})`);
        }
        got.sort((a, b) => a - b);
        if (got.join() !== want.join()) failures.push(`${dir} ${at}: border holds ${got.join(',')}, want ${want.join(',')}`);
      }
    expect(failures.slice(0, 10)).toEqual([]);

    // Unbroken from the stamp to the centre (a flood fill over the line's own tiles), at the ends of
    // each side, around its middle, and every 61st point between.
    const sample = new Set([0, 1, 2, 1022, 1023, 1024, 1025, 2045, 2046, 2047]);
    for (let at = 0; at < CELL_TILES; at += 61) sample.add(at);
    const centre = (CELL_TILES / 2) * CELL_TILES + CELL_TILES / 2;
    for (const dir of SIDES)
      for (const at of sample) {
        const water = riverLineTiles([{ dir, at }]);
        const start = dir === 'n' ? at : dir === 's' ? last * CELL_TILES + at : dir === 'w' ? at * CELL_TILES : at * CELL_TILES + last;
        // 4-connected flood fill over the set itself (a dense cell-sized array per point would be 4 MB each).
        const seen = new Set([start]);
        const queue = [start];
        while (queue.length > 0 && !seen.has(centre)) {
          const p = queue.pop()!;
          const x = p % CELL_TILES;
          for (const q of [x > 0 ? p - 1 : -1, x < last ? p + 1 : -1, p - CELL_TILES, p + CELL_TILES])
            if (water.has(q) && !seen.has(q)) { seen.add(q); queue.push(q); }
        }
        expect(water.has(start) && seen.has(centre), `${dir} ${at}`).toBe(true);
      }
  }, 60_000);

  // Scenario 5 (cw-biomes.ts pinned equal to src/world/biomes.ts) lives in cw-biomes.test.ts.

  it('scenario 6: tiles.ts imports nothing from src/', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(new URL('./tiles.ts', import.meta.url), 'utf8');
    const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec.startsWith('../src') || spec === 'src' || spec.includes('/src/'), spec).toBe(false);
  });
});
