/**
 * items.ts — Pure utility functions for the unified item registry.
 *
 * The item registry (`item-registry.json`) is the single source of truth for
 * all items in Core Warden.
 *
 * Two helpers:
 * - `playerItems()` filters the full registry to items the player can carry.
 * - `itemIconPath()` resolves a registry item's icon filename to a URL path.
 */

import type { EquipSlot } from '../systems/InventorySystem';
import itemRegistryData from '../../macro-world/item-registry.json';

/** Shape of one item in item-registry.json's `items` array. */
export interface RegistryItem {
  id: string;
  name: string;
  category: string;
  stackMax: number;
  playerObtainable: boolean;
  icon: string | null;
  slot?: EquipSlot;
  source?: string[];
  biomes?: string[];
  associatedRole?: string;
  building?: string;
  useInGame?: string[];
  placeable?: boolean;
  placeColor?: string;
  placeSpriteKey?: string;
  shopEffect?: string;
  shopValue?: number;
  description?: string;
  iconDescription?: string;
}

/**
 * Every item in the registry, bundled into the game's JavaScript (#1512).
 *
 * Scenes used to fetch `/macro-world/item-registry.json` at runtime. That works under
 * `npm run dev`, because Vite serves the whole project root, but the build ships only `public/`,
 * and the registry lives in `macro-world/`. In production the fetch got index.html instead, and
 * the Homestead's crafting menu fell back to placeholder data. Importing the JSON makes Vite
 * bundle it; ShopScene and CrafterScene already imported it, so it was in the bundle anyway.
 */
export const REGISTRY_ITEMS: readonly RegistryItem[] = itemRegistryData.items as RegistryItem[];

/**
 * Filter registry items to those usable by the player inventory.
 *
 * The full registry includes NPC props, quest items, authority tokens, etc.
 * that never enter the player's pack. This function strips those out and
 * returns only the fields the inventory system needs.
 */
export function playerItems(
  all: readonly RegistryItem[],
): { id: string; name: string; category: string; stackMax: number; slot?: EquipSlot }[] {
  return all
    .filter(i => i.playerObtainable)
    .map(({ id, name, category, stackMax, slot }) => ({
      id,
      name,
      category,
      stackMax,
      ...(slot && { slot }),
    }));
}

/**
 * Get the icon path for a registry item.
 *
 * Icons live under `/assets/sprites/icons/items/` — the `icon` field in the
 * registry stores just the filename (e.g. `"item-amber.png"`). Returns null
 * if no icon has been assigned yet (icon generation is asynchronous via the
 * PixelLab pipeline).
 */
export function itemIconPath(item: RegistryItem): string | null {
  if (!item.icon) return null;
  return `/assets/sprites/icons/items/${item.icon}`;
}
