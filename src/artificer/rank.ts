/**
 * Artificer rank (#1228, #1229, #1457): the class's standing, earned through
 * concept mastery. Concept ranks carry between runs, so rank climbs across
 * runs that keep what they learned. Shared by the arrival intro and the AI
 * progress report. Names are shared with the crafter's guild automation
 * level (`GUILD_RANKS`, `src/crafting/planner.ts`) via `rank-names.ts` so the
 * two ladders can't drift apart again — but the thresholds differ: this rank
 * rewards depth (concepts taken to their full rank) as well as volume.
 */

import type { Region1State } from './region1';
import type { ConceptDef } from './crafting';
import { RANK_NAMES, type RankName } from '../rank-names';

export type { RankName };

/**
 * A concept's full rank absent a definition — matches `addInsight`'s default in crafting.ts. With
 * the concept web loaded (#1459), each concept has its own (sealing and leverage stop at 2); callers
 * pass `CRAFT_WORLD.concepts` so those count as full (#1469). This module stays free of runtime sim
 * imports, so the crafter scene can share the rank names without pulling the sim in.
 */
const FULL_RANK = 3;
type Defs = Readonly<Record<string, ConceptDef>>;

/**
 * Artificer ranks: a total-ranks floor, and (for the top two rungs) a floor
 * on how many concepts have reached {@link FULL_RANK} — volume alone caps out
 * at Journeyman. Thresholds are a first guess (#1457); we're early, so
 * direction over precision.
 */
export const RANKS: readonly { name: RankName; minTotal: number; minAtFullRank: number }[] = [
  { name: RANK_NAMES[0], minTotal: 0, minAtFullRank: 0 },
  { name: RANK_NAMES[1], minTotal: 3, minAtFullRank: 0 },
  { name: RANK_NAMES[2], minTotal: 8, minAtFullRank: 1 },
  { name: RANK_NAMES[3], minTotal: 15, minAtFullRank: 2 },
];

/** Total concept ranks — the "volume" of what you understand. */
export function conceptRanks(s: Pick<Region1State, 'concepts'>): number {
  return Object.values(s.concepts).reduce((sum, c) => sum + c.rank, 0);
}

/** How many concepts have reached their full rank — the "depth" of what you understand. */
function conceptsAtFullRank(s: Pick<Region1State, 'concepts'>, defs: Defs): number {
  return Object.entries(s.concepts).filter(([id, c]) => c.rank > 0 && c.rank >= (defs[id]?.ranks ?? FULL_RANK)).length;
}

/** The rank the voice gives you: the highest whose thresholds your concept ranks meet. */
// `defs` is required (#1469): forgetting it would silently treat every concept as 3 ranks. Pass `{}` for that on purpose.
export function artificerRank(s: Pick<Region1State, 'concepts'>, defs: Defs): RankName {
  const total = conceptRanks(s);
  const atFullRank = conceptsAtFullRank(s, defs);
  return [...RANKS].reverse().find(r => total >= r.minTotal && atFullRank >= r.minAtFullRank)!.name;
}
