/**
 * Acceptance tests for #1280 — the clock and daylight model. The day runs
 * from 06:00; daylight shrinks through autumn. One test per scenario.
 */

import { describe, it, expect } from 'vitest';
import { clockHour, sunrise, sunset, lightAt, lightOver, DAY_START } from './clock';
import { createRegion1, runAction, chooseSite, type Region1State } from './region1';
import { createVitals } from './vitality';

const scouted = (over: Partial<Region1State> = {}): Region1State => ({ ...runAction(createRegion1(), 'scout'), hoursToday: 0, vitals: createVitals(), ...over });
const lastAction = (s: Region1State) => [...s.log].reverse().find(l => l.kind === 'action');

describe('Clock and daylight (#1280)', () => {
  // 1. Day 1: sunrise 7:00, sunset 18:30; twilight an hour either side.
  it('lights day 1 from 7:00 to 18:30, with an hour of twilight either side', () => {
    expect(sunrise(1)).toBe(7);
    expect(sunset(1)).toBe(18.5);
    expect(lightAt(1, 12)).toBe(1);
    expect(lightAt(1, 19)).toBe(0.5);
    expect(lightAt(1, 20)).toBe(0);
    expect(lightAt(1, 6.5)).toBe(0.5);
    expect(lightAt(1, 5)).toBe(0);
  });

  // 2. Daylight follows the year (#1301): about 8 hours as autumn ends, 6 at midwinter.
  it('shrinks daylight to about eight hours by the end of autumn', () => {
    expect(sunset(30) - sunrise(30)).toBeCloseTo(8, 10);
    // A third of the light lost comes off the morning, two thirds off the evening.
    expect(sunrise(30)).toBeCloseTo(7 + 3.5 / 3, 10);
    expect(sunset(30)).toBeCloseTo(18.5 - 7 / 3, 10);
  });

  // 3. A span's light is its average. 06:00–10:00 on day 1: an hour of dawn twilight (06–07), then three of day.
  // (The issue text said "half an hour"; with sunrise at 7:00 the twilight hour is 06:00–07:00.)
  it('averages the light over a span', () => {
    expect(lightOver(1, 6, 4)).toBeCloseTo((0.5 * 1 + 1 * 3) / 4, 10);
    expect(lightOver(1, 12, 3)).toBe(1);
    expect(lightOver(1, 18, 2)).toBeCloseTo((1 * 0.5 + 0.5 * 1 + 0 * 0.5) / 2, 10);
    expect(lightOver(1, 21, 2)).toBe(0);
    expect(lightOver(1, 19, 0)).toBe(lightAt(1, 19));
  });

  // 4. The clock follows hours spent; actions record when they happened and in what light.
  it('stamps each action with its clock time and light', () => {
    expect(DAY_START).toBe(6);
    expect(clockHour(0)).toBe(6);
    expect(clockHour(13)).toBe(19);
    const late = runAction(scouted({ hoursToday: 13 }), 'gather');
    expect(lastAction(late)?.at).toMatchObject({ hour: 19 });
    expect(lastAction(late)!.at!.light).toBeLessThan(1);
    const noon = runAction(scouted({ hoursToday: 6 }), 'gather');
    expect(lastAction(noon)?.at).toEqual({ hour: 12, light: 1 });
    // A walk out to ring 2 counts in the span: 3h there and back plus the work.
    const far = runAction(scouted({ hoursToday: 9 }), 'gather@2');
    expect(lastAction(far)?.at?.light).toBeCloseTo(lightOver(1, 15, 3 + 5), 10);
    // Crafts are stamped too.
    const base = chooseSite(scouted({ hoursToday: 14 }), 'cave');
    const crafted = runAction({ ...base, hoursToday: 2, stores: { ...base.stores, materials: 20 } }, 'coldGear');
    expect(lastAction(crafted)?.at?.hour).toBe(8);
  });
});
