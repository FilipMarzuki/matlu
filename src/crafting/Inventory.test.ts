/**
 * Acceptance tests for #1136 — Phaser-free Inventory.
 * One test per Given/When/Then criterion (1–5) in the issue.
 */

import { describe, it, expect } from 'vitest';
import { Inventory, INVENTORY_CHANGED, INVENTORY_FULL, INVENTORY_SAVE_KEY } from './Inventory';
import { MemoryStore, RecordingEmitter } from './testDoubles';

function make(opts: { slotLimit?: number; store?: MemoryStore } = {}) {
  const emitter = new RecordingEmitter();
  const store = opts.store ?? new MemoryStore();
  const inv = new Inventory({ emitter, store, slotLimit: opts.slotLimit });
  return { inv, emitter, store };
}

describe('Inventory (#1136 acceptance)', () => {
  it('1. given an empty inventory, add("lumber", 3) gives 3 lumber and emits INVENTORY_CHANGED("lumber", 3)', () => {
    const { inv, emitter } = make();
    inv.add('lumber', 3);
    expect(inv.getQty('lumber')).toBe(3);
    expect(emitter.argsFor(INVENTORY_CHANGED)).toEqual([['lumber', 3]]);
  });

  it('2. given 3 lumber, remove("lumber", 2) leaves 1 and emits INVENTORY_CHANGED("lumber", 1)', () => {
    const { inv, emitter } = make();
    inv.add('lumber', 3);
    expect(inv.remove('lumber', 2)).toBe(true);
    expect(inv.getQty('lumber')).toBe(1);
    expect(emitter.argsFor(INVENTORY_CHANGED).at(-1)).toEqual(['lumber', 1]);
  });

  it('3. given slotLimit 1 holding lumber, add("stone", 1) adds nothing and emits INVENTORY_FULL("stone", 1)', () => {
    const { inv, emitter } = make({ slotLimit: 1 });
    inv.add('lumber', 1);
    expect(inv.add('stone', 1)).toBe(0);
    expect(inv.getQty('stone')).toBe(0);
    expect(emitter.argsFor(INVENTORY_FULL)).toEqual([['stone', 1]]);
  });

  it('4. given 3 lumber and 1 stone saved to a store, a new Inventory on that store holds the same items', () => {
    const store = new MemoryStore();
    const { inv } = make({ store });
    inv.add('lumber', 3);
    inv.add('stone', 1);

    const { inv: reloaded } = make({ store });
    expect(reloaded.getQty('lumber')).toBe(3);
    expect(reloaded.getQty('stone')).toBe(1);
  });

  it('5. given a save in the existing InventorySystem localStorage format, Inventory restores it', () => {
    // Exactly what InventorySystem._persist() wrote under 'matlu_inventory'
    // before #1136 — existing player saves must keep loading.
    const store = new MemoryStore();
    store.save('matlu_inventory', JSON.stringify({ items: { lumber: 3, stone: 1 } }));
    expect(INVENTORY_SAVE_KEY).toBe('matlu_inventory');

    const { inv } = make({ store });
    expect(inv.getQty('lumber')).toBe(3);
    expect(inv.getQty('stone')).toBe(1);
  });
});
