/**
 * The Reach as a generated map (#1539, plan: docs/spikes/artificer-generated-world.md).
 *
 * A top-down grid of cells, one cell about half an hour's walk on open ground, made fresh each run from the run's seed
 * (`seedOf(character.id)`, the same seed everything else in the run uses). No graphics: the map is
 * drawn as text, one character per cell. Pure and deterministic, so the same seed always makes the
 * same land, AI playtests replay, and tests can pin it.
 *
 * The land itself (its shape, rivers, camp and walking hours) is made by the world generator, in
 * `worldmap/reach.ts` (#1895), so the wider world can lay the Reach into itself (#1896). This file
 * re-exports it, so every Artificer import of `./world/reach` stays as it was, and keeps what
 * needs the Artificer: the glyphs and names, what each biome yields, and the rings and sight
 * (`../exploration`). worldmap/ can't import from src/, so those stay here.
 *
 * Phase 1 shows the map; play still uses the three rings (exploration.ts). `ringOfHours` maps each
 * cell onto those rings by its walking time from camp, so the map can show what you've scouted.
 */

import { domainsOf, level, type Exploration, type Ring } from '../exploration';
// `export { … } from` passes names through without making them usable in this file, so the two
// types this file's own code needs are imported as well. `import type` is erased from the build.
import type { Biome, Reach } from '../../../worldmap/reach';

// The moved part, re-exported under the same names. It's the same module, not a copy: one
// generateReach, and one walkFrom cache shared by everything that walks the Reach.
export { REACH_W, REACH_H, COST, generateReach, walkFrom, walkingHours, type Biome, type Cell, type Reach } from '../../../worldmap/reach';

/** One character per biome, plus camp and the unknown. */
export const GLYPH: Readonly<Record<Biome | 'camp' | 'unknown', string>> = {
  lake: '~', river: '≈', marsh: '"', meadow: '.', heath: ',', birch: 't', pine: 'T', scree: 'n', fell: '^', snow: '*', camp: '@', unknown: '·',
};

export const BIOME_NAME: Readonly<Record<Biome, string>> = {
  lake: 'Lake', river: 'River', marsh: 'Marsh', meadow: 'Meadow', heath: 'Heath', birch: 'Birch wood', pine: 'Pine forest', scree: 'Scree', fell: 'Fell', snow: 'Snowfield',
};

/** What a cell can give, in the rings' own terms (exploration.ts domains, minus routes). */
export type Yield = 'forage' | 'timber' | 'stone' | 'water' | 'game';
export const YIELDS: Readonly<Record<Biome, readonly Yield[]>> = {
  lake: ['water', 'game'], river: ['water', 'game'], marsh: ['forage', 'water', 'game'], meadow: ['forage', 'game'],
  heath: ['forage'], birch: ['timber', 'forage', 'game'], pine: ['timber', 'game'], scree: ['stone'], fell: ['stone', 'game'], snow: [],
};

/**
 * Which ring a walk of this many hours falls in. The near ring is home ground (up to 3 hours
 * out), and the far and distant rings sit at the +3h and +6h of travel (exploration.ts). Beyond
 * nine hours is outside what a day's work from camp can reach: the rest of the Reach, for the
 * road and later phases.
 */
export function ringOfHours(hours: number): Ring | null {
  if (hours <= 3) return 1;
  if (hours <= 6) return 2;
  if (hours <= 9) return 3;
  return null;
}

/** How much the Warden can see of a cell: 0 unknown, 1 glimpsed, 2+ known (the ring's best level). */
export type Sight = (x: number, y: number) => number;

/** Up to this many hours out, the land is in plain view from camp, scouted or not. */
export const IN_VIEW_HOURS = 2;

/**
 * What the Warden knows of each cell, from the rings' knowledge (exploration.ts): the land within
 * two hours of camp is in view (you look around when you arrive), and beyond that a cell shows as
 * much as you know of its ring (its best domain level). Cells past the distant ring stay unknown in
 * phase 1.
 */
export function sightFor(reach: Reach, e: Exploration): Sight {
  const best = (r: Ring) => Math.max(...domainsOf(r).map(d => level(e, r, d)));
  const ringSight: Record<Ring, number> = { 1: best(1), 2: best(2), 3: best(3) };
  return (x, y) => {
    const hrs = reach.hours[y * reach.w + x];
    if (hrs <= IN_VIEW_HOURS) return Math.max(1, ringSight[1]);
    const ring = ringOfHours(hrs);
    return ring ? ringSight[ring] : 0;
  };
}

/** The map as text rows, one character per cell, with camp as @ and unseen cells as ·. */
export function mapRows(reach: Reach, sight: Sight = () => 3): string[] {
  const rows: string[] = [];
  for (let y = 0; y < reach.h; y++) {
    let row = '';
    for (let x = 0; x < reach.w; x++) {
      if (x === reach.camp.x && y === reach.camp.y) row += GLYPH.camp;
      else row += sight(x, y) > 0 ? GLYPH[reach.cells[y * reach.w + x].biome] : GLYPH.unknown;
    }
    rows.push(row);
  }
  return rows;
}

/** A one-line description of a cell: what it is, what it gives and how far it is from camp. */
export function describeCell(reach: Reach, x: number, y: number): string {
  const i = y * reach.w + x;
  const c = reach.cells[i];
  const hrs = reach.hours[i];
  const where = x === reach.camp.x && y === reach.camp.y ? 'your camp' : Number.isFinite(hrs) ? `${Math.round(hrs * 2) / 2}h from camp` : 'across open water';
  const ring = ringOfHours(hrs);
  const band = ring === 1 ? 'home ground' : ring === 2 ? 'the far ring' : ring === 3 ? 'the distant ring' : 'beyond a day out';
  const yields = YIELDS[c.biome].length ? YIELDS[c.biome].join(', ') : 'nothing';
  return `${BIOME_NAME[c.biome]} — ${where}, ${band}. Gives: ${yields}.`;
}
