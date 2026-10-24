/**
 * Explore in a chosen direction, or look around a centre (#1839, switch `directed-explore`).
 *
 * The owner: "Until you make a camp, maybe choose what direction to explore… explore in a cardinal
 * direction (east, northeast, north etc.) plus duration or distance. Or explore around a centre:
 * explore the current area, or explore with camp as the centre." And then: heading out moves you
 * ("you end up in that direction"), there are 8 directions, and what lies each way is the
 * generated map's to say ("managed by our geography map generator").
 *
 * So Explore offers two ways (an option group, `way`, next to the distance it's queued at):
 *
 * 1. **Look around** (`here`, the default): today's explore. A circle around the centre, out to the
 *    chosen distance, learning a little in every direction, and you stay put. At camp (or, before
 *    camp, at the start) it is exactly the explore the game always had: the rings' knowledge
 *    (exploration.ts). Away from camp, it's the land around where you stand that you learn (see
 *    "Seen squares" below), and once camp exists you choose: around here, or around camp (`camp`:
 *    walk back first, then look around there).
 * 2. **Head out** (`n`, `ne` … `nw`): one of the compass's eight points. You walk out that way and
 *    end the day out there: the next day starts from the new spot. What you see is the Reach's own
 *    squares in that 45° sector (world/reach.ts: its biomes, and what each gives, `YIELDS`), out to
 *    `HEAD_OUT_HOURS` for the distance, and nothing of the other seven directions.
 *
 * **Where you are.** Before #1839 the Warden was always at camp, or (before camp, #1732) at the
 * start. Heading out needs one more thing the save didn't have: a square of the Reach where the
 * Warden stands when that isn't camp. That's `afield` (absent: at camp, or at the start). With a
 * camp, a night afield is a night out under the sky (no shelter: region1.ts `warmth`), and any other
 * work starts with the walk back to camp (`walkBackHours`). Before camp there's nothing to walk back
 * to: you simply are where you are, and Make camp's distances are measured from there.
 *
 * **Seen squares.** The rings' knowledge has no direction (it's per ring × domain), so heading north
 * can't go into it without teaching you about the south too. What heading out (or looking around
 * away from camp) shows you is kept as squares instead: `seenOut`, Reach indices, sorted. The land
 * in words (descriptive-map.ts `knownPlaces`) and the places to camp (camp-sites.ts `knownSpots`)
 * read them as well as the rings, so a stream found to the north is a stream you know of.
 *
 * Pure and deterministic. Nothing here draws a random number: the Reach is generated from the
 * run's seed on its own string-keyed streams (`seedOf`), and the rest is geometry and walking times
 * on it. With the switch off or absent there's no `way` to choose, nothing is written, and explore
 * is exactly today's.
 */

import { featureOn } from './features';
import { hasKit } from './kit';
import type { Ring } from './exploration';
import { reachOfRun, landOrigin, directionWords, directionIndex, timeWord, timeWords, type TimeWord } from './descriptive-map';
import { walkFrom, YIELDS, BIOME_NAME, type Biome, type Reach, type Yield } from './world/reach';
import { walkOn, pathTo, noteWalk } from './walk-the-map';
import type { Region1State, ActionOpts, OptionGroup } from './region1';

/** The rule switch (features.ts). */
export const DIRECTED_EXPLORE = 'directed-explore';

export const directedOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, DIRECTED_EXPLORE);

/** The compass's eight points, clockwise from north: index i is the bearing i × 45°. */
export const DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type Dir = (typeof DIRS)[number];
/** Explore's ways: look around here (the default), look around camp, or head out one way. */
export type Way = 'here' | 'camp' | Dir;

/** The heading as a word, for the journal ("Headed north-east…"). */
export const HEADING: Readonly<Record<Dir, string>> = {
  n: 'north', ne: 'north-east', e: 'east', se: 'south-east', s: 'south', sw: 'south-west', w: 'west', nw: 'north-west',
};

/**
 * How far out heading out takes you, in hours of walking, by the distance it's queued at. The time
 * an explore spends is the same either way (4 hours, plus the walks of the distance: +3h, +6h); a
 * trip there and back spends its walk coming home, heading out spends it going further, and about
 * half the looking-about is walking on too. So close by is about 2 hours out, half a day 5, a day 8:
 * each inside the band of land its distance names (reach.ts `ringOfHours`: 3, 6, 9 hours).
 */
export const HEAD_OUT_HOURS: Readonly<Record<Ring, number>> = { 1: 2, 2: 5, 3: 8 };
/**
 * How far looking around away from camp sees, in hours of walking each way. A circle for the same
 * time as heading out's wedge, so it reaches less far out: a little in every direction.
 */
export const LOOK_HOURS: Readonly<Record<Ring, number>> = { 1: 1, 2: 2.5, 3: 4 };

type Run = Pick<Region1State, 'config' | 'character'> & Partial<Pick<Region1State, 'campSpot' | 'afield' | 'seenOut' | 'kit'>>;
type At = { x: number; y: number };

/** Degrees clockwise from north, from `from` to (x, y). Screen y grows southwards. */
export const bearingTo = (from: At, x: number, y: number): number => (Math.atan2(x - from.x, from.y - y) * 180 / Math.PI + 360) % 360;

/** How far a bearing is off a direction's centre line, −22.5 … 22.5 within its sector. */
const offCentre = (bearing: number, dir: Dir): number => ((bearing - DIRS.indexOf(dir) * 45 + 540) % 360) - 180;

/**
 * Is (x, y) in a direction's 45° sector, as seen from `from`? Half-open ([−22.5°, 22.5°)), so the
 * eight sectors share no square: a square is in exactly one of them. `from` itself is in none.
 */
export function inSector(from: At, x: number, y: number, dir: Dir): boolean {
  if (x === from.x && y === from.y) return false;
  const off = offCentre(bearingTo(from, x, y), dir);
  return off >= -22.5 && off < 22.5;
}

/** Which direction's sector a square lies in, from `from` (null for `from` itself). */
export function sectorOf(from: At, x: number, y: number): Dir | null {
  return DIRS.find(d => inSector(from, x, y, d)) ?? null;
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const around = (r: Reach, i: number): number[] => {
  const x = i % r.w, y = Math.floor(i / r.w);
  return NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < r.w && ny < r.h).map(([nx, ny]) => ny * r.w + nx);
};

/**
 * The squares seen from a walk: every square that `keep` accepts within `hours` on foot of `from`,
 * and the open water beside them that `keep` also accepts (a lake is seen from its shore: it has no
 * walking time of its own). Sorted Reach indices.
 */
function seenWithin(r: Reach, from: At, hours: number, keep: (x: number, y: number) => boolean): number[] {
  const walk = walkFrom(r, from.x, from.y);
  const seen = new Set<number>();
  for (let i = 0; i < r.cells.length; i++) {
    const x = i % r.w, y = Math.floor(i / r.w);
    if ((x === from.x && y === from.y) || !(walk[i] <= hours) || !keep(x, y)) continue;
    seen.add(i);
  }
  for (const i of [...seen]) {
    for (const j of around(r, i)) if (r.cells[j].biome === 'lake' && keep(j % r.w, Math.floor(j / r.w))) seen.add(j);
  }
  return [...seen].sort((a, b) => a - b);
}

/** One kind of land found heading out: its nearest square, with direction and walking time as descriptive-map.ts tells them. */
export interface FoundPlace {
  biome: Biome;
  x: number;
  y: number;
  /** Hours on foot from where you set out (to a lake's shore). */
  hours: number;
  bearing: number;
  /** What the square gives: the Reach's own `YIELDS` for its biome. */
  yields: readonly Yield[];
  dir: { exact: boolean; i: number };
  time: TimeWord;
  /** "due north, about 2 hours", in English, as the map's descriptions say it. */
  text: string;
}

export interface HeadOutPlan {
  /** Where you set out from. */
  from: At;
  /** Where you end the day: the furthest square you can walk to in the sector, or null when the land runs out that way. */
  to: At | null;
  /** Hours on foot from `from` to `to`. */
  hours: number;
  /** Every square seen on the way, all in the direction's sector (sorted Reach indices). */
  seen: number[];
  /** The kinds of land found, nearest first: the nearest square of each biome among those seen. */
  found: FoundPlace[];
}

/** A lake's walking time is its shore's: the nearest walkable square beside it. */
const hoursTo = (r: Reach, walk: readonly number[], i: number): number =>
  r.cells[i].biome === 'lake' ? Math.min(...around(r, i).map(j => walk[j])) : walk[i];

/**
 * Heading out (pure): from `from`, in direction `dir`, at a distance. What you see is the Reach's
 * squares in that direction's sector within `HEAD_OUT_HOURS` of walking; where you end up is the
 * furthest of them you can walk to, keeping near the line you set out on (the middle half of the
 * sector, if it has a square you can reach; ties to the one nearest the line, then the first).
 */
export function headOutPlan(r: Reach, from: At, dir: Dir, ring: Ring, compass = false): HeadOutPlan {
  const walk = walkFrom(r, from.x, from.y);
  const seen = seenWithin(r, from, HEAD_OUT_HOURS[ring], (x, y) => inSector(from, x, y, dir));
  const walkable = seen.filter(i => Number.isFinite(walk[i]));
  const off = (i: number): number => Math.abs(offCentre(bearingTo(from, i % r.w, Math.floor(i / r.w)), dir));
  const central = walkable.filter(i => off(i) <= 11.25);
  let best = -1;
  for (const i of central.length ? central : walkable) {
    if (best === -1 || walk[i] > walk[best] || (walk[i] === walk[best] && off(i) < off(best))) best = i;
  }
  const nearest = new Map<Biome, number>();
  for (const i of seen) {
    const b = r.cells[i].biome, had = nearest.get(b);
    if (had === undefined || hoursTo(r, walk, i) < hoursTo(r, walk, had)) nearest.set(b, i);
  }
  const found = [...nearest.entries()].map(([biome, i]): FoundPlace => {
    const x = i % r.w, y = Math.floor(i / r.w);
    const hours = hoursTo(r, walk, i), bearing = bearingTo(from, x, y);
    return {
      biome, x, y, hours, bearing, yields: YIELDS[biome], dir: { exact: compass, i: directionIndex(bearing, compass) },
      time: timeWord(hours, compass), text: `${directionWords(bearing, compass)}, ${timeWords(hours, compass)}`,
    };
  }).sort((a, b) => a.hours - b.hours || (a.biome < b.biome ? -1 : 1));
  const to = best === -1 ? null : { x: best % r.w, y: Math.floor(best / r.w) };
  return { from, to, hours: best === -1 ? 0 : walk[best], seen, found };
}

/** Looking around away from camp (pure): every square within `LOOK_HOURS` of where you stand, in every direction. */
export const lookAroundPlan = (r: Reach, from: At, ring: Ring): number[] => seenWithin(r, from, LOOK_HOURS[ring], () => true);

// ── Where the Warden is ─────────────────────────────────────────────────────

/** Where the Warden is: out on the land (`afield`), else where the land is told from (camp, or the start). */
export function standingAt(s: Run, r: Reach = reachOfRun(s)): At {
  return s.afield ? { x: s.afield.x, y: s.afield.y } : landOrigin({ config: s.config, campSpot: s.campSpot }, r);
}

/** Camp's square, once camp is made (#1732), else null. */
function campAt(s: Run): At | null {
  const m = s.campSpot ? /@(\d+),(\d+)$/.exec(s.campSpot.at) : null;
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/**
 * Can the Warden be out on the land? Heading out puts them there (this switch), and so does a stop
 * on a walk (#1876, `walk-the-map`): one position either way, `afield`.
 */
const placesOn = (s: Pick<Region1State, 'config'>): boolean => directedOn(s) || walkOn(s);

/** Out on the land with a camp to go back to: the night is out under the sky, and other work starts with the walk back. */
export const awayFromCamp = (s: Pick<Region1State, 'config'> & Partial<Pick<Region1State, 'afield' | 'campSpot'>>): boolean =>
  placesOn(s) && !!s.afield && !!s.campSpot;

/** Hours on foot from where you stand back to camp: 0 when you're there (or have none). */
export function walkBackHours(s: Run): number {
  const camp = campAt(s);
  if (!camp || !s.afield || !placesOn(s)) return 0;
  const r = reachOfRun(s);
  const h = walkFrom(r, s.afield.x, s.afield.y)[camp.y * r.w + camp.x];
  return Number.isFinite(h) ? h : 0;
}

/** The way an explore entry goes (#1839): as chosen when the switch is on and the choice makes sense now, else look around here. */
export function wayOf(s: Run, opts: ActionOpts): Way {
  if (!directedOn(s)) return 'here';
  const w = opts.way;
  if ((DIRS as readonly string[]).includes(w ?? '')) return w as Dir;
  return w === 'camp' && awayFromCamp(s) ? 'camp' : 'here';
}

export const isHeading = (w: Way): w is Dir => w !== 'here' && w !== 'camp';

/**
 * Does this action start with the walk back to camp? Only away from camp with a camp to go back to:
 * every action but heading out, looking around here (the land where you stand) and Make camp (whose
 * walk is measured from where you stand already).
 */
export function walksBackFirst(s: Run, id: string, opts: ActionOpts): boolean {
  if (!awayFromCamp(s)) return false;
  if (id === 'camp') return false;
  // Out there after a stop (#1876) with heading out off, Explore is the ring's, from camp.
  if (id === 'explore') return !directedOn(s) || wayOf(s, opts) === 'camp';
  return true;
}

// ── The choice ──────────────────────────────────────────────────────────────

/** The way's choices in English, as the AI and the API read them (the app says the same keys in the viewer's language). */
export const WAY_TEXT = {
  label: 'Which way',
  here: 'Look around', hereAway: 'Look around here', camp: 'Look around camp',
  hereNote: 'a little of the land in every direction, out to the distance you choose; you stay where you are',
  campNote: 'walk back to camp first ({h}h), then look around there',
  headNote: 'head out that way and end the day out there: you find what lies that way, and learn nothing of the other directions',
  dir: { n: 'North', ne: 'North-east', e: 'East', se: 'South-east', s: 'South', sw: 'South-west', w: 'West', nw: 'North-west' } as Readonly<Record<Dir, string>>,
} as const;

const hrs = (h: number): string => String(Math.round(h * 2) / 2);

/** Explore's decision with the switch on: look around (here, or camp when you're away from it), or one of the eight directions. */
export function wayOptions(s: Run, opts: ActionOpts): OptionGroup[] {
  if (!directedOn(s)) return [];
  const away = awayFromCamp(s);
  return [{
    key: 'way', label: WAY_TEXT.label, value: wayOf(s, opts),
    choices: [
      { value: 'here', label: away ? WAY_TEXT.hereAway : WAY_TEXT.here, note: WAY_TEXT.hereNote, blocked: null },
      ...(away ? [{ value: 'camp', label: WAY_TEXT.camp, note: WAY_TEXT.campNote.replace('{h}', hrs(walkBackHours(s))), blocked: null }] : []),
      ...DIRS.map(d => ({ value: d, label: WAY_TEXT.dir[d], note: WAY_TEXT.headNote, blocked: null })),
    ],
  }];
}

// ── Doing it ────────────────────────────────────────────────────────────────

/** Merge squares into the seen set (sorted, no repeats). Also hex-knowledge.ts's, for `seenWorld`. */
export const merged = (had: readonly number[] | undefined, more: readonly number[]): number[] => [...new Set([...(had ?? []), ...more])].sort((a, b) => a - b);

/** Set where the Warden stands: back at camp (or the start, before camp) is no longer afield. Mutates `s`. */
function standAt(s: Region1State, at: At): void {
  const home = landOrigin({ config: s.config, campSpot: s.campSpot }, reachOfRun(s));
  if (at.x === home.x && at.y === home.y) delete s.afield;
  else s.afield = { x: at.x, y: at.y };
}

/**
 * Head out (on an already-cloned state): you see the sector, you end the day at its far end. Returns
 * the journal's lines: where you went, then each kind of land found, nearest first.
 */
export function headOut(s: Region1State, dir: Dir, ring: Ring): string[] {
  const r = reachOfRun(s);
  const from = standingAt(s, r);
  const plan = headOutPlan(r, from, dir, ring, hasKit(s, 'map-compass'));
  if (!plan.to) return [`Headed ${HEADING[dir]}, but the land runs out that way — you came back to where you set out.`];
  s.seenOut = merged(s.seenOut, plan.seen);
  // Walking the map (#1876): the way you walked goes on today's trail, for a live map later. What it
  // shows stays the sector's (above): the path is what you walked, not more land seen.
  noteWalk(s, pathTo(r, walkFrom(r, from.x, from.y), plan.to.y * r.w + plan.to.x), false);
  standAt(s, plan.to);
  return [
    `Headed ${HEADING[dir]}, about ${hrs(plan.hours)} hours out, looking about as you went.`,
    ...plan.found.map(f => `Out that way: ${BIOME_NAME[f.biome]}, ${f.text} from where you set out.`),
    ...(awayFromCamp(s) ? ["You'll sleep out here tonight, away from camp, unless you walk back."] : []),
  ];
}

/** Look around where you stand, away from camp (on an already-cloned state): the land in every direction, a little way out. */
export function lookHere(s: Region1State, ring: Ring): string {
  const r = reachOfRun(s);
  s.seenOut = merged(s.seenOut, lookAroundPlan(r, standingAt(s, r), ring));
  return `Looked around where you stand, out to about ${hrs(LOOK_HOURS[ring])} hours each way.`;
}

/** The walk back to camp's line. */
export const walkBackLine = (h: number): string => `Walked back to camp first, about ${hrs(h)} hours.`;

/** Back at camp (on an already-cloned state). */
export const backAtCamp = (s: Region1State): void => { delete s.afield; };

// ── The save ────────────────────────────────────────────────────────────────

const isSquare = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** A saved `afield` that reads right: a square's whole-number x and y. */
export function validAfield(x: unknown): x is At {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return isSquare(o.x) && isSquare(o.y);
}

/** A saved `seenOut` that reads right: Reach indices. */
export const validSeenOut = (x: unknown): x is number[] => Array.isArray(x) && x.every(isSquare);
