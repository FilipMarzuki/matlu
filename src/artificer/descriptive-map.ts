/**
 * The land described, not mapped, until you draw your own map (#1686, switch `descriptive-map`).
 *
 * The owner's idea: a scout dropped into a new world has no map of it (the one in the pack shows
 * somewhere else), so at the start you only know the land the way you'd tell it to a friend:
 * "the stream is west, a quarter hour or so", "forest starts about ten minutes east", "higher
 * ground to the north; you haven't been". The compass from the pack makes the bearings exact.
 * Once you know home ground well and have something to draw on (the notebook, a hide, a sheet of
 * birch bark), you draw a map of your own, and it shows only what you've seen.
 *
 * Pure and deterministic. Everything comes from what the run already has: the Reach (generated
 * from the run's seed on its own streams, world/reach.ts), what you know of each ring
 * (exploration.ts), the pack and the one-way flags. Nothing new is saved and nothing draws on a
 * random stream: "the map is drawn" is worked out from state that only ever grows (knowledge never
 * drops, the pack never changes, the flags are one-way), so once drawn it stays drawn.
 */

import { featureOn } from './features';
import { hasKit, hasExtra } from './kit';
import { seedOf } from './rng';
import { domainsOf, level, type Domain, type Ring } from './exploration';
import { generateReach, sightFor, mapRows, ringOfHours, COST, IN_VIEW_HOURS, type Biome, type Reach, type Sight } from './world/reach';
import type { Region1State } from './region1';

/** The rule switch (features.ts). */
export const DESCRIPTIVE_MAP = 'descriptive-map';

/** What a run needs for this: its switches, who it is (the seed), what it knows and what it packed. */
type Run = Pick<Region1State, 'config' | 'character' | 'explore' | 'kit' | 'flags'>;

export const descriptiveMapOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, DESCRIPTIVE_MAP);

// ── The Reach of a run ──────────────────────────────────────────────────────
// The same land the app's MAP tab draws: generated from `seedOf(character.id)`. It takes a few
// milliseconds, and the AI asks for it every day, so the last one is kept.
let cached: Reach | null = null;
export function reachOfRun(s: Pick<Region1State, 'character'>): Reach {
  const seed = seedOf(s.character.id);
  if (cached?.seed !== seed) cached = generateReach(seed);
  return cached;
}

// ── Places ──────────────────────────────────────────────────────────────────

/** The kinds of place a scout would name. Each is described at its nearest square you know of. */
export type PlaceKind = 'stream' | 'lake' | 'marsh' | 'birch' | 'pine' | 'open' | 'high';

const KIND_OF: Readonly<Record<Biome, PlaceKind>> = {
  river: 'stream', lake: 'lake', marsh: 'marsh', birch: 'birch', pine: 'pine', meadow: 'open', heath: 'open', scree: 'high', fell: 'high', snow: 'high',
};
/** In the order they're listed when two are as far away. */
const KINDS: readonly PlaceKind[] = ['stream', 'lake', 'marsh', 'birch', 'pine', 'open', 'high'];

/** What knowing a place better means: the ring's domain that kind of place is about. */
const DOMAIN_OF: Readonly<Record<PlaceKind, Domain>> = { stream: 'water', lake: 'water', marsh: 'water', birch: 'timber', pine: 'timber', open: 'forage', high: 'stone' };

/** How a scout starts the sentence ("The stream is west…"). */
const SUBJECT: Readonly<Record<PlaceKind, string>> = {
  stream: 'The stream is', lake: 'There\'s a lake', marsh: 'Boggy ground starts', birch: 'Birch wood starts', pine: 'Pine forest starts', open: 'Open ground starts', high: 'Higher ground rises',
};
/** Where camp itself is, as the first line. */
const CAMP_LINE: Readonly<Record<Biome, string>> = {
  meadow: 'Camp is in a meadow.', heath: 'Camp is on open heath.', birch: 'Camp is among birches.', pine: 'Camp is in the pines.',
  marsh: 'Camp is on boggy ground.', river: 'Camp is by the stream.', lake: 'Camp is by the lake.', scree: 'Camp is on scree.', fell: 'Camp is on the fell.', snow: 'Camp is on the snow.',
};

export interface KnownPlace {
  kind: PlaceKind;
  /** The square it's described at: the nearest one of its kind that you know of. */
  at: { x: number; y: number };
  /** Hours on foot from camp to its edge. */
  hours: number;
  /** Compass bearing from camp, degrees clockwise from north. */
  bearing: number;
  /** Exact bearing (the compass) and exact walking time (the compass, or the ring surveyed). */
  exactBearing: boolean;
  exactTime: boolean;
  /** Seen only from afar (high ground on the skyline): you haven't been. */
  horizon: boolean;
  /** As a scout would say it. */
  text: string;
  /**
   * The same words as parts (#1707), for the page to say in the viewer's language: the bearing as
   * an index (of eight points with the compass, of four without) and the walking time as a band.
   * `text` stays the English the AI reads; the app's English rendering of these equals it.
   */
  dir: { exact: boolean; i: number };
  time: TimeWord;
}

/** A walking time as a band of words (#1707): `n` is the minutes or hours where the words carry a number. */
export type TimeWord =
  | { band: 'minutes' | 'hours' | 'hoursHalf'; n: number }
  | { band: 'hour' | 'hourHalf' | 'few' | 'quarter' | 'half' | 'better' | 'hourish' | 'couple' | 'halfDay' | 'day' };

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Hours from camp to the edge of a square: out of camp's own square (half its crossing), then
 * across the squares between (`hours` of the neighbour you step in from counts its whole
 * crossing). Open water has no walking time of its own, so a lake's edge is its shore.
 */
function edgeHours(r: Reach, x: number, y: number): number {
  const half = COST[r.cells[r.camp.y * r.w + r.camp.x].biome] / 2;
  let best = Infinity;
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
    best = Math.min(best, r.hours[ny * r.w + nx]);
  }
  return half + best;
}

/** A lake square is seen from its shore: open water has no ring of its own (its walking time is Infinity). */
function withShores(r: Reach, sight: Sight): Sight {
  return (x, y) => {
    if (r.cells[y * r.w + x].biome !== 'lake') return sight(x, y);
    let best = 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < r.w && ny < r.h && r.cells[ny * r.w + nx].biome !== 'lake') best = Math.max(best, sight(nx, ny));
    }
    return best;
  };
}

const EXACT_DIRS = ['due north', 'north-east', 'due east', 'south-east', 'due south', 'south-west', 'due west', 'north-west'] as const;
const VAGUE_DIRS = ['north-ish', 'east-ish', 'south-ish', 'west-ish'] as const;

/** Degrees clockwise from north, from camp to (x, y). Screen y grows southwards. */
const bearingOf = (r: Reach, x: number, y: number): number => (Math.atan2(x - r.camp.x, r.camp.y - y) * 180 / Math.PI + 360) % 360;

/** Which of the points a bearing is: of eight with the compass, of four (roughly) without. */
export const directionIndex = (bearing: number, exact: boolean): number => (exact ? Math.round(bearing / 45) % 8 : Math.round(bearing / 90) % 4);

/** The compass gives one of eight points ("due west", "north-east"); without it, one of four, roughly ("west-ish"). */
export function directionWords(bearing: number, exact: boolean): string {
  return exact ? EXACT_DIRS[directionIndex(bearing, true)] : VAGUE_DIRS[directionIndex(bearing, false)];
}

/** A walking time's band: to the nearest five minutes or half hour when sure, in rough bands when not. */
export function timeWord(hours: number, exact: boolean): TimeWord {
  const m = hours * 60;
  if (exact) {
    if (m < 55) return { band: 'minutes', n: Math.max(5, Math.round(m / 5) * 5) };
    const h = Math.round(m / 30) / 2;
    if (h === 1) return { band: 'hour' };
    if (h === 1.5) return { band: 'hourHalf' };
    return Number.isInteger(h) ? { band: 'hours', n: h } : { band: 'hoursHalf', n: Math.floor(h) };
  }
  if (m <= 10) return { band: 'few' };
  if (m <= 22) return { band: 'quarter' };
  if (m <= 40) return { band: 'half' };
  if (m <= 55) return { band: 'better' };
  if (m <= 80) return { band: 'hourish' };
  if (m <= 150) return { band: 'couple' };
  if (m <= 270) return { band: 'halfDay' };
  return { band: 'day' };
}

const TIME_TEXT: Readonly<Record<TimeWord['band'], (n: number) => string>> = {
  minutes: n => `about ${n} minutes`, hour: () => 'about an hour', hourHalf: () => 'about an hour and a half',
  hours: n => `about ${n} hours`, hoursHalf: n => `about ${n} and a half hours`,
  few: () => 'a few minutes', quarter: () => 'maybe a quarter hour', half: () => 'maybe half an hour', better: () => 'the better part of an hour',
  hourish: () => 'an hour or so', couple: () => 'a couple of hours', halfDay: () => 'half a day\'s walk or so', day: () => 'the best part of a day',
};

/** A walking time as a scout would say it: to the nearest five minutes or half hour when sure, in rough bands when not. */
export function timeWords(hours: number, exact: boolean): string {
  const w = timeWord(hours, exact);
  return TIME_TEXT[w.band]('n' in w ? w.n : 0);
}

/**
 * The places you know of, nearest first (the skyline last): for each kind of place, its nearest
 * square that you've seen (in view from camp, or in a ring you've scouted), with a bearing and a
 * walking time. High ground shows on the skyline before you've been near it. Camp's own kind of
 * ground isn't listed (you're standing in it: the camp line says so).
 */
export function knownPlaces(s: Run): KnownPlace[] {
  if (!descriptiveMapOn(s)) return [];
  const r = reachOfRun(s);
  const sight = withShores(r, sightFor(r, s.explore));
  const campKind = KIND_OF[r.cells[r.camp.y * r.w + r.camp.x].biome];
  const compass = hasKit(s, 'map-compass');
  const nearest = new Map<PlaceKind, { i: number; hours: number; seen: boolean }>();
  for (let i = 0; i < r.cells.length; i++) {
    const x = i % r.w, y = Math.floor(i / r.w);
    if (x === r.camp.x && y === r.camp.y) continue;
    const kind = KIND_OF[r.cells[i].biome];
    if (kind === campKind) continue;
    const seen = sight(x, y) > 0;
    // Only high ground can be known unseen: it stands on the skyline.
    if (!seen && kind !== 'high') continue;
    const hours = edgeHours(r, x, y);
    if (!Number.isFinite(hours)) continue;
    const had = nearest.get(kind);
    // A seen square beats one on the skyline; then the nearer; ties go to the earlier square, so it's deterministic.
    if (!had || (seen && !had.seen) || (seen === had.seen && hours < had.hours)) nearest.set(kind, { i, hours, seen });
  }
  const out: KnownPlace[] = [];
  for (const kind of KINDS) {
    const p = nearest.get(kind);
    if (!p) continue;
    const x = p.i % r.w, y = Math.floor(p.i / r.w);
    const bearing = bearingOf(r, x, y);
    // Beyond a day out counts as the distant ring: the furthest you know of.
    const ring: Ring = ringOfHours(p.hours) ?? 3;
    // Surveying sharpens it: knowing that ring's ground for this kind of place (observed or better) gives a sure walking time.
    const exactTime = compass || level(s.explore, ring, DOMAIN_OF[kind]) >= 2;
    const dir = directionWords(bearing, compass);
    const text = p.seen ? `${SUBJECT[kind]} ${dir}, ${timeWords(p.hours, exactTime)}.` : `${SUBJECT[kind]} ${dir}; you haven't been.`;
    out.push({
      kind, at: { x, y }, hours: p.hours, bearing, exactBearing: compass, exactTime: p.seen && exactTime, horizon: !p.seen, text,
      dir: { exact: compass, i: directionIndex(bearing, compass) }, time: timeWord(p.hours, exactTime),
    });
  }
  return out.sort((a, b) => Number(a.horizon) - Number(b.horizon) || a.hours - b.hours);
}

/** The ground camp stands on (the description's first line). */
export function campBiome(s: Pick<Region1State, 'character'>): Biome {
  const r = reachOfRun(s);
  return r.cells[r.camp.y * r.w + r.camp.x].biome;
}

/** What you know of the land, as lines: where camp is, then each place. Empty with the switch off. */
export function describeLand(s: Run): string[] {
  if (!descriptiveMapOn(s)) return [];
  return [CAMP_LINE[campBiome(s)], ...knownPlaces(s).map(p => p.text)];
}

// ── Drawing your own map ────────────────────────────────────────────────────

export type MapSurface = 'notebook' | 'hide' | 'bark';
export const SURFACE_WORDS: Readonly<Record<MapSurface, string>> = {
  notebook: 'the notebook and pencil', hide: 'a scraped hide and a charred stick', bark: 'a sheet of birch bark and a charred stick',
};

/**
 * Something to draw on: the notebook, if you packed it; a hide, once you've ever had one; or birch
 * bark, once you've cut wood. All three only ever come true (the pack is fixed, the flags are
 * one-way), so a map once drawn stays drawn even after the hide is made into a waterskin.
 */
export function mapSurface(s: Pick<Region1State, 'kit' | 'flags'> & { config?: Region1State['config'] }): MapSurface | null {
  // The squared notebook (#1727) is paper and pencils too, when the odd things do something.
  if (hasKit(s, 'notebook') || hasExtra(s, 'notebook-pencils')) return 'notebook';
  if (s.flags.everHide) return 'hide';
  if (s.flags.everWood) return 'bark';
  return null;
}

/** Knowing home ground well enough to draw it: every part of the near ring at least observed. */
export const knowsHomeGround = (s: Pick<Region1State, 'explore'>): boolean => domainsOf(1).every(d => level(s.explore, 1, d) >= 2);

/** Can you draw your own map? With the switch on, once you know home ground and have something to draw on. */
export const canDrawMap = (s: Run): boolean => descriptiveMapOn(s) && knowsHomeGround(s) && mapSurface(s) !== null;

/** Has the map been drawn? The same as being able to: it's drawn the moment you can (and the journal says so). */
export const mapDrawn = canDrawMap;

/** What the MAP tab shows: the Reach map as today (switch off), the description, or your own drawn map. */
export function mapMode(s: Run): 'reach' | 'described' | 'drawn' {
  if (!descriptiveMapOn(s)) return 'reach';
  return mapDrawn(s) ? 'drawn' : 'described';
}

/** What's still missing before you can draw a map (empty once you can, or with the switch off): to know home ground, something to draw on. */
export function mapNeedIds(s: Run): ('home' | 'surface')[] {
  if (!descriptiveMapOn(s) || canDrawMap(s)) return [];
  const out: ('home' | 'surface')[] = [];
  if (!knowsHomeGround(s)) out.push('home');
  if (!mapSurface(s)) out.push('surface');
  return out;
}

const NEED_TEXT = {
  home: 'to know home ground better (every part of the near ring observed: explore it more, survey it, or work it)',
  surface: 'something to draw on (a notebook, a hide, or birch bark from cutting wood)',
} as const;

/** What's still missing before you can draw a map, in words (empty once you can, or with the switch off). */
export const mapNeeds = (s: Run): string[] => mapNeedIds(s).map(n => NEED_TEXT[n]);

/** The journal line on the trip that makes the map possible. */
export function mapDrawnLine(s: Run): string {
  const surface = mapSurface(s) ?? 'bark';
  const how = hasKit(s, 'map-compass') ? 'true to the compass' : 'as near as you can judge without a compass';
  return `Back at camp you sit down with ${SURFACE_WORDS[surface]} and draw what you know of the land, ${how}. You have a map of your own now, of what you've seen.`;
}

/**
 * What your own drawn map shows of each square: what you've seen and no more. With the compass
 * it's what the Reach map shows today (lakes seen from their shore too). Without it, ground only
 * glimpsed from afar can't be placed, so it stays off the map until you've worked or surveyed it.
 */
export function drawnSight(s: Run): Sight {
  const r = reachOfRun(s);
  const base = sightFor(r, s.explore);
  const compass = hasKit(s, 'map-compass');
  const placed: Sight = compass ? base : (x, y) => {
    const v = base(x, y);
    return v === 1 && r.hours[y * r.w + x] > IN_VIEW_HOURS ? 0 : v;
  };
  return withShores(r, placed);
}

/** Your drawn map as text rows, one character per square (unseen squares blank). */
export const drawnRows = (s: Run): string[] => mapRows(reachOfRun(s), drawnSight(s));
