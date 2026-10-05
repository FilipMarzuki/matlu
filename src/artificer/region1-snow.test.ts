/**
 * Acceptance tests for #1315 — winter on the land: snow cover that slows the
 * walk and the felling, ice fishing once the lake ice is thick, and blizzard
 * days you can go out in, at your peril. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, queueHours, blockedReason, chooseSite, dangerOf, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { STEADY_WORLD } from './test-helpers';
import { nextSnowDepth, iceThick, isBlizzard, snowSlow, exposureFor, type Exposure } from './weather';
import { streamFor, seedOf } from './rng';
import { DEFAULT_STATS } from './stats';
import { previewQueue } from '../artificer-app/controller';
import { observe } from '../artificer-ai/observe';
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

  // 3. A blizzard refuses nothing — but going out is slow, poor and dangerous; a sharp mind is warned.
  it('lets you go out into a blizzard, at your peril', () => {
    const s = warden(40, 'storm');
    expect(isBlizzard('storm', 40)).toBe(true);
    for (const id of ['gather', 'water', 'wood', 'fish', 'scout'] as const) expect(blockedReason(s, id, 1)).toBeNull();
    // Everything out there takes half again as long.
    expect(queueHours('gather', s)).toBeCloseTo(queueHours('gather', { ...s, weatherToday: 'overcast' }) * 1.5, 10);
    // Exposure at even odds: 5% killed, 20% lost, 35% frostbitten, 40% rough.
    const share = (steps: number) => {
      const n: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) { const e = exposureFor((i + 0.5) / 1000, steps); n[e] = (n[e] ?? 0) + 1; }
      return n;
    };
    expect(share(0)).toEqual({ killed: 50, lost: 200, frostbitten: 350, rough: 400 });
    expect(share(1).killed ?? 0).toBe(0); // sound cold gear: a step safer
    expect(share(-2).killed).toBe(250); // the distant ring: two steps worse
    // In play, by the hour's fortune: rough, frostbitten, lost (haul and all), or dead.
    const out = (e: Exposure) => {
      let i = 0;
      while (exposureFor(streamFor(seedOf(`w-${i}`), 40, 'blizzard@12')(), 0) !== e) i++;
      const w = { ...warden(40, 'storm'), hoursToday: 6, character: { ...warden(40, 'storm').character, id: `w-${i}` } };
      return { before: w, after: runAction(w, 'gather') };
    };
    const rough = out('rough');
    expect(rough.after.vitals.condition).toBe(100 - 5);
    expect(rough.after.stores.rawFood).toBeGreaterThan(rough.before.stores.rawFood);
    const bitten = out('frostbitten');
    expect(bitten.after.vitals.condition).toBe(100 - 15);
    const lost = out('lost');
    expect(lost.after.vitals.condition).toBe(100 - 30);
    expect(lost.after.stores.rawFood).toBe(lost.before.stores.rawFood);
    expect(lost.after.log.map(l => l.text).join('\n')).toMatch(/Lost in the white/);
    const killed = out('killed');
    expect(killed.after.outcome).toMatchObject({ kind: 'died' });
    expect(killed.after.log.at(-1)?.text).toMatch(/lost the way back/);
    // Camp work is safe.
    expect(runAction(s, 'rest').vitals.condition).toBe(100);
    // An autumn storm still bars the far rings (#1284).
    const autumn = warden(20, 'storm');
    expect(isBlizzard('storm', 20)).toBe(false);
    expect(blockedReason(autumn, 'gather', 1)).toBeNull();
    expect(blockedReason({ ...autumn, explore: { ...autumn.explore, known: { ...autumn.explore.known, 1: { ...autumn.explore.known[1], forage: 1, timber: 1, stone: 1, water: 1, game: 1 } } } }, 'gather', 2)).toMatch(/storm/);
  });

  // 3b. Only a sharp mind (Intelligence 12+) is warned of the danger — person or AI alike.
  it('warns a Warden with Intelligence 12+ of the blizzard', () => {
    const sharp = { ...warden(40, 'storm'), character: { ...warden(40, 'storm').character, stats: { ...DEFAULT_STATS, int: 12 } } };
    const plain = warden(40, 'storm');
    expect(dangerOf(sharp, 'gather', 1)).toMatch(/blizzard/);
    expect(dangerOf(sharp, 'gather', 3)).toMatch(/may not come back/);
    expect(dangerOf(plain, 'gather', 1)).toBeNull();
    expect(dangerOf(sharp, 'rest', 1)).toBeNull();
    expect(dangerOf({ ...sharp, weatherToday: 'overcast' }, 'gather', 1)).toBeNull();
    expect(previewQueue({ sim: sharp, queue: ['gather', 'rest'] }).dangers).toEqual([dangerOf(sharp, 'gather', 1), null]);
    expect(previewQueue({ sim: plain, queue: ['gather'] }).dangers).toEqual([null]);
    expect(observe(sharp)).toMatch(/- gather ring 1 .*DANGER: a blizzard/);
    expect(observe(plain)).not.toMatch(/DANGER/);
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
