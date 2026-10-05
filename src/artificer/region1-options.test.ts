/**
 * Acceptance tests for #1219 — action options on queued builds (criteria 1–4).
 * Criterion 5 (controller setOption + saves) is in src/artificer-app/controller.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, warmth, ACTIONS, STARTING_RECIPES, DISCOVERIES, type Region1State } from './region1';

/** Every recipe known, so these tests are about options, not discovery. */
const ALL_RECIPES = [...STARTING_RECIPES, ...DISCOVERIES.map(d => d.recipe)];

/** Scouted, camped at the cave, with plenty of materials. */
function camp(over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
  return { ...s, known: ALL_RECIPES, stores: { ...s.stores, materials: 20, stone: 0 }, ...over };
}
const opts = (s: Region1State, o: Record<string, string> = {}) => ACTIONS.build.options?.(s, o) ?? [];

describe('Build shelter options', () => {
  // 1. Defaults: a lean-to, then timber walls, at camp — as before.
  it('builds a lean-to then timber walls at camp by default', () => {
    const one = runAction(camp(), 'build');
    expect(one.tier).toBe(1);
    expect(one.shelter).toEqual({ type: 'leanto', walls: null });
    expect(one.stores.materials).toBe(17);
    expect(warmth(one)).toBeCloseTo(0.585);
    const two = runAction(one, 'build');
    expect(two.shelter).toEqual({ type: 'leanto', walls: 'timber' });
    expect(two.stores.materials).toBe(12);
    expect(warmth(two)).toBeCloseTo(0.9);
  });

  // 2. A brush hut costs more and holds more; stone walls need stone and hold the most.
  it('builds the chosen design at its cost', () => {
    const s = camp();
    const hut = runAction(s, { q: 'build', opts: { type: 'hut' } });
    expect(hut.shelter.type).toBe('hut');
    expect(hut.stores.materials).toBe(15);
    expect(hut.hoursToday).toBe(s.hoursToday + 11);
    expect(warmth(hut)).toBeGreaterThan(warmth(runAction(s, 'build')));

    // Stone walls without stone: refused, free.
    const noStone = runAction(hut, { q: 'build', opts: { walls: 'stone' } });
    expect(noStone.tier).toBe(1);
    expect(noStone.log.at(-1)?.text).toMatch(/needs 4 stone/);
    expect(noStone.hoursToday).toBe(hut.hoursToday);

    const banked = runAction({ ...hut, stores: { ...hut.stores, stone: 6 } }, { q: 'build', opts: { walls: 'stone' } });
    expect(banked.shelter).toEqual({ type: 'hut', walls: 'stone' });
    expect(banked.stores.stone).toBe(2);
    expect(banked.stores.materials).toBe(13);
    // On the treeline, stone walls hold more than timber (0.77 vs 0.70).
    const tree = { ...hut, site: 'tree' as const };
    expect(warmth({ ...tree, tier: 2, shelter: { type: 'hut', walls: 'stone' } })).toBeGreaterThan(warmth({ ...tree, tier: 2, shelter: { type: 'hut', walls: 'timber' } }));
  });

  // 3. Building at another site moves camp and starts over there.
  it('moves camp when building somewhere else', () => {
    const roofed = runAction(camp(), 'build');
    const moved = runAction(roofed, { q: 'build', opts: { site: 'tree' } });
    expect(moved.site).toBe('tree');
    expect(moved.tier).toBe(1); // a fresh lean-to there, not walls
    expect(moved.shelter).toEqual({ type: 'leanto', walls: null });
    expect(moved.log.some(l => /old shelter is left behind/.test(l.text))).toBe(true);

    // With no camp yet, a build needs a location (and choosing one settles there).
    const fresh = runAction(createRegion1(), 'scout');
    expect(runAction(fresh, 'build').log.at(-1)?.text).toMatch(/choose a location/);
    const settled = runAction({ ...fresh, stores: { ...fresh.stores, materials: 5 } }, { q: 'build', opts: { site: 'cave' } });
    expect(settled.site).toBe('cave');
    expect(settled.tier).toBe(1);
  });

  // 4. Only real choices are offered.
  it('offers only the choices that apply', () => {
    const s = camp();
    expect(opts(s).map(g => g.key)).toEqual(['site', 'type']);
    expect(opts(s).find(g => g.key === 'site')?.value).toBe('cave');

    const roofed = runAction(s, 'build');
    expect(opts(roofed).map(g => g.key)).toEqual(['site', 'walls']);
    // Choosing a new site resets the stage, so the roof choice comes back.
    expect(opts(roofed, { site: 'river' }).map(g => g.key)).toEqual(['site', 'type']);
    expect(opts(roofed).find(g => g.key === 'site')?.choices.find(c => c.value === 'tree')?.note).toMatch(/leaves your shelter behind/);

    const winterized = runAction(roofed, 'build');
    expect(opts(winterized).map(g => g.key)).toEqual(['site']);

    // Before scouting there's no location to pick, and no site yet.
    const blind = createRegion1();
    const site = opts(blind).find(g => g.key === 'site');
    expect(site?.value).toBeNull();
    expect(site?.choices.every(c => c.blocked === 'scout first')).toBe(true);
  });
});
