/**
 * Acceptance tests for #1301 — the 60-day year: 30 days of autumn, 30 of
 * winter, the thaw on day 61; daylight, temperature and weather odds follow
 * it. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CALENDAR, seasonOf } from './winter';
import { daylightHours, sunrise, sunset } from './clock';
import { dayMean, weatherFor, weatherName } from './weather';
import { createRegion1, runDay } from './region1';
import { FULL_WORLD } from './world';
import { seedOf } from './rng';
import { supplied } from './test-helpers';

const days = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('The 60-day year (#1301)', () => {
  // 1. Autumn, winter, thaw.
  it('runs autumn on days 1–30, winter on 31–60, the thaw from 61', () => {
    expect(DEFAULT_CALENDAR).toMatchObject({ winterDay: 31, thawDay: 61 });
    expect(seasonOf(1)).toBe('autumn');
    expect(seasonOf(30)).toBe('autumn');
    expect(seasonOf(31)).toBe('winter');
    expect(seasonOf(60)).toBe('winter');
    expect(seasonOf(61)).toBe('thaw');
  });

  // 2. Daylight: about 11.5, 8, 6 and 7.5 hours; midwinter is the shortest day.
  it('shortens the days to a midwinter low and lengthens them again', () => {
    expect(daylightHours(1)).toBeCloseTo(11.5, 10);
    expect(Math.abs(daylightHours(30) - 8)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(daylightHours(45) - 6)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(daylightHours(60) - 7.5)).toBeLessThanOrEqual(0.25);
    const shortest = Math.min(...days(1, 60).map(d => daylightHours(d)));
    expect(daylightHours(45)).toBe(shortest);
    // Sunrise and sunset agree with the daylight.
    for (const d of [1, 30, 45, 60]) expect(sunset(d) - sunrise(d)).toBeCloseTo(daylightHours(d), 10);
  });

  // 3. Temperature: about 10, −2, −12 and −4 °C; the coldest day falls between 40 and 50.
  it('cools to a midwinter low around −12 °C', () => {
    expect(Math.abs(dayMean(1) - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(dayMean(30) + 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(dayMean(45) + 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(dayMean(60) + 4)).toBeLessThanOrEqual(1);
    const means = days(1, 60).map(d => dayMean(d));
    const coldest = means.indexOf(Math.min(...means)) + 1;
    expect(coldest).toBeGreaterThanOrEqual(40);
    expect(coldest).toBeLessThanOrEqual(50);
  });

  // 4. No snow in early autumn; early snow in late autumn; snow commonest in winter.
  it('brings snow late in autumn and makes it the commonest winter weather', () => {
    const tally = (dayList: number[]) => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 5000; i++) {
        const seed = seedOf(`w-${i}`);
        for (const d of dayList) { const w = weatherFor(seed, d, FULL_WORLD); counts[w] = (counts[w] ?? 0) + 1; }
      }
      return counts;
    };
    expect(tally(days(1, 15)).snow).toBeUndefined();
    expect(tally(days(20, 30)).snow).toBeGreaterThan(0);
    const winter = tally(days(31, 60));
    const commonest = Object.entries(winter).sort((a, b) => b[1] - a[1])[0][0];
    expect(commonest).toBe('snow');
    expect(winter.rain).toBeUndefined();
  });

  // 5. A winter storm is a blizzard.
  it('calls a winter storm a blizzard', () => {
    expect(weatherName('storm', 30)).toBe('Storm');
    expect(weatherName('storm', 31)).toBe('Blizzard');
    expect(weatherName('snow', 25)).toBe('Early snow');
    expect(weatherName('snow', 40)).toBe('Snow');
    // In play: a Warden whose day 31 is stormy wakes to a blizzard.
    let i = 0;
    while (weatherFor(seedOf(`w-${i}`), DEFAULT_CALENDAR.winterDay, FULL_WORLD) !== 'storm') i++;
    const s = { ...createRegion1({}, undefined, { id: `w-${i}` }), day: DEFAULT_CALENDAR.winterDay - 1 };
    const next = runDay(supplied(s), ['rest']).state;
    expect(next.day).toBe(DEFAULT_CALENDAR.winterDay);
    expect(next.log.at(-1)?.text).toBe('Morning: blizzard.');
  });

  // 6. Still seeded by character and day.
  it('rolls the same weather for the same Warden and day', () => {
    const seed = seedOf('w-vega');
    for (const d of [1, 20, 31, 45, 60]) expect(weatherFor(seed, d, FULL_WORLD)).toBe(weatherFor(seed, d, FULL_WORLD));
  });
});
