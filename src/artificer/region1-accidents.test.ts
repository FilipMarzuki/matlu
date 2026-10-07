/**
 * Acceptance tests for #1285 — accidents, part 4a: a seeded risk from the dark, the weather,
 * tiredness and skill, rolled against the worst hour of the work; bruises, cuts and lost hauls.
 * One test per scenario of #1276 in this part's scope (1–3, 6–8).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD, FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { accidentRisk, craftRisk, rollAccident, worstFortune, bandOf, RISK_CAP } from './accidents';
import { drainMult } from './skills';
import { fortuneAt, seedOf } from './rng';

const ACCIDENT = /a bruise, nothing worse|a bad cut|lose the haul|nicks your hand|across your hand/;
const fresh = { vigor: 100, clarity: 100, skillLevel: 0 };

/** A Warden out in the rain, tired, at mid-morning on day 4 — with accidents on (or off). */
function tired(id: string, accidents = true, over: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, accidents, luck: false } }, undefined, { id });
  return {
    ...s, day: 4, hoursToday: 2, weatherToday: 'rain', explore: scout(scout(createExploration(), 1), 2),
    vitals: createVitals({ vigor: 15, clarity: 25 }), character: { ...s.character, talents: [], quirks: [] }, ...over,
  };
}
const accidentLines = (s: Region1State, from = 0) => s.log.slice(from).filter(l => ACCIDENT.test(l.text));

describe('Accidents (#1285)', () => {
  // 1. Noon, clear, full Vigor and Clarity: a 4h gather's risk is 4% × the skill multiplier.
  it('keeps daylight work in good weather a small risk', () => {
    expect(accidentRisk({ hours: 4, light: 1, weather: 'clear', ...fresh })).toBeCloseTo(0.04 * drainMult(0), 10);
    expect(bandOf(0.04)).toBe('low');
  });

  // 2. The same gather at 22:00 in a storm, Vigor 15, Clarity 25: capped at 35%.
  it('caps the worst conditions at 35%', () => {
    expect(accidentRisk({ hours: 4, light: 0, weather: 'storm', vigor: 15, clarity: 25, skillLevel: 0 })).toBe(RISK_CAP);
    // Each condition counts on its own: the dark triples it, rain is × 1.5, tired × 1.5, foggy × 1.5.
    expect(accidentRisk({ hours: 1, light: 0, weather: 'clear', ...fresh })).toBeCloseTo(0.03, 10);
    expect(accidentRisk({ hours: 1, light: 1, weather: 'rain', ...fresh })).toBeCloseTo(0.015, 10);
    expect(accidentRisk({ hours: 1, light: 1, weather: 'clear', ...fresh, vigor: 15 })).toBeCloseTo(0.015, 10);
    expect(accidentRisk({ hours: 1, light: 1, weather: 'fog', ...fresh, walking: true })).toBeCloseTo(0.03, 10);
  });

  // 3. A seeded roll under the risk: an outcome is applied and journalled.
  it('hurts you when the hour turns against you, and says so', () => {
    let who = '';
    for (let i = 0; i < 400 && !who; i++) if (accidentLines(runAction(tired(`w-acc-${i}`), 'wood@2')).length) who = `w-acc-${i}`;
    const hurt = runAction(tired(who), 'wood@2');
    const safe = runAction(tired(who, false), 'wood@2');
    const line = accidentLines(hurt)[0].text;
    expect(line).toMatch(/^You (stumble|slip|go down hard) on wet stone/);
    // What it did, against the same trip with no accidents: a bruise or cut costs Condition; a lost haul, the haul.
    if (/bruise/.test(line)) expect(hurt.vitals.condition).toBe(safe.vitals.condition - 2);
    else if (/bad cut/.test(line)) expect(hurt.vitals.condition).toBe(safe.vitals.condition - 5);
    else {
      expect(hurt.stores.firewood).toBe(tired(who).stores.firewood);
      expect(safe.stores.firewood).toBeGreaterThan(hurt.stores.firewood);
    }
    // The roll: the worst hour's fortune against the risk per hour; a deeper miss is the worse outcome.
    expect(rollAccident(0.5, 0.1, 2)).toBeNull();
    expect(rollAccident(0.04, 0.1, 2)).toMatchObject({ kind: 'lost-haul', band: 'medium' });
    expect(rollAccident(0.01, 0.1, 2)).toMatchObject({ kind: 'cut', band: 'medium' });
    expect(rollAccident(0.01, 0.04, 1)).toMatchObject({ kind: 'bruise', band: 'low', condition: 2 });
    expect(rollAccident(0.0001, 0.1, 2, true)).toMatchObject({ kind: 'cut' }); // a craft has no haul to lose
  });

  // 6. Woodcraft at Skilled (level 5): the woodcutting risk is × drainMult(5) = 0.74.
  it('lets skilled hands slip less', () => {
    const plain = accidentRisk({ hours: 4, light: 1, weather: 'rain', ...fresh });
    const skilled = accidentRisk({ hours: 4, light: 1, weather: 'rain', ...fresh, skillLevel: 5 });
    expect(skilled / plain).toBeCloseTo(0.74, 2);
  });

  // 7. Rest and study: no risk. A 3h stone-knife craft in daylight, fresh and unskilled: 3%.
  it('makes rest and study safe, and gives crafts their own small risk', () => {
    for (let i = 0; i < 100; i++) {
      for (const a of ['rest', 'study'] as const) expect(accidentLines(runAction(tired(`w-safe-${i}`), a))).toEqual([]);
    }
    const knife = { hours: 3, blade: true, building: false, light: 1, firelight: false, ...fresh, carefulTier: 0 };
    expect(craftRisk(knife)).toBeCloseTo(0.03, 10);
    expect(craftRisk({ ...knife, blade: false })).toBeCloseTo(0.015, 10);
    expect(craftRisk({ ...knife, building: true })).toBeCloseTo(0.03, 10); // building is outdoor work
    expect(craftRisk({ ...knife, light: 0.2 })).toBeCloseTo(0.06, 10); // in the dark with no fire
    expect(craftRisk({ ...knife, light: 0.2, firelight: true })).toBeCloseTo(0.039, 10);
    expect(craftRisk({ ...knife, carefulTier: 2 })).toBeCloseTo(0.024, 10);
  });

  // 8. The same character and actions: identical across replays. The flat world: none.
  it('replays identically, and never happens in the flat world', () => {
    const seed = seedOf('w-replay');
    expect(worstFortune(seed, 5, 9, 3)).toBe(Math.min(fortuneAt(seed, 5, 9), fortuneAt(seed, 5, 10), fortuneAt(seed, 5, 11)));
    for (let i = 0; i < 30; i++) {
      const s = tired(`w-replay-${i}`);
      expect(runAction(s, 'wood@2')).toEqual(runAction(s, 'wood@2'));
    }
    for (let i = 0; i < 200; i++) {
      const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: `w-flat-${i}` });
      const out = runAction({ ...s, explore: scout(createExploration(), 1), vitals: createVitals({ vigor: 15, clarity: 25 }) }, 'wood');
      expect(accidentLines(out)).toEqual([]);
    }
  });
});
