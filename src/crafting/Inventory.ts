import type { Emitter, SaveStore } from './ports';

export const INVENTORY_CHANGED = 'inventory-changed';
export const INVENTORY_FULL = 'inventory-full';
export const INVENTORY_SAVE_KEY = 'matlu_inventory';

export interface InventoryDeps { emitter: Emitter; store: SaveStore; slotLimit?: number }

export class Inventory {
  constructor(_deps: InventoryDeps) {}
  add(_itemId: string, _qty = 1): number { throw new Error('not implemented'); }
  remove(_itemId: string, _qty = 1): boolean { throw new Error('not implemented'); }
  getQty(_itemId: string): number { throw new Error('not implemented'); }
}
