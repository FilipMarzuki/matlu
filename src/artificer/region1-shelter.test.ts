/**
 * Acceptance tests for #1215 — Build shelter and Cold gear as graded crafts.
 * One test per Given/When/Then criterion (1–5); criterion 6 (save v3) is in
 * src/artificer-app/controller.test.ts.
 */

import { SHORT_THRESHOLDS } from './readiness';
import { describe, it, expect } from 'vitest';
// These check exact numbers and long plans written for an evenly lit day, so they play the flat world (#1281).
import { FLAT_WORLD } from './world';
import { SHORT_YEAR } from './test-helpers';
import { createRegion1, runAction, chooseSite, runDay, warmth, winterReady, REGION1_MILESTONES, type Region1State } from './region1';
import { createVitals } from './vitality';

/** Scouted, settled at `site`, with plenty of materials. */
function camp(site: 'cave' | 'tree' = 'cave', over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world: FLAT_WORLD, calendar: SHORT_YEAR, thresholds: SHORT_THRESHOLDS }), 'scout'), site);
  return { ...s, stores: { ...s.stores, materials: 20 }, ...over };
}

describe('Region 1 shelter & cold gear crafts', () => {
  // 1. Building is a craft: tier + grade on success; a frayed build fails and wastes materials.
  it('builds the shelter as a graded craft', () => {
    const s = camp();
    const built = runAction(s, 'build');
    expect(built.tier).toBe(1);
    expect(built.shelterGrade).toBe('sound');
    expect(built.stores.materials).toBe(17);
    expect(built.hoursToday).toBe(s.hoursToday + 8);
    expect(built.vitals.vigor.current).toBeLessThan(s.vitals.vigor.current);
    expect(built.concepts.joinery?.insight).toBeGreaterThan(0);

    const frayed = camp('cave', { vitals: createVitals({ clarity: 10 }) });
    const failed = runAction(frayed, 'build');
    expect(failed.tier).toBe(0);
    expect(failed.shelterGrade).toBeNull();
    expect(failed.stores.materials).toBe(17);
    expect(failed.log.some(l => l.kind === 'hardship' && /came apart/.test(l.text))).toBe(true);

    // A steady-but-not-sharp mind in the field makes crude work.
    const steady = runAction(camp('cave', { vitals: createVitals({ clarity: 60 }) }), 'build');
    expect(steady.shelterGrade).toBe('crude');
  });

  // 2. Better work, warmer shelter (capped at fully warm).
  it('scales warmth with build grade', () => {
    const s = { ...camp('tree'), tier: 2 as const };
    expect(warmth({ ...s, shelterGrade: 'sound' })).toBeCloseTo(0.7);
    expect(warmth({ ...s, shelterGrade: 'crude' })).toBeCloseTo(0.595); // just short of winterized
    expect(warmth({ ...s, shelterGrade: 'fine' })).toBeCloseTo(0.77);
    expect(warmth({ ...camp('cave'), tier: 2, shelterGrade: 'masterwork' })).toBe(1);
    // Moving resets the build and its grade.
    const moved = chooseSite(runAction(camp(), 'build'), 'tree');
    expect(moved.shelterGrade).toBeNull();
  });

  // 3. Cold gear is a graded tool; crude gear can be remade.
  it('makes cold gear a graded tool, and crude gear worth remaking', () => {
    const made = runAction(camp(), 'coldGear');
    expect(made.tools).toEqual([{ item: 'cold-gear', grade: 'sound', made: { weaving: 0 } }]); // what the maker understood goes in (#1456)
    expect(made.coldGear).toBe(true);

    const rough = runAction(camp('cave', { vitals: createVitals({ clarity: 60 }) }), 'coldGear');
    expect(rough.tools).toEqual([{ item: 'cold-gear', grade: 'crude', made: { weaving: 0 } }]);
    expect(rough.coldGear).toBe(false);
    expect(rough.log.some(l => /won't hold up/.test(l.text))).toBe(true);
    // Crude gear can be remade; sound gear is kept.
    const rested = runAction({ ...rough, vitals: createVitals() }, 'coldGear');
    expect(rested.tools.at(-1)).toEqual({ item: 'cold-gear', grade: 'sound', made: { weaving: 0 } });
    expect(rested.coldGear).toBe(true);
    expect(runAction(made, 'coldGear').log.at(-1)?.text).toMatch(/already have sound cold gear/);

  });

  // 4. A shovel lightens the build.
  it('lets a shovel make building cheaper on the body', () => {
    const roofed = runAction(camp(), 'build');
    const plain = runAction(roofed, 'build');
    const dug = runAction({ ...roofed, tools: [{ item: 'crude-shovel', grade: 'sound' }] }, 'build');
    expect(dug.tier).toBe(2);
    expect(dug.vitals.vigor.current).toBeGreaterThan(plain.vitals.vigor.current);
  });

  // 5. A tools-first plan also gets winter-ready in nine days (second balance canary).
  it('gets a tools-first player winter-ready in nine days', () => {
    let s = chooseSite(runAction(createRegion1({ world: FLAT_WORLD, calendar: SHORT_YEAR, thresholds: SHORT_THRESHOLDS }), 'scout'), 'cave');
    const plan = [
      ['wood', 'wood', 'knife'], ['build', 'track', 'water'], ['hunt', 'hunt', 'water'],
      ['wood', 'wood', 'snare'], ['wood', 'preserve', 'preserve'], ['wood', 'build'],
      ['hunt', 'hunt', 'preserve'], ['scout@2', 'hunt', 'preserve'], ['hunt', 'preserve', 'rest'],
    ] as const;
    for (const day of plan) {
      const r = runDay(s, day);
      expect(r.remaining).toEqual([]);
      s = r.state;
    }
    expect(s.day).toBe(10);
    expect(winterReady(s)).toBe(true);
    expect(s.milestones).toEqual(REGION1_MILESTONES.map(m => m.id));
    expect(s.tools.map(t => t.item)).toEqual(['stone-knife', 'trap-snare']);
    expect(s.log.some(l => /Hungry|Thirsty/.test(l.text))).toBe(false);
  });
});
