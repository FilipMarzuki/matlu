/**
 * Acceptance tests for #1314 — trip luck: a gathering trip succeeds or fails
 * on seeded luck, and the weather and the land's supply set the odds. One test
 * per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, tripOdds, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { seedOf } from './rng';
import { bandFor, bandOdds, haulFortune, luckSteps, BANDS, type Band, type LuckInput } from './luck';

const at = (over: Partial<LuckInput> = {}): LuckInput => ({ domain: 'forage', weather: 'overcast', supply: 1, skillLevel: 0, technique: false, light: 1, ...over });

/** A fresh, scouted Warden named `id` at noon on day 3 under cloud (no weather shift), full world. */
function warden(id: string, over: Partial<Region1State> = {}): Region1State {
  const s = runAction(createRegion1({}, undefined, { id }), 'scout');
  return { ...s, day: 3, hoursToday: 6, weatherToday: 'overcast', vitals: createVitals(), ...over };
}
/** The first Warden whose noon-on-day-3 fortune lands in `band` at even odds. */
function wardenWith(band: Band): string {
  for (let i = 0; ; i++) if (bandFor(haulFortune(seedOf(`w-${i}`), 3, 12), 0) === band) return `w-${i}`;
}
const food = (s: Region1State): number => runAction(s, 'gather').stores.rawFood - s.stores.rawFood;
const lines = (s: Region1State): string => s.log.map(l => l.text).join('\n');

describe('Trip luck (#1314)', () => {
  // 1. Same seed, day and starting hour: the same band. An hour later can differ.
  it('fixes luck per hour, so a plan change never rerolls it', () => {
    const seed = seedOf('w-vega');
    expect(haulFortune(seed, 5, 9)).toBe(haulFortune(seed, 5, 9));
    let differs = false;
    for (let h = 6; h < 20 && !differs; h++) differs = bandFor(haulFortune(seed, 5, h), 0) !== bandFor(haulFortune(seed, 5, h + 1), 0);
    expect(differs).toBe(true);
    // In play: the same trip from the same state comes out the same.
    const s = warden('w-vega');
    expect(runAction(s, 'gather')).toEqual(runAction(s, 'gather'));
  });

  // 2. Even odds: about 5 / 20 / 55 / 20%.
  it('lands the bands at about 5 / 20 / 55 / 20% on even odds', () => {
    const counts: Record<Band, number> = { empty: 0, poor: 0, ordinary: 0, good: 0 };
    for (let i = 0; i < 5000; i++) counts[bandFor(haulFortune(seedOf(`w-${i}`), 3, 9), 0)]++;
    const expected: Record<Band, number> = { empty: 5, poor: 20, ordinary: 55, good: 20 };
    for (const b of BANDS) expect(Math.abs(counts[b] / 50 - expected[b])).toBeLessThanOrEqual(1.5);
    expect(bandOdds(0).empty).toBeCloseTo(0.05, 10);
    expect(bandOdds(0).good).toBeCloseTo(0.2, 10);
  });

  // 3. Snow: foraging two steps worse, hunting better.
  it('makes snow bad for foraging and good for hunting', () => {
    expect(luckSteps(at({ weather: 'snow' }))).toBe(-2);
    const snowy = bandOdds(luckSteps(at({ weather: 'snow' }))), clear = bandOdds(luckSteps(at({ weather: 'clear' })));
    expect(snowy.empty + snowy.poor).toBeGreaterThan(clear.empty + clear.poor + 0.15);
    expect(luckSteps(at({ domain: 'game', weather: 'snow' }))).toBeGreaterThan(luckSteps(at({ domain: 'game', weather: 'clear' })));
    // The rest of the weather table.
    expect(luckSteps(at({ domain: 'game', weather: 'rain' }))).toBe(-1);
    expect(luckSteps(at({ domain: 'timber', weather: 'wind' }))).toBe(1);
    expect(luckSteps(at({ domain: 'forage', weather: 'storm' }))).toBe(-2);
  });

  // 4. Bare ground: two steps worse than plenty.
  it('worsens the odds on picked-over ground', () => {
    expect(luckSteps(at({ supply: 0.1 }))).toBe(luckSteps(at({ supply: 1 })) - 2);
    expect(luckSteps(at({ supply: 0.3 }))).toBe(luckSteps(at({ supply: 1 })) - 1);
    expect(luckSteps(at({ supply: 0.6 }))).toBe(luckSteps(at({ supply: 1 })));
  });

  // 5. A good haul is 1.5× the ordinary one; an empty trip brings nothing, and says why.
  it('multiplies the haul by the band, and says why it went badly', () => {
    const ordinary = food(warden(wardenWith('ordinary')));
    expect(ordinary).toBeGreaterThan(0);
    expect(food(warden(wardenWith('good')))).toBe(Math.round(ordinary * 1.5));
    expect(food(warden(wardenWith('poor')))).toBe(Math.round(ordinary * 0.5));
    const empty = runAction(warden(wardenWith('empty')), 'gather');
    expect(empty.stores.rawFood).toBe(warden(wardenWith('empty')).stores.rawFood);
    expect(lines(empty)).toMatch(/Came back with nothing/);
    // With a reason when there is one: an empty hunt in the rain.
    const wet = runAction(warden(wardenWith('empty'), { weatherToday: 'rain' }), { q: 'hunt', opts: { target: 'small' } });
    expect(lines(wet)).toMatch(/Came back with nothing — the rain had driven the game to cover/);
  });

  // 6. A Skilled forager's odds are two steps better than a Novice's.
  it('improves the odds with skill', () => {
    expect(luckSteps(at({ skillLevel: 5 }))).toBe(luckSteps(at({ skillLevel: 1 })) + 2);
    expect(luckSteps(at({ skillLevel: 3 }))).toBe(luckSteps(at({ skillLevel: 1 })) + 1);
    expect(luckSteps(at({ technique: true }))).toBe(luckSteps(at()) + 1);
    expect(luckSteps(at({ light: 0 }))).toBe(luckSteps(at()) - 1);
    // The odds shown in play, in a word.
    expect(tripOdds(warden('w-vega'), 'gather', 1)).toBe('fair');
    expect(tripOdds(warden('w-vega', { weatherToday: 'snow' }), 'gather', 1)).toBe('bad');
    expect(tripOdds(warden('w-vega'), 'scout', 1)).toBeNull();
  });

  // 7. The flat world: every trip ordinary.
  it('keeps every trip ordinary in the flat world', () => {
    const flat = (id: string) => ({ ...runAction(createRegion1({ world: FLAT_WORLD }, undefined, { id }), 'scout'), day: 3, hoursToday: 6, vitals: createVitals() });
    const hauls = ['w-0', 'w-1', 'w-2', 'w-3', 'w-4', wardenWith('empty'), wardenWith('good')].map(id => food(flat(id)));
    expect(new Set(hauls).size).toBe(1);
    expect(tripOdds(flat('w-0'), 'gather', 1)).toBeNull();
  });
});
