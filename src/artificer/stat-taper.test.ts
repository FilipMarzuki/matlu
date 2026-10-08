/**
 * Acceptance tests for #1440 — physical growth tapers. Each point trained into STR, CON or AGI
 * makes the next cost twice as much (first gains come fast, then a plateau); INT and WIL keep the
 * steady curve; a weak stat is never dearer to raise than a 10; and lost strength comes back cheaper.
 */

import { describe, it, expect } from 'vitest';
import { exerciseToNext, exercise, wearDown, DEFAULT_STATS, EXERCISE_TO_NEXT } from './stats';

describe('Physical growth tapers (#1440)', () => {
  // 1. STR 10, nothing trained: 120h.
  it('costs the base for the first trained point', () => {
    expect(exerciseToNext('str', 10, 0)).toBe(120);
    const r = exercise({ ...DEFAULT_STATS }, {}, 'str', 120);
    expect(r.reached).toEqual([11]);
  });

  // 2. Each trained point doubles the next (a young Warden, STR 7): 120h, 240h, 480h, 960h.
  it('doubles the cost with each trained point', () => {
    expect(exerciseToNext('str', 8, 1)).toBe(240);
    expect(exerciseToNext('str', 9, 2)).toBe(480);
    expect(exerciseToNext('str', 10, 3)).toBe(960);
    // In play: 120h makes STR 8; the next 120h isn't enough for 9; another 120h is.
    const young = { ...DEFAULT_STATS, str: 7 };
    const a = exercise(young, {}, 'str', 120);
    expect(a.reached).toEqual([8]);
    const b = exercise(a.stats, a.growth, 'str', 120);
    expect(b.reached).toEqual([]);
    const c = exercise(b.stats, b.growth, 'str', 120);
    expect(c.reached).toEqual([9]);
  });

  // The taper and the high-score curve don't stack: the larger of the two.
  it('takes the larger of the taper and the score curve', () => {
    expect(exerciseToNext('str', 11, 1)).toBe(Math.max(EXERCISE_TO_NEXT(11), 240)); // 270
    expect(exerciseToNext('str', 13, 3)).toBe(960); // the taper (score curve: 750)
    expect(exerciseToNext('str', 15, 0)).toBe(EXERCISE_TO_NEXT(15)); // a natural 15 pays the score curve
  });

  // 3. Mental stats don't taper.
  it('keeps the steady curve for INT and WIL', () => {
    expect(exerciseToNext('int', 11, 1)).toBe(EXERCISE_TO_NEXT(11));
    expect(exerciseToNext('wil', 10, 3)).toBe(120);
  });

  // 4. A weak stat costs the floor, not more.
  it('never makes a low stat dearer than a 10', () => {
    expect(EXERCISE_TO_NEXT(5)).toBe(120);
    expect(EXERCISE_TO_NEXT(3)).toBe(120);
    expect(exerciseToNext('con', 5, 0)).toBe(120);
  });

  // 5. Lost to wear: regaining is cheaper than the next new point.
  it('makes regaining a worn-down point cheaper', () => {
    const young = { ...DEFAULT_STATS, con: 7 };
    const one = exercise(young, {}, 'con', 120);
    const two = exercise(one.stats, one.growth, 'con', 240);
    expect(two.stats.con).toBe(9);
    expect(two.growth.trained?.con).toBe(2);
    // The third new point would need 480h; worn down a point, getting it back needs 240h.
    expect(exerciseToNext('con', 9, 2)).toBe(480);
    const worn = wearDown(two.stats, two.growth, 'con');
    expect(worn.growth.trained?.con).toBe(1);
    expect(exerciseToNext('con', worn.stats.con, worn.growth.trained?.con ?? 0)).toBe(240);
  });
});
