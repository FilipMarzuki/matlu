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
import { RANK_NAMES, type RankName } from '../rank-names';

export type { RankName };

/** A concept's full rank absent a per-concept override — matches `addInsight`'s default in crafting.ts. */
const FULL_RANK = 3;

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
function conceptsAtFullRank(s: Pick<Region1State, 'concepts'>): number {
  return Object.values(s.concepts).filter(c => c.rank >= FULL_RANK).length;
}

/** The rank the voice gives you: the highest whose thresholds your concept ranks meet. */
export function artificerRank(s: Pick<Region1State, 'concepts'>): RankName {
  const total = conceptRanks(s);
  const atFullRank = conceptsAtFullRank(s);
  return [...RANKS].reverse().find(r => total >= r.minTotal && atFullRank >= r.minAtFullRank)!.name;
}
