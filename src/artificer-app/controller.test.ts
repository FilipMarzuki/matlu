/**
 * Tests for #1209 — the Artificer web frontend's controller (queue + save).
 * The DOM itself is exempt (ui-menus); these cover the rules it relies on.
 */

import { describe, it, expect } from 'vitest';
import { newGame, enqueue, dequeueAt, clearQueue, runQueuedDay, runWholeQueue, settle, takeExit, previewQueue, serialize, deserialize, SAVE_VERSION, type AppState } from './controller';
import { DEFAULT_CALENDAR } from '../artificer/winter';

const withQueue = (a: AppState, ids: Parameters<typeof enqueue>[1][]): AppState => ids.reduce(enqueue, a);

describe('Artificer controller', () => {
  // 1. Queue editing is pure.
  it('adds, removes and clears queued actions without mutating', () => {
    const a = newGame();
    const q = withQueue(a, ['scout', 'water', 'wood']);
    expect(q.queue).toEqual(['scout', 'water', 'wood']);
    expect(dequeueAt(q, 1).queue).toEqual(['scout', 'wood']);
    expect(dequeueAt(q, 9).queue).toEqual(q.queue); // out of range is a no-op
    expect(clearQueue(q).queue).toEqual([]);
    expect(a.queue).toEqual([]);
  });

  // 2. Running a day runs what fits and keeps the rest.
  it('runs one day of the queue and carries the remainder', () => {
    const a = withQueue(newGame(), ['scout', 'wood', 'wood', 'wood', 'water']);
    const r = runQueuedDay(a);
    // scout 4h + 3×wood 12h → the 3rd wood starts at 12h (< 14) and finishes; water waits
    expect(r.queue).toEqual(['water']);
    expect(r.sim.day).toBe(2);
    expect(r.sim.knowledge.scouted).toBe(true);
  });

  // 3. Running the whole queue drains it across days.
  it('drains a multi-day queue', () => {
    const a = withQueue(newGame(), ['scout', 'wood', 'wood', 'wood', 'water', 'wood', 'wood']);
    const r = runWholeQueue(a);
    expect(r.queue).toEqual([]);
    expect(r.sim.day).toBe(3);
    // An empty queue is a no-op (no day passes).
    expect(runWholeQueue(r).sim.day).toBe(3);
  });

  // 4. The preview splits days like runDay and flags skips against the plan so far.
  it('previews day splits and warns about actions that would be skipped', () => {
    const a = withQueue(newGame(), ['gather', 'scout', 'gather', 'wood', 'wood']);
    const p = previewQueue(a);
    // gather is refused (no hours), scout 4, gather 5 → 9, wood → 13, next wood still starts today
    expect(p.dayOffset).toEqual([0, 0, 0, 0, 0]);
    expect(p.warnings[0]).toMatch(/scout first/);
    expect(p.warnings.slice(1)).toEqual([null, null, null, null]);
    expect(withQueue(a, ['water']).queue.length).toBe(6);
    expect(previewQueue(withQueue(a, ['water'])).dayOffset[5]).toBe(1);
  });

  // 5. Sites and exits go through the sim; exits stay calendar-gated and clear the plan.
  it('settles a site and only takes exits the calendar has opened', () => {
    let a = settle(runQueuedDay(withQueue(newGame(), ['scout'])), 'cave');
    expect(a.sim.site).toBe('cave');
    expect(() => takeExit(a, 'caravan')).toThrow(/not available/);
    while (a.sim.day < DEFAULT_CALENDAR.caravanOpen) a = runQueuedDay(a);
    const left = takeExit(enqueue(a, 'rest'), 'winter');
    expect(left.sim.outcome?.choice).toBe('winter');
    expect(left.queue).toEqual([]);
    // Once resolved, the queue can't grow and days don't run.
    expect(enqueue(left, 'rest')).toBe(left);
    expect(runQueuedDay(left)).toBe(left);
  });

  // 6. Saves round-trip; anything malformed or stale is rejected (never throws).
  it('round-trips a save and rejects corrupt or wrong-version data', () => {
    const a = runQueuedDay(withQueue(newGame(), ['scout', 'water', 'wood', 'wood', 'gather']));
    expect(deserialize(serialize(a))).toEqual(a);

    expect(deserialize(null)).toBeNull();
    expect(deserialize('')).toBeNull();
    expect(deserialize('{not json')).toBeNull();
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION + 1, sim: a.sim, queue: [] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: a.sim, queue: ['fly'] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: { ...a.sim, vitals: null }, queue: [] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: { ...a.sim, day: 'one' }, queue: [] }))).toBeNull();
  });
});
