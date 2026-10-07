/**
 * Acceptance tests for #1409 — injuries, part 5: pain, the felt signal. It aches at rest, sharpens
 * when you work through a serious or grave injury, and costs a little of the mind when sharp.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, queueHours, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { injure, type Injury } from './injuries';
import { painOf, restingPain, PAIN_DRAIN, PAIN_HOURS, PAIN_NIGHT } from './pain';
import { observe } from '../artificer-ai/observe';

/** A sheltered, stocked Warden in the flat world (no accidents, so nothing worsens by chance). */
function settled(injuries?: Injury[], over: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-pain' });
  return {
    ...s, explore: scout(createExploration(), 1), tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' },
    stores: { ...s.stores, rawFood: 9, water: 9, firewood: 30 }, vitals: createVitals({ clarity: 60 }), character: { ...s.character, talents: [], quirks: [] },
    ...(injuries ? { injuries } : {}), ...over,
  };
}
const said = (s: Region1State, re: RegExp) => s.log.some(l => re.test(l.text));

describe('Pain (#1409)', () => {
  // 1. A serious untreated sprain: an ache at rest, sharp after felling wood — and the journal says so.
  it('sharpens when you work through a serious injury', () => {
    const s = settled([injure('sprain', 'serious')]);
    expect(painOf(s)).toBe(1);
    expect(painOf(runAction(s, 'rest'))).toBe(1);
    const felled = runAction(s, 'wood');
    expect(painOf(felled)).toBe(2);
    expect(said(felled, /Pain shoots through your ankle — it's sharp now\./)).toBe(true);
    // It stays sharp for the rest of the day, and the next morning it's back to an ache.
    expect(painOf(runAction(felled, 'rest'))).toBe(2);
    expect(painOf(runDay(felled, []).state)).toBe(1);
    // The AI feels it too.
    expect(observe(felled)).toMatch(/PAIN: sharp — work drains your mind 1.1x, and tonight will cost 2 Clarity \(worse for the work you did today\)/);
  });

  // 2. A treated serious sprain, or a minor one: felling doesn't make it worse.
  it("doesn't spike for a treated or a minor injury", () => {
    const treated = settled([{ ...injure('sprain', 'serious'), treated: 'fair' }]);
    expect(painOf(treated)).toBe(0);
    expect(painOf(runAction(treated, 'wood'))).toBe(0);
    const minor = settled([injure('sprain', 'minor')]);
    expect(painOf(minor)).toBe(1);
    expect(painOf(runAction(minor, 'wood'))).toBe(1);
    expect(restingPain([{ ...injure('sprain', 'minor'), treated: 'good' }])).toBe(0);
    // Work that doesn't strain it doesn't hurt more: a sprain doesn't mind the bench.
    expect(painOf(runAction(settled([injure('sprain', 'serious')]), 'rest'))).toBe(1);
  });

  // 3. A grave sprain: sharp at rest, agony when strained.
  it('makes a grave injury sharp at rest, and agony when strained', () => {
    const s = settled([injure('sprain', 'grave')]);
    expect(painOf(s)).toBe(2);
    const pushed = runAction(s, 'wood');
    expect(painOf(pushed)).toBe(3);
    expect(said(pushed, /Agony — your ankle screams at every step/)).toBe(true);
  });

  // 4. Sharp: work drains the mind ×1.1 and the night costs 2 Clarity; agony ×1.25, ×1.1 hours, 5 Clarity.
  it('costs a little of the mind when sharp, and more in agony', () => {
    const at = (pain: 0 | 2 | 3) => settled(undefined, { today: { ...settled().today, pain } });
    const used = (s: Region1State) => s.vitals.clarity.current - runAction(s, 'wood').vitals.clarity.current;
    expect(used(at(2))).toBeCloseTo(used(at(0)) * PAIN_DRAIN[2], 5);
    // In agony the work also takes longer, so the drain compounds: ×1.25 an hour over ×1.1 the hours.
    expect(used(at(3))).toBeCloseTo(used(at(0)) * PAIN_DRAIN[3] * PAIN_HOURS[3], 5);
    expect(queueHours('wood', at(3))).toBeCloseTo(queueHours('wood', at(0)) * PAIN_HOURS[3], 10);
    expect(runAction(at(3), 'wood').hoursToday).toBeCloseTo(runAction(at(0), 'wood').hoursToday * PAIN_HOURS[3], 10);
    const night = (s: Region1State) => runDay(s, []).state.vitals.clarity.current;
    expect(night(at(2))).toBe(night(at(0)) - PAIN_NIGHT[2]);
    expect(night(at(3))).toBe(night(at(0)) - PAIN_NIGHT[3]);
    expect(said(runDay(settled([injure('sprain', 'grave')]), []).state, /Your ankle throbs all night/)).toBe(true);
  });

  // 5. No injuries: no pain, and nothing changes.
  it('changes nothing without injuries', () => {
    const s = settled();
    expect(painOf(s)).toBe(0);
    expect(painOf(runAction(s, 'wood'))).toBe(0);
    expect(observe(s)).not.toMatch(/PAIN:/);
  });
});
