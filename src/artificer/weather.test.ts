/**
 * Acceptance tests for #1282 — seeded daily weather, and forecasts from
 * look-out and Weather sense. Effects come in #1283 and #1284.
 */

import { describe, it, expect } from 'vitest';
import { WEATHER, WEATHER_IDS, weatherFor, oddsFor, knownForecast } from './weather';
import { seedOf } from './rng';
import { createRegion1, runAction, endDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD, FULL_WORLD } from './world';
import { supplied } from './test-helpers';
import { deserialize, serialize, newGame } from '../artificer-app/controller';

const warden = (id = 'w-vega', over: Partial<Region1State> = {}): Region1State =>
  ({ ...runAction(createRegion1({}, undefined, { id }), 'scout'), hoursToday: 0, vitals: createVitals(), ...over });
const lines = (s: Region1State) => s.log.map(l => l.text).join('\n');

describe('Weather (#1282)', () => {
  // 1. Seeded per character and day, with the season's odds; no snow before day 20.
  it('rolls the same weather for the same Warden and day, with seasonal odds', () => {
    const seed = seedOf('w-vega');
    for (let d = 1; d <= 13; d++) expect(weatherFor(seed, d, FULL_WORLD)).toBe(weatherFor(seed, d, FULL_WORLD));
    const share = (day: number) => {
      const counts: Record<string, number> = {};
      // 5,000 Wardens: enough that 3 points is a real check, not sampling noise (σ ≈ 0.65 points at 30%).
      for (let i = 0; i < 5000; i++) { const w = weatherFor(seedOf(`w-${i}`), day, FULL_WORLD); counts[w] = (counts[w] ?? 0) + 1; }
      return counts;
    };
    for (const day of [3, 22]) {
      const counts = share(day);
      for (const id of WEATHER_IDS) expect(Math.abs((counts[id] ?? 0) / 50 - oddsFor(day)[id])).toBeLessThanOrEqual(3);
    }
    for (const d of [1, 8, 15, 19]) expect(Object.keys(share(d))).not.toContain('snow');
    for (const d of [3, 17, 22, 40]) expect(Object.values(oddsFor(d)).reduce((a, b) => a + b, 0)).toBe(100);
    expect(WEATHER.snow.name).toBe('Early snow');
  });

  it('records today’s weather and notes it each morning', () => {
    const s = warden();
    expect(s.weatherToday).toBe(weatherFor(seedOf('w-vega'), 1, FULL_WORLD));
    const next = endDay(supplied(s));
    expect(next.weatherToday).toBe(weatherFor(seedOf('w-vega'), 2, FULL_WORLD));
    expect(next.log.find(l => l.day === 2 && /^Morning/.test(l.text))?.text).toContain(WEATHER[next.weatherToday].name.toLowerCase());
  });

  // 7. Look-out shows tomorrow; Weather sense gives tomorrow and the day after, every morning.
  it('forecasts from a look-out, and from Weather sense', () => {
    const s = warden();
    expect(knownForecast(s)).toEqual([]);
    const looked = runAction(s, 'lookout');
    const tomorrow = weatherFor(seedOf('w-vega'), 2, FULL_WORLD);
    expect(knownForecast(looked)).toEqual([{ day: 2, weather: tomorrow }]);
    expect(lines(looked)).toMatch(new RegExp(`Tomorrow looks like ${WEATHER[tomorrow].name.toLowerCase()}`));
    // Weather sense: every morning, the next two days.
    const sensed = endDay(supplied(warden('w-vega', { techniques: ['weather'] })));
    expect(knownForecast(sensed)).toEqual([
      { day: 3, weather: weatherFor(seedOf('w-vega'), 3, FULL_WORLD) },
      { day: 4, weather: weatherFor(seedOf('w-vega'), 4, FULL_WORLD) },
    ]);
    // A forecast for a day that has come is no longer a forecast.
    expect(knownForecast(endDay(supplied(looked))).some(f => f.day <= 2)).toBe(false);
  });

  // 8. The flat world is always clear and says nothing about it.
  it('keeps the flat world clear and quiet', () => {
    let s = runAction(createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-vega' }), 'scout');
    for (let d = 0; d < 3; d++) {
      expect(s.weatherToday).toBe('clear');
      s = endDay(supplied(s));
    }
    expect(lines(s)).not.toMatch(/Morning/);
  });

  it('loads saves from before weather with today’s weather filled in', () => {
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.weatherToday; delete raw.sim.forecast;
    const loaded = deserialize(JSON.stringify(raw))!.sim;
    expect(WEATHER_IDS).toContain(loaded.weatherToday);
    expect(loaded.forecast).toEqual({});
    const kept = deserialize(serialize({ sim: runAction(warden(), 'lookout'), queue: [] }))!.sim;
    expect(knownForecast(kept)).toHaveLength(1);
  });
});
