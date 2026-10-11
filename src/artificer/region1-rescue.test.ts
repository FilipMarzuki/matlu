/**
 * Acceptance tests for #1323 — a collapse alone in the wilderness is death:
 * only the spring caravan, when it's close, can find a collapsed Warden. One
 * test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, RESCUE_WITHIN, type Region1State } from './region1';
import { createVitals } from './vitality';

/** A fed and watered Warden in a cave camp on `day`, at Condition 0: tonight they collapse. */
function spent(day: number): Region1State {
  const s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
  return { ...s, day, hoursToday: 0, vitals: createVitals({ condition: 0 }), stores: { ...s.stores, rawFood: 5, water: 5, firewood: 30 } };
}
const last = (s: Region1State): string => s.log.at(-1)?.text ?? '';

describe('Collapse in the wilderness (#1323)', () => {
  // 1. Autumn, nobody near: a bear finds you.
  it('kills a Warden who collapses in autumn — a bear finds them', () => {
    const s = endDay(spent(20));
    expect(s.outcome).toMatchObject({ kind: 'died', choice: 'collapse' });
    expect(last(s)).toMatch(/bear finds you/);
  });

  // 2. Winter, nobody comes: the wolves find you.
  it('kills a Warden who collapses in winter — the wolves find them', () => {
    const s = endDay(spent(45));
    expect(s.outcome).toMatchObject({ kind: 'died', choice: 'collapse' });
    expect(last(s)).toMatch(/wolves find you/);
  });

  // 3. The caravan three days off: its traders find you, and you go on.
  it('lets the spring caravan find a Warden who collapses close to the thaw', () => {
    expect(RESCUE_WITHIN).toBe(3);
    const s = endDay(spent(58));
    expect(s.outcome).toMatchObject({ kind: 'collapsed', choice: 'collapse' });
    expect(last(s)).toMatch(/caravan's traders/);
    // A day earlier, the caravan is still too far off.
    expect(endDay(spent(57)).outcome?.kind).toBe('died');
  });

  // 4. A collapse no one finds is death.
  it('ends the run in death after a collapse no one finds', () => {
    expect(endDay(spent(45)).outcome?.kind).toBe('died');
  });
});
