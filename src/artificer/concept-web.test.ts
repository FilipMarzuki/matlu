/**
 * Acceptance tests for #1459 — the concept web (concepts.json, prerequisites
 * and rank caps) loaded into Region 1's CRAFT_WORLD. One test per
 * Given/When/Then criterion (1–5) in the issue.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, ACTIONS, CRAFT_WORLD, STUDY_CONCEPTS, type Region1State } from './region1';
import { addInsight, type ConceptProgress } from './crafting';

const REGION_1_CONCEPTS = ['joinery', 'tension', 'sealing', 'leverage', 'sharpening', 'weaving'];

const conceptChoices = (s: Region1State): string[] =>
  (ACTIONS.study.options?.(s, {}) ?? []).find(g => g.key === 'concept')?.choices.map(c => c.value) ?? [];

describe('Concept web (#1459)', () => {
  // 1. The full 31-concept web is loaded, with its prerequisites intact.
  it('loads concepts.json: 31 concepts, and bearings requires friction:1 and rotation:1', () => {
    expect(Object.keys(CRAFT_WORLD.concepts)).toHaveLength(31);
    expect(CRAFT_WORLD.concepts.bearings?.requires).toEqual(['friction:1', 'rotation:1']);
  });

  // 2. A locked concept is refused, naming its prerequisites, at no cost.
  it('refuses studying a locked concept, naming its prerequisites, at no cost', () => {
    const s = createRegion1();
    const after = runAction(s, { q: 'study', opts: { concept: 'bearings' } });
    expect(after.log.at(-1)?.text).toMatch(/friction/);
    expect(after.log.at(-1)?.text).toMatch(/rotation/);
    expect(after.vitals).toEqual(s.vitals);
    expect(after.concepts.bearings).toBeUndefined();
  });

  // 3. Meeting the prerequisites opens the concept, and it appears among the study options.
  it('opens a concept once its prerequisites are met, and lists it as a study option', () => {
    const s: Region1State = {
      ...createRegion1(),
      concepts: { friction: { rank: 1, insight: 0 }, rotation: { rank: 1, insight: 0 } },
    };
    const after = runAction(s, { q: 'study', opts: { concept: 'bearings' } });
    expect(after.concepts.bearings?.insight).toBeGreaterThan(0);
    expect(conceptChoices(s)).toContain('bearings');
  });

  // 4. A concept stays at its registry rank cap; further insight is discarded.
  it('caps a concept at its registry rank and discards extra insight past the cap', () => {
    const concepts: Record<string, ConceptProgress> = { sealing: { rank: 2, insight: 0 } };
    addInsight(concepts, 'sealing', 50, CRAFT_WORLD.concepts);
    expect(concepts.sealing).toEqual({ rank: 2, insight: 0 });
  });

  // 5. A fresh Warden's study options are exactly the six Region 1 concepts — nothing else is open yet.
  it('lists exactly the six Region 1 concepts for a fresh Warden', () => {
    const s = createRegion1();
    expect(conceptChoices(s).slice().sort()).toEqual(REGION_1_CONCEPTS.slice().sort());
    expect(STUDY_CONCEPTS(s).slice().sort()).toEqual(REGION_1_CONCEPTS.slice().sort());
  });
});
