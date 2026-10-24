/**
 * Rivers across hexes (#1897, plan: docs/spikes/artificer-hex-world.md §3, "Rivers"): springs in
 * each hex, each traced downhill over the world's height, and a hex's full cells with every river
 * that crosses it. Step 4 of the hex world (#1873).
 *
 * Why this works without generating the world in order: the world's height (`worldCell`, #1896) is
 * a pure function of (seed, cell), so a trace can run on into a neighbouring hex just by reading
 * the height there. Nothing about a hex needs saving, and a hex looks the same however you reached
 * it. To draw hex H we only need every river that could reach H: those that start in a hex within
 * `RIVER_RADIUS` of H (a trace holds at most `RIVER_MAX` cells, which keeps it within that radius),
 * plus the Reach's own rivers, which carry on past its edge (`edgeSprings`).
 *
 * Seeds: each hex's springs draw from their own `|hexworld|springs:q,r` stream, so one hex's
 * springs never move another's, and none of this touches the Reach's `|world|` streams.
 *
 * Nothing calls this yet: it's new code behind no switch.
 */

import { generator, seedOf } from './rng';
import { cellsOfHex, packCell, type CellXY, type Hex } from './coords';
import { worldCell } from './cells';
import { REACH_W, REACH_H, type Biome, type Cell } from './reach';

/** The most cells a river's course may hold. */
export const RIVER_MAX = 60;

/**
 * `traceRiver`'s pull south, half of `generateReach`'s 0.04: the Reach's land slopes about 0.032 a
 * cell, the world's only about 0.016, so the same pull would win out here and send most steps
 * south in near-straight lines. At 0.02 the world's rivers wind the way the Reach's do (#1963).
 */
export const WORLD_SOUTH_PULL = 0.02;

/**
 * How many hexes away a river's spring may be and still reach a hex. The plan's 3 was too few: the
 * nearest cells of two hexes 4 apart (due north) are 48 steps apart, under `RIVER_MAX`, so a spring
 * 4 hexes off can reach H. Due north or south, hexes 5 apart are 64 steps apart, out of reach.
 *
 * East or west it's closer: hexes 5 apart there (e.g. (0,0) and (5,-3)) are 55 steps apart, so a
 * river that ran 55 cells sideways could reach a hex 5 off and be missed. Rivers here don't: the
 * pull south (see `traceRiver`) keeps them heading downhill to the south, and none of 13,567 traces
 * (150 seeds, springs in hexes within 8 of the start) moved more than 29 cells east or west.
 * `rivers.test.ts` scenario 3 pins the radius on 20 seeds.
 */
export const RIVER_RADIUS = 4;

/** How a trace ended: in a lake, at the Reach's edge, boxed in by its own course (a tarn), or at `RIVER_MAX` cells. */
export type RiverEnd = 'lake' | 'reach' | 'tarn' | 'max';

export interface River {
  /** The course, spring first: every cell a 4-neighbour of the one before, none twice. */
  cells: CellXY[];
  end: RiverEnd;
}

/** A hex's cells (row by row, as `cellsOfHex`) and the land on each, rivers and tarns included. */
export interface HexCells {
  readonly cells: readonly CellXY[];
  /** `land[i]` is the land on `cells[i]`. */
  readonly land: readonly Cell[];
}

const inReach = (c: CellXY) => c.cx >= 0 && c.cx < REACH_W && c.cy >= 0 && c.cy < REACH_H;

const isHigh = (b: Biome) => b === 'scree' || b === 'fell';

/**
 * A hex's springs: 0 to 3 cells on its high ground (scree or fell), outside the Reach (which has
 * springs of its own), drawn from the hex's own stream.
 *
 * One draw for how many (0–3), then one draw a pick. A hex with no high ground still makes its
 * draws (each pick finds nothing), so how a stream is used never depends on the land.
 */
export function springsOfHex(seed: number, h: Hex): CellXY[] {
  const rnd = generator(seedOf(`${seed}|hexworld|springs:${h.q},${h.r}`));
  const candidates = cellsOfHex(h).filter(c => !inReach(c) && isHigh(worldCell(seed, c).biome));
  const n = Math.floor(rnd() * 4);
  const springs: CellXY[] = [];
  const picked = new Set<number>();
  for (let i = 0; i < n; i++) {
    // With no candidates this reads candidates[0], which is undefined: the draw happens, nothing is picked.
    const c = candidates[Math.floor(rnd() * candidates.length)];
    if (c === undefined || picked.has(packCell(c))) continue; // a repeated pick is dropped
    picked.add(packCell(c));
    springs.push(c);
  }
  return springs;
}

/**
 * Where the Reach's rivers carry on: for each Reach river cell on its border, the cell just outside
 * across that edge (at a corner, across the north or south edge). `generateReach` stops a river
 * when it reaches the edge of its map; these springs pick it up on the other side.
 *
 * Read from `worldCell`, which inside the Reach is the Reach's own (remembered) cell, so this
 * doesn't make the Reach again. Row by row.
 */
export function edgeSprings(seed: number): CellXY[] {
  const out: CellXY[] = [];
  for (let y = 0; y < REACH_H; y++)
    for (let x = 0; x < REACH_W; x++) {
      const onBorder = x === 0 || y === 0 || x === REACH_W - 1 || y === REACH_H - 1;
      if (!onBorder || worldCell(seed, { cx: x, cy: y }).biome !== 'river') continue;
      if (y === 0) out.push({ cx: x, cy: -1 });
      else if (y === REACH_H - 1) out.push({ cx: x, cy: REACH_H });
      else if (x === 0) out.push({ cx: -1, cy: y });
      else out.push({ cx: REACH_W, cy: y });
    }
  return out;
}

// generateReach's neighbour order (east, west, south, north): on an exact tie the first one wins.
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * A river's course from `start`, downhill over the world's height. Each step is `generateReach`'s
 * rule: the lowest 4-neighbour not yet on this course, scored by height with a pull south
 * (`- WORLD_SOUTH_PULL * dy`), so a river carves through small dips instead of stopping in them.
 *
 * It stops, without taking the step, when the next cell is a lake (`lake`) or inside the Reach
 * (`reach`: the Reach draws its own rivers, so a world river never enters it). It stops when every
 * neighbour is already on its course (`tarn`: the last cell becomes a small lake) or when it holds
 * `RIVER_MAX` cells (`max`).
 *
 * A trace reads only the world's height, never other traces, so two rivers that meet just overlap
 * and neither depends on which was traced first.
 */
export function traceRiver(seed: number, start: CellXY): River {
  const cells: CellXY[] = [];
  const course = new Set<number>();
  let at: CellXY = { cx: start.cx, cy: start.cy }; // a copy: the course never holds the caller's object
  for (;;) {
    cells.push(at);
    course.add(packCell(at));
    if (cells.length >= RIVER_MAX) return { cells, end: 'max' };

    let next: CellXY | undefined;
    let nextScore = Infinity;
    for (const [dx, dy] of STEPS) {
      const n = { cx: at.cx + dx, cy: at.cy + dy };
      if (course.has(packCell(n))) continue;
      const score = worldCell(seed, n).height - WORLD_SOUTH_PULL * dy;
      if (score < nextScore) {
        next = n;
        nextScore = score;
      }
    }
    if (next === undefined) return { cells, end: 'tarn' };
    if (worldCell(seed, next).biome === 'lake') return { cells, end: 'lake' };
    if (inReach(next)) return { cells, end: 'reach' };
    at = next;
  }
}

/** Every hex within `radius` of `h`, q then r. */
function hexesAround(h: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++)
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) out.push({ q: h.q + dq, r: h.r + dr });
  return out;
}

// The last few full hexes, most recently used last (a Map keeps insertion order). Each value is a
// pure function of its key, frozen so no caller can change what a later call returns: the cache
// only saves the work of making a hex again, it never changes what a hex is.
const HEX_CACHE_SIZE = 32;
const hexCache = new Map<string, HexCells>();

/**
 * A hex's full cells: `worldCell` for each of its cells, with every river that crosses it.
 *
 * The rivers are the traces from the springs of every hex within `RIVER_RADIUS` of `h`, and from
 * the Reach's edge (`edgeSprings`). A trace's cells become `river` (open water stays `lake`), and a
 * trace that ends boxed in turns its last cell into a lake (a tarn). Traces are applied in order of
 * their spring's `packCell`, so the order never depends on how the springs were found. (With
 * "open water stays lake" the result doesn't depend on that order either: a cell is lake if it was
 * or any trace's tarn is there, else river if any trace crosses it.)
 *
 * Inside the Reach every cell is the Reach's own: traces never enter it.
 */
export function hexCells(seed: number, h: Hex): HexCells {
  const key = `${seed}|${h.q},${h.r}`;
  const hit = hexCache.get(key);
  if (hit !== undefined) {
    // Least recently used goes first: move this one to the back.
    hexCache.delete(key);
    hexCache.set(key, hit);
    return hit;
  }

  const cells = cellsOfHex(h);
  const land: Cell[] = cells.map(c => worldCell(seed, c));
  const index = new Map<number, number>();
  cells.forEach((c, i) => index.set(packCell(c), i));

  const springs = [...hexesAround(h, RIVER_RADIUS).flatMap(s => springsOfHex(seed, s)), ...edgeSprings(seed)];
  springs.sort((a, b) => packCell(a) - packCell(b));
  for (const spring of springs) {
    const river = traceRiver(seed, spring);
    for (const c of river.cells) {
      const i = index.get(packCell(c));
      if (i !== undefined && land[i].biome !== 'lake') land[i] = { ...land[i], biome: 'river' };
    }
    if (river.end === 'tarn') {
      const i = index.get(packCell(river.cells[river.cells.length - 1]));
      if (i !== undefined) land[i] = { ...land[i], biome: 'lake' };
    }
  }

  const result: HexCells = Object.freeze({
    cells: Object.freeze(cells.map(c => Object.freeze(c))),
    land: Object.freeze(land.map(c => Object.freeze(c))),
  });
  const oldest = hexCache.keys().next();
  if (hexCache.size >= HEX_CACHE_SIZE && !oldest.done) hexCache.delete(oldest.value);
  hexCache.set(key, result);
  return result;
}
