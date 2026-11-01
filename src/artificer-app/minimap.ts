/**
 * The minimap (#2016): nine squares around where the Warden stands, top-down, the Warden in the
 * middle. The owner: "9 squares with player in the center … the feeling of action and movement,
 * without really showing much."
 *
 * Each square is one cell of the run's land (`landOfRun`: the Reach's grid, or the hex world's window
 * with `hex-world` on), about half an hour's walk across, colored by its biome as the drawn map
 * colors it. Only the squares next to you, which you'd see standing there: it is not the drawn map,
 * which still has to be learned (`map-learning`).
 *
 * The movement comes from the day's timer (#1669): while an action plays, the Warden steps along the
 * squares it walked (today's `trail`, which `walk-the-map` records), out to the work, a while there
 * and back, and the view slides one square at a time.
 *
 * Pure: the squares, the walk and where along it the Warden is, from the state alone, so a test can
 * check them without a browser. main.ts draws them. Presentation only: nothing here is saved, and
 * the play API, the console and AI players never see it.
 */

import type { T } from '../artificer/i18n';
import type { Region1State } from '../artificer/region1';
import { homeOf, wardenAt } from '../artificer/walk-the-map';
import { landOfRun, toLocal, type Land } from '../artificer/world/hex-window';
import { REACH_W, type Biome } from '../artificer/world/reach';
import { esc } from './html';

/** A square of the land, by its column and row in the land's grid. */
export interface At { x: number; y: number }

/** One square of the minimap. */
export interface MiniSquare {
  /** Its biome; null past the land's edge. */
  biome: Biome | null;
  /** Camp is here. */
  camp: boolean;
}

/** How many squares out from the middle are drawn: 2, a 5 × 5 grid, of which the middle 3 × 3 shows; the ring outside is there for the slide. */
export const MINI_R = 2;

/**
 * The squares around `at`, `r` out each way, row by row from the top left: (2r + 1)² of them. The
 * middle one is `at`. `camp`: camp's square, or null before camp is made.
 */
export function miniAround(land: Land, at: At, camp: At | null, r = MINI_R): MiniSquare[] {
  const out: MiniSquare[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = at.x + dx, y = at.y + dy;
      const inside = x >= 0 && y >= 0 && x < land.w && y < land.h;
      out.push({ biome: inside ? land.cells[y * land.w + x].biome : null, camp: !!camp && camp.x === x && camp.y === y });
    }
  }
  return out;
}

/** Where the Warden stands in this state, and camp's square (null before camp), on the run's land. */
export function placesOf(s: Region1State, land: Land = landOfRun(s)): { at: At; camp: At | null } {
  return { at: wardenAt(s, land), camp: s.campSpot ? homeOf(s, land) : null };
}

/** Today's trail (Reach indices, walk-the-map.ts) in a state: the squares walked so far today, or none. */
function trailToday(s: Region1State): readonly number[] {
  const last = s.trail?.[s.trail.length - 1];
  return last && last.day === s.day ? last.path : [];
}

/**
 * The squares an action walked, in order, from where the Warden stood before it (`before`) to where
 * it left them (`after`): the part of today's trail the action added. A trip from camp walks out and
 * back, so its walk starts and ends at camp; heading out (#1839) ends out on the land. An action
 * that walked nowhere gives just the square it was done on. With `walk-the-map` off there's no
 * trail, and the Warden stays where they were.
 */
export function stepWalk(before: Region1State, after: Region1State, land: Land = landOfRun(before)): At[] {
  const start = wardenAt(before, land);
  const had = trailToday(before);
  const now = trailToday(after);
  // The same day: what the action added comes after what was there. A trail that isn't longer (or
  // a new day's) is taken whole.
  const added = after.day === before.day && now.length >= had.length ? now.slice(had.length) : now;
  const walk: At[] = [start];
  for (const ri of added) {
    const p = toLocal(land, ri % REACH_W, Math.floor(ri / REACH_W));
    if (!p) continue;
    const last = walk[walk.length - 1];
    if (last.x !== p.x || last.y !== p.y) walk.push(p);
  }
  return walk;
}

/** A square of the land is about half an hour's walk across (worldmap/reach.ts). */
export const SQUARE_HOURS = 0.5;

/**
 * Of a trip's time, the share spent walking out (and the same back): its squares at half an hour
 * each, over the action's hours, kept between 5% and 45% so the work always shows and so does the
 * walk. Without the hours, 30%.
 */
export function walkShare(walk: readonly At[], hours?: number): number {
  if (!hours || hours <= 0) return 0.3;
  const out = (Math.floor((walk.length - 1) / 2) * SQUARE_HOURS) / hours;
  return Math.min(0.45, Math.max(0.05, out));
}

/**
 * Where along its walk the Warden is, `frac` (0..1) of the way through the action (`hours` long). A
 * trip there and back (it ends where it started) walks out over the first part of the time
 * (`walkShare`), stays at the far end for the work, and walks back over the last part. A walk that
 * ends elsewhere (heading out) is walked evenly over the whole action.
 */
export function walkPos(walk: readonly At[], frac: number, hours?: number): At {
  const n = walk.length;
  if (n <= 1) return walk[0];
  const f = Math.min(1, Math.max(0, frac));
  const first = walk[0], last = walk[n - 1];
  const roundTrip = n >= 3 && first.x === last.x && first.y === last.y;
  if (!roundTrip) return walk[Math.min(n - 1, Math.floor(f * n))];
  // The far end: the square furthest along the way out (the middle of a path walked there and back).
  const far = Math.floor((n - 1) / 2);
  const share = walkShare(walk, hours);
  const at = f < share ? (f / share) * far
    : f <= 1 - share ? far
      : far + ((f - (1 - share)) / share) * (n - 1 - far);
  return walk[Math.min(n - 1, Math.round(at))];
}

/** How the minimap is drawn: its size, and the step it slides in from (the last square to this one), if any. */
export interface MiniOpts {
  size: 'sm' | 'lg';
  /** The move just made, one square at most each way: the view slides in from where it was. */
  slide?: { dx: number; dy: number } | null;
  /** The element's id, for the timer to redraw it in place. */
  id?: string;
}

/**
 * The minimap's HTML: a frame three squares across, over a 5 × 5 grid of squares (`MINI_R`) set one
 * square in, so the middle 3 × 3 shows. Sliding moves the whole grid in from the last square, so the
 * squares coming into view are already drawn. It's a picture of the squares around you, so a screen
 * reader hears where you stand ("Where you stand: Birch wood") rather than nine squares.
 */
export function minimapHtml(squares: readonly MiniSquare[], t: T, o: MiniOpts): string {
  const mid = squares[Math.floor(squares.length / 2)];
  const here = mid?.biome ? t(`biome.${mid.biome}`) : '';
  const cells = squares.map((q, k) => {
    const cls = [q.biome ? `mm-${q.biome}` : 'mm-out', q.camp ? 'mm-camp' : '', k === Math.floor(squares.length / 2) ? 'mm-here' : ''].filter(Boolean).join(' ');
    return `<i class="${cls}"></i>`;
  }).join('');
  const s = o.slide && (o.slide.dx || o.slide.dy) && Math.abs(o.slide.dx) <= 1 && Math.abs(o.slide.dy) <= 1 ? o.slide : null;
  const grid = `<div class="mmgrid${s ? ' slide' : ''}"${s ? ` style="--dx:${s.dx};--dy:${s.dy}"` : ''}>${cells}</div>`;
  return `<div class="minimap mm-${o.size}"${o.id ? ` id="${o.id}"` : ''} role="img" aria-label="${esc(t('mini.label', { here }))}">${grid}</div>`;
}
