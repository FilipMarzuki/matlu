/**
 * Acceptance tests for #1456 — items carry the maker's understanding: crafted tools record
 * concept ranks and teach on use. Criteria 1–5 (the sim); criterion 6 (the AI's TOOLS line) is
 * in src/artificer-ai/observe.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { craft, createCrafter, craftWorld, addInsight, heirloomLesson, HEIRLOOM_INSIGHT, GRADE_MULT, type CraftRecipe, type ConceptProgress, type Tool } from './crafting';
import { createVitals } from './vitality';
import { createRegion1, runAction, type Region1State } from './region1';
import { heirloomsOf } from './legacy';
import { createExploration, scout, track } from './exploration';

const GADGET: CraftRecipe = { id: 'gadget', name: 'Gadget', inputs: [{ item: 'materials', qty: 1 }], output: { item: 'gadget', qty: 1 }, tier: 0, station: null, timeBase: 1, concepts: ['tension', 'weaving'] };
const GADGET_WORLD = craftWorld([], [], { gadget: {} });

/** A fresh Warden, game tracked in ring 1 so the default (deer) hunt isn't blocked, with `tools`. */
function huntReady(tools: Tool[]): Region1State {
  return { ...createRegion1(), explore: track(scout(createExploration(), 1), 1), tools };
}

describe('Items carry the maker\'s understanding (#1456)', () => {
  // 1. A recipe's concepts, at the maker's ranks, ride along on the tool it becomes — a failed craft makes no tool.
  it('given a recipe with concepts [tension, weaving] and a crafter at tension 2, weaving 0, records the maker\'s ranks on success; a failed craft makes no tool', () => {
    const skilled = createCrafter(createVitals(), { inventory: { materials: 5 }, concepts: { tension: { rank: 2, insight: 0 }, weaving: { rank: 0, insight: 0 } } });
    const made = craft(skilled, GADGET, GADGET_WORLD);
    expect(made.result.kind).toBe('crafted');
    expect(made.state.tools).toEqual([{ item: 'gadget', grade: 'sound', made: { tension: 2, weaving: 0 } }]);

    const tired = createCrafter(createVitals({ clarity: 10 }), { inventory: { materials: 5 } });
    const failed = craft(tired, GADGET, GADGET_WORLD);
    expect(failed.result.kind).toBe('failed');
    expect(failed.state.tools).toEqual([]);
  });

  // 2. The first action an heirloom serves teaches its maker's ranks, scaled by the tool's grade.
  it('given an unlearned heirloom stone-knife (fine, made: { sharpening: 2 }), teaches sharpening the first time it serves an action (hunt)', () => {
    const knife: Tool = { item: 'stone-knife', grade: 'fine', heirloom: true, made: { sharpening: 2 } };
    const s = huntReady([knife]);
    expect(s.concepts.sharpening).toBeUndefined();

    const hunted = runAction(s, 'hunt');
    const expected: Record<string, ConceptProgress> = {};
    addInsight(expected, 'sharpening', 2 * HEIRLOOM_INSIGHT * GRADE_MULT.fine, {});
    expect(hunted.concepts.sharpening).toEqual(expected.sharpening);
    expect(hunted.taughtBy).toEqual(['stone-knife']);
    expect(hunted.log.some(l => /stone knife teaches you what its maker knew: sharpening/.test(l.text))).toBe(true);
  });

  // 3. Once an item has taught, it teaches no more that run — the same day or later.
  it('given the same Warden after that first use, gains nothing more from the knife — the same day or later', () => {
    const knife: Tool = { item: 'stone-knife', grade: 'fine', heirloom: true, made: { sharpening: 2 } };
    const first = runAction(huntReady([knife]), 'hunt');

    const again = runAction(first, 'hunt');
    expect(again.concepts.sharpening).toEqual(first.concepts.sharpening);
    expect(again.taughtBy).toEqual(['stone-knife']);

    const later = runAction({ ...first, day: first.day + 1, hoursToday: 0 }, 'hunt');
    expect(later.concepts.sharpening).toEqual(first.concepts.sharpening);
    expect(later.taughtBy).toEqual(['stone-knife']);
  });

  // 4. An heirloom made before this change has no `made` — using it teaches nothing, and doesn't throw.
  it('given an heirloom with no made (from before this change), using it teaches nothing and never throws', () => {
    const oldKnife: Tool = { item: 'stone-knife', grade: 'fine', heirloom: true };
    const s = huntReady([oldKnife]);
    expect(() => runAction(s, 'hunt')).not.toThrow();
    const hunted = runAction(s, 'hunt');
    expect(hunted.concepts.sharpening).toBeUndefined();
    expect(hunted.taughtBy).toBeUndefined();
  });

  // 5. `made` round-trips through heirlooms and a save.
  it('keeps `made` through heirlooms, a new run, and a save round trip', () => {
    const ended = { ...createRegion1(), tools: [{ item: 'stone-knife', grade: 'fine' as const, made: { sharpening: 2 } }] };
    const legacy = heirloomsOf(ended);
    expect(legacy.heirlooms).toEqual([{ item: 'stone-knife', grade: 'fine', made: { sharpening: 2 }, heirloom: true }]);

    const next = createRegion1({}, legacy);
    expect(next.tools).toContainEqual({ item: 'stone-knife', grade: 'fine', made: { sharpening: 2 }, heirloom: true });

    const roundTripped: Region1State = JSON.parse(JSON.stringify(next));
    expect(roundTripped.tools).toEqual(next.tools);
  });
});

/** #1469 — only heirlooms teach; every heirloom in use teaches; a lesson waits for room; lessons follow the grade made at. */
describe('Heirloom teaching follow-up (#1469)', () => {
  const knife: Tool = { item: 'stone-knife', grade: 'fine', heirloom: true, made: { sharpening: 2 } };

  // 1. Your own tool doesn't teach you back what you put into it.
  it('given the Warden’s own tool with made, using it teaches nothing', () => {
    const own = runAction(huntReady([{ ...knife, heirloom: undefined }]), 'hunt');
    expect(own.concepts.sharpening).toBeUndefined();
    expect(own.taughtBy).toBeUndefined();
  });

  // 2. Two heirlooms that both serve the action: both teach.
  it('given two heirlooms serving hunt, both teach', () => {
    const skinning: Tool = { item: 'skinning-knife', grade: 'sound', heirloom: true, made: { sharpening: 1 } };
    const hunted = runAction(huntReady([knife, skinning]), 'hunt');
    const expected: Record<string, ConceptProgress> = {};
    addInsight(expected, 'sharpening', 2 * HEIRLOOM_INSIGHT * GRADE_MULT.fine, {});
    addInsight(expected, 'sharpening', 1 * HEIRLOOM_INSIGHT * GRADE_MULT.sound, {});
    expect(hunted.concepts.sharpening).toEqual(expected.sharpening);
    expect(hunted.taughtBy).toEqual(['stone-knife', 'skinning-knife']);
  });

  // 3. A concept already at its full rank takes nothing — and the lesson isn't spent.
  it('given sharpening at its full rank, the knife keeps its lesson', () => {
    const full = { ...huntReady([knife]), concepts: { sharpening: { rank: 3, insight: 0 } } };
    const hunted = runAction(full, 'hunt');
    expect(hunted.concepts.sharpening).toEqual({ rank: 3, insight: 0 });
    expect(hunted.taughtBy).toBeUndefined();
    expect(hunted.log.some(l => /teaches you/.test(l.text))).toBe(false);
  });

  // 4. A knife made fine and since dented to sound teaches at fine.
  it('given a dented heirloom, the lesson follows the grade it was made at', () => {
    expect(heirloomLesson({ ...knife, grade: 'sound', crafted: 'fine' })).toEqual([{ concept: 'sharpening', insight: 2 * HEIRLOOM_INSIGHT * GRADE_MULT.fine }]);
    expect(heirloomLesson({ ...knife, grade: 'sound' })).toEqual([{ concept: 'sharpening', insight: 2 * HEIRLOOM_INSIGHT * GRADE_MULT.sound }]);
  });
});
