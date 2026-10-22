/**
 * The Reach: the start of the world, a 48 × 32-cell map made fresh from a seed (#1539, moved here
 * from src/artificer/world/reach.ts in #1895; plan: docs/spikes/artificer-hex-world.md §3).
 *
 * A top-down grid of cells, one cell about half an hour's walk on open ground. High fells along
 * the north (where the pass is), a valley running down through birch and pine, and low ground in
 * the south with marsh and lakes. Rivers run downhill from the high ground. Camp sits in the
 * valley. Pure and deterministic, so the same seed always makes the same land.
 *
 * Why it lives in worldmap/: the world generator lays the Reach into the wider world (#1896), so
 * it has to make the Reach itself, and worldmap/ may not import from either game (src/). The
 * Artificer still imports all of this from `src/artificer/world/reach.ts`, which re-exports it and
 * keeps the parts that need the Artificer (glyphs, yields, rings, sight).
 *
 * The code below was moved without changing a character, so every seed gives the same land as
 * before: the golden hashes in `src/artificer/world/reach.test.ts` didn't move. The only changes
 * are `export` on `fbm` and `biomeOf`, so the wider world (#1896) can use the same noise and the
 * same biome list. If you change a draw here, every Reach and every Artificer replay changes.
 */

import { createNoise2D } from 'simplex-noise';
import { generator, seedOf } from './rng';

export const REACH_W = 48;
export const REACH_H = 32;

export type Biome = 'lake' | 'river' | 'marsh' | 'meadow' | 'heath' | 'birch' | 'pine' | 'scree' | 'fell' | 'snow';

export interface Cell {
  biome: Biome;
  /** 0 (lowest) to 1 (highest). */
  height: number;
}

export interface Reach {
  seed: number;
  w: number;
  h: number;
  /** Row by row: the cell at (x, y) is `cells[y * w + x]`. */
  cells: Cell[];
  camp: { x: number; y: number };
  /** Hours on foot from camp to each cell (Infinity across open water), same indexing as `cells`. */
  hours: number[];
}

/** Hours to cross a cell on foot: half an hour on open ground, more in wood, bog and on the fells. Open water can't be walked. */
export const COST: Readonly<Record<Biome, number>> = {
  lake: Infinity, river: 0.75, marsh: 1, meadow: 0.5, heath: 0.5, birch: 0.6, pine: 0.75, scree: 1, fell: 1.25, snow: 1.5,
};

/** Fractal noise in [0, 1]: a few octaves of simplex noise, each finer and fainter. */
export function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return (sum / norm + 1) / 2;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function biomeOf(height: number, moist: number): Biome {
  if (height > 0.86) return 'snow';
  if (height > 0.76) return 'fell';
  if (height > 0.68) return 'scree';
  if (height < 0.16) return 'lake';
  if (height < 0.3 && moist > 0.58) return 'marsh';
  if (moist > 0.52 && height > 0.34) return 'pine';
  if (moist > 0.44) return 'birch';
  if (moist < 0.36) return 'heath';
  return 'meadow';
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Make the Reach for a run. Each part draws from its own stream (`seedOf(seed|world|…)`), so
 * adding a feature later doesn't reshuffle the others, and none of it touches the sim's streams.
 */
export function generateReach(seed: number): Reach {
  const w = REACH_W, h = REACH_H;
  const stream = (salt: string) => generator(seedOf(`${seed}|world|${salt}`));
  const heightNoise = createNoise2D(stream('height'));
  const moistNoise = createNoise2D(stream('moisture'));
  // Which flank also rises (west or east), so not every Reach is the same valley.
  const flank = stream('flank')() < 0.5 ? -1 : 1;

  const height: number[] = [];
  const moist: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w, ny = y / h;
      // North is high (the fells and the pass), one flank rises, the south is low.
      const north = (1 - ny) ** 1.6;
      const side = flank < 0 ? (1 - nx) ** 3 : nx ** 3;
      const shape = 0.62 * north + 0.22 * side;
      height.push(clamp01(0.48 * fbm(heightNoise, nx * 3.2, ny * 3.2, 5) + shape - 0.08));
      moist.push(fbm(moistNoise, nx * 2.6 + 7, ny * 2.6 + 3, 4));
    }
  }
  const cells: Cell[] = height.map((ht, i) => ({ biome: biomeOf(ht, moist[i]), height: ht }));

  // Rivers: from springs high on the fells, always take the lowest neighbour not yet on this
  // river, so a river carves through small dips instead of stopping in them, until it reaches a
  // lake, another river or the edge of the map. One boxed in by its own course ends in a tarn.
  const springs = stream('springs');
  // Springs sit on the scree and fells, away from the map's edge so a river has somewhere to run.
  const highs = cells.map((_c, i) => i).filter(i => (cells[i].biome === 'scree' || cells[i].biome === 'fell') && i % w >= 4 && i % w < w - 4);
  const riverCount = Math.min(highs.length, 3 + Math.floor(springs() * 3));
  for (let n = 0; n < riverCount; n++) {
    let i = highs[Math.floor(springs() * highs.length)];
    const course = new Set<number>();
    for (let steps = 0; steps < w * h; steps++) {
      course.add(i);
      const x = i % w, y = Math.floor(i / w);
      if (cells[i].biome !== 'lake') cells[i] = { ...cells[i], biome: 'river' };
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) break;
      // The lowest neighbour, with a slight pull south (down the valley), so a river crossing
      // flat ground keeps going instead of spreading into a pool.
      let next = -1, nextScore = Infinity;
      for (const [dx, dy] of NEIGHBOURS) {
        const j = (y + dy) * w + (x + dx);
        if (course.has(j)) continue;
        const score = height[j] - 0.04 * dy;
        if (score < nextScore) { next = j; nextScore = score; }
      }
      if (next === -1) { cells[i] = { ...cells[i], biome: 'lake' }; break; }
      if (cells[next].biome === 'lake' || cells[next].biome === 'river') break;
      i = next;
    }
  }

  const camp = campSite(cells, w, h, stream('camp'));
  return { seed, w, h, cells, camp, hours: walkingHours(cells, w, h, camp) };
}

/** Camp: the walkable cell nearest a spot on the valley floor, a little south of the middle (moved a little each run). */
function campSite(cells: readonly Cell[], w: number, h: number, rnd: () => number): { x: number; y: number } {
  const tx = w / 2 + (rnd() - 0.5) * 12, ty = h * 0.6 + (rnd() - 0.5) * 6;
  let best = { x: Math.floor(tx), y: Math.floor(ty) }, bestD = Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = cells[y * w + x].biome;
      if (b !== 'meadow' && b !== 'heath' && b !== 'birch' && b !== 'pine') continue;
      const d = (x - tx) ** 2 + (y - ty) ** 2;
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

// A walk from any square to every other, for the camp sites (#1732) and the distances from camp
// (#1752). A few milliseconds each, and the app and the AI ask often, so the last few are kept.
const walks = new Map<string, number[]>();
/** Hours on foot from this square of the Reach to every cell: its own `hours` from the camp square, else a kept walk. */
export function walkFrom(r: Reach, x: number, y: number): number[] {
  if (x === r.camp.x && y === r.camp.y) return r.hours;
  const key = `${r.seed}|${x},${y}`;
  let w = walks.get(key);
  if (!w) {
    w = walkingHours(r.cells, r.w, r.h, { x, y });
    if (walks.size >= 16) walks.delete(walks.keys().next().value as string);
    walks.set(key, w);
  }
  return w;
}

/** Hours on foot from camp (or any square) to every cell (Dijkstra over the crossing cost of each cell entered). */
export function walkingHours(cells: readonly Cell[], w: number, h: number, camp: { x: number; y: number }): number[] {
  const hours = cells.map(() => Infinity);
  const start = camp.y * w + camp.x;
  hours[start] = 0;
  const done = new Uint8Array(cells.length);
  // The map is small (1,536 cells), so a plain scan for the nearest open cell is fast enough.
  for (;;) {
    let i = -1;
    for (let j = 0; j < hours.length; j++) if (!done[j] && hours[j] < Infinity && (i === -1 || hours[j] < hours[i])) i = j;
    if (i === -1) break;
    done[i] = 1;
    const x = i % w, y = Math.floor(i / w);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const t = hours[i] + COST[cells[j].biome];
      if (t < hours[j]) hours[j] = t;
    }
  }
  return hours;
}
