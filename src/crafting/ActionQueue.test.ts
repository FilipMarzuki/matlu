/**
 * Acceptance tests for #1137 — ActionQueue (the test-first half of the issue).
 * One test per Given/When/Then criterion. Fixtures are defined here so the
 * tests don't depend on the live recipes.json balance.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ActionQueue, type HarvestSource, type Recipe } from './ActionQueue';
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
