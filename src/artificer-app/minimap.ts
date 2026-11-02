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
 * While the day plays, the timer shows the ground instead, zoomed in to about 2 m a square, the
 * Warden walking the squares each action walked (`stepWalk`; ground-view.ts, #2022). This one stays
 * the zoomed-out view, in the status line: the land around you.
 *
 * Pure: the squares and the walk, from the state alone, so a test can check them without a browser.
 * main.ts draws them. Presentation only: nothing here is saved, and the play API, the console and AI
 * players never see it.
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

/** How many squares out from the middle are drawn: 2, a 5 × 5 grid, of which the middle 3 × 3 shows (the ring outside was for the timer's slide, before the ground took its place, #2022). */
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

/** A walk there and back: it ends where it started (three squares at least: out, the far end, back). */
export const roundTrip = (walk: readonly At[]): boolean =>
  walk.length >= 3 && walk[0].x === walk[walk.length - 1].x && walk[0].y === walk[walk.length - 1].y;

/** A leg of a trip as the timer plays it (playback.ts `Phase`): walking out, working there, walking back. */
export interface Leg { kind: 'out' | 'work' | 'back'; hours: number }

/** A square of the land is about half an hour's walk across (worldmap/reach.ts). */
export const SQUARE_HOURS = 0.5;

/** How the minimap is drawn: its size (the status line's; the timer draws the ground, #2022). */
export interface MiniOpts {
  size: 'sm';
}

/**
 * The minimap's HTML: a frame three squares across, over a 5 × 5 grid of squares (`MINI_R`) set one
 * square in, so the middle 3 × 3 shows. It's a picture of the squares around you, so a screen reader
 * hears where you stand ("Where you stand: Birch wood") rather than nine squares.
 */
export function minimapHtml(squares: readonly MiniSquare[], t: T, o: MiniOpts): string {
  const mid = squares[Math.floor(squares.length / 2)];
  const label = mid?.biome ? t('mini.label', { here: t(`biome.${mid.biome}`) }) : t('mini.labelBare');
  const cells = squares.map((q, k) => {
    const cls = [q.biome ? `mm-${q.biome}` : 'mm-out', q.camp ? 'mm-camp' : '', k === Math.floor(squares.length / 2) ? 'mm-here' : ''].filter(Boolean).join(' ');
    return `<i class="${cls}"></i>`;
  }).join('');
  return `<div class="minimap mm-${o.size}" role="img" aria-label="${esc(label)}"><div class="mmgrid">${cells}</div></div>`;
}
