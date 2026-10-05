/**
 * Acceptance tests for #1304 — land supply: each ring's forage, game, timber,
 * water and stone is a stock that trips draw down and the season regrows
 * overnight. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { RINGS, DOMAINS, tripYield, type Domain } from './exploration';
import { newGame, serialize, deserialize } from '../artificer-app/controller';

/** A scouted Warden in the flat world on `day`, fed and watered for a while. */
function warden(day: number, over: Partial<Region1State> = {}): Region1State {
  const s = runAction(createRegion1({ world: FLAT_WORLD }), 'scout');
  return { ...s, day, hoursToday: 0, vitals: createVitals(), stores: { ...s.stores, rawFood: 30, water: 30 }, ...over };
}
/** The same Warden with one near-ring supply set. */
const withSupply = (s: Region1State, d: Domain, v: number): Region1State =>
  ({ ...s, explore: { ...s.explore, supply: { ...s.explore.supply, 1: { ...s.explore.supply[1], [d]: v } } } });
/** Pass `n` nights doing nothing. */
const nights = (s: Region1State, n: number): Region1State => { for (let i = 0; i < n; i++) s = runDay(s, []).state; return s; };

describe('Land supply (#1304)', () => {
  // 1. A fresh run: every ring and domain full.
  it('starts every ring full', () => {
    const s = createRegion1();
    for (const r of RINGS) for (const d of DOMAINS) expect(s.explore.supply[r][d]).toBe(1);
  });

  // 2. Five forage trips on day 3 draw the near ring down to 0.65, and yields follow it down.
  it('draws supply down with each trip, and yields follow', () => {
    // Known in detail already, so the yield's base can't grow as the trips teach the ground.
    let s = warden(3);
    s = { ...s, explore: { ...s.explore, known: { ...s.explore.known, 1: { ...s.explore.known[1], forage: 3 } } } };
    const hauls: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = s.stores.rawFood;
      s = { ...runAction(s, 'gather'), hoursToday: 0 };
      hauls.push(s.stores.rawFood - before);
    }
    expect(s.explore.supply[1].forage).toBeCloseTo(0.65, 10);
    expect(hauls[4]).toBeLessThan(hauls[0]);
  });

  // 3. Forage regrows quickly in early autumn, not at all in winter.
  it('regrows forage by the season', () => {
    expect(nights(withSupply(warden(5), 'forage', 0.5), 4).explore.supply[1].forage).toBeCloseTo(0.7, 10);
    expect(nights(withSupply(warden(35), 'forage', 0.5), 4).explore.supply[1].forage).toBeCloseTo(0.5, 10);
  });

  // 4. Game drifts back slowly even in winter.
  it('lets game drift back slowly through the winter', () => {
    expect(nights(withSupply(warden(35), 'game', 0.5), 10).explore.supply[1].game).toBeCloseTo(0.6, 10);
  });

  // 5. Wind brings down wood: timber regrows 0.05 after a windy day, even in winter.
  it('brings timber back after wind', () => {
    expect(nights(withSupply(warden(35, { weatherToday: 'wind' }), 'timber', 0.5), 1).explore.supply[1].timber).toBeCloseTo(0.55, 10);
    expect(nights(withSupply(warden(5, { weatherToday: 'clear' }), 'timber', 0.5), 1).explore.supply[1].timber).toBeCloseTo(0.52, 10);
    // Water refills overnight; stone never grows back.
    const worn = withSupply(withSupply(warden(5), 'water', 0.9), 'stone', 0.7);
    expect(nights(worn, 1).explore.supply[1]).toMatchObject({ water: 1, stone: 0.7 });
  });

  // 6. A stripped ring still gives a little: the floor, never nothing.
  it('never yields nothing, however stripped the ground', () => {
    const s = withSupply(warden(3), 'forage', 0.1);
    expect(tripYield(s.explore, 1, 'forage', 3, 2)).toBe(Math.round(3 * 0.25));
    expect(runAction(s, 'gather').stores.rawFood).toBeGreaterThan(s.stores.rawFood);
  });

  // 7. Old saves turn their trip counts into supply.
  it('derives supply from trip counts in an old save', () => {
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.explore.supply;
    raw.sim.explore.worked[1].forage = 3;
    raw.sim.explore.worked[1].game = 20;
    const loaded = deserialize(JSON.stringify(raw))!.sim.explore;
    expect(loaded.supply[1].forage).toBeCloseTo(0.79, 10);
    expect(loaded.supply[1].game).toBe(0.5);
    expect(loaded.supply[2].timber).toBe(1);
  });

  // 8. Deterministic.
  it('plays out the same way every time', () => {
    const play = () => {
      let s = warden(3);
      for (let d = 0; d < 6; d++) s = runDay(s, ['gather', 'wood', 'water']).state;
      return s.explore.supply;
    };
    expect(play()).toEqual(play());
  });
});
