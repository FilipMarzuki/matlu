/**
 * Acceptance tests for #1815 — stop an action while it plays out, keeping what you've actually got.
 * One test per Given/When/Then, in the issue's order, then the rules the design adds:
 *
 *   1. Water far away, stopped on the walk out  — no water, and the hours are the walk out and the same walk back.
 *   2. Water far away, stopped after the fetch  — the water is kept.
 *   3. Firewood, 4h of work, stopped after 2h   — about half the wood (rounded down), and the walk home.
 *   4. A craft, stopped                         — no materials used, nothing made.
 *   5. A stop                                   — the rest of the queue stays queued (and no night).
 *   6. The same seed and moves with a stop      — the same run; with `stop-action` off or absent nothing changes.
 * The design's other rules:
 *   7. All-at-once work stopped before it happened keeps nothing; exploring keeps what was seen by then.
 *   8. Stopped on the walk back, the action is as it would have been.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, queueHours, type QueueItem, type Region1State } from './region1';
import { FEATURES, featureOn } from './features';
import { cutTrips, stopProblem, STOP_ACTION } from './stop-action';
import { FULL_WORLD, type WorldConfig } from './world';
import { TRAVEL_HOURS } from './exploration';
import { act, makeWarden, runQueuedDay, stopQueuedDay, serialize, type AppState } from '../artificer-app/controller';
import { stepWeb } from '../artificer-play/web-run';
import { startGame, apply, view, type Game } from '../artificer-play/session';

/** Daylight, clear weather, no luck, accidents or encounters: what's kept is the rules', not the hour's. */
const world = (on: boolean | 'absent' = true): WorldConfig => ({ ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, ...(on === 'absent' ? {} : { features: { [STOP_ACTION]: on } }) });

/** A Warden who knows the near and far rings and camps in the cave, at dawn. */
function warden(on: boolean | 'absent' = true): Region1State {
  let s = createRegion1({ world: world(on) }, undefined, { id: 'w-stop' });
  s = runAction(s, 'scout');
  s = runAction(s, 'survey');
  s = runAction(s, 'scout@2');
  s = chooseSite(s, 'cave');
  return { ...s, hoursToday: 0, stores: { ...s.stores, materials: 12, stone: 6, hides: 2 } };
}

const used = (before: Region1State, after: Region1State): number => after.hoursToday - before.hoursToday;
const gained = (before: Region1State, after: Region1State, k: keyof Region1State['stores']): number => after.stores[k] - before.stores[k];
/** The walk out to the far ring: half the walk there and back. */
const OUT = TRAVEL_HOURS[2] / 2;

describe('The switch (#1815)', () => {
  it('registers stop-action as an experimental rule feature, on by default, off for runs from before it', () => {
    expect(FEATURES.find(f => f.id === STOP_ACTION)).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1815 });
    expect(featureOn(undefined, STOP_ACTION)).toBe(false);
  });
});

describe('Stop an action while it plays out (#1815)', () => {
  it('1. water far away, stopped on the walk out: no water, and the walk back takes as long as the walk out', () => {
    const s = warden();
    const stopped = runAction(s, 'water@2', 1);
    expect(gained(s, stopped, 'water')).toBe(0);
    expect(used(s, stopped)).toBeCloseTo(2);
    expect(stopped.log.at(-1)?.text).toMatch(/turned back/);
  });

  it('2. water far away, stopped after the water was fetched: the water is kept', () => {
    const s = warden();
    const full = runAction(s, 'water@2');
    const work = queueHours('water@2', s) - TRAVEL_HOURS[2];
    // On the walk back: the fetch is done.
    const stopped = runAction(s, 'water@2', OUT + work + 0.5);
    expect(gained(s, full, 'water')).toBeGreaterThan(0);
    expect(gained(s, stopped, 'water')).toBe(gained(s, full, 'water'));
    expect(stopped).toEqual(full);
  });

  it('3. firewood for 4 hours of work, stopped after 2: about half the wood, rounded down, and the walk home', () => {
    const s = warden();
    const work = queueHours('wood@2', s) - TRAVEL_HOURS[2];
    expect(work).toBeCloseTo(4);
    const full = runAction(s, 'wood@2');
    const stopped = runAction(s, 'wood@2', OUT + 2);
    expect(gained(s, full, 'firewood')).toBeGreaterThan(1);
    expect(gained(s, stopped, 'firewood')).toBe(Math.floor(gained(s, full, 'firewood') * 2 / work));
    expect(gained(s, stopped, 'materials')).toBe(Math.floor(gained(s, full, 'materials') * 2 / work));
    // Out, two hours of work, and the whole walk home.
    expect(used(s, stopped)).toBeCloseTo(OUT + 2 + OUT);
    // Spent as far as got: less Vigor than the whole trip, more than none.
    expect(stopped.vitals.vigor.current).toBeGreaterThan(full.vitals.vigor.current);
    expect(stopped.vitals.vigor.current).toBeLessThan(s.vitals.vigor.current);
  });

  it('4. a craft, stopped: no materials are used and nothing is made', () => {
    const s = warden();
    const made = runAction(s, 'knife');
    expect(made.tools.length).toBeGreaterThan(s.tools.length);
    const stopped = runAction(s, 'knife', 1);
    expect(stopped.stores).toEqual(s.stores);
    expect(stopped.tools).toEqual(s.tools);
    expect(used(s, stopped)).toBeCloseTo(1);
    expect(stopped.log.at(-1)?.text).toMatch(/nothing made/);
  });

  it('5. a stop leaves the rest of the queue queued, and the day paused (no night)', () => {
    const s = { ...warden(), canPlan: true };
    const queue: QueueItem[] = ['water', 'wood@2', 'gather', 'rest'];
    const r = runDay(s, queue, { action: 1, hours: OUT + 1 });
    expect(r.remaining).toEqual(['gather', 'rest']);
    expect(r.state.day).toBe(s.day);
    // The app keeps them in its queue.
    const a: AppState = { sim: s, queue, stage: 'reach' };
    const after = stopQueuedDay(a, { action: 1, hours: OUT + 1 });
    expect(after.queue).toEqual(['gather', 'rest']);
    expect(after.sim).toEqual(r.state);
    // …and they can be run: the day goes on from where it paused, then the night.
    const rest = runQueuedDay(after);
    expect(rest.sim.day).toBe(s.day + 1);
  });

  it('6. the same seed and moves with a stop give the same run; with stop-action off or absent nothing changes', () => {
    const play = (features: Record<string, boolean>): string[] => {
      let a = makeWarden({ id: 'w-stop-replay' }, undefined, { 'action-visibility': false, ...features });
      const moves = [{ do: 'scout' }, { endDay: true as const }, { do: 'water', stop: { action: 0, hours: 0.5 } }, { endDay: true as const }];
      const out: string[] = [];
      for (const m of moves) {
        const next = stepWeb(a, m as never);
        out.push(typeof next === 'string' ? `refused: ${next}` : serialize(next));
        if (typeof next !== 'string') a = next;
      }
      return out;
    };
    expect(play({})).toEqual(play({}));
    expect(play({}).some(x => x.startsWith('refused'))).toBe(false);
    // Off: the stop is refused, and play without one is the play from before the switch.
    expect(play({ [STOP_ACTION]: false }).some(x => x.startsWith('refused'))).toBe(true);
    const plain = (features: Record<string, boolean | undefined>): AppState => {
      const a = makeWarden({ id: 'w-stop-plain' }, undefined, features as Record<string, boolean>);
      const s = runAction(runAction(a.sim, 'scout'), 'survey');
      return runQueuedDay({ ...a, sim: { ...s, canPlan: true }, queue: ['water', 'wood', 'gather'] });
    };
    const strip = (a: AppState): unknown => ({ ...a, sim: { ...a.sim, config: { ...a.sim.config, world: { ...a.sim.config.world, features: undefined } } } });
    expect(strip(plain({ [STOP_ACTION]: true }))).toEqual(strip(plain({ [STOP_ACTION]: false })));
    // The API: the same move, the same game; refused with the switch off.
    const game = (features: Record<string, boolean>): Game => {
      let g = startGame({ seed: 'stop-api', features: { 'action-visibility': false, ...features } });
      const r = apply(g, { do: 'scout' });
      if (r.ok) g = r.game;
      return g;
    };
    const stopMove = { do: 'water', stop: { action: 0, hours: 0.5 } } as const;
    const x = apply(game({}), stopMove), y = apply(game({}), stopMove);
    expect(x.ok && y.ok && JSON.stringify(x.game) === JSON.stringify(y.game)).toBe(true);
    expect(apply(game({ [STOP_ACTION]: false }), stopMove).ok).toBe(false);
    // The observation says what a stop would keep, only when the switch is on.
    expect(view(game({})).text).toMatch(/STOPPING/);
    expect(view(game({ [STOP_ACTION]: false })).text).not.toMatch(/STOPPING/);
    // An act stopped by hand matches the API's.
    const g = game({});
    const byHand = act(g.app, 'water', 0.5);
    expect(x.ok && x.game.app.sim.stores.water).toBe(byHand.sim.stores.water);
  });
});

describe('What a stop keeps, by kind of work (#1815)', () => {
  it('7. a hunt stopped before the kill keeps nothing; exploring keeps what was seen by then', () => {
    const s = warden();
    const huntWork = queueHours({ q: 'hunt', opts: { target: 'small' } } as QueueItem, s);
    const hunted = runAction(s, { q: 'hunt', opts: { target: 'small' } } as QueueItem, huntWork / 2);
    expect(gained(s, hunted, 'rawFood')).toBe(0);
    // Exploring the distant ring halfway: half the learning (the walk out first).
    const t = runAction(warden(), 'scout@3');
    const fresh = warden();
    const scoutWork = queueHours('scout@3', fresh) - TRAVEL_HOURS[3];
    const half = runAction(fresh, 'scout@3', TRAVEL_HOURS[3] / 2 + scoutWork / 2);
    const k = (x: Region1State): number => x.explore.known[3].forage;
    expect(k(t)).toBeGreaterThan(k(fresh));
    expect(k(half)).toBeCloseTo((k(fresh) + k(t)) / 2);
  });

  it('8. stopped on the walk back, everything is as it would have been', () => {
    const s = warden();
    expect(runAction(s, 'wood@2', queueHours('wood@2', s) - 0.25)).toEqual(runAction(s, 'wood@2'));
  });

  it('cuts trips by their legs, and checks a stop move', () => {
    const trips = [{ travel: 3, work: 4 }, { travel: 3, work: 4 }];
    expect(cutTrips(trips, 1, 'bit')).toMatchObject({ work: 0, travel: 2, kept: 0, phase: 'out' });
    expect(cutTrips(trips, 3.5, 'bit')).toMatchObject({ work: 2, travel: 3, kept: 2, phase: 'work' });
    expect(cutTrips(trips, 3.5, 'all')).toMatchObject({ work: 2, travel: 3, kept: 0, phase: 'work' });
    expect(cutTrips(trips, 8, 'bit')).toMatchObject({ work: 4, travel: 5, kept: 4, phase: 'out', trips: 2 });
    expect(cutTrips(trips, 13, 'bit')).toBeNull();
    expect(stopProblem({ action: 0, hours: 1 }, 2)).toBeNull();
    expect(stopProblem({ action: 2, hours: 1 }, 2)).not.toBeNull();
    expect(stopProblem({ action: 0, hours: -1 }, 2)).not.toBeNull();
    expect(stopProblem('soon', 2)).not.toBeNull();
  });
});
