/**
 * Acceptance tests for #1357 — the AI harness meets the caravan: a run that rides on plays the
 * meeting with Bodil before road day 1, an invalid answer twice takes the safest option (marked),
 * random meetings and roads keep every road invariant, and the report counts fares by kind.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { openMeeting, safestMeetingOption, chooseInMeeting } from '../artificer/caravan-meeting';
import { observeMeeting } from './observe';
import { playMeeting, playRoad, playRun, aiCharacterId } from './runner';
import { scriptedPlayer } from './players/scripted';
import { randomPlayer } from './players/random';
import { aggregate, type Transcript } from './report';
import { progressOf } from './progress';

/** A Region 1 run at the thaw, well stocked. */
function survived(id = 'w-caravan-ai', stores: Partial<Region1State['stores']> = {}): Region1State {
  const s = createRegion1({}, undefined, { id, name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, tools: [{ item: 'cold-gear', grade: 'sound' }], stores: { ...s.stores, rawFood: 30, water: 20, firewood: 4, ...stores }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
}

describe('The AI harness meets the caravan (#1357)', () => {
  // 1. A run that survived and rides on: the transcript has the meeting's steps and choices before road day 1.
  it('plays the meeting before the road, and records it', async () => {
    const run = await playRun(scriptedPlayer(), { road: true, characterId: aiCharacterId('scripted', 's1') });
    expect(run.record.kind).toBe('survived');
    const m = run.meeting!;
    expect(m.ended).toBe('board');
    expect(m.steps[0]).toMatchObject({ step: 'greet', choice: 'hail', success: true });
    expect(m.steps[1].step).toBe('fare');
    // The scripted baseline pays in goods if it can, else works its passage.
    const final = run.final.stores;
    expect(m.steps[1].choice).toBe(final.hides >= 2 ? 'hides' : final.rations >= 4 ? 'rations' : 'work');
    expect(m.fare).toBe(m.steps[1].choice === 'work' ? 'work' : 'goods');
    // The road follows, starting from what the meeting settled; a worked passage is paid back by helping.
    expect(run.road!.turns[0].day).toBe(1);
    if (m.fare === 'work') expect(run.road!.turns.some(t => t.journal.includes('Your passage is worked off. Bodil nods to you at supper.'))).toBe(true);
    // The message is shown like an encounter: the speaker, the words, the options with odds.
    const text = observeMeeting(survived(), openMeeting(survived()));
    expect(text).toMatch(/^THE CARAVAN — the thaw, day 61\. Before you climb aboard, Bodil has questions\./);
    expect(text).toContain('Bodil: A line of wagons comes up the thawing valley');
    expect(text).toContain('- pass: Let them pass — safe (you stay behind: no road)');
    const fare = observeMeeting(survived(), chooseInMeeting(survived(), openMeeting(survived()), 'hail'));
    expect(fare).toContain('- marks: Pay in marks — costs 8 marks — NOT AVAILABLE (needs 8 marks)');
    expect(fare).toMatch(/- talk: Talk your way on — (likely|risky|desperate)/);
  }, 30_000);

  // 2. An invalid choice twice: the safest option is taken, and it is marked.
  it('takes the safest answer after two invalid ones, and marks it', async () => {
    const reach = survived();
    const asked: string[] = [];
    const met = await playMeeting(reach, async message => { asked.push(message); return '{"choice":"fly"}'; });
    expect(asked[1]).toMatch(/^Your choice was invalid:\n- "fly" is not an option here — choose one of: hail, merchant, pass/);
    expect(met.record.steps.every(s => s.forced)).toBe(true);
    expect(met.record.steps[0]).toMatchObject({ step: 'greet', choice: safestMeetingOption(reach, openMeeting(reach)).id, forced: true, reply: '{"choice":"fly"}', errors: [expect.stringMatching(/not an option here/)] });
    // The safest is never letting them pass: an AI that can't answer still rides.
    expect(met.record.ended).toBe('board');
    expect(met.boarding).not.toBeNull();
    // A player that can't answer at all: the safest, marked, with no reply to show.
    const mute = await playMeeting(reach, null);
    expect(mute.record.steps[0]).toEqual({ step: 'greet', choice: 'hail', success: true, forced: true });
    // Letting them pass means no road.
    const stay = await playMeeting(reach, async () => '{"choice":"pass"}');
    expect(stay.record).toMatchObject({ ended: 'stay', fare: null });
    expect(stay.boarding).toBeNull();
  });

  // 3. 30 random road runs: no road invariant breaks.
  it('keeps every road invariant through 30 random meetings and roads', async () => {
    const broken: string[] = [];
    let rode = 0;
    for (let n = 1; n <= 30; n++) {
      const player = randomPlayer({ mode: n % 2 ? 'legal' : 'uniform', seed: n });
      const reach = survived(`w-rand-cv-${n}`, { rawFood: 5 + (n % 20), water: n % 12, hides: n % 4, rations: n % 6 });
      const met = await playMeeting(reach, async (msg, m) => (await player.decideMeeting!(msg, reach, m)).text);
      expect(met.record.steps.length).toBeGreaterThan(0);
      if (!met.boarding) { expect(met.record.ended).toBe('stay'); continue; }
      rode++;
      const res = await playRoad(reach, async (m, r) => (await player.decideRoad!(m, r)).text, undefined, met.boarding);
      for (const t of res.turns) if (t.violations) broken.push(`run ${n} day ${t.day}: ${t.violations.join('; ')}`);
      expect(['arrived', 'died', 'collapsed']).toContain(res.record.kind);
    }
    expect(broken).toEqual([]);
    expect(rode).toBeGreaterThan(0);
  }, 60_000);

  // 4. Finished road runs: the report counts fares by kind.
  it('counts how the fare was paid', () => {
    const s = createRegion1({}, undefined, { id: 'w-report' });
    const start = progressOf(s, s.known.length);
    const run = (meeting?: Transcript['meeting']): Transcript => ({ player: 'scripted', start, turns: [], record: { kind: 'survived', choice: 'thaw', day: 61, readyDay: null }, usage: { input: 0, output: 0, cacheRead: 0, cost: 0 }, ...(meeting ? { meeting } : {}) });
    const step = (choice: string, forced = false) => ({ step: 'fare', choice, success: true, ...(forced ? { forced } : {}) });
    const [m] = aggregate([
      run({ steps: [step('hides')], ended: 'board', fare: 'goods', owesHelp: 0 }),
      run({ steps: [step('work', true)], ended: 'board', fare: 'work', owesHelp: 2 }),
      run({ steps: [step('rations')], ended: 'board', fare: 'goods', owesHelp: 0 }),
      run({ steps: [step('pass')], ended: 'stay', fare: null, owesHelp: 0 }),
      run(),
    ]);
    expect(m.meetings).toEqual({ runs: 4, fares: { goods: 2, work: 1, stayed: 1 }, forced: 1 });
    expect(aggregate([run()])[0].meetings).toBeNull();
  });
});
