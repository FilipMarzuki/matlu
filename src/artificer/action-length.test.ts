/**
 * Acceptance tests for #1668 — choose how long a gathering action takes, played as trips.
 * One test per Given/When/Then, in the issue's order and then the owner's comment's:
 *
 * Issue:
 *   1. Longer gathers more     — foraging for 3h takes 3h (+ travel, which the owner's comment folds
 *                                into the chosen time) and yields about 3x one hour, minus fall-off.
 *   2. Until N                 — "gather wood until 10" stops when 10 is reached, or the day ends with less.
 *   3. Fixed actions           — a fixed action can't take a length.
 *   4. API                     — `hours: 2` through the API gives the same result as the UI.
 *   5. Switch off              — with the switch off, play equals today's.
 * Owner's comment (2026-10-12):
 *   6. Far vs near             — at a far site, 4 hours fits fewer trips and yields less than near.
 *   7. Deadfall vs timber      — over 4 hours the deadfall's yield per trip falls; the timber's barely does.
 *   8. Recovery                — a depleted patch recovers over the following days.
 * And what the issue asks of the plan and the save:
 *   9. The queue preview shows the plan ("2 trips, about … firewood, the deadfall is getting thin").
 *  10. The patches are saved only with the switch on, and a malformed set is dropped on load.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, endDay, chooseSite, queueHours, sessionOf, ACTIONS, blockedReason, type QueueItem, type Region1State } from './region1';
import { planTrips, recoverPatches, validPatches, PATCHES, LENGTH_ACTIONS } from './action-length';
import { FEATURES, featureOn } from './features';
import { FULL_WORLD, type WorldConfig } from './world';
import { DEFAULT_STATS } from './stats';
import { act, makeWarden, previewQueue, serialize, deserialize, type AppState } from '../artificer-app/controller';
import { startGame, apply, type Game } from '../artificer-play/session';

/** Daylight, clear weather, no luck and no accidents: the haul is the rules', not the hour's. */
const world = (on: boolean | 'absent'): WorldConfig => ({ ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', ...(on === 'absent' ? {} : { features: { 'action-length': on } }) });

/** A Warden who has scouted and surveyed the near (and, with `far`, the far) ring and camps in the cave, at dawn. `absent`: a run from before the switch. */
function warden(on: boolean | 'absent' = true, opts: { far?: boolean; str?: number } = {}): Region1State {
  let s = createRegion1({ world: world(on) }, undefined, { id: 'w-length', stats: { ...DEFAULT_STATS, str: opts.str ?? DEFAULT_STATS.str } });
  s = runAction(s, 'scout');
  s = runAction(s, 'survey');
  if (opts.far) { s = runAction(s, 'scout@2'); s = runAction(s, 'survey@2'); }
  s = chooseSite(s, 'cave');
  return { ...s, hoursToday: 0 };
}

const len = (q: string, opts: Record<string, string>): QueueItem => ({ q, opts } as QueueItem);
const gained = (before: Region1State, after: Region1State, k: keyof Region1State['stores']): number => after.stores[k] - before.stores[k];
const used = (before: Region1State, after: Region1State): number => after.hoursToday - before.hoursToday;

describe('The switch (#1668)', () => {
  it('registers action-length as an experimental rule feature, on by default, off for runs from before it', () => {
    expect(FEATURES.find(f => f.id === 'action-length')).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1668 });
    expect(featureOn(undefined, 'action-length')).toBe(false);
  });
});

describe('Choose how long an action takes (#1668)', () => {
  it('1. longer gathers more: 3h of foraging takes 3h and yields about 3x one hour, less any fall-off', () => {
    const s = warden();
    const one = runAction(s, len('gather', { hours: '1' }));
    const three = runAction(s, len('gather', { hours: '3' }));
    expect(used(s, one)).toBe(1);
    // The near ring has no walk; the far ring's walk comes out of the chosen time (owner's comment).
    expect(used(s, three)).toBe(3);
    expect(queueHours(len('gather', { hours: '3' }), s)).toBe(3);
    const a = gained(s, one, 'rawFood'), b = gained(s, three, 'rawFood');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThanOrEqual(2 * a);
    expect(b).toBeLessThanOrEqual(3 * a);
    // The berries thinned as you picked: the session's fall-off.
    expect(three.patches?.['1:berries']).toBeLessThan(one.patches?.['1:berries'] ?? 1);
  });

  it('2. until N: "gather wood until 10" stops at 10, or when the day ends with less', () => {
    const s = { ...warden(), stores: { ...warden().stores, firewood: 6 } };
    const until = runAction(s, len('wood', { until: '10' }));
    const day = runAction(s, len('wood', { hours: 'day' }));
    // Reached: 10 in the stores, and home before the whole day's session would be.
    expect(until.stores.firewood).toBeGreaterThanOrEqual(10);
    expect(until.stores.firewood).toBeLessThanOrEqual(day.stores.firewood);
    expect(used(s, until)).toBeLessThan(used(s, day));
    expect(until.log.some(l => /enough, and home/.test(l.text))).toBe(true);
    // Out of reach in a day (stone barely thins, so it's the day that runs out): the whole day, and less than N.
    const stone = runAction(s, len('quarry', { until: '50' }));
    expect(stone.stores.stone).toBeLessThan(50);
    expect(s.hoursToday + used(s, stone)).toBeGreaterThanOrEqual(13.75);
    // Already there: nothing to go out for.
    expect(blockedReason({ ...s, stores: { ...s.stores, firewood: 12 } }, 'wood', 1, { until: '10' })).toMatch(/already have 10 firewood/);
  });

  it('3. fixed actions: building, crafting, scouting and the hunt offer no length, and one sent anyway changes nothing', () => {
    const s = warden();
    for (const id of Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]) {
      const keys = (ACTIONS[id].options?.(s, {}) ?? []).map(g => g.key);
      expect(keys.includes('hours') || keys.includes('until')).toBe((LENGTH_ACTIONS as readonly string[]).includes(id));
    }
    for (const q of ['scout', 'hunt', 'build', 'rest', 'tinker']) {
      expect(sessionOf(s, len(q, { hours: '3' }))).toBeNull();
      expect(queueHours(len(q, { hours: '3' }), s)).toBe(queueHours(q as QueueItem, s));
    }
    const rested = runAction(s, 'rest'), restedLong = runAction(s, len('rest', { hours: '4' }));
    expect(restedLong.hoursToday).toBe(rested.hoursToday);
    expect(restedLong.vitals).toEqual(rested.vitals);
    // …and the API refuses it, saying why.
    const g = playedTo(startGame({ seed: 'len-fixed' }));
    const r = apply(g, { do: { q: 'rest', hours: 2 } as unknown as QueueItem });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fixed length/);
  });

  it('4. the API with hours: 2 gives the same result as the UI', () => {
    const g = playedTo(startGame({ seed: 'len-api' }));
    const viaApi = apply(g, { do: { q: 'gather', hours: 2 } as unknown as QueueItem });
    if (!viaApi.ok) throw new Error(viaApi.error);
    const viaUi = act(g.app, { q: 'gather', opts: { hours: '2' } });
    expect(viaApi.game.app.sim.stores).toEqual(viaUi.sim.stores);
    expect(viaApi.game.app.sim.hoursToday).toBe(viaUi.sim.hoursToday);
    expect(viaApi.game.app.sim.patches).toEqual(viaUi.sim.patches);
    expect(viaApi.game.app.sim.log.map(l => l.text)).toEqual(viaUi.sim.log.map(l => l.text));
    expect(viaApi.game.app.sim.hoursToday - g.app.sim.hoursToday).toBe(2);
    // `until` too, and a malformed length is refused rather than guessed at.
    expect(apply(g, { do: { q: 'gather', until: 3 } as unknown as QueueItem }).ok).toBe(true);
    const bad = apply(g, { do: { q: 'gather', hours: 'lots' } as unknown as QueueItem });
    expect(bad.ok).toBe(false);
  });

  it('5. with the switch off (or a run from before it), play equals today’s; on, an item with no length is today’s too', () => {
    const queue: QueueItem[] = [len('wood', { hours: '2' }), len('gather', { until: '20' }), len('quarry', { hours: 'day' }), 'water'];
    const plain: QueueItem[] = ['wood', 'gather', 'quarry', 'water'];
    for (const off of [false, 'absent'] as const) {
      const s = warden(off);
      expect(ACTIONS.wood.options?.(s, {})).toEqual([]);
      expect(sessionOf(s, queue[0])).toBeNull();
      const withLengths = runDay(endDay(runDay(s, queue).state), queue);
      const today = runDay(endDay(runDay(s, plain).state), plain);
      expect(withLengths.state).toEqual(today.state);
      expect(withLengths.state.patches).toBeUndefined();
    }
    // On, with no length chosen: the same day as with the switch off.
    const on = runDay(warden(true), plain).state, off = runDay(warden(false), plain).state;
    expect({ ...on, config: off.config }).toEqual(off);
  });

  it('6. at a far site, 4 hours fits fewer trips and yields less than near', () => {
    // A slight Warden, so a near load fills inside 4 hours.
    const s = warden(true, { far: true, str: 3 });
    const near = sessionOf(s, len('quarry', { hours: '4' }))!, far = sessionOf(s, len('quarry@2', { hours: '4' }))!;
    expect(far.plan.trips.length).toBeLessThan(near.plan.trips.length);
    expect(far.plan.travel).toBeGreaterThan(0);
    expect(gained(s, runAction(s, len('quarry@2', { hours: '4' })), 'stone')).toBeLessThan(gained(s, runAction(s, len('quarry', { hours: '4' })), 'stone'));
    // The planner on its own: the same work and load, with and without a 3h walk.
    const plan = (travel: number) => planTrips({ budget: 4, travel, start: { stone: 1 }, main: 'stone', bulkPerHour: { stone: 2 }, capacity: 4 });
    expect(plan(3).trips.length).toBeLessThan(plan(0).trips.length);
    expect(plan(3).harvest.stone!).toBeLessThan(plan(0).harvest.stone!);
  });

  it('7. over 4 hours the deadfall’s yield per trip falls; the standing timber’s barely does', () => {
    const s = warden(true, { str: 3 });
    const { trips } = sessionOf(s, len('wood', { hours: '4' }))!.plan;
    expect(trips.length).toBeGreaterThan(1);
    const perHour = (t: typeof trips[number], p: 'deadfall' | 'timber') => t.harvest[p]! / t.work;
    const first = trips[0], last = trips[trips.length - 1];
    expect(perHour(last, 'deadfall')).toBeLessThan(0.85 * perHour(first, 'deadfall'));
    expect(perHour(last, 'timber')).toBeGreaterThan(0.95 * perHour(first, 'timber'));
    expect(PATCHES.deadfall.perHour).toBeGreaterThan(10 * PATCHES.timber.perHour);
  });

  it('8. a depleted patch recovers over the following days', () => {
    let s = runAction(warden(), len('wood', { hours: 'day' }));
    const stripped = s.patches!['1:deadfall'];
    expect(stripped).toBeLessThan(0.5);
    s = { ...s, stores: { ...s.stores, rawFood: 20, water: 20, firewood: 20 } };
    const after1 = endDay(s);
    expect(after1.patches!['1:deadfall']).toBeGreaterThan(stripped);
    let t = after1;
    for (let i = 0; i < 10; i++) t = endDay({ ...t, stores: { ...t.stores, rawFood: 20, water: 20, firewood: 20 } });
    // Back to full, and forgotten.
    expect(t.patches?.['1:deadfall']).toBeUndefined();
    // A patch a night short of full comes all the way back, and the save forgets it.
    expect(recoverPatches({ '1:deadfall': 0.9 })).toBeUndefined();
    expect(recoverPatches({ '1:timber': 0.5 })).toEqual({ '1:timber': 0.51 });
  });

  it('9. the queue preview shows the plan: trips, the haul, and what is thinning', () => {
    const app = makeWarden({ id: 'w-preview' });
    const s = warden();
    const a: AppState = { ...app, sim: { ...s, config: { ...s.config, world: { ...s.config.world, features: app.sim.config.world.features } } }, queue: [len('wood', { hours: 'day' }), 'rest'] };
    const p = previewQueue(a);
    expect(p.plans[0]).toMatch(/^\d+ trips?, about \d+ firewood and \d+ materials, the deadfall is (getting thin|stripped)$/);
    expect(p.plans[1]).toBeNull();
    // The length is a choice in the queue item's menu, as the hunt's quarry is.
    const groups = ACTIONS.wood.options!(s, {}, 1);
    expect(groups.map(g => g.key)).toEqual(['hours', 'until']);
    expect(groups[0].choices.map(c => c.value)).toEqual(['usual', '1', '2', '3', '4', 'day']);
  });

  it('10. patches are saved only with the switch on, and a malformed set is dropped on load', () => {
    const on = runAction(warden(true), len('gather', { hours: '3' }));
    expect(on.patches).toEqual({ '1:berries': 0.7 });
    const app = { ...makeWarden({ id: 'w-save' }), sim: on };
    expect(deserialize(serialize(app))!.sim.patches).toEqual({ '1:berries': 0.7 });
    const raw = JSON.parse(serialize(app));
    raw.sim.patches = { '1:berries': 7, nonsense: 0.5 };
    expect(deserialize(JSON.stringify(raw))!.sim.patches).toBeUndefined();
    expect(validPatches({ '2:deadfall': 0.4 })).toBe(true);
    expect(validPatches({ '4:deadfall': 0.4 })).toBe(false);
    expect(validPatches([])).toBe(false);
    // Deterministic: the same session plans and plays the same.
    expect(runAction(warden(true), len('gather', { hours: '3' }))).toEqual(on);
  });
});

/** A seeded game past its first look round (so the near ring is known): actions there are open. */
function playedTo(g: Game): Game {
  // A new game explores where it used to scout (#1689).
  const r = apply(g, { do: 'explore' });
  if (!r.ok) throw new Error(r.error);
  return r.game;
}
