/**
 * Acceptance tests for #1303 — winter nights: a fire against the deep cold,
 * and melting snow for water once the streams freeze hard. One test per
 * Given/When/Then scenario.
 */

import { STEADY_WORLD } from './test-helpers';
import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, queueHours, warmth, winterOutlook, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { DEFAULT_CALENDAR } from './winter';
import { nightTemp, dayMean, fireNeed, freezeLoss, meltsSnow, type WeatherId } from './weather';

/**
 * A fed, watered Warden on `day` in `weather` (the seeded world, unless flat).
 * `camp` gives them a walled cave (90% warm); otherwise they sleep in the open.
 */
function warden(day: number, weather: WeatherId, over: Partial<Region1State> = {}, opts: { camp?: boolean; flat?: boolean } = {}): Region1State {
  // Luck off (#1314): these tests weigh firewood and water, not the luck of the hour.
  let s = runAction(createRegion1({ world: opts.flat ? FLAT_WORLD : STEADY_WORLD }), 'scout');
  if (opts.camp) s = { ...chooseSite(s, 'cave'), tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' } };
  return { ...s, day, hoursToday: 0, weatherToday: weather, vitals: createVitals(), stores: { ...s.stores, rawFood: 9, water: 9, firewood: 10 }, ...over };
}
const lines = (s: Region1State) => s.log.map(l => l.text).join('\n');
const night = (s: Region1State) => runDay(s, []).state;

describe('Winter nights (#1303)', () => {
  // 1. A −12 °C night burns 1 + 2 firewood in the open; a 90%-warm camp burns 2.
  it('burns firewood with the cold, less in a warm shelter', () => {
    expect(fireNeed(-12, 0)).toBe(3);
    expect(fireNeed(-12, 0.9)).toBe(2);
    expect(fireNeed(-4, 0)).toBe(1);
    expect(fireNeed(2, 0)).toBe(0);
    // In play: day 42 under cloud is a −12 °C night.
    expect(nightTemp(42, 'overcast')).toBeCloseTo(-12, 10);
    const open = warden(42, 'overcast');
    expect(warmth(open)).toBe(0);
    expect(night(open).stores.firewood).toBe(10 - 3);
    const camped = warden(42, 'overcast', {}, { camp: true });
    expect(warmth(camped)).toBeCloseTo(0.9, 10);
    expect(night(camped).stores.firewood).toBe(10 - 2);
    expect(lines(night(camped))).toMatch(/Kept the fire in through a -12 °C night — 2 firewood/);
    // The outlook counts the same burn.
    expect(winterOutlook(camped).fuelToThaw).toBeGreaterThan(0);
  });

  // 2. A −15 °C night with no firewood costs about 20 Condition, less with cold gear and shelter.
  it('costs Condition on a fireless freezing night', () => {
    expect(freezeLoss(-15, 0, false, 1)).toBeCloseTo(20, 10);
    expect(freezeLoss(-5, 0, false, 1)).toBeCloseTo(8, 10);
    expect(freezeLoss(-15, 0, true, 1)).toBeLessThan(20);
    expect(freezeLoss(-15, 0.9, false, 1)).toBeLessThan(20);
    expect(freezeLoss(-15, 0, false, 0.5)).toBeCloseTo(10, 10);
    expect(freezeLoss(3, 0, false, 1)).toBe(0);
    // In play: about −16 °C on day 45 in the wind, no firewood, sleeping in the open.
    const t = nightTemp(45, 'wind');
    const cold = warden(45, 'wind', { stores: { ...warden(1, 'clear').stores, rawFood: 9, water: 9, firewood: 0 } });
    const after = night(cold);
    // The freeze, plus the 4 of an ordinary cold night.
    expect(100 - after.vitals.condition).toBeCloseTo(freezeLoss(t, 0, false, 1) + 4, 5);
    expect(lines(after)).toMatch(/No firewood — a fireless night/);
    // Sound cold gear softens it.
    const geared = night({ ...cold, coldGear: true });
    expect(geared.vitals.condition).toBeGreaterThan(after.vitals.condition);
  });

  // 3. Three fireless deep-cold nights at Condition 50 kill.
  it('kills a Warden left without a fire in the deep cold', () => {
    let s = warden(45, 'wind', { stores: { ...warden(1, 'clear').stores, rawFood: 9, water: 9, firewood: 0 }, vitals: createVitals({ condition: 50 }) });
    for (let n = 0; n < 3 && !s.outcome; n++) s = runDay(s, []).state;
    expect(s.outcome).toMatchObject({ kind: 'died' });
    expect(lines(s)).toMatch(/Dead of the cold/);
  });

  // 4. In the deep cold, water is melted snow: 1 more firewood and 1 more hour than in autumn.
  it('melts snow for water once the streams freeze hard', () => {
    expect(dayMean(39)).toBeCloseTo(-8, 10);
    expect(meltsSnow(39)).toBe(true);
    expect(meltsSnow(30)).toBe(false);
    const deep = warden(39, 'overcast');
    const autumn = warden(5, 'overcast');
    expect(queueHours('water', deep)).toBe(queueHours('water', autumn) + 1);
    const fetched = runAction(deep, 'water');
    expect(fetched.stores.firewood).toBe(deep.stores.firewood - 1);
    expect(fetched.stores.water).toBeGreaterThan(deep.stores.water);
    expect(lines(fetched)).toMatch(/Melted \d+ water from snow/);
    expect(runAction(autumn, 'water').stores.firewood).toBe(autumn.stores.firewood);
    // No firewood, no melting.
    const dry = runAction({ ...deep, stores: { ...deep.stores, firewood: 0 } }, 'water');
    expect(dry.stores.water).toBe(deep.stores.water);
    expect(lines(dry)).toMatch(/no firewood to melt snow/);
  });

  // 5. None of it in the flat world.
  it('keeps the flat world fire-free', () => {
    const flat = warden(45, 'clear', { stores: { ...warden(1, 'clear').stores, rawFood: 9, water: 9, firewood: 0 } }, { flat: true });
    const after = night(flat);
    expect(after.stores.firewood).toBe(0);
    expect(lines(after)).not.toMatch(/firewood|fire/);
    const fetched = runAction({ ...flat, stores: { ...flat.stores, firewood: 3 } }, 'water');
    expect(fetched.stores.firewood).toBe(3);
    expect(winterOutlook(flat).fuelToThaw).toBe(0);
    expect(DEFAULT_CALENDAR.thawDay).toBe(61);
  });
});
