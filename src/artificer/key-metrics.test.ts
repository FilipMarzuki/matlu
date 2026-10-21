/**
 * Acceptance tests for #1891 — the key survival metrics (key-metrics.ts): each region declares its
 * own, Region 1's are food, water and firewood; food counts as days at the sim's real eating need;
 * the low flags; and the winter needs come from the winter outlook. Display only: nothing here
 * changes the run.
 */

import { describe, expect, it } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, nightFuel, nightSpoilage, winterOutlook, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { STEADY_WORLD } from './test-helpers';
import { nightTemp } from './weather';
import { FOOD_PER_NIGHT, REGION_KEY_METRICS, foodBreakdown, foodDays, keyMetrics, keyMetricsOf, outlookNights } from './key-metrics';
import { makeT } from './i18n';
import { outlookWarnings } from '../artificer-app/progress-view';

const en = makeT('en');

/** A Warden camped at the cave on `day`, with the stores given (full world, luck off). */
function camp(day: number, stores: Partial<Region1State['stores']>, world = STEADY_WORLD): Region1State {
  const s = chooseSite(runAction(createRegion1({ world }), 'scout'), 'cave');
  return { ...s, day, hoursToday: 0, weatherToday: 'overcast', tier: 1, shelterGrade: 'sound', shelter: { type: 'leanto', walls: null }, vitals: createVitals(),
    stores: { ...s.stores, rawFood: 0, rations: 0, water: 10, firewood: 10, materials: 6, stone: 2, hides: 0, ...stores } };
}
const metric = (s: Region1State, id: 'food' | 'water' | 'firewood', needs = true) => keyMetrics(s, { needs }).find(m => m.id === id)!;

describe('each region declares its key metrics (#1891)', () => {
  it('Given Region 1, When its key metrics are asked for, Then they are food, water and firewood, in that order', () => {
    expect(REGION_KEY_METRICS.region1).toEqual(['food', 'water', 'firewood']);
    expect(keyMetricsOf()).toEqual(['food', 'water', 'firewood']);
    expect(keyMetrics(camp(3, {})).map(m => m.id)).toEqual(['food', 'water', 'firewood']);
  });

  it('Given the metrics, Then materials are not among them', () => {
    expect(keyMetricsOf()).not.toContain('materials');
  });
});

describe('days of food (#1891)', () => {
  it('Given 3 raw food and 2 rations, When counted, Then food covers 5 days at one meal a night', () => {
    const s = camp(3, { rawFood: 3, rations: 2 });
    expect(foodDays(s)).toBe(5);
    expect(metric(s, 'food')).toMatchObject({ value: 5, unit: 'days', low: false });
  });

  it("Given the sim's own night, When a night passes at full rations, Then exactly FOOD_PER_NIGHT food is eaten", () => {
    // The flat world has no spoilage, so the only food that goes is supper.
    const s = camp(3, { rawFood: 3, rations: 2 }, FLAT_WORLD);
    const after = runDay(s, []).state;
    expect(after.stores.rawFood + after.stores.rations).toBe(5 - FOOD_PER_NIGHT);
    expect(foodDays(after)).toBe(foodDays(s) - 1);
  });

  it('Given any stores, Then the days of food are the winter outlook\'s nights of food', () => {
    for (const [raw, rat] of [[0, 0], [4, 0], [0, 7], [9, 3]]) {
      const s = camp(5, { rawFood: raw, rations: rat });
      expect(foodDays(s)).toBe(winterOutlook(s).foodDays);
    }
  });

  it('Given raw food and rations, When broken down by kind, Then rations keep and the raw food that spoils tonight is marked', () => {
    const s = camp(3, { rawFood: 10, rations: 4 });
    const f = foodBreakdown(s);
    expect(f).toMatchObject({ raw: 10, rations: 4 });
    expect(f.spoilsTonight).toBe(nightSpoilage(s, nightTemp(3, 'overcast', s.config.calendar)).spoiled);
    expect(f.spoilsTonight).toBeGreaterThan(0);
    // The flat world has no spoilage.
    expect(foodBreakdown(camp(3, { rawFood: 10 }, FLAT_WORLD)).spoilsTonight).toBe(0);
  });
});

describe('the low flag (#1891)', () => {
  it('Given no food at all, Then food is low; with only rations, it is not', () => {
    expect(metric(camp(3, {}), 'food').low).toBe(true);
    expect(metric(camp(3, { rations: 1 }), 'food').low).toBe(false);
  });

  it('Given no water, Then water is low', () => {
    expect(metric(camp(3, { water: 0 }), 'water').low).toBe(true);
    expect(metric(camp(3, { water: 1 }), 'water').low).toBe(false);
  });

  it("Given less firewood than tonight's fire needs, Then firewood is low", () => {
    // Deep winter: a frosty night asks for wood.
    const cold = camp(50, { firewood: 0 });
    expect(nightFuel(cold)).toBeGreaterThan(0);
    expect(metric(cold, 'firewood').low).toBe(true);
    expect(metric(camp(50, { firewood: 40 }), 'firewood').low).toBe(false);
  });
});

describe('the winter needs come from the winter outlook (#1891)', () => {
  it('Given a run, Then food needs the outlook\'s nights and firewood the wood to the thaw; water has none', () => {
    const s = camp(20, { rawFood: 4, rations: 2, firewood: 12 });
    const o = winterOutlook(s);
    expect(metric(s, 'food').need).toBe(outlookNights(s));
    expect(metric(s, 'firewood').need).toBe(o.fuelToThaw);
    expect(metric(s, 'water')).toMatchObject({ need: null, holding: null });
  });

  it('Given short stores, Then food and firewood are not holding, as the outlook\'s warnings say', () => {
    const s = camp(20, { rawFood: 2, firewood: 3 });
    expect(metric(s, 'food').holding).toBe(false);
    expect(metric(s, 'firewood').holding).toBe(false);
    const warned = outlookWarnings(s, en).join(' ');
    expect(warned).toMatch(/Food lasts/);
    expect(warned).toMatch(/Firewood lasts/);
  });

  it('Given plenty laid by, Then both hold', () => {
    const s = camp(20, { rawFood: 0, rations: 80, firewood: 400 });
    expect(metric(s, 'food').holding).toBe(true);
    expect(metric(s, 'firewood').holding).toBe(true);
  });

  it('Given needs: false (the status bar), Then no needs are worked out', () => {
    expect(keyMetrics(camp(20, {}), { needs: false }).every(m => m.need === null && m.holding === null)).toBe(true);
  });
});
