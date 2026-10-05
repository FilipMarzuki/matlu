/**
 * Acceptance tests for #1256 — character stats core: six DoD-style stats,
 * point-buy, and their effects in Region 1 and on the caravan road. One test
 * per Given/When/Then scenario.
 */

import { STEADY_WORLD } from './test-helpers';
import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, setFocus, sleepNight, type Region1State } from './region1';
import { createVitals } from './vitality';
import { INSIGHT_TO_NEXT } from './crafting';
import { reliability } from './focus';
import { legacyOf } from './legacy';
import { createRoad } from './road';
import { DEFAULT_STATS, pointCost, validStats, statEffects, type Stats } from './stats';
import { deserialize, serialize, newGame, newRun } from '../artificer-app/controller';

const spread = (s: Partial<Stats>): Stats => ({ ...DEFAULT_STATS, ...s });
/** A scouted Warden, fresh, with the given stats and no traits. */
const warden = (s: Partial<Stats> = {}, over: Partial<Region1State> = {}): Region1State => {
  const base = runAction(createRegion1({ world: STEADY_WORLD }, undefined, { stats: spread(s) }), 'scout');
  return { ...base, hoursToday: 0, vitals: createVitals(), ...over };
};
const vigorUsed = (s: Region1State, item: Parameters<typeof runAction>[1]) => s.vitals.vigor.current - runAction(s, item).vitals.vigor.current;
const clarityUsed = (s: Region1State, item: Parameters<typeof runAction>[1]) => s.vitals.clarity.current - runAction(s, item).vitals.clarity.current;
/** All insight ever earned in a concept (ranks included). */
const totalInsight = (s: Region1State, id: string) => {
  const p = s.concepts[id] ?? { rank: 0, insight: 0 };
  return INSIGHT_TO_NEXT.slice(0, p.rank).reduce((a, b) => a + b, 0) + p.insight;
};

describe('Character stats (#1256)', () => {
  // 1. Point-buy: 6 points; 1 per step to 13, 2 per step for 14–15; lowering to 7 refunds 1 per step.
  it('prices spreads by point-buy', () => {
    expect(pointCost(spread({ str: 13, int: 13 }))).toBe(6);
    expect(validStats(spread({ str: 13, int: 13 }))).toBe(true);
    expect(pointCost(spread({ con: 15 }))).toBe(7);
    expect(validStats(spread({ con: 15 }))).toBe(false);
    expect(validStats(spread({ con: 15, cha: 9 }))).toBe(true);
    expect(pointCost(spread({ agi: 15, cha: 7, int: 12 }))).toBe(6);
    expect(validStats(spread({ agi: 15, cha: 7, int: 12 }))).toBe(true);
    expect(validStats(spread({ str: 16, cha: 7, wil: 7, con: 7 }))).toBe(false);
    expect(validStats(spread({ wil: 6 }))).toBe(false);
    expect(pointCost(spread({ str: 14, int: 14 }))).toBe(10);
    expect(validStats(spread({ str: 14, int: 14 }))).toBe(false);
    expect(validStats(DEFAULT_STATS)).toBe(true);
    expect(validStats({ str: 10 })).toBe(false);
    expect(validStats({ ...DEFAULT_STATS, str: 12.5 })).toBe(false);
  });

  // 2. Strength lightens heavy work.
  it('makes heavy work lighter with Strength', () => {
    expect(vigorUsed(warden({ str: 15 }), 'wood')).toBeCloseTo(vigorUsed(warden(), 'wood') * 0.85, 5);
  });

  // 3. Constitution softens deprivation.
  it('makes thirst cost less Condition with Constitution', () => {
    const lost = (con: number) => {
      const s = structuredClone(warden({ con }, { vitals: createVitals({ condition: 60 }), stores: { ...warden().stores, water: 0, rawFood: 3 } }));
      sleepNight(s, { warmth: 0.8, coldNight: false, lockedToday: false });
      return 60 - s.vitals.condition;
    };
    expect(lost(14)).toBeCloseTo(lost(10) * 0.88, 5);
  });

  // 4. Intelligence: more insight from study, and better (or worse) craft grades.
  it('studies better and crafts finer with Intelligence', () => {
    const gained = (int: number) => totalInsight(runAction({ ...warden({ int }), hoursToday: 0 }, { q: 'study', opts: { concept: 'joinery' } }), 'joinery');
    expect(gained(13)).toBeCloseTo(gained(10) * 1.15, 5);
    expect(statEffects(spread({ int: 13 })).craftGrade).toBe(1);
    expect(statEffects(spread({ int: 7 })).craftGrade).toBe(-1);
    expect(statEffects(spread({ int: 9 })).craftGrade).toBe(0);
    // In play: at Clarity 60 cold gear comes out crude; INT 13 lifts it to sound.
    const steadyAt = (int: number) => {
      const s = chooseSite(warden({ int }), 'cave');
      return { ...s, stores: { ...s.stores, materials: 20 }, vitals: createVitals({ clarity: 60 }) };
    };
    expect(runAction(steadyAt(10), 'coldGear').tools.find(t => t.item === 'cold-gear')?.grade).toBe('crude');
    expect(runAction(steadyAt(13), 'coldGear').tools.find(t => t.item === 'cold-gear')?.grade).toBe('sound');
  });

  // 5. Willpower keeps focus reliable at lower Clarity.
  it('holds focus at lower Clarity with Willpower', () => {
    expect(statEffects(spread({ wil: 15 })).unreliableBelow).toBe(20);
    expect(reliability(25, statEffects(spread({ wil: 15 })).unreliableBelow)).toBe(1);
    expect(reliability(25, statEffects(DEFAULT_STATS).unreliableBelow)).toBe(0.5);
    // In play: a Larder goal at Clarity 25 still yields +1 for WIL 15, not for WIL 10.
    const food = (wil: number) => {
      const s = setFocus(warden({ wil }, { vitals: createVitals({ clarity: 25 }) }), { kind: 'goal', id: 'larder' });
      return runAction(s, 'gather').stores.rawFood - s.stores.rawFood;
    };
    expect(food(15)).toBe(food(10) + 1);
    // …and Willpower lightens the mind's load on all work.
    expect(clarityUsed(warden({ wil: 15 }), 'wood')).toBeCloseTo(clarityUsed(warden(), 'wood') * 0.9, 5);
  });

  // 6. Agility: lighter hunting-and-scouting work, and a lighter walk out.
  it('lightens nimble work and the walk with Agility', () => {
    // Work and walk both ×0.94. (Not exact to 5 places: the walk is drained after the work, and drain
    // depends on morale, which the lighter work leaves a touch higher.)
    expect(statEffects(spread({ agi: 12 }))).toMatchObject({ agileDrain: 0.94, travel: 0.94 });
    expect(vigorUsed(warden({ agi: 12 }), 'scout@2')).toBeCloseTo(vigorUsed(warden(), 'scout@2') * 0.94, 2);
    expect(clarityUsed(warden({ agi: 12 }), 'scout@2')).toBeCloseTo(clarityUsed(warden(), 'scout@2') * 0.94, 2);
    // Agility doesn't touch heavy work.
    expect(vigorUsed(warden({ agi: 15 }), 'wood')).toBeCloseTo(vigorUsed(warden(), 'wood'), 5);
  });

  // 7. Stats carry with the character; old saves get all 10s.
  it('carries stats with the character, and loads old saves', () => {
    const done = { ...warden({ str: 13, int: 13 }), outcome: { choice: 'winter' as const, kind: 'grim' as const, vitals: createVitals() } };
    expect(createRegion1({}, legacyOf(done)).character.stats).toMatchObject({ str: 13, int: 13 });
    expect(newRun(done).sim.character.stats).toMatchObject({ str: 13, int: 13 });
    expect(newGame().sim.character.stats).toEqual(DEFAULT_STATS);
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.character.stats;
    expect(deserialize(JSON.stringify(raw))?.sim.character.stats).toEqual(DEFAULT_STATS);
    // A grown stat (above the creation max) survives a save.
    const grown = JSON.parse(serialize({ sim: warden({ str: 13 }), queue: [] }));
    grown.sim.character.stats.str = 17;
    expect(deserialize(JSON.stringify(grown))?.sim.character.stats.str).toBe(17);
  });

  // 8. The road keeps the character's stats.
  it('keeps stats on the caravan road', () => {
    const left = { ...warden({ cha: 14, con: 12 }), outcome: { choice: 'caravan' as const, kind: 'thrive' as const, vitals: createVitals() } };
    expect(createRoad(left).character.stats).toEqual(spread({ cha: 14, con: 12 }));
  });

  // 9. Charisma: hooks for the road's trust and trade; nothing in Region 1.
  it('exposes Charisma for trust and prices', () => {
    expect(statEffects(spread({ cha: 15 }))).toMatchObject({ trust: 5 });
    expect(statEffects(spread({ cha: 15 })).priceFactor).toBeCloseTo(0.9, 10);
    expect(vigorUsed(warden({ cha: 15 }), 'wood')).toBeCloseTo(vigorUsed(warden(), 'wood'), 5);
  });
});
