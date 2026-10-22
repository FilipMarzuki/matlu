/**
 * Hex summaries (#1898, plan: docs/spikes/artificer-hex-world.md §3 "Eager vs lazy" and §6 Views):
 * a cheap picture of a hex, about 30 km across, read off its ~210 world cells. Step 5 of the hex
 * world (#1873).
 *
 * The words view (#1902), the journal (#1901) and the provinces outside the Reach (#1904) need to
 * know what every hex of the known world is like before anyone walks into it: "North, a day's walk:
 * the high fells". Making a hex in full means tracing its rivers (#1897), so a summary skips them:
 * it samples only the cell fields (`worldCell`, #1896). That makes it cheap enough to summarise the
 * whole known world (radius 4, 61 hexes) on the first view of it.
 *
 * Inside the Reach, `worldCell` is the Reach's own cell, so its rivers do count there; outside it
 * there are none yet. When #1897 lands, `landAt` below is the one place to switch to the cells with
 * rivers (`hexCells`).
 *
 * Pure: no randomness at all. Every value is a function of (seed, hex), and every tie has a rule.
 * Nothing calls this yet: it's new code behind no switch.
 */

import { cellsOfHex, hexDistance, packCell, type CellXY, type Hex } from './coords';
import { worldCell } from './cells';
import type { Biome, Cell } from './reach';

/** How far from the start hex (0,0) the known world reaches, in hexes: 61 hexes, about 4 days' walk out. */
export const KNOWN_RADIUS = 4;

/** What a hex is, in a word or two: what its people would call it. hex-names.ts turns it into a name. */
export type HexLand = 'fells' | 'heights' | 'pinewood' | 'birch-valley' | 'marsh' | 'lakes' | 'meadows' | 'heath';

export interface HexSummary {
  hex: Hex;
  /** The most common non-river biome of the hex's cells; a tie goes to the biome listed first in reach.ts. */
  biome: Biome;
  /** Over every cell of the hex, rivers and lakes included: 0 (lowest) to 1 (highest). */
  height: { min: number; max: number; mean: number };
  lakeCells: number;
  /** The best cell to settle (scored like provinces.ts's seats), or null if no cell of the hex would do. */
  seat: CellXY | null;
  land: HexLand;
}

/**
 * Where each biome comes in the `Biome` union in reach.ts, which breaks a tie for the most common
 * biome. A Record, not a list, so the compiler insists every biome has a place.
 */
const BIOME_RANK: Readonly<Record<Biome, number>> = {
  lake: 0, river: 1, marsh: 2, meadow: 3, heath: 4, birch: 5, pine: 6, scree: 7, fell: 8, snow: 9,
};

/**
 * How good a cell is to settle: a copy of `SETTLE` in src/artificer/world/provinces.ts, value for
 * value. A copy, because worldmap/ may not import from either game (src/); hex-summary.test.ts pins
 * the two equal, so change one, change both. Lakes, rivers and snow don't score: nobody builds there.
 */
export const SETTLE: Readonly<Partial<Record<Biome, number>>> = {
  meadow: 1, birch: 0.8, heath: 0.7, pine: 0.6, marsh: 0.25, scree: 0.3, fell: 0.1,
};

/** A lake or river beside a cell makes it a better seat, as in provinces.ts's `seatWater`. */
const WATER_BONUS = 0.5;

/**
 * A hex's land from its biome. River never wins a hex (it's left out of the count), but the table
 * covers every biome so the compiler can check it: a hex of nothing but river would be water.
 */
export const LAND: Readonly<Record<Biome, HexLand>> = {
  fell: 'fells', snow: 'fells', scree: 'heights', pine: 'pinewood', birch: 'birch-valley',
  marsh: 'marsh', lake: 'lakes', meadow: 'meadows', heath: 'heath', river: 'lakes',
};

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * A world cell's land, for a summary. The one place a summary reads the world, so that switching to
 * the cells with rivers outside the Reach (#1897's `hexCells`) is a change here and nowhere else.
 */
const landAt = (seed: number, c: CellXY): Cell => worldCell(seed, c);

/** What the hex `h` is like, from its cells (see `HexSummary`). */
export function hexSummary(seed: number, h: Hex): HexSummary {
  const cells = cellsOfHex(h);
  // Each cell's land, read once: the seat looks at every cell's four neighbours, and most of those
  // are in the hex too. Kept in a flat array over the hex's bounding box plus a one-cell border
  // (where the neighbours outside the hex lie), which is faster than a Map for the ~270 cells.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    if (c.cx < x0) x0 = c.cx;
    if (c.cx > x1) x1 = c.cx;
    if (c.cy < y0) y0 = c.cy;
    if (c.cy > y1) y1 = c.cy;
  }
  x0--; y0--;
  const w = x1 - x0 + 2;
  const known: (Cell | undefined)[] = new Array(w * (y1 - y0 + 2));
  const at = (c: CellXY): Cell => {
    const i = (c.cy - y0) * w + (c.cx - x0);
    return (known[i] ??= landAt(seed, c));
  };

  const counts = new Map<Biome, number>();
  let min = Infinity, max = -Infinity, sum = 0, lakeCells = 0;
  for (const c of cells) {
    const { biome, height } = at(c);
    if (biome !== 'river') counts.set(biome, (counts.get(biome) ?? 0) + 1);
    if (biome === 'lake') lakeCells++;
    if (height < min) min = height;
    if (height > max) max = height;
    sum += height; // in cellsOfHex's fixed row order, so the mean is the same to the last bit every time
  }

  // The most common biome. The comparison is total (no two biomes share a rank), so the winner
  // doesn't depend on the order the Map lists them in (which biome turned up first).
  let biome: Biome = 'river', most = 0;
  for (const [b, n] of counts) if (n > most || (n === most && BIOME_RANK[b] < BIOME_RANK[biome])) { biome = b; most = n; }

  return {
    hex: { q: h.q + 0, r: h.r + 0 }, // + 0 turns -0 into 0, which toEqual and Object.is tell apart
    biome,
    height: { min, max, mean: sum / cells.length },
    lakeCells,
    seat: seatOf(cells, at),
    land: LAND[biome],
  };
}

/**
 * The best cell of the hex to settle: its SETTLE value, +0.5 with a lake or river among its four
 * neighbours (which may lie in the next hex: water across a border still waters a village). No
 * noise, unlike provinces.ts, which draws some so two equal meadows don't always fall the same way:
 * a summary has no stream, and one seat a hex needs no spreading. A tie goes to the lower packCell.
 * Null if no cell scores (all water and snow).
 */
function seatOf(cells: readonly CellXY[], at: (c: CellXY) => Cell): CellXY | null {
  let seat: CellXY | null = null, best = -Infinity;
  for (const c of cells) {
    const base = SETTLE[at(c).biome];
    if (base === undefined) continue;
    const watered = STEPS.some(([dx, dy]) => {
      const b = at({ cx: c.cx + dx, cy: c.cy + dy }).biome;
      return b === 'lake' || b === 'river';
    });
    const score = base + (watered ? WATER_BONUS : 0);
    // cellsOfHex goes row by row, but packCell orders by column first, so the tie is broken
    // explicitly. The same sums of the same table values on every machine, so === is safe here.
    if (score > best || (score === best && seat !== null && packCell(c) < packCell(seat))) {
      seat = { cx: c.cx, cy: c.cy };
      best = score;
    }
  }
  return seat;
}

/** Every hex within `radius` of the start hex (0,0), in (q, r) order: 61 for the known world. */
export function summariesAround(seed: number, radius = KNOWN_RADIUS): HexSummary[] {
  const out: HexSummary[] = [];
  const origin: Hex = { q: 0, r: 0 };
  for (let q = -radius; q <= radius; q++)
    for (let r = -radius; r <= radius; r++) if (hexDistance({ q, r }, origin) <= radius) out.push(hexSummary(seed, { q, r }));
  return out;
}
