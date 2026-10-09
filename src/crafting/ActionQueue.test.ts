/**
 * Acceptance tests for #1137 — ActionQueue (the test-first half of the issue).
 * One test per Given/When/Then criterion. Fixtures are defined here so the
 * tests don't depend on the live recipes.json balance.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ActionQueue, BARREN_LIMIT, type HarvestSource, type Recipe, type QueuedAction } from './ActionQueue';
import { AUTOMATION_HARVEST, AUTOMATION_NONE, AUTOMATION_WORKSHOP, rankByName, type Automation } from './planner';
import { Inventory } from './Inventory';
import { MemoryStore, RecordingEmitter } from './testDoubles';

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PINE: HarvestSource = { id: 'pine', label: 'Pine', yields: [{ itemId: 'lumber', min: 2, max: 4 }], durationTicks: 5 };
const PLANK: Recipe = { id: 'plank', name: 'Plank', inputs: [{ item: 'lumber', qty: 2 }], output: { item: 'plank', qty: 1 }, timeBase: 3 };

function make(seed = 42) {
  const inventory = new Inventory({ emitter: new RecordingEmitter(), store: new MemoryStore() });
  const queue = new ActionQueue({ inventory, rng: mulberry32(seed), sources: [PINE], recipes: [PLANK] });
  return { inventory, queue };
}

describe('ActionQueue (#1137 acceptance)', () => {
  it('1. given an empty queue, enqueue harvest pine (5 ticks) and tick(4): no outcome, 0 lumber', () => {
    const { inventory, queue } = make();
    expect(queue.enqueueHarvest('pine')).toBe(true);
    expect(queue.tick(4)).toEqual([]);
    expect(inventory.getQty('lumber')).toBe(0);
  });

  it('2. given the state above, tick(1): exactly one outcome, 2–4 lumber, log mentions lumber', () => {
    const { inventory, queue } = make();
    queue.enqueueHarvest('pine');
    queue.tick(4);
    const outcomes = queue.tick(1);
    expect(outcomes).toHaveLength(1);
    const qty = inventory.getQty('lumber');
    expect(qty).toBeGreaterThanOrEqual(2);
    expect(qty).toBeLessThanOrEqual(4);
    expect(outcomes[0].log.some(l => l.includes('lumber'))).toBe(true);
  });

  it('3. given two queued 5-tick harvests, tick(10) returns two outcomes in enqueue order (overflow carries over)', () => {
    const { queue } = make();
    queue.enqueueHarvest('pine');
    queue.enqueueHarvest('pine');
    const outcomes = queue.tick(10);
    expect(outcomes).toHaveLength(2);
    expect(queue.entries).toHaveLength(0);
  });

  it('4. given a 5-tick harvest with 2 ticks elapsed, skipToNextCompletion completes it and the next entry has 0 elapsed', () => {
    const { queue } = make();
    queue.enqueueHarvest('pine');
    queue.enqueueHarvest('pine');
    queue.tick(2);
    expect(queue.entries[0].elapsed).toBe(2);
    const outcomes = queue.skipToNextCompletion();
    expect(outcomes).toHaveLength(1);
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0].elapsed).toBe(0);
  });

  it('5. given recipe plank ← 2 lumber and 3 lumber, craft plank completes: 1 lumber and 1 plank', () => {
    const { inventory, queue } = make();
    inventory.add('lumber', 3);
    expect(queue.enqueueCraft('plank')).toBe(true);
    queue.tick(PLANK.timeBase);
    expect(inventory.getQty('lumber')).toBe(1);
    expect(inventory.getQty('plank')).toBe(1);
  });

  it('6. given the same recipe and 1 lumber, enqueueCraft("plank") is rejected and inventory is unchanged', () => {
    const { inventory, queue } = make();
    inventory.add('lumber', 1);
    expect(queue.enqueueCraft('plank')).toBe(false);
    expect(queue.entries).toHaveLength(0);
    expect(inventory.getQty('lumber')).toBe(1);
    expect(inventory.getQty('plank')).toBe(0);
  });

  it('7. given two queues from the same seed and the same enqueues/ticks, their outcomes are deeply equal', () => {
    const run = () => {
      const { inventory, queue } = make(7);
      inventory.add('lumber', 2);
      queue.enqueueHarvest('pine');
      queue.enqueueCraft('plank');
      queue.enqueueHarvest('pine');
      return [queue.tick(3), queue.tick(6), queue.skipToNextCompletion(), inventory.entries()];
    };
    expect(run()).toEqual(run());
  });

  // #1153 — world-engine integration: context callback feeds the multiplier in.
  it('#1153-8. given a queue whose context returns yieldMultiplier 0, a completed harvest adds nothing and logs nothing found', () => {
    const inventory = new Inventory({ emitter: new RecordingEmitter(), store: new MemoryStore() });
    const queue = new ActionQueue({ inventory, rng: mulberry32(1), sources: [PINE], recipes: [PLANK], context: () => ({ yieldMultiplier: 0 }) });
    queue.enqueueHarvest('pine');
    const outcomes = queue.tick(PINE.durationTicks);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].items).toEqual([]);
    expect(outcomes[0].log.some(l => /nothing found/i.test(l))).toBe(true);
    expect(inventory.entries()).toEqual([]);
  });

  it('#1160-7. given a queue whose context returns biome forest and a source yielding only iron-ore [mountain], the completed harvest logs nothing found and the inventory is unchanged', () => {
    const inventory = new Inventory({ emitter: new RecordingEmitter(), store: new MemoryStore() });
    const VEIN: HarvestSource = {
      id: 'vein',
      label: 'Ore Vein',
      yields: [{ itemId: 'iron-ore', min: 1, max: 1, biomes: ['mountain'] }],
      durationTicks: 2,
    };
    const queue = new ActionQueue({ inventory, rng: mulberry32(1), sources: [VEIN], recipes: [], context: () => ({ biome: 'forest' }) });
    queue.enqueueHarvest('vein');
    const outcomes = queue.tick(2);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].log).toEqual(['Harvest Ore Vein: nothing found']);
    expect(inventory.getQty('iron-ore')).toBe(0);
  });

  it('#1164-7. given a queue whose context returns biome [forest, riverbank] and an Ore Vein yielding iron-ore [mountain] + copper-ore [riverbank], the harvest gives exactly copper-ore and never logs nothing found', () => {
    const inventory = new Inventory({ emitter: new RecordingEmitter(), store: new MemoryStore() });
    const VEIN: HarvestSource = {
      id: 'vein',
      label: 'Ore Vein',
      yields: [
        { itemId: 'iron-ore', min: 1, max: 1, biomes: ['mountain'] },
        { itemId: 'copper-ore', min: 1, max: 1, biomes: ['riverbank'] },
      ],
      durationTicks: 2,
    };
    const queue = new ActionQueue({ inventory, rng: mulberry32(1), sources: [VEIN], recipes: [], context: () => ({ biome: ['forest', 'riverbank'] }) });
    queue.enqueueHarvest('vein');
    const [outcome] = queue.tick(2);
    expect(outcome.items).toEqual([{ itemId: 'copper-ore', qty: 1 }]);
    expect(outcome.log).toContain('+1 copper-ore');
    expect(outcome.log.some(l => l.includes('nothing found'))).toBe(false);
  });

  it('8. src/crafting/ActionQueue.ts does not import phaser', () => {
    const src = readFileSync(join(__dirname, 'ActionQueue.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]phaser['"]/);
  });
});

/**
 * #1185 — goal entries that expand into sub-actions at the head. Fixtures
 * mirror planner.test.ts so the two halves agree on what "plank" needs.
 */
describe('goals (#1185 acceptance)', () => {
  const G_PLANK: Recipe = { id: 'plank', name: 'Plank', inputs: [{ item: 'wood-log', qty: 2 }], output: { item: 'plank', qty: 1 }, timeBase: 3 };
  const G_ROPE: Recipe = { id: 'rope', name: 'Rope', inputs: [{ item: 'plant-fiber', qty: 4 }], output: { item: 'rope', qty: 1 }, timeBase: 2 };
  const G_SNARE: Recipe = { id: 'snare', name: 'Snare', inputs: [{ item: 'rope', qty: 1 }, { item: 'wood-log', qty: 1 }], output: { item: 'snare', qty: 1 }, timeBase: 3 };
  const G_RECIPES = [G_PLANK, G_ROPE, G_SNARE];
  const G_PINE: HarvestSource = { id: 'pine', label: 'Pine', yields: [{ itemId: 'wood-log', min: 1, max: 2 }], durationTicks: 5 };
  const G_OAK: HarvestSource = { id: 'oak', label: 'Oak', yields: [{ itemId: 'wood-log', min: 2, max: 3 }], durationTicks: 5 };
  const G_MEADOW: HarvestSource = { id: 'meadow', label: 'Meadow', yields: [{ itemId: 'plant-fiber', min: 1, max: 1 }], durationTicks: 2 };
  const G_SOURCES = [G_PINE, G_OAK, G_MEADOW];

  function makeGoals(seed = 42, automation: Automation = AUTOMATION_WORKSHOP, initialEntries?: QueuedAction[]) {
    const inventory = new Inventory({ emitter: new RecordingEmitter(), store: new MemoryStore() });
    const queue = new ActionQueue({ inventory, rng: mulberry32(seed), sources: G_SOURCES, recipes: G_RECIPES, automation, initialEntries });
    return { inventory, queue };
  }

  // #1195 criterion 3: refusing goals goes by rank, so a copy of the Apprentice preset refuses too.
  it('#1195-3. a copied apprentice rank refuses goals and leaves the queue empty', () => {
    const { queue } = makeGoals(42, { ...rankByName('apprentice') });
    expect(queue.enqueueGoal('plank')).toBe(false);
    expect(queue.entries).toEqual([]);
  });

  // #1195 criterion 4: the Master rank plans exactly as AUTOMATION_WORKSHOP did (criterion 1 below).
  it('#1195-4. the master rank plans like criterion 1', () => {
    const { queue } = makeGoals(42, rankByName('master'));
    expect(queue.enqueueGoal('plank')).toBe(true);
    queue.tick(1);
    expect(queue.entries[0]).toMatchObject({ kind: 'harvest', target: 'oak', elapsed: 1 });
    expect(queue.entries[1]).toMatchObject({ kind: 'goal', recipeId: 'plank' });
    expect(queue.entries[1].subStep).toContain('Oak');
  });

  it('1. given an empty inventory and enqueueGoal(plank), tick(1): head is harvest oak, then the plank goal with subStep mentioning Oak', () => {
    const { queue } = makeGoals();
    expect(queue.enqueueGoal('plank')).toBe(true);
    queue.tick(1);
    expect(queue.entries[0]).toMatchObject({ kind: 'harvest', target: 'oak', elapsed: 1 });
    expect(queue.entries[1]).toMatchObject({ kind: 'goal', recipeId: 'plank' });
    expect(queue.entries[1].subStep).toContain('Oak');
  });

  it('2. given the state above, ticked until the harvest completes and once more: ≥2 wood → craft plank with 2 reserved, else another oak harvest', () => {
    for (const seed of [1, 7]) {
      const { inventory, queue } = makeGoals(seed);
      queue.enqueueGoal('plank');
      queue.tick(1);
      queue.tick(G_OAK.durationTicks - 1);
      const wood = inventory.getQty('wood-log');
      queue.tick(1);
      if (wood >= 2) {
        expect(queue.entries[0]).toMatchObject({ kind: 'craft', target: 'plank' });
        expect(inventory.getQty('wood-log')).toBe(wood - 2);
      } else {
        expect(queue.entries[0]).toMatchObject({ kind: 'harvest', target: 'oak' });
        expect(queue.entries[1]).toMatchObject({ kind: 'goal', recipeId: 'plank' });
      }
    }
  });

  it('3. given seed 7 (first oak roll is 2), tick(100) on a fresh plank goal: 1 plank, empty queue, outcomes = harvest then Crafted 1 Plank', () => {
    const { inventory, queue } = makeGoals(7);
    queue.enqueueGoal('plank');
    const outcomes = queue.tick(100);
    expect(inventory.getQty('plank')).toBe(1);
    expect(inventory.getQty('wood-log')).toBe(0);
    expect(queue.entries).toHaveLength(0);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].items).toEqual([{ itemId: 'wood-log', qty: 2 }]);
    expect(outcomes[1].log).toEqual(['Crafted 1 Plank']);
  });

  it('4. given enqueueGoal(snare) with an empty inventory, tick(1): [harvest meadow, goal rope depth 1, goal snare depth 0]', () => {
    const { queue } = makeGoals();
    queue.enqueueGoal('snare');
    queue.tick(1);
    expect(queue.entries.map(e => ({ kind: e.kind, target: e.target, depth: e.depth }))).toEqual([
      { kind: 'harvest', target: 'meadow', depth: undefined },
      { kind: 'goal', target: 'rope', depth: 1 },
      { kind: 'goal', target: 'snare', depth: 0 },
    ]);
    expect(queue.entries[1].ancestry).toEqual(['snare']);
  });

  it('5. given enqueueGoal(snare) and tick(200): 1 snare, 0 rope, empty queue', () => {
    const { inventory, queue } = makeGoals();
    queue.enqueueGoal('snare');
    queue.tick(200);
    expect(inventory.getQty('snare')).toBe(1);
    expect(inventory.getQty('rope')).toBe(0);
    expect(queue.entries).toHaveLength(0);
  });

  it('6. given AUTOMATION_HARVEST and enqueueGoal(snare), tick(1): goal removed, log says blocked + rope, inventory unchanged', () => {
    const { inventory, queue } = makeGoals(42, AUTOMATION_HARVEST);
    expect(queue.enqueueGoal('snare')).toBe(true);
    const outcomes = queue.tick(1);
    expect(queue.entries).toHaveLength(0);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].items).toEqual([]);
    expect(outcomes[0].log.join(' ')).toMatch(/blocked/);
    expect(outcomes[0].log.join(' ')).toMatch(/rope/);
    expect(inventory.entries()).toEqual([]);
  });

  it('7. given AUTOMATION_NONE, enqueueGoal(plank) returns false and the queue is empty', () => {
    const { queue } = makeGoals(42, AUTOMATION_NONE);
    expect(queue.enqueueGoal('plank')).toBe(false);
    expect(queue.entries).toHaveLength(0);
  });

  it('8. given a goal mid-expansion, its entries restore into a new queue deep-equal and ticking continues the plan', () => {
    const a = makeGoals(7);
    a.queue.enqueueGoal('plank');
    a.queue.tick(1);
    const saved = JSON.parse(JSON.stringify(a.queue.entries)) as QueuedAction[];
    expect(saved[1].subStep).toBeDefined();

    const b = makeGoals(7, AUTOMATION_WORKSHOP, saved);
    expect(b.queue.entries).toEqual(saved);
    b.queue.tick(100);
    expect(b.inventory.getQty('plank')).toBe(1);
    expect(b.queue.entries).toHaveLength(0);
  });

  it('9. given goals plank, plank and 4 wood-log, tick(1): first is a craft reserving 2, second is still a goal', () => {
    const { inventory, queue } = makeGoals();
    inventory.add('wood-log', 4);
    queue.enqueueGoal('plank');
    queue.enqueueGoal('plank');
    queue.tick(1);
    expect(queue.entries[0]).toMatchObject({ kind: 'craft', target: 'plank', elapsed: 1 });
    expect(queue.entries[1]).toMatchObject({ kind: 'goal', target: 'plank' });
    expect(inventory.getQty('wood-log')).toBe(2);
  });
});

// #1192: a goal whose harvest keeps coming back with none of what it needs gives up, instead of
// harvesting forever; and the planner it asks sees the season the harvest will happen in.
describe('barren harvests (#1192 acceptance)', () => {
  const B_PLANK: Recipe = { id: 'plank', name: 'Plank', inputs: [{ item: 'wood-log', qty: 2 }], output: { item: 'plank', qty: 1 }, timeBase: 3 };
  const B_ROPE: Recipe = { id: 'rope', name: 'Rope', inputs: [{ item: 'plant-fiber', qty: 4 }], output: { item: 'rope', qty: 1 }, timeBase: 2 };
  const B_OAK: HarvestSource = {
    id: 'oak', label: 'Oak Tree', durationTicks: 5,
    yields: [{ itemId: 'wood-log', min: 1, max: 2 }, { itemId: 'plant-fiber', min: 1, max: 1, seasonal: true }],
  };
  const B_MEADOW: HarvestSource = { id: 'meadow', label: 'Meadow', yields: [{ itemId: 'plant-fiber', min: 1, max: 1 }], durationTicks: 2 };

  function makeBarren(context: () => object, sources = [B_OAK, B_MEADOW], initialEntries?: QueuedAction[]) {
    const inventory = new Inventory({ emitter: new RecordingEmitter(), store: new MemoryStore() });
    const queue = new ActionQueue({ inventory, rng: mulberry32(3), sources, recipes: [B_PLANK, B_ROPE], automation: AUTOMATION_HARVEST, context, initialEntries });
    return { inventory, queue };
  }
  const isBlocked = (o: { log: string[] }) => o.log.some(l => l.includes('blocked'));

  it('3. given yieldMultiplier 0 and a plank goal, tick(100): empty queue and inventory, at most N+1 harvests then one blocked naming wood-log', () => {
    const { inventory, queue } = makeBarren(() => ({ yieldMultiplier: 0 }));
    queue.enqueueGoal('plank');
    const outcomes = queue.tick(100);
    expect(queue.entries).toHaveLength(0);
    expect(inventory.getQty('wood-log')).toBe(0);
    expect(inventory.getQty('plank')).toBe(0);
    const at = outcomes.findIndex(isBlocked);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(BARREN_LIMIT + 1);
    expect(outcomes).toHaveLength(at + 1);
    expect(outcomes.slice(0, at).every(o => o.log.some(l => l.includes('nothing found')))).toBe(true);
    expect(outcomes[at].log[0]).toMatch(/^Plank: blocked — .*wood-log/);
  });

  it('4. given a rope goal in spring, tick(100): rope made, never blocked — the same outcomes as with no season', () => {
    const spring = makeBarren(() => ({ season: 'spring' }));
    spring.queue.enqueueGoal('rope');
    const outcomes = spring.queue.tick(100);
    expect(spring.inventory.getQty('rope')).toBe(1);
    expect(spring.queue.entries).toHaveLength(0);
    expect(outcomes.some(isBlocked)).toBe(false);
    const plain = makeBarren(() => ({}));
    plain.queue.enqueueGoal('rope');
    expect(plain.queue.tick(100)).toEqual(outcomes);
  });

  it('the queue asks the planner with its season: a winter rope goal goes to the meadow', () => {
    const { inventory, queue } = makeBarren(() => ({ season: 'winter' }));
    queue.enqueueGoal('rope');
    queue.tick(1);
    expect(queue.entries[0]).toMatchObject({ kind: 'harvest', target: 'meadow' });
    queue.tick(100);
    expect(inventory.getQty('rope')).toBe(1);
  });

  it('with only the oak in winter, the rope goal is blocked at once, naming the season', () => {
    const { queue } = makeBarren(() => ({ season: 'winter' }), [B_OAK]);
    queue.enqueueGoal('rope');
    const outcomes = queue.tick(100);
    expect(outcomes).toEqual([{ items: [], log: ['Rope: blocked — nothing here gives plant-fiber in winter'] }]);
  });

  // Before #1192, a blocked sub-goal was dropped and its parent planned the same sub-goal straight
  // back: tick() never returned. The winter 'unavailable' block would have made that common.
  it('a sub-goal that can’t be made drops the goals waiting on it, instead of looping without a tick', () => {
    const B_SNARE: Recipe = { id: 'snare', name: 'Snare', inputs: [{ item: 'rope', qty: 1 }], output: { item: 'snare', qty: 1 }, timeBase: 3 };
    const nested = (sources: HarvestSource[], context: () => object) => {
      const inventory = new Inventory({ emitter: new RecordingEmitter(), store: new MemoryStore() });
      const queue = new ActionQueue({ inventory, rng: mulberry32(3), sources, recipes: [B_ROPE, B_SNARE], automation: AUTOMATION_WORKSHOP, context });
      queue.enqueueGoal('snare');
      return { queue, outcomes: queue.tick(1) };
    };
    const winter = nested([B_OAK], () => ({ season: 'winter' }));
    expect(winter.outcomes).toEqual([{ items: [], log: ['Rope: blocked — nothing here gives plant-fiber in winter', 'Snare: blocked — needs Rope'] }]);
    expect(winter.queue.entries).toHaveLength(0);
    // The same with no source at all — the case that hung before.
    const none = nested([], () => ({}));
    expect(none.outcomes).toEqual([{ items: [], log: ['Rope: blocked — no source of plant-fiber', 'Snare: blocked — needs Rope'] }]);
    expect(none.queue.entries).toHaveLength(0);
  });

  it('the barren count is saved with the goal: a restored queue gives up on time', () => {
    const first = makeBarren(() => ({ yieldMultiplier: 0 }));
    first.queue.enqueueGoal('plank');
    // Two barren harvests, then save mid-plan.
    first.queue.tick(2 * B_OAK.durationTicks);
    const saved = JSON.parse(JSON.stringify(first.queue.entries)) as QueuedAction[];
    const second = makeBarren(() => ({ yieldMultiplier: 0 }), [B_OAK, B_MEADOW], saved);
    const outcomes = second.queue.tick(100);
    expect(outcomes.filter(o => !isBlocked(o))).toHaveLength(BARREN_LIMIT - 2);
    expect(outcomes.at(-1)!.log[0]).toMatch(/^Plank: blocked/);
  });
});
