/**
 * Acceptance tests for #1237 — traits: two per Warden, each with an upside
 * and a cost. One test per trait checks both.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { skillLevel, drainMult } from './skills';
import { validTraits, type TraitId } from './traits';
import { deserialize, serialize, newGame } from '../artificer-app/controller';

const warden = (traits: TraitId[] = []) => createRegion1({}, undefined, { name: 'Test', traits });
const scouted = (traits: TraitId[] = []): Region1State => ({ ...runAction(warden(traits), 'scout'), hoursToday: 0, vitals: createVitals() });
const spent = (s: Region1State, q: Parameters<typeof runAction>[1]) => { const n = runAction(s, q); return { vigor: s.vitals.vigor.current - n.vitals.vigor.current, clarity: s.vitals.clarity.current - n.vitals.clarity.current, n }; };
/** A roofed camp at nightfall with low pools, ready to sleep. */
function camp(traits: TraitId[], over: Partial<Region1State> = {}): Region1State {
  let s = chooseSite(scouted(traits), 'cave');
  s = runAction({ ...s, stores: { ...s.stores, materials: 20 } }, 'build');
  return { ...s, stores: { ...s.stores, rawFood: 5, water: 5 }, vitals: createVitals({ vigor: 30, clarity: 40, condition: 60 }), today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false }, ...over };
}
const night = (s: Region1State) => { const n = endDay(s); return { vigor: n.vitals.vigor.current - s.vitals.vigor.current, clarity: n.vitals.clarity.current - s.vitals.clarity.current, condition: n.vitals.condition - s.vitals.condition, n }; };

describe('Traits (#1237)', () => {
  it('stores two chosen traits (or none) and rejects bad picks', () => {
    expect(warden(['hardy', 'tough']).character).toMatchObject({ name: 'Test', traits: ['hardy', 'tough'], lastStandUsed: false });
    expect(validTraits(['hardy', 'tough'])).toBe(true);
    expect(validTraits([])).toBe(true);
    expect(validTraits(['hardy'])).toBe(false);
    expect(validTraits(['hardy', 'hardy'])).toBe(false);
    expect(validTraits(['hardy', 'wizard'])).toBe(false);
  });

  it('Hardy: the body tires less, the mind recovers less', () => {
    expect(spent(scouted(['hardy']), 'wood').vigor).toBeCloseTo(spent(scouted(), 'wood').vigor * 0.9, 5);
    expect(night(camp(['hardy'])).clarity).toBeCloseTo(night(camp([])).clarity * 0.9, 5);
  });

  it('Sharp-minded: the mind tires less, the body recovers less', () => {
    expect(spent(scouted(['sharp']), 'survey').clarity).toBeCloseTo(spent(scouted(), 'survey').clarity * 0.9, 5);
    expect(night(camp(['sharp'])).vigor).toBeCloseTo(night(camp([])).vigor * 0.9, 5);
  });

  it('Light Eater: hunger costs half, the body recovers a little less', () => {
    const hungry = (t: TraitId[]) => night(camp(t, { stores: { ...camp(t).stores, rawFood: 0 }, deprivation: { hungry: 3, thirsty: 0 } })).condition;
    expect(hungry(['lightEater'])).toBeCloseTo(hungry([]) / 2, 5);
    expect(night(camp(['lightEater'])).vigor).toBeCloseTo(night(camp([])).vigor * 0.92, 5);
  });

  it('Careful Hands: better grades and salvage, slower crafting', () => {
    const steady = (t: TraitId[]) => ({ ...chooseSite(scouted(t), 'cave'), stores: { ...scouted(t).stores, materials: 20 }, vitals: createVitals({ clarity: 60 }) });
    expect(runAction(steady([]), 'coldGear').tools.at(-1)?.grade).toBe('crude');
    const careful = runAction(steady(['carefulHands']), 'coldGear');
    expect(careful.tools.at(-1)?.grade).toBe('sound');
    expect(careful.hoursToday - steady(['carefulHands']).hoursToday).toBeCloseTo((runAction(steady([]), 'coldGear').hoursToday - steady([]).hoursToday) * 1.2, 5);
  });

  it('Quick Learner: practice counts 1.5×, Condition heals slower', () => {
    expect(runAction(scouted(['quickLearner']), 'wood').skills.woodcraft).toBe(6);
    const heal = (t: TraitId[]) => night(camp(t, { today: { loadVigor: 2, loadClarity: 2, pushedVigor: false, pushedClarity: false } })).condition;
    expect(heal(['quickLearner'])).toBeCloseTo(heal([]) * 0.7, 5);
  });

  it('Cold-blooded: cold nights cost nothing, thirst costs more', () => {
    const cold = (t: TraitId[]) => night({ ...scouted(t), stores: { ...scouted(t).stores, rawFood: 5, water: 5 }, vitals: createVitals({ condition: 60 }) }).condition;
    expect(cold([])).toBeLessThan(cold(['coldBlooded']));
    // One dry night costs NEEDS.water.condition (10); Cold-blooded pays 25% more — everything else equal.
    const dry = (t: TraitId[]) => night(camp(t, { stores: { ...camp(t).stores, water: 0 } })).condition;
    expect(dry(['coldBlooded']) - dry([])).toBeCloseTo(-10 * 0.25, 5);
  });

  it('Tough: clings on once at Condition 1, heals slower', () => {
    let s = camp(['tough'], { vitals: createVitals({ condition: 5 }), stores: { ...camp(['tough']).stores, water: 0 }, deprivation: { hungry: 0, thirsty: 2 } });
    s = endDay(s);
    expect(s.outcome).toBeNull();
    expect(s.vitals.condition).toBe(1);
    expect(s.character.lastStandUsed).toBe(true);
    expect(endDay({ ...s, stores: { ...s.stores, water: 0 } }).outcome?.kind).toBe('died');
    const heal = (t: TraitId[]) => night(camp(t, { today: { loadVigor: 2, loadClarity: 2, pushedVigor: false, pushedClarity: false } })).condition;
    expect(heal(['tough'])).toBeCloseTo(heal([]) * 0.8, 5);
  });

  it('Keen Eye: starts a Novice scout who scouts cheaply, other work taxes the mind', () => {
    expect(skillLevel(warden(['keenEye']).skills, 'scouting')).toBe(1);
    const fresh = (t: TraitId[]) => ({ ...warden(t), vitals: createVitals() });
    // Scouting drain: Novice level (drainMult(1)) and the trait (×0.85).
    expect(spent(fresh(['keenEye']), 'scout').vigor).toBeCloseTo(spent(fresh([]), 'scout').vigor * drainMult(1) * 0.85, 5);
    expect(spent(scouted(['keenEye']), 'wood').clarity).toBeCloseTo(spent(scouted(), 'wood').clarity * 1.05, 5);
  });

  it('keeps the character on a new run that keeps knowledge, and loads old saves without one', () => {
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.character;
    expect(deserialize(JSON.stringify(raw))?.sim.character).toEqual({ id: '', name: '', portrait: null, traits: [], lastStandUsed: false });
  });
});
