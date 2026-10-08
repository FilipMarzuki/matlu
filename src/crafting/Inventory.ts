import type { Emitter, SaveStore } from './ports';

/** Emitted whenever items are added or removed: (itemId, newQty). */
export const INVENTORY_CHANGED = 'inventory-changed';
/** Emitted when an add fails because the pack is full: (itemId, qty). */
export const INVENTORY_FULL = 'inventory-full';
/** Save key — unchanged from InventorySystem so existing player saves load. */
export const INVENTORY_SAVE_KEY = 'matlu_inventory';

/**
 * Item categories — covers every category in item-registry.json.
 */
export type ItemCategory =
  | 'raw'
  | 'refined'
  | 'component'
  | 'consumable'
  | 'equipment'
  | 'structure'
  | 'deployable'
  | 'lore-fragment'
  | 'tool'
  | 'weapon'
  | 'document'
  | 'sacred'
  | 'authority'
  | 'instrument'
  | 'container'
  | 'crafted'
  | 'quest';

export type EquipSlot = 'weapon' | 'body' | 'offhand' | 'back';

export interface ResourceDef {
  id: string;
  name: string;
  category: ItemCategory;
  stackMax: number;
  slot?: EquipSlot;
}

export interface InventorySave {
  /** Map of itemId → quantity. */
  items: Record<string, number>;
}

export interface InventoryDeps {
  emitter: Emitter;
  store: SaveStore;
  /** Max distinct item IDs the pack can hold (default 20). */
  slotLimit?: number;
}

/**
 * Inventory — owns an item inventory. Phaser-free core of InventorySystem
 * (see src/systems/InventorySystem.ts), reused by the crafting sim (#1137).
 *
 * Design:
 *  - Each unique item ID occupies one "slot" in the pack.
 *  - Slot limit caps how many distinct items the player can carry.
 *  - Stack limit (per-item, from item-registry.json) caps quantity per slot.
 *  - Lore fragments are unique: max 1 per ID.
 *
 * Dependencies are injected so this runs without Phaser or a browser:
 *  - `emitter` receives INVENTORY_CHANGED / INVENTORY_FULL (Core Warden passes
 *    game.events; tests pass a recorder).
 *  - `store` persists the save under INVENTORY_SAVE_KEY (Core Warden passes
 *    localStorage; tests and the sim pass an in-memory store).
 */
export class Inventory {
  private readonly emitter: Emitter;
  private readonly store: SaveStore;
  private items: Map<string, number> = new Map();
  private resourceDefs: Map<string, ResourceDef> = new Map();
  private slotLimit: number;

  constructor(deps: InventoryDeps) {
    this.emitter = deps.emitter;
    this.store = deps.store;
    this.slotLimit = deps.slotLimit ?? 20;
    this._restoreFromStorage();
  }

  // ── Resource definitions ────────────────────────────────────────────────────

  /**
   * Load resource definitions so the system knows stack limits and categories.
   * Call once after fetching item-registry.json (or pass the array directly).
   * Safe to call multiple times — later calls replace earlier defs.
   */
  loadResourceDefs(defs: ResourceDef[]): void {
    this.resourceDefs.clear();
    for (const def of defs) {
      this.resourceDefs.set(def.id, def);
    }
  }

  getDef(itemId: string): ResourceDef | undefined {
    return this.resourceDefs.get(itemId);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Add items to inventory. Returns the quantity actually added (may be less
   * than requested if stack or slot limits apply). Returns 0 if nothing was
   * added. Emits INVENTORY_FULL if the pack has no room for a new item ID.
   */
  add(itemId: string, qty = 1): number {
    if (qty <= 0) return 0;

    const current = this.items.get(itemId) ?? 0;
    const def = this.resourceDefs.get(itemId);
    const stackMax = def?.stackMax ?? 99;

    // Lore fragments: unique, max 1.
    if (def?.category === 'lore-fragment') {
      if (current >= 1) return 0;
      qty = 1;
    }

    // New item ID → needs a free slot.
    if (current === 0 && this.items.size >= this.slotLimit) {
      this.emitter.emit(INVENTORY_FULL, itemId, qty);
      return 0;
    }

    const canAdd = Math.min(qty, stackMax - current);
    if (canAdd <= 0) return 0;

    this.items.set(itemId, current + canAdd);
    this._persist();
    this.emitter.emit(INVENTORY_CHANGED, itemId, current + canAdd);
    return canAdd;
  }

  /**
   * Remove items. Returns true if the full quantity was removed.
   * Returns false (no side-effects) if the player doesn't have enough.
   */
  remove(itemId: string, qty = 1): boolean {
    if (qty <= 0) return true;
    const current = this.items.get(itemId) ?? 0;
    if (current < qty) return false;

    const next = current - qty;
    if (next === 0) {
      this.items.delete(itemId);
    } else {
      this.items.set(itemId, next);
    }

    this._persist();
    this.emitter.emit(INVENTORY_CHANGED, itemId, next);
    return true;
  }

  /** Check whether the player has at least `qty` of an item. */
  has(itemId: string, qty = 1): boolean {
    return (this.items.get(itemId) ?? 0) >= qty;
  }

  /** Current quantity of an item (0 if absent). */
  getQty(itemId: string): number {
    return this.items.get(itemId) ?? 0;
  }

  /** Number of distinct item slots currently occupied. */
  get slotCount(): number {
    return this.items.size;
  }

  /** Maximum number of distinct items the pack can hold. */
  get maxSlots(): number {
    return this.slotLimit;
  }

  /** All items as [itemId, quantity] pairs. */
  entries(): [string, number][] {
    return [...this.items.entries()];
  }

  /** Items filtered by category (requires resource defs to be loaded). */
  listByCategory(category: ItemCategory): [string, number][] {
    return this.entries().filter(([id]) => {
      const def = this.resourceDefs.get(id);
      return def?.category === category;
    });
  }

  /** The underlying Map — read-only access for rendering. */
  getMap(): ReadonlyMap<string, number> {
    return this.items;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** Write the save. Protected so the Phaser wrapper can flush on game destroy. */
  protected _persist(): void {
    const save: InventorySave = {
      items: Object.fromEntries(this.items),
    };
    this.store.save(INVENTORY_SAVE_KEY, JSON.stringify(save));
  }

  private _restoreFromStorage(): void {
    try {
      const raw = this.store.load(INVENTORY_SAVE_KEY);
      if (!raw) return;
      const save = JSON.parse(raw) as Partial<InventorySave>;
      if (save.items) {
        for (const [id, qty] of Object.entries(save.items)) {
          if (typeof qty === 'number' && qty > 0) {
            this.items.set(id, qty);
          }
        }
      }
    } catch {
      // Corrupt save — start with empty inventory.
    }
  }
}
