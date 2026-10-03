import * as Phaser from 'phaser';
import { Inventory } from '../crafting/Inventory';
import { localStorageStore } from '../crafting/ports';

// The inventory rules live in the Phaser-free Inventory class
// (src/crafting/Inventory.ts) so the crafting sim can reuse them. Re-exported
// here so existing imports from this module keep working unchanged.
export {
  INVENTORY_CHANGED,
  INVENTORY_FULL,
  type ItemCategory,
  type EquipSlot,
  type ResourceDef,
} from '../crafting/Inventory';

const REGISTRY_KEY = 'inventorySystem';

/**
 * InventorySystem — Core Warden's player inventory: the Phaser-free Inventory
 * plus the Phaser plumbing.
 *
 * Persistence: game.registry (survives scene transitions) + localStorage
 * (survives page reloads). Same two-layer pattern as EssenceSystem.
 *
 * Events emit on game.events (global) so any scene — GameScene,
 * CraftingMenuScene, future shop scenes — can listen without reaching
 * into another scene's event bus. Phaser's EventEmitter already has the
 * `emit(event, ...args)` shape Inventory expects, so it's passed in directly.
 *
 * Access from any scene:
 *   const inv = this.game.registry.get('inventorySystem') as InventorySystem;
 */
export class InventorySystem extends Inventory {
  constructor(scene: Phaser.Scene, opts?: { slotLimit?: number }) {
    super({ emitter: scene.game.events, store: localStorageStore, slotLimit: opts?.slotLimit });

    // Register globally so any scene can grab us.
    scene.game.registry.set(REGISTRY_KEY, this);

    // Persist on game destroy (tab close / hot-reload).
    scene.game.events.once(Phaser.Core.Events.DESTROY, () => this._persist());
  }
}
