/**
 * Acceptance tests for #1203 — the Vitality sim-core module.
 * One test per Given/When/Then criterion (1–5) in the issue.
 */

import { describe, it, expect } from 'vitest';
import {
  createVitals,
  applyActivity,
  driftCapacity,
  recoverCondition,
  morale,
  BASELINE,
  CAP_FLOOR,
  CAP_CEIL,
  type DaySummary,
} from './vitality';

describe('Vitality', () => {
  // 1. A drain spends the pool by rate×hours; it never goes below 0, and the
  //    overage past empty is subtracted from Condition.
  it('spends a pool on a drain, floors at zero, and bites Condition on overage', () => {
    // GIVEN a fresh, rested character
    const fresh = createVitals();
    // WHEN they do 4 hours of work that drains Vigor
    const worked = applyActivity(fresh, { hours: 4, vigorRate: -5 });
    // THEN Vigor fell, stayed positive, and Condition is untouched
    expect(worked.vitals.vigor.current).toBeLessThan(BASELINE);
    expect(worked.vitals.vigor.current).toBeGreaterThan(0);
    expect(worked.vitals.condition).toBe(100);
    expect(worked.pushedVigor).toBe(false);

    // GIVEN a character already near-empty on Vigor
    const spent = createVitals({ vigor: 5 });
    // WHEN they overreach badly
    const over = applyActivity(spent, { hours: 1, vigorRate: -100 });
    // THEN Vigor floors at 0, it is flagged pushed, and Condition took the hit
    expect(over.vitals.vigor.current).toBe(0);
    expect(over.pushedVigor).toBe(true);
    expect(over.vitals.condition).toBeLessThan(100);
    expect(over.conditionLost).toBeGreaterThan(0);
  });

  // 2. Low morale makes the same drain cost more; refills are NOT morale-scaled.
  it('low morale increases drain cost but not refills', () => {
    const activity = { hours: 2, vigorRate: -5 }; // base drain 10
    // GIVEN a high-morale and a low-morale character, both with room to drain
    const high = createVitals({ vigor: 60 });                      // morale high
    const low = createVitals({ vigor: 60, clarity: 20, condition: 0 }); // morale low
    expect(morale(low)).toBeLessThan(morale(high));
    // WHEN both do the same draining work
    const hiLoss = 60 - applyActivity(high, activity).vitals.vigor.current;
    const loLoss = 60 - applyActivity(low, activity).vitals.vigor.current;
    // THEN the low-morale character lost more Vigor
    expect(loLoss).toBeGreaterThan(hiLoss);

    // WHEN instead both eat the same meal (a flat +10)
    const hiGain = applyActivity(high, { hours: 0, vigorFlat: 10 }).vitals.vigor.current;
    const loGain = applyActivity(low, { hours: 0, vigorFlat: 10 }).vitals.vigor.current;
    // THEN morale does not change the gain — a meal is a meal
    expect(hiGain).toBe(70);
    expect(loGain).toBe(70);
  });

  // 3. `current` never exceeds `cap`; `cap` stays within [CAP_FLOOR, CAP_CEIL].
  it('keeps current under cap and cap within bounds', () => {
    // GIVEN a nearly-full pool
    const v = createVitals({ vigor: 95 });
    // WHEN a big refill lands
    const topped = applyActivity(v, { hours: 0, vigorFlat: 50 });
    // THEN current is clamped to the cap
    expect(topped.vitals.vigor.current).toBe(100);

    // WHEN capacity drifts hard in each direction for many nights
    const goodDay: DaySummary = { loadVigor: 25, loadClarity: 25, ate: true, shelterWarmth: 1 };
    const badDay: DaySummary = { loadVigor: 25, loadClarity: 25, ate: false, shelterWarmth: 0, pushedVigor: true, pushedClarity: true };
    let up = createVitals();
    let down = createVitals();
    for (let i = 0; i < 60; i++) { up = driftCapacity(up, goodDay); down = driftCapacity(down, badDay); }
    // THEN caps stay inside their hard bounds
    expect(up.vigor.cap).toBeLessThanOrEqual(CAP_CEIL);
    expect(up.vigor.cap).toBeGreaterThan(BASELINE);
    expect(down.vigor.cap).toBeGreaterThanOrEqual(CAP_FLOOR);
    expect(down.vigor.cap).toBeLessThan(BASELINE);
  });

  // 4. Capacity drifts up on a recovered hard day, down on an unrecovered one,
  //    and atrophies on an idle day.
  it('drifts capacity up (trained), down (overreached), and atrophies (idle)', () => {
    const base = createVitals(); // caps at 100

    // GIVEN a hard day, well fed and warmly slept, not pushed
    const trained = driftCapacity(base, { loadVigor: 20, loadClarity: 20, ate: true, shelterWarmth: 0.8 });
    expect(trained.vigor.cap).toBeGreaterThan(BASELINE);
    expect(trained.clarity.cap).toBeGreaterThan(BASELINE);

    // GIVEN a hard day with no food and a cold camp
    const overreached = driftCapacity(base, { loadVigor: 20, loadClarity: 20, ate: false, shelterWarmth: 0.2 });
    expect(overreached.vigor.cap).toBeLessThan(BASELINE);
    expect(overreached.clarity.cap).toBeLessThan(BASELINE);

    // GIVEN an idle day (barely used)
    const idle = driftCapacity(base, { loadVigor: 0, loadClarity: 0, ate: true, shelterWarmth: 0.8 });
    expect(idle.vigor.cap).toBeLessThan(BASELINE);
    expect(idle.clarity.cap).toBeLessThan(BASELINE);
  });

  // 5. Sleep recovery scales with shelter warmth; a meal (flat) restores Vigor.
  it('scales sleep recovery by warmth and restores Vigor from a meal', () => {
    // GIVEN a tired character
    const tired = createVitals({ vigor: 20, clarity: 20 });
    const sleep = { hours: 8, vigorRate: 5, clarityRate: 6, sleep: true };
    // WHEN they sleep warm vs. cold
    const warm = applyActivity(tired, sleep, { shelterWarmth: 1 });
    const cold = applyActivity(tired, sleep, { shelterWarmth: 0.2 });
    // THEN the warm night restored more of both pools
    expect(warm.vitals.clarity.current).toBeGreaterThan(cold.vitals.clarity.current);
    expect(warm.vitals.vigor.current).toBeGreaterThan(cold.vitals.vigor.current);

    // WHEN a half-spent character eats a meal
    const fed = applyActivity(createVitals({ vigor: 50 }), { hours: 1, vigorFlat: 20 });
    // THEN Vigor rose by the meal's flat value
    expect(fed.vitals.vigor.current).toBe(70);
  });

  // #1227 — Condition heals slowly, only on real rest (design doc §3); it never
  // recovered before, so one overworked day could lock a run out of readiness.
  it('heals Condition on a good night, never on a hard one', () => {
    const worn = createVitals({ condition: 57 });
    const good: DaySummary = { loadVigor: 20, loadClarity: 20, ate: true, shelterWarmth: 0.9 };
    // GIVEN fed, warm and not pushed THEN Condition rises a few points
    const healed = recoverCondition(worn, good).condition;
    expect(healed).toBeGreaterThan(57);
    expect(healed).toBeLessThan(65);
    // AND a light (rest) day heals more
    expect(recoverCondition(worn, { ...good, loadVigor: 4, loadClarity: 4 }).condition).toBeGreaterThan(healed);
    // AND warmer shelter heals more than barely-adequate shelter
    expect(recoverCondition(worn, { ...good, shelterWarmth: 0.5 }).condition).toBeLessThan(healed);
    // BUT hungry, cold, or pushed past empty heals nothing
    expect(recoverCondition(worn, { ...good, ate: false }).condition).toBe(57);
    expect(recoverCondition(worn, { ...good, shelterWarmth: 0.3 }).condition).toBe(57);
    expect(recoverCondition(worn, { ...good, pushedVigor: true }).condition).toBe(57);
    // AND it never passes 100
    expect(recoverCondition(createVitals({ condition: 99 }), good).condition).toBe(100);
  });
});
