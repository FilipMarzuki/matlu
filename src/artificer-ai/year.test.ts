/**
 * Acceptance tests for #1309 — the AI harness plays the whole year: the
 * scripted baseline survives the winter, the AI sets the ration plan, exits
 * are invalid, and the report shows how each model fares against the winter.
 * One test per Given/When/Then scenario. No network.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1 } from '../artificer/region1';
import { SHORT_YEAR } from '../artificer/test-helpers';
import { progressOf } from './progress';
import { playRun, type Player } from './runner';
import { scriptedPlayer } from './players/scripted';
import { aggregate, deathCause, type Transcript } from './report';
import { ROSTER, budgetAdvice, perYear } from './roster';

const json = (o: unknown): string => JSON.stringify(o);

describe('The AI plays the whole year (#1309)', () => {
  // 1. The scripted baseline reaches the thaw on at least 16 of seeds 1–20.
  it('brings the scripted baseline through the winter on most seeds', async () => {
    let thaw = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = await playRun(scriptedPlayer(), { characterId: `ai-scripted-s${seed}-r1` });
      if (r.record.kind === 'survived') thaw++;
      expect(r.turns.some(t => t.invalid)).toBe(false);
    }
    expect(thaw).toBeGreaterThanOrEqual(16);
  }, 120_000);

  // 2. A reply that sets half rations: the next night eats half.
  it('lets a reply set the ration plan, and the night eats by it', async () => {
    const plans: (string | undefined)[] = [];
    const player: Player = {
      name: 'rationer',
      async decide(_m, s) {
        plans.push(s.eating);
        return { text: json({ thoughts: 'stretch it', focus: null, eating: 'half', site: null, queue: [{ action: 'water', ring: 1, options: [] }] }) };
      },
    };
    const r = await playRun(player, { calendar: SHORT_YEAR });
    expect(plans.slice(0, 2)).toEqual([undefined, 'half']); // set on day 1, in force from then on
    expect(r.final.eating).toBe('half');
    // Day 1 is odd: half rations skip that night — a lean night, not a hungry one.
    expect(r.turns[0].journal).toContain('Half rations — a lean night.');
  });

  // 3. A reply with an exit is invalid, and the day passes.
  it('counts a reply with an exit as invalid, and passes the day', async () => {
    const player: Player = { name: 'leaver', async decide() { return { text: json({ thoughts: 'leaving', focus: null, site: null, exit: 'caravan', queue: [] }) }; } };
    const r = await playRun(player, { calendar: SHORT_YEAR });
    expect(r.turns.slice(0, 2).map(t => [t.day, t.invalid])).toEqual([[1, true], [2, true]]);
    expect(r.turns.every(t => t.invalid)).toBe(true);
    expect(r.turns[0].errors?.join(' ')).toMatch(/no exits/);
    // Nothing done, day after day: the run ends — of thirst, long before any exit could have come.
    expect(r.record).toMatchObject({ kind: 'died' });
  });

  // The safety stop: a run that somehow doesn't resolve throws instead of looping forever.
  it('stops a run that does not resolve', async () => {
    const water: Player = { name: 'w', async decide() { return { text: json({ thoughts: '', focus: null, site: null, queue: [{ action: 'water', ring: 1, options: [] }] }) }; } };
    await expect(playRun(water, { maxDays: 2 })).rejects.toThrow(/did not resolve by day 2/);
  });

  // 4. The report: survival rate, grades, and the median day of death.
  it('reports survival rate, grades and the median day of death', () => {
    const start = progressOf(createRegion1(), 0);
    const run = (kind: string, day: number, grade?: string, last: string[] = []): Transcript => ({
      player: 'openrouter:test/model', start,
      turns: [{ day, queue: [], invalid: false, progress: start, journal: last }],
      record: { kind, choice: kind === 'survived' ? 'thaw' : 'collapse', day, readyDay: null, grade },
      usage: { input: 0, output: 0, cacheRead: 0, cost: 0.2 },
    });
    const [m] = aggregate([
      run('survived', 61, 'hale', ['A cold, broken night — the exposure bites.']),
      run('survived', 61, 'worn'),
      run('died', 40, undefined, ['Your body gives out and you collapse in the snow. No one comes into the Reach in winter — the wolves find you first.']),
      run('died', 50, undefined, ["You lie down in the night and don't get up. Dead of thirst (4 nights without water)."]),
    ]);
    expect(m.survival.rate).toBe(0.5);
    expect(m.survival.grades).toEqual({ hale: 1, worn: 1, broken: 0 });
    expect(m.survival.deathDay).toBe(45);
    expect(m.survival.deaths).toEqual({ 'collapse (animals)': 1, thirst: 1 });
    expect(m.survival.nights.cold).toBe(0.3); // one cold night over four runs, rounded
    expect(deathCause(['The fire is long dead and the cold comes in. You don\'t wake. Dead of the cold.'])).toBe('cold');
    // The bench's estimate is for the whole year, and it says when the budget falls short.
    expect(perYear(ROSTER[0])).toBeCloseTo(ROSTER[0].perGame * 6, 10);
    // The trimmed roster fits the nightly $1 (#1326); a smaller budget gets the advice.
    expect(budgetAdvice(ROSTER, 1, 1)).toMatch(/covers the roster/);
    expect(budgetAdvice(ROSTER, 1, 0.5)).toMatch(/raise AI_BENCH_BUDGET/);
    expect(budgetAdvice(ROSTER, 1, 100)).toMatch(/covers the roster/);
  });
});
