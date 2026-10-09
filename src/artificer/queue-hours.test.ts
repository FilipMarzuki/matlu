/**
 * Acceptance tests for #1475 — the plan's hours match the work's. `queueHours` feeds the app's
 * TODAY bar, each queued entry's hours and the AI's short-day question (#1473); it left out the
 * tools' time multipliers and, for crafts, the hand injury and pain the sim applies.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, queueHours, blockedReason, ACTIONS, type ActionId, type QueueItem, type Region1State } from './region1';
import { FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import type { Tool } from './crafting';
import type { Injury } from './injuries';

/** A Warden on scouted land, in clear weather with no accidents, and well stocked — with these tools and injuries. */
function warden(tools: Tool[] = [], injuries: Injury[] = []): Region1State {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-hours' });
  return { ...s, explore: scout(createExploration(), 1), tools, injuries, stores: { ...s.stores, rawFood: 20, water: 10, firewood: 20, materials: 30, stone: 20, hides: 5 } };
}
/** The hours running the item actually used. */
const used = (s: Region1State, item: QueueItem): number => runAction(s, item).hoursToday - s.hoursToday;

const POUCH: Tool = { item: 'pouch', grade: 'sound' };
const KNIFE: Tool = { item: 'stone-knife', grade: 'fine' };
const HURT_HAND: Injury = { kind: 'hand', severity: 'serious', heal: 4 };

describe('A plan’s hours are the work’s hours (#1475)', () => {
  // 1. A pouch speeds gathering: the estimate takes it in.
  it('counts a tool that speeds the work', () => {
    const s = warden([POUCH]);
    expect(used(s, 'gather')).toBeLessThan(used(warden(), 'gather'));
    expect(queueHours('gather', s)).toBeCloseTo(used(s, 'gather'), 6);
    // A stone knife speeds preserving.
    const k = warden([KNIFE]);
    expect(queueHours('preserve', k)).toBeCloseTo(used(k, 'preserve'), 6);
  });

  // 2. A hurt hand slows a craft: the estimate takes it in.
  it('counts a hand injury on a craft', () => {
    const s = warden([], [HURT_HAND]);
    expect(used(s, 'knife')).toBeGreaterThan(used(warden(), 'knife'));
    expect(queueHours('knife', s)).toBeCloseTo(used(s, 'knife'), 6);
  });

  // 3. Every action that isn't refused, plain and tooled: the estimate is the run.
  it('matches the run for every action', () => {
    for (const s of [warden(), warden([POUCH, KNIFE], [HURT_HAND])]) {
      for (const id of Object.keys(ACTIONS) as ActionId[]) {
        if (blockedReason(s, id, 1, {})) continue;
        expect([id, queueHours(id, s)]).toEqual([id, expect.closeTo(used(s, id), 6)]);
      }
    }
  });
});
