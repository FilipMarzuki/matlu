/**
 * Acceptance tests for #1233 — realistic food & water: thirst is critical,
 * hunger is slow, and both fog the mind. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, NEEDS, type Region1State } from './region1';
import { createVitals, driftCapacity, recoverCondition, BASELINE, type DaySummary } from './vitality';
import { deserialize, serialize, newGame } from '../artificer-app/controller';

/** A settled, roofed camp with low pools (so sleep has room to recover); `food`/`water` at nightfall. */
function camp(food: number, water: number, over: Partial<Region1State> = {}): Region1State {
  let s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
  s = runAction({ ...s, stores: { ...s.stores, materials: 20 } }, 'build');
  return {
    ...s,
    stores: { ...s.stores, rawFood: food, water },
    vitals: createVitals({ vigor: 30, clarity: 60, condition: 90 }),
    today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false },
    ...over,
  };
}
/** Sleep's recovery alone, with the night's drains switched off, so the factors can be read directly. */
const recovered = (s: Region1State) => {
  const n = endDay(s);
  const drain = NEEDS.water.clarity * n.deprivation.thirsty + NEEDS.food.clarity * n.deprivation.hungry;
  return { vigor: n.vitals.vigor.current - s.vitals.vigor.current, clarity: n.vitals.clarity.current - s.vitals.clarity.current + drain };
};
/** Run `nights` nights with the given stores topped up/emptied each evening; returns the state after. */
function nights(s: Region1State, n: number, food: boolean, water: boolean): Region1State {
  for (let i = 0; i < n; i++) s = endDay({ ...s, stores: { ...s.stores, rawFood: food ? 5 : 0, water: water ? 5 : 0 } });
  return s;
}

describe('Food and water (#1233)', () => {
  // 1 + 2. Full recovery when fed and watered; water ×0.3 both pools; food ×0.5 Vigor / ×0.8 Clarity; both multiply.
  it('scales recovery by what was missing — water hardest', () => {
    const full = recovered(camp(5, 5));
    const dry = recovered(camp(5, 0));
    const hungry = recovered(camp(0, 5));
    const neither = recovered(camp(0, 0));
    expect(full.vigor).toBeGreaterThan(0);
    expect(full.clarity).toBeGreaterThan(0);
    expect(dry.vigor).toBeCloseTo(full.vigor * 0.3, 4);
    expect(dry.clarity).toBeCloseTo(full.clarity * 0.3, 4);
    expect(hungry.vigor).toBeCloseTo(full.vigor * 0.5, 4);
    expect(hungry.clarity).toBeCloseTo(full.clarity * 0.8, 4);
    expect(neither.vigor).toBeCloseTo(full.vigor * 0.15, 4);
    expect(neither.clarity).toBeCloseTo(full.clarity * 0.24, 4);
  });

  // 3. Thirst: −10 × streak Condition and −8 × streak Clarity; drinking resets.
  it('escalates thirst fast, on body and mind, and drinking resets it', () => {
    let s = camp(10, 0);
    const cond: number[] = [];
    for (let i = 0; i < 3; i++) { const b = s.vitals.condition; s = nights(s, 1, true, false); cond.push(b - s.vitals.condition); }
    expect(cond).toEqual([10, 20, 30]);
    expect(s.deprivation.thirsty).toBe(3);
    expect(s.log.map(l => l.text).join('\n')).toMatch(/Thirsty — no water \(3rd night running\)/);
    s = nights(s, 1, true, true);
    expect(s.deprivation.thirsty).toBe(0);
  });

  // 4. Hunger: −1 × streak Condition and −3 × streak Clarity; eating resets.
  it('escalates hunger slowly, and eating resets it', () => {
    let s = camp(0, 10);
    const cond: number[] = [];
    for (let i = 0; i < 3; i++) { const b = s.vitals.condition; s = nights(s, 1, false, true); cond.push(b - s.vitals.condition); }
    expect(cond).toEqual([1, 2, 3]);
    expect(s.deprivation.hungry).toBe(3);
    s = nights(s, 1, true, true);
    expect(s.deprivation.hungry).toBe(0);
  });

  // 3 + 4 (Clarity). Both drain the mind: the night's Clarity ends lower by the drain.
  it('fogs the mind: hunger and thirst both drain Clarity', () => {
    const fed = endDay(camp(5, 5)).vitals.clarity.current;
    const dryOnce = endDay(camp(5, 0));
    expect(dryOnce.vitals.clarity.current).toBeLessThan(fed);
    const hungry3 = nights(camp(0, 5), 3, false, true);
    const fed3 = nights(camp(5, 5), 3, true, true);
    expect(hungry3.vitals.clarity.current).toBeLessThan(fed3.vitals.clarity.current);
  });

  // 5. Three nights dry costs far more than three nights hungry.
  it('makes water far more critical than food', () => {
    const dry = 90 - nights(camp(5, 0), 3, true, false).vitals.condition;
    const hungry = 90 - nights(camp(0, 5), 3, false, true).vitals.condition;
    expect(dry).toBe(60);
    expect(hungry).toBe(6);
    expect(dry).toBeGreaterThan(5 * hungry);
  });

  // 6. Capacity: no water → no training; one missed meal still trains; two hungry nights running don't.
  it('trains capacity without water never, through one missed meal yes, through two no', () => {
    const v = createVitals();
    const day: DaySummary = { loadVigor: 20, loadClarity: 20, ate: true, drank: true, shelterWarmth: 0.9 };
    expect(driftCapacity(v, day).vigor.cap).toBeGreaterThan(BASELINE);
    const dry = driftCapacity(v, { ...day, drank: false });
    expect(dry.vigor.cap).toBeLessThan(BASELINE);
    expect(dry.clarity.cap).toBeLessThan(BASELINE);
    const oneMeal = driftCapacity(v, { ...day, ate: false, hungryNights: 1 });
    expect(oneMeal.vigor.cap).toBeGreaterThan(BASELINE);
    expect(oneMeal.clarity.cap).toBeGreaterThan(BASELINE);
    const twoMeals = driftCapacity(v, { ...day, ate: false, hungryNights: 2 });
    expect(twoMeals.vigor.cap).toBeLessThan(BASELINE);
  });

  // 7. Condition heals only when fed and watered.
  it('heals Condition only when fed and watered', () => {
    const worn = createVitals({ condition: 60 });
    const day: DaySummary = { loadVigor: 4, loadClarity: 4, ate: true, drank: true, shelterWarmth: 0.9 };
    expect(recoverCondition(worn, day).condition).toBeGreaterThan(60);
    expect(recoverCondition(worn, { ...day, drank: false }).condition).toBe(60);
    expect(recoverCondition(worn, { ...day, ate: false }).condition).toBe(60);
  });

  // 8. Old saves load with zero streaks.
  it('loads a save from before deprivation tracking with zero streaks', () => {
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.deprivation;
    expect(deserialize(JSON.stringify(raw))?.sim.deprivation).toEqual({ hungry: 0, thirsty: 0 });
  });
});
