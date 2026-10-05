/**
 * Acceptance tests for #1207 — the Region 1 (Greywind Reach) sim.
 * One test per Given/When/Then criterion (1–6) in the issue.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, endDay, chooseSite, choose, warmth, type Region1State } from './region1';
import { BASELINE } from './vitality';

/** Pass idle days (empty queue) until `day`. */
function advanceTo(s: Region1State, day: number): Region1State {
  let st = s;
  while (st.day < day) st = runDay(st, []).state;
  return st;
}

describe('Region 1 sim', () => {
  // 1. Fresh start; gated actions refused (at no cost) until scouted.
  it('starts on day 1 at baseline with nothing known, refusing gated work', () => {
    // GIVEN a new save
    const fresh = createRegion1();
    expect(fresh.day).toBe(1);
    expect(fresh.vitals.vigor.cap).toBe(BASELINE);
    expect(fresh.vitals.vigor.current).toBe(BASELINE);
    expect(fresh.knowledge).toEqual({ scouted: false, surveyed: false, tracked: false });
    expect(fresh.site).toBeNull();

    // WHEN they try to gather before scouting
    const tried = runAction(fresh, 'gather');
    // THEN it's refused and journalled, costing no time, body or stores
    expect(tried.stores.rawFood).toBe(fresh.stores.rawFood);
    expect(tried.hoursToday).toBe(0);
    expect(tried.vitals.vigor.current).toBe(BASELINE);
    expect(tried.log.at(-1)?.kind).toBe('skip');
  });

  // 2. Running an action spends hours + Vigor/Clarity and applies its effect.
  it('spends hours and body on an action and applies its effect', () => {
    const fresh = createRegion1();
    // WHEN they scout
    const scouted = runAction(fresh, 'scout');
    expect(scouted.knowledge.scouted).toBe(true);
    expect(scouted.hoursToday).toBe(4);
    expect(scouted.vitals.vigor.current).toBeLessThan(BASELINE);
    expect(scouted.vitals.clarity.current).toBeLessThan(BASELINE);
    // WHEN they then gather food
    const fed = runAction(scouted, 'gather');
    expect(fed.stores.rawFood).toBe(fresh.stores.rawFood + 3);
    expect(fed.hoursToday).toBe(9);
    // AND the earlier state was not mutated
    expect(scouted.stores.rawFood).toBe(fresh.stores.rawFood);
  });

  // 3. runDay stops at 14 waking hours, returns the remainder, advances the day.
  it('runs a queue until the day is spent, returning the remainder', () => {
    const day2 = runDay(createRegion1(), ['scout']).state;
    expect(day2.day).toBe(2);
    // WHEN five 4-hour wood trips are queued (20h > 14h)
    const r = runDay(day2, ['wood', 'wood', 'wood', 'wood', 'wood']);
    // THEN four ran (the 4th started at 12h, before the limit), one carries over
    expect(r.remaining).toEqual(['wood']);
    expect(r.state.stores.firewood).toBe(16);
    expect(r.state.day).toBe(3);
    expect(r.state.hoursToday).toBe(0);
    expect(day2.day).toBe(2); // pure
  });

  // 4. End of day eats & drinks; going without costs Condition and weakens recovery.
  it('consumes food and water at night; going hungry costs Condition and recovery', () => {
    const worked = runAction(createRegion1(), 'scout');
    // WHEN the day ends with food and water in store
    const fed = endDay(worked);
    expect(fed.stores.rawFood).toBe(worked.stores.rawFood - 1);
    expect(fed.stores.water).toBe(worked.stores.water - 1);
    // WHEN the same day ends with no food
    const hungry = endDay({ ...worked, stores: { ...worked.stores, rawFood: 0 } });
    // THEN they lose Condition and recover less overnight
    expect(hungry.vitals.condition).toBe(fed.vitals.condition - 6);
    expect(hungry.vitals.vigor.current).toBeLessThan(fed.vitals.vigor.current);
    expect(hungry.log.some(l => l.kind === 'hardship' && /Hungry/.test(l.text))).toBe(true);
  });

  // 5. Warmth = site × build tier; changing site resets the build.
  it('derives shelter warmth from site and tier, and resets the build on moving', () => {
    // GIVEN no scouting yet, a site can't be claimed
    expect(chooseSite(createRegion1(), 'cave').site).toBeNull();

    let s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
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

  // 6. Exits only when the calendar allows.
  it('only allows an exit when the calendar opens it', () => {
    const fresh = createRegion1();
    // WHEN they try to leave on day 1
    expect(() => choose(fresh, 'caravan')).toThrow(/not available/);
    // WHEN the caravan has arrived
    const day10 = advanceTo(fresh, 10);
    const left = choose(day10, 'caravan');
    expect(left.outcome?.choice).toBe('caravan');
    // AND once resolved, the region accepts no more exits or work
    expect(() => choose(left, 'winter')).toThrow(/already resolved/);
    expect(runAction(left, 'rest')).toEqual(left);
  });
});
