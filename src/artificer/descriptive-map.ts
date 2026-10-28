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
import { generateReach, sightFor, mapRows, ringOfHours, walkFrom, COST, IN_VIEW_HOURS, REACH_W, type Biome, type Reach, type Sight } from './world/reach';
import { landOfRun, toLocal, toWorld, type Land } from './world/hex-window';
import { inReach } from './world/hex-knowledge';
import { packCell } from '../../worldmap/coords';
import { distanceOn, ringWordsFor } from './distance-words';
import { furtherOff } from './hex-words';
import type { Region1State } from './region1';

/** The rule switch (features.ts). */
export const DESCRIPTIVE_MAP = 'descriptive-map';

/** What a run needs for this: its switches, who it is (the seed), what it knows and what it packed. */
type Run = Pick<Region1State, 'config' | 'character' | 'explore' | 'kit' | 'flags'> & Partial<Pick<Region1State, 'campSpot' | 'mapLearned' | 'afield' | 'seenOut' | 'seenWorld' | 'heardHexes'>>;

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
/** Where you stand, as the first line before there's a camp (#1834): the same ground, said of you. */
const HERE_LINE: Readonly<Record<Biome, string>> = {
  meadow: "You're standing in a meadow.", heath: "You're standing on open heath.", birch: "You're standing among birches.", pine: "You're standing in the pines.",
  marsh: "You're standing on boggy ground.", river: "You're standing by the stream.", lake: "You're standing by the lake.", scree: "You're standing on scree.", fell: "You're standing on the fell.", snow: "You're standing on the snow.",
};

/**
 * No camp yet (#1834): with camp as an action (#1732, `camp-as-action`) the Warden starts with no
 * camp, until Make camp sets `campSpot`. Until then the land is told from where you stand ("You're
 * standing in a meadow", "… from here"), not from a camp. With the switch off there's a camp from the
 * start, so this is never true and the words are as they were. Words only: no rule reads it.
 */
export const noCampYet = (s: Pick<Region1State, 'config'> & Partial<Pick<Region1State, 'campSpot' | 'afield'>>): boolean =>
  // Out on the land away from camp (#1839, `directed-explore`), the land is told from where you stand too.
  featureOn(s.config.world.features, 'camp-as-action') && (!s.campSpot || !!s.afield);

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
  /** Said from where you stand, before there's a camp (#1834): its walking time ends "from here". */
  fromHere: boolean;
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
function edgeHours(r: Reach, x: number, y: number, from: { x: number; y: number } = r.camp, walk: readonly number[] = r.hours): number {
  const half = COST[r.cells[from.y * r.w + from.x].biome] / 2;
  let best = Infinity;
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
    best = Math.min(best, walk[ny * r.w + nx]);
  }
  return half + best;
}

/**
 * Where the land is told from (#1752): with `distance-not-rings` on, camp once it's made (#1732's
 * `campSpot`, camp-sites.ts `whereYouAre`) and where you are, the run's start, before that; with it
 * off, always the start, as #1686 had it. The spot id is read here rather than through camp-sites.ts,
 * which builds on this module.
 */
export function landOrigin(s: Pick<Run, 'config' | 'campSpot'>, r: Reach): { x: number; y: number } {
  const m = distanceOn(s) && s.campSpot ? /@(\d+),(\d+)$/.exec(s.campSpot.at) : null;
  return m ? { x: Number(m[1]), y: Number(m[2]) } : r.camp;
}

/**
 * Where the Warden stands (#1839): out on the land (`afield`, written only with `directed-explore`
 * on), else where the land is told from. With `hex-world` on (#1901), `land` is the window
 * (`landOfRun`) and `afield` is a world cell there, converted back with `toLocal`; `origin` is the
 * world coordinate `landOrigin` gives (camp, or the start).
 */
const standing = (s: Pick<Run, 'afield'>, land: Land, origin: { x: number; y: number }): { x: number; y: number } => {
  if (s.afield) {
    const local = toLocal(land, s.afield.x, s.afield.y);
    if (local) return local;
  }
  return toLocal(land, origin.x, origin.y) ?? origin;
};

/**
 * The squares seen by heading out one way (#1839), on top of what the rings show: observed (2), as
 * the rings' knowledge would say of a surveyed ring. Without any, the sight is the rings' own. With
 * `hex-world` on (#1901), `(x, y)` are local to `land`'s own grid; a cell outside the Reach counts
 * as seen when its `packCell` is in `seenWorld` instead of `seenOut`.
 */
function withSeenOut(s: Pick<Run, 'seenOut' | 'seenWorld'>, land: Land, sight: Sight): Sight {
  if (!s.seenOut?.length && !s.seenWorld?.length) return sight;
  const seenOut = new Set(s.seenOut);
  const seenWorld = new Set(s.seenWorld);
  return (x, y) => {
    const world = toWorld(land, x, y);
    const known = inReach(world.cx, world.cy) ? seenOut.has(world.cy * REACH_W + world.cx) : seenWorld.has(packCell(world));
    return known ? Math.max(2, sight(x, y)) : sight(x, y);
  };
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
const bearingOf = (r: Reach, x: number, y: number, from: { x: number; y: number } = r.camp): number => (Math.atan2(x - from.x, from.y - y) * 180 / Math.PI + 360) % 360;

/**
 * Which of the points a bearing is: of eight with the compass, of four (roughly) without. A function
 * declaration, not a `const` arrow: hex-words.ts imports it back across the cycle with this module
 * (#1902), and a declaration is hoisted, so it's defined whichever of the two loads first.
 */
export function directionIndex(bearing: number, exact: boolean): number {
  return exact ? Math.round(bearing / 45) % 8 : Math.round(bearing / 90) % 4;
}

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
  const land = landOfRun(s);
  // Told from camp, or where you are before it (#1752): the walk from there, and what's in view and known
  // from there too, since the rings (what you know of the land) were always measured from camp.
  const home = landOrigin(s, r);
  const moved = home.x !== r.camp.x || home.y !== r.camp.y;
  const homeLocal = toLocal(land, home.x, home.y) ?? land.camp;
  // What the rings show is the land around camp (or the start); out on the land (#1839) the walks
  // and bearings are from where you stand, and the squares you saw on the way are known too. With
  // `hex-world` on (#1901), this runs on the land (`landOfRun`'s window), past the Reach's edge.
  const sight = withShores(land, withSeenOut(s, land, sightFor(moved ? { ...land, hours: walkFrom(land, homeLocal.x, homeLocal.y) } as Reach : land as Reach, s.explore)));
  const from = standing(s, land, home);
  const walk = from.x !== land.camp.x || from.y !== land.camp.y ? walkFrom(land, from.x, from.y) : land.hours;
  const campKind = KIND_OF[land.cells[from.y * land.w + from.x].biome];
  const compass = hasKit(s, 'map-compass');
  const fromHere = noCampYet(s);
  const nearest = new Map<PlaceKind, { i: number; hours: number; seen: boolean }>();
  for (let i = 0; i < land.cells.length; i++) {
    const x = i % land.w, y = Math.floor(i / land.w);
    if (x === from.x && y === from.y) continue;
    const kind = KIND_OF[land.cells[i].biome];
    if (kind === campKind) continue;
    const seen = sight(x, y) > 0;
    // Only high ground can be known unseen: it stands on the skyline.
    if (!seen && kind !== 'high') continue;
    const hours = edgeHours(land, x, y, from, walk);
    if (!Number.isFinite(hours)) continue;
    const had = nearest.get(kind);
    // A seen square beats one on the skyline; then the nearer; ties go to the earlier square, so it's deterministic.
    if (!had || (seen && !had.seen) || (seen === had.seen && hours < had.hours)) nearest.set(kind, { i, hours, seen });
  }
  const out: KnownPlace[] = [];
  for (const kind of KINDS) {
    const p = nearest.get(kind);
    if (!p) continue;
    const x = p.i % land.w, y = Math.floor(p.i / land.w);
    const bearing = bearingOf(land, x, y, from);
    // Beyond a day out counts as the distant ring: the furthest you know of.
    const ring: Ring = ringOfHours(p.hours) ?? 3;
    // Surveying sharpens it: knowing that ring's ground for this kind of place (observed or better) gives a sure walking time.
    const exactTime = compass || level(s.explore, ring, DOMAIN_OF[kind]) >= 2;
    const dir = directionWords(bearing, compass);
    const text = p.seen ? `${SUBJECT[kind]} ${dir}, ${timeWords(p.hours, exactTime)}${fromHere ? ' from here' : ''}.` : `${SUBJECT[kind]} ${dir}; you haven't been.`;
    out.push({
      kind, at: { x, y }, hours: p.hours, bearing, exactBearing: compass, exactTime: p.seen && exactTime, horizon: !p.seen, text, fromHere,
      dir: { exact: compass, i: directionIndex(bearing, compass) }, time: timeWord(p.hours, exactTime),
    });
  }
  return out.sort((a, b) => Number(a.horizon) - Number(b.horizon) || a.hours - b.hours);
}

/** The ground camp stands on (the description's first line): where the land is told from (`landOrigin`). */
export function campBiome(s: Pick<Region1State, 'character'> & Partial<Pick<Run, 'config' | 'campSpot' | 'afield'>>): Biome {
  const r = reachOfRun(s);
  if (!s.config) return r.cells[r.camp.y * r.w + r.camp.x].biome;
  const land = landOfRun({ character: s.character, config: s.config });
  const origin = landOrigin({ config: s.config, campSpot: s.campSpot }, r);
  const from = standing({ afield: s.afield }, land, origin);
  return land.cells[from.y * land.w + from.x].biome;
}

/**
 * What you know of the land, as lines: where camp is (where you stand, before there's a camp),
 * then each place, then — with `hex-world` on (#1902) — "Further off" and a line per hex you know
 * of besides your own. Empty with the switch off.
 */
export function describeLand(s: Run): string[] {
  if (!descriptiveMapOn(s)) return [];
  const far = furtherOff(s);
  return [
    (noCampYet(s) ? HERE_LINE : CAMP_LINE)[campBiome(s)],
    ...knownPlaces(s).map(p => p.text),
    ...(far.length ? ['Further off:', ...far.map(f => f.text)] : []),
  ];
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

/**
 * Learning the map (#1754, `map-learning`) replaces the automatic drawing: with that switch on, the
 * map is drawn once the map-drawing session is done (map-learning.ts), which the save keeps as
 * `mapLearned`. The switch is read here by id, as map-learning.ts builds on this module.
 */
const learnsMap = (s: Pick<Run, 'config'>): boolean => featureOn(s.config.world.features, 'map-learning');

/**
 * Can you draw your own map? With the switch on, once you know home ground and have something to
 * draw on; with `map-learning` on too, once you've sat down and placed what you found.
 */
export const canDrawMap = (s: Run): boolean => descriptiveMapOn(s) && (learnsMap(s) ? s.mapLearned === true : knowsHomeGround(s) && mapSurface(s) !== null);

/** Has the map been drawn? The same as being able to: it's drawn the moment you can (and the journal says so). */
export const mapDrawn = canDrawMap;

/** What the MAP tab shows: the Reach map as today (switch off), the description, or your own drawn map. */
export function mapMode(s: Run): 'reach' | 'described' | 'drawn' {
  if (!descriptiveMapOn(s)) return 'reach';
  return mapDrawn(s) ? 'drawn' : 'described';
}

/** What's still missing before you can draw a map (empty once you can, or with the switch off): to know home ground, something to draw on. */
export function mapNeedIds(s: Run): ('home' | 'surface')[] {
  // With `map-learning` (#1754) what's missing is that module's to say (map-learning.ts mapNeedsFor).
  if (!descriptiveMapOn(s) || canDrawMap(s) || learnsMap(s)) return [];
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
export const mapNeeds = (s: Run): string[] => mapNeedIds(s).map(n => ringWordsFor(s, NEED_TEXT[n]));

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
  // Your own drawn map is the Reach's alone (the drawn hex map is #1903), so `withSeenOut` runs on
  // it directly: a `Land` rooted at the Reach, not `landOfRun`'s wider window.
  const base = withSeenOut(s, { ...r, ox: 0, oy: 0 }, sightFor(r, s.explore));
  const compass = hasKit(s, 'map-compass');
  const placed: Sight = compass ? base : (x, y) => {
    const v = base(x, y);
    return v === 1 && r.hours[y * r.w + x] > IN_VIEW_HOURS ? 0 : v;
  };
  return withShores(r, placed);
}

/** Your drawn map as text rows, one character per square (unseen squares blank). */
export const drawnRows = (s: Run): string[] => mapRows(reachOfRun(s), drawnSight(s));
