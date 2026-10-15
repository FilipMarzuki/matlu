/**
 * Difficulty (#1728): what a Warden left unspent at creation, as a multiplier for a future high
 * score. Points left over in the point-buy (stats.ts) and talent picks left unchosen (talents.ts)
 * each make the Warden weaker, and the multiplier records how much weaker they chose to be.
 *
 * It changes nothing in play — fewer points and fewer talents already make the run harder — so it
 * draws nothing and no rule reads it. It is worked out once, when the Warden is made (BEGIN),
 * kept on the character (`Character.difficulty`), and written into the run record.
 *
 * The curve, pinned by difficulty.test.ts:
 *   ×(1 + 0.10 per unspent stat point + 0.25 per unchosen talent pick), to two decimals.
 * Linear, so every point counts the same and a player can work it out in their head. A talent pick
 * is worth 2.5 stat points: a stat point is about 3% on one kind of work, a talent starts at about
 * 4% (Hardy, Sharp-minded) or a whole new knack (Keen Eye, Cold-blooded), and grows with use to four
 * times that, which a stat point never does. All spent: ×1.00. Nothing spent and no talents: ×2.10
 * (and points bought by lowering a stat, then left unspent, count too — at most ×3.90).
 *
 * Pure.
 */

import { pointsLeft, type Stats } from './stats';
import { TALENT_PICKS } from './talents';

/** What one unspent stat point adds. */
export const PER_POINT = 0.1;
/** What one unchosen talent pick adds: 2.5 stat points' worth. */
export const PER_TALENT = 0.25;

/** Two decimals, so a multiplier reads and compares the same everywhere (0.1 × 3 is 0.30000000000000004). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Stat points left unspent (never below 0: an overspent spread isn't a legal one, and isn't easier for it). */
export const unspentPoints = (stats: Stats): number => Math.max(0, pointsLeft(stats));
/** Talent picks left unchosen, from the picks made (a count or the ids). */
export const unchosenPicks = (chosen: number | readonly unknown[]): number =>
  Math.max(0, TALENT_PICKS - (typeof chosen === 'number' ? chosen : chosen.length));

/**
 * The multiplier for a creation: ×1.00 with every point spent and every talent chosen, rising
 * linearly with each one left (see the curve above). `chosen` is the talent picks made.
 */
export function difficultyOf(stats: Stats, chosen: number | readonly unknown[] = TALENT_PICKS): number {
  return round2(1 + PER_POINT * unspentPoints(stats) + PER_TALENT * unchosenPicks(chosen));
}

/** A kept multiplier, as saves and records hold it: absent (old saves, quick starts) or anything not a number ≥ 1 reads as ×1.00. */
export const difficultyRead = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 1 ? round2(x) : 1);

/** The character's multiplier: fixed at creation, ×1.00 if it has none. */
export const difficultyOfCharacter = (c: { difficulty?: number }): number => difficultyRead(c.difficulty);

/** "×1.30": the multiplier as the game shows it, always with two decimals. */
export const difficultyLabel = (m: number): string => `×${m.toFixed(2)}`;
