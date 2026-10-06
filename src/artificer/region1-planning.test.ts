/**
 * Acceptance tests for #1350 — planning is learned: no queue until the first
 * level-up, then the Warden realises they can plan ahead.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, PLANNING_UNLOCKED, type Region1State } from './region1';
import { createVitals } from './vitality';
import { newGame, newRun, enqueue, act, endTheDay, serialize, deserialize } from '../artificer-app/controller';
import { playRun, type Player } from '../artificer-ai/runner';

const fresh = (): Region1State => createRegion1({ planning: 'learned' }, undefined, { id: 'w-plan' });
const unlocks = (s: Region1State): number => s.log.filter(l => l.text === PLANNING_UNLOCKED).length;

describe('Planning is learned (#1350)', () => {
  // 1. A fresh Warden on day 1: no planning, and enqueue is refused.
  it('starts a fresh Warden without a queue', () => {
    // A new game meets encounters (#1347), and its character id is random: keep them out of this
    // test, or a scout that happens to meet something leaves the day paused (and the test flaky).
    const g = newGame();
    const a = { ...g, sim: { ...g.sim, config: { ...g.sim.config, world: { ...g.sim.config.world, encounters: false } } } };
    expect(a.sim.canPlan).toBe(false);
    expect(enqueue(a, 'scout').queue).toEqual([]);
    // …but a tap does the thing now, and the day can be ended by hand.
    const done = act(a, 'scout');
    expect(done.sim.hoursToday).toBeGreaterThan(0);
    expect(endTheDay(done).sim.day).toBe(2);
  });

  // 2. Locked, runDay with three actions: only the first runs; the other two come back.
  it('runs only the first action of a locked day', () => {
    const s = fresh();
    const r = runDay(s, ['scout', 'water', 'gather']);
    expect(r.remaining).toEqual(['water', 'gather']);
    expect(r.state.day).toBe(2);
    expect(r.state.log.some(l => /^Scouted/.test(l.text))).toBe(true);
  });

  // 3. The first true level-up unlocks planning, with the milestone, once.
  it('unlocks planning at the first level-up, once', () => {
    const s = { ...fresh(), skills: { scouting: 4.9 } };
    const after = runAction(s, 'scout');
    expect(after.canPlan).toBe(true);
    expect(unlocks(after)).toBe(1);
    // Later level-ups don't repeat it.
    const again = runAction({ ...after, hoursToday: 0, skills: { ...after.skills, foraging: 4.9 } }, 'gather');
    expect(unlocks(again)).toBe(1);
    // An action that levels nothing keeps the lock.
    expect(runAction(fresh(), 'rest').canPlan).toBe(false);
  });

  // 4. Carrying on with Woodcraft 2: planning from the start.
  it('lets a returning Warden plan from day 1', () => {
    const base = createRegion1({}, undefined, { id: 'w-back', name: 'Vega' });
    const vitals = createVitals();
    const from: Region1State = { ...base, skills: { woodcraft: 20 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
    expect(newRun(from).sim.canPlan).toBe(true);
    // Someone who never levelled anything still has to learn it.
    expect(newRun({ ...from, skills: {} }).sim.canPlan).toBe(false);
  });

  // 5. A save from before this change loads able to plan.
  it('loads old saves able to plan', () => {
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.canPlan;
    expect(deserialize(JSON.stringify(raw))?.sim.canPlan).toBe(true);
    // A locked save stays locked.
    expect(deserialize(serialize(newGame()))?.sim.canPlan).toBe(false);
  });

  // 6. The AI, locked: a reply of several actions runs only the first, and the player is asked again.
  it('asks the AI again after each action while locked', async () => {
    const asked: number[] = [];
    let calls = 0;
    const player: Player = {
      name: 'stub',
      async decide(message, s) {
        calls++;
        asked.push(s.day);
        // Day 1: three actions per reply until the day is spent; after day 1, end every day at once.
        const queue = s.day === 1 && calls < 4 ? ['scout', 'water', 'gather'].map(action => ({ action, ring: 1, options: [] })) : [];
        expect(message).toContain(s.canPlan ? 'DAY' : 'PLANNING: not yet');
        return { text: JSON.stringify({ thoughts: 'step', site: null, queue }) };
      },
    };
    const run = await playRun(player, { characterId: 'w-stub', maxDays: 61 });
    const day1 = run.turns[0];
    // Asked more than once on day 1: each locked reply ran only its first action (scout), until the
    // second scout levelled Scouting, planning opened, and the next reply's whole plan ran.
    expect(asked.filter(d => d === 1).length).toBe(3);
    expect(day1.queue).toEqual(['scout', 'scout', 'scout', 'water', 'gather']);
    expect(day1.journal.filter(l => l === PLANNING_UNLOCKED)).toHaveLength(1);
  }, 60_000);
});
