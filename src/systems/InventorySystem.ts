import * as Phaser from 'phaser';

const REGISTRY_KEY = 'inventorySystem';
const LS_KEY = 'matlu_inventory';

/** Emitted on game.events whenever items are added or removed. */
export const INVENTORY_CHANGED = 'inventory-changed';
/** Emitted on game.events when an add fails because the pack is full. */
export const INVENTORY_FULL = 'inventory-full';

/** Categories from resources.json. */
export type ItemCategory =
  | 'raw'
  | 'refined'
  | 'component'
  | 'consumable'
  | 'equipment'
  | 'lore-fragment';

export type EquipSlot = 'weapon' | 'body' | 'offhand' | 'back';

export interface ResourceDef {
  id: string;
  name: string;
  category: ItemCategory;
  stackMax: number;
  slot?: EquipSlot;
}

interface InventorySave {
  /** Map of itemId → quantity. */
  items: Record<string, number>;
}

/**
 * InventorySystem — owns the player's item inventory.
 *
 * Design:
 *  - Each unique item ID occupies one "slot" in the pack.
 *  - Slot limit caps how many distinct items the player can carry.
 *  - Stack limit (per-item, from resources.json) caps quantity per slot.
 *  - Lore fragments are unique: max 1 per ID.
 *
 * Persistence: game.registry (survives scene transitions) + localStorage
 * (survives page reloads). Same two-layer pattern as EssenceSystem.
 *
 * Events emit on game.events (global) so any scene — GameScene,
 * CraftingMenuScene, future shop scenes — can listen without reaching
 * into another scene's event bus.
 *
 * Access from any scene:
 *   const inv = this.game.registry.get('inventorySystem') as InventorySystem;
 */
export class InventorySystem {
  private readonly game: Phaser.Game;
  private items: Map<string, number> = new Map();
  private resourceDefs: Map<string, ResourceDef> = new Map();
  private slotLimit: number;

  constructor(scene: Phaser.Scene, opts?: { slotLimit?: number }) {
    this.game = scene.game;
    this.slotLimit = opts?.slotLimit ?? 20;

    this._restoreFromStorage();

    // Register globally so any scene can grab us.
    this.game.registry.set(REGISTRY_KEY, this);

    // Persist on game destroy (tab close / hot-reload).
    this.game.events.once(Phaser.Core.Events.DESTROY, () => this._persist());
  }

  // ── Resource definitions ────────────────────────────────────────────────────

  /**
   * Load resource definitions so the system knows stack limits and categories.
   * Call once after fetching resources.json (or pass the array directly).
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
      this.game.events.emit(INVENTORY_FULL, itemId, qty);
      return 0;
    }

    const canAdd = Math.min(qty, stackMax - current);
    if (canAdd <= 0) return 0;

    this.items.set(itemId, current + canAdd);
    this._persist();
    this.game.events.emit(INVENTORY_CHANGED, itemId, current + canAdd);
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
    this.game.events.emit(INVENTORY_CHANGED, itemId, next);
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

  private _persist(): void {
    try {
      const save: InventorySave = {
        items: Object.fromEntries(this.items),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(save));
    } catch {
      // localStorage unavailable — fail silently.
    }
  }

  private _restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
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
