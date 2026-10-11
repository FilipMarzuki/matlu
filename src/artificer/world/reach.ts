/**
 * The Reach as a generated map (#1539, plan: docs/spikes/artificer-generated-world.md).
 *
 * A top-down grid of cells, one cell about half an hour's walk on open ground, made fresh each run from the run's seed
 * (`seedOf(character.id)`, the same seed everything else in the run uses). No graphics: the map is
 * drawn as text, one character per cell. Pure and deterministic, so the same seed always makes the
 * same land, AI playtests replay, and tests can pin it.
 *
 * The shape of the land: high fells along the north (where the pass is), a valley running down
 * through birch and pine, and low ground in the south with marsh and lakes. Rivers run downhill
 * from the high ground. Camp sits in the valley.
 *
 * Phase 1 shows the map; play still uses the three rings (exploration.ts). `ringOfHours` maps each
 * cell onto those rings by its walking time from camp, so the map can show what you've scouted.
 */

import { createNoise2D } from 'simplex-noise';
import { generator, seedOf } from '../rng';
import { domainsOf, level, type Exploration, type Ring } from '../exploration';

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

/** One character per biome, plus camp and the unknown. */
export const GLYPH: Readonly<Record<Biome | 'camp' | 'unknown', string>> = {
  lake: '~', river: '≈', marsh: '"', meadow: '.', heath: ',', birch: 't', pine: 'T', scree: 'n', fell: '^', snow: '*', camp: '@', unknown: '·',
};

export const BIOME_NAME: Readonly<Record<Biome, string>> = {
  lake: 'Lake', river: 'River', marsh: 'Marsh', meadow: 'Meadow', heath: 'Heath', birch: 'Birch wood', pine: 'Pine forest', scree: 'Scree', fell: 'Fell', snow: 'Snowfield',
};

/** What a cell can give, in the rings' own terms (exploration.ts domains, minus routes). */
export type Yield = 'forage' | 'timber' | 'stone' | 'water' | 'game';
export const YIELDS: Readonly<Record<Biome, readonly Yield[]>> = {
  lake: ['water', 'game'], river: ['water', 'game'], marsh: ['forage', 'water', 'game'], meadow: ['forage', 'game'],
  heath: ['forage'], birch: ['timber', 'forage', 'game'], pine: ['timber', 'game'], scree: ['stone'], fell: ['stone', 'game'], snow: [],
};

/** Hours to cross a cell on foot: half an hour on open ground, more in wood, bog and on the fells. Open water can't be walked. */
export const COST: Readonly<Record<Biome, number>> = {
  lake: Infinity, river: 0.75, marsh: 1, meadow: 0.5, heath: 0.5, birch: 0.6, pine: 0.75, scree: 1, fell: 1.25, snow: 1.5,
};

/** Fractal noise in [0, 1]: a few octaves of simplex noise, each finer and fainter. */
function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
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

function biomeOf(height: number, moist: number): Biome {
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

/** Hours on foot from camp to every cell (Dijkstra over the crossing cost of each cell entered). */
function walkingHours(cells: readonly Cell[], w: number, h: number, camp: { x: number; y: number }): number[] {
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

/**
 * Which ring a walk of this many hours falls in. The near ring is home ground (up to 3 hours
 * out), and the far and distant rings sit at the +3h and +6h of travel (exploration.ts). Beyond
 * nine hours is outside what a day's work from camp can reach: the rest of the Reach, for the
 * road and later phases.
 */
export function ringOfHours(hours: number): Ring | null {
  if (hours <= 3) return 1;
  if (hours <= 6) return 2;
  if (hours <= 9) return 3;
  return null;
}

/** How much the Warden can see of a cell: 0 unknown, 1 glimpsed, 2+ known (the ring's best level). */
export type Sight = (x: number, y: number) => number;

/** Up to this many hours out, the land is in plain view from camp, scouted or not. */
export const IN_VIEW_HOURS = 2;

/**
 * What the Warden knows of each cell, from the rings' knowledge (exploration.ts): the land within
 * two hours of camp is in view (you look around when you arrive), and beyond that a cell shows as
 * much as you know of its ring (its best domain level). Cells past the distant ring stay unknown in
 * phase 1.
 */
export function sightFor(reach: Reach, e: Exploration): Sight {
  const best = (r: Ring) => Math.max(...domainsOf(r).map(d => level(e, r, d)));
  const ringSight: Record<Ring, number> = { 1: best(1), 2: best(2), 3: best(3) };
  return (x, y) => {
    const hrs = reach.hours[y * reach.w + x];
    if (hrs <= IN_VIEW_HOURS) return Math.max(1, ringSight[1]);
    const ring = ringOfHours(hrs);
    return ring ? ringSight[ring] : 0;
  };
}

/** The map as text rows, one character per cell, with camp as @ and unseen cells as ·. */
export function mapRows(reach: Reach, sight: Sight = () => 3): string[] {
  const rows: string[] = [];
  for (let y = 0; y < reach.h; y++) {
    let row = '';
    for (let x = 0; x < reach.w; x++) {
      if (x === reach.camp.x && y === reach.camp.y) row += GLYPH.camp;
      else row += sight(x, y) > 0 ? GLYPH[reach.cells[y * reach.w + x].biome] : GLYPH.unknown;
    }
    rows.push(row);
  }
  return rows;
}

/** A one-line description of a cell: what it is, what it gives and how far it is from camp. */
export function describeCell(reach: Reach, x: number, y: number): string {
  const i = y * reach.w + x;
  const c = reach.cells[i];
  const hrs = reach.hours[i];
  const where = x === reach.camp.x && y === reach.camp.y ? 'your camp' : Number.isFinite(hrs) ? `${Math.round(hrs * 2) / 2}h from camp` : 'across open water';
  const ring = ringOfHours(hrs);
  const band = ring === 1 ? 'home ground' : ring === 2 ? 'the far ring' : ring === 3 ? 'the distant ring' : 'beyond a day out';
  const yields = YIELDS[c.biome].length ? YIELDS[c.biome].join(', ') : 'nothing';
  return `${BIOME_NAME[c.biome]} — ${where}, ${band}. Gives: ${yields}.`;
}
