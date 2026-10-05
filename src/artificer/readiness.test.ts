/**
 * Acceptance tests for #1205 — winter readiness pillars + milestone latch.
 * One test per Given/When/Then criterion (1–4) in the issue.
 */

import { describe, it, expect } from 'vitest';
import { pillars, isWinterReady, evaluateMilestones, DEFAULT_THRESHOLDS, type ReadinessInput, type MilestoneDef } from './readiness';
import { createVitals } from './vitality';

const fresh = (): ReadinessInput => ({ rations: 0, firewood: 0, shelterWarmth: 0, vitals: createVitals() });
const byKey = (input: ReadinessInput) => Object.fromEntries(pillars(input).map(p => [p.key, p]));

describe('Winter readiness', () => {
  // 1. Pillars are not done at start, become done exactly at threshold; progress clamped.
  it('flips each stock pillar exactly at its threshold, with clamped progress', () => {
    // GIVEN a fresh start
    const start = byKey(fresh());
    // THEN the stock pillars are not done and show zero progress
    expect(start.larder.done).toBe(false);
    expect(start.shelter.done).toBe(false);
    expect(start.fuel.done).toBe(false);
    expect(start.larder.progress).toBe(0);

    // WHEN stocks sit one short of their thresholds
    const t = DEFAULT_THRESHOLDS;
    const short = byKey({ ...fresh(), rations: t.larder - 1, firewood: t.fuel - 1, shelterWarmth: t.warmth - 0.01 });
    expect(short.larder.done).toBe(false);
    expect(short.fuel.done).toBe(false);
    expect(short.shelter.done).toBe(false);

    // WHEN they hit (or exceed) them
    const met = byKey({ ...fresh(), rations: t.larder * 3, firewood: t.fuel, shelterWarmth: t.warmth });
    // THEN they're done and progress never exceeds 1
    expect(met.larder.done).toBe(true);
    expect(met.fuel.done).toBe(true);
    expect(met.shelter.done).toBe(true);
    expect(met.larder.progress).toBe(1);
  });

  // 2. Body & mind needs both capacities ≥ baseline AND Condition ≥ threshold.
  it('requires both capacities at baseline and a sound reserve for body & mind', () => {
    // GIVEN a sound, baseline character → done
    expect(byKey(fresh()).body.done).toBe(true);
    // GIVEN Vigor capacity below baseline → not done
    expect(byKey({ ...fresh(), vitals: createVitals({ vigorCap: 99 }) }).body.done).toBe(false);
    // GIVEN Clarity capacity below baseline → not done
    expect(byKey({ ...fresh(), vitals: createVitals({ clarityCap: 99 }) }).body.done).toBe(false);
    // GIVEN a strained reserve → not done
    expect(byKey({ ...fresh(), vitals: createVitals({ condition: 69 }) }).body.done).toBe(false);
  });

  // 3. isWinterReady only when all four pillars are done.
  it('is winter-ready only when all four pillars are done', () => {
    const t = DEFAULT_THRESHOLDS;
    const all: ReadinessInput = { rations: t.larder, firewood: t.fuel, shelterWarmth: t.warmth, vitals: createVitals() };
    expect(isWinterReady(all)).toBe(true);
    // WHEN any single pillar is missing → not ready
    expect(isWinterReady({ ...all, rations: 0 })).toBe(false);
    expect(isWinterReady({ ...all, firewood: 0 })).toBe(false);
    expect(isWinterReady({ ...all, shelterWarmth: 0 })).toBe(false);
    expect(isWinterReady({ ...all, vitals: createVitals({ condition: 10 }) })).toBe(false);
  });

  // 4. Milestones latch: reported once, in order, and stay achieved.
  it('latches milestones once, in definition order, even if the predicate lapses', () => {
    type S = { a: boolean; b: boolean };
    const defs: MilestoneDef<S>[] = [
      { id: 'first', name: 'First', done: s => s.a },
      { id: 'second', name: 'Second', done: s => s.b },
    ];
    // WHEN both predicates become true at once
    const r1 = evaluateMilestones(defs, { a: true, b: true }, []);
    // THEN both are newly achieved, in definition order
    expect(r1.newlyAchieved).toEqual(['first', 'second']);
    // WHEN evaluated again with both predicates now false
    const r2 = evaluateMilestones(defs, { a: false, b: false }, r1.achieved);
    // THEN nothing is new, and both remain achieved
    expect(r2.newlyAchieved).toEqual([]);
    expect(r2.achieved).toEqual(['first', 'second']);
  });
});
