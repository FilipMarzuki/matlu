/**
 * Acceptance tests for #1473 — the winter wall. Llama planned a median 5 of the day's 14 hours
 * and froze around day 30. The harness now asks once about a plan that leaves most of the day idle,
 * as an empty hour bar would show a person.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, queueHours, DAY_HOURS, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { SHORT_YEAR } from '../artificer/test-helpers';
import { playRun, fillQuestion, FILL_MIN_HOURS, type Player } from './runner';
import { RULES } from './observe';

const json = (o: unknown): string => JSON.stringify(o);
const day = (actions: string[]): string => json({ thoughts: '', focus: null, site: null, queue: actions.map(action => ({ action, ring: 1, options: [] })) });
const SHORT = day(['water']);
const FULL = day(['water', 'wood', 'gather']);
/** Rest days after day 1: never asked about, so day 1 is the only question. */
const REST = day(['rest']);
const isQuestion = (m: string) => /^Your plan for day \d+ fills about/.test(m);

/** Day 1 is short; the question gets `answer`; every later day rests. */
function shortThenRest(answer: string): Player & { seen: string[] } {
  const seen: string[] = [];
  return {
    name: 'short-planner', seen,
    async decide(message) {
      seen.push(message);
      if (isQuestion(message)) return { text: answer };
      return { text: seen.filter(m => !isQuestion(m)).length === 1 ? SHORT : REST };
    },
  };
}

/** A fresh Warden on day 1 in clear weather, so hours are the actions' own. */
function fresh(over: Partial<Region1State> = {}): Region1State {
  return { ...createRegion1({ calendar: SHORT_YEAR }), weatherToday: 'clear', ...over };
}

describe('A short day is asked about once (#1473)', () => {
  // 1. One 2-hour action on a fresh day: asked once, naming the hours; the fuller plan runs.
  it('asks once, and runs the fuller plan', async () => {
    const p = shortThenRest(FULL);
    const run = await playRun(p, { calendar: SHORT_YEAR, planning: 'open', fillDay: true });
    const questions = p.seen.filter(isQuestion);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatch(new RegExp(`fills about \\d+ of the ${DAY_HOURS} waking hours, leaving \\d+ idle`));
    const t = run.turns[0];
    expect(t.queue).toEqual(['water', 'wood', 'gather']);
    expect(t.fill!.planned).toBeLessThan(FILL_MIN_HOURS);
    expect(t.fill!.then).toBeGreaterThanOrEqual(FILL_MIN_HOURS);
    // Rest days are never asked about.
    expect(run.turns.slice(1).some(x => x.fill)).toBe(false);
  });

  // 2–3. The question itself: only for a short plan, with no rest in it, and Vigor to spare.
  it('asks only about a short plan with Vigor to spare and no rest', () => {
    const s = fresh();
    const hours = (q: string[]) => q.reduce((h, a) => h + queueHours(a as never, s), 0);
    expect(hours(['scout', 'wood'])).toBeGreaterThanOrEqual(FILL_MIN_HOURS);
    expect(fillQuestion(s, ['scout', 'wood'], 1)).toBeNull();
    const q = fillQuestion(s, ['water'], 1)!;
    const w = Math.round(hours(['water']));
    expect(q).toContain(`fills about ${w} of the ${DAY_HOURS} waking hours, leaving ${DAY_HOURS - w} idle`);
    expect(q).toMatch(/Vigor \d+\/\d+/);
    // An empty plan at full Vigor is the shortest of all.
    expect(fillQuestion(s, [], 1)).toMatch(/fills about 0 of/);
    // A rest in the plan means a light day on purpose.
    expect(fillQuestion(s, ['water', 'rest'], 1)).toBeNull();
    // Under half Vigor, a short day is sense, not waste.
    expect(fillQuestion({ ...s, vitals: createVitals({ vigor: 40 }) }, ['water'], 1)).toBeNull();
    // Hours already spent today count: 6 used + water is 8.
    expect(fillQuestion({ ...s, hoursToday: 6 }, ['water'], 1)).toBeNull();
  });

  // 4. An answer that won't parse costs nothing: the first plan runs.
  it('runs the first plan when the answer is invalid', async () => {
    const run = await playRun(shortThenRest('not json'), { calendar: SHORT_YEAR, planning: 'open', fillDay: true });
    const t = run.turns[0];
    expect(t.queue).toEqual(['water']);
    expect(t.fill).toEqual({ planned: t.fill!.planned, then: t.fill!.planned });
  });

  // 5. Off unless asked for: the baselines and the tests play as before.
  it('asks nothing without fillDay', async () => {
    const p = shortThenRest(FULL);
    const run = await playRun(p, { calendar: SHORT_YEAR, planning: 'open' });
    expect(p.seen.some(isQuestion)).toBe(false);
    expect(run.turns[0].queue).toEqual(['water']);
    expect(run.turns[0].fill).toBeUndefined();
  });

  it('tells the model that unplanned hours are lost', () => {
    expect(RULES).toMatch(/Hours you don't plan are lost/);
  });
});
