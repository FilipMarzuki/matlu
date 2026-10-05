/**
 * Acceptance tests for skills: #1236 (skills that improve by use) and #1241
 * (13 levels to the supernatural, intent-driven practice, Dunning–Kruger
 * self-assessment). One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, setFocus, type Region1State } from './region1';
import { createVitals } from './vitality';
import { legacyOf } from './legacy';
import {
  LEVELS, LEVEL_HOURS, levelFromPractice, skillLevel, skillFor, drainMult, yieldBonus, toolMult, craftBonus,
  perceivedLevel, levelProgress, perceivedProgress, isSupernatural, type SkillId,
} from './skills';
import { modifiersFor } from './crafting';
import { observe } from '../artificer-ai/observe';
import { deserialize, serialize, newGame } from '../artificer-app/controller';

const scouted = (over: Partial<Region1State> = {}): Region1State => ({ ...runAction(createRegion1(), 'scout'), hoursToday: 0, ...over });
const at = (id: SkillId, level: number, s: Region1State = scouted()): Region1State => ({ ...s, skills: { ...s.skills, [id]: LEVEL_HOURS[level] } });
const newLines = (before: Region1State, after: Region1State) => after.log.slice(before.log.length).map(l => l.text).join('\n');

describe('Skills (#1236, #1241)', () => {
  it('maps work to the skill it trains', () => {
    expect(skillFor('wood')).toBe('woodcraft');
    expect(skillFor('build', 'shelter-stone')).toBe('stonework');
    expect(skillFor('build', 'shelter-leanto')).toBe('woodcraft');
    expect(skillFor('coldGear', 'hide-parka')).toBe('handcraft');
    expect(skillFor('rest')).toBeNull();
  });

  // #1241-1. Thirteen levels, 10,000 hours to Professional, supernatural from Paragon.
  it('runs from Untrained to Transcendent on a long curve', () => {
    expect(LEVELS).toHaveLength(14);
    expect([0, 4.9, 5, 20, 60, 150, 400, 1_000, 3_000].map(levelFromPractice)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7]);
    expect(LEVELS[levelFromPractice(10_000)]).toBe('Professional');
    expect(LEVELS[levelFromPractice(60_000)]).toBe('Grandmaster');
    expect(isSupernatural(levelFromPractice(59_999))).toBe(false);
    expect(LEVELS[levelFromPractice(150_000)]).toBe('Paragon');
    expect(isSupernatural(levelFromPractice(150_000))).toBe(true);
    expect(LEVELS[levelFromPractice(5_000_000)]).toBe('Transcendent');
  });

  // #1241-2. Smooth effects.
  it('scales effects smoothly with level', () => {
    expect(drainMult(5)).toBeCloseTo(1 / 1.35, 10);
    expect(drainMult(13)).toBeGreaterThan(0.5);
    expect([0, 1, 2, 5, 13].map(yieldBonus)).toEqual([0, 0, 1, 2, 6]);
    expect(toolMult(10)).toBeCloseTo(2.5, 10);
    expect([0, 1, 2, 7].map(craftBonus)).toEqual([0, 0, 1, 3]);
  });

  // #1236. Practice: 4 hours of wood gathering → 4 hours of Woodcraft practice (travel isn't practice).
  it('counts the hours worked as practice in that skill', () => {
    expect(runAction(scouted(), 'wood').skills.woodcraft).toBe(4);
    expect(runAction(scouted(), 'wood@2').skills.woodcraft).toBe(4);
  });

  // #1241-3. Intent: a focused skill practises ×3.
  it('triples practice when the skill is your focus', () => {
    expect(runAction(setFocus(scouted({ vitals: createVitals() }), { kind: 'skill', id: 'woodcraft' }), 'wood').skills.woodcraft).toBe(12);
  });

  // #1236 effects, at the true level.
  it('makes skilled work lighter, richer, and better with tools', () => {
    const fresh = scouted({ vitals: createVitals() });
    const vig = (s: Region1State) => 100 - runAction(s, 'wood').vitals.vigor.current;
    expect(vig(at('woodcraft', 5, fresh))).toBeCloseTo(vig(fresh) * drainMult(5), 5);
    const food = (s: Region1State) => runAction(s, 'gather').stores.rawFood - s.stores.rawFood;
    expect(food(at('foraging', 4))).toBe(food(scouted()) + 2);
    const withSkin = scouted({ tools: [{ item: 'waterskin', grade: 'sound' }] });
    expect(modifiersFor(withSkin.tools, 'water').yieldAdd).toBe(1);
    const water = (s: Region1State) => runAction(s, 'water').stores.water - s.stores.water;
    // Fieldcraft 10: the waterskin's +1 becomes round(2.5) = 3 (+2), plus the level's own +5.
    expect(water(at('fieldcraft', 10, withSkin))).toBe(water(withSkin) + 2 + 5);
  });

  it('raises craft quality', () => {
    const base = chooseSite(scouted(), 'cave');
    const steady = { ...base, stores: { ...base.stores, materials: 20 }, vitals: createVitals({ clarity: 60 }) };
    expect(runAction(steady, 'coldGear').tools.find(t => t.item === 'cold-gear')?.grade).toBe('crude');
    expect(runAction(at('handcraft', 2, steady), 'coldGear').tools.find(t => t.item === 'cold-gear')?.grade).toBe('sound');
  });

  // #1241-4. Mount Stupid: a fresh Novice thinks they're better than they are.
  it('lets beginners overrate themselves', () => {
    for (const h of [5, 6, 7]) expect(perceivedLevel({ woodcraft: h }, 'woodcraft')).toBeGreaterThan(skillLevel({ woodcraft: h }, 'woodcraft'));
    expect(perceivedProgress(0)).toBe(0);
  });

  // #1241-5. The valley: getting good, you underrate yourself.
  it('lets the getting-good underrate themselves', () => {
    expect(perceivedLevel({ woodcraft: 200 }, 'woodcraft')).toBeLessThan(skillLevel({ woodcraft: 200 }, 'woodcraft'));
    expect(perceivedProgress(200)).toBeLessThan(levelProgress(200));
    // Experts stay a little modest.
    expect(perceivedProgress(30_000)).toBeLessThan(levelProgress(30_000));
  });

  // #1241-6. You feel a true improvement; you're humbled when your estimate drops. No level names.
  it('lets you feel improvement without naming the level', () => {
    const before = scouted({ skills: { woodcraft: 3 } });
    const after = runAction(before, 'wood');
    expect(skillLevel(after.skills, 'woodcraft')).toBe(1);
    const lines = newLines(before, after);
    expect(lines).toMatch(/The axe finds the grain more easily now — woodcraft comes easier\./);
    expect(lines).not.toMatch(/Novice|Apprentice|level/i);
    // Off Mount Stupid: your estimate peaks around 12 hours of practice, then falls as you learn more.
    let s = scouted({ skills: { woodcraft: 10 } });
    const start = s;
    for (let i = 0; i < 12; i++) s = runAction({ ...s, hoursToday: 0, vitals: createVitals() }, 'wood');
    expect(newLines(start, s)).toMatch(/the more you see how little you know/);
  });

  // #1241-7. The page and the AI show the self-assessment only.
  it('shows the AI only how good it thinks it is', () => {
    const s = scouted({ skills: { woodcraft: 6 } });
    const text = observe(s);
    expect(text).toMatch(new RegExp(`woodcraft ${LEVELS[perceivedLevel(s.skills, 'woodcraft')]}`));
    expect(text).toMatch(/self-assessed/);
    expect(text).not.toMatch(/woodcraft Novice/);
  });

  // #1241-8. All practice carries into the next run.
  it('carries all practice into the next run', () => {
    const done = { ...scouted({ skills: { woodcraft: 25, hunting: 4 } }), outcome: { choice: 'winter' as const, kind: 'grim' as const, vitals: createVitals() } };
    expect(createRegion1({}, legacyOf(done)).skills).toEqual({ woodcraft: 25, hunting: 4 });
  });

  it('loads a save from before skills with no practice', () => {
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.skills;
    expect(deserialize(JSON.stringify(raw))?.sim.skills).toEqual({});
  });
});
