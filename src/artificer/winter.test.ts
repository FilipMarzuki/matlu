/**
 * Acceptance tests for #1206 — winter calendar, caravan window + exit outcomes.
 * One test per Given/When/Then criterion (1–5) in the issue.
 */

import { describe, it, expect } from 'vitest';
import { phaseOf, availableChoices, resolveOutcome, crossingPrepared, DEFAULT_CALENDAR, PENALTY } from './winter';
import { createVitals, CAP_FLOOR } from './vitality';

const cal = DEFAULT_CALENDAR; // caravan 10–12, winter 13

describe('Winter', () => {
  // 1. phaseOf boundaries.
  it('moves prep → caravan → postCaravan → winter on the right days', () => {
    expect(phaseOf(1)).toBe('prep');
    expect(phaseOf(cal.caravanOpen - 1)).toBe('prep');
    expect(phaseOf(cal.caravanOpen)).toBe('caravan');
    expect(phaseOf(cal.caravanClose)).toBe('caravan');
    // A calendar with a gap between the caravan leaving and the snow:
    const gap = { caravanOpen: 10, caravanClose: 11, winterDay: 14, thawDay: 44 };
    expect(phaseOf(12, gap)).toBe('postCaravan');
    expect(phaseOf(cal.winterDay)).toBe('winter');
    expect(phaseOf(40)).toBe('winter');
  });

  // 2. Exits per phase.
  it('offers no exits while preparing, three in the window, two after', () => {
    expect(availableChoices(5)).toEqual([]);
    expect(availableChoices(cal.caravanOpen)).toEqual(['caravan', 'solo', 'winter']);
    expect(availableChoices(cal.caravanClose + 1)).toEqual(['solo', 'winter']);
    expect(availableChoices(cal.winterDay + 3)).toEqual(['solo', 'winter']);
  });

  // 3. Caravan: ready thrives, unready leaves ragged.
  it('lets a ready Warden thrive with the caravan and an unready one leave ragged', () => {
    const vitals = createVitals();
    expect(resolveOutcome('caravan', { ready: true, canCross: false, vitals }).kind).toBe('thrive');
    expect(resolveOutcome('caravan', { ready: false, canCross: false, vitals }).kind).toBe('ragged');
  });

  // 4. Solo: prepared crosses; unprepared turns back with permanent frostbite.
  it('lets a prepared Warden cross alone, and turns an unprepared one back with frostbite', () => {
    const vitals = createVitals();
    // GIVEN the prep gate
    expect(crossingPrepared({ coldGear: true, rations: 6, vitals })).toBe(true);
    expect(crossingPrepared({ coldGear: false, rations: 6, vitals })).toBe(false);
    expect(crossingPrepared({ coldGear: true, rations: 5, vitals })).toBe(false);

    // WHEN prepared → crossed, no injury, capacities intact
    const ok = resolveOutcome('solo', { ready: false, canCross: true, vitals });
    expect(ok.kind).toBe('crossed');
    expect(ok.injury).toBeUndefined();

    // WHEN unprepared → turned back, frostbite, capacities permanently lowered
    const bad = resolveOutcome('solo', { ready: false, canCross: false, vitals });
    expect(bad.kind).toBe('turnedBack');
    expect(bad.injury).toBe('frostbite');
    expect(bad.vitals.vigor.cap).toBe(100 - PENALTY.frostbite.vigorCap);
    expect(bad.vitals.clarity.cap).toBe(100 - PENALTY.frostbite.clarityCap);
    // and the input wasn't mutated
    expect(vitals.vigor.cap).toBe(100);
  });

  // 5. Winter over: ready → wintered; unready → grim, never below the floor.
  it('winters a ready Warden well and an unready one grimly, never below the floor', () => {
    expect(resolveOutcome('winter', { ready: true, canCross: false, vitals: createVitals() }).kind).toBe('wintered');

    const grim = resolveOutcome('winter', { ready: false, canCross: false, vitals: createVitals() });
    expect(grim.kind).toBe('grim');
    expect(grim.vitals.condition).toBe(100 - PENALTY.grim.condition);
    expect(grim.vitals.vigor.cap).toBe(100 - PENALTY.grim.vigorCap);

    // GIVEN a Warden already at the capacity floor
    const worn = resolveOutcome('winter', { ready: false, canCross: false, vitals: createVitals({ vigorCap: CAP_FLOOR, clarityCap: CAP_FLOOR, condition: 5 }) });
    expect(worn.vitals.vigor.cap).toBe(CAP_FLOOR);
    expect(worn.vitals.clarity.cap).toBe(CAP_FLOOR);
    expect(worn.vitals.condition).toBe(0);
  });
});
