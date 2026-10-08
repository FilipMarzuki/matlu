/**
 * Acceptance tests for #1365 — the AI harness faces panic: the observation names its state and
 * marks what panic closed, an override is recorded as chosen and taken, random runs keep every
 * invariant, and the report counts panics, overrides and fears. One test per scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { overrideChance } from '../artificer/panic';
import { seedOf, streamFor } from '../artificer/rng';
import { observe, observeEncounter, RULES } from './observe';
import { playRun, encounterRecord, frightOfTurn } from './runner';
import { randomPlayer } from './players/random';
import { invariantViolations } from './invariants';
import { aggregate, type Transcript } from './report';
import { progressOf } from './progress';

/** A Warden facing `id` in `state`, with exactly these quirks. */
function facing(id: string, state: 'calm' | 'shaken' | 'panicked', quirks: { id: string; known: boolean; faced?: number }[] = [], who = 'w-panic-ai'): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: who });
  return {
    ...s, skills: { scouting: 20 }, character: { ...s.character, quirks }, hoursToday: 4,
    pending: { id, day: 1, hour: 10, ring: 2, action: 'scout', state, perceived: state === 'calm' ? 2 : state === 'shaken' ? 3 : 4, margin: state === 'panicked' ? 2 : state === 'shaken' ? 1 : 0 }, encounterDay: 1,
  };
}

describe('The AI harness faces panic (#1365)', () => {
  // 1. A panicked encounter: the observation names the state and marks the closed options.
  it('tells the AI how it stands, and what panic closed', () => {
    const text = observeEncounter(facing('crumbling-ledge', 'panicked'));
    expect(text).toContain('YOUR READ: it looks overwhelming. Panic. You can barely think.');
    expect(text).toMatch(/- go-around: Go the long way round to it — costs 2h — NOT AVAILABLE \(you can't think straight\)/);
    // Shaken: the careful option is marked harder.
    expect(observeEncounter(facing('crumbling-ledge', 'shaken'))).toMatch(/- go-around: .* — risky \(harder: you are shaken\)/);
    // Known quirks and fears are shown; hidden ones only counted.
    const q = observeEncounter(facing('crumbling-ledge', 'calm', [{ id: 'runner', known: true }, { id: 'fear:heights', known: true, faced: 1 }, { id: 'stoic', known: false }]));
    expect(q).toMatch(/QUIRKS: Runner \(when panic takes over, you run\) · Fear of heights \(makes it look worse; faced calmly 1 of 3 times\) · 1 not yet known/);
    // The rules explain panic, once, statically.
    expect(RULES).toMatch(/FEAR AND PANIC/);
    // The day's observation marks frightening trips and nights.
    const late = { ...facing('crumbling-ledge', 'calm'), pending: null, day: 50, hoursToday: 13, weatherToday: 'fog' as const, stores: { ...createRegion1().stores, firewood: 0, water: 4, rawFood: 4 }, character: { ...createRegion1().character, talents: [], quirks: [] } };
    const day = observe(late);
    expect(day).toMatch(/UNEASE: dark, fog, wolves about — you may panic/);
    expect(day).toMatch(/TONIGHT: looks \w+ \(.*no shelter.*\)/);
  });

  // 2. An override in an AI run: the transcript records the option chosen and the one taken.
  it('records an override as chosen and taken', () => {
    let who = '';
    for (let i = 0; i < 200 && !who; i++) if (streamFor(seedOf(`w-ai-ovr-${i}`), 1, 'panic:fox-at-the-treeline')() < overrideChance(2)) who = `w-ai-ovr-${i}`;
    const before = facing('fox-at-the-treeline', 'panicked', [{ id: 'runner', known: false }], who);
    const rec = encounterRecord(before, chooseOption(before, 'chase'), 'chase');
    expect(rec).toMatchObject({ state: 'panicked', choice: 'chase', override: { chosen: 'chase', taken: 'back-away' }, revealed: ['runner'] });
    // A freezer's override is recorded as a freeze.
    const ledge = facing('crumbling-ledge', 'panicked', [{ id: 'freezer', known: false }], who);
    let freezeWho = '';
    for (let i = 0; i < 200 && !freezeWho; i++) if (streamFor(seedOf(`w-ai-frz-${i}`), 1, 'panic:crumbling-ledge')() < overrideChance(2)) freezeWho = `w-ai-frz-${i}`;
    const frozen = { ...ledge, character: { ...ledge.character, id: freezeWho } };
    expect(encounterRecord(frozen, chooseOption(frozen, 'climb-down'), 'climb-down').override).toEqual({ chosen: 'climb-down', taken: 'freeze' });
    // A calm choice records its state and no override.
    const calm = facing('fox-at-the-treeline', 'calm');
    const plain = encounterRecord(calm, chooseOption(calm, 'watch'), 'watch');
    expect(plain.state).toBe('calm');
    expect(plain.override).toBeUndefined();
    // Turn frights read off the journal and the quirks.
    expect(frightOfTurn(['You lie awake a long time, listening to the dark.'], [], [{ id: 'fear:dark', known: true }])).toEqual({ spooks: 0, uneasyNights: 1, sleeplessNights: 0, fearsGained: ['fear:dark'], fearsLost: [] });
    expect(frightOfTurn(['Fetched water.'], [], [])).toBeNull();
  });

  // 3. 50 random runs: no invariant breaks — with panic in the world.
  it('keeps every invariant across 50 random runs with panic', async () => {
    let frights = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = await playRun(randomPlayer({ mode: seed % 5 === 0 ? 'uniform' : 'legal', seed }), { characterId: `ai-random-panic-${seed}` });
      for (const t of r.turns) {
        expect(t.violations).toBeUndefined();
        if (t.fright || t.encounters?.some(e => e.state && e.state !== 'calm')) frights++;
      }
      expect(invariantViolations(r.final)).toEqual([]);
    }
    expect(frights).toBeGreaterThan(0); // fear did show up
  }, 60_000);

  // 4. Finished runs: the report counts panics, overrides and fears.
  it('counts panics, overrides, spooks, fearful nights and fears in the report', () => {
    const s = createRegion1({}, undefined, { id: 'w-report' });
    const start = progressOf(s, s.known.length);
    const turn = (extra: Partial<Transcript['turns'][number]>): Transcript['turns'][number] => ({ day: 1, queue: [], invalid: false, progress: start, ...extra });
    const run = (turns: Transcript['turns']): Transcript => ({ player: 'scripted', start, turns, record: { kind: 'survived', choice: 'thaw', day: 61, readyDay: null }, usage: { input: 0, output: 0, cacheRead: 0, cost: 0 } });
    const [m] = aggregate([
      run([
        turn({ encounters: [{ id: 'fox-at-the-treeline', kind: 'animal', choice: 'chase', state: 'panicked', override: { chosen: 'chase', taken: 'back-away' } }] }),
        turn({ fright: { spooks: 1, uneasyNights: 1, sleeplessNights: 0, fearsGained: ['fear:dark'], fearsLost: [] } }),
      ]),
      run([
        turn({ encounters: [{ id: 'crumbling-ledge', kind: 'find', choice: 'leave', state: 'shaken' }] }),
        turn({ fright: { spooks: 0, uneasyNights: 0, sleeplessNights: 2, fearsGained: [], fearsLost: ['fear:dark'] } }),
      ]),
    ]);
    expect(m.fright).toEqual({ shaken: 1, panicked: 1, overrides: 1, spooks: 0.5, uneasyNights: 0.5, sleeplessNights: 1, fearsGained: { 'fear:dark': 1 }, fearsLost: { 'fear:dark': 1 } });
  });
});
