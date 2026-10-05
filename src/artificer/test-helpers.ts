/**
 * Shared test helpers. Not imported by game code.
 *
 * Since #1233/#1234 a Warden who does nothing dies of thirst within days, so
 * tests that fast-forward the calendar (to reach the caravan, winter, …) keep
 * the stores topped up — they're testing the calendar, not survival.
 */

import { runDay, type QueueItem, type Region1State } from './region1';

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
