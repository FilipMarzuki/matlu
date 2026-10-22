/**
 * Acceptance tests for #1515 — the Homestead's recipe discovery, without a browser.
 *
 * The crafting menu crafts only discovered recipes, and of DiscoverySystem's routes only innate
 * recipes and craft-counting memory triggers were ever fired. Its rules now live in a Phaser-free
 * Discovery class (DiscoverySystem wraps it for saving and events), so they can be tested here.
 */

import { describe, it, expect } from 'vitest';
import recipesJson from '../../public/macro-world/recipes.json';
import { Discovery, gatherActions, type RecipeDiscoveryDef } from './Discovery';
import { queueRecipes } from './ActionQueue';

/** The registry's recipes with their discovery defs, as the crafting menu loads them. */
const RECIPES = (recipesJson.recipes as { id?: string }[]).filter((r): r is { id: string } => typeof r.id === 'string') as unknown as
  { id: string; inputs: { item: string; qty: number }[]; discovery?: RecipeDiscoveryDef }[];

describe('Recipe discovery (#1515)', () => {
  // 1. Gathering counts toward memory triggers: healing salve is "gather:herb-green:5".
  it('discovers healing salve after gathering green herbs five times', () => {
    const d = new Discovery();
    d.loadRecipeDefs(RECIPES);
    expect(d.isDiscovered('healing-salve')).toBe(false);
    for (let i = 0; i < 4; i++) expect(d.recordAction('gather:herb-green')).toEqual([]);
    expect(d.isDiscovered('healing-salve')).toBe(false);
    expect(d.recordAction('gather:herb-green')).toContain('healing-salve');
    expect(d.isDiscovered('healing-salve')).toBe(true);
    // Each gather counts once per item it yields, whatever the quantity.
    expect(gatherActions([{ itemId: 'herb-green', qty: 2 }, { itemId: 'plant-fiber', qty: 1 }, { itemId: 'herb-green', qty: 1 }]))
      .toEqual(['gather:herb-green', 'gather:plant-fiber']);
  });

  // 1b. Gathering before the recipes are loaded still counts: loading them checks the counters.
  it('unlocks a memory recipe whose count was met before the recipes loaded', () => {
    const d = new Discovery();
    for (let i = 0; i < 5; i++) d.recordAction('gather:herb-green');
    expect(d.loadRecipeDefs(RECIPES)).toContain('healing-salve');
    expect(d.isDiscovered('healing-salve')).toBe(true);
  });

  // 2. An experiment recipe is found by trying exactly its inputs; a wrong combination finds nothing.
  it('discovers an experiment recipe from exactly its inputs, and nothing from a wrong combination', () => {
    const d = new Discovery();
    d.loadRecipeDefs(RECIPES);
    const recipes = queueRecipes(recipesJson.recipes);
    expect(d.isDiscovered('glass')).toBe(false); // glass: stone + salt + charcoal, by experiment
    expect(d.tryExperiment(['stone', 'salt'], recipes)).toBeNull();
    expect(d.tryExperiment(['stone', 'salt', 'charcoal', 'rope'], recipes)).toBeNull();
    expect(d.isDiscovered('glass')).toBe(false);
    expect(d.tryExperiment(['charcoal', 'stone', 'salt'], recipes)).toBe('glass'); // order doesn't matter
    expect(d.isDiscovered('glass')).toBe(true);
    // Only experiment recipes: trying a taught recipe's inputs doesn't teach it.
    expect(d.tryExperiment(['iron-blade', 'leather-strip', 'wood-handle'], recipes)).toBeNull();
    expect(d.isDiscovered('iron-dagger')).toBe(false);
  });

  // The state round-trips through a save, as DiscoverySystem stores it in localStorage.
  it('saves and restores what was discovered and counted', () => {
    const d = new Discovery();
    d.loadRecipeDefs(RECIPES);
    d.recordAction('gather:herb-green');
    d.recordFlag('inspect:animal-trail');
    const back = Discovery.fromSave(JSON.parse(JSON.stringify(d.toSave())));
    back.loadRecipeDefs(RECIPES);
    expect(back.isDiscovered('trap-snare')).toBe(true); // the observation the flag unlocked
    expect(back.getCounter('gather:herb-green')).toBe(1);
    expect(back.getCounter('gather:any')).toBe(1);
    // A corrupt or missing save starts fresh.
    expect(Discovery.fromSave(null).getCounter('gather:any')).toBe(0);
    expect(Discovery.fromSave({ discovered: 'nope', counters: { x: 'y' } }).isDiscovered('nope')).toBe(false);
  });
});
