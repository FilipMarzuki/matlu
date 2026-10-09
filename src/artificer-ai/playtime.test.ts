/**
 * Acceptance tests for #1471 — how long a person would take to play a run, estimated from its
 * transcript. One test per Given/When/Then.
 */

import { describe, it, expect } from 'vitest';
import { playCounts, minutesAt, playtimeOf, playtimeSummaryOf, playtimeText, PACES, type PlayRecord } from './playtime';
import { aggregate, type Transcript } from './report';
import { progressOf } from './progress';
import { createRegion1 } from '../artificer/region1';

/** `n` Reach days of `perDay` actions; the first day has one encounter; 500 journal words in all. */
const reach = (n: number, perDay: number): PlayRecord['turns'] =>
  Array.from({ length: n }, (_, i) => ({ queue: Array(perDay).fill('rest'), encounters: i === 0 ? [{}] : [], journal: [Array(50).fill('word').join(' ')] }));

describe('Playtime estimate (#1471)', () => {
  // 1. Ten days of three actions, one encounter, 500 words: setup + 10 days + 30 actions + 1 encounter + reading.
  it('prices each thing a person does, at three paces', () => {
    const t: PlayRecord = { turns: reach(10, 3) };
    expect(playCounts(t)).toEqual({ days: 10, actions: 30, encounters: 1, words: 500, roadDays: 0, roadActions: 0, meetingSteps: 0 });
    const p = PACES.typical;
    const expected = (p.setup + 10 * p.day + 30 * p.action + 1 * p.encounter + (500 / p.wpm) * 60) / 60;
    expect(minutesAt(playCounts(t), p)).toBeCloseTo(expected);
    const est = playtimeOf(t);
    expect(est.typical).toBe(Math.round(expected));
    expect(est.fast).toBeLessThan(est.typical);
    expect(est.typical).toBeLessThan(est.careful);
  });

  // 2. A road of 5 days with 2 actions each (and 100 words) and a 3-step meeting adds exactly those.
  it('adds the road and the caravan meeting', () => {
    const base: PlayRecord = { turns: reach(10, 3) };
    const rode: PlayRecord = { ...base, road: { turns: Array.from({ length: 5 }, () => ({ actions: ['rest', 'wait'], journal: ['twenty words '.repeat(10).trim()] })) }, meeting: { steps: [{}, {}, {}] } };
    const p = PACES.typical;
    const added = (5 * p.roadDay + 10 * p.action + 3 * p.meetingStep + (100 / p.wpm) * 60) / 60;
    expect(minutesAt(playCounts(rode), p) - minutesAt(playCounts(base), p)).toBeCloseTo(added);
    expect(playCounts(rode)).toMatchObject({ roadDays: 5, roadActions: 10, meetingSteps: 3, words: 600 });
  });

  // 3. The report gives each model the median, with the fast–careful range.
  it('summarises playtime per model in the report', () => {
    const s = createRegion1();
    const progress = progressOf(s, s.known.length);
    const run = (player: string, days: number): Transcript => ({
      player, start: progress, usage: { input: 0, output: 0, cacheRead: 0 },
      record: { kind: 'died', choice: 'collapse', day: days, readyDay: null },
      turns: Array.from({ length: days }, (_, i) => ({ day: i + 1, queue: ['rest', 'rest'], invalid: false, progress, journal: [Array(50).fill('word').join(' ')] })),
    });
    expect(playtimeSummaryOf([])).toBeNull();
    const short = playtimeOf(run('a', 10)), long = playtimeOf(run('a', 30));
    const [a, b] = ['a', 'b'].map(m => aggregate([run(`openrouter:${m}`, 10), run(`openrouter:${m}`, 30), run('openrouter:b', 20)]).find(x => x.model === m)!);
    expect(a.playtime).toEqual({ runs: 2, fast: Math.round((short.fast + long.fast) / 2), typical: Math.round((short.typical + long.typical) / 2), careful: Math.round((short.careful + long.careful) / 2) });
    expect(b.playtime).toEqual({ runs: 3, ...playtimeOf(run('b', 20)) }); // 10, 20 and 30 days: the median is the 20-day run
    expect(playtimeText({ fast: 20, typical: 40, careful: 95 })).toBe('40 min (20 min–1.6 h)');
  });
});
