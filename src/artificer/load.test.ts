/**
 * Acceptance tests for #1291 — carrying: weights in stones, the theoretical
 * max, cumbersomeness, and what a trip can bring home. One test per
 * Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { maxLoad, comfortableLoad, rawWeight, cumbersome, overloadRatio, fitHaul, gearOf, leftLine } from './load';
import { createRegion1, runAction, chooseSite, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { FLAT_WORLD } from './world';
import { STEADY_WORLD } from './test-helpers';
import { playRun } from '../artificer-ai/runner';
import { scriptedPlayer } from '../artificer-ai/players/scripted';

const str = (n: number) => ({ ...DEFAULT_STATS, str: n });

/** A camped Warden on a quiet autumn noon, full world with luck off, ring 1 known well. */
function warden(world = STEADY_WORLD, over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world }), 'scout'), 'cave');
  return { ...s, day: 5, hoursToday: 4, weatherToday: 'overcast', vitals: createVitals(), ...over };
}

describe('Carrying (#1291)', () => {
  // 1. STR 10: max 40, comfortable 16. STR 13: max 49.
  it('sets the max and comfortable loads by strength', () => {
    expect(maxLoad(str(10))).toBe(40);
    expect(comfortableLoad(str(10))).toBe(16);
    expect(maxLoad(str(13))).toBe(49);
  });

  // 2. 6 raw food: raw 6, cumbersome 9, ratio 0.5625, nothing left.
  it('weighs a haul, raw and cumbersome', () => {
    const h = { rawFood: 6 };
    expect(rawWeight(h)).toBe(6);
    expect(cumbersome(h)).toBe(9);
    expect(overloadRatio(h, {}, str(10))).toBeCloseTo(0.5625, 10);
    expect(fitHaul(h, {}, str(10))).toEqual({ carried: { rawFood: 6 }, left: {} });
  });

  // 3. 12 stone at STR 10: stone is dropped until cumbersome ≤ 40 — 10 carried, 2 left, and the journal says so.
  it('leaves behind what is too much to carry, heaviest first', () => {
    expect(rawWeight({ stone: 12 })).toBe(36);
    expect(cumbersome({ stone: 12 })).toBeCloseTo(46.8, 10);
    expect(fitHaul({ stone: 12 }, {}, str(10))).toEqual({ carried: { stone: 10 }, left: { stone: 2 } });
    expect(leftLine({ stone: 2 })).toBe('You leave 2 stone behind — too much to carry.');
    // Heaviest first: a mixed haul drops stone before food.
    expect(fitHaul({ stone: 11, rawFood: 5 }, {}, str(10)).left).toEqual({ stone: 3 });
    // In play: a (very weak) Warden of STR 0 can lift only 10 stones, so of a 4-water trip (8 stones, 12 cumbersome) one stays behind.
    const s = warden();
    const weak = { ...s, character: { ...s.character, stats: str(0) }, stores: { ...s.stores, water: 0 } };
    const after = runAction(weak, 'water');
    expect(after.stores.water).toBe(3); // 3 water: 6 stones, 9 cumbersome — the most that fits 10
    expect(after.log.map(l => l.text).join('\n')).toMatch(/You leave 1 water behind — too much to carry\./);
    // A strong Warden brings the whole haul.
    const strong = runAction({ ...weak, character: { ...weak.character, stats: str(10) } }, 'water');
    expect(strong.stores.water).toBe(4);
    expect(strong.log.map(l => l.text).join('\n')).not.toMatch(/too much to carry/);
  });

  // 4. A waterskin makes water's awkwardness 1.0 instead of 1.5.
  it('makes water easier to carry with a waterskin', () => {
    expect(gearOf([{ item: 'waterskin' }])).toEqual({ water: 1 });
    expect(cumbersome({ water: 10 }, gearOf([{ item: 'waterskin' }]))).toBe(20);
    expect(cumbersome({ water: 10 })).toBe(30);
    // 15 water (30 stones): too cumbersome bare-handed (45 > 40), fine with a skin.
    expect(fitHaul({ water: 15 }, {}, str(10)).left).toEqual({ water: 2 });
    expect(fitHaul({ water: 15 }, gearOf([{ item: 'waterskin' }]), str(10)).left).toEqual({});
  });

  // 5. Raw weight over the max is cut, however easy gear makes the load.
  it('cuts raw weight to the max even when gear makes it easy', () => {
    const easy = { stone: 1 };
    expect(fitHaul({ stone: 15 }, easy, str(10))).toEqual({ carried: { stone: 13 }, left: { stone: 2 } });
  });

  // 6. The flat world never cuts a haul.
  it('never cuts a haul in the flat world', () => {
    const s = warden(FLAT_WORLD);
    const weak = { ...s, character: { ...s.character, stats: str(4) }, stores: { ...s.stores, stone: 0 } };
    const after = runAction(weak, 'quarry');
    expect(after.log.map(l => l.text).join('\n')).not.toMatch(/too much to carry/);
    expect(after.stores.stone).toBeGreaterThan(0);
    expect(FLAT_WORLD.carrying).toBe(false);
  });

  // 7. The scripted baseline still comes through the winter in the full world.
  it('keeps the scripted baseline alive to the thaw', async () => {
    let thaw = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = await playRun(scriptedPlayer(), { characterId: `ai-scripted-s${seed}-r1` });
      if (r.record.kind === 'survived') thaw++;
    }
    expect(thaw).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
