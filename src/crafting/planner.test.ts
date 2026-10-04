/**
 * Acceptance tests for #1184 — the sub-action planner. One test per
 * Given/When/Then criterion. Fixtures are local so the tests don't depend on
 * the live recipes.json balance.
 */

import { describe, it, expect } from 'vitest';
import {
  nextStep, AUTOMATION_NONE, AUTOMATION_HARVEST, AUTOMATION_WORKSHOP, AUTOMATION_FULL, type Automation,
  GUILD_RANKS, rankByName,
} from './planner';
import type { HarvestSource, Recipe } from './ActionQueue';

const PLANK: Recipe = { id: 'plank', name: 'Plank', inputs: [{ item: 'wood-log', qty: 2 }], output: { item: 'plank', qty: 1 }, timeBase: 3 };
const ROPE: Recipe = { id: 'rope', name: 'Rope', inputs: [{ item: 'plant-fiber', qty: 4 }], output: { item: 'rope', qty: 1 }, timeBase: 2 };
const SNARE: Recipe = { id: 'snare', name: 'Snare', inputs: [{ item: 'rope', qty: 1 }, { item: 'wood-log', qty: 1 }], output: { item: 'snare', qty: 1 }, timeBase: 3 };
const RECIPES = [PLANK, ROPE, SNARE];

const PINE: HarvestSource = { id: 'pine', label: 'Pine', yields: [{ itemId: 'wood-log', min: 1, max: 2 }], durationTicks: 5 };
const OAK: HarvestSource = { id: 'oak', label: 'Oak', yields: [{ itemId: 'wood-log', min: 2, max: 3 }], durationTicks: 5 };
const MEADOW: HarvestSource = { id: 'meadow', label: 'Meadow', yields: [{ itemId: 'plant-fiber', min: 1, max: 1 }], durationTicks: 2 };
const SOURCES = [PINE, OAK, MEADOW];

/** Tiny inventory stub: the planner only reads. */
function inv(stock: Record<string, number> = {}) {
  return {
    getQty: (id: string) => stock[id] ?? 0,
    has: (id: string, qty = 1) => (stock[id] ?? 0) >= qty,
  };
}

const goal = (recipeId: string, depth = 0) => ({ recipeId, depth });

describe('nextStep (#1184 acceptance)', () => {
  it('1. given 2 wood-log and goal plank, any automation → craft', () => {
    for (const a of [AUTOMATION_NONE, AUTOMATION_HARVEST, AUTOMATION_WORKSHOP, AUTOMATION_FULL]) {
      expect(nextStep(goal('plank'), inv({ 'wood-log': 2 }), RECIPES, SOURCES, a)).toEqual({ kind: 'craft' });
    }
  });

  it('2. given empty inventory, goal plank, sources [pine, oak], HARVEST → harvest oak (higher expected yield)', () => {
    expect(nextStep(goal('plank'), inv(), RECIPES, [PINE, OAK], AUTOMATION_HARVEST))
      .toEqual({ kind: 'harvest', sourceId: 'oak', itemId: 'wood-log' });
  });

  it('3. given empty inventory, goal snare, WORKSHOP → subgoal rope (first missing input is craftable)', () => {
    expect(nextStep(goal('snare'), inv(), RECIPES, SOURCES, AUTOMATION_WORKSHOP))
      .toEqual({ kind: 'subgoal', recipeId: 'rope', itemId: 'rope' });
  });

  it('4. given the same but HARVEST → blocked: automation on rope', () => {
    expect(nextStep(goal('snare'), inv(), RECIPES, SOURCES, AUTOMATION_HARVEST))
      .toEqual({ kind: 'blocked', itemId: 'rope', reason: 'automation' });
  });

  it('5. given goal snare at depth 1 with WORKSHOP (maxDepth 1), empty inventory → blocked: depth on rope', () => {
    expect(nextStep(goal('snare', 1), inv(), RECIPES, SOURCES, AUTOMATION_WORKSHOP))
      .toEqual({ kind: 'blocked', itemId: 'rope', reason: 'depth' });
  });

  it('6. given 1 rope but no wood-log, goal snare, WORKSHOP → harvest wood-log (first missing input, not first input)', () => {
    const step = nextStep(goal('snare'), inv({ rope: 1 }), RECIPES, SOURCES, AUTOMATION_WORKSHOP);
    expect(step).toEqual({ kind: 'harvest', sourceId: 'oak', itemId: 'wood-log' });
  });

  it('7. given goal plank with nothing producing wood-log, FULL → blocked: no-source', () => {
    expect(nextStep(goal('plank'), inv(), [PLANK], [MEADOW], AUTOMATION_FULL))
      .toEqual({ kind: 'blocked', itemId: 'wood-log', reason: 'no-source' });
  });

  it('8. given recipes A (b→a) and B (a→b), goal A with ancestry [b], FULL → blocked: cycle on b', () => {
    const A: Recipe = { id: 'a', name: 'A', inputs: [{ item: 'b', qty: 1 }], output: { item: 'a', qty: 1 }, timeBase: 1 };
    const B: Recipe = { id: 'b', name: 'B', inputs: [{ item: 'a', qty: 1 }], output: { item: 'b', qty: 1 }, timeBase: 1 };
    expect(nextStep(goal('a', 1), inv(), [A, B], [], AUTOMATION_FULL, ['b']))
      .toEqual({ kind: 'blocked', itemId: 'b', reason: 'cycle' });
  });

  it('9. given any inputs, two calls are deeply equal (pure)', () => {
    const args: [ReturnType<typeof goal>, ReturnType<typeof inv>, Recipe[], HarvestSource[], Automation] =
      [goal('snare'), inv({ 'plant-fiber': 1 }), RECIPES, SOURCES, AUTOMATION_FULL];
    expect(nextStep(...args)).toEqual(nextStep(...args));
  });
});

// #1195 — automation tiers are the Workshop-Towns guild ranks.
describe('guild ranks (#1195 acceptance)', () => {
  it('1. GUILD_RANKS has the four ranks in ascending order with the agreed capabilities', () => {
    expect(GUILD_RANKS.map(r => r.rank)).toEqual(['apprentice', 'journeyman', 'master', 'artificer']);
    expect(GUILD_RANKS.map(r => r.label)).toEqual(['Apprentice', 'Journeyman', 'Master', 'Artificer']);
    const caps = GUILD_RANKS.map(({ mayHarvest, mayCraftSubgoals, maxDepth }) => ({ mayHarvest, mayCraftSubgoals, maxDepth }));
    expect(caps).toEqual([
      { mayHarvest: false, mayCraftSubgoals: false, maxDepth: 0 },
      { mayHarvest: true, mayCraftSubgoals: false, maxDepth: 0 },
      { mayHarvest: true, mayCraftSubgoals: true, maxDepth: 1 },
      { mayHarvest: true, mayCraftSubgoals: true, maxDepth: Infinity },
    ]);
  });

  it('2. rankByName(journeyman) is the same object as GUILD_RANKS[1] and as AUTOMATION_HARVEST', () => {
    expect(rankByName('journeyman')).toBe(GUILD_RANKS[1]);
    expect(rankByName('journeyman')).toBe(AUTOMATION_HARVEST);
    expect(rankByName('apprentice')).toBe(AUTOMATION_NONE);
    expect(rankByName('master')).toBe(AUTOMATION_WORKSHOP);
    expect(rankByName('artificer')).toBe(AUTOMATION_FULL);
  });
});
