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

  it('5. src/crafting/actions.ts does not import phaser', () => {
    const src = readFileSync(join(__dirname, 'actions.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]phaser['"]/);
    expect(src).not.toMatch(/require\(\s*['"]phaser['"]\s*\)/);
  });
});
