/**
 * Tests for #1743 — moving a queued task (`moveQueued`): the plan changes order and nothing else;
 * the preview follows; a locked queue or a finished run stays put; the order is saved.
 */

import { describe, it, expect } from 'vitest';
import { SHORT_YEAR } from '../artificer/test-helpers';
import { createRegion1 } from '../artificer/region1';
import { FLAT_WORLD } from '../artificer/world';
import { newGame, enqueue, moveQueued, previewQueue, serialize, deserialize, type AppState } from './controller';

const flatGame = (): AppState => ({ ...newGame(), sim: createRegion1({ world: FLAT_WORLD, calendar: SHORT_YEAR }, undefined, { id: 'w-move' }) });
const withQueue = (a: AppState, ids: Parameters<typeof enqueue>[1][]): AppState => ids.reduce(enqueue, a);

describe('moveQueued', () => {
  const plan = (): AppState => withQueue(flatGame(), ['scout', 'wood', 'wood', 'wood', 'water']);

  it('moves a task up and down', () => {
    expect(moveQueued(plan(), 4, 0).queue).toEqual(['water', 'scout', 'wood', 'wood', 'wood']);
    expect(moveQueued(plan(), 0, 3).queue).toEqual(['wood', 'wood', 'wood', 'scout', 'water']);
  });

  it('is a no-op for the same place or out of range, and never mutates', () => {
    const a = plan();
    expect(moveQueued(a, 2, 2)).toBe(a);
    expect(moveQueued(a, -1, 0)).toBe(a);
    expect(moveQueued(a, 0, 5)).toBe(a);
    expect(moveQueued(a, 9, 1)).toBe(a);
    moveQueued(a, 4, 0);
    expect(a.queue).toEqual(['scout', 'wood', 'wood', 'wood', 'water']);
  });

  it('keeps an option chosen on a task with that task', () => {
    const a: AppState = { ...plan(), queue: ['scout', { q: 'wood', opts: { hours: '2' } }, 'water'] };
    expect(moveQueued(a, 1, 2).queue).toEqual(['scout', 'water', { q: 'wood', opts: { hours: '2' } }]);
  });

  it('leaves the queue alone before planning is learned, once the run is over, and on the road', () => {
    const base = plan();
    const locked: AppState = { ...base, sim: { ...base.sim, canPlan: false } };
    expect(moveQueued(locked, 4, 0)).toBe(locked);
    const over: AppState = { ...base, sim: { ...base.sim, outcome: { kind: 'died', day: 3 } as unknown as AppState['sim']['outcome'] } };
    expect(moveQueued(over, 4, 0)).toBe(over);
    const road: AppState = { ...base, stage: 'road' };
    expect(moveQueued(road, 4, 0)).toBe(road);
  });

  it('the preview is recomputed for the new order', () => {
    const a = plan();
    // scout 4h + three wood 12h fill the day: water starts tomorrow.
    expect(previewQueue(a).dayOffset[4]).toBe(1);
    const moved = moveQueued(a, 4, 0);
    // Moved to the front, water runs today.
    expect(previewQueue(moved).dayOffset[0]).toBe(0);
    expect(previewQueue(moved)).toEqual(previewQueue({ ...a, queue: ['water', 'scout', 'wood', 'wood', 'wood'] }));
  });

  it('the new order is saved and restored', () => {
    const moved = moveQueued(plan(), 4, 1);
    expect(deserialize(serialize(moved))?.queue).toEqual(['scout', 'water', 'wood', 'wood', 'wood']);
  });
});
