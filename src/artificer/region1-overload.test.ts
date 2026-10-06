/**
 * Acceptance tests for #1292 — overload: over a comfortable load, the walk
 * home costs more, takes longer, and (for accidents, #1285) is riskier. One
 * test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, type Region1State } from './region1';
import { overloadWalk, overloadRisk, overloadWord, overloadRatio, overloadSlow, overloadDrain } from './load';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { STEADY_WORLD } from './test-helpers';
import { TRAVEL_HOURS } from './exploration';

const str = (n: number) => ({ ...DEFAULT_STATS, str: n });

/** A Warden with the far ring scouted, on a quiet autumn morning (full world, luck off). */
function farWarden(strength: number): Region1State {
  let s = chooseSite(runAction(createRegion1({ world: STEADY_WORLD }), 'scout'), 'cave');
  s = runAction({ ...s, hoursToday: 0, vitals: createVitals() }, 'scout@2');
  return { ...s, day: 5, hoursToday: 2, weatherToday: 'overcast', vitals: createVitals(), character: { ...s.character, stats: str(strength) }, today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false } };
}
const lines = (s: Region1State): string => s.log.map(l => l.text).join('\n');

describe('Overload (#1292)', () => {
  // 1. r = 2 on a ring-2 trip: the walk home costs 1.6× the Vigor and takes 1.3× as long.
  it('makes a laden walk home cost more and take longer', () => {
    const home = TRAVEL_HOURS[2] / 2, rate = -3;
    const { extraHours, extraVigor } = overloadWalk(2, home, rate);
    expect(home + extraHours).toBeCloseTo(home * 1.3, 10);
    expect(home * rate + extraVigor).toBeCloseTo(home * rate * 1.6, 10);
    expect(overloadSlow(2)).toBeCloseTo(1.3, 10);
    expect(overloadDrain(2)).toBeCloseTo(1.6, 10);
    // In play: the same far gather, by a strong Warden and a weak one. The weak one is overloaded,
    // so the walk home runs longer and costs more — and the journal says so.
    const strong = runAction(farWarden(10), 'gather@2');
    const weakStart = farWarden(1);
    const weak = runAction(weakStart, 'gather@2');
    const food = weak.stores.rawFood - weakStart.stores.rawFood;
    const r = overloadRatio({ rawFood: food }, undefined, str(1));
    expect(r).toBeGreaterThan(1);
    const extra = overloadWalk(r, TRAVEL_HOURS[2] / 2, -1).extraHours;
    expect(weak.hoursToday - strong.hoursToday).toBeCloseTo(extra, 10);
    expect(weak.vitals.vigor.current).toBeLessThan(strong.vitals.vigor.current);
    expect(lines(weak)).toMatch(/Walked home (with a heavy load|staggering under the load|barely able to carry it)/);
    expect(lines(strong)).not.toMatch(/Walked home/);
    // …and the overloaded hours build strain (#1293).
    expect(weak.strain ?? 0).toBeCloseTo((r - 1) * (TRAVEL_HOURS[2] / 2 + extra), 10);
    expect(strong.strain ?? 0).toBe(0);
  });

  // 2. At or under a comfortable load: no change.
  it('changes nothing at a comfortable load', () => {
    expect(overloadWalk(1, 3, -3)).toEqual({ extraHours: 0, extraVigor: 0 });
    expect(overloadWalk(0.5, 3, -3)).toEqual({ extraHours: 0, extraVigor: 0 });
    expect(overloadWord(1)).toBeNull();
    // The near ring has no walk home, so even a heavy near-ring haul costs nothing extra.
    const near = farWarden(1);
    expect(lines(runAction(near, 'gather'))).not.toMatch(/Walked home/);
  });

  // 3. r = 2: the accident risk is 2.5×.
  it('raises the accident risk with the load', () => {
    expect(overloadRisk(2)).toBeCloseTo(2.5, 10);
    expect(overloadRisk(1)).toBe(1);
    expect(overloadRisk(0.4)).toBe(1);
  });

  // 4. The journal grades the load.
  it('grades the load in the journal', () => {
    expect(overloadWord(1.3)).toBe('with a heavy load');
    expect(overloadWord(1.8)).toBe('staggering under the load');
    expect(overloadWord(2.3)).toBe('barely able to carry it');
  });
});
