/**
 * Acceptance tests for #1514 — the registries' references resolve.
 *
 * The content inventory (#1505) found 87 item ids that recipes use but the item registry doesn't
 * define (mostly what the recipes make), 83 concept `unlocks` naming recipes that don't exist, a
 * few `learnedFrom` entries in no known form, and items flagged NPC-only that a player crafts or
 * buys. These tests keep all of that from drifting back.
 */

import { describe, it, expect } from 'vitest';
import itemRegistry from '../../macro-world/item-registry.json';
import recipesJson from '../../public/macro-world/recipes.json';
import conceptsJson from '../../public/macro-world/concepts.json';
import shopsJson from '../../macro-world/shop-inventories.json';
import { queueRecipes } from './ActionQueue';

const items = itemRegistry.items as { id: string; playerObtainable: boolean }[];
const itemIds = new Set(items.map(i => i.id));
const recipes = queueRecipes(recipesJson.recipes);
const recipeIds = new Set(recipes.map(r => r.id));
type Concept = { id: string; ranks: number; requires?: string[]; learnedFrom?: string[]; unlocks?: string[]; futureUnlocks?: string[] };
const concepts = conceptsJson.concepts as Concept[];
const conceptRanks = new Map(concepts.map(c => [c.id, c.ranks]));

/** `concept:rank` with a real concept and a rank it has: e.g. `rotation:2`. */
const conceptAtRank = (s: string): boolean => {
  const [id, rank] = s.split(':');
  return conceptRanks.has(id) && Number(rank) >= 1 && Number(rank) <= conceptRanks.get(id)!;
};
/** A typed source, as DiscoverySystem's flags are written: `npc:…`, `observation:…`, `activity:…`. */
const TYPED_SOURCE = /^(npc|observation|activity):[a-z0-9-]+$/;

describe('Registry references resolve (#1514)', () => {
  // 1. Everything a recipe takes or makes is an item the registry defines.
  it('defines every recipe input and output in item-registry.json', () => {
    const missing = recipes.flatMap(r => [...r.inputs, r.output].filter(s => !itemIds.has(s.item)).map(s => `${r.id}: ${s.item}`));
    expect(missing).toEqual([]);
  });

  // 2. A concept's unlocks are real recipes (ideas not built yet live in futureUnlocks); what it's
  //    learned from is an item, a recipe, a concept at a rank, or a typed source; its prerequisites exist.
  it('points concept unlocks at recipes, learnedFrom at known sources, and requires at real concepts', () => {
    const bad: string[] = [];
    for (const c of concepts) {
      for (const u of c.unlocks ?? []) if (!recipeIds.has(u)) bad.push(`${c.id} unlocks ${u}`);
      for (const u of c.futureUnlocks ?? []) if (recipeIds.has(u)) bad.push(`${c.id} futureUnlocks ${u}, which exists: move it to unlocks`);
      for (const f of c.learnedFrom ?? []) if (!itemIds.has(f) && !recipeIds.has(f) && !conceptAtRank(f) && !TYPED_SOURCE.test(f)) bad.push(`${c.id} learnedFrom ${f}`);
      for (const r of c.requires ?? []) if (!conceptAtRank(r)) bad.push(`${c.id} requires ${r}`);
    }
    expect(bad).toEqual([]);
  });

  // 3. "NPC-only" (playerObtainable: false) means it never enters the player's pack. Anything a
  //    recipe makes or a shop sells does, since crafting and buying put it there.
  it('flags nothing a player crafts or buys as NPC-only', () => {
    const obtained = new Set([...recipes.map(r => r.output.item), ...Object.values(shopsJson.vendors).flat().map(s => s.itemId)]);
    expect(items.filter(i => obtained.has(i.id) && !i.playerObtainable).map(i => i.id)).toEqual([]);
  });
});
