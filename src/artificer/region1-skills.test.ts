/**
 * Acceptance tests for #1236 — skills that improve by use.
 * One test per Given/When/Then scenario in the issue.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, type Region1State } from './region1';
import { createVitals } from './vitality';
import { legacyOf } from './legacy';
import { LEVEL_HOURS, levelFromPractice, skillLevel, skillFor, toolMult, type SkillId } from './skills';
import { modifiersFor } from './crafting';
import { deserialize, serialize, newGame } from '../artificer-app/controller';

const scouted = (over: Partial<Region1State> = {}): Region1State => ({ ...runAction(createRegion1(), 'scout'), hoursToday: 0, ...over });
const at = (id: SkillId, level: number, s: Region1State = scouted()): Region1State => ({ ...s, skills: { ...s.skills, [id]: LEVEL_HOURS[level] } });
const lastLines = (s: Region1State, n = 4) => s.log.slice(-n).map(l => l.text).join('\n');

describe('Skills (#1236)', () => {
  it('maps work to the skill it trains', () => {
    expect(skillFor('wood')).toBe('woodcraft');
    expect(skillFor('build', 'shelter-stone')).toBe('stonework');
    expect(skillFor('build', 'shelter-leanto')).toBe('woodcraft');
    expect(skillFor('coldGear', 'hide-parka')).toBe('handcraft');
    expect(skillFor('rest')).toBeNull();
    expect([0, 5.9, 6, 17.9, 18, 36, 60, 90, 500].map(levelFromPractice)).toEqual([0, 0, 1, 1, 2, 3, 4, 5, 5]);
  });

  // 1. Practice: 4 hours of wood gathering → 4 hours of Woodcraft practice (travel isn't practice).
  it('counts the hours worked as practice in that skill', () => {
    const s = runAction(scouted(), 'wood');
    expect(s.skills.woodcraft).toBe(4);
    const far = runAction(scouted(), 'wood@2');
    expect(far.skills.woodcraft).toBe(4);
  });

  // 2. Level-up: crossing 6 hours → Novice, announced in the journal.
  it('levels up at the threshold and says so', () => {
    const s = runAction(scouted({ skills: { woodcraft: 3 } }), 'wood');
    expect(skillLevel(s.skills, 'woodcraft')).toBe(1);
    expect(lastLines(s)).toMatch(/Woodcraft improved — you're now a Novice/);
  });

  // 3. Energy: a Master spends 30% less Vigor on the work than the Untrained.
  it('makes skilled work cheaper on body and mind', () => {
    const fresh = scouted({ vitals: createVitals() });
    const raw = 100 - runAction(fresh, 'wood').vitals.vigor.current;
    const master = 100 - runAction(at('woodcraft', 5, fresh), 'wood').vitals.vigor.current;
    expect(master).toBeCloseTo(raw * 0.7, 5);
  });

  // 4. Yield: Foraging 4 gathers 2 more food than Foraging 0.
  it('makes skilled trips richer', () => {
    const food = (s: Region1State) => runAction(s, 'gather').stores.rawFood - s.stores.rawFood;
    expect(food(at('foraging', 4))).toBe(food(scouted()) + 2);
  });

  // 5. Tools: a tool's yield bonus is doubled at skill 5.
  it('gets more out of tools in skilled hands', () => {
    expect(toolMult(5)).toBe(2);
    const withSkin = scouted({ tools: [{ item: 'waterskin', grade: 'sound' }] });
    const toolBonus = modifiersFor(withSkin.tools, 'water').yieldAdd;
    expect(toolBonus).toBe(1);
    const water = (s: Region1State) => runAction(s, 'water').stores.water - s.stores.water;
    // Fieldcraft 5: the waterskin's +1 doubles to +2, on top of the level's own +3.
    expect(water(at('fieldcraft', 5, withSkin))).toBe(water(withSkin) + toolBonus + 3);
  });

  // 6. Craft quality: a craft that would come out crude is sound with Handcraft 2+.
  it('raises craft quality', () => {
    const base = chooseSite(scouted(), 'cave');
    const steady = { ...base, stores: { ...base.stores, materials: 20 }, vitals: createVitals({ clarity: 60 }) };
    const crude = runAction(steady, 'coldGear');
    expect(crude.tools.find(t => t.item === 'cold-gear')?.grade).toBe('crude');
    const skilled = runAction(at('handcraft', 2, steady), 'coldGear');
    expect(skilled.tools.find(t => t.item === 'cold-gear')?.grade).toBe('sound');
  });

  // 7. Carry-over: levels carry into a new run; practice beyond the level is dropped.
  it('carries skill levels into the next run', () => {
    const done = { ...scouted({ skills: { woodcraft: 25, hunting: 4 } }), outcome: { choice: 'winter' as const, kind: 'grim' as const, vitals: createVitals() } };
    const next = createRegion1({}, legacyOf(done));
    expect(next.skills).toEqual({ woodcraft: LEVEL_HOURS[2] });
  });

  // 8. Old saves load with no practice.
  it('loads a save from before skills with no practice', () => {
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.skills;
    expect(deserialize(JSON.stringify(raw))?.sim.skills).toEqual({});
  });
});
