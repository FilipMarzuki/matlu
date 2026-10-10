/**
 * The Reach split into provinces (#1540, plan: docs/spikes/artificer-generated-world.md).
 *
 * The history engine (`storytelling/`) thinks in provinces joined by a neighbour graph, with no
 * coordinates. This turns the grid (reach.ts) into that: pick a seat for each province where people
 * would settle, grow every province out from its seat by walking time, and read each one's terrain,
 * water, people and name off its cells. history.ts feeds the result to the engine.
 *
 * Pure and deterministic, like the grid: the same seed gives the same provinces, so a reload can
 * rebuild them from the seed instead of saving them. Its own stream (`seed|world|provinces`) keeps
 * the grid's streams untouched.
 */

import type { Terrain } from '../../../storytelling/types';
import { generator, seedOf } from '../rng';
import { COST, type Biome, type Reach } from './reach';
import type { ReachCulture } from './peoples';

export interface Province {
  /** `p0`, `p1`… in the order the seats were picked (the best site first). */
  id: string;
  name: string;
  /** The seat: where its people first settled, and where its lords sit. */
  seat: { x: number; y: number };
  /** Indices into `reach.cells`. */
  cells: number[];
  /** What the land mostly is, in the engine's terms. */
  terrain: Terrain;
  /** 0 to 1: how well the land feeds people. */
  fertility: number;
  /** Borders a lake (the Reach has no sea; its lakes are fished and crossed by boat). */
  lakeside: boolean;
  river: boolean;
  /** Province ids sharing a border, in id order. */
  neighbors: string[];
  population: number;
  /** 0 to 1: the engine's mana density. Higher on the old, high ground. */
  mana: number;
  culture: ReachCulture;
}

export interface Provinces {
  list: Province[];
  /** The province index of each cell (same indexing as `reach.cells`). */
  at: Int16Array;
}

/** About one province per this many cells: 1,536 cells → about 11. */
const CELLS_PER_PROVINCE = 140;
/** Seats at least this far apart (in cells, straight line), so provinces come out a fair size. */
const SEAT_SPACING = 8;
/** And this far from camp: the Warden camps in the wilds, not in someone's village. */
const CAMP_CLEARANCE = 4;

/** How good a cell is to settle on. Rivers and lakes next to it count extra (see `seatScore`). */
const SETTLE: Readonly<Partial<Record<Biome, number>>> = {
  meadow: 1, birch: 0.8, heath: 0.7, pine: 0.6, marsh: 0.25, scree: 0.3, fell: 0.1,
};

/** How well each kind of land feeds people (the engine's 0–1 fertility). */
const FERTILITY: Readonly<Record<Biome, number>> = {
  meadow: 0.8, river: 0.75, birch: 0.6, heath: 0.45, pine: 0.45, marsh: 0.35, lake: 0.5, scree: 0.2, fell: 0.1, snow: 0,
};

/** The engine's terrain for each land biome. Rivers and lakes don't set a province's terrain. */
const TERRAIN: Readonly<Partial<Record<Biome, Terrain>>> = {
  meadow: 'meadow', heath: 'plains', birch: 'forest', pine: 'forest', marsh: 'swamp', scree: 'hills', fell: 'mountain', snow: 'mountain',
};

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Split a Reach into provinces. Every cell, open water included, belongs to exactly one. */
export function provincesOf(reach: Reach): Provinces {
  const { w, h, cells } = reach;
  const rnd = generator(seedOf(`${reach.seed}|world|provinces`));
  const seats = pickSeats(reach, rnd);

  // Grow every province out from its seat at once, always extending the province whose frontier
  // is the shortest walk from its seat (a multi-source Dijkstra over the same crossing cost the
  // map uses). A cell joins whichever seat reaches it first, so borders fall along ridges, bogs and
  // rivers, where the walking gets hard: much as real parishes and holds divide.
  const at = new Int16Array(cells.length).fill(-1);
  const dist = cells.map(() => Infinity);
  seats.forEach((s, p) => { const i = s.y * w + s.x; at[i] = p; dist[i] = 0; });
  const done = new Uint8Array(cells.length);
  for (;;) {
    let i = -1;
    for (let j = 0; j < cells.length; j++) if (!done[j] && dist[j] < Infinity && (i === -1 || dist[j] < dist[i])) i = j;
    if (i === -1) break;
    done[i] = 1;
    for (const j of around(i, w, h)) {
      const d = dist[i] + COST[cells[j].biome];
      if (d < dist[j]) { dist[j] = d; at[j] = at[i]; }
    }
  }
  // Open water can't be walked, so lakes are left over: each lake cell goes to the province of the
  // nearest claimed cell (a breadth-first flood out from the shores), splitting a lake between the
  // provinces around it.
  let frontier = cells.map((_c, i) => i).filter(i => at[i] >= 0);
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) for (const j of around(i, w, h)) if (at[j] < 0) { at[j] = at[i]; next.push(j); }
    frontier = next;
  }

  const names = new Set<string>(ANCHOR_NAMES);
  const list = seats.map((seat, p): Province => {
    const mine = cells.map((_c, i) => i).filter(i => at[i] === p);
    const land = mine.filter(i => cells[i].biome !== 'lake' && cells[i].biome !== 'river');
    const lakeCells = mine.filter(i => cells[i].biome === 'lake').length;
    const terrain = mostCommon(land.map(i => TERRAIN[cells[i].biome]!)) ?? 'meadow';
    const fertility = round2(mine.reduce((s, i) => s + FERTILITY[cells[i].biome], 0) / mine.length);
    const height = mine.reduce((s, i) => s + cells[i].height, 0) / mine.length;
    const lakeside = lakeCells >= 3;
    const river = mine.some(i => cells[i].biome === 'river');
    const culture = cultureOf(mine.map(i => cells[i].biome));
    return {
      id: `p${p}`,
      name: placeName(rnd, terrain, lakeside, river, names),
      seat,
      cells: mine,
      terrain,
      fertility,
      lakeside,
      river,
      neighbors: [],
      population: Math.round(40 + fertility * land.length * 5),
      mana: round2(0.2 + 0.6 * height),
      culture,
    };
  });
  // Borders: two provinces are neighbours if any of their cells touch (across lakes too: there are boats).
  const touching = list.map(() => new Set<number>());
  for (let i = 0; i < cells.length; i++) {
    for (const j of around(i, w, h)) if (at[j] !== at[i]) { touching[at[i]].add(at[j]); touching[at[j]].add(at[i]); }
  }
  list.forEach((p, k) => { p.neighbors = [...touching[k]].sort((a, b) => a - b).map(n => `p${n}`); });
  return { list, at };
}

/**
 * Who settles a province, from its mix of land. Most of the Reach is wood, so the dominant land
 * alone would make nearly everyone fieldborn: instead a culture claims a province where its own
 * kind of land makes up a fair share. Checked in order, wettest and highest first.
 */
function cultureOf(biomes: readonly Biome[]): ReachCulture {
  const share = (...bs: Biome[]) => biomes.filter(b => bs.includes(b)).length / biomes.length;
  if (share('lake', 'marsh') >= 0.2) return 'waterstead'; // fishers and boat-folk, the Pandor of the meres
  if (share('fell', 'snow') >= 0.3) return 'mountainhold'; // Bergfolk halls under the fells
  if (share('scree', 'fell', 'snow') >= 0.2 || share('pine') > share('birch', 'meadow')) return 'ridgefolk'; // the wooded heights
  if (share('heath') >= 0.25) return 'steppe-camp'; // Viddfolk on the open heath
  return 'fieldborn'; // farmers of the meadows and the birch-lands
}

/**
 * Seats: the best places to settle (good land, water close by), taken best first while they're
 * far enough from each other and from camp. A little noise in the score means two equally good
 * meadows don't always fall the same way.
 */
function pickSeats(reach: Reach, rnd: () => number): { x: number; y: number }[] {
  const { w, cells, camp } = reach;
  const target = Math.max(6, Math.round(cells.length / CELLS_PER_PROVINCE));
  const scored: { i: number; score: number }[] = [];
  for (let i = 0; i < cells.length; i++) {
    const base = SETTLE[cells[i].biome];
    const noise = rnd(); // drawn for every cell, so the stream doesn't depend on which cells qualify
    if (base === undefined) continue;
    scored.push({ i, score: base + seatWater(i, reach) + 0.3 * noise });
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const seats: { x: number; y: number }[] = [];
  for (const { i } of scored) {
    if (seats.length >= target) break;
    const x = i % w, y = Math.floor(i / w);
    if (Math.hypot(x - camp.x, y - camp.y) < CAMP_CLEARANCE) continue;
    if (seats.some(s => Math.hypot(s.x - x, s.y - y) < SEAT_SPACING)) continue;
    seats.push({ x, y });
  }
  return seats;
}

/** Fresh water beside a cell makes it a better seat: a river or lake next door, +0.5. */
function seatWater(i: number, reach: Reach): number {
  for (const j of around(i, reach.w, reach.h)) {
    const b = reach.cells[j].biome;
    if (b === 'river' || b === 'lake') return 0.5;
  }
  return 0;
}

/** The in-bounds cells beside cell i (four directions). */
function around(i: number, w: number, h: number): number[] {
  const x = i % w, y = Math.floor(i / w), out: number[] = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
  }
  return out;
}

function mostCommon<T>(items: readonly T[]): T | undefined {
  const count = new Map<T, number>();
  for (const t of items) count.set(t, (count.get(t) ?? 0) + 1);
  let best: T | undefined, n = 0;
  for (const [t, c] of count) if (c > n) { best = t; n = c; }
  return best;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The hand-written places (villages.ts and the road), never given to a generated province. */
const ANCHOR_NAMES = ['Hollowford', 'Saltmere', 'Kestrel Gate', 'Mistheim'];

/** First halves of place names: animals, trees and the look of the land. */
const NAME_START = [
  'Alder', 'Ash', 'Birch', 'Black', 'Bright', 'Cold', 'Crane', 'Elk', 'Fern', 'Frost', 'Grey', 'Hare', 'Heron', 'Kettle', 'Long',
  'Lynx', 'Moss', 'Otter', 'Raven', 'Rowan', 'Sedge', 'Stone', 'Thorn', 'White', 'Willow', 'Wolf', 'Wren', 'Yew',
];

/** Second halves, by what the place is: a ford on a river, a mere by a lake, a fell on the heights. */
const NAME_END: Readonly<Record<Terrain | 'river' | 'lake', readonly string[]>> = {
  river: ['ford', 'brook', 'bridge', 'wick'],
  lake: ['mere', 'water', 'holm', 'hithe'],
  meadow: ['stead', 'field', 'ham', 'ley'],
  plains: ['moor', 'heath', 'down'],
  forest: ['wood', 'holt', 'shaw', 'hurst'],
  swamp: ['fen', 'mire', 'moss'],
  hills: ['ridge', 'scar', 'crag'],
  mountain: ['fell', 'howe', 'gate'],
  coast: ['mere'], steppe: ['moor'], desert: ['moor'], jungle: ['wood'],
};

/** A name for a province, from its land and water, never one already used. */
function placeName(rnd: () => number, terrain: Terrain, lakeside: boolean, river: boolean, used: Set<string>): string {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  for (let tries = 0; tries < 50; tries++) {
    // Water names a place more often than land does: people say "the ford", not "the meadow".
    const kind = river && rnd() < 0.5 ? 'river' : lakeside && rnd() < 0.5 ? 'lake' : terrain;
    const start = pick(NAME_START), end = pick(NAME_END[kind]);
    // "Stonestead", but "Wolf Gate" for the two-word endings.
    const name = end === 'gate' || end === 'bridge' ? `${start} ${end[0].toUpperCase()}${end.slice(1)}` : `${start}${end}`;
    if (!used.has(name)) { used.add(name); return name; }
  }
  // 28 × 4 names for each kind of land, so this is only a guard.
  const name = `${pick(NAME_START)}${pick(NAME_END[terrain])} ${used.size}`;
  used.add(name);
  return name;
}
