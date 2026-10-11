/**
 * Acceptance tests for #1243 — techniques (typical of a level, not locked to
 * it), teachers and manuals, and harder solo progress at high levels.
 */

import { STEADY_WORLD } from './test-helpers';
import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, learnTechnique, type Region1State } from './region1';
import { createVitals } from './vitality';
import { legacyOf } from './legacy';
import { LEVEL_HOURS, skillLevel } from './skills';
import { observe } from '../artificer-ai/observe';
import { techniqueById, selfLearnHours, canBeTaught, guidanceRate, techniqueFactor } from './techniques';

const scouted = (over: Partial<Region1State> = {}): Region1State => ({ ...runAction(createRegion1({ world: STEADY_WORLD }), 'scout'), hoursToday: 0, vitals: createVitals(), ...over });
const lines = (before: Region1State, after: Region1State) => after.log.slice(before.log.length).map(l => l.text).join('\n');

describe('Techniques, teachers and manuals (#1243)', () => {
  // 1. Easy, self-taught: Reading the grain after 4h of woodcraft; then wood +1.
  it('works out an easy technique by doing', () => {
    expect(selfLearnHours(techniqueById('grain')!)).toBe(4);
    const before = scouted();
    const after = runAction(before, 'wood');
    expect(after.techniques).toContain('grain');
    expect(lines(before, after)).toMatch(/You've worked out reading the grain/);
    const wood = (s: Region1State) => runAction(s, 'wood').stores.firewood - s.stores.firewood;
    expect(wood({ ...after, hoursToday: 0, vitals: createVitals() })).toBe(wood(scouted({ techniques: [] })) + 1);
  });

  // 2. Hard, self-taught: an Adept-typical hard technique needs 150h alone.
  it('works out a hard technique only after long practice', () => {
    expect(selfLearnHours(techniqueById('notching')!)).toBe(LEVEL_HOURS[3] * 2.5);
    expect(learnTechnique(scouted({ skills: { woodcraft: 149 } }), 'notching', 'self').learned).toBe(false);
    expect(learnTechnique(scouted({ skills: { woodcraft: 150 } }), 'notching', 'self').learned).toBe(true);
  });

  // 3. Teacher-only: never alone, but a teacher can.
  it('keeps some techniques for teachers', () => {
    const veteran = scouted({ skills: { woodcraft: 1_000_000 } });
    expect(learnTechnique(veteran, 'seasoning', 'self')).toMatchObject({ learned: false, reason: 'this has to be taught' });
    expect(learnTechnique(scouted({ skills: { woodcraft: LEVEL_HOURS[3] } }), 'seasoning', 'teacher').learned).toBe(true);
  });

  // 4. Lopsided but bounded: up to L+2 from a teacher, not L+3.
  it('lets a teacher reach two levels above you, not three', () => {
    const seasoning = techniqueById('seasoning')!; // typical of Skilled (5)
    expect(canBeTaught(seasoning, 3)).toBe(true);
    expect(canBeTaught(seasoning, 2)).toBe(false);
    expect(learnTechnique(scouted({ skills: { woodcraft: LEVEL_HOURS[2] } }), 'seasoning', 'teacher')).toMatchObject({ learned: false });
  });

  // 5. Solo practice slows at high levels; a manual brings it halfway back, a teacher fully.
  it('makes solo practice less efficient at high levels', () => {
    expect(guidanceRate(5, 'none') * 10).toBeCloseTo(6, 10);
    expect(guidanceRate(5, 'manual') * 10).toBeCloseTo(8, 10);
    expect(guidanceRate(5, 'teacher') * 10).toBeCloseTo(10, 10);
    expect(guidanceRate(2, 'none')).toBe(1);
    // In play: a Skilled hunter practising alone, all typical techniques known, credits 0.6× the hours.
    const skilled = scouted({ skills: { hunting: LEVEL_HOURS[5] }, techniques: ['sign', 'stalking', 'dressing'] });
    const after = runAction(skilled, 'track');
    expect(after.skills.hunting! - LEVEL_HOURS[5]).toBeCloseTo(4 * 0.6, 5);
  });

  // 6. Knowing the typical techniques speeds the climb.
  it('climbs slower without the techniques typical of your level', () => {
    expect(techniqueFactor([], 'woodcraft', 3)).toBeCloseTo(0.7, 10);
    expect(techniqueFactor(['grain', 'notching'], 'woodcraft', 3)).toBe(1);
    expect(techniqueFactor(['grain'], 'woodcraft', 3)).toBeCloseTo(0.85, 10);
    expect(techniqueFactor([], 'woodcraft', 0)).toBe(1); // a beginner learns at full speed
  });

  // 7. Manuals: found on first scouting the far ring; taught when within reach.
  it('finds a manual that teaches when you are ready', () => {
    const near = { ...runAction(createRegion1({ world: STEADY_WORLD }), 'scout'), hoursToday: 0, vitals: createVitals() };
    const far = runAction(near, 'scout@2');
    expect(far.manuals).toContain('tally-book');
    expect(lines(near, far)).toMatch(/trapper's tally-book/);
    // Untrained in hunting: Still hunting (Adept) is more than two levels away — it waits.
    expect(far.techniques).not.toContain('stalking');
    expect(lines(near, far)).toMatch(/beyond you for now/);
    // Once Novice (within reach of Adept), practising hunting takes it up from the book.
    const novice = { ...far, skills: { ...far.skills, hunting: LEVEL_HOURS[1] }, hoursToday: 0, vitals: createVitals() };
    const tracked = runAction(novice, 'track');
    expect(tracked.techniques).toContain('stalking');
    expect(lines(novice, tracked)).toMatch(/From a trapper's tally-book: still hunting/);
    expect(skillLevel(tracked.skills, 'hunting')).toBeGreaterThanOrEqual(1);
  });

  // 8. Techniques carry with the character; manuals stay behind.
  it('carries techniques, not manuals', () => {
    const done = { ...scouted({ techniques: ['grain', 'stalking'], manuals: ['tally-book'] }), outcome: { choice: 'winter' as const, kind: 'grim' as const, vitals: createVitals() } };
    const next = createRegion1({}, legacyOf(done));
    expect(next.techniques).toEqual(['grain', 'stalking']);
    expect(next.manuals).toEqual([]);
  });

  // 9. The AI sees the techniques it knows and the manuals it carries.
  it('shows known techniques and manuals to the AI', () => {
    expect(observe(createRegion1())).toMatch(/TECHNIQUES: none yet/);
    const text = observe(scouted({ techniques: ['grain'], manuals: ['tally-book'] }));
    expect(text).toMatch(/TECHNIQUES: Reading the grain \| MANUALS: A trapper's tally-book/);
  });
});
