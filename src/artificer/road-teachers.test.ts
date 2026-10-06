/**
 * Acceptance tests for #1249 — Region 1.5 teachers: lessons, apprenticing,
 * and an honest appraisal of your skill. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, creditedPractice, practiceSkill, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { createRoad, endRoadDay, guidanceOn, runRoadAction, ROUTE, type RoadState } from './road';
import { LESSON_FEE, LESSON_HOURS, FRIEND_LESSON, personById } from './villages';
import { LEVEL_HOURS, perceivedLevel, skillLevel } from './skills';
import { SOLO_RATE } from './techniques';
import type { Grade } from './winter';

function survived(grade: Grade = 'hale'): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-vega', name: 'Vega', stats: { ...DEFAULT_STATS } });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10 }, outcome: { choice: 'thaw', kind: 'survived', grade, vitals } };
}
function at(id: string): RoadState {
  let s = createRoad(survived());
  const leg = ROUTE.findIndex(l => l.kind === 'village' && l.id === id);
  while (s.leg < leg && !s.outcome) s = endRoadDay(s);
  return s;
}
const lastLine = (s: RoadState): string => s.log.at(-1)?.text ?? '';
const withWoodcraft = (s: RoadState, level: number): RoadState => ({ ...s, skills: { ...s.skills, woodcraft: LEVEL_HOURS[level] } });

describe('Teachers (#1249)', () => {
  // 1. A woodcraft teacher who teaches Seasoning (taught only, level 5); true woodcraft 3: 4h, the fee, and it's learned.
  it('teaches a technique within reach, for a fee', () => {
    expect(personById('hf-orrin')?.teaches?.techniques).toContain('seasoning');
    const s = { ...withWoodcraft(at('hollowford'), 3), marks: 10 };
    expect(s.trust['hf-orrin']).toBeLessThan(FRIEND_LESSON);
    const after = runRoadAction(s, 'learn:hf-orrin:seasoning');
    expect(after.hoursToday).toBe(s.hoursToday + LESSON_HOURS);
    expect(after.marks).toBe(10 - LESSON_FEE);
    expect(after.techniques).toContain('seasoning');
  });

  // 2. True woodcraft 2: Seasoning (level 5) is beyond reach.
  it('refuses a technique beyond your reach', () => {
    const s = { ...withWoodcraft(at('hollowford'), 2), marks: 10 };
    const after = runRoadAction(s, 'learn:hf-orrin:seasoning');
    expect(lastLine(after)).toContain('Come back when you can follow it');
    expect(after.techniques).not.toContain('seasoning');
    expect(after.marks).toBe(10);
    expect(after.hoursToday).toBe(s.hoursToday);
  });

  // 3. Trust 40+: no marks charged.
  it('teaches a friend for free', () => {
    let s = withWoodcraft(at('hollowford'), 3);
    s = { ...s, marks: 0, trust: { ...s.trust, 'hf-orrin': FRIEND_LESSON } };
    const after = runRoadAction(s, 'learn:hf-orrin:seasoning');
    expect(after.techniques).toContain('seasoning');
    expect(after.marks).toBe(0);
  });

  // 4. True hunting 5 (solo 0.6) with a hunting teacher in the village: 4h credits the full 4h, not ×0.6.
  it('guides practice fully while a teacher of the skill is in the village', () => {
    const road = at('saltmere');
    expect(guidanceOn(road, 'hunting')).toBe('teacher');
    expect(guidanceOn(at('hollowford'), 'hunting')).toBe('none');
    const r1 = { ...survived(), skills: { hunting: LEVEL_HOURS[5] } };
    expect(skillLevel(r1.skills, 'hunting')).toBe(5);
    expect(SOLO_RATE[5]).toBe(0.6);
    const taught = creditedPractice(r1, 'hunting', 4, guidanceOn(road, 'hunting'));
    const alone = creditedPractice(r1, 'hunting', 4, 'none');
    expect(taught / alone).toBeCloseTo(1 / 0.6);
    const next = structuredClone(r1);
    practiceSkill(next, 'hunting', 4, guidanceOn(road, 'hunting'));
    expect(next.skills.hunting! - LEVEL_HOURS[5]).toBeCloseTo(taught);
  });

  // 5. Self-assessed woodcraft differs from true: appraisal names the true level; a second one is rejected.
  it('gives an honest appraisal, once per village', () => {
    const s = { ...at('hollowford'), skills: { woodcraft: 12.5 } };
    expect(skillLevel(s.skills, 'woodcraft')).toBe(1);
    expect(perceivedLevel(s.skills, 'woodcraft')).not.toBe(1);
    const after = runRoadAction(s, 'appraise:hf-orrin');
    expect(lastLine(after)).toContain("You're a Novice at woodcraft, whatever you think");
    expect(after.hoursToday).toBe(s.hoursToday + 1);
    const again = runRoadAction(after, 'appraise:hf-orrin');
    expect(lastLine(again)).toMatch(/skipped/);
    expect(again.hoursToday).toBe(after.hoursToday);
  });

  // 6. A teacher who teaches the hide parka: it's added to known recipes, discovered `taught`.
  it('teaches a recipe', () => {
    const s = { ...at('saltmere'), marks: 10 };
    expect(s.known).not.toContain('hide-parka');
    const after = runRoadAction(s, 'learn:sm-anselm:hide-parka');
    expect(after.known).toContain('hide-parka');
    expect(after.discovery['hide-parka']).toBe('taught');
  });

  // Talents (#1262): a hidden Hunter's Patience and a hunting teacher — appraisal makes it known and names it.
  it('recognises a hidden talent in the teacher’s field', () => {
    const s = at('saltmere');
    const hidden = { ...s, character: { ...s.character, talents: [{ id: 'hunter' as const, tier: 1, known: false }] } };
    const after = runRoadAction(hidden, 'appraise:sm-yrsa');
    expect(after.character.talents[0].known).toBe(true);
    expect(lastLine(after)).toContain("hunter's patience");
    expect(hidden.character.talents[0].known).toBe(false);
  });
});
