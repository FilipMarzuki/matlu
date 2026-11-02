/**
 * The ground under the Warden (#2022): the timer's minimap zoomed to about 2 m a square, top-down,
 * with the Warden walking out to the work, working, and walking back.
 *
 * The owner: "Every action should simulate the character actually traveling and gathering
 * resources … make those 9 squares more like a meter each … the same relative size as our diamonds
 * in our 2D/3D isometric game … a top down view so no diamonds but squares."
 *
 * **The scale.** A square is `SQUARE_M` metres, the isometric game's tile (its settlements are drawn
 * at 2 m a tile). One of the Reach's cells, about half an hour's walk across, is drawn as `CELL`
 * squares: a walk can't be drawn at its true length (a cell is ~1,000 squares, so at 1× the ground
 * would race past at ~250 squares a second), so the land is the Reach in miniature. Each cell is a
 * block of `CELL` × `CELL` squares of its own kind of land, and the Warden walks `CELL` squares from
 * one cell's middle to the next, which at 1× is a walking pace of about two squares a second.
 *
 * **The same place looks the same.** What each square looks like, and what stands on it (a birch, a
 * bush, stones), comes from where it is: a hash of its coordinates, nothing random, so camp and the
 * way to the birches look the same every day. The lines through the cells' middles, where the walks
 * run, are kept clear.
 *
 * **Every task moves** (the owner: "every action should simulate the character actually traveling"):
 * - A trip walks its path (walk-the-map's `trail`, minimap.ts `stepWalk`) from cell to cell, out to
 *   the work and back. Water stops at the shore, not in the middle of the lake.
 * - A trip whose work is in the cell it starts from walks a few squares out to it and back.
 * - At the work, the Warden steps between spots beside what's being gathered (a tree for wood, a
 *   bush for food, stones, the water's edge), facing it, with the work's own movement.
 * - Look around walks a small loop and comes back. Work at camp goes between the fire and the
 *   shelter.
 *
 * Pure: the scene and the pose are worked out from the run and the timer's moment alone, so a test
 * can check them without a browser; ground-draw.ts draws them. Presentation only: nothing here is
 * saved, and the sim, the play API, the console and AI players never see it.
 */

import type { Biome } from '../artificer/world/reach';
import type { Land } from '../artificer/world/hex-window';
import type { At, Leg } from './minimap';
import { roundTrip, SQUARE_HOURS } from './minimap';

/** Metres a square stands for: the isometric game's tile. */
export const SQUARE_M = 2;
/** Squares one of the Reach's cells is drawn as, across (see the module's comment for why not ~1,000). */
export const CELL = 12;
/** Squares the minimap shows across. */
export const VIEW = 3;

/** What a square of ground is: a kind of land, the water's edge, or camp's trodden ground. */
export type Ground = Biome | 'shore' | 'camp';
/** What can stand on a square. */
export type Thing = 'birch' | 'pine' | 'bush' | 'stones' | 'log' | 'stump' | 'fire' | 'shelter';
/** What the Warden is doing, as the hero sheet draws it (ground-draw.ts). */
export type Anim = 'idle' | 'walk' | 'pickup' | 'pull' | 'crouch' | 'drink';
export type Facing = 'south' | 'north' | 'east' | 'west';

/** A point in squares (fractional while walking). */
export interface P { x: number; y: number }

/** The four ways, in squares: north, east, south, west. */
const WAYS: readonly P[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

// ── The ground's tiles, in ground.png (scripts/artificer-ground-assets.py GROUND) ──────────────

/** Each kind of ground's tiles: a square takes one by its hash, so the ground isn't a repeated stamp. */
export const GROUND_TILES: Readonly<Record<Ground, readonly number[]>> = {
  // A tile named twice is drawn twice as often (the pine wood's mossy tile is the rarer one).
  birch: [0, 1], pine: [2, 2, 3], meadow: [4, 5, 6], heath: [7, 8], marsh: [9, 10], scree: [11], fell: [12],
  snow: [13, 14], river: [15], lake: [16], shore: [17, 18], camp: [19],
};
/** With snow lying: the land's own snowy tile where there is one, else the snowfield's. */
export const SNOWY_TILES: Readonly<Partial<Record<Ground, readonly number[]>>> = { birch: [20], pine: [21], meadow: [22], heath: [23] };
/** Iced over: the lake and the river. */
export const ICE_TILES: Readonly<Partial<Record<Ground, number>>> = { lake: 24, river: 25 };
export const GROUND_COUNT = 26;
/** Ground with no footing: the Warden stops at its edge. */
export const WET: readonly Ground[] = ['river', 'lake'];

// ── Where things are ────────────────────────────────────────────────────────

/** A square's hash, 0..1: the same square always gives the same number (`salt` for another one). */
export function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The Reach cell a square is in: cell `c` covers squares `c·CELL − CELL/2 … c·CELL + CELL/2 − 1`. */
export const cellOf = (x: number, y: number): At => ({ x: Math.floor((Math.round(x) + CELL / 2) / CELL), y: Math.floor((Math.round(y) + CELL / 2) / CELL) });
/** A cell's middle, in squares. */
export const middleOf = (c: At): P => ({ x: c.x * CELL, y: c.y * CELL });

/** What the minimap needs of the run: its land, camp's cell, and whether snow lies and the water is iced. */
export interface GroundWorld {
  land: Pick<Land, 'w' | 'h' | 'cells'>;
  camp: At | null;
  snow: boolean;
  ice: boolean;
  /** Squares the work set up (`Scene.extra`): something to gather, water to fetch from, or null to keep a square clear. */
  extra?: ReadonlyMap<string, Thing | 'water' | null>;
}

export const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Camp's trodden ground: its middle, the fire's square, the shelter's and the steps in front and
 * behind, a small patch with the land showing round it.
 */
const CAMP_GROUND: readonly P[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

/** A square's land as its cell has it (or the water the work set up), without the shore or camp. */
function landAt(w: GroundWorld, x: number, y: number): Biome | null {
  if (w.extra?.get(key(x, y)) === 'water') return 'river';
  const c = cellOf(x, y);
  if (c.x < 0 || c.y < 0 || c.x >= w.land.w || c.y >= w.land.h) return null;
  return w.land.cells[c.y * w.land.w + c.x].biome;
}

/**
 * What kind of ground a square is: camp's trodden ground by the fire, the shore on land beside the
 * water, else its cell's land; past the land's edge, null.
 */
export function groundAt(w: GroundWorld, x: number, y: number): Ground | null {
  const g = landAt(w, x, y);
  if (!g) return null;
  if (w.camp) {
    const m = middleOf(w.camp);
    if (CAMP_GROUND.some(d => x === m.x + d.x && y === m.y + d.y)) return 'camp';
  }
  if (!WET.includes(g) && WAYS.some(d => { const n = landAt(w, x + d.x, y + d.y); return !!n && WET.includes(n); })) return 'shore';
  return g;
}

/** Which tile of ground.png a square is drawn with. */
export function tileAt(w: GroundWorld, x: number, y: number): number | null {
  const g = groundAt(w, x, y);
  if (!g) return null;
  if (w.ice && ICE_TILES[g] !== undefined) return ICE_TILES[g]!;
  const set = w.snow && !WET.includes(g) && g !== 'camp' ? SNOWY_TILES[g] ?? GROUND_TILES.snow : GROUND_TILES[g];
  return set[Math.floor(hash(x, y, 7) * set.length)];
}

/** How often each thing stands on a square of each kind of land (the rest is open ground). */
export const THINGS: Readonly<Partial<Record<Ground, readonly (readonly [Thing, number])[]>>> = {
  birch: [['birch', 0.2], ['bush', 0.05], ['log', 0.03], ['stump', 0.02]],
  pine: [['pine', 0.24], ['log', 0.04], ['stump', 0.03]],
  meadow: [['bush', 0.04], ['stones', 0.02]],
  heath: [['bush', 0.06], ['stones', 0.04]],
  marsh: [['stump', 0.03], ['bush', 0.02]],
  scree: [['stones', 0.22]],
  fell: [['stones', 0.1]],
  snow: [['stones', 0.03]],
};

/** Camp's fire and shelter, beside its middle. */
export const FIRE_AT: P = { x: 1, y: 0 };
export const SHELTER_AT: P = { x: -1, y: -1 };

/** What stands on a square, if anything: camp's fire and shelter, what the work set up, or the land's own. */
export function thingAt(w: GroundWorld, x: number, y: number): Thing | null {
  const k = key(x, y);
  if (w.extra?.has(k)) { const extra = w.extra.get(k); return extra === 'water' ? null : extra ?? null; }
  if (w.camp) {
    const m = middleOf(w.camp);
    if (x === m.x + FIRE_AT.x && y === m.y + FIRE_AT.y) return 'fire';
    if (x === m.x + SHELTER_AT.x && y === m.y + SHELTER_AT.y) return 'shelter';
    if (Math.abs(x - m.x) <= 2 && Math.abs(y - m.y) <= 2) return null;
  }
  // The walks run along the lines through the cells' middles: kept clear.
  const mx = ((x % CELL) + CELL) % CELL, my = ((y % CELL) + CELL) % CELL;
  if (mx === 0 || my === 0) return null;
  const g = groundAt(w, x, y);
  const odds = g && g !== 'shore' ? THINGS[g] : undefined;
  if (!odds) return null;
  let r = hash(x, y, 1);
  for (const [thing, p] of odds) { if (r < p) return thing; r -= p; }
  return null;
}

/** Which of a thing's drawings a square uses (two birches side by side aren't twins). */
export const variantAt = (x: number, y: number, n: number): number => Math.floor(hash(x, y, 2) * n);

// ── A step of the day, as the minimap plays it ──────────────────────────────

/** What a task goes to: the walk-the-map needs (walk-the-map.ts TASK_NEED), or work at camp. */
export type Need = 'timber' | 'water' | 'forage' | 'stone' | 'game' | 'high' | 'look' | 'camp';

/** A step as the minimap plays it: the way there (squares), where the work is, and what it does there. */
export interface Scene {
  /** The way out, square points from the start to the work (straight lines between them). */
  out: P[];
  /** The way back, from the work to where the step ends. */
  back: P[];
  /** Where the Warden works, in turn, and the way each faces while working there. */
  spots: { at: P; facing: Facing }[];
  /** The work's movement. */
  anim: Anim;
  /** Squares the work set up (what to gather, water to fetch from), and its own spots kept clear (null). */
  extra: Map<string, Thing | 'water' | null>;
  /** Look around: the walk is the whole step (a loop out and back), with no work in the middle. */
  loop: boolean;
  /** Looking about: at the work the Warden turns to look each way in turn. */
  turns: boolean;
}

const facingOf = (d: P): Facing => (Math.abs(d.x) > Math.abs(d.y) ? (d.x > 0 ? 'east' : 'west') : (d.y < 0 ? 'north' : 'south'));
const plus = (a: P, b: P, k = 1): P => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const same = (a: P, b: P): boolean => a.x === b.x && a.y === b.y;
const unit = (a: P, b: P): P => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });

/** The work's movement for each need, and for each job at camp. */
const NEED_ANIM: Readonly<Record<Need, Anim>> = { timber: 'pull', water: 'drink', forage: 'pickup', stone: 'pickup', game: 'crouch', high: 'idle', look: 'idle', camp: 'pickup' };
const CAMP_ANIM: Readonly<Record<string, Anim>> = {
  rest: 'idle', study: 'crouch', experiment: 'crouch', drawmap: 'crouch', treat: 'crouch', tinker: 'pickup',
  build: 'pull', coldPit: 'pull', lidpit: 'pull', storemeat: 'pull', bankfire: 'crouch', preserve: 'crouch', camp: 'pull',
};
/** Jobs at camp done in one place: by the fire. The rest go between the fire, the shelter and back. */
const CAMP_STILL: readonly string[] = ['rest', 'study', 'experiment', 'drawmap', 'treat', 'bankfire', 'preserve'];
/** What the work sets up beside it, so there is always something there to gather. */
const NEED_THING: Readonly<Partial<Record<Need, Thing | 'water'>>> = { timber: 'birch', forage: 'bush', stone: 'stones', water: 'water' };

/**
 * A step of the day as the minimap plays it (pure).
 *
 * `walk`: the cells it walked (minimap.ts `stepWalk`: from where the Warden stood, out and back, or
 * out and on when heading out). `need`: what the task goes to, or 'camp' for work at camp (or null
 * for one that does nothing there). `id`: the action, for the work's movement at camp. `world`: the
 * land, to stop at the water's edge and to pick which tree. `from`: where the last step left the
 * Warden (its pose at its end), so this one starts there, not a square away. A deterministic
 * function of these.
 */
export function sceneOf(walk: readonly At[], need: Need | null, id: string, world: GroundWorld, from?: P): Scene {
  const start = middleOf(walk[0] ?? { x: 0, y: 0 });
  const p0 = from ?? start;
  /** The way, from where the last step left the Warden. */
  const fromHere = (pts: P[]): P[] => (same(pts[0], p0) ? pts : [p0, ...pts]);
  const extra = new Map<string, Thing | 'water' | null>();
  const anim = (need === null || need === 'camp' ? CAMP_ANIM[id] : undefined) ?? NEED_ANIM[need ?? 'camp'];
  const done = (sc: Omit<Scene, 'extra'>): Scene => {
    // Nothing stands on the way the Warden walks, or where they work.
    for (const pts of [sc.out, sc.back, sc.spots.map(s => s.at)]) for (const q of squaresOn(pts)) if (!extra.has(q)) extra.set(q, null);
    return { ...sc, extra };
  };
  // Nothing to do (a task that was skipped): where they stand.
  if (need === null) return done({ out: [p0], back: [p0], spots: [{ at: p0, facing: 'east' }], anim: 'idle', loop: false, turns: false });
  // Work at camp: by the fire, or between the fire, the shelter and back. A job that walked first
  // (Make camp, at a place you know) walks there and works where it ends.
  if (need === 'camp') {
    if (walk.length > 1) {
      const pts = walk.map(middleOf);
      const end = pts[pts.length - 1];
      return done({ out: fromHere(pts), back: [end], spots: [{ at: end, facing: facingOf(unit(pts[pts.length - 2], end)) }], anim, loop: false, turns: false });
    }
    const spots = CAMP_STILL.includes(id)
      ? [{ at: start, facing: 'east' as Facing }]
      : [{ at: plus(start, { x: 0, y: 1 }), facing: 'north' as Facing }, { at: plus(start, { x: 1, y: 1 }), facing: 'north' as Facing }, { at: start, facing: 'east' as Facing }];
    return done({ out: fromHere([start]), back: [start], spots, anim, loop: false, turns: false });
  }
  // Look around (where you stand): a loop of a few squares out and back.
  if (need === 'look' && walk.length <= 1) {
    const d = WAYS[Math.floor(hash(start.x, start.y, 3) * 4)];
    const side = { x: -d.y, y: d.x };
    const a = plus(start, d, 3), b = plus(a, side, 3), c = plus(start, side, 3);
    return done({ out: fromHere([start, a, b, c, start]), back: [start], spots: [{ at: start, facing: facingOf(d) }], anim: 'idle', loop: true, turns: true });
  }
  // The way out: the walk's cells, middle to middle, up to the far end (a trip there and back
  // retraces its way; heading out walks the whole of it and stays there). A river on the way is
  // forded, as the sim walks it (worldmap/reach.ts COST); a lake can't be walked.
  const pts = walk.map(middleOf);
  let round = roundTrip(walk);
  const there = round ? Math.floor((walk.length - 1) / 2) : walk.length - 1;
  let out = pts.slice(0, there + 1);
  let back = round ? pts.slice(there) : [pts[pts.length - 1]];
  // Work in the cell it started from: a few squares out to it, the way the square's hash picks.
  if (out.length === 1) {
    const d = WAYS[Math.floor(hash(start.x, start.y, 4 + need.length) * 4)];
    const spot = plus(start, d, 4);
    out = [start, spot];
    back = [spot, start];
    round = true;
  }
  // Water: stop at the shore, on the last square before the water.
  let dir = unit(out[out.length - 2], out[out.length - 1]);
  if (need === 'water') {
    const far = out[out.length - 1];
    const ground = groundAt(world, far.x, far.y);
    if (ground && WET.includes(ground)) {
      let at = out[out.length - 2];
      while (!same(at, far)) {
        const next = plus(at, dir);
        const g = groundAt(world, next.x, next.y);
        if (g && WET.includes(g)) break;
        at = next;
      }
      out = [...out.slice(0, -1), at];
      back = round ? [at, ...back.slice(1)] : [at];
    }
  }
  const work = out[out.length - 1];
  dir = out.length > 1 ? unit(out[out.length - 2], work) : dir;
  if (dir.x === 0 && dir.y === 0) dir = { x: 0, y: -1 };
  // Two spots side by side at the work, each facing what it works on, one square ahead. Heading out
  // ends out there, so it works on the one spot it ends on.
  const side = { x: -dir.y, y: dir.x };
  const spotsAt = round ? [work, plus(work, side)] : [work];
  const thing = NEED_THING[need];
  if (thing) {
    for (const s of spotsAt) {
      const ahead = plus(s, dir);
      const g = groundAt(world, ahead.x, ahead.y);
      // Water needs only to be there; a thing goes on open ground (trees in a pine wood are pines).
      if (thing === 'water') { if (!g || !WET.includes(g)) extra.set(key(ahead.x, ahead.y), 'water'); }
      else extra.set(key(ahead.x, ahead.y), thing === 'birch' && g === 'pine' ? 'pine' : thing);
    }
  }
  return done({ out: fromHere(out), back, spots: spotsAt.map(at => ({ at, facing: facingOf(dir) })), anim, loop: false, turns: need === 'look' || need === 'high' });
}

/** Every square a way passes through (its points are squares; it runs straight between them). */
function squaresOn(pts: readonly P[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1] ?? a;
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let k = 0; k <= n; k++) out.push(key(Math.round(a.x + ((b.x - a.x) * k) / Math.max(1, n)), Math.round(a.y + ((b.y - a.y) * k) / Math.max(1, n))));
  }
  return out;
}

// ── Where the Warden is, and what they're doing, at a moment ──────────────────

/** The Warden at a moment: where (squares, fractional while walking), facing which way, doing what. */
export interface Pose { at: P; facing: Facing; anim: Anim }

/** A polyline's length, in squares. */
const lengthOf = (pts: readonly P[]): number => pts.slice(1).reduce((n, p, i) => n + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** The point `d` squares along a polyline, and the way it's heading there. */
export function along(pts: readonly P[], d: number): { at: P; facing: Facing } {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left <= n || i === pts.length - 1) {
      const f = n > 0 ? Math.min(1, left / n) : 1;
      return { at: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, facing: facingOf(unit(a, b)) };
    }
    left -= n;
  }
  return { at: pts[pts.length - 1] ?? { x: 0, y: 0 }, facing: 'south' };
}

/** The way back along a polyline from `d` squares along it to its start (a walk stopped part way, turning for home). */
export function retrace(pts: readonly P[], d: number): P[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y));
  const res: P[] = [along(pts, d).at];
  for (let i = pts.length - 1; i >= 0; i--) if (cum[i] < d - 1e-9) res.push(pts[i]);
  return res.length > 1 ? res : [res[0], res[0]];
}

/**
 * Of a step `hours` long, the share spent walking `len` squares: half an hour a cell walked
 * (minimap.ts `SQUARE_HOURS`), at least a few minutes, kept between 5% and 45% so the work always
 * shows and so does the walk. With no hours, 30%.
 */
export function walkingShare(len: number, hours: number): number {
  if (!hours || hours <= 0) return 0.3;
  const walking = Math.max(0.15, (len / CELL) * SQUARE_HOURS);
  return Math.min(0.45, Math.max(0.05, walking / hours));
}

/** Hours at a work spot before stepping to the next one. */
export const SPOT_HOURS = 0.4;
/** Of each spot's time, the share spent stepping over to it. */
const STEP_SHARE = 0.2;

/** Working, `hours` into the work: the spot the Warden is at (or stepping to), and doing what. */
function working(sc: Scene, hours: number): Pose {
  const n = sc.spots.length;
  const k = Math.floor(Math.max(0, hours) / SPOT_HOURS);
  const into = (Math.max(0, hours) % SPOT_HOURS) / SPOT_HOURS;
  const to = sc.spots[k % n], from = sc.spots[(k + n - 1) % n];
  if (k > 0 && into < STEP_SHARE && !same(from.at, to.at)) {
    const f = into / STEP_SHARE;
    return { at: { x: from.at.x + (to.at.x - from.at.x) * f, y: from.at.y + (to.at.y - from.at.y) * f }, facing: facingOf(unit(from.at, to.at)), anim: 'walk' };
  }
  // Looking about turns to look each way in turn.
  if (sc.turns) return { at: to.at, facing: (['north', 'east', 'south', 'west'] as const)[k % 4], anim: 'idle' };
  return { at: to.at, facing: to.facing, anim: sc.anim };
}

/** The way home after `hours` of work: from the spot the work left the Warden on, then the scene's way back. */
function homeward(sc: Scene, hours: number): P[] {
  const last = sc.spots[Math.floor(Math.max(0, hours) / SPOT_HOURS) % sc.spots.length].at;
  return same(last, sc.back[0]) ? sc.back : [last, ...sc.back];
}

/** Walking a way, `f` (0..1) along it: idle once there. */
function walked(path: readonly P[], f: number): Pose {
  const len = lengthOf(path);
  if (len === 0 || f >= 1) return { at: path[path.length - 1], facing: along(path, len).facing, anim: 'idle' };
  return { ...along(path, f * len), anim: 'walk' };
}

/**
 * Where the Warden is, `frac` (0..1) of the way through a step `hours` long. Played as `legs` (a
 * session of chosen length, #1668: out, work, back, each trip on the same way; a stopped one, #1815,
 * turns for home where the stop caught it), else out over the first part of the time and home over
 * the last, working between. Look around walks its loop over the whole step. It starts where the
 * scene's way starts and ends where its way home ends, so one step follows on from the last.
 */
export function poseAt(sc: Scene, frac: number, hours: number, legs: readonly Leg[] | null = null): Pose {
  const f = Math.min(1, Math.max(0, frac));
  const outLen = lengthOf(sc.out);
  if (sc.loop) return walked(sc.out, f);
  // A session walks by its legs, when they walk at all (one whose trips have no travel is all work).
  if (legs?.some(l => l.kind !== 'work' && l.hours > 0)) return byLegs(sc, legs, f, outLen);
  // Out over the first share of the time and home over the last, each by its own length; a step
  // that ends where it works (one spot, nothing to walk back) has no way home.
  const share = outLen > 0 ? walkingShare(outLen, hours) : 0;
  const moves = sc.spots.length > 1 || !same(sc.spots[0].at, sc.back[0]) || lengthOf(sc.back) > 0;
  const backShare = moves ? walkingShare(Math.max(1, lengthOf(sc.back)), hours) : 0;
  if (f < share) return walked(sc.out, f / share);
  if (f <= 1 - backShare || backShare <= 0) return working(sc, (f - share) * hours);
  return walked(homeward(sc, (1 - share - backShare) * hours), (f - (1 - backShare)) / backShare);
}

/** Where the Warden is in a session played by its legs (see `poseAt`). */
function byLegs(sc: Scene, legs: readonly Leg[], f: number, outLen: number): Pose {
  const total = legs.reduce((h, l) => h + l.hours, 0);
  // A walk out cut short by a stop is shorter than the others: it gets as far as its hours allow.
  const fullOut = Math.max(0, ...legs.filter(l => l.kind === 'out').map(l => l.hours));
  const reach = (l: Leg): number => (fullOut > 0 ? outLen * Math.min(1, l.hours / fullOut) : outLen);
  let at = f * total, worked = 0, reached = outLen;
  let prev: Leg['kind'] | null = null;
  for (let k = 0; k < legs.length; k++) {
    const l = legs[k];
    if (at < l.hours || k === legs.length - 1) {
      const lf = l.hours > 0 ? Math.min(1, at / l.hours) : 1;
      if (l.kind === 'work') return working(sc, worked + Math.min(at, l.hours));
      if (l.kind === 'out') return { ...along(sc.out, lf * reach(l)), anim: 'walk' };
      // Home: straight after a walk out (a stop caught it), back the way it came; after work, from the spot.
      return walked(prev === 'out' ? retrace(sc.out, reached) : homeward(sc, worked), lf);
    }
    if (l.kind === 'out') reached = reach(l);
    if (l.kind === 'work') worked += l.hours;
    prev = l.kind;
    at -= l.hours;
  }
  return working(sc, worked);
}
