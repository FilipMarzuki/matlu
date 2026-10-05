/**
 * Acceptance tests for #1315 — winter on the land: snow cover that slows the
 * walk and the felling, ice fishing once the lake ice is thick, and blizzard
 * days that keep everyone in. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, queueHours, blockedReason, chooseSite, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { STEADY_WORLD } from './test-helpers';
import { nextSnowDepth, iceThick, isBlizzard, snowSlow } from './weather';
import type { WeatherId } from './world';

/** A scouted Warden in a walled cave on `day`, stocked for a few days (full world, luck off). */
function warden(day: number, weather: WeatherId, over: Partial<Region1State> = {}, flat = false): Region1State {
  const s = chooseSite(runAction(createRegion1({ world: flat ? FLAT_WORLD : STEADY_WORLD }), 'scout'), 'cave');
  return { ...s, day, hoursToday: 0, weatherToday: weather, tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' }, vitals: createVitals(), stores: { ...s.stores, rawFood: 9, water: 9, firewood: 30, materials: 10 }, ...over };
}
/** End the day, then force the next day's weather (the seeded roll is beside the point here). */
const nextDay = (s: Region1State, weather: WeatherId): Region1State => ({ ...runDay(s, []).state, weatherToday: weather });

describe('Winter on the land (#1315)', () => {
  // 1. Snow on days 31–33 deepens the cover each day, and wood cutting takes longer.
  it('builds snow cover that slows the walk and the felling', () => {
    let s = warden(31, 'snow');
    const depths: number[] = [];
    for (let d = 0; d < 3; d++) { s = nextDay(s, 'snow'); depths.push(s.snowDepth ?? 0); }
    expect(depths).toEqual([0.15, 0.3, 0.45]);
    expect(queueHours('wood', s)).toBeCloseTo(queueHours('wood', { ...s, snowDepth: 0 }) * snowSlow(0.45), 10);
    expect(queueHours('wood@2', s)).toBeGreaterThan(queueHours('wood@2', { ...s, snowDepth: 0 }));
    // In play, too: the felling takes longer.
    const felled = runAction(s, 'wood');
    expect(felled.hoursToday).toBeGreaterThan(runAction({ ...s, snowDepth: 0 }, 'wood').hoursToday);
    // It settles on clear frosty days, melts fast in a thaw, and a winter blizzard piles it on.
    expect(nextSnowDepth(0.5, 'clear', 40)).toBeCloseTo(0.47, 10);
    expect(nextSnowDepth(0.5, 'overcast', 5)).toBeCloseTo(0.4, 10);
    expect(nextSnowDepth(0.5, 'storm', 40)).toBeCloseTo(0.75, 10);
    expect(nextSnowDepth(0.95, 'snow', 40)).toBe(1);
  });

  // 2. Ice fishing: refused on day 34 (thin ice), open on day 36, and it brings in food.
  it('opens ice fishing once the lake ice is thick', () => {
    expect(iceThick(34)).toBe(false);
    expect(iceThick(36)).toBe(true);
    expect(blockedReason(warden(34, 'overcast'), 'fish', 1)).toBe('the ice is too thin');
    const day36 = warden(36, 'overcast');
    expect(blockedReason(day36, 'fish', 1)).toBeNull();
    const fished = runAction(day36, 'fish');
    expect(fished.stores.rawFood).toBeGreaterThan(day36.stores.rawFood);
    expect(fished.log.map(l => l.text).join('\n')).toMatch(/Fished through the ice/);
  });

  // 3. A blizzard refuses every ringed action; camp work goes on.
  it('keeps everyone in during a blizzard', () => {
    const s = warden(40, 'storm');
    expect(isBlizzard('storm', 40)).toBe(true);
    for (const id of ['gather', 'water', 'wood', 'fish', 'scout'] as const) expect(blockedReason(s, id, 1)).toMatch(/blizzard/);
    expect(runAction(s, 'gather').stores.rawFood).toBe(s.stores.rawFood);
    expect(blockedReason(s, 'coldGear', 1)).toBeNull();
    expect(blockedReason(s, 'study', 1, { concept: 'joinery' })).toBeNull();
    expect(blockedReason(s, 'rest', 1)).toBeNull();
    // An autumn storm still only bars the far rings (#1284).
    const autumn = warden(20, 'storm');
    expect(isBlizzard('storm', 20)).toBe(false);
    expect(blockedReason(autumn, 'gather', 1)).toBeNull();
    expect(blockedReason({ ...autumn, explore: { ...autumn.explore, known: { ...autumn.explore.known, 1: { ...autumn.explore.known[1], forage: 1, timber: 1, stone: 1, water: 1, game: 1 } } } }, 'gather', 2)).toMatch(/storm/);
  });

  // 4. The flat world: no snow cover, and fishing is open.
  it('keeps the flat world snow-free with the lake open', () => {
    const flat = warden(40, 'snow', {}, true);
    expect(runDay(flat, []).state.snowDepth ?? 0).toBe(0);
    const early = warden(5, 'clear', {}, true);
    expect(blockedReason(early, 'fish', 1)).toBeNull();
    expect(queueHours('wood', { ...early, snowDepth: 1 })).toBe(queueHours('wood', early));
  });
});
