/**
 * Acceptance tests for #1302 — winter is played: no autumn exits; the days go
 * on through winter and the run ends alive at the thaw, graded, or earlier
 * when the body gives out. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, winterOutlook, FIRE_WARMTH, survivalLockOf, warmth, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { DEFAULT_CALENDAR, gradeOf } from './winter';
import { nightTemp, coldNightNeeds } from './weather';
import { summarizeRun, bestRun, OUTCOME_RANK, type RunRecord } from './legacy';
import { parseDecision } from '../artificer-ai/decision';
import { deserializeHistory, serializeHistory } from '../artificer-app/controller';

const { winterDay, thawDay } = DEFAULT_CALENDAR;

/** A Warden in a warm, walled cave camp in the flat world, on `day`, with food and water to spare. */
function camped(day: number, over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world: FLAT_WORLD }), 'scout'), 'cave');
  return { ...s, day, hoursToday: 0, tier: 2, shelterGrade: 'sound', vitals: createVitals(), stores: { ...s.stores, rawFood: 5, water: 5 }, ...over };
}
const lines = (s: Region1State) => s.log.map(l => l.text).join('\n');

describe('Winter is played (#1302)', () => {
  // 1. No exits on days 10–12 (or ever): an exit in a reply is refused as invalid.
  it('offers no exits, and refuses one asked for', () => {
    const reply = (exit: string | null) => JSON.stringify({ thoughts: '', focus: null, site: null, exit, queue: [] });
    const asked = parseDecision(reply('caravan'));
    expect(asked.ok).toBe(false);
    expect(!asked.ok && asked.errors[0]).toMatch(/no exits/);
    expect(parseDecision(reply(null)).ok).toBe(true);
    // The days the caravan used to come are ordinary autumn days.
    for (const day of [10, 11, 12, 28]) expect(runDay(camped(day), ['rest']).state.outcome).toBeNull();
  });

  // 2. Alive at the end of day 60: survived, graded by Condition.
  it('ends the run at the thaw, graded hale, worn or broken', () => {
    const thaw = (condition: number) => runDay(camped(thawDay - 1, { vitals: createVitals({ condition }) }), ['rest']).state;
    const hale = thaw(90);
    expect(hale.day).toBe(thawDay);
    expect(hale.outcome).toMatchObject({ choice: 'thaw', kind: 'survived', grade: 'hale' });
    expect(lines(hale)).toMatch(/You made it through the winter/);
    expect(thaw(55).outcome).toMatchObject({ kind: 'survived', grade: 'worn' });
    expect(thaw(25).outcome).toMatchObject({ kind: 'survived', grade: 'broken' });
    expect(gradeOf(70)).toBe('hale');
    expect(gradeOf(69)).toBe('worn');
    expect(gradeOf(40)).toBe('worn');
    expect(gradeOf(39)).toBe('broken');
    expect(gradeOf(95, true)).toBe('broken');
    // Nothing more happens once it's over.
    expect(runDay(hale, ['rest']).state).toEqual(hale);
    // The record carries the grade.
    expect(summarizeRun(hale, 1)).toMatchObject({ day: thawDay, choice: 'thaw', kind: 'survived', grade: 'hale' });
  });

  // 3. Starving through winter: dead before the thaw.
  it('kills a Warden who starves through the winter', () => {
    let s = camped(winterDay + 5, { stores: { ...camped(1).stores, rawFood: 0, rations: 0, water: 0 }, vitals: createVitals({ condition: 50 }) });
    while (!s.outcome) s = runDay(s, ['rest']).state;
    expect(s.outcome).toMatchObject({ kind: 'died' });
    expect(s.day).toBeLessThan(thawDay);
    expect(runDay(s, ['rest']).state).toEqual(s);
  });

  // 4. The winter outlook: food, fuel and warmth at the rates the nights use.
  it('reports a winter outlook from the nights’ own rates', () => {
    const s = camped(40, { stores: { ...camped(1).stores, rawFood: 5, rations: 7, water: 3, firewood: 10 } });
    const o = winterOutlook(s);
    expect(o.foodDays).toBe(12);
    expect(o.waterDays).toBe(3);
    // The flat world needs no fire (#1303), so the woodpile lasts to the thaw.
    expect(o.fuelDays).toBe(thawDay - 40);
    expect(o.fuelToThaw).toBe(0);
    expect(o.warmthMargin).toBeCloseTo(warmth(s) + FIRE_WARMTH - coldNightNeeds(nightTemp(winterDay + 14, 'clear')), 10);
    expect(o.nightsToThaw).toBe(thawDay - 40);
    // The rates are the nights' own: raw food first, then a ration.
    const night = runDay({ ...s, stores: { ...s.stores, rawFood: 0, rations: 2 } }, ['rest']).state;
    expect(night.stores.rations).toBe(1);
    expect(night.deprivation.hungry).toBe(0);
    const fresh = runDay({ ...s, stores: { ...s.stores, rawFood: 1, rations: 2 } }, ['rest']).state;
    expect(fresh.stores).toMatchObject({ rawFood: 0, rations: 2 });
  });

  // 5. Old run records still load and show.
  it('loads run history with the old outcomes', () => {
    const old = { run: 1, day: 10, choice: 'caravan', kind: 'thrive', injury: null, readyDay: 8, site: 'cave', tier: 1, shelterGrade: 'sound', shelterType: 'hut', walls: null, tools: [], recipes: 5, milestones: 9, topConcept: null } as RunRecord;
    const loaded = deserializeHistory(serializeHistory([old]));
    expect(loaded).toEqual([old]);
    // Surviving the winter outranks every old exit.
    const survived = { ...old, run: 2, day: thawDay, choice: 'thaw', kind: 'survived', grade: 'worn' } as RunRecord;
    expect(bestRun([old, survived])).toBe(survived);
    expect(Math.max(...Object.values(OUTCOME_RANK))).toBe(OUTCOME_RANK.survived);
  });

  // 6. The first snow is marked, and the run goes on.
  it('marks the first snow and keeps going', () => {
    const s = runDay(camped(winterDay - 1), ['rest']).state;
    expect(s.day).toBe(winterDay);
    expect(s.outcome).toBeNull();
    expect(lines(s)).toMatch(/Winter has come — hold on until the thaw/);
    // Winter days play like any other.
    expect(runDay(s, ['rest']).state.day).toBe(winterDay + 1);
  });

  // The "winter is close" lock covers the last three days of autumn, not the whole winter.
  it('locks to survival only in the last days of autumn', () => {
    const unready = (day: number) => camped(day, { stores: { ...camped(1).stores, rations: 0 } });
    expect(survivalLockOf(unready(winterDay - 4))).toBeNull();
    expect(survivalLockOf(unready(winterDay - 3))).toBe('winter is close');
    expect(survivalLockOf(unready(winterDay - 1))).toBe('winter is close');
    expect(survivalLockOf(unready(winterDay))).toBeNull();
    expect(survivalLockOf(unready(winterDay + 10))).toBeNull();
  });
});
