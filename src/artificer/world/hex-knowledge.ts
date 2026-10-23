/**
 * What the Warden has seen and heard of past the Reach (#1900, hex world step 7; plan:
 * docs/spikes/artificer-hex-world.md §5 Saves).
 *
 * The rule stays today's: store what the Warden knows, regenerate the land from the seed. `seenOut`
 * (directed-explore.ts) keeps its shape — sorted Reach indices — so cells inside the Reach rectangle
 * still merge there; cells outside it merge into `seenWorld` as sorted, unique `packCell` values
 * instead, since the Reach's own 48×32 index can't name them. `heardHexes` is a fixed, empty-until-
 * written shape: nothing tells of a hex yet (that's a later step).
 */

import { packCell, unpackCell, type CellXY } from '../../../worldmap/coords';
import { WORLDGEN_VERSION } from '../../../worldmap/version';
import { REACH_H, REACH_W } from './reach';
import { hexWorldOn, WINDOW_MARGIN } from './hex-window';
import type { Region1State } from '../region1';

/** The window of #1899: world cell (x, y) with x in [-12, 59], y in [-12, 43]. */
const MIN_X = -WINDOW_MARGIN;
const MAX_X = REACH_W - 1 + WINDOW_MARGIN;
const MIN_Y = -WINDOW_MARGIN;
const MAX_Y = REACH_H - 1 + WINDOW_MARGIN;

const inWindow = (c: CellXY): boolean => c.cx >= MIN_X && c.cx <= MAX_X && c.cy >= MIN_Y && c.cy <= MAX_Y;

const merged = (had: readonly number[] | undefined, more: readonly number[]): number[] =>
  [...new Set([...(had ?? []), ...more])].sort((a, b) => a - b);

/**
 * Notes cells the Warden has seen, mutating `s` in place. Cells inside the Reach rectangle
 * (0 ≤ x < 48, 0 ≤ y < 32) merge into `seenOut` as Reach indices; cells outside merge into
 * `seenWorld` as `packCell` values, and `worldGen` is stamped to today's generator version. Does
 * nothing with the `hex-world` switch off.
 */
export function noteSeenCells(s: Region1State, cells: readonly CellXY[]): void {
  if (!hexWorldOn(s)) return;
  const reachIdx: number[] = [];
  const worldIdx: number[] = [];
  for (const c of cells) {
    if (c.cx >= 0 && c.cx < REACH_W && c.cy >= 0 && c.cy < REACH_H) reachIdx.push(c.cy * REACH_W + c.cx);
    else worldIdx.push(packCell(c));
  }
  if (reachIdx.length) s.seenOut = merged(s.seenOut, reachIdx);
  if (worldIdx.length) {
    s.seenWorld = merged(s.seenWorld, worldIdx);
    s.worldGen = WORLDGEN_VERSION;
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** A saved `seenWorld` that reads right: integers whose `unpackCell` lies inside the #1899 window. */
export const validSeenWorld = (x: unknown): x is number[] =>
  Array.isArray(x) && x.every(v => isInt(v) && inWindow(unpackCell(v)));

/** A saved `heardHexes` that reads right: `hexKey` strings (`"q,r"`, worldmap/coords.ts). */
export const validHeardHexes = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every(v => typeof v === 'string' && /^-?\d+,-?\d+$/.test(v));

/** A saved world `afield` that reads right: whole-number x and y inside the #1899 window. */
export function validAfieldWorld(x: unknown): x is { x: number; y: number } {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return isInt(o.x) && isInt(o.y) && inWindow({ cx: o.x as number, cy: o.y as number });
}
