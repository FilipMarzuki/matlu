/**
 * Acceptance tests for #1456 — items carry the maker's understanding: a crafted tool records the
 * concept ranks of the hand that made it, and an heirloom teaches those concepts to the Warden
 * who uses it, once per item per run. One test per Given/When/Then.
 */

import { describe, it, expect } from 'vitest';
import { craft, createCrafter, heirloomLesson, HEIRLOOM_INSIGHT, GRADE_MULT, INSIGHT_TO_NEXT, type CraftRecipe, type Tool } from './crafting';
import { createVitals } from './vitality';
import { createRegion1, runAction, type Region1State } from './region1';
import { heirloomsOf } from './legacy';
import { observe } from '../artificer-ai/observe';
import { deserialize, serialize } from '../artificer-app/controller';

/** A two-concept recipe for a tool that has effects (so it becomes a graded tool, not inventory). */
const SNARE: CraftRecipe = { id: 'snare', name: 'Snare', inputs: [{ item: 'cord', qty: 1 }], output: { item: 'trap-snare', qty: 1 }, tier: 0, station: null, timeBase: 2, concepts: ['tension', 'weaving'] };

/** A scouted Warden holding `tools`, with food to preserve (the stone knife serves preserving). */
function warden(tools: Tool[]): Region1State {
  const s = runAction(createRegion1(), 'scout');
  return { ...s, tools, stores: { ...s.stores, rawFood: 10 } };
}
const KNIFE: Tool = { item: 'stone-knife', grade: 'fine', heirloom: true, made: { sharpening: 2 } };

describe('Items carry the maker’s understanding (#1456)', () => {
  // 1. A successful craft records the recipe's concepts at the maker's ranks; a failed one makes no tool.
  it('records the maker’s ranks on a crafted tool', () => {
    const maker = createCrafter(createVitals(), { inventory: { cord: 2 }, concepts: { tension: { rank: 2, insight: 0 } } });
    const made = craft(maker, SNARE);
    expect(made.result.kind).toBe('crafted');
    expect(made.state.tools).toEqual([{ item: 'trap-snare', grade: expect.any(String), made: { tension: 2, weaving: 0 } }]);
    // Too foggy to work: the craft fails, and nothing is made.
    const foggy = createCrafter(createVitals({ clarity: 0 }), { inventory: { cord: 2 } });
    const failed = craft(foggy, SNARE);
    expect(failed.result.kind).toBe('failed');
    expect(failed.state.tools).toEqual([]);
  });

  // 2. First use of an heirloom teaches its concepts: rank × HEIRLOOM_INSIGHT × the grade's multiplier.
  it('teaches the concepts an heirloom holds on first use', () => {
    expect(heirloomLesson(KNIFE)).toEqual([{ concept: 'sharpening', insight: 2 * HEIRLOOM_INSIGHT * GRADE_MULT.fine }]);
    const s = runAction(warden([KNIFE]), 'preserve');
    const gained = 2 * HEIRLOOM_INSIGHT * GRADE_MULT.fine; // 9: rank 1 at once (6), and 3 towards rank 2
    expect(gained).toBeGreaterThan(INSIGHT_TO_NEXT[0]);
    expect(s.concepts.sharpening).toEqual({ rank: 1, insight: gained - INSIGHT_TO_NEXT[0] });
    expect(s.taughtBy).toEqual(['stone-knife']);
    expect(s.log.map(l => l.text).join('\n')).toMatch(/stone knife teaches you something of its making: sharpening \+9 insight \(rank 1\)/);
  });

  // 3. Using it again teaches nothing more: once per item per run.
  it('teaches once per item per run', () => {
    const once = runAction(warden([KNIFE]), 'preserve');
    const twice = runAction({ ...once, hoursToday: 0 }, 'preserve');
    expect(twice.concepts.sharpening).toEqual(once.concepts.sharpening);
    expect(twice.taughtBy).toEqual(['stone-knife']);
    expect(twice.log.filter(l => /teaches you/.test(l.text))).toHaveLength(1);
  });

  // 4. An heirloom with nothing recorded (made before this, or by a rank-0 hand) teaches nothing and breaks nothing.
  it('is harmless for an heirloom with no understanding in it', () => {
    for (const tool of [{ item: 'stone-knife', grade: 'fine', heirloom: true }, { ...KNIFE, made: { sharpening: 0 } }] as Tool[]) {
      const s = runAction(warden([tool]), 'preserve');
      expect(s.concepts).toEqual({});
      expect(s.taughtBy).toBeUndefined();
    }
    // Your own tool doesn't teach you what you already put into it.
    const own = runAction(warden([{ ...KNIFE, heirloom: false }]), 'preserve');
    expect(own.concepts).toEqual({});
  });

  // 5. `made` survives the end of a run, the next run's start, and a save.
  it('keeps the maker’s understanding through heirlooms and saves', () => {
    const ended = { ...warden([{ item: 'stone-knife', grade: 'masterwork', made: { sharpening: 3 } }]), outcome: { choice: 'thaw' as const, kind: 'survived' as const, vitals: createVitals() } };
    const next = createRegion1({}, heirloomsOf(ended));
    expect(next.tools).toContainEqual({ item: 'stone-knife', grade: 'masterwork', heirloom: true, made: { sharpening: 3 } });
    const loaded = deserialize(serialize({ sim: runAction({ ...next, stores: { ...next.stores, rawFood: 10 } }, 'scout'), queue: [], stage: 'reach' }));
    expect(loaded?.sim.tools).toEqual(next.tools);
  });

  // 6. The AI sees what an unlearned heirloom holds, and nothing once it has taught.
  it('tells the AI what an heirloom still holds', () => {
    const before = warden([KNIFE]);
    expect(observe(before)).toMatch(/TOOLS: stone-knife \(fine, holds sharpening 2\)/);
    const after = runAction(before, 'preserve');
    expect(observe(after)).toMatch(/TOOLS: stone-knife \(fine\)/);
  });
});
