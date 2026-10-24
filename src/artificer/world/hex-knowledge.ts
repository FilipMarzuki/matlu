/**
 * What the Warden has seen and heard of past the Reach (#1900, hex world step 7; plan:
 * docs/spikes/artificer-hex-world.md §5 Saves).
 *
 * The rule stays today's: store what the Warden knows, regenerate the land from the seed. `seenOut`
 * (directed-explore.ts) keeps its shape — sorted Reach indices — so cells inside the Reach rectangle
 * still merge there; cells outside it merge into `seenWorld` as sorted, unique `packCell` values
 * instead, since the Reach's own 48×32 index can't name them. `heardHexes` is a fixed, empty-until-
 * written shape: nothing tells of a hex yet (that's a later step).
 *
 * Writer and loader share one rule for what `seenWorld` can hold (`savedWorldCell`): what
 * `noteSeenCells` writes always loads back, so a reload never forgets something the Warden knew a
 * moment before. The loader reads `seenWorld` and `heardHexes` entry by entry: each entry is one
 * fact on its own, so a stray one (a hand-edited save, a writer bug) costs only itself, not
 * everything else the Warden saw.
 */

import { hexKey, packCell, unpackCell, type CellXY } from '../../../worldmap/coords';
import { WORLDGEN_VERSION } from '../../../worldmap/version';
import { REACH_H, REACH_W } from './reach';
import { hexWorldOn, WINDOW_MARGIN } from './hex-window';
import { merged } from '../directed-explore';
import type { Region1State } from '../region1';

/** The window of #1899: world cell (x, y) with x in [-12, 59], y in [-12, 43]. */
const MIN_X = -WINDOW_MARGIN;
const MAX_X = REACH_W - 1 + WINDOW_MARGIN;
const MIN_Y = -WINDOW_MARGIN;
const MAX_Y = REACH_H - 1 + WINDOW_MARGIN;

const inWindow = (c: CellXY): boolean => c.cx >= MIN_X && c.cx <= MAX_X && c.cy >= MIN_Y && c.cy <= MAX_Y;

/** Is world cell (x, y) inside the Reach rectangle (0 ≤ x < 48, 0 ≤ y < 32), where `seenOut` and the Reach's own index work? */
export const inReach = (x: number, y: number): boolean => x >= 0 && x < REACH_W && y >= 0 && y < REACH_H;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Can `seenWorld` hold this entry? A `packCell` of a cell inside the #1899 window and outside the
 * Reach (a Reach cell belongs in `seenOut`). Only whole numbers: `unpackCell` of a fraction is no
 * cell, and a negative number unpacks far outside the window, so every entry kept packs back to itself.
 */
function savedWorldCell(v: unknown): v is number {
  if (!isInt(v)) return false;
  const c = unpackCell(v);
  return inWindow(c) && !inReach(c.cx, c.cy);
}

/**
 * Notes cells the Warden has seen, mutating `s` in place. Cells inside the Reach rectangle
 * (0 ≤ x < 48, 0 ≤ y < 32) merge into `seenOut` as Reach indices; cells outside merge into
 * `seenWorld` as `packCell` values, and `worldGen` is stamped to today's generator version. A cell
 * past the #1899 window is skipped: the save couldn't hold it (`readSeenWorld`), and the land a run
 * plays on is that window (hex-window.ts `landOfRun`), so nothing in play is out there. Does nothing
 * with the `hex-world` switch off.
 */
export function noteSeenCells(s: Region1State, cells: readonly CellXY[]): void {
  if (!hexWorldOn(s)) return;
  const reachIdx: number[] = [];
  const worldIdx: number[] = [];
  for (const c of cells) {
    if (inReach(c.cx, c.cy)) { reachIdx.push(c.cy * REACH_W + c.cx); continue; }
    // The loader's own test (`savedWorldCell`), so what's written here always loads back.
    const n = packCell(c);
    if (savedWorldCell(n)) worldIdx.push(n);
  }
  if (reachIdx.length) s.seenOut = merged(s.seenOut, reachIdx);
  if (worldIdx.length) {
    s.seenWorld = merged(s.seenWorld, worldIdx);
    s.worldGen = WORLDGEN_VERSION;
  }
}

/**
 * A saved `seenWorld`, read entry by entry: the cells it can hold (`savedWorldCell`), sorted, no
 * repeats, as its doc promises. Undefined when it isn't an array or nothing is left (none seen).
 */
export function readSeenWorld(x: unknown): number[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const cells = merged(undefined, x.filter(savedWorldCell));
  return cells.length ? cells : undefined;
}

/**
 * One saved `heardHexes` key as `hexKey` writes it (`"q,r"`, worldmap/coords.ts), or null if it
 * isn't one. Re-made through `hexKey` so that '01,2' and '1,2' (or '-0,3' and '0,3') are one key:
 * dedup and lookups by `hexKey` compare strings, and would miss a key spelled another way.
 */
function canonicalHexKey(v: unknown): string | null {
  const m = typeof v === 'string' ? /^(-?\d+),(-?\d+)$/.exec(v) : null;
  if (!m) return null;
  const q = Number(m[1]), r = Number(m[2]);
  // Past 2^53 a number no longer names one hex ('99999999999999999999' reads as 1e20): no key.
  return Number.isSafeInteger(q) && Number.isSafeInteger(r) ? hexKey({ q, r }) : null;
}

/**
 * A saved `heardHexes`, read entry by entry: each key made canonical (`canonicalHexKey`), the ones
 * that aren't keys dropped, sorted, no repeats. Undefined when it isn't an array or nothing is left.
 */
export function readHeardHexes(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const keys = [...new Set(x.map(canonicalHexKey).filter((k): k is string => k !== null))].sort();
  return keys.length ? keys : undefined;
}

/** A saved world `afield` that reads right: whole-number x and y inside the #1899 window. */
export function validAfieldWorld(x: unknown): x is { x: number; y: number } {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return isInt(o.x) && isInt(o.y) && inWindow({ cx: o.x as number, cy: o.y as number });
}
