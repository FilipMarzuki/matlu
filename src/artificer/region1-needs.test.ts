/**
 * Acceptance tests for #1233 — food AND water are both needed to recover body
 * and mind, and going without escalates night by night.
 * One test per Given/When/Then scenario in the issue.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, type Region1State } from './region1';
import { createVitals, driftCapacity, recoverCondition, BASELINE, type DaySummary } from './vitality';
import { deserialize, serialize, newGame } from '../artificer-app/controller';

/** A settled, roofed camp; `food`/`water` are what's in the stores at nightfall. */
function camp(food: number, water: number, over: Partial<Region1State> = {}): Region1State {
  let s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
  s = runAction({ ...s, stores: { ...s.stores, materials: 20 } }, 'build');
  return {
    ...s,
    stores: { ...s.stores, rawFood: food, water },
    vitals: createVitals({ vigor: 40, clarity: 40, condition: 80 }),
    today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false },
    ...over,
  };
}
const gained = (s: Region1State) => {
  const n = endDay(s);
  return { vigor: n.vitals.vigor.current - s.vitals.vigor.current, clarity: n.vitals.clarity.current - s.vitals.clarity.current, n };
};

describe('Food and water (#1233)', () => {
  // 1. Fed and watered → full recovery of both Vigor and Clarity.
  // 2. One missing → 40%; both missing → 15%.
  it('recovers body and mind in full only with both food and water', () => {
    const full = gained(camp(5, 5));
    const noWater = gained(camp(5, 0));
    const noFood = gained(camp(0, 5));
    const neither = gained(camp(0, 0));
    expect(full.vigor).toBeGreaterThan(0);
    expect(full.clarity).toBeGreaterThan(0);
    for (const one of [noWater, noFood]) {
      expect(one.vigor).toBeCloseTo(full.vigor * 0.4, 5);
      expect(one.clarity).toBeLessThan(full.clarity);
    }
    expect(neither.vigor).toBeCloseTo(full.vigor * 0.15, 5);
    expect(neither.clarity).toBeLessThan(noWater.clarity);
  });

  // 3. Hunger costs 3 × consecutive hungry nights; eating resets the streak.
  it('escalates hunger night by night, and eating resets it', () => {
    let s = camp(0, 10);
    const losses: number[] = [];
    for (let i = 0; i < 3; i++) { const before = s.vitals.condition; s = endDay({ ...s, stores: { ...s.stores, rawFood: 0 } }); losses.push(before - s.vitals.condition); }
    expect(losses).toEqual([3, 6, 9]);
    expect(s.deprivation.hungry).toBe(3);
    s = endDay({ ...s, stores: { ...s.stores, rawFood: 1 } });
    expect(s.deprivation.hungry).toBe(0);
    expect(s.log.map(l => l.text).join('\n')).toMatch(/Hungry — no food \(3rd night running\)/);
  });

  // 4. Thirst costs 6 × consecutive thirsty nights; drinking resets it.
  it('escalates thirst faster than hunger, and drinking resets it', () => {
    let s = camp(10, 0);
    const losses: number[] = [];
    for (let i = 0; i < 3; i++) { const before = s.vitals.condition; s = endDay({ ...s, stores: { ...s.stores, water: 0 } }); losses.push(before - s.vitals.condition); }
    expect(losses).toEqual([6, 12, 18]);
    expect(s.deprivation.thirsty).toBe(3);
    s = endDay({ ...s, stores: { ...s.stores, water: 1 } });
    expect(s.deprivation.thirsty).toBe(0);
  });

  // 5. Clarity capacity trains only when warm AND fed AND watered.
  // 6. Vigor capacity trains only when fed AND watered.
  it('trains capacity only on nights with both food and water', () => {
    const v = createVitals();
    const day: DaySummary = { loadVigor: 20, loadClarity: 20, ate: true, drank: true, shelterWarmth: 0.9 };
    const trained = driftCapacity(v, day);
    expect(trained.vigor.cap).toBeGreaterThan(BASELINE);
    expect(trained.clarity.cap).toBeGreaterThan(BASELINE);
    const dry = driftCapacity(v, { ...day, drank: false });
    expect(dry.vigor.cap).toBeLessThan(BASELINE);
    expect(dry.clarity.cap).toBeLessThan(BASELINE);
    const hungry = driftCapacity(v, { ...day, ate: false });
    expect(hungry.clarity.cap).toBeLessThan(BASELINE);
  });

  // 7. Condition heals only with both.
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
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded?.sim.deprivation).toEqual({ hungry: 0, thirsty: 0 });
  });
});
