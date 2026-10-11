/**
 * Growing up (#1399, epic #1397): the Warden starts as a child of 11–14 and grows into an adult
 * over the runs, a year a run. The point-buy at creation sets the *adult* stats — who this child
 * will become — and while young each stat is lower by a growth gap that closes year by year and
 * is gone at 18. The body lags most; a young mind learns fast.
 *
 * Pure: createRegion1 works out the current stats from the adult ones and the age, and every
 * effect reads the current ones.
 */

import { STAT_IDS, type StatId, type Stats } from './stats';

/** Grown up: no gap left, and no young mind's head start. */
export const ADULT_AGE = 18;
/** The ages a new Warden can start at, and the one picked if you don't choose. */
export const START_AGES: readonly number[] = [11, 12, 13, 14];
export const DEFAULT_AGE = 12;
/** How far below the adult stat each one sits at 11: the body (STR, CON) lags most; kids are quick and likeable already. */
export const GAP_AT_11: Readonly<Record<StatId, number>> = { str: 4, con: 3, int: 2, wil: 2, agi: 1, cha: 1 };
/** No stat falls below this, however young. */
export const STAT_FLOOR = 3;
/** While young, every skill's practice counts this much more. */
export const YOUNG_PRACTICE = 1.2;

/** The growth gap of a stat at an age: the gap at 11, closing in even steps to 0 at 18 (rounded up — you're not grown till you're grown). */
export function gapAt(id: StatId, age: number): number {
  if (age >= ADULT_AGE) return 0;
  const years = ADULT_AGE - Math.max(11, age);
  return Math.ceil(GAP_AT_11[id] * years / (ADULT_AGE - 11));
}

/** The stats a Warden of this age has now, growing towards the adult ones. No age: an adult (old saves, tests). */
export function grownStats(adult: Readonly<Stats>, age: number | undefined): Stats {
  const out = { ...adult };
  if (age === undefined) return out;
  for (const id of STAT_IDS) out[id] = Math.max(STAT_FLOOR, adult[id] - gapAt(id, age));
  return out;
}

export const isYoung = (age: number | undefined): boolean => age !== undefined && age < ADULT_AGE;

const GREW: Readonly<Record<StatId, string>> = { str: 'and stronger', con: 'and tougher', agi: 'and quicker on your feet', int: 'and sharper', wil: 'and steadier', cha: 'and surer of yourself' };

/**
 * The journal line a new run opens with, a year on: what grew most this year (the stat furthest
 * up since last year; ties go to the first). At 18, grown; after that, nothing to say.
 */
export function birthdayLine(adult: Readonly<Stats>, age: number): string | null {
  if (age > ADULT_AGE) return null;
  if (age === ADULT_AGE) return `You're ${age} now — grown, and as strong as you'll be.`;
  const was = grownStats(adult, age - 1), now = grownStats(adult, age);
  const best = STAT_IDS.reduce<StatId | null>((b, id) => (now[id] - was[id] > (b ? now[b] - was[b] : 0) ? id : b), null);
  return `You're ${age} now — taller than last winter${best ? `, ${GREW[best]}` : ''}.`;
}
