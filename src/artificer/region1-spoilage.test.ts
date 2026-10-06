/**
 * Acceptance tests for #1295 — fresh food spoils; the cold pit and the snow
 * keep it. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, blockedReason, spoilage, coldCapacity, coldPitHolds, SNOW_CACHE, type Region1State, type SiteId } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { STEADY_WORLD } from './test-helpers';
import { nightTemp } from './weather';
import { newGame, serialize, deserialize } from '../artificer-app/controller';

/** A Warden camped at `site` on `day`, fed and watered, with `food` raw food (full world, luck off). */
function camp(site: SiteId, day: number, food: number, over: Partial<Region1State> = {}, world = STEADY_WORLD): Region1State {
  const s = chooseSite(runAction(createRegion1({ world }), 'scout'), site);
  return { ...s, day, hoursToday: 0, weatherToday: 'overcast', tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' }, vitals: createVitals(), stores: { ...s.stores, rawFood: food, rations: 0, water: 20, firewood: 40, stone: 8, materials: 6 }, ...over };
}
const lines = (s: Region1State): string => s.log.map(l => l.text).join('\n');

describe('Spoilage and cold storage (#1295)', () => {
  // 1. A mild night, no cold storage: a fifth of 10 spoils, leaving 8.
  it('spoils a fifth of exposed raw food on a mild night', () => {
    expect(spoilage(10, 0, 8)).toEqual({ kept: 0, exposed: 10, spoiled: 2 });
    // In play, on an early-autumn night (eat 1, then 20% of the 9 left, rounded up).
    const s = camp('cave', 3, 10);
    expect(nightTemp(3, 'overcast', s.config.calendar)).toBeGreaterThan(2);
    const after = runDay(s, []).state;
    expect(after.stores.rawFood).toBe(10 - 1 - 2);
    expect(lines(after)).toMatch(/2 raw food went bad\./);
  });

  // 2. A cold pit keeps 8; of the 2 left out, 1 spoils (rounded up).
  it('keeps raw food in a cold pit, and spoils only what is left out', () => {
    expect(spoilage(10, 8, 8)).toEqual({ kept: 8, exposed: 2, spoiled: 1 });
    // Dig one: 4 stone and 2 materials, at the camp.
    const s = camp('cave', 3, 10);
    expect(blockedReason(s, 'coldPit', 1)).toBeNull();
    const dug = runAction(s, 'coldPit');
    expect(dug.coldPitAt).toBe('cave');
    expect(dug.stores).toMatchObject({ stone: 4, materials: 4 });
    expect(dug.tools.some(t => t.item === 'cold-pit')).toBe(false);
    expect(blockedReason(dug, 'coldPit', 1)).toMatch(/already a cold pit/);
    expect(coldCapacity(dug, 8)).toBe(8);
    // A night with 10 raw food: eat 1, keep 8 cold, and of the 1 exposed, 1 spoils.
    expect(runDay(dug, []).state.stores.rawFood).toBe(10 - 1 - 1);
    // The pit stays where it was dug.
    expect(coldCapacity({ ...dug, site: 'tree' }, 8)).toBe(0);
  });

  // 3. Near freezing: half the rate. In a hard frost: none.
  it('slows spoilage near freezing and stops it in a hard frost', () => {
    expect(spoilage(10, 0, 0).spoiled).toBe(1);
    expect(spoilage(10, 0, 2).spoiled).toBe(1);
    expect(spoilage(10, 0, -6).spoiled).toBe(0);
    // Winter's snow keeps 6 more, while the nights stay at or below 2 °C.
    const winter = camp('cave', 40, 10);
    expect(coldCapacity(winter, -3)).toBe(SNOW_CACHE);
    expect(coldCapacity(winter, 4)).toBe(0);
    expect(coldCapacity({ ...winter, day: 20 }, -3)).toBe(0);
  });

  // 4. Rations never spoil.
  it('never spoils rations', () => {
    const s = camp('cave', 3, 0, { stores: { ...camp('cave', 3, 0).stores, rawFood: 0, rations: 10 } });
    let after = s;
    for (let i = 0; i < 3; i++) after = runDay(after, []).state;
    expect(after.stores.rations).toBe(10 - 3); // three meals, nothing lost
    expect(lines(after)).not.toMatch(/went bad/);
  });

  // 5. At the river, a cold pit holds 12.
  it('makes a river cold pit hold 12', () => {
    expect(coldPitHolds('river')).toBe(12);
    expect(coldPitHolds('cave')).toBe(8);
    const dug = runAction(camp('river', 3, 0), 'coldPit');
    expect(coldCapacity(dug, 8)).toBe(12);
    // The pit survives a save; a made-up site doesn't.
    const saved = { ...newGame(), sim: dug };
    expect(deserialize(serialize(saved))?.sim.coldPitAt).toBe('river');
    const raw = JSON.parse(serialize(saved));
    raw.sim.coldPitAt = 'moon';
    expect(deserialize(JSON.stringify(raw))?.sim.coldPitAt).toBeUndefined();
  });

  // 6. The flat world: no spoilage, so exact-number tests stay valid.
  it('keeps the flat world free of spoilage', () => {
    const after = runDay(camp('cave', 3, 10, {}, FLAT_WORLD), []).state;
    expect(after.stores.rawFood).toBe(9);
    expect(lines(after)).not.toMatch(/went bad/);
  });
});
