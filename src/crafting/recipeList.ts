/**
 * The crafting menu's recipe list: which rows a station filter shows, in what order, and how far
 * the list can scroll (#1525). Phaser-free, so CraftingMenuScene's list rules can be unit-tested.
 */

/** The Recipes tab's station filters, left to right. */
export const STATION_FILTERS = ['All', 'Field', 'Smelter', 'Smithy', 'Workshop', 'Tannery'] as const;
export type StationFilter = typeof STATION_FILTERS[number];

/**
 * Does a recipe made at `station` show under filter `f`? Field is the recipes with no station
 * (craft anywhere). Stations without a filter of their own (kiln, campfire, foundry…) show
 * under All only.
 */
export const matchesStation = (station: string | null, f: StationFilter): boolean =>
  f === 'All' || (f === 'Field' ? station === null : station === f.toLowerCase());

/** How a row reads: ● craftable now, ○ known but missing inputs, ??? a hint not yet worked out. */
export type RecipeRowKind = 'craftable' | 'known' | 'hint';

const KIND_ORDER: Record<RecipeRowKind, number> = { craftable: 0, known: 1, hint: 2 };

/**
 * The rows the list draws: recipes under the filter, craftable first, then known, then hints.
 * `kindOf` returns null for a recipe the player can't see at all. Within a kind the registry's
 * order (roughly by tier) is kept, because Array.prototype.sort is stable.
 */
export function recipeListRows<R extends { station: string | null }>(
  recipes: readonly R[],
  filter: StationFilter,
  kindOf: (recipe: R) => RecipeRowKind | null,
): { recipe: R; kind: RecipeRowKind }[] {
  return recipes
    .filter(r => matchesStation(r.station, filter))
    .flatMap(recipe => {
      const kind = kindOf(recipe);
      return kind ? [{ recipe, kind }] : [];
    })
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/**
 * Keep the list's scroll (the index of its top row) in range: never above the first row, and
 * never so far down that the window shows fewer than `visible` rows when there are more.
 */
export const clampScroll = (top: number, total: number, visible: number): number =>
  Math.max(0, Math.min(Math.round(top), total - visible));
