/**
 * Acceptance tests for #1257 — stats grow by use and wear down with hardship. The work you do
 * exercises its stat hour for hour; enough of it raises the stat a point. Long deprivation wears
 * Constitution down, and a collapse leaves its mark. All of it goes with the character.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { legacyOf, COLLAPSE_CON } from './legacy';
import { createRoad, runRoadAction } from './road';
import { TRAVELLERS, TALK_HOURS } from './villages';
import { newRun } from '../artificer-app/controller';
import { DEFAULT_STATS, EXERCISE_TO_NEXT, exerciseFor, exercise, wearDown, STAT_PEAK, type Stats } from './stats';

/** An adult Warden, sheltered and stocked in the flat world (no accidents), with the given stats. */
function settled(stats: Partial<Stats> = {}, over: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-grow', stats: { ...DEFAULT_STATS, ...stats } });
  return {
    ...s, explore: scout(scout(scout(createExploration(), 1), 2), 3), tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' },
    stores: { ...s.stores, rawFood: 9, water: 9, firewood: 30, materials: 10 }, vitals: createVitals({ clarity: 80 }),
    character: { ...s.character, talents: [], quirks: [] }, ...over,
  };
}
/** The same Warden, with some exercise and wear already on them. */
const withGrowth = (s: Region1State, g: Pick<Region1State['character'], 'exercise' | 'wear' | 'trained'>): Region1State => ({ ...s, character: { ...s.character, ...g } });
const said = (s: Region1State, text: string) => s.log.some(l => l.text === text);

describe('Stats grow by use and wear (#1257)', () => {
  // 1. STR 10, 116h exercised: a stint of felling takes it to 11, with nothing left over.
  it('raises a stat a point when its exercise reaches the next', () => {
    const s = settled({ str: 10 });
    // How many hours the felling takes (it all counts as STR exercise).
    const hours = runAction(s, 'wood').character.exercise!.str!;
    expect(hours).toBeGreaterThan(0);
    const grown = runAction(withGrowth(s, { exercise: { str: EXERCISE_TO_NEXT(10) - hours } }), 'wood');
    expect(grown.character.stats.str).toBe(11);
    expect(grown.character.trained).toEqual({ str: 1 });
    expect(grown.character.exercise!.str).toBe(0);
    expect(said(grown, 'The heavy work has hardened your arms — Strength 11.')).toBe(true);
    // The issue's numbers: 116h + 4h.
    const r = exercise({ ...DEFAULT_STATS, str: 10 }, { exercise: { str: 116 } }, 'str', 4);
    expect(r.stats.str).toBe(11);
    expect(r.growth.exercise!.str).toBe(0);
    expect(r.reached).toEqual([11]);
  });

  // 2. STR 14: the next point needs 30 × 36 = 1,080h.
  it('needs much more work for each point the higher it is', () => {
    expect(EXERCISE_TO_NEXT(14)).toBe(1080);
    expect(EXERCISE_TO_NEXT(10)).toBe(120);
    // Never less than 30h, even for a low stat.
    expect(EXERCISE_TO_NEXT(8)).toBe(30);
    expect(EXERCISE_TO_NEXT(5)).toBe(270);
  });

  // 3. Study → INT, a hunt → AGI, a craft → INT (and AGI for a handcraft).
  it('exercises the stat the work uses', () => {
    expect(exerciseFor('study')).toEqual(['int']);
    expect(exerciseFor('hunt')).toEqual(['agi']);
    expect(exerciseFor('wood')).toEqual(['str']);
    expect(exerciseFor('knife', { recipe: true, handcraft: false })).toEqual(['int']);
    expect(exerciseFor('basket', { recipe: true, handcraft: true })).toEqual(['int', 'agi']);
    expect(exerciseFor('rest')).toEqual([]);
    // In play: weaving a basket (3h, handcraft) exercises both, hour for hour.
    const s = settled();
    const b = runAction({ ...s, known: [...s.known, 'basket'] }, 'basket');
    const h = b.hoursToday - s.hoursToday;
    expect(h).toBeGreaterThan(0);
    expect(b.character.exercise).toEqual({ int: h, agi: h });
    // Resting exercises nothing.
    expect(runAction(s, 'rest').character.exercise).toBeUndefined();
  });

  // 4. A 12-hour day: the night gives CON 2h. A hungry night adds 4h.
  it('toughens the body after a long day or a hard night', () => {
    const s = settled({}, { hoursToday: 12 });
    expect(runDay(s, []).state.character.exercise?.con).toBe(2);
    expect(runDay({ ...s, hoursToday: 8 }, []).state.character.exercise?.con).toBeUndefined();
    const hungry = runDay({ ...s, stores: { ...s.stores, rawFood: 0 } }, []).state;
    expect(hungry.character.exercise?.con).toBe(2 + 4);
  });

  // 5. Work with Clarity under 40 exercises WIL; above it, not.
  it('steels the will when you work on with a tired mind', () => {
    const tired = runAction(settled({}, { vitals: createVitals({ clarity: 30 }) }), 'wood');
    const fresh = runAction(settled({}, { vitals: createVitals({ clarity: 60 }) }), 'wood');
    expect(tired.character.exercise?.wil).toBe(tired.character.exercise?.str);
    expect(fresh.character.exercise?.wil).toBeUndefined();
  });

  // 6. 3+ nights hungry with 2 wear: CON drops a point, wear resets, and the journal says so.
  it('wears Constitution down with long hunger', () => {
    const s = withGrowth(settled({ con: 12 }, { deprivation: { hungry: 2, thirsty: 0 }, stores: { ...settled().stores, rawFood: 0 } }), { wear: 2 });
    const night = runDay(s, []).state;
    expect(night.deprivation.hungry).toBe(3);
    expect(night.character.stats.con).toBe(11);
    expect(night.character.trained).toEqual({ con: -1 });
    expect(night.character.wear ?? 0).toBe(0);
    expect(said(night, 'Hunger has left its mark — Constitution 11.')).toBe(true);
    // One night short of the limit, wear builds and CON holds.
    const once = runDay(withGrowth(s, { wear: 0 }), []).state;
    expect(once.character.wear).toBe(1);
    expect(once.character.stats.con).toBe(12);
    // Only two nights hungry: no wear yet.
    expect(runDay({ ...s, deprivation: { hungry: 1, thirsty: 0 } }, []).state.character.wear).toBe(2);
  });

  // 7. CON 3 never wears lower; STR 18 never rises.
  it('stays within 3–18', () => {
    const low = withGrowth(settled({ con: 3 }, { deprivation: { hungry: 2, thirsty: 0 }, stores: { ...settled().stores, rawFood: 0 } }), { wear: 2 });
    expect(runDay(low, []).state.character.stats.con).toBe(3);
    expect(wearDown({ ...DEFAULT_STATS, con: 3 }, {}, 'con').lost).toBe(false);
    const peak = runAction(withGrowth(settled({ str: STAT_PEAK }), { exercise: { str: 5000 } }), 'wood');
    expect(peak.character.stats.str).toBe(STAT_PEAK);
    expect(peak.character.exercise!.str).toBe(0);
  });

  // 8. A character who collapsed starts the next run with CON a point lower.
  it('leaves a collapse in the body', () => {
    const s = settled({ con: 12 });
    const collapsed: Region1State = { ...s, outcome: { choice: 'thaw', kind: 'collapsed', vitals: s.vitals } };
    const next = createRegion1({ world: FLAT_WORLD }, legacyOf(collapsed), { id: 'w-grow' });
    expect(next.character.stats.con).toBe(12 - COLLAPSE_CON);
    // A run that ended well costs nothing.
    const fine: Region1State = { ...s, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals: s.vitals } };
    expect(createRegion1({ world: FLAT_WORLD }, legacyOf(fine), { id: 'w-grow' }).character.stats.con).toBe(12);
  });

  // 9. A living character's next run: stats, exercise and wear carry — and nothing is counted twice.
  it('carries growth into the next run', () => {
    const s = withGrowth(settled({ str: 11 }), { trained: { str: 1 }, exercise: { str: 40, int: 7 }, wear: 1 });
    const done: Region1State = { ...s, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals: s.vitals } };
    const legacy = legacyOf(done);
    // The base stays the chosen one; what use made of it is kept apart.
    expect(legacy.stats!.str).toBe(10);
    expect(legacy).toMatchObject({ trained: { str: 1 }, exercise: { str: 40, int: 7 }, wear: 1 });
    const next = createRegion1({ world: FLAT_WORLD }, legacy, { id: 'w-grow' });
    expect(next.character.stats.str).toBe(11);
    expect(next.character).toMatchObject({ trained: { str: 1 }, exercise: { str: 40, int: 7 }, wear: 1 });
    // The game's own "go on" does the same — STR 11, not 12.
    expect(newRun(done).sim.character.stats.str).toBe(11);
    // On the road: talking to people exercises CHA.
    const road = createRoad(done);
    const talked = runRoadAction(road, `talk:${TRAVELLERS[0].id}`);
    expect(talked.character.exercise?.cha).toBe(TALK_HOURS);
  });
});
