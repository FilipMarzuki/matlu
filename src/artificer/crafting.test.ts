/**
 * Acceptance tests for #1211 — the crafting & tools sim module.
 * One test per Given/When/Then criterion (1–7) in the issue.
 */

import { describe, it, expect } from 'vitest';
import {
  modifiersFor, capBonus, capabilities, scaledMult, craft, craftGrade, craftBlocker, createCrafter, craftWorld,
  recipesFromRegistry, salvage, salvageFraction, study, studyCost, newCraftDay, DEFAULT_EFFECTS, COST_FLOOR,
  INSIGHT_TO_NEXT, STUDY_INSIGHT, type CraftRecipe, type ItemEffects, type ConceptDef,
} from './crafting';
import { createVitals } from './vitality';
import recipesJson from '../../public/macro-world/recipes.json';
import conceptsJson from '../../public/macro-world/concepts.json';

const ROPE: CraftRecipe = { id: 'rope', name: 'Rope', inputs: [{ item: 'plant-fiber', qty: 4 }], output: { item: 'rope', qty: 1 }, tier: 0, station: null, timeBase: 2, concepts: ['weaving', 'tension'] };
const KNIFE: CraftRecipe = { id: 'stone-knife', name: 'Stone Knife', inputs: [{ item: 'stone', qty: 2 }, { item: 'rope', qty: 1 }], output: { item: 'stone-knife', qty: 1 }, tier: 0, station: null, timeBase: 3, concepts: ['sharpening'] };

describe('Crafting & tools', () => {
  // 1. Effects: grade-scaled, best copy per item, distinct items stack, unlocks collected.
  it('turns tools into action modifiers', () => {
    const fx: Record<string, ItemEffects> = {
      axe: { actionCost: [{ action: 'wood', pool: 'vigor', mult: 0.7 }], yield: [{ action: 'wood', add: 2 }] },
      saw: { actionCost: [{ action: 'wood', pool: 'vigor', mult: 0.5 }] },
      skin: { unlock: ['carry-water'], cap: [{ pool: 'clarity', add: 4 }] },
    };
    // A sound axe saves 30%; a masterwork one 66%; a crude one 15%.
    expect(scaledMult(0.7, 'sound')).toBeCloseTo(0.7);
    expect(scaledMult(0.7, 'masterwork')).toBeCloseTo(0.34);
    expect(scaledMult(0.7, 'crude')).toBeCloseTo(0.85);
    // Two axes: only the best counts.
    const m = modifiersFor([{ item: 'axe', grade: 'crude' }, { item: 'axe', grade: 'fine' }], 'wood', fx);
    expect(m.vigorMult).toBeCloseTo(0.55);
    expect(m.yieldAdd).toBe(3); // round(2 × 1.5)
    expect(m.clarityMult).toBe(1);
    // An axe and a saw stack multiplicatively, never below the floor.
    expect(modifiersFor([{ item: 'axe', grade: 'sound' }, { item: 'saw', grade: 'sound' }], 'wood', fx).vigorMult).toBeCloseTo(0.35);
    expect(modifiersFor([{ item: 'saw', grade: 'masterwork' }, { item: 'axe', grade: 'masterwork' }], 'wood', fx).vigorMult).toBe(COST_FLOOR);
    // Unrelated actions are untouched; unlocks ignore grade; caps scale.
    expect(modifiersFor([{ item: 'axe', grade: 'sound' }], 'hunt', fx)).toEqual({ vigorMult: 1, clarityMult: 1, timeMult: 1, yieldAdd: 0 });
    expect(capabilities([{ item: 'skin', grade: 'crude' }], fx).has('carry-water')).toBe(true);
    expect(capBonus([{ item: 'skin', grade: 'fine' }], 'clarity', fx)).toBe(6);
  });

  // 2. A successful craft consumes, produces, spends — and stays pure.
  it('crafts: consumes inputs, adds the output (or a graded tool), spends hours and Clarity', () => {
    const s = createCrafter(createVitals(), { inventory: { 'plant-fiber': 5, stone: 2 } });
    const r1 = craft(s, ROPE);
    expect(r1.result).toEqual({ kind: 'crafted', grade: 'sound', output: { item: 'rope', qty: 1 } }); // sharp mind, in the field
    expect(r1.state.inventory).toEqual({ 'plant-fiber': 1, stone: 2, rope: 1 });
    expect(r1.state.vitals.clarity.current).toBeLessThan(100);
    expect(r1.state.vitals.vigor.current).toBeLessThan(100);
    // An item with effects becomes a graded tool instead of a stack.
    const r2 = craft(r1.state, KNIFE);
    expect(r2.result.kind).toBe('crafted');
    expect(r2.state.tools).toEqual([{ item: 'stone-knife', grade: 'sound', made: { sharpening: 0 } }]); // what the maker understood goes in (#1456)
    expect(r2.state.inventory['stone-knife']).toBeUndefined();
    // Purity.
    expect(s.inventory).toEqual({ 'plant-fiber': 5, stone: 2 });
    expect(s.vitals.clarity.current).toBe(100);
    // Building a station or a camp changes the bench.
    const world = craftWorld(recipesFromRegistry(recipesJson.recipes));
    const fire: CraftRecipe = { id: 'campfire', name: 'Campfire', inputs: [{ item: 'wood-log', qty: 3 }], output: { item: 'campfire', qty: 1 }, tier: 0, station: null, timeBase: 4, concepts: ['combustion'] };
    const lit = craft(createCrafter(createVitals(), { inventory: { 'wood-log': 3 } }), fire, world).state;
    expect(lit.bench).toEqual({ tier: 1, stations: ['campfire'] });
  });

  // 3. Refusals: free, with a reason.
  it('refuses a craft it cannot attempt, at no cost', () => {
    const s = createCrafter(createVitals(), { inventory: { 'plant-fiber': 2 } });
    const noMats = craft(s, ROPE);
    expect(noMats.result).toEqual({ kind: 'refused', reason: 'needs 4 plant-fiber (have 2)' });
    expect(noMats.state).toBe(s);

    const stew: CraftRecipe = { ...ROPE, id: 'stew', tier: 1, station: 'campfire', inputs: [] };
    expect(craftBlocker(s, stew)).toMatch(/tier-1 bench/);
    expect(craftBlocker({ ...s, bench: { tier: 1, stations: [] } }, stew)).toBe('needs a campfire');
    expect(craftBlocker({ ...s, bench: { tier: 1, stations: ['campfire'] } }, stew)).toBeNull();

    // Concept gates: default tier rule, or the recipe's explicit conceptRequires.
    const tier3: CraftRecipe = { ...ROPE, id: 't3', tier: 3, inputs: [], concepts: ['joinery'] };
    const atMaster = { ...s, bench: { tier: 3, stations: [] } };
    expect(craftBlocker(atMaster, tier3)).toMatch(/rank 2 in joinery/);
    expect(craftBlocker({ ...atMaster, concepts: { joinery: { rank: 2, insight: 0 } } }, tier3)).toBeNull();
    const forge: CraftRecipe = { ...tier3, conceptRequires: { 'heat-treatment': 2 } };
    expect(craftBlocker({ ...atMaster, concepts: { joinery: { rank: 3, insight: 0 } } }, forge)).toBe('needs heat-treatment rank 2');
  });

  // 4. Quality: better factors → better grade; the bench caps it; a very low score fails.
  it('grades work by mind, bench, tools and knowledge', () => {
    const q = { band: 3, benchTier: 0, tools: 0, conceptRank: 0, recipeTier: 0 };
    expect(craftGrade(q)).toBe('sound');
    expect(craftGrade({ ...q, band: 1 })).toBe('crude');
    expect(craftGrade({ ...q, band: 0 })).toBeNull(); // frayed, improvising → fail
    // The field caps at sound however skilled you are.
    expect(craftGrade({ ...q, tools: 2, conceptRank: 3 })).toBe('sound');
    expect(craftGrade({ ...q, benchTier: 1, tools: 2 })).toBe('fine');
    expect(craftGrade({ ...q, benchTier: 1, tools: 2, conceptRank: 3 })).toBe('fine'); // workbench caps at fine
    expect(craftGrade({ ...q, benchTier: 3, conceptRank: 3 })).toBe('masterwork');
    // Harder recipes pull the grade down.
    expect(craftGrade({ ...q, benchTier: 3, conceptRank: 3, recipeTier: 3 })).toBe('fine');

    // In play: a frayed mind in the field fails.
    const tired = createCrafter(createVitals({ clarity: 10 }), { inventory: { 'plant-fiber': 4 } });
    expect(craft(tired, ROPE).result.kind).toBe('failed');
  });

  // 5. Failure wastes inputs except a salvaged fraction.
  it('wastes inputs on failure, recovering a salvage fraction', () => {
    expect(salvageFraction(0)).toBe(0);
    expect(salvageFraction(2)).toBeCloseTo(0.3);
    expect(salvageFraction(2, 0.2)).toBeCloseTo(0.5);
    expect(salvageFraction(3, 1)).toBe(0.75); // never all of it
    expect(salvage([{ item: 'plant-fiber', qty: 4 }, { item: 'stone', qty: 1 }], 0.5)).toEqual([{ item: 'plant-fiber', qty: 2 }]);

    const fogged = createVitals({ clarity: 10 });
    const lost = craft(createCrafter(fogged, { inventory: { 'plant-fiber': 4 } }), ROPE);
    expect(lost.result).toEqual({ kind: 'failed', salvaged: [] });
    expect(lost.state.inventory['plant-fiber']).toBeUndefined();

    const careful = createCrafter(fogged, { inventory: { 'plant-fiber': 4 }, salvageBonus: 0.5 });
    const saved = craft(careful, ROPE);
    expect(saved.result).toEqual({ kind: 'failed', salvaged: [{ item: 'plant-fiber', qty: 2 }] });
    expect(saved.state.inventory['plant-fiber']).toBe(2);
  });

  // 6. Insight: grade-scaled drip, diminishing study, escalating ranks, locks respected.
  it('ranks concepts up through crafting and study', () => {
    const defs: ConceptDef[] = [{ id: 'weaving', ranks: 3 }, { id: 'tension', ranks: 1 }, { id: 'bearings', ranks: 2, requires: ['friction:1', 'rotation:1'] }];
    const world = craftWorld([], defs);

    // A sound rope drips 2 insight into each of its concepts.
    let s = createCrafter(createVitals(), { inventory: { 'plant-fiber': 40 } });
    s = craft(s, ROPE, world).state;
    expect(s.concepts.weaving).toEqual({ rank: 0, insight: 2 });
    // Three ropes reach the first threshold (6) and rank up.
    s = craft(craft(s, ROPE, world).state, ROPE, world).state;
    expect(s.concepts.weaving).toEqual({ rank: 1, insight: 0 });
    // tension has only one rank: it stops there.
    expect(s.concepts.tension).toEqual({ rank: 1, insight: 0 });

    // Study: ⅓ of the pool, diminishing on repeats the same day, fresh next day.
    const fresh = createCrafter(createVitals());
    const a = study(fresh, 'weaving', world);
    expect(a.gained).toBe(STUDY_INSIGHT);
    expect(a.state.vitals.clarity.current).toBeCloseTo(100 - studyCost(fresh.vitals));
    const b = study({ ...a.state, vitals: createVitals() }, 'weaving', world);
    expect(b.gained).toBe(STUDY_INSIGHT / 2);
    expect(study({ ...newCraftDay(b.state), vitals: createVitals() }, 'weaving', world).gained).toBe(STUDY_INSIGHT);
    expect(INSIGHT_TO_NEXT[1]).toBeGreaterThan(INSIGHT_TO_NEXT[0]);

    // Locked concepts gain nothing; too foggy to study costs nothing.
    expect(study(fresh, 'bearings', world).gained).toBe(0);
    const foggy = createCrafter(createVitals({ clarity: 20 }));
    const refused = study(foggy, 'weaving', world);
    expect(refused.reason).toBe('too foggy to study');
    expect(refused.state).toBe(foggy);
    const opened = { ...fresh, concepts: { friction: { rank: 1, insight: 0 }, rotation: { rank: 1, insight: 0 } } };
    expect(study(opened, 'bearings', world).gained).toBe(STUDY_INSIGHT);
  });

  // 7. The real registries load, and the default effects name real craftables.
  it('reads the real recipe and concept registries', () => {
    const raw = recipesJson.recipes as unknown[];
    const recipes = recipesFromRegistry(raw);
    const realCount = raw.filter(r => typeof r === 'object' && r !== null && 'id' in r).length;
    expect(recipes.length).toBe(realCount);
    expect(recipes.find(r => r.id === 'rope')).toMatchObject({ tier: 0, station: null, timeBase: 2, concepts: ['weaving', 'tension'] });
    expect(recipes.find(r => r.id === 'struct-field-forge')?.conceptRequires).toEqual({ 'heat-treatment': 2 });

    const outputs = new Set(recipes.map(r => r.output.item));
    for (const item of Object.keys(DEFAULT_EFFECTS)) expect(outputs, item).toContain(item);

    const world = craftWorld(recipes, conceptsJson.concepts as ConceptDef[]);
    expect(world.stationItems.has('campfire')).toBe(true);
    expect(world.concepts.bearings?.requires).toEqual(['friction:1', 'rotation:1']);
  });
});
