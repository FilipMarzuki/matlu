/**
 * Achievements (#1559): percentiles over the run records, worked out the same way for every
 * surface. These build runs with only the fields achievements read.
 */

import { describe, it, expect } from 'vitest';
import { achievementsOf, achievementLines, shareBeaten, MIN_RUNS, type Comparable } from './achievements';

const run = (o: Partial<Comparable> = {}): Comparable => ({
  playerKind: 'ai', outcome: 'died', stage: 'reach', endDay: 10, grade: null, readyDay: null, milestones: 0,
  larderMidwinter: null, skillLevels: 0, ...o,
});
const byId = (list: ReturnType<typeof achievementsOf>, id: string) => list.find(a => a.id === id)!;

describe('Achievements (#1559)', () => {
  it('gives at least five, always the same list in the same order', () => {
    const a = achievementsOf(run(), []);
    const b = achievementsOf(run({ outcome: 'arrived', stage: 'road' }), Array.from({ length: 20 }, () => run()));
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(a.map(x => x.id)).toEqual(b.map(x => x.id));
  });

  it('Given too few runs to compare with, When it is worked out, Then a percentile achievement is open, not earned', () => {
    const few = Array.from({ length: MIN_RUNS - 1 }, () => run({ endDay: 3 }));
    const list = achievementsOf(run({ endDay: 40, larderMidwinter: 30, readyDay: 20, skillLevels: 9 }), few);
    for (const id of ['outlasted-median-ai', 'top-tenth', 'quick-study']) expect(byId(list, id).status).toBe('open');
    expect(byId(list, 'top-tenth').detail).toMatch(/Needs 5 runs.*4 so far/);
  });

  it('Given a run that lasted longer than most AIs, Then it outlasted the median AI; tying it does not', () => {
    const ais = [5, 8, 12, 20, 30].map(endDay => run({ endDay }));
    expect(byId(achievementsOf(run({ playerKind: 'person', endDay: 13 }), ais), 'outlasted-median-ai').status).toBe('earned');
    expect(byId(achievementsOf(run({ playerKind: 'person', endDay: 12 }), ais), 'outlasted-median-ai').status).toBe('missed');
    // People's runs don't count towards the AIs' median.
    const people = [40, 41, 42, 43, 44].map(endDay => run({ playerKind: 'person', endDay }));
    expect(byId(achievementsOf(run({ endDay: 13 }), [...ais, ...people]), 'outlasted-median-ai').status).toBe('earned');
  });

  it('Given ten runs, When a run beats nine of them, Then it is in the top 10%; the run itself is never compared with itself', () => {
    const others = Array.from({ length: 9 }, (_, i) => run({ id: `r${i}`, endDay: i + 1 }));
    const best = run({ id: 'me', endDay: 30 });
    const list = achievementsOf(best, [...others, best, run({ id: 'x', endDay: 50 })]);
    expect(byId(list, 'top-tenth').status).toBe('earned');
    expect(byId(list, 'top-tenth').detail).toBe('Further than 90% of 10 runs.');
  });

  it('Given larders at midwinter, Then the top tenth earns it, runs that never saw midwinter are left out, and a crowd at zero earns nothing', () => {
    const others = [...Array.from({ length: 9 }, (_, i) => run({ larderMidwinter: i })), run({ larderMidwinter: null }), run({ larderMidwinter: null })];
    expect(byId(achievementsOf(run({ larderMidwinter: 20 }), others), 'full-larder').status).toBe('earned');
    expect(byId(achievementsOf(run({ larderMidwinter: 4 }), others), 'full-larder').status).toBe('missed');
    expect(byId(achievementsOf(run({ larderMidwinter: null }), others), 'full-larder').detail).toMatch(/midwinter/);
    const zeros = Array.from({ length: 10 }, () => run({ larderMidwinter: 0 }));
    expect(byId(achievementsOf(run({ larderMidwinter: 0 }), zeros), 'full-larder').status).toBe('missed');
  });

  it('Given ready days, Then ready sooner than three in four earns it, and runs never ready count as later', () => {
    const others = [run({ readyDay: 18 }), run({ readyDay: 25 }), run({ readyDay: null }), run({ readyDay: null }), run({ readyDay: 30 })];
    expect(byId(achievementsOf(run({ readyDay: 20 }), others), 'ready-early').status).toBe('earned'); // beats 4 of 5
    expect(byId(achievementsOf(run({ readyDay: 28 }), others), 'ready-early').status).toBe('missed'); // beats 3 of 5
    expect(byId(achievementsOf(run({ readyDay: null }), others), 'ready-early').status).toBe('missed');
  });

  it('Given skill levels, Then more than three in four earns quick study', () => {
    const others = [1, 2, 3, 4, 10, 11, 12, 13].map(skillLevels => run({ skillLevels }));
    expect(byId(achievementsOf(run({ skillLevels: 12 }), others), 'quick-study').status).toBe('earned');
    expect(byId(achievementsOf(run({ skillLevels: 5 }), others), 'quick-study').status).toBe('missed');
  });

  it('Given a run that reached Mistheim, Then it has the mark whatever the others did, with how rare it is', () => {
    const list = achievementsOf(run({ outcome: 'arrived', stage: 'road' }), [run(), run({ outcome: 'arrived', stage: 'road' })]);
    expect(byId(list, 'reached-mistheim').status).toBe('earned');
    expect(byId(list, 'reached-mistheim').detail).toContain('50% of 2 runs');
    expect(byId(achievementsOf(run({ outcome: 'survived', grade: 'hale' }), []), 'reached-mistheim').status).toBe('missed');
    expect(achievementLines(list)).toEqual(['Reached Mistheim: Made it to Mistheim. 50% of 2 runs do.']);
  });

  it('counts ties as half, as percentBeaten does', () => {
    expect(shareBeaten(5, [5, 5], (a, b) => a - b)).toBe(50);
    expect(shareBeaten(6, [5, 7], (a, b) => a - b)).toBe(50);
    expect(shareBeaten(6, [], (a, b) => a - b)).toBeNull();
  });
});
