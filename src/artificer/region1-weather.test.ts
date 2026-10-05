/**
 * Acceptance tests for #1284 — weather changes the work: rain slows and
 * soaks you, fog blinds scouting, wind steals warmth and fuel, storms keep
 * you near camp, snow buries forage but shows tracks.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, queueHours, warmth, type Region1State } from './region1';
import { createVitals } from './vitality';
import { level } from './exploration';
import { DEFAULT_CALENDAR } from './winter';
import type { WeatherId } from './weather';

// Midday on day 3 (mild, fully lit), winter far off so no survival lock muddies the numbers.
const calendar = { ...DEFAULT_CALENDAR, winterDay: 30 };
const warden = (weather: WeatherId, over: Partial<Region1State> = {}): Region1State => {
  const s = runAction(createRegion1({ calendar }), 'scout');
  return { ...s, day: 3, hoursToday: 4, weatherToday: weather, vitals: createVitals(), ...over };
};
const used = (s: Region1State, q: Parameters<typeof runAction>[1]) => {
  const n = runAction(s, q);
  return { vigor: s.vitals.vigor.current - n.vitals.vigor.current, clarity: s.vitals.clarity.current - n.vitals.clarity.current, hours: n.hoursToday - s.hoursToday, n };
};
const lastAction = (s: Region1State) => [...s.log].reverse().find(l => l.kind === 'action' || l.kind === 'skip');
const lines = (a: Region1State, b: Region1State) => b.log.slice(a.log.length).map(l => l.text).join('\n');

describe('Weather effects (#1284)', () => {
  // 2. Storm: the outer rings are refused; near work is 1.3× harder.
  it('keeps you near camp in a storm', () => {
    const storm = warden('storm');
    const tried = runAction(storm, 'wood@2');
    expect(tried.hoursToday).toBe(storm.hoursToday);
    expect(lastAction(tried)?.text).toMatch(/too dangerous to go out/);
    expect(used(storm, 'wood').vigor).toBeCloseTo(used(warden('overcast'), 'wood').vigor * 1.3, 5);
  });

  // 3. Rain: gather, wood and quarry take 25% longer; 4+ hours out costs 3 Clarity at dusk.
  it('slows work in the rain and soaks you', () => {
    expect(used(warden('rain'), 'wood').hours).toBeCloseTo(used(warden('overcast'), 'wood').hours * 1.25, 10);
    expect(queueHours('wood', warden('rain'))).toBeCloseTo(queueHours('wood', warden('overcast')) * 1.25, 10);
    // 5h of wood in the rain: wet through by nightfall.
    const s = runAction(warden('rain'), 'wood');
    // Low Clarity so the night's recovery doesn't hit the cap and hide the difference.
    const camp = { ...s, stores: { ...s.stores, rawFood: 5, water: 5 }, vitals: createVitals({ clarity: 20 }) };
    const dry = { ...camp, weatherToday: 'overcast' as WeatherId };
    expect(lines(camp, endDay(camp))).toMatch(/Wet through/);
    expect(endDay(camp).vitals.clarity.current).toBeLessThan(endDay(dry).vitals.clarity.current);
    // An hour of water in the rain isn't enough to soak you.
    const brief = runAction(warden('rain'), 'water');
    expect(lines(brief, endDay({ ...brief, stores: { ...brief.stores, rawFood: 5, water: 5 } }))).not.toMatch(/Wet through/);
  });

  it('makes a rainy night under no roof a cold one', () => {
    const open = chooseSite(warden('rain'), 'cave');
    expect(open.tier).toBe(0);
    const night = endDay({ ...open, stores: { ...open.stores, rawFood: 5, water: 5 } });
    expect(night.log.some(l => /cold, broken night/.test(l.text))).toBe(true);
  });

  // 4. Fog: scouting and survey learn nothing.
  it('blinds scouting in fog', () => {
    const fresh = { ...warden('fog'), explore: createRegion1().explore };
    const after = runAction(fresh, 'scout');
    expect(level(after.explore, 1, 'forage')).toBe(0);
    expect(lastAction(after)?.text).toMatch(/fog/i);
  });

  it('steals warmth and fuel in the wind', () => {
    const roofed = runAction({ ...chooseSite(warden('wind'), 'cave'), stores: { ...warden('wind').stores, materials: 20 } }, 'build');
    // Night warmth is 0.1 lower: a night that would be fine may turn cold, and recovery is thinner.
    const calm = { ...roofed, weatherToday: 'overcast' as WeatherId, stores: { ...roofed.stores, rawFood: 5, water: 5 }, vitals: createVitals({ vigor: 40 }) };
    const windy = { ...calm, weatherToday: 'wind' as WeatherId };
    expect(warmth(windy)).toBe(warmth(calm));
    expect(endDay(windy).vitals.vigor.current).toBeLessThan(endDay(calm).vitals.vigor.current);
    // A fire for night study burns one more firewood.
    const night = (w: WeatherId) => ({ ...warden(w), hoursToday: 15, stores: { ...warden(w).stores, firewood: 5 } });
    const study = { q: 'study' as const, opts: { concept: 'joinery' } };
    expect(runAction(night('wind'), study).stores.firewood).toBe(runAction(night('overcast'), study).stores.firewood - 1);
  });

  it('buries forage under snow, but shows the tracks', () => {
    const food = (w: WeatherId) => runAction(warden(w), 'gather').stores.rawFood - warden(w).stores.rawFood;
    expect(food('snow')).toBe(Math.floor(food('overcast') * 0.5));
    expect(used(warden('snow'), 'track').vigor).toBeCloseTo(used(warden('overcast'), 'track').vigor * 0.8, 5);
  });
});
