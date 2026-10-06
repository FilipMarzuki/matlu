/**
 * Acceptance tests for #1294 — carrying gear: basket, backpack, harness and
 * sled make loads less awkward; they never raise the max. One test per
 * Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { gearOf, bestGear, cumbersome, maxLoad, fitHaul, SLED_EXTRA } from './load';
import { createRegion1, runAction, chooseSite, blockedReason, DISCOVERIES, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { STEADY_WORLD } from './test-helpers';

const tool = (item: string, grade = 'sound') => ({ item, grade });
const str10 = { ...DEFAULT_STATS };

describe('Carrying gear (#1294)', () => {
  // 1. A sound basket: 6 raw food are 6 cumbersome, not 9.
  it('makes food easy to carry in a basket', () => {
    expect(cumbersome({ rawFood: 6 })).toBe(9);
    expect(cumbersome({ rawFood: 6 }, gearOf([tool('basket')]))).toBe(6);
    expect(gearOf([tool('basket')]).awk.materials).toBe(1);
  });

  // 2. A sound harness: 5 firewood are 11 cumbersome, not 16.
  it('makes wood easier to carry with a harness', () => {
    expect(cumbersome({ firewood: 5 })).toBeCloseTo(16, 10);
    expect(cumbersome({ firewood: 5 }, gearOf([tool('harness')]))).toBeCloseTo(11, 10);
    expect(gearOf([tool('harness')]).awk).toMatchObject({ stone: 1, hides: 1 });
  });

  // 3. A backpack and a basket: raw food is 0.8 awkward (1.0 × 0.8) — and nothing goes below 0.8.
  it('stacks a backpack on the other gear, down to 0.8', () => {
    const g = gearOf([tool('backpack'), tool('basket')]);
    expect(g.awk.rawFood).toBeCloseTo(0.8, 10);
    expect(g.awk.rations).toBeCloseTo(0.8, 10); // 1.0 × 0.8
    expect(g.awk.stone).toBeCloseTo(1.3 * 0.8, 10);
    expect(Math.min(...Object.values(g.awk))).toBeGreaterThanOrEqual(0.8);
  });

  // 4. A sled on snow: 12 stone count 18 (36 × 0.5) plus the sled's 4. Level ground the same; ring 3 0.8×.
  it('drags heavy loads on a sled', () => {
    const snow = gearOf([tool('sled')], { ring: 3, snow: true });
    expect(cumbersome({ stone: 12 }, { ...snow, awk: { stone: 1 } })).toBeCloseTo(18 + SLED_EXTRA, 10);
    expect(SLED_EXTRA).toBe(4);
    expect(gearOf([tool('sled')], { ring: 2, snow: false }).weight.stone).toBe(0.5);
    expect(gearOf([tool('sled')], { ring: 3, snow: false }).weight.stone).toBe(0.8);
    // It lets far more stone come home: 12 stone don't fit by hand (46.8 > 40), but do on a sled.
    expect(fitHaul({ stone: 12 }, gearOf([]), str10).left).toEqual({ stone: 2 });
    expect(fitHaul({ stone: 12 }, snow, str10).left).toEqual({});
    // The sled comes only when it helps: a little food goes home in the arms, not dragged (it would add 4).
    expect(bestGear([tool('sled')], { ring: 1, snow: false }, { rawFood: 3 }, str10).extra).toBe(0);
    expect(bestGear([tool('sled')], { ring: 1, snow: false }, { stone: 12 }, str10).extra).toBe(SLED_EXTRA);
  });

  // 5. Crude gear gives half the improvement: a crude basket makes food 1.25 awkward.
  it('gives half the improvement from crude gear', () => {
    expect(gearOf([tool('basket', 'crude')]).awk.rawFood).toBeCloseTo(1.25, 10);
    expect(gearOf([tool('sled', 'crude')], { ring: 1, snow: true }).weight.stone).toBeCloseTo(0.75, 10);
    // A sound one alongside a crude one: the sound one counts.
    expect(gearOf([tool('basket', 'crude'), tool('basket')]).awk.rawFood).toBe(1);
  });

  // 6. Gear never raises the max.
  it('never raises the max load', () => {
    expect(maxLoad(str10)).toBe(40);
    // Even with every piece, the raw weight is cut at the max.
    const all = gearOf([tool('basket'), tool('backpack'), tool('harness'), tool('sled')], { ring: 1, snow: true });
    const { carried } = fitHaul({ stone: 20 }, all, str10);
    expect((carried.stone ?? 0) * 3).toBeLessThanOrEqual(40);
  });

  // In play: the four recipes are worked out from the loads they would ease, and crafted at camp.
  it('works the gear out from the loads, and crafts it', () => {
    expect(DISCOVERIES.map(d => d.recipe)).toEqual(expect.arrayContaining(['basket', 'backpack', 'harness', 'sled']));
    const s0 = chooseSite(runAction(createRegion1({ world: STEADY_WORLD }), 'scout'), 'cave');
    const s: Region1State = { ...s0, day: 5, hoursToday: 0, vitals: createVitals(), stores: { ...s0.stores, materials: 10, hides: 2 } };
    expect(blockedReason(s, 'basket', 1)).toMatch(/haven't worked out/);
    const fed = runAction(s, 'gather'); // arms full of loose food
    expect(fed.known).toContain('basket');
    const made = runAction({ ...fed, hoursToday: 0 }, 'basket');
    expect(made.tools.some(t => t.item === 'basket')).toBe(true);
    expect(made.stores.materials).toBeLessThan(fed.stores.materials);
  });
});
