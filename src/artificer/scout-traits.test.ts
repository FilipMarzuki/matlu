/**
 * Acceptance tests for #1399 — Scout 2: a scout knows the cold, and the Warden grows up over the
 * runs (lower stats that grow to the adult ones, and a young mind that learns fast).
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, creditedPractice, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { STEADY_WORLD } from './test-helpers';
import { createExploration, scout } from './exploration';
import { legacyOf } from './legacy';
import { streamFor, seedOf } from './rng';
import { exposureFor } from './weather';
import { DEFAULT_STATS, statEffects, type Stats } from './stats';
import { grownStats, gapAt, birthdayLine, YOUNG_PRACTICE, ADULT_AGE } from './growing';
import { COLD_WISE, SCOUT_NERVE } from './scout';
import { nerveOf } from './panic';
import { newGame, newRun, serialize, deserialize } from '../artificer-app/controller';
import { observe } from '../artificer-ai/observe';

const STRONG: Stats = { ...DEFAULT_STATS, str: 13, int: 13 };

describe('Knows the cold (#1399)', () => {
  // 1. A cold night: the scout loses 25% less to it.
  it('takes the edge off a cold night', () => {
    // Out in the open in the flat world, fed and watered: a cold, broken night.
    const night = (background?: 'scout'): number => {
      const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-cold', ...(background ? { background } : {}) });
      const out = { ...s, explore: scout(createExploration(), 1), stores: { ...s.stores, rawFood: 9, water: 9 }, character: { ...s.character, talents: [] } };
      const d = runDay(out, ['rest']).state;
      expect(d.log.some(l => /A cold, broken night/.test(l.text))).toBe(true);
      return 100 - d.vitals.condition;
    };
    expect(night('scout')).toBeCloseTo(night() * COLD_WISE, 5);
    expect(night('scout')).toBeGreaterThan(0);
  });

  // 2. A blizzard trip at even odds: the scout's exposure is one step safer, and it stacks with gear.
  it('makes blizzard exposure a step safer', () => {
    // A Warden whose fortune for the hour falls in frostbite at even odds, and out of it one step up.
    let id = '';
    for (let i = 0; i < 2000 && !id; i++) {
      const u = streamFor(seedOf(`w-bz-${i}`), 40, 'blizzard@12')();
      if (exposureFor(u, 0) === 'frostbitten' && exposureFor(u, 1) === 'rough' && exposureFor(u, -1) === 'frostbitten') id = `w-bz-${i}`;
    }
    const out = (background?: 'scout', coldGear = false): Region1State => {
      const s = chooseSite(runAction(createRegion1({ world: { ...STEADY_WORLD, accidents: false, encounters: false } }, undefined, { id, ...(background ? { background } : {}) }), 'scout'), 'cave');
      return { ...s, day: 40, hoursToday: 6, weatherToday: 'storm', tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' }, coldGear, vitals: createVitals(), stores: { ...s.stores, rawFood: 9, water: 9, firewood: 30, materials: 10 }, character: { ...s.character, talents: [], quirks: [] } };
    };
    expect(runAction(out(), 'gather').vitals.condition).toBe(100 - 15); // frostbitten
    expect(runAction(out('scout'), 'gather').vitals.condition).toBe(100 - 5); // rough
    // Stacking: the far ring is two steps worse; a scout with sound cold gear gets both steps back.
    const far = (w: Region1State) => runAction({ ...w, explore: scout(scout(scout(createExploration(), 1), 2), 3) }, 'gather@3').vitals.condition;
    expect(far(out('scout', true))).toBe(100 - 15 * 1); // two steps back from the ring's two: frostbitten again, not worse
  });

  // The scout's nerve offsets a young Warden's lower Willpower.
  it("gives a scout a steadier nerve", () => {
    const young = createRegion1({}, undefined, { id: 'w-n', background: 'scout', age: 12 });
    const plainAdult = createRegion1({}, undefined, { id: 'w-n' });
    expect(young.character.stats.wil).toBe(8);
    expect(nerveOf(young)).toBe(nerveOf(plainAdult));
    expect(nerveOf({ character: { ...plainAdult.character, background: 'scout' } })).toBe(nerveOf(plainAdult) + SCOUT_NERVE);
  });
});

describe('Growing up (#1399)', () => {
  // 3. Adult STR 13 at 12: current 9, and the effects use 9. At 14, 10; at 18, 13.
  it('starts a young Warden with lower stats that grow to the adult ones', () => {
    const at = (age: number) => createRegion1({}, undefined, { id: 'w-grow', stats: STRONG, age });
    expect(at(12).character.stats.str).toBe(9);
    expect(at(14).character.stats.str).toBe(10);
    expect(at(16).character.stats.str).toBe(11);
    expect(at(18).character.stats.str).toBe(13);
    expect(at(12).character.adult).toEqual(STRONG);
    // The gaps at 11, closing to nothing at 18; nothing under 3.
    expect(grownStats(DEFAULT_STATS, 11)).toEqual({ str: 6, con: 7, int: 8, wil: 8, agi: 9, cha: 9 });
    expect(gapAt('str', ADULT_AGE)).toBe(0);
    expect(grownStats({ ...DEFAULT_STATS, str: 5 }, 11).str).toBe(3);
    // Effects read the current stats: a 12-year-old's heavy work costs what STR 9 costs.
    expect(statEffects(at(12).character.stats).heavyVigor).toBe(statEffects({ ...STRONG, str: 9 }).heavyVigor);
    const wood = (s: Region1State) => s.vitals.vigor.current - runAction({ ...s, explore: scout(createExploration(), 1), config: { ...s.config, world: FLAT_WORLD } }, 'wood').vitals.vigor.current;
    expect(wood(at(12))).toBeGreaterThan(wood(at(18)));
    // The game's new Warden is a 12-year-old scout; the AI sees the age and both sets of stats.
    const g = newGame().sim;
    expect(g.character.age).toBe(12);
    expect(observe(g)).toMatch(/AGE: 12 — still growing .*STR 6 \(10\)/);
    // A save keeps the age and the adult stats.
    expect(deserialize(serialize(newGame()))?.sim.character).toMatchObject({ age: 12, adult: DEFAULT_STATS });
  });

  // 4. A run that ends, and the character carries on: a year older, and grown.
  it('ages a year each run, and the stats grow with it', () => {
    const s = createRegion1({}, undefined, { id: 'w-year', stats: STRONG, age: 12, background: 'scout' });
    const done = { ...s, outcome: { choice: 'thaw' as const, kind: 'survived' as const, grade: 'hale' as const, vitals: createVitals() } };
    const legacy = legacyOf(done);
    expect(legacy).toMatchObject({ age: 12, stats: STRONG });
    const next = createRegion1({}, legacy, { id: 'w-year' });
    expect(next.character.age).toBe(13);
    expect(next.character.stats).toEqual(grownStats(STRONG, 13));
    expect(next.log.some(l => l.text === birthdayLine(STRONG, 13))).toBe(true);
    expect(birthdayLine(STRONG, 13)).toMatch(/^You're 13 now — taller than last winter, and /);
    expect(birthdayLine(STRONG, 18)).toBe("You're 18 now — grown, and as strong as you'll be.");
    expect(birthdayLine(STRONG, 19)).toBeNull();
    // Carrying on in the app: the adult stats go on, not the young ones.
    expect(newRun(done).sim.character).toMatchObject({ age: 13, adult: STRONG, stats: grownStats(STRONG, 13) });
  });

  // 5. Ten hours of practice: twelve while young, ten for an adult.
  it('lets a young mind learn faster', () => {
    const young = createRegion1({}, undefined, { id: 'w-learn', age: 12 });
    const adult = createRegion1({}, undefined, { id: 'w-learn', age: 18 });
    const noTalents = (s: Region1State) => ({ ...s, character: { ...s.character, talents: [] } });
    expect(creditedPractice(noTalents(young), 'woodcraft', 10, 'none')).toBeCloseTo(10 * YOUNG_PRACTICE, 10);
    expect(creditedPractice(noTalents(adult), 'woodcraft', 10, 'none')).toBeCloseTo(10, 10);
  });

  // 6. A legacy or save with no age: an adult — the stats as chosen, and no head start.
  it('treats a Warden with no age as grown', () => {
    const old = createRegion1({}, { known: [], concepts: {}, stats: STRONG }, { id: 'w-old' });
    expect(old.character.stats).toEqual(STRONG);
    expect(old.character.age).toBeUndefined();
    expect(creditedPractice({ ...old, character: { ...old.character, talents: [] } }, 'woodcraft', 10, 'none')).toBeCloseTo(10, 10);
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.character.age;
    delete raw.sim.character.adult;
    expect(deserialize(JSON.stringify(raw))?.sim.character.age).toBeUndefined();
  });
});
