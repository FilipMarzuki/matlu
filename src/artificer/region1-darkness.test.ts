/**
 * Acceptance tests for #1281 — darkness effects: poor foraging, heavier
 * felling, blind scouting, a harder walk, and firelight for close work.
 * Day 1: daylight 07:00–18:30, twilight an hour either side (#1280).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, type Region1State } from './region1';
import { createVitals } from './vitality';
import { LEVEL_HOURS } from './skills';
import { level } from './exploration';
import { FLAT_WORLD } from './world';
import { darkYieldMult, scaleHaul, firelightCost } from './darkness';

/** A scouted, fresh Warden at a given hour of day 1 (hours spent since 06:00). */
const at = (hoursSpent: number, over: Partial<Region1State> = {}, flat = false): Region1State => {
  const s = runAction(createRegion1(flat ? { world: FLAT_WORLD } : {}), 'scout');
  return { ...s, hoursToday: hoursSpent, vitals: createVitals(), ...over };
};
const NOON = 6, NIGHT = 15; // 12:00 and 21:00
const got = (s: Region1State, q: Parameters<typeof runAction>[1], k: keyof Region1State['stores']) => runAction(s, q).stores[k] - s.stores[k];
const vigorUsed = (s: Region1State, q: Parameters<typeof runAction>[1]) => s.vitals.vigor.current - runAction(s, q).vitals.vigor.current;
/** The journal line of the latest piece of work (milestones and discoveries may follow it). */
const lastAction = (s: Region1State) => [...s.log].reverse().find(l => l.kind === 'action');
const lastLine = (s: Region1State) => lastAction(s)?.text ?? '';

describe('Darkness (#1281)', () => {
  // Foraging: yield × (0.5 + 0.5·light), rounded down.
  it('makes foraging in the dark poor', () => {
    const day = got(at(NOON), 'gather', 'rawFood');
    expect(got(at(NIGHT), 'gather', 'rawFood')).toBe(scaleHaul(day, darkYieldMult('gather', 0)));
    expect(got(at(NIGHT), 'gather', 'rawFood')).toBeLessThan(day);
    expect(lastLine(runAction(at(NIGHT), 'gather'))).toMatch(/lost to the dark/);
  });

  // Dusk: a span that runs into the dark is partly lit (light between 0 and 1).
  it('costs less at dusk than in full dark', () => {
    const dusk = got(at(12), 'gather', 'rawFood'); // 18:00–23:00
    expect(dusk).toBeGreaterThanOrEqual(got(at(NIGHT), 'gather', 'rawFood'));
    expect(dusk).toBeLessThanOrEqual(got(at(NOON), 'gather', 'rawFood'));
  });

  // Wood: yield × (0.75 + 0.25·light), Vigor × (1 + 0.2·(1 − light)).
  it('makes felling in the dark heavier and leaner', () => {
    expect(got(at(NIGHT), 'wood', 'firewood')).toBe(scaleHaul(got(at(NOON), 'wood', 'firewood'), 0.75));
    expect(vigorUsed(at(NIGHT), 'wood')).toBeCloseTo(vigorUsed(at(NOON), 'wood') * 1.2, 5);
  });

  // Scouting below half light learns nothing; the hours still pass.
  it('teaches nothing when it is too dark to see', () => {
    const s = at(NIGHT, { explore: createRegion1().explore });
    const after = runAction(s, 'scout');
    expect(level(after.explore, 1, 'forage')).toBe(level(s.explore, 1, 'forage'));
    expect(after.hoursToday).toBe(s.hoursToday + 4);
    expect(lastLine(after)).toMatch(/Too dark to make anything out/);
  });

  // The walk out to a far ring is harder in the dark.
  it('makes the walk out harder at night', () => {
    expect(vigorUsed(at(NIGHT), 'scout@2')).toBeGreaterThan(vigorUsed(at(NOON), 'scout@2'));
  });

  // Close work at night: firelight (1 firewood per started 4h, Clarity × 1.2), or without a fire Clarity × 1.5 and a grade worse.
  it('needs firelight for night crafting, or goes worse without', () => {
    const bench = (hoursSpent: number, firewood: number) => {
      const s = chooseSite(at(hoursSpent), 'cave');
      return { ...s, hoursToday: hoursSpent, skills: { handcraft: LEVEL_HOURS[2] }, stores: { ...s.stores, materials: 20, firewood }, vitals: createVitals({ clarity: 60 }) };
    };
    const used = (s: Region1State) => s.vitals.clarity.current - runAction(s, 'coldGear').vitals.clarity.current;
    const gear = (s: Region1State) => runAction(s, 'coldGear').tools.find(t => t.item === 'cold-gear')?.grade;
    // By day: sound, no fire.
    expect(gear(bench(NOON, 0))).toBe('sound');
    expect(runAction(bench(NOON, 2), 'coldGear').stores.firewood).toBe(2);
    // By firelight: one firewood, a little more of the mind, same grade.
    // Cold gear takes over four hours at the bench, so the fire burns two.
    const hours = runAction(bench(14, 3), 'coldGear').hoursToday - 14;
    const lit = runAction(bench(14, 3), 'coldGear');
    expect(lit.stores.firewood).toBe(3 - firelightCost(hours));
    expect(used(bench(14, 3))).toBeCloseTo(used(bench(NOON, 2)) * 1.2, 5);
    expect(gear(bench(14, 3))).toBe('sound');
    // In the dark: much more of the mind, and a grade worse.
    expect(used(bench(14, 0))).toBeCloseTo(used(bench(NOON, 0)) * 1.5, 5);
    expect(gear(bench(14, 0))).toBe('crude');
  });

  it('burns firewood for night study', () => {
    const s = at(NIGHT, { stores: { ...at(NIGHT).stores, firewood: 3 } });
    const after = runAction(s, { q: 'study', opts: { concept: 'joinery' } });
    expect(after.stores.firewood).toBe(2);
    expect(lastLine(after)).toMatch(/firelight/);
  });

  // The flat world (tests) plays every hour in full light — exactly as before darkness.
  it('leaves the flat world evenly lit', () => {
    expect(got(at(NIGHT, {}, true), 'gather', 'rawFood')).toBe(got(at(NOON, {}, true), 'gather', 'rawFood'));
    expect(lastAction(runAction(at(NIGHT, {}, true), 'gather'))?.at?.light).toBe(1);
  });

  it('plays out the same way every time', () => {
    const play = () => ['gather', 'wood', 'scout@2', 'water'].reduce((s, q) => runAction(s, q as never), at(10));
    expect(play()).toEqual(play());
  });
});
