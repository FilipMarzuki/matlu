/**
 * Tile chunks for Core Warden (#1907, plan: docs/spikes/artificer-hex-world.md §3 "Tiles (Core
 * Warden)" and "Core Warden's maps today"). Step 14 of the hex world (#1873).
 *
 * Core Warden stands in the same world, at ~1 m tiles: a cell (`worldmap/coords.ts`, 2048 × 2048
 * tiles) is generated in chunks of `CHUNK` × `CHUNK` tiles (32 × 32 chunks a cell) on demand. Only
 * the pure part is built here: drawing is #1908 (art's call), special places are #1909.
 *
 * A tile's elevation and moisture are the cell fields (`worldHeight`/`worldMoist`, #1896)
 * interpolated bilinearly between cell centres, so there's no seam at a cell border. Its
 * temperature is `clamp01(1 − elevation)`. A tile's biome is its cell's character
 * (`REACH_TO_CW_BIOME`) almost everywhere; only where fine noise passes a threshold does it take
 * `tileBiomeIdx` of the bilinear fields instead, so a birch cell gets clearings rather than
 * dissolving into a patchwork.
 *
 * Rivers (#1897) draw a 3-tile-wide water line through a river cell, from each river 4-neighbour's
 * edge crossing point, through the cell's centre. The crossing point is `hash(seed, edgeId) % 2048`
 * along the shared edge, and `edgeId` names the edge by its two cells' `packCell`s (smaller first),
 * so both cells agree on it without either generating the other.
 *
 * Nothing calls this yet: it's new code behind no switch. `worldmap/` may not import from `src/`
 * (as with `rng.ts`, #1895): `cw-biomes.ts` holds a pinned copy of `tileBiomeIdx` for that reason.
 */

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { generator, seedOf } from './rng';
import { CELL_TILES, cellOrigin, hexOfCell, packCell, type CellXY } from './coords';
import { worldHeight, worldMoist } from './cells';
import { hexCells } from './rivers';
import type { Biome } from './reach';
import { tileBiomeIdx } from './cw-biomes';

/** A chunk is `CHUNK` × `CHUNK` tiles; a cell is `CELL_TILES` / `CHUNK` = 32 chunks on a side. */
export const CHUNK = 64;

/** The Reach's biome list, read onto Core Warden's 12 (`src/world/biomes.ts`, "the two biome lists differ"). */
export const REACH_TO_CW_BIOME: Readonly<Record<Biome, number>> = {
  lake: 0, river: 6, marsh: 3, meadow: 6, heath: 4, birch: 7, pine: 8, scree: 9, fell: 10, snow: 11,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface TileChunk {
  /** Row by row, `CHUNK` × `CHUNK`: a Core Warden biome index (0–11, `src/world/biomes.ts` `BIOMES` order). */
  biome: Uint8Array;
  /** Row by row, `CHUNK` × `CHUNK`: 1 for a river tile, else 0. */
  water: Uint8Array;
}

// Noise functions are built once a seed (createNoise2D shuffles a permutation table), same pattern
// as cells.ts's fieldMemo. Two seeds, same reasoning: a caller rarely holds more than one world.
const FINE_MEMO_SEEDS = 2;
const fineMemo = new Map<number, NoiseFunction2D>();
function fineNoise(seed: number): NoiseFunction2D {
  let f = fineMemo.get(seed);
  if (f === undefined) {
    f = createNoise2D(generator(seedOf(`${seed}|hexworld|tiles`)));
    const oldest = fineMemo.keys().next();
    if (fineMemo.size >= FINE_MEMO_SEEDS && !oldest.done) fineMemo.delete(oldest.value);
    fineMemo.set(seed, f);
  }
  return f;
}

/** Normalised noise in [0, 1] at one octave: `reach.ts`'s `fbm` with a single term. */
function noise01(n: NoiseFunction2D, x: number, y: number): number {
  return (n(x, y) + 1) / 2;
}

/** A cell's land (biome, with rivers — #1897), read through the hex that owns it. */
function cellLand(seed: number, c: CellXY): Biome {
  const hex = hexOfCell(c);
  const hc = hexCells(seed, hex);
  const i = hc.cells.findIndex(o => o.cx === c.cx && o.cy === c.cy);
  return hc.land[i].biome;
}

// A chunk's four bilinear corners are the same world cell for every one of its 4,096 tiles (a
// chunk never straddles a cell centre, since those sit on chunk boundaries): worth memoising, since
// a cell's 1,024 chunks share only 4 distinct corners between them. Small and seed-keyed, like
// cells.ts's own memos, so it never grows past a couple of worlds held at once.
const CORNER_MEMO_SEEDS = 2;
const cornerMemo = new Map<number, Map<number, { height: number; moist: number }>>();
function cornerField(seed: number, cx: number, cy: number): { height: number; moist: number } {
  let bySeed = cornerMemo.get(seed);
  if (bySeed === undefined) {
    bySeed = new Map();
    const oldest = cornerMemo.keys().next();
    if (cornerMemo.size >= CORNER_MEMO_SEEDS && !oldest.done) cornerMemo.delete(oldest.value);
    cornerMemo.set(seed, bySeed);
  }
  const key = packCell({ cx, cy });
  let v = bySeed.get(key);
  if (v === undefined) {
    v = { height: worldHeight(seed, cx, cy), moist: worldMoist(seed, cx, cy) };
    bySeed.set(key, v);
  }
  return v;
}

interface ChunkCorners {
  cx0: number;
  cy0: number;
  c00: { height: number; moist: number };
  c10: { height: number; moist: number };
  c01: { height: number; moist: number };
  c11: { height: number; moist: number };
}

/**
 * The four cell centres around a chunk, fetched once: a chunk never straddles a cell centre (those
 * sit on chunk boundaries, since `CELL_TILES / CHUNK` = 32 is even), so every one of its 4,096
 * tiles bilinearly interpolates between the same four corners.
 */
function chunkCorners(seed: number, tx0: number, ty0: number): ChunkCorners {
  const cx0 = Math.floor(tx0 / CELL_TILES - 0.5), cy0 = Math.floor(ty0 / CELL_TILES - 0.5);
  return {
    cx0, cy0,
    c00: cornerField(seed, cx0, cy0), c10: cornerField(seed, cx0 + 1, cy0),
    c01: cornerField(seed, cx0, cy0 + 1), c11: cornerField(seed, cx0 + 1, cy0 + 1),
  };
}

/** Fine noise passes the threshold where a tile's biome breaks from its cell's character. */
const FINE_THRESHOLD = 0.75;

const DIRS = [
  ['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0],
] as const;

/** `edgeId(a, b) = edgeId(b, a)`: both cells name the shared edge the same way, smaller `packCell` first. */
function edgeId(a: CellXY, b: CellXY): string {
  const pa = packCell(a), pb = packCell(b);
  return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
}

/** The crossing point along a shared edge, 0..`CELL_TILES` − 1, the same from either cell's side. */
function edgePoint(seed: number, a: CellXY, b: CellXY): number {
  return seedOf(`${seed}|hexworld|tiles|edge|${edgeId(a, b)}`) % CELL_TILES;
}

/** The point, in this cell's local tile coordinates (0..`CELL_TILES` − 1), where a river crosses towards `dir`. */
function edgeLocalPoint(dir: 'n' | 's' | 'e' | 'w', e: number): { x: number; y: number } {
  const last = CELL_TILES - 1;
  if (dir === 'n') return { x: e, y: 0 };
  if (dir === 's') return { x: e, y: last };
  if (dir === 'w') return { x: 0, y: e };
  return { x: last, y: e };
}

/** Every water tile of a river cell, in its own local tile coordinates, packed as `y * CELL_TILES + x`. */
function riverWaterTiles(seed: number, c: CellXY): ReadonlySet<number> {
  const targets: Array<{ x: number; y: number }> = [];
  for (const [dir, dx, dy] of DIRS) {
    const n = { cx: c.cx + dx, cy: c.cy + dy };
    if (cellLand(seed, n) !== 'river') continue;
    targets.push(edgeLocalPoint(dir, edgePoint(seed, c, n)));
  }

  const centre = { x: CELL_TILES / 2, y: CELL_TILES / 2 };
  const marks = new Set<number>();
  const mark = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const mx = x + dx, my = y + dy;
        if (mx < 0 || my < 0 || mx >= CELL_TILES || my >= CELL_TILES) continue;
        marks.add(my * CELL_TILES + mx);
      }
  };

  // Every stop is from the centre to a crossing point: with no river neighbour (an isolated river
  // tile), the centre alone still gets marked.
  if (targets.length === 0) { mark(centre.x, centre.y); return marks; }
  for (const to of targets) {
    const steps = Math.max(Math.abs(to.x - centre.x), Math.abs(to.y - centre.y));
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(centre.x + (to.x - centre.x) * t / steps);
      const y = Math.round(centre.y + (to.y - centre.y) * t / steps);
      mark(x, y);
    }
  }
  return marks;
}

// A river cell's full water footprint is the same work for every one of its 1,024 chunks, so it's
// kept a few cells deep (not the chunk LRU below, which holds rendered chunks, not this).
const RIVER_MEMO_CELLS = 8;
const riverMemo = new Map<string, ReadonlySet<number>>();
function riverWaterTilesCached(seed: number, c: CellXY): ReadonlySet<number> {
  const key = `${seed}|${c.cx},${c.cy}`;
  let w = riverMemo.get(key);
  if (w === undefined) {
    w = riverWaterTiles(seed, c);
    const oldest = riverMemo.keys().next();
    if (riverMemo.size >= RIVER_MEMO_CELLS && !oldest.done) riverMemo.delete(oldest.value);
    riverMemo.set(key, w);
  }
  return w;
}

/** Rendered chunks, LRU by last use (a Map keeps insertion order; a hit is moved to the back). */
const CHUNK_CACHE_SIZE = 64;
const chunkCache = new Map<string, TileChunk>();

/** One of `CELL_TILES / CHUNK` (32) × 32 tile chunks of a cell, `CHUNK` × `CHUNK` tiles, row by row. */
export function tileChunk(seed: number, cell: CellXY, chunk: { x: number; y: number }): TileChunk {
  const key = `${seed}|${cell.cx},${cell.cy}|${chunk.x},${chunk.y}`;
  const hit = chunkCache.get(key);
  if (hit !== undefined) {
    chunkCache.delete(key);
    chunkCache.set(key, hit);
    return copyChunk(hit);
  }

  const land = cellLand(seed, cell);
  const cwBase = REACH_TO_CW_BIOME[land];
  const fine = fineNoise(seed);
  const origin = cellOrigin(cell);
  const localOriginX = chunk.x * CHUNK, localOriginY = chunk.y * CHUNK;
  const corners = chunkCorners(seed, origin.tx + localOriginX, origin.ty + localOriginY);

  const biome = new Uint8Array(CHUNK * CHUNK);
  const water = new Uint8Array(CHUNK * CHUNK);

  // Inlined rather than called per tile: a function returning a fresh { elev, moist } object 4,096
  // times a chunk (4M+ times over a cell) is slow enough in practice to matter (short-lived
  // allocations, one per tile) — see the acceptance test's 70%-match scenario over 20 cells.
  const { cx0, cy0, c00, c10, c01, c11 } = corners;
  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const tx = origin.tx + localOriginX + lx, ty = origin.ty + localOriginY + ly;
      const fx = tx / CELL_TILES - 0.5 - cx0, fy = ty / CELL_TILES - 0.5 - cy0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const elev = clamp01(c00.height * w00 + c10.height * w10 + c01.height * w01 + c11.height * w11);
      const moist = clamp01(c00.moist * w00 + c10.moist * w10 + c01.moist * w01 + c11.moist * w11);
      const temp = clamp01(1 - elev);
      const idx = ly * CHUNK + lx;
      biome[idx] = noise01(fine, tx / 96, ty / 96) > FINE_THRESHOLD ? tileBiomeIdx(elev, temp, moist) : cwBase;
    }
  }

  if (land === 'river') {
    const tiles = riverWaterTilesCached(seed, cell);
    for (let ly = 0; ly < CHUNK; ly++)
      for (let lx = 0; lx < CHUNK; lx++) {
        const localX = localOriginX + lx, localY = localOriginY + ly;
        if (tiles.has(localY * CELL_TILES + localX)) water[ly * CHUNK + lx] = 1;
      }
  }

  const result: TileChunk = { biome, water };
  const oldest = chunkCache.keys().next();
  if (chunkCache.size >= CHUNK_CACHE_SIZE && !oldest.done) chunkCache.delete(oldest.value);
  chunkCache.set(key, result);
  return copyChunk(result);
}

/**
 * A caller gets its own copy, never the cached arrays: a caller that wrote into a returned chunk
 * (`tc.water[0] = 1`) would otherwise change what every later call with the same key returns, and
 * with it every replay's bytes. A typed array can't be frozen, so copying is the only guard; a
 * chunk is 2 × 4 KB, so the copy costs next to nothing beside drawing one.
 */
function copyChunk(c: TileChunk): TileChunk {
  return { biome: c.biome.slice(), water: c.water.slice() };
}
