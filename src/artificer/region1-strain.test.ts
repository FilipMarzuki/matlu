/**
 * Acceptance tests for #1293 — strain: overloaded hours build it, it spoils
 * the night's recovery and halves each night, and waking with 3+ leaves the
 * Warden exhausted for the day. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, endDay, chooseSite, type Region1State } from './region1';
import { strainFrom, strainRecovery, EXHAUSTED_AT, EXHAUSTED_DRAIN } from './load';
import { createVitals } from './vitality';
import { growthFor } from './talents';
import { FLAT_WORLD } from './world';

/** A fed, watered, camped Warden on the flat world (no weather, luck or carrying noise), with `strain`. */
function camped(strain = 0, over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world: FLAT_WORLD }), 'scout'), 'cave');
  return { ...s, day: 5, hoursToday: 0, tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' }, vitals: createVitals({ vigor: 40 }), stores: { ...s.stores, rawFood: 20, water: 20, firewood: 20 }, strain, today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false }, ...over };
}
const vigorAfterNight = (s: Region1State): number => endDay(s).vitals.vigor.current;
const lines = (s: Region1State): string => s.log.map(l => l.text).join('\n');

describe('Strain (#1293)', () => {
  // 1. A 5-hour haul at r = 1.6 adds 3 strain.
  it('builds strain from overloaded hours', () => {
    expect(strainFrom(1.6, 5)).toBeCloseTo(3, 10);
    expect(strainFrom(1, 5)).toBe(0);
  });

  // 2. Strain 3: the night's Vigor recovery is 0.7×, and strain halves to 1.5.
  it('spoils the night’s recovery, and halves overnight', () => {
    expect(strainRecovery(3)).toBeCloseTo(0.7, 10);
    expect(strainRecovery(9)).toBe(0.5); // never worse than half
    const base = camped(0);
    const gainFresh = vigorAfterNight(base) - 40;
    const gainStrained = vigorAfterNight(camped(3)) - 40;
    expect(gainStrained).toBeLessThan(gainFresh);
    expect(endDay(camped(3)).strain).toBeCloseTo(1.5, 10);
  });

  // 3. Strain ≥ 3 at dawn: exhausted — the day's work drains 1.15×, and the journal says so.
  it('leaves the Warden exhausted after a night still strained', () => {
    expect(EXHAUSTED_AT).toBe(3);
    const woke = endDay(camped(6)); // 6 → 3 overnight: still 3 at dawn
    expect(woke.today.exhausted).toBe(true);
    expect(lines(woke)).toMatch(/Your back aches from yesterday's loads\./);
    // The same work, exhausted or not: 1.15× the drain.
    const fresh = { ...woke, today: { ...woke.today, exhausted: false }, vitals: createVitals() };
    const tired = { ...woke, vitals: createVitals() };
    const used = (s: Region1State) => 100 - runAction(s, 'wood').vitals.vigor.current;
    expect(used(tired)).toBeCloseTo(used(fresh) * EXHAUSTED_DRAIN, 6);
    expect(endDay(camped(4)).today.exhausted ?? false).toBe(false); // 4 → 2: fine
  });

  // 4. Heavy days in a row keep strain high; two light days bring it back under 1.
  it('grinds a Warden down over heavy days, and lets two light days restore them', () => {
    let s = camped(0);
    const strains: number[] = [];
    for (let d = 0; d < 3; d++) { s = endDay({ ...s, strain: (s.strain ?? 0) + 4 }); strains.push(s.strain ?? 0); }
    expect(strains).toEqual([2, 3, 3.5]);
    expect(s.today.exhausted).toBe(true);
    for (let d = 0; d < 2; d++) s = runDay(s, ['rest']).state;
    expect(s.strain ?? 0).toBeLessThan(1);
    // Strain counts as a worn-down night for Tough (#1264).
    expect(growthFor('tough', { kind: 'night', hungry: false, cold: false, condition: 90, strained: true })).toBeGreaterThan(0);
    expect(growthFor('tough', { kind: 'night', hungry: false, cold: false, condition: 90 })).toBe(0);
  });

  // 5. No strain: nothing changes.
  it('changes nothing without strain', () => {
    expect(strainRecovery(0)).toBe(1);
    const a = endDay(camped(0)), b = endDay({ ...camped(0), strain: undefined });
    expect(a.vitals).toEqual(b.vitals);
    expect(a.today.exhausted ?? false).toBe(false);
    expect(lines(a)).not.toMatch(/back aches/);
  });
});
