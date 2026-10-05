/**
 * Artificer rank (#1228, #1229): the class's standing, earned through concept
 * mastery. Concept ranks carry between runs, so rank climbs across runs that
 * keep what they learned. Shared by the arrival intro and the AI progress report.
 */

import type { Region1State } from './region1';

/** Artificer ranks, earned through concept mastery that carries between runs. */
export const RANKS = [
  { name: 'Apprentice', minRanks: 0 },
  { name: 'Journeyman', minRanks: 3 },
  { name: 'Adept', minRanks: 6 },
  { name: 'Master', minRanks: 10 },
] as const;
export type RankName = (typeof RANKS)[number]['name'];

/** Total concept ranks — the "depth" of what you understand. */
export function conceptRanks(s: Pick<Region1State, 'concepts'>): number {
  return Object.values(s.concepts).reduce((sum, c) => sum + c.rank, 0);
}

/** The rank the voice gives you: the highest whose threshold your concept ranks meet. */
export function artificerRank(s: Pick<Region1State, 'concepts'>): RankName {
  const n = conceptRanks(s);
  return [...RANKS].reverse().find(r => n >= r.minRanks)!.name;
}
