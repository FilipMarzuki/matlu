/**
 * Shared test helpers. Not imported by game code.
 *
 * Since #1233/#1234 a Warden who does nothing dies of thirst within days, so
 * tests that fast-forward the calendar (to reach the snow, the thaw, …) keep
 * the stores topped up — they're testing the calendar, not survival.
 */

import { runDay, type QueueItem, type Region1State } from './region1';
import type { Calendar } from './winter';
import { FULL_WORLD, type WorldConfig } from './world';

/** At least `n` food and water in store. */
export const supplied = (s: Region1State, n = 2): Region1State =>
  ({ ...s, stores: { ...s.stores, rawFood: Math.max(s.stores.rawFood, n), water: Math.max(s.stores.water, n) } });

/**
 * Run whole days (fed and watered) until `day` is reached. Throws if the run
 * ends first, so a regression fails loudly instead of looping forever.
 */
export function fastForward(s: Region1State, day: number, queue: readonly QueueItem[] = ['rest']): Region1State {
  while (s.day < day) {
    if (s.outcome) throw new Error(`run ended (${s.outcome.kind}) on day ${s.day}, before reaching day ${day}`);
    s = runDay(supplied(s), queue).state;
  }
  return s;
}

/**
 * The old 13-day autumn (snow on day 13, the thaw 30 days later), for tests of the
 * short game written before the 60-day year (#1301). The season curves
 * compress to fit it, so day 10 is near freezing as it always was. The
 * balance tests move to the full year in #1306.
 */
export const SHORT_YEAR: Calendar = { winterDay: 13, thawDay: 43 };

/**
 * The full world — darkness, weather, the cold — with trip luck off (#1314),
 * for tests that compare exact hauls (a bonus of +1, a talent's extra food)
 * and would otherwise be measuring the luck of the hour.
 */
export const STEADY_WORLD: WorldConfig = { ...FULL_WORLD, luck: false };
