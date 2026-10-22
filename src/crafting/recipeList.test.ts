/**
 * #1525 — every recipe in the crafting menu's list can be reached.
 *
 * The Recipes tab drew rows in registry order until the panel ran out (14 rows of 131), so Iron
 * Ingot, row 18, was stranded, and its station filters did nothing. The list's rules now live in
 * recipeList.ts; these tests run them on the real registry.
 */

import { describe, it, expect } from 'vitest';
import recipesJson from '../../public/macro-world/recipes.json';
import { queueRecipes } from './ActionQueue';
import { Discovery, type RecipeDiscoveryDef } from './Discovery';
import { clampScroll, matchesStation, recipeListRows, STATION_FILTERS, type RecipeRowKind } from './recipeList';

type MenuRecipe = { id: string; station: string | null; inputs: { item: string; qty: number }[]; discovery?: RecipeDiscoveryDef };
const RECIPES = queueRecipes(recipesJson.recipes) as unknown as MenuRecipe[];

/** Rows as the menu reads them: discovered recipes are craftable or known, the rest hints. */
function kinds(pack: Record<string, number>): (r: MenuRecipe) => RecipeRowKind | null {
  const d = new Discovery();
  d.loadRecipeDefs(RECIPES);
  return r => {
    const state = d.getState(r.id);
    if (state === 'undiscovered') return null;
    if (state === 'hint-visible') return 'hint';
    return r.inputs.every(i => (pack[i.item] ?? 0) >= i.qty) ? 'craftable' : 'known';
  };
}

/** Rows the Recipes tab fits on an 800×600 screen. */
const VISIBLE = 13;

describe('Crafting menu recipe list (#1525)', () => {
  it('puts Iron Ingot on the first screen under All when the pack holds iron ore and coal', () => {
    const before = RECIPES.findIndex(r => r.id === 'iron-ingot');
    expect(before).toBeGreaterThanOrEqual(VISIBLE); // registry order strands it below the fold
    const rows = recipeListRows(RECIPES, 'All', kinds({ 'iron-ore': 3, coal: 1 }));
    const at = rows.findIndex(r => r.recipe.id === 'iron-ingot');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(VISIBLE);
    expect(rows[at].kind).toBe('craftable');
  });

  it('orders rows craftable, then known, then hints', () => {
    const order = recipeListRows(RECIPES, 'All', kinds({ 'iron-ore': 3, coal: 1, stone: 3 })).map(r => r.kind);
    expect(order).toEqual([...order].sort((a, b) => ['craftable', 'known', 'hint'].indexOf(a) - ['craftable', 'known', 'hint'].indexOf(b)));
    expect(new Set(order)).toEqual(new Set(['craftable', 'known', 'hint']));
  });

  it('shows only smelter recipes under Smelter, and everything under All', () => {
    const k = kinds({});
    const smelter = recipeListRows(RECIPES, 'Smelter', k);
    expect(smelter.length).toBeGreaterThan(0);
    expect(smelter.every(r => r.recipe.station === 'smelter')).toBe(true);
    expect(smelter.map(r => r.recipe.id)).toContain('iron-ingot');
    expect(recipeListRows(RECIPES, 'All', k)).toHaveLength(RECIPES.length);
    // Field is the craft-anywhere recipes.
    expect(recipeListRows(RECIPES, 'Field', k).every(r => r.recipe.station === null)).toBe(true);
    // Stations without a filter (kiln, foundry, engine-works…) show under All only.
    expect(STATION_FILTERS.filter(f => matchesStation('kiln', f))).toEqual(['All']);
  });

  it('scrolls far enough to reach the last row, and no further', () => {
    const total = recipeListRows(RECIPES, 'All', kinds({})).length;
    const bottom = clampScroll(Infinity, total, VISIBLE);
    expect(bottom + VISIBLE).toBe(total); // the last row is the window's last
    expect(clampScroll(-5, total, VISIBLE)).toBe(0);
    expect(clampScroll(3.4, total, VISIBLE)).toBe(3);
    expect(clampScroll(4, 6, VISIBLE)).toBe(0); // a short list doesn't scroll
  });
});
