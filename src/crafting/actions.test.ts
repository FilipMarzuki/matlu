/**
 * Acceptance tests for #1135 — pure resolveHarvest().
 * One test per Given/When/Then criterion in the issue.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveHarvest, type ResourceNodeYield } from './actions';

/** Small seeded PRNG so every run is reproducible (never Math.random in tests). */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const qtyOf = (items: { itemId: string; qty: number }[], id: string) =>
  items.find(i => i.itemId === id)?.qty;

describe('resolveHarvest (#1135 acceptance)', () => {
  it('1. given a lumber 2–4 yield, 1000 seeded rolls are integers in [2, 4] and hit 2, 3 and 4', () => {
    const yields: ResourceNodeYield[] = [{ itemId: 'lumber', min: 2, max: 4 }];
    const rng = mulberry32(42);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const qty = qtyOf(resolveHarvest(yields, { rng }).items, 'lumber');
      expect(qty).toBeDefined();
      expect(Number.isInteger(qty)).toBe(true);
      expect(qty).toBeGreaterThanOrEqual(2);
      expect(qty).toBeLessThanOrEqual(4);
      seen.add(qty!);
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('2. given a resin 0–1 yield and an rng that always returns 0, resin is dropped from items and log', () => {
    const outcome = resolveHarvest([{ itemId: 'resin', min: 0, max: 1 }], { rng: () => 0 });
    expect(outcome.items.find(i => i.itemId === 'resin')).toBeUndefined();
    expect(outcome.log.some(line => line.includes('resin'))).toBe(false);
  });

  it('3. given two yields, two rngs from the same seed produce deeply equal outcomes', () => {
    const yields: ResourceNodeYield[] = [
      { itemId: 'lumber', min: 2, max: 4 },
      { itemId: 'resin', min: 1, max: 1 },
    ];
    const a = resolveHarvest(yields, { rng: mulberry32(7) });
    const b = resolveHarvest(yields, { rng: mulberry32(7) });
    expect(a).toEqual(b);
  });

  it('4. given a yield that rolls 3 lumber, the log has exactly one line mentioning 3 and lumber', () => {
    const outcome = resolveHarvest([{ itemId: 'lumber', min: 3, max: 3 }], { rng: mulberry32(1) });
    expect(qtyOf(outcome.items, 'lumber')).toBe(3);
    const lines = outcome.log.filter(line => line.includes('lumber'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('3');
  });

  // #1153 — world-engine integration: yield multiplier from the season/climate.
  it('#1153-6. given lumber 2–4 and yieldMultiplier 0.5, 1000 seeded rolls are integers in [1, 2]', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const qty = qtyOf(resolveHarvest([{ itemId: 'lumber', min: 2, max: 4 }], { rng, yieldMultiplier: 0.5 }).items, 'lumber');
      expect(Number.isInteger(qty)).toBe(true);
      expect(qty).toBeGreaterThanOrEqual(1);
      expect(qty).toBeLessThanOrEqual(2);
    }
  });

  it('#1153-7. given lumber 2–4 and yieldMultiplier 2, rolls are integers in [4, 8]', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const qty = qtyOf(resolveHarvest([{ itemId: 'lumber', min: 2, max: 4 }], { rng, yieldMultiplier: 2 }).items, 'lumber');
      expect(Number.isInteger(qty)).toBe(true);
      expect(qty).toBeGreaterThanOrEqual(4);
      expect(qty).toBeLessThanOrEqual(8);
    }
  });

  // #1159 — seasonal yields: plants give less in winter, more in summer.
  describe('#1159 seasonal yields', () => {
    const seasonal = (itemId: string, qty: number): ResourceNodeYield =>
      ({ itemId, min: qty, max: qty, seasonal: true });

    it('#1159-1. given seasonal berries 2–2 in winter, qty is 1 (2 × 0.25 = 0.5 rounds up)', () => {
      const outcome = resolveHarvest([seasonal('berries', 2)], { rng: mulberry32(1), season: 'winter' });
      expect(qtyOf(outcome.items, 'berries')).toBe(1);
    });

    it('#1159-2. given seasonal berries 1–1 in winter, berries are dropped from items and log', () => {
      const outcome = resolveHarvest([seasonal('berries', 1)], { rng: mulberry32(1), season: 'winter' });
      expect(outcome.items.find(i => i.itemId === 'berries')).toBeUndefined();
      expect(outcome.log.some(line => line.includes('berries'))).toBe(false);
    });

    it('#1159-3. given seasonal berries 4–4 in summer, qty is 5 (4 × 1.25)', () => {
      const outcome = resolveHarvest([seasonal('berries', 4)], { rng: mulberry32(1), season: 'summer' });
      expect(qtyOf(outcome.items, 'berries')).toBe(5);
    });

    it('#1159-4. given seasonal berries 4–4 in spring and in autumn, qty is 4 both times', () => {
      for (const season of ['spring', 'autumn']) {
        const outcome = resolveHarvest([seasonal('berries', 4)], { rng: mulberry32(1), season });
        expect(qtyOf(outcome.items, 'berries')).toBe(4);
      }
    });

    it('#1159-5. given non-seasonal stone 2–2 in winter, qty is 2', () => {
      const outcome = resolveHarvest([{ itemId: 'stone', min: 2, max: 2 }], { rng: mulberry32(1), season: 'winter' });
      expect(qtyOf(outcome.items, 'stone')).toBe(2);
    });

    it('#1159-6. given seasonal berries 4–4 in summer with yieldMultiplier 0.5, qty is 3 (4 × 1.25 × 0.5 = 2.5 rounds up)', () => {
      const outcome = resolveHarvest([seasonal('berries', 4)], { rng: mulberry32(1), season: 'summer', yieldMultiplier: 0.5 });
      expect(qtyOf(outcome.items, 'berries')).toBe(3);
    });

    it('#1159-7. given seasonal berries 4–4 with no season, and with an unknown season, qty is 4 both times', () => {
      const none = resolveHarvest([seasonal('berries', 4)], { rng: mulberry32(1) });
      const unknown = resolveHarvest([seasonal('berries', 4)], { rng: mulberry32(1), season: 'monsoon' });
      expect(qtyOf(none.items, 'berries')).toBe(4);
      expect(qtyOf(unknown.items, 'berries')).toBe(4);
    });

    it('#1159-8. resource-nodes.json marks plant yields seasonal and nothing else', () => {
      const path = join(__dirname, '..', '..', 'public', 'macro-world', 'resource-nodes.json');
      const { nodeTypes } = JSON.parse(readFileSync(path, 'utf8')) as {
        nodeTypes: { id: string; yields: ResourceNodeYield[] }[];
      };
      const plants = new Set(['plant-fiber', 'herb-green', 'berries']);
      const minerals = new Set(['wood-log', 'stone', 'iron-ore', 'copper-ore', 'freshwater']);
      const yields = nodeTypes.flatMap(n => n.yields.map(y => ({ node: n.id, ...y })));
      expect(yields.length).toBeGreaterThan(0);
      for (const y of yields) {
        if (plants.has(y.itemId)) expect(y, `${y.node}.${y.itemId}`).toHaveProperty('seasonal', true);
        if (minerals.has(y.itemId)) expect(y.seasonal, `${y.node}.${y.itemId}`).toBeFalsy();
      }
    });
  });

  // #1160 — biome-gated yields: a yield only drops where its item occurs.
  describe('#1160 biome-gated yields', () => {
    const ore = (biomes?: string[]): ResourceNodeYield => ({ itemId: 'iron-ore', min: 2, max: 2, biomes });

    it('#1160-1. given iron-ore 2–2 in [mountain, cave] resolved in forest, no items and empty log', () => {
      const outcome = resolveHarvest([ore(['mountain', 'cave'])], { rng: mulberry32(1), biome: 'forest' });
      expect(outcome.items).toEqual([]);
      expect(outcome.log).toEqual([]);
    });

    it('#1160-2. given the same yield resolved in mountain, iron-ore qty 2 and log has +2 iron-ore', () => {
      const outcome = resolveHarvest([ore(['mountain', 'cave'])], { rng: mulberry32(1), biome: 'mountain' });
      expect(qtyOf(outcome.items, 'iron-ore')).toBe(2);
      expect(outcome.log).toContain('+2 iron-ore');
    });

    it('#1160-3. given wood-log [forest] + iron-ore [mountain] resolved in forest, only wood-log and the rng is consulted once', () => {
      let calls = 0;
      const rng = () => { calls++; return 0; };
      const outcome = resolveHarvest(
        [
          { itemId: 'wood-log', min: 1, max: 1, biomes: ['forest'] },
          { itemId: 'iron-ore', min: 1, max: 1, biomes: ['mountain'] },
        ],
        { rng, biome: 'forest' },
      );
      expect(outcome.items).toEqual([{ itemId: 'wood-log', qty: 1 }]);
      expect(calls).toBe(1);
    });

    it('#1160-4. given stone 2–2 with no biomes resolved in sea, qty 2 — unlisted yields occur everywhere', () => {
      const outcome = resolveHarvest([{ itemId: 'stone', min: 2, max: 2 }], { rng: mulberry32(1), biome: 'sea' });
      expect(qtyOf(outcome.items, 'stone')).toBe(2);
    });

    it("#1160-5. given salt 1–1 in ['any'] resolved in tundra, qty 1", () => {
      const outcome = resolveHarvest([{ itemId: 'salt', min: 1, max: 1, biomes: ['any'] }], { rng: mulberry32(1), biome: 'tundra' });
      expect(qtyOf(outcome.items, 'salt')).toBe(1);
    });

    it('#1160-6. given iron-ore [mountain] resolved with no biome in the context, qty 2 — no filtering without a biome', () => {
      const outcome = resolveHarvest([ore(['mountain'])], { rng: mulberry32(1) });
      expect(qtyOf(outcome.items, 'iron-ore')).toBe(2);
    });
  });

  it('5. src/crafting/actions.ts does not import phaser', () => {
    const src = readFileSync(join(__dirname, 'actions.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]phaser['"]/);
    expect(src).not.toMatch(/require\(\s*['"]phaser['"]\s*\)/);
  });
});
