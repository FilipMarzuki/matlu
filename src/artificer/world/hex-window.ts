/**
 * The land a run plays on: the Reach alone, or a window into the wider world (#1899, step 6 of the
 * hex world, #1873; plan: docs/spikes/artificer-hex-world.md §4 and "The rules switch").
 *
 * With the `hex-world` switch off, a run's land is exactly its Reach (world/reach.ts): the same
 * cells and walking hours as today, just wrapped in a `Land` with `ox = oy = 0` so callers have one
 * shape to read. With it on, the land is a 72×56 window of world cells (`worldWindow`): the Reach
 * grown by `WINDOW_MARGIN` cells on every side, so the three rings (`ringOfHours`, unchanged) can
 * reach past the Reach's edge into the neighbouring hexes. The window is fixed for the run's
 * lifetime; recentring it when camp moves to another hex is a later step (#1900, #1901).
 *
 * Nothing plays through this yet: `landOfRun` has no caller (#1901 wires directed explore and
 * walk-the-map to it).
 */

import { hexCells } from '../../../worldmap/rivers';
import { hexKey, hexOfCell, packCell, type CellXY, type Hex } from '../../../worldmap/coords';
import { REACH_H, REACH_W, generateReach, walkingHours, type Cell, type Reach } from './reach';
import { featureOn } from '../features';
import { reachOfRun } from '../descriptive-map';
import { seedOf } from '../rng';
import type { Region1State } from '../region1';

export const HEX_WORLD = 'hex-world';

export const hexWorldOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, HEX_WORLD);

/** A Reach-shaped grid whose local cell (x, y) is world cell (x + ox, y + oy). */
export type Land = Reach & { ox: number; oy: number };

/** How far the window grows past the Reach's edge on every side. */
export const WINDOW_MARGIN = 12;

const WINDOW_SEEDS = 2;
const windowMemo = new Map<number, Land>();

function buildWindow(seed: number): Land {
  const ox = -WINDOW_MARGIN, oy = -WINDOW_MARGIN;
  const w = REACH_W + 2 * WINDOW_MARGIN, h = REACH_H + 2 * WINDOW_MARGIN;
  const reach = generateReach(seed);
  const camp = { x: reach.camp.x + WINDOW_MARGIN, y: reach.camp.y + WINDOW_MARGIN };

  // Group the window's cells by the hex that owns them, so each hex's land (`hexCells`, with its
  // rivers) is made once, not once a cell.
  const buckets = new Map<string, { hex: Hex; items: { i: number; c: CellXY }[] }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c: CellXY = { cx: x + ox, cy: y + oy };
      const hex = hexOfCell(c);
      const key = hexKey(hex);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { hex, items: [] }; buckets.set(key, bucket); }
      bucket.items.push({ i: y * w + x, c });
    }
  }

  const cells: Cell[] = new Array(w * h);
  for (const { hex, items } of buckets.values()) {
    const hc = hexCells(seed, hex);
    const index = new Map<number, number>();
    hc.cells.forEach((c, i) => index.set(packCell(c), i));
    // `hex` is `hexOfCell(c)` for every `c` here, so `cellsOfHex(hex)` (what `hexCells` indexes)
    // always holds it.
    for (const { i, c } of items) cells[i] = hc.land[index.get(packCell(c))!];
  }

  return { seed, w, h, cells, camp, hours: walkingHours(cells, w, h, camp), ox, oy };
}

/** A window of world cells around the start hex, fixed per seed. The last {@link WINDOW_SEEDS} seeds are kept. */
export function worldWindow(seed: number): Land {
  const hit = windowMemo.get(seed);
  if (hit) return hit;
  const land = buildWindow(seed);
  const oldest = windowMemo.keys().next();
  if (windowMemo.size >= WINDOW_SEEDS && !oldest.done) windowMemo.delete(oldest.value);
  windowMemo.set(seed, land);
  return land;
}

/** The land a run plays on: the Reach with the `hex-world` switch off, a window into the world with it on. */
export function landOfRun(s: Pick<Region1State, 'character' | 'config'>): Land {
  if (!hexWorldOn(s)) {
    const r = reachOfRun(s);
    return { ...r, ox: 0, oy: 0 };
  }
  return worldWindow(seedOf(s.character.id));
}

/** The world cell a land's local (x, y) is. */
export const toWorld = (land: Land, x: number, y: number): CellXY => ({ cx: x + land.ox, cy: y + land.oy });

/** The local (x, y) a world cell is in a land, or null outside it. */
export function toLocal(land: Land, cx: number, cy: number): { x: number; y: number } | null {
  const x = cx - land.ox, y = cy - land.oy;
  return x < 0 || y < 0 || x >= land.w || y >= land.h ? null : { x, y };
}

/** The Reach's own index (row by row, `REACH_W` wide) for a land's local (x, y), or null outside the Reach rectangle. */
export function reachIndexOf(land: Land, x: number, y: number): number | null {
  const { cx, cy } = toWorld(land, x, y);
  return cx < 0 || cy < 0 || cx >= REACH_W || cy >= REACH_H ? null : cy * REACH_W + cx;
}
