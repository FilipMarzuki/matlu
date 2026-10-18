/**
 * Tasks that travel walk the map (#1876, switch `walk-the-map`).
 *
 * The owner: "I want the tasks, the ones that would move our character, to actually move the
 * character across the map. The game is aware of the position and grid square the character is in.
 * Later on we can get a live map of where the character is."
 *
 * Before this, a trip "in a ring" (wood, water, a hunt… close by, half a day or a day out) was a cost
 * in hours with a yield: the Warden never stood anywhere. With the switch on, every such trip goes to
 * a real square of the Reach (world/reach.ts) and back:
 *
 * - **Where to.** A square in that ring (by walking time from camp, reach.ts `ringOfHours`) that has
 *   what the task needs, by the Reach's own `YIELDS`: wood goes to birch or pine, water to a river, a
 *   marsh or a lake's shore, stone to scree or fell, game to where game is. The owner's rule: the
 *   nearest such square the Warden knows, by walking time. Knowing nothing that fits, the Warden still
 *   goes, to the nearest square that fits among those not seen yet: water lies low and stone high, so
 *   someone who reads the land heads the right way, and exploring is how you find out.
 *   Looking tasks (scout, survey, explore) look about as their work, so they go to the ring's nearest
 *   square, where the looking starts; Climb & look out goes to high ground.
 * - **The walk.** Along a shortest path over the grid, by `COST` (the same walking hours `hours` is
 *   made of), there and back. The trip's travel hours, and the Vigor and Clarity the walk takes, are
 *   that path's, not the ring's flat +0/+3/+6 hours.
 * - **Where the Warden is.** One position for the whole run: `afield` (directed-explore.ts, #1839) is
 *   where the Warden stands when it isn't camp, absent at camp. A finished trip ends at camp again;
 *   a stop (#1815) leaves the Warden on the path, `afield`, and the next work starts with the walk
 *   back from there, as after heading out. No second position field, so the two can't disagree.
 * - **What you see.** The squares walked through that weren't known yet join `seenOut`, as heading
 *   out's do, so the land in words and the places to camp learn your routes.
 * - **Ring knowledge.** A trip's square is always in the ring it was planned for, so what the work
 *   teaches of that ring (exploration.ts) rises as before, now from a square the Warden stood on.
 * - **For a live map later.** The last few days' paths are kept, square by square, in `trail`.
 *
 * Pure and deterministic. A path is a function of the grid alone: Dijkstra's walking hours from the
 * start (reach.ts `walkFrom`, kept per square), traced back from the destination, taking the first
 * neighbour in a fixed order whenever two are as good. Destinations tie-break on the square's index.
 * Nothing here draws a random number. With the switch off or absent nothing is written and a trip is
 * the ring's, exactly as before.
 */

import { featureOn } from './features';
import { hasKit } from './kit';
import type { Ring } from './exploration';
import { reachOfRun, landOrigin, directionWords, directionIndex, timeWords, timeWord, type TimeWord } from './descriptive-map';
import { walkFrom, sightFor, ringOfHours, COST, YIELDS, BIOME_NAME, type Biome, type Reach, type Yield } from './world/reach';
import type { Region1State } from './region1';

/** The rule switch (features.ts). */
export const WALK_THE_MAP = 'walk-the-map';

export const walkOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, WALK_THE_MAP);

type At = { x: number; y: number };
type Run = Pick<Region1State, 'config' | 'character' | 'explore'> & Partial<Pick<Region1State, 'campSpot' | 'afield' | 'seenOut' | 'kit'>>;

/** What a task looks for: something the land yields, high ground, or just the ring to look about in. */
export type Need = Yield | 'high' | 'look';

/** The tasks that travel, and what each goes looking for. */
export const TASK_NEED: Readonly<Record<string, Need>> = {
  wood: 'timber', water: 'water', fish: 'water', gather: 'forage',
  hunt: 'game', traps: 'game', track: 'game',
  quarry: 'stone', gatherstone: 'stone',
  lookout: 'high',
  scout: 'look', survey: 'look', explore: 'look',
};

const HIGH: readonly Biome[] = ['scree', 'fell', 'snow'];
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** A trip planned on the map: from camp (or where you stand, before camp) to a square and back. */
export interface Trip {
  /** Where it sets out from and comes back to. */
  home: At;
  /** The square the work is done at. */
  dest: At;
  /** The path out, as Reach indices from `home` to `dest` (both included); the way back is the same path reversed. */
  path: number[];
  /** Hours on foot out, and back (a path's cost is the cells entered, so the two differ by the ends' crossing costs). */
  outHours: number;
  backHours: number;
  /** Did the Warden know the square before setting out? */
  known: boolean;
  /** What the work is at: the square's own land, or the lake beside it for water and fishing. */
  biome: Biome;
}

/** Camp's square once camp is made (#1732), else where the Warden stands (afield, or where the land is told from). */
export function homeOf(s: Pick<Run, 'config' | 'character'> & Partial<Pick<Run, 'campSpot' | 'afield'>>, r: Reach = reachOfRun(s)): At {
  const m = s.campSpot ? /@(\d+),(\d+)$/.exec(s.campSpot.at) : null;
  if (m) return { x: Number(m[1]), y: Number(m[2]) };
  return s.afield ? { x: s.afield.x, y: s.afield.y } : landOrigin({ config: s.config, campSpot: s.campSpot }, r);
}

/** Where the Warden is, always a square of the Reach: out on the land (`afield`), else camp (or, before camp, the start). */
export function wardenAt(s: Pick<Run, 'config' | 'character'> & Partial<Pick<Run, 'campSpot' | 'afield'>>, r: Reach = reachOfRun(s)): At {
  return s.afield ? { x: s.afield.x, y: s.afield.y } : homeOf(s, r);
}

/** Beside open water: a lake next to this square, the first in the fixed neighbour order, else -1. */
function lakeBeside(r: Reach, i: number): number {
  const x = i % r.w, y = Math.floor(i / r.w);
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < r.w && ny < r.h && r.cells[ny * r.w + nx].biome === 'lake') return ny * r.w + nx;
  }
  return -1;
}

/** Does a (walkable) square serve this need? Water and fishing can be done from a lake's shore. */
function serves(r: Reach, i: number, need: Need): boolean {
  const b = r.cells[i].biome;
  if (need === 'look') return true;
  if (need === 'high') return HIGH.includes(b);
  if (YIELDS[b].includes(need)) return true;
  return need === 'water' && lakeBeside(r, i) >= 0;
}

/**
 * The path from the start of a walk map to `dest`, traced back: from each square, the first
 * neighbour (in the fixed order) whose walking time plus this square's crossing makes this square's.
 * Pure: the same map and square always give the same path.
 */
export function pathTo(r: Reach, walk: readonly number[], dest: number): number[] {
  const path = [dest];
  let i = dest;
  // Every crossing costs something, so the start is the only square at 0 and the trace always ends.
  for (let guard = 0; walk[i] > 0 && guard < r.cells.length; guard++) {
    const x = i % r.w, y = Math.floor(i / r.w);
    const c = COST[r.cells[i].biome];
    let prev = -1;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
      const j = ny * r.w + nx;
      if (Math.abs(walk[j] + c - walk[i]) < 1e-9) { prev = j; break; }
    }
    if (prev === -1) break;
    path.push(prev);
    i = prev;
  }
  return path.reverse();
}

/**
 * Does the Warden know a square (pure)? In view from home or in a ring they know (reach.ts
 * `sightFor`, by walking time from home), or seen on a walk or heading out (`seenOut`).
 */
function knownTest(s: Run, r: Reach, walk: readonly number[] = walkFrom(r, homeOf(s, r).x, homeOf(s, r).y), sight = sightFor({ ...r, hours: [...walk] }, s.explore)): (i: number) => boolean {
  const seen = new Set(s.seenOut ?? []);
  return i => seen.has(i) || sight(i % r.w, Math.floor(i / r.w)) > 0;
}

// Destinations are asked for often (the plan's estimate, the AI's view, the needs player trying
// actions forward), so the last few are kept. The key is everything the choice depends on: the land
// (the seed), where you set out, the ring, the need, how much of each ring you know, and the squares
// seen (`seenOut` only ever grows, so its length tells one set from the next).
const trips = new Map<string, Trip | null>();

/**
 * Plan a trip on the map (pure): where a task of this kind goes in this ring, by the path there.
 * Null when the ring has no square at all that serves the need: the trip is then the ring's, as it
 * always was.
 */
export function planTrip(s: Run, need: Need, ring: Ring): Trip | null {
  const r = reachOfRun(s);
  const home = homeOf(s, r);
  const walk = walkFrom(r, home.x, home.y);
  const sight = sightFor({ ...r, hours: walk }, s.explore);
  const levels = ([1, 2, 3] as const).map(n => Object.values(s.explore.known[n]).map(v => Math.floor(Math.min(3, v))).join('')).join('|');
  const key = `${r.seed}|${home.x},${home.y}|${ring}|${need}|${levels}|${s.seenOut?.length ?? 0}`;
  if (trips.has(key)) return trips.get(key)!;
  const isKnownAt = knownTest(s, r, walk, sight);
  // The nearest known square that serves, else the nearest unseen one; ties to the lower index.
  let known = -1, unseen = -1;
  for (let i = 0; i < r.cells.length; i++) {
    if (!Number.isFinite(walk[i]) || ringOfHours(walk[i]) !== ring || !serves(r, i, need)) continue;
    const isKnown = isKnownAt(i);
    if (isKnown) { if (known === -1 || walk[i] < walk[known]) known = i; }
    else if (unseen === -1 || walk[i] < walk[unseen]) unseen = i;
  }
  // Looking about needs nothing known: the ring's nearest square, seen or not.
  const pick = need === 'look' ? (unseen !== -1 && (known === -1 || walk[unseen] < walk[known]) ? unseen : known) : known !== -1 ? known : unseen;
  let trip: Trip | null = null;
  if (pick !== -1) {
    const lake = (need === 'water') && !YIELDS[r.cells[pick].biome].includes('water') ? lakeBeside(r, pick) : -1;
    const homeI = home.y * r.w + home.x;
    trip = {
      home, dest: { x: pick % r.w, y: Math.floor(pick / r.w) }, path: pathTo(r, walk, pick),
      outHours: walk[pick],
      // The same path walked the other way: it enters every square but the far end, and home.
      backHours: walk[pick] - COST[r.cells[pick].biome] + COST[r.cells[homeI].biome],
      known: pick === known, biome: lake >= 0 ? 'lake' : r.cells[pick].biome,
    };
  }
  if (trips.size >= 64) trips.delete(trips.keys().next().value as string);
  trips.set(key, trip);
  return trip;
}

/**
 * The trip a queued task walks, or null when it doesn't walk the map: the switch off, a task that
 * doesn't travel, or Explore's own ways (heading out and looking around where you stand, #1839),
 * which already move the Warden by their own rules.
 */
export function walkTrip(s: Run, id: string, ring: Ring, ownWay = false): Trip | null {
  if (!walkOn(s)) return null;
  const need = TASK_NEED[id];
  if (!need || (id === 'explore' && ownWay)) return null;
  return planTrip(s, need, ring);
}

// ── Where a stop leaves you ─────────────────────────────────────────────────

/** Where on a planned action a stop landed, as the walk sees it. */
export interface Leg {
  leg: 'out' | 'work' | 'back';
  /** Hours into that leg (each walk is half the trip's travel, as stop-action.ts `cutTrips` splits it). */
  into: number;
  /** The leg's own hours: half the trip's travel for a walk, the work for the work. */
  length: number;
  /** Hours walked before the stop, over every trip so far. */
  walked: number;
}

/**
 * The leg a stop `hours` into an action falls in (pure), trip by trip as `cutTrips` reads them,
 * the last walk home included (where `cutTrips` has nothing to cut, the walk does: you stop on the
 * path). Null after the end.
 */
export function legAt(trips: readonly { travel: number; work: number }[], hours: number): Leg | null {
  let h = Math.max(0, hours), walked = 0;
  for (const t of trips) {
    const half = t.travel / 2;
    if (h < half) return { leg: 'out', into: h, length: half, walked: walked + h };
    if (h < half + t.work) return { leg: 'work', into: h - half, length: t.work, walked: walked + half };
    if (h < t.travel + t.work) return { leg: 'back', into: h - half - t.work, length: half, walked: walked + half + (h - half - t.work) };
    walked += t.travel;
    h -= t.travel + t.work;
  }
  return null;
}

/**
 * The square a stop leaves the Warden on (pure): on the way out, the last square of the path
 * reached by then; at the work, the work's square; on the way back, the furthest square reached on
 * the path home. A walk's hours scale with the snow and the storm, so the share of the leg walked
 * is what places you.
 */
export function squareOnPath(r: Reach, trip: Trip, leg: Leg): number {
  const p = trip.path;
  const dest = p[p.length - 1];
  if (leg.leg === 'work' || leg.length <= 0) return leg.leg === 'out' ? p[0] : dest;
  const share = Math.min(1, leg.into / leg.length);
  const walk = walkFrom(r, trip.home.x, trip.home.y);
  if (leg.leg === 'out') {
    const target = share * trip.outHours + 1e-9;
    let k = 0;
    while (k + 1 < p.length && walk[p[k + 1]] <= target) k++;
    return p[k];
  }
  // Walking home from the far end, the hours to each square on the way: everything entered after leaving it.
  const target = share * trip.backHours + 1e-9;
  const back = (k: number): number => walk[dest] - COST[r.cells[dest].biome] - walk[p[k]] + COST[r.cells[p[k]].biome];
  let k = p.length - 1;
  while (k > 0 && back(k - 1) <= target) k--;
  return p[k];
}

// ── Tracking the walk ───────────────────────────────────────────────────────

/** How many days of paths are kept for a live map later (#1873). */
export const TRAIL_DAYS = 3;

/** One day's walking: the squares stepped on, in order. */
export interface TrailDay {
  day: number;
  path: number[];
}

/**
 * Note squares walked (on an already-cloned state): they go on today's trail, the last `TRAIL_DAYS`
 * days kept, and (`see`) the ones not known yet are seen from now on (`seenOut`): land already in
 * view or in a ring you know isn't news (#1869's finds read new `seenOut` squares as found ground).
 * Only with the switch on. Heading out (#1839) notes its walk without `see`: what it shows is its
 * own sector, and only that.
 */
export function noteWalk(s: Region1State, squares: readonly number[], see = true): void {
  if (!walkOn(s) || !squares.length) return;
  if (see) {
    const known = knownTest(s, reachOfRun(s));
    const fresh = squares.filter(i => !known(i));
    if (fresh.length) s.seenOut = [...new Set([...(s.seenOut ?? []), ...fresh])].sort((a, b) => a - b);
  }
  const trail = (s.trail ?? []).map(d => ({ day: d.day, path: [...d.path] }));
  let today = trail[trail.length - 1];
  if (!today || today.day !== s.day) { today = { day: s.day, path: [] }; trail.push(today); }
  for (const i of squares) if (today.path[today.path.length - 1] !== i) today.path.push(i);
  s.trail = trail.slice(-TRAIL_DAYS);
}

/** The path walked (pure): the whole of it there and back, or as far as a stop got. */
export function walkedSquares(trip: Trip, at: number | null): number[] {
  const p = trip.path;
  if (at === null) return [...p, ...p.slice(0, -1).reverse()];
  const k = p.indexOf(at);
  return k < 0 ? [...p] : p.slice(0, k + 1);
}

/** A trip's last walk home, after a stop on it: the far end back to where it stopped. */
export function walkedHomeTo(trip: Trip, at: number): number[] {
  const p = trip.path;
  const k = p.indexOf(at);
  return [...p, ...p.slice(Math.max(0, k), -1).reverse()];
}

// ── Words ───────────────────────────────────────────────────────────────────

/** Where a square is from home, as the land's descriptions say it: a bearing and a walking time. */
function placeWords(s: Pick<Run, 'kit'> & Pick<Region1State, 'config' | 'character'>, r: Reach, home: At, i: number, hours: number): { bearing: string; walk: string } {
  const compass = hasKit(s as Parameters<typeof hasKit>[0], 'map-compass');
  const x = i % r.w, y = Math.floor(i / r.w);
  const bearing = (Math.atan2(x - home.x, home.y - y) * 180 / Math.PI + 360) % 360;
  return { bearing: directionWords(bearing, compass), walk: timeWords(hours, compass) };
}

/** The journal's line for where a trip went (null when the work was right where you set out). */
export function tripLine(s: Region1State, trip: Trip): string | null {
  const r = reachOfRun(s);
  const i = trip.path[trip.path.length - 1];
  if (trip.path.length < 2) return null;
  const { bearing, walk } = placeWords(s, r, trip.home, i, trip.outHours);
  return trip.known
    ? `Where the work was: ${BIOME_NAME[trip.biome]}, ${bearing}, ${walk} from where you set out.`
    : `Into land you hadn't seen: ${BIOME_NAME[trip.biome]}, ${bearing}, ${walk} from where you set out.`;
}

/** The journal's line for where a stop left you out on the land (the walk back is the next work's, with a camp to go back to). */
export function stoppedLine(s: Region1State, trip: Trip, at: number): string {
  const r = reachOfRun(s);
  const walk = walkFrom(r, trip.home.x, trip.home.y);
  const homeI = trip.home.y * r.w + trip.home.x;
  const back = walk[at] - COST[r.cells[at].biome] + COST[r.cells[homeI].biome];
  const w = placeWords(s, r, trip.home, at, back);
  return s.campSpot
    ? `You stopped out on the land, ${w.bearing}, ${w.walk} from camp: the next work starts with the walk back.`
    : `You stopped out on the land, ${w.bearing}, ${w.walk} from where you set out: the next work starts from here.`;
}

/** Where the Warden is, as parts for any language (#1876): at camp, at the start, or out on the land and how far. */
export interface WherePlace {
  kind: 'camp' | 'start' | 'out' | 'outHere';
  /** Out on the land: the bearing from camp (or the start) as an index (of eight with the compass, of four without), and the walk back as a band. */
  dir?: { exact: boolean; i: number };
  time?: TimeWord;
}

export function wherePlace(s: Region1State): WherePlace {
  const r = reachOfRun(s);
  if (!s.afield) return { kind: s.campSpot ? 'camp' : 'start' };
  const home = homeOf(s, r);
  const walk = walkFrom(r, s.afield.x, s.afield.y)[home.y * r.w + home.x];
  const compass = hasKit(s, 'map-compass');
  const bearing = (Math.atan2(s.afield.x - home.x, home.y - s.afield.y) * 180 / Math.PI + 360) % 360;
  return { kind: s.campSpot ? 'out' : 'outHere', dir: { exact: compass, i: directionIndex(bearing, compass) }, time: timeWord(Number.isFinite(walk) ? walk : 0, compass) };
}

/** Where the Warden is, in English for the AI: at camp, or out on the land and how far. */
export function whereLine(s: Region1State): string {
  const r = reachOfRun(s);
  if (!s.afield) return s.campSpot ? 'You are at camp.' : 'You are where you set out from.';
  const home = homeOf(s, r);
  const homeI = home.y * r.w + home.x;
  const at = s.afield.y * r.w + s.afield.x;
  const walk = walkFrom(r, s.afield.x, s.afield.y);
  const w = placeWords(s, r, home, at, Number.isFinite(walk[homeI]) ? walk[homeI] : 0);
  return s.campSpot ? `You are out on the land, ${w.bearing}, ${w.walk} from camp.` : `You are out on the land, ${w.bearing}, ${w.walk} from where you set out.`;
}

/** The rules in brief, for the AI's and the API's rules text. */
export const WALK_RULES = 'WALKING: every task that travels walks the map. It goes to the nearest square at that distance that has what it needs (wood to birch or pine, water to a stream, a marsh or a lake shore, stone to scree or fell, game where game is), one you know if you know one, else into land you haven\'t seen; it walks there and back on the shortest path, and the walk\'s hours (more in wood, bog and on the fells) are the trip\'s travel, Vigor and Clarity too. The squares walked are seen. A stop leaves you where you stopped on the path, and the next work starts with the walk back.';

// ── The save ────────────────────────────────────────────────────────────────

const isSquare = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** A saved `trail` that reads right: at most `TRAIL_DAYS` days, each a whole day number and its squares. */
export function validTrail(x: unknown): x is TrailDay[] {
  if (!Array.isArray(x) || x.length > TRAIL_DAYS) return false;
  return x.every(d => typeof d === 'object' && d !== null && !Array.isArray(d)
    && Number.isInteger((d as TrailDay).day) && (d as TrailDay).day >= 1
    && Array.isArray((d as TrailDay).path) && (d as TrailDay).path.every(isSquare));
}

/** The walk back to camp from out on the land, square by square (the path from camp, walked the other way). */
export function pathHome(s: Region1State): number[] {
  if (!s.afield) return [];
  const r = reachOfRun(s);
  const home = homeOf(s, r);
  return pathTo(r, walkFrom(r, home.x, home.y), s.afield.y * r.w + s.afield.x).reverse();
}

/**
 * The walk done (on an already-cloned state): the squares walked are seen and go on the trail, and a
 * stop on the way (`leg`) leaves the Warden on the path, `afield`. A trip that's walked to the end
 * leaves them home, where it set out. Returns the journal's line for a stop out on the land, else null.
 */
export function endWalk(s: Region1State, trip: Trip, leg: Leg | null): string | null {
  if (!leg) { noteWalk(s, walkedSquares(trip, null)); return null; }
  const r = reachOfRun(s);
  const at = squareOnPath(r, trip, leg);
  noteWalk(s, leg.leg === 'back' ? walkedHomeTo(trip, at) : walkedSquares(trip, at));
  const x = at % r.w, y = Math.floor(at / r.w);
  if (x === trip.home.x && y === trip.home.y) return null;
  // Where the land is told from (camp, or the start) is no longer afield, as directed-explore.ts `standAt` has it.
  const origin = landOrigin({ config: s.config, campSpot: s.campSpot }, r);
  if (x === origin.x && y === origin.y) delete s.afield;
  else s.afield = { x, y };
  return stoppedLine(s, trip, at);
}
