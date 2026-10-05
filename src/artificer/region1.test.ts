/**
 * Acceptance tests for #1207 — the Region 1 (Greywind Reach) sim.
 * One test per Given/When/Then criterion (1–6) in the issue.
 */

import { describe, it, expect } from 'vitest';
// These check exact numbers and long plans written for an evenly lit day, so they play the flat world (#1281).
import { FLAT_WORLD } from './world';
import { fastForward, SHORT_YEAR } from './test-helpers';
import { createRegion1, runAction, runDay, endDay, chooseSite, warmth, type Region1State, NEEDS } from './region1';
import { BASELINE } from './vitality';
import { scouted, level } from './exploration';

/** Pass idle days (empty queue) until `day`. */
function advanceTo(s: Region1State, day: number): Region1State {
  let st = s;
  st = fastForward(st, day, []);
  return st;
}

describe('Region 1 sim', () => {
  // 1. Fresh start; gated actions refused (at no cost); blind foraging still teaches.
  it('starts on day 1 at baseline with nothing known, refusing gated work', () => {
    // GIVEN a new save
    const fresh = createRegion1({ world: FLAT_WORLD });
    expect(fresh.day).toBe(1);
    expect(fresh.vitals.vigor.cap).toBe(BASELINE);
    expect(fresh.vitals.vigor.current).toBe(BASELINE);
    expect(scouted(fresh.explore, 1)).toBe(false);
    expect(fresh.site).toBeNull();

    // WHEN they try to hunt before tracking any game
    const tried = runAction(fresh, 'hunt');
    // THEN it's refused and journalled, costing no time, body or stores
    expect(tried.stores.rawFood).toBe(fresh.stores.rawFood);
    expect(tried.hoursToday).toBe(0);
    expect(tried.vitals.vigor.current).toBe(BASELINE);
    expect(tried.log.at(-1)?.kind).toBe('skip');

    // WHEN they forage blind instead, it yields half and starts lifting the fog
    const blind = runAction(fresh, 'gather');
    expect(blind.stores.rawFood).toBe(fresh.stores.rawFood + 2); // round(3 × 0.5)
    expect(blind.explore.known[1].forage).toBeGreaterThan(0);
    expect(blind.explore.known[1].water).toBeGreaterThan(0);
  });

  // 2. Running an action spends hours + Vigor/Clarity and applies its effect.
  it('spends hours and body on an action and applies its effect', () => {
    const fresh = createRegion1({ world: FLAT_WORLD });
    // WHEN they scout
    const looked = runAction(fresh, 'scout');
    expect(scouted(looked.explore, 1)).toBe(true);
    expect(level(looked.explore, 1, 'forage')).toBe(1);
    expect(looked.hoursToday).toBe(4);
    expect(looked.vitals.vigor.current).toBeLessThan(BASELINE);
    expect(looked.vitals.clarity.current).toBeLessThan(BASELINE);
    // WHEN they then gather food
    const fed = runAction(looked, 'gather');
    expect(fed.stores.rawFood).toBe(fresh.stores.rawFood + 3);
    expect(fed.hoursToday).toBe(9);
    // AND the earlier state was not mutated
    expect(looked.stores.rawFood).toBe(fresh.stores.rawFood);
  });

  // 3. runDay stops at 14 waking hours, returns the remainder, advances the day.
  it('runs a queue until the day is spent, returning the remainder', () => {
    const day2 = runDay(createRegion1({ world: FLAT_WORLD }), ['scout']).state;
    expect(day2.day).toBe(2);
    // WHEN five 4-hour wood trips are queued (20h > 14h)
    const r = runDay(day2, ['wood', 'wood', 'wood', 'wood', 'wood']);
    // THEN four ran (the 4th started at 12h, before the limit), one carries over
    expect(r.remaining).toEqual(['wood']);
    // 4 + 4 + 3 (the stand thins) + 4 (now observed from working it, but thinner still) = 15,
    // + 1 on each of trips 2–4: the first trip's practice works out Reading the grain (#1243).
    expect(r.state.stores.firewood).toBe(18);
    expect(r.state.day).toBe(3);
    expect(r.state.hoursToday).toBe(0);
    expect(day2.day).toBe(2); // pure
  });

  // 4. End of day eats & drinks; going without costs Condition and weakens recovery.
  it('consumes food and water at night; going hungry costs Condition and recovery', () => {
    const worked = runAction(createRegion1({ world: FLAT_WORLD }), 'scout');
    // WHEN the day ends with food and water in store
    const fed = endDay(worked);
    expect(fed.stores.rawFood).toBe(worked.stores.rawFood - 1);
    expect(fed.stores.water).toBe(worked.stores.water - 1);
    // WHEN the same day ends with no food
    const hungry = endDay({ ...worked, stores: { ...worked.stores, rawFood: 0 } });
    // THEN they lose Condition and recover less overnight (a first hungry night is mild; #1233 escalates it)
    expect(hungry.vitals.condition).toBe(fed.vitals.condition - NEEDS.food.condition);
    expect(hungry.vitals.vigor.current).toBeLessThan(fed.vitals.vigor.current);
    expect(hungry.log.some(l => l.kind === 'hardship' && /Hungry/.test(l.text))).toBe(true);
  });

  // 5. Warmth = site × build tier; changing site resets the build.
  it('derives shelter warmth from site and tier, and resets the build on moving', () => {
    // GIVEN no scouting yet, a site can't be claimed
    expect(chooseSite(createRegion1({ world: FLAT_WORLD }), 'cave').site).toBeNull();

    let s = chooseSite(runAction(createRegion1({ world: FLAT_WORLD }), 'scout'), 'cave');
    expect(warmth(s)).toBeCloseTo(0.27);
    s = { ...s, stores: { ...s.stores, materials: 20 } };
    s = runAction(s, 'build');
    expect(s.tier).toBe(1);
    expect(warmth(s)).toBeCloseTo(0.585);
    s = runAction(s, 'build');
    expect(s.tier).toBe(2);
    expect(warmth(s)).toBeCloseTo(0.9);
    // WHEN they move to the treeline
    s = chooseSite(s, 'tree');
    // THEN the build starts over there
    expect(s.tier).toBe(0);
    expect(warmth(s)).toBeCloseTo(0.21);
  });

  // 6. No exits (#1302): the region resolves at the thaw, and then accepts no more work.
  it('resolves at the thaw, and accepts no more work after', () => {
    const fresh = createRegion1({ world: FLAT_WORLD, calendar: SHORT_YEAR });
    const done = { ...advanceTo(fresh, 5), day: SHORT_YEAR.thawDay - 1 };
    expect(done.outcome).toBeNull();
    const thawed = runDay({ ...done, stores: { ...done.stores, rawFood: 2, water: 2 } }, []).state;
    expect(thawed.outcome?.choice).toBe('thaw');
    expect(runAction(thawed, 'rest')).toEqual(thawed);
  });
});
