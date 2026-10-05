/**
 * Acceptance tests for #1234 — Condition hitting 0 ends the run: death when
 * deprived (thirst / starvation), otherwise found collapsed.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { summarizeRun, bestRun, canContinue, type RunRecord } from './legacy';

function camp(over: Partial<Region1State> = {}): Region1State {
  let s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
  s = runAction({ ...s, stores: { ...s.stores, materials: 20 } }, 'build');
  return { ...s, today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false }, ...over };
}

describe('Collapse and death (#1234)', () => {
  it('kills by thirst after four dry nights from full health', () => {
    let s = camp({ vitals: createVitals({ condition: 100 }) });
    for (let n = 1; n <= 4; n++) {
      expect(s.outcome).toBeNull();
      s = endDay({ ...s, stores: { ...s.stores, rawFood: 5, water: 0 } });
    }
    expect(s.outcome).toMatchObject({ kind: 'died', choice: 'collapse' });
    expect(s.log.at(-1)?.text).toMatch(/thirst/i);
  });

  it('ends a worn-out but fed and watered Warden as collapsed, not dead', () => {
    const s = endDay(camp({ vitals: createVitals({ condition: 0 }), stores: { ...camp().stores, rawFood: 5, water: 5 } }));
    expect(s.outcome).toMatchObject({ kind: 'collapsed', choice: 'collapse' });
    expect(s.log.at(-1)?.text).toMatch(/collapse/i);
  });

  it('carries on while Condition stays above 0', () => {
    const s = endDay(camp({ vitals: createVitals({ condition: 30 }), stores: { ...camp().stores, rawFood: 5, water: 0 } }));
    expect(s.vitals.condition).toBeGreaterThan(0);
    expect(s.outcome).toBeNull();
  });

  it('ranks death below collapse below a grim winter, and ends the character (#1242)', () => {
    let s = camp({ vitals: createVitals({ condition: 10 }), known: [...camp().known, 'snare'] });
    s = endDay({ ...s, stores: { ...s.stores, water: 0 }, deprivation: { hungry: 0, thirsty: 1 } });
    expect(s.outcome?.kind).toBe('died');
    const rec = summarizeRun(s, 1);
    expect(rec).toMatchObject({ kind: 'died', choice: 'collapse' });
    const grim = { ...rec, run: 2, kind: 'grim', choice: 'winter' } as RunRecord;
    const collapsed = { ...rec, run: 3, kind: 'collapsed' } as RunRecord;
    expect(bestRun([rec, collapsed])?.kind).toBe('collapsed');
    expect(bestRun([rec, collapsed, grim])?.kind).toBe('grim');
    // Death ends the character: nothing can be carried on from it (#1242).
    expect(canContinue(s)).toBe(false);
  });
});
