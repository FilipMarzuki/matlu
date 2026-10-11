/**
 * Acceptance tests for #1283 — the temperature curve, cold work, icy streams
 * and freezing nights. Day 1 averages 10 °C, falling to −2 °C by the end of
 * autumn (the 60-day year, #1301).
 */

import { describe, it, expect } from 'vitest';
import { dayMean, tempAt, nightTemp, isColdNight, iceOn, ICE_EXTRA_HOURS } from './weather';
import { createRegion1, runAction, queueHours, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { DEFAULT_CALENDAR } from './winter';

// Day 27 is the latest day before the "winter is close" survival lock (which lightens work too).
const calendar = DEFAULT_CALENDAR;
const warden = (day: number, hoursSpent: number, over: Partial<Region1State> = {}, flat = false): Region1State => {
  const s = runAction(createRegion1(flat ? { world: FLAT_WORLD, calendar } : { calendar }), 'scout');
  return { ...s, day, hoursToday: hoursSpent, weatherToday: 'overcast', vitals: createVitals(), ...over };
};
const vigorUsed = (s: Region1State, q: Parameters<typeof runAction>[1]) => s.vitals.vigor.current - runAction(s, q).vitals.vigor.current;

describe('Temperature (#1283)', () => {
  it('cools through autumn, colder at dawn and milder at midday, shifted by the weather', () => {
    expect(dayMean(1)).toBe(10);
    expect(dayMean(30)).toBeCloseTo(-2, 10);
    // Overcast days: no shift by day; dawn −4, midday +3.
    expect(tempAt(1, 6, 'overcast')).toBe(6);
    expect(tempAt(1, 13, 'overcast')).toBe(13);
    // Clear nights are colder, overcast nights milder, snow colder all day.
    expect(nightTemp(5, 'clear')).toBeCloseTo(dayMean(5) - 4 - 3, 10);
    expect(nightTemp(5, 'overcast')).toBeCloseTo(dayMean(5) - 4 + 2, 10);
    expect(tempAt(10, 13, 'snow')).toBeCloseTo(dayMean(10) + 3 - 5, 10);
  });

  // 5. Late autumn is below freezing on average: streams ice over, and cold work is heavier.
  it('ices the streams and makes freezing work heavier', () => {
    expect(iceOn(25)).toBe(false);
    expect(iceOn(26)).toBe(true);
    const day27 = warden(27, 1);
    expect(queueHours('water', day27)).toBe(queueHours('water', warden(5, 1)) + ICE_EXTRA_HOURS);
    expect(runAction(day27, 'water').hoursToday - day27.hoursToday).toBe(2 + ICE_EXTRA_HOURS);
    // 10:00 on day 27 is fully lit but below freezing (about −0.8 °C); 10:00 on day 1 is a mild 10 °C.
    expect(tempAt(27, 10, 'overcast')).toBeLessThan(0);
    expect(vigorUsed(warden(27, 4), 'wood')).toBeCloseTo(vigorUsed(warden(1, 4), 'wood') * 1.1, 5);
  });

  // 6. A freezing night needs a warmer shelter.
  it('counts a night as cold by warmth against the frost', () => {
    expect(isColdNight(0.45, -6)).toBe(true);
    expect(isColdNight(0.6, -6)).toBe(false);
    expect(isColdNight(0.35, 5)).toBe(false);
    expect(isColdNight(0.25, 5)).toBe(true);
  });

  it('turns all of it off in the flat world', () => {
    const flat = warden(27, 1, {}, true);
    expect(queueHours('water', flat)).toBe(queueHours('water', warden(5, 1, {}, true)));
    expect(vigorUsed(warden(27, 4, {}, true), 'wood')).toBeCloseTo(vigorUsed(warden(1, 4, {}, true), 'wood'), 5);
  });
});
