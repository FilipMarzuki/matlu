/**
 * Acceptance tests for #1473 — the winter wall. Llama planned a median 5 of the day's 14 hours
 * and froze around day 30. The harness now asks once about a plan that leaves most of the day idle,
 * as an empty hour bar would show a person.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, queueHours, DAY_HOURS, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { SHORT_YEAR } from '../artificer/test-helpers';
import { playRun, fillQuestion, plannedHours, BudgetExceeded, FILL_MIN_HOURS, type Player, type SpendLedger } from './runner';
import { RULES } from './observe';

const json = (o: unknown): string => JSON.stringify(o);
const plan = (actions: string[], extra: object = {}): string =>
  json({ thoughts: '', focus: null, site: null, ...extra, queue: actions.map(action => ({ action, ring: 1, options: [] })) });
/** One 2-hour action: the short day. */
const SHORT = plan(['water']);
const FULL = plan(['water', 'wood', 'gather']);
/** Rest days after day 1: never asked about, so day 1 is the only day that can be. */
const REST = plan(['rest']);
const isQuestion = (m: string) => /^Your plan for day \d+ fills about/.test(m);

/** Day 1 plans `first`; a question gets `answer`; every later day rests. Each call may report a cost. */
function player(first: string, answer = FULL, cost = 0): Player & { seen: string[] } {
  const seen: string[] = [];
  return {
    name: 'planner', seen,
    async decide(message) {
      seen.push(message);
      const text = isQuestion(message) ? answer : seen.filter(m => !isQuestion(m)).length === 1 ? first : REST;
      return { text, usage: { cost } };
    },
  };
}
const ON = { calendar: SHORT_YEAR, planning: 'open' as const, fillDay: true };

/** A fresh Warden on day 1 in clear weather, so hours are the actions' own. */
function fresh(over: Partial<Region1State> = {}): Region1State {
  return { ...createRegion1({ calendar: SHORT_YEAR }), weatherToday: 'clear', ...over };
}

describe('A short day is asked about once (#1473)', () => {
  // 1. One 2-hour action on a fresh day: asked once, naming the hours; the fuller plan runs.
  it('asks once, and runs the fuller plan', async () => {
    const p = player(SHORT);
    const run = await playRun(p, ON);
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

  // 2. A plan of 8 hours or more: no question.
  it('asks nothing about a full plan', async () => {
    const p = player(FULL);
    const run = await playRun(p, ON);
    expect(p.seen.some(isQuestion)).toBe(false);
    expect(run.turns[0].fill).toBeUndefined();
  });

  // 3. A short plan with rest in it is a light day on purpose; under half Vigor, a short day is sense.
  it('asks nothing about a short plan with rest in it', async () => {
    const p = player(plan(['water', 'rest']));
    const run = await playRun(p, ON);
    expect(p.seen.some(isQuestion)).toBe(false);
    expect(run.turns[0].queue).toEqual(['water', 'rest']);
  });

  it('asks nothing of a Warden under half Vigor', () => {
    expect(fillQuestion(fresh(), ['water'])).not.toBeNull();
    expect(fillQuestion(fresh({ vitals: createVitals({ vigor: 40 }) }), ['water'])).toBeNull();
  });

  // 4. An answer that won't parse costs nothing: the first plan runs, with no retry, and the model is told.
  it('runs the first plan when the answer is invalid, and says so', async () => {
    const p = player(SHORT, 'not json');
    const run = await playRun(p, ON);
    expect(p.seen.filter(isQuestion)).toHaveLength(1);
    expect(p.seen.some(m => m.startsWith('Your reply was invalid'))).toBe(false);
    const t = run.turns[0];
    expect(t.queue).toEqual(['water']);
    expect(t.fill!.planned).toBeLessThan(FILL_MIN_HOURS);
    expect(t.fill).toEqual({ planned: t.fill!.planned, then: t.fill!.planned, invalid: true });
    // The next day's view carries the note.
    expect(p.seen[2]).toMatch(/Your answer about day 1's short plan was invalid .*, so your first plan ran\./);
  });

  // 5. Off unless asked for: the baselines and the tests play as before.
  it('asks nothing without fillDay', async () => {
    const p = player(SHORT);
    const run = await playRun(p, { calendar: SHORT_YEAR, planning: 'open' });
    expect(p.seen.some(isQuestion)).toBe(false);
    expect(run.turns[0].queue).toEqual(['water']);
    expect(run.turns[0].fill).toBeUndefined();
  });

  // Self-review: the hours are the app's TODAY bar — a refused action fills none of the day.
  it('counts a refused action as no hours, as the hour bar does', () => {
    const s = fresh();
    expect(plannedHours(s, ['water'])).toBe(queueHours('water', s));
    // No site chosen: the build is refused, so the day is still a 2-hour one.
    expect(plannedHours(s, ['water', 'build'])).toBe(plannedHours(s, ['water']));
    expect(fillQuestion(s, ['water', 'build'])).not.toBeNull();
    // Hours already spent today count: 6 used + water is 8.
    expect(fillQuestion({ ...s, hoursToday: 6 }, ['water'])).toBeNull();
    // An empty plan at full Vigor is the shortest of all.
    expect(fillQuestion(s, [])!.text).toMatch(/fills about 0 of/);
  });

  // Self-review: the answer's queue replaces the plan; what the answer leaves unset keeps the first reply's.
  it('keeps the first reply’s eating plan when the answer leaves it unset', async () => {
    const run = await playRun(player(plan(['water'], { eating: 'half' })), ON);
    expect(run.turns[0].queue).toEqual(['water', 'wood', 'gather']);
    expect(run.turns[0].journal).toContain('You put yourself on half rations — a meal every other night.');
  });

  // Self-review: the question is optional, so a spent budget skips it and the paid plan runs.
  it('skips the question once the budget is spent', async () => {
    const ledger: SpendLedger = { spent: 0, budget: 1 };
    const p = player(SHORT, FULL, 1);
    const err = await playRun(p, { ...ON, ledger }).catch(e => e);
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(p.seen.some(isQuestion)).toBe(false);
    // Day 1's paid plan ran; the run stopped before day 2's call.
    expect((err as BudgetExceeded).partial.turns[0].queue).toEqual(['water']);
  });

  it('tells the model that unplanned hours are lost', () => {
    expect(RULES).toMatch(/Hours you don't plan are lost/);
    expect(RULES).toMatch(/preserve with method dry 2h/);
  });
});
