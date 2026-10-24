/**
 * Tile chunks for Core Warden (#1907, plan: docs/spikes/artificer-hex-world.md §3 "Tiles (Core
 * Warden)" and "Core Warden's maps today"). Step 14 of the hex world (#1873).
 *
 * Core Warden stands in the same world, at ~1 m tiles: a cell (`worldmap/coords.ts`, 2048 × 2048
 * tiles) is generated in chunks of `CHUNK` × `CHUNK` tiles (32 × 32 chunks a cell) on demand. Only
 * the pure part is built here: drawing is #1908 (art's call), special places are #1909.
 *
 * A tile's elevation and moisture are its cells' own height and moisture (`worldCell`'s height,
 * `cellMoist`) interpolated bilinearly between cell centres, so there's no seam at a cell border.
 * Its temperature is `clamp01(1 − elevation)`. A tile's biome is its cell's character
 * (`REACH_TO_CW_BIOME`) almost everywhere; only where fine noise passes a threshold does it take
 * `tileBiomeIdx` of the bilinear fields instead, so a birch cell gets clearings rather than
 * dissolving into a patchwork. A lake cell is open water throughout, and a river cell's character
 * is the land under its river.
 *
 * Rivers (#1897) draw a 3-tile-wide water line through a river cell, from each river 4-neighbour's
 * edge crossing point, through the cell's centre (and on into the lake a river runs into). The
 * crossing point is `hash(seed, edgeId) % 2048` along the shared edge, and `edgeId` names the edge
 * by its two cells' `packCell`s (smaller first), so both cells agree on it without either
 * generating the other.
 *
 * Nothing calls this yet: it's new code behind no switch. `worldmap/` may not import from `src/`
 * (as with `rng.ts`, #1895): `cw-biomes.ts` holds a pinned copy of `tileBiomeIdx` for that reason.
 */

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { generator, seedOf } from './rng';
import { CELL_TILES, cellOrigin, hexOfCell, packCell, type CellXY } from './coords';
import { worldCell, worldMoist } from './cells';
import { hexCells } from './rivers';
import { biomeOf, fbm, REACH_W, REACH_H, type Biome } from './reach';
import { tileBiomeIdx } from './cw-biomes';

/** A chunk is `CHUNK` × `CHUNK` tiles; a cell is `CELL_TILES` / `CHUNK` = 32 chunks on a side. */
export const CHUNK = 64;
const CHUNKS_PER_CELL = CELL_TILES / CHUNK;

/**
 * The Reach's biome list, read onto Core Warden's 12 (`src/world/biomes.ts`, "the two biome lists
 * differ"). A river cell never uses the `river` row: its character is the land under the river
 * (see `baseBiome`), and the river itself is `water`. The row stays so the table covers every
 * Reach biome.
 */
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
const NOISE_MEMO_SEEDS = 2;
interface SeedNoise {
  /** The fine noise where a tile breaks from its cell's character. */
  fine: NoiseFunction2D;
  /** The Reach's own moisture noise, the one `generateReach` draws from (see `cellMoist`). */
  reachMoist: NoiseFunction2D;
}
const noiseMemo = new Map<number, SeedNoise>();
function noiseOf(seed: number): SeedNoise {
  let n = noiseMemo.get(seed);
  if (n === undefined) {
    n = {
      fine: createNoise2D(generator(seedOf(`${seed}|hexworld|tiles`))),
      reachMoist: createNoise2D(generator(seedOf(`${seed}|world|moisture`))),
    };
    const oldest = noiseMemo.keys().next();
    if (noiseMemo.size >= NOISE_MEMO_SEEDS && !oldest.done) noiseMemo.delete(oldest.value);
    noiseMemo.set(seed, n);
  }
  return n;
}

/** Normalised noise in [0, 1] at one octave: `reach.ts`'s `fbm` with a single term. */
function noise01(n: NoiseFunction2D, x: number, y: number): number {
  return (n(x, y) + 1) / 2;
}

const inReach = (c: CellXY) => c.cx >= 0 && c.cx < REACH_W && c.cy >= 0 && c.cy < REACH_H;

/**
 * A cell's own moisture, 0 (dry) to 1 (wet): the one its biome was classified with.
 *
 * Outside the Reach that's `worldMoist` (`worldCell` classifies with it). Inside the Reach it's the
 * Reach's own moisture, which `generateReach` makes and then drops: it hands out only height and
 * biome, and reach.ts is pinned unchanged. So this repeats that one line of it, same stream
 * (`|world|moisture`), same scale and offsets, the same arithmetic in the same order so the result
 * is the same to the bit. `tiles.test.ts` pins the copy: `biomeOf(height, cellMoist)` must give
 * back every Reach cell's own biome.
 *
 * Exported for that test.
 */
export function cellMoist(seed: number, c: CellXY): number {
  if (!inReach(c)) return worldMoist(seed, c.cx, c.cy);
  const nx = c.cx / REACH_W, ny = c.cy / REACH_H;
  return fbm(noiseOf(seed).reachMoist, nx * 2.6 + 7, ny * 2.6 + 3, 4);
}

/** A cell's land (biome, with rivers — #1897), read through the hex that owns it. */
function cellLand(seed: number, c: CellXY): Biome {
  const hex = hexOfCell(c);
  const hc = hexCells(seed, hex);
  const i = hc.cells.findIndex(o => o.cx === c.cx && o.cy === c.cy);
  return hc.land[i].biome;
}

/**
 * The biome a cell's tiles take as its character: its land, except that a river cell takes the
 * land under its river. `hexCells` (and, inside the Reach, `generateReach`) writes `river` over
 * that land, so it's classified again here the way both made it before the river came:
 * `biomeOf(height, moisture)`, with the river leaving the height alone. Without this a river
 * cell would be a 2 km meadow square through a forest.
 */
function baseBiome(seed: number, c: CellXY, land: Biome): Biome {
  if (land !== 'river') return land;
  return biomeOf(worldCell(seed, c).height, cellMoist(seed, c));
}

interface CornerField {
  height: number;
  moist: number;
}

// A chunk's four bilinear corners are the same world cell for every one of its 4,096 tiles (a
// chunk never straddles a cell centre, since those sit on chunk boundaries): worth memoising, since
// a cell's 1,024 chunks share only 9 corner cells between them. An LRU of cells, like the chunk
// cache below, so it holds the cells around wherever the camera is and never grows past that.
const CORNER_MEMO_CELLS = 64;
const cornerMemo = new Map<string, CornerField>();
/**
 * A corner's height and moisture are the cell's own (`worldCell`'s height, `cellMoist`), not the
 * raw world fields: inside the Reach, and blended in the 8-cell band around it, the cell's height
 * isn't `worldHeight`. Reading the raw field there broke the Reach's snowfields, which stand near
 * 1 where the raw field is about 0.5, into Meadow and Forest patches wherever the fine noise broke
 * through (and would put Sea in a high cell standing on low raw noise).
 */
function cornerField(seed: number, cx: number, cy: number): CornerField {
  const key = `${seed}|${cx},${cy}`;
  let v = cornerMemo.get(key);
  if (v !== undefined) {
    cornerMemo.delete(key);
    cornerMemo.set(key, v);
    return v;
  }
  const c = { cx, cy };
  v = { height: worldCell(seed, c).height, moist: cellMoist(seed, c) };
  const oldest = cornerMemo.keys().next();
  if (cornerMemo.size >= CORNER_MEMO_CELLS && !oldest.done) cornerMemo.delete(oldest.value);
  cornerMemo.set(key, v);
  return v;
}

interface ChunkCorners {
  cx0: number;
  cy0: number;
  c00: CornerField;
  c10: CornerField;
  c01: CornerField;
  c11: CornerField;
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

type Side = 'n' | 's' | 'e' | 'w';

// In `traceRiver`'s step order (east, west, south, north), so that picking the lake a river runs
// into breaks an exact tie the way the trace did (see `riverCrossings`).
const DIRS = [
  ['e', 1, 0], ['w', -1, 0], ['s', 0, 1], ['n', 0, -1],
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
function edgeLocalPoint(dir: Side, e: number): { x: number; y: number } {
  const last = CELL_TILES - 1;
  if (dir === 'n') return { x: e, y: 0 };
  if (dir === 's') return { x: e, y: last };
  if (dir === 'w') return { x: 0, y: e };
  return { x: last, y: e };
}

/** Where a river's water line leaves its cell: the side, and the crossing point along it (0..`CELL_TILES` − 1). */
export interface RiverCrossing {
  dir: Side;
  at: number;
}

/**
 * A river cell's crossings: one on each side it shares with a river 4-neighbour.
 *
 * A river that ends in a lake stops one cell short of it (`traceRiver`, and `generateReach` inside
 * the Reach, stop without stepping into the lake), so its last cell has a lake beside it, and a
 * lake cell's tiles are all open water. So a source or mouth (one river neighbour or none) also
 * crosses into the lake the river runs into, and its line meets the water instead of ending at its
 * centre a kilometre short. That lake is the one the trace would have stepped into: the lowest by
 * the trace's own rule (height − 0.04 · dy, the first in step order on a tie). A river cell in the
 * middle of its course (two river neighbours or more) never reaches into a lake beside it, so a
 * river running along a shore doesn't sprout a mouth at every cell.
 */
function riverCrossings(seed: number, c: CellXY): RiverCrossing[] {
  const crossings: RiverCrossing[] = [];
  let lake: { dir: Side; n: CellXY } | undefined;
  let lakeScore = Infinity;
  for (const [dir, dx, dy] of DIRS) {
    const n = { cx: c.cx + dx, cy: c.cy + dy };
    const land = cellLand(seed, n);
    if (land === 'river') crossings.push({ dir, at: edgePoint(seed, c, n) });
    else if (land === 'lake') {
      const score = worldCell(seed, n).height - 0.04 * dy;
      if (score < lakeScore) { lake = { dir, n }; lakeScore = score; }
    }
  }
  if (crossings.length <= 1 && lake !== undefined) crossings.push({ dir: lake.dir, at: edgePoint(seed, c, lake.n) });
  return crossings;
}

/**
 * A river cell's water, in its own local tile coordinates packed as `y * CELL_TILES + x`: a
 * 3-tile-wide line from the cell's centre to each crossing.
 *
 * Two neighbouring cells each draw their own half of a river without seeing the other's, so what
 * they must agree on is their shared border: each cell's border row or column holds water at
 * exactly `at − 1`, `at`, `at + 1` (clipped to the cell) and nowhere else. So the crossing is
 * stamped on the border explicitly, and the line's 3 × 3 brush is kept off every border line.
 * Left to the brush, a line's last steps reach the border at a slant: the step before the border
 * tile can reach one tile further along it (4 water tiles), and `Math.round` breaks .5 ties one
 * way, so a line drawn from the other side can land a tile off. Before the stamp, 2,050 of the
 * 4,096 (crossing point, orientation) pairs came out wrong on at least one side.
 *
 * The water stays unbroken: the brush at the border tile itself still covers the row (or column)
 * just inside, next to the stamp, and each step is within a tile of the one before.
 *
 * Exported for tests: it's pure geometry, checked at every crossing point on every side.
 */
export function riverLineTiles(crossings: readonly RiverCrossing[]): ReadonlySet<number> {
  const last = CELL_TILES - 1;
  const water = new Set<number>();
  const brush = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const mx = x + dx, my = y + dy;
        // The border lines are the crossings' alone (stamped below).
        if (mx < 1 || my < 1 || mx >= last || my >= last) continue;
        water.add(my * CELL_TILES + mx);
      }
  };

  // Every line runs from the centre to a crossing point: with none (an isolated river cell), the
  // centre alone still gets water.
  const centre = CELL_TILES / 2;
  brush(centre, centre);
  for (const { dir, at } of crossings) {
    const to = edgeLocalPoint(dir, at);
    const steps = Math.max(Math.abs(to.x - centre), Math.abs(to.y - centre));
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(centre + (to.x - centre) * t / steps);
      const y = Math.round(centre + (to.y - centre) * t / steps);
      brush(x, y);
    }
    for (let i = Math.max(0, at - 1); i <= Math.min(last, at + 1); i++) {
      const p = edgeLocalPoint(dir, i);
      water.add(p.y * CELL_TILES + p.x);
    }
  }
  return water;
}

/** Every water tile of a river cell, in its own local tile coordinates, packed as `y * CELL_TILES + x`. */
function riverWaterTiles(seed: number, c: CellXY): ReadonlySet<number> {
  return riverLineTiles(riverCrossings(seed, c));
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

/**
 * One of `CELL_TILES / CHUNK` (32) × 32 tile chunks of a cell, `CHUNK` × `CHUNK` tiles, row by row.
 * `chunk.x` and `chunk.y` are integers in 0..31: anything else throws a `RangeError`, because the
 * arithmetic below would otherwise quietly read another cell's tiles under this cell's biome.
 */
export function tileChunk(seed: number, cell: CellXY, chunk: { x: number; y: number }): TileChunk {
  const inCell = (v: number) => Number.isInteger(v) && v >= 0 && v < CHUNKS_PER_CELL;
  if (!inCell(chunk.x) || !inCell(chunk.y))
    throw new RangeError(`tileChunk: chunk (${chunk.x}, ${chunk.y}) is not a chunk of a cell (integers 0..${CHUNKS_PER_CELL - 1})`);

  const key = `${seed}|${cell.cx},${cell.cy}|${chunk.x},${chunk.y}`;
  const hit = chunkCache.get(key);
  if (hit !== undefined) {
    chunkCache.delete(key);
    chunkCache.set(key, hit);
    return copyChunk(hit);
  }

  const land = cellLand(seed, cell);
  const cwBase = REACH_TO_CW_BIOME[baseBiome(seed, cell, land)];
  // A lake (a tarn too, which may sit high) is open water throughout: the fine noise never
  // breaks it up into islands.
  const breaks = land !== 'lake';
  const fine = noiseOf(seed).fine;
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
      biome[idx] = breaks && noise01(fine, tx / 96, ty / 96) > FINE_THRESHOLD ? tileBiomeIdx(elev, temp, moist) : cwBase;
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
