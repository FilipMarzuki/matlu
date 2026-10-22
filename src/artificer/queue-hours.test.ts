/**
 * Acceptance tests for #1475 — the plan's hours match the work's. `queueHours` feeds the app's
 * TODAY bar, each queued entry's hours and the AI's short-day question (#1473); it left out the
 * tools' time multipliers and, for crafts, the hand injury and pain the sim applies. Now the run
 * and the estimate share one reckoning, so they agree exactly.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, queueHours, blockedReason, ACTIONS, type ActionId, type QueueItem, type Region1State } from './region1';
import { FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { observe } from '../artificer-ai/observe';
import type { Tool } from './crafting';
import type { Injury } from './injuries';
import type { KitId } from './kit';

/** A Warden on scouted land, camped at the river, in clear weather with no accidents, and well stocked. */
function warden(over: Partial<Region1State> = {}, pack: KitId[] = []): Region1State {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-hours', pack });
  return {
    ...s, site: 'river', explore: scout(scout(scout(createExploration(), 1), 2), 3),
    stores: { ...s.stores, rawFood: 20, water: 10, firewood: 20, materials: 30, stone: 20, hides: 5 }, ...over,
  };
}
/** The hours running the item actually used (the day starts at 0, so this is exact). */
const used = (s: Region1State, item: QueueItem): number => runAction(s, item).hoursToday - s.hoursToday;

const POUCH: Tool = { item: 'pouch', grade: 'fine' };
const KNIFE: Tool = { item: 'stone-knife', grade: 'fine' };
const HURT_HAND: Injury = { kind: 'hand', severity: 'serious', heal: 4 };

describe('A plan’s hours are the work’s hours (#1475)', () => {
  // 1. A pouch speeds gathering: the estimate takes it in.
  it('counts a tool that speeds the work', () => {
    const s = warden({ tools: [POUCH] });
    expect(used(s, 'gather')).toBeLessThan(used(warden(), 'gather'));
    expect(queueHours('gather', s)).toBe(used(s, 'gather'));
    // A stone knife speeds preserving.
    const k = warden({ tools: [KNIFE] });
    expect(queueHours('preserve', k)).toBe(used(k, 'preserve'));
  });

  // 2. A hurt hand slows a craft, and agony slows it more: the estimate takes both in.
  it('counts a hand injury and pain on a craft', () => {
    const s = warden({ injuries: [HURT_HAND] });
    expect(used(s, 'knife')).toBeGreaterThan(used(warden(), 'knife'));
    expect(queueHours('knife', s)).toBe(used(s, 'knife'));
    const agony = warden({ injuries: [HURT_HAND], today: { ...s.today, pain: 3 } });
    expect(used(agony, 'knife')).toBeGreaterThan(used(s, 'knife'));
    expect(queueHours('knife', agony)).toBe(used(agony, 'knife'));
  });

  // 3. Every action that isn't refused, on every ring it can go to, in plain, tooled, rainy and hurting
  //    states: the estimate is the run. (FLAT_WORLD carries no load limits, so no overloaded walk home.)
  it('matches the run for every action', () => {
    const plain = warden();
    const states = [
      plain,
      warden({ tools: [POUCH, KNIFE], injuries: [HURT_HAND] }),
      warden({ tools: [POUCH], weatherToday: 'rain' }),
      warden({ injuries: [HURT_HAND], today: { ...plain.today, pain: 3 } }),
    ];
    let checked = 0;
    for (const s of states) {
      for (const id of Object.keys(ACTIONS) as ActionId[]) {
        for (const ring of ACTIONS[id].ringed ? [1, 2, 3] as const : [1] as const) {
          if (blockedReason(s, id, ring, {})) continue;
          const item: QueueItem = ring === 1 ? id : `${id}@${ring}` as QueueItem;
          expect([item, queueHours(item, s)]).toEqual([item, used(s, item)]);
          checked++;
        }
      }
    }
    // Builds and camp work are among them now that the Warden has a camp.
    expect(checked).toBeGreaterThan(60);
  });

  // A build somewhere new moves camp first — and with the tarp, the new camp already has a roof.
  it('estimates a build that moves camp from the new ground', () => {
    // A Warden who knows the brush hut (11 h) asks for one at the cave. The tarp goes up there first,
    // so the camp already has a roof and the build is the walls (8 h) — the hours of the walls.
    const base = warden({}, ['tarp']);
    const s = { ...base, known: [...base.known, 'shelter-hut'] };
    const item = { q: 'build' as const, opts: { site: 'cave', type: 'hut' } };
    expect(blockedReason(s, 'build', 1, item.opts)).toBeNull();
    expect(used(s, item)).toBe(8);
    expect(queueHours(item, s)).toBe(used(s, item));
  });

  // The AI's action list shows hours to a tenth, not floating-point noise.
  it('shows the AI tidy hours', () => {
    const text = observe(warden({ tools: [KNIFE], injuries: [HURT_HAND] }));
    expect(text).toMatch(/· \d+(\.\d)?h ·/);
    expect(text).not.toMatch(/\d\.\d{2,}h/);
  });
});
