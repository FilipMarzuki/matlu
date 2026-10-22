/**
 * The world's cells (#1896, plan: docs/spikes/artificer-hex-world.md §3): height, moisture and
 * biome for any world cell, as pure functions of (seed, cell). Step 3 of the hex world (#1873).
 *
 * The world beyond the Reach is one world-wide noise field in world cell units, so neighbouring
 * hexes join by construction: there are no per-hex maps to stitch. The Reach is laid over it,
 * untouched, as the start patch, and a 6-cell band around it blends the Reach's edge into the
 * world's height, so there's no cliff where one ends and the other begins.
 *
 * Seeds: every stream here is `seedOf(\`${seed}|hexworld|${salt}\`)`. The Reach draws from
 * `|world|` streams, so these can't collide with them, and making the world never moves a draw of
 * the Reach's: its golden hashes stay where they are.
 *
 * Nothing calls this yet: it's new code behind no switch. Rivers outside the Reach come in #1897.
 */

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { generator, seedOf } from './rng';
import type { CellXY } from './coords';
import { generateReach, biomeOf, fbm, REACH_W, REACH_H, type Cell } from './reach';

/** Cells from the Reach's edge over which its height fades into the world's. */
export const PATCH_BLEND = 6;

// A local copy: reach.ts keeps its own clamp01 private, and that file is pinned unchanged.
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Small memos keyed by seed. Each holds the result of a pure function of the seed, so what a call
 * returns never depends on which seeds came before it: a memo only saves the work of making it
 * again. Two seeds, because a caller rarely has more than one world (and a test two) in hand.
 */
const MEMO_SEEDS = 2;
function remember<T>(memo: Map<number, T>, seed: number, make: () => T): T {
  let v = memo.get(seed);
  if (v === undefined) {
    v = make();
    // A Map keeps insertion order, so its first key is the oldest: drop that one.
    const oldest = memo.keys().next();
    if (memo.size >= MEMO_SEEDS && !oldest.done) memo.delete(oldest.value);
    memo.set(seed, v);
  }
  return v;
}

interface Fields {
  height: NoiseFunction2D;
  moist: NoiseFunction2D;
}
// Building a noise function shuffles a permutation table (a few hundred draws), so it's made once
// a seed rather than once a cell. The function itself only reads that table: it holds no state.
const fieldMemo = new Map<number, Fields>();
const fields = (seed: number): Fields =>
  remember(fieldMemo, seed, () => {
    const stream = (salt: string) => generator(seedOf(`${seed}|hexworld|${salt}`));
    return { height: createNoise2D(stream('height')), moist: createNoise2D(stream('moisture')) };
  });

// The Reach takes a few milliseconds to make, and every cell in or near it needs it.
const reachMemo = new Map<number, readonly Cell[]>();
const reachCells = (seed: number): readonly Cell[] =>
  remember(reachMemo, seed, () =>
    // Frozen, because the same Cell objects go out to every caller: one that changed a cell would
    // otherwise change what every later call returns. Freezing changes no value (it still
    // deep-equals the Reach); assigning to a frozen object throws in a module, which is strict.
    generateReach(seed).cells.map(c => Object.freeze(c)),
  );

/**
 * The world's height at a cell, 0 (lowest) to 1 (highest), before the Reach is laid over it.
 *
 * Gentle noise (landforms about two hexes across), plus a continental trend: higher to the north
 * (the fells beyond the pass), lower to the south (towards Mistheim's lowlands). The trend is zero
 * at the start hex's centre row (cy = 19.5).
 *
 * Tuned from the issue's starting point `0.55 * fbm(cx / 16) + 0.25 - 0.002 * (cy - 19.5)` (#1896),
 * which left no lakes around the start hex and a step past the band's limit on 3 of 20 seeds. The
 * Reach is high on its north edge and low on its south edge, and the band can only blend over 6
 * cells, so the world has to match both edges closely: a steeper trend does that, and lower, longer
 * noise keeps each step small. The price: on average the land reaches lake level two hexes south
 * of the start hex (cy ≈ 51), so the far south is open water; a later step that wants dry
 * lowlands there (Mistheim) has to revisit these numbers.
 */
export function worldHeight(seed: number, cx: number, cy: number): number {
  return clamp01(0.3 * fbm(fields(seed).height, cx / 32, cy / 32, 5) + 0.15 - 0.0045 * (cy - 19.5));
}

/** The world's moisture at a cell, 0 (dry) to 1 (wet): the Reach's moisture formula (4 octaves, offset +7, +3) in world cell units. */
export function worldMoist(seed: number, cx: number, cy: number): number {
  return fbm(fields(seed).moist, cx / 13 + 7, cy / 13 + 3, 4);
}

/**
 * Chebyshev distance from a cell to the Reach rectangle: 0 inside it, 1 on the ring of cells
 * just outside it (diagonal neighbours included), and so on outwards.
 */
function reachDistance(cx: number, cy: number): number {
  const dx = cx < 0 ? -cx : cx >= REACH_W ? cx - (REACH_W - 1) : 0;
  const dy = cy < 0 ? -cy : cy >= REACH_H ? cy - (REACH_H - 1) : 0;
  return Math.max(dx, dy);
}

/**
 * The world cell at `c`: its biome and height.
 *
 * - **Inside the Reach** (0 ≤ cx < 48, 0 ≤ cy < 32): the Reach's own cell, untouched, rivers and
 *   all. World cell (x, y) is Reach cell (x, y).
 * - **In the band** (1 to `PATCH_BLEND` cells out): the height runs from the nearest Reach edge
 *   cell's height (at distance 0) to the world's (at distance 6) in equal steps, so the Reach's
 *   edge eases into the world instead of ending in a cliff.
 * - **Beyond the band:** the world's height.
 *
 * Outside the Reach the biome comes from the Reach's own `biomeOf`, so both speak one biome list.
 * There are no rivers outside it yet (#1897). Only height blends: the Reach keeps no moisture.
 */
export function worldCell(seed: number, c: CellXY): Cell {
  const { cx, cy } = c;
  const d = reachDistance(cx, cy);
  if (d === 0) return reachCells(seed)[cy * REACH_W + cx];

  let height = worldHeight(seed, cx, cy);
  if (d <= PATCH_BLEND) {
    // The nearest Reach cell: the clamped coordinates, which is the corner cell off a corner.
    const ex = Math.min(Math.max(cx, 0), REACH_W - 1);
    const ey = Math.min(Math.max(cy, 0), REACH_H - 1);
    const edge = reachCells(seed)[ey * REACH_W + ex].height;
    height = edge + (height - edge) * d / PATCH_BLEND;
  }
  return { biome: biomeOf(height, worldMoist(seed, cx, cy)), height };
}
