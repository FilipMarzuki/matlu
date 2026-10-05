/**
 * Acceptance tests for #1224 — run history and carrying knowledge forward
 * (criteria 1–3). Criterion 4 (controller recording + saves) is in
 * src/artificer-app/controller.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, choose, STARTING_RECIPES, type Region1State } from './region1';
import { summarizeRun, legacyOf, addRun, bestRun, HISTORY_CAP, type RunRecord } from './legacy';
import { DEFAULT_CALENDAR } from './winter';

/** A short run that learns something, then winters over badly on day 10. */
function finishedRun(): Region1State {
  let s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
  s = { ...s, stores: { ...s.stores, materials: 10, rawFood: 30, water: 30 } };
  s = runDay(s, ['build', 'track']).state; // roof (→ shovel), tracking (→ snare)
  s = runDay(s, [{ q: 'study', opts: { concept: 'sealing' } }]).state; // sealing 1 (→ waterskin, hide parka)
  while (s.day < DEFAULT_CALENDAR.caravanOpen) s = runDay(s, ['rest']).state;
  return choose(s, 'winter');
}

const rec = (run: number, kind: RunRecord['kind']): RunRecord => ({
  run, day: 10, choice: 'winter', kind, injury: null, readyDay: null, site: 'cave', tier: 1, shelterGrade: 'sound',
  shelterType: 'leanto', walls: null, tools: [], recipes: 5, milestones: 3, topConcept: null,
});

describe('Run history & legacy', () => {
  // 1. A resolved run summarises; an unresolved one can't.
  it('summarises a finished run', () => {
    const s = finishedRun();
    const r = summarizeRun(s, 3);
    expect(r).toMatchObject({ run: 3, day: 10, choice: 'winter', kind: 'grim', injury: null, readyDay: null, site: 'cave', tier: 1, shelterType: 'leanto' });
    expect(r.recipes).toBe(s.known.length);
    expect(r.milestones).toBe(s.milestones.length);
    expect(r.topConcept).toEqual({ id: 'sealing', rank: 1 });

    // The first winter-ready day comes from the journal.
    const readied = { ...s, log: [...s.log, { day: 7, text: 'Milestone — Winter-ready', kind: 'milestone' as const }] };
    expect(summarizeRun(readied, 1).readyDay).toBe(7);

    expect(() => summarizeRun(createRegion1(), 1)).toThrow(/not resolved/);
  });

  // 2. A new run from a legacy keeps recipes and concept ranks, and nothing else.
  it('carries knowledge, not stuff, into the next run', () => {
    const old = finishedRun();
    const legacy = legacyOf(old);
    expect(legacy.known).toEqual(expect.arrayContaining(['trap-snare', 'crude-shovel', 'waterskin', 'hide-parka']));
    expect(legacy.concepts.sealing).toBe(1);

    const next = createRegion1({}, legacy);
    expect(next.known).toEqual(expect.arrayContaining(legacy.known));
    expect(next.known.length).toBe(new Set(next.known).size); // no duplicates
    expect(next.concepts.sealing).toEqual({ rank: 1, insight: 0 });
    // Fresh in every other way.
    const fresh = createRegion1();
    expect(next.day).toBe(1);
    expect(next.vitals).toEqual(fresh.vitals);
    expect(next.stores).toEqual(fresh.stores);
    expect(next.explore).toEqual(fresh.explore);
    expect(next.tools).toEqual([]);
    expect(next.site).toBeNull();
    expect(next.log.at(-1)?.text).toMatch(/You carry what you learned/);
    // Without a legacy, only the starting recipes.
    expect(fresh.known).toEqual([...STARTING_RECIPES]);
    // And carried knowledge works at once: the snare is craftable before tracking anything.
    const scouted = { ...runAction(next, 'scout'), stores: { ...next.stores, materials: 5 } };
    expect(runAction(scouted, 'snare').tools.map(t => t.item)).toEqual(['trap-snare']);
  });

  // 3. History: newest first, capped; best run by outcome, earlier wins a tie.
  it('keeps a capped history and finds the best run', () => {
    let h: RunRecord[] = [];
    for (let i = 1; i <= HISTORY_CAP + 3; i++) h = addRun(h, rec(i, 'grim'));
    expect(h).toHaveLength(HISTORY_CAP);
    expect(h[0].run).toBe(HISTORY_CAP + 3);
    expect(h.at(-1)?.run).toBe(4);

    const mixed = [rec(5, 'wintered'), rec(4, 'crossed'), rec(3, 'ragged'), rec(2, 'grim')];
    expect(bestRun(mixed)?.run).toBe(4); // crossed and wintered tie; run 4 got there first
    expect(bestRun([rec(9, 'thrive'), ...mixed])?.kind).toBe('thrive');
    expect(bestRun([])).toBeNull();
  });
});
