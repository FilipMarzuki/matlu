/**
 * Acceptance tests for #1297 — the AI harness sees carrying as a person does:
 * load, gear and strain in the observation, each trip's expected load, cold
 * storage and spoilage; the report counts them per day; and the invariants
 * hold across random runs. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { observe } from './observe';
import { progressOf } from './progress';
import { aggregate, type Transcript } from './report';
import { playRun } from './runner';
import { randomPlayer } from './players/random';
import { invariantViolations } from './invariants';

describe('The AI sees carrying (#1297)', () => {
  // 1. A backpack and strain 2: the observation shows max and comfortable load, the backpack, and the strain.
  it('shows load, gear and strain in the observation', () => {
    const s0 = chooseSite(runAction(createRegion1({}, undefined, { id: 'w-carry' }), 'scout'), 'cave');
    const s = { ...s0, hoursToday: 0, vitals: createVitals(), strain: 2, tools: [...s0.tools, { item: 'backpack', grade: 'sound' as const }] };
    const text = observe(s);
    expect(text).toMatch(/LOAD: max 40 stones · comfortable 16 · carrying gear: backpack \(sound\) · strain 2\.0 \(tonight's Vigor recovery −20%\)/);
    // Each far trip's expected load, as the queue preview shows a person.
    expect(text).toMatch(/- water ring 1 .*load (comfortable|heavy|staggering|too much)/);
    // Cold storage and tonight's spoilage.
    expect(text).toMatch(/COLD STORAGE: \d+ raw food kept cold \(capacity \d+, no cold pit\) · \d+ exposed · /);
    expect(observe({ ...s, today: { ...s.today, exhausted: true } })).toMatch(/EXHAUSTED today — all work drains 15% more/);
  });

  // 2. Food spoiled in a run: the report counts it, day by day.
  it('counts spoiled food per day in the report', () => {
    const s = createRegion1({}, undefined, { id: 'w-report' });
    const start = progressOf(s, s.known.length);
    const at = (day: number, spoiled: number) => ({ ...progressOf({ ...s, day, tally: { leftStones: 0, overloadedHours: 0, spoiled, heaviest: 0 } }, s.known.length) });
    const run: Transcript = {
      player: 'scripted', start,
      turns: [1, 2, 3].map(d => ({ day: d, queue: [], invalid: false, progress: at(d + 1, [0, 2, 5][d - 1]) })),
      record: { kind: 'died', choice: 'collapse', day: 4, readyDay: null },
      usage: { input: 0, output: 0, cacheRead: 0, cost: 0 },
    };
    const [m] = aggregate([run]);
    expect(m.series.spoiled).toEqual([0, 0, 2, 5]);
    expect(m.series.leftStones.at(-1)).toBe(0);
    // A real run's snapshot carries the tally.
    expect(progressOf({ ...s, tally: { leftStones: 3, overloadedHours: 1.5, spoiled: 4, heaviest: 20 }, strain: 1.25 }, 0).carry).toEqual({ leftStones: 3, overloadedHours: 1.5, spoiled: 4, strain: 1.3 });
  });

  // 3. 50 random runs in the full world: no invariant breaks.
  it('keeps every invariant across 50 random full-world runs', async () => {
    let broken = 0, carried = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = await playRun(randomPlayer({ mode: 'legal', seed }), { characterId: `ai-random-carry-${seed}` });
      broken += r.turns.filter(t => t.violations?.length).length;
      expect(invariantViolations(r.final)).toEqual([]);
      if ((r.final.tally?.heaviest ?? 0) > 0) carried++;
    }
    expect(broken).toBe(0);
    expect(carried).toBeGreaterThan(0); // the runs did carry things home
    // The invariants do catch a broken state.
    const s = createRegion1({}, undefined, { id: 'w-bad' });
    expect(invariantViolations({ ...s, strain: -1 })).toEqual(expect.arrayContaining([expect.stringMatching(/strain/)]));
    expect(invariantViolations({ ...s, tally: { leftStones: 0, overloadedHours: 0, spoiled: 0, heaviest: 99 } })).toEqual(expect.arrayContaining([expect.stringMatching(/heaviest/)]));
  }, 120_000);
});
