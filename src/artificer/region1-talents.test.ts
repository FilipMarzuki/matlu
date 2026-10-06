/**
 * Acceptance tests for #1263 — talents core: 12 tiered talents that replace
 * traits, a seeded offer of 4, 2 chosen + 1 hidden. One test per
 * Given/When/Then scenario, plus each talent's lever.
 */

import { STEADY_WORLD } from './test-helpers';
import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { skillLevel } from './skills';
import { legacyOf } from './legacy';
import { createRoad } from './road';
import { TALENT_IDS, talentOffer, hiddenTalent, seedOf, validPick, type Talent, type TalentId } from './talents';
import { deserialize, serialize, newGame, newRun } from '../artificer-app/controller';

const known = (id: TalentId, tier = 1): Talent => ({ id, tier, known: true });
/** A scouted, fresh Warden with exactly these talents (no id, so no hidden roll). */
const warden = (talents: Talent[] = [], over: Partial<Region1State> = {}): Region1State => {
  const s = runAction(createRegion1({ world: STEADY_WORLD }, undefined, { name: 'Test', talents }), 'scout');
  return { ...s, hoursToday: 0, vitals: createVitals(), ...over };
};
const spent = (s: Region1State, q: Parameters<typeof runAction>[1]) => {
  const n = runAction(s, q);
  return { vigor: s.vitals.vigor.current - n.vitals.vigor.current, clarity: s.vitals.clarity.current - n.vitals.clarity.current, n };
};
const gained = (s: Region1State, q: Parameters<typeof runAction>[1], k: keyof Region1State['stores']) => runAction(s, q).stores[k] - s.stores[k];
/** A roofed camp at nightfall, fed and watered, with low pools. */
function camp(talents: Talent[], over: Partial<Region1State> = {}): Region1State {
  let s = chooseSite(warden(talents), 'cave');
  s = runAction({ ...s, stores: { ...s.stores, materials: 20 } }, 'build');
  return { ...s, stores: { ...s.stores, rawFood: 5, water: 5 }, vitals: createVitals({ vigor: 30, clarity: 40, condition: 60 }), today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false }, ...over };
}
const nightCondition = (s: Region1State) => endDay(s).vitals.condition - s.vitals.condition;

describe('Talents (#1263)', () => {
  // 1. The offer is seeded by the character id.
  it('offers the same 4 distinct talents to the same Warden', () => {
    const a = talentOffer(seedOf('w-vega'));
    expect(a).toEqual(talentOffer(seedOf('w-vega')));
    expect(new Set(a).size).toBe(4);
    expect(a.every(id => TALENT_IDS.includes(id))).toBe(true);
    const offers = new Set(Array.from({ length: 10 }, (_, i) => talentOffer(seedOf(`w-${i}`)).join()));
    expect(offers.size).toBeGreaterThan(1);
    expect(TALENT_IDS).toHaveLength(12);
  });

  // 2. Two chosen (known) + one hidden (unknown, not one of the chosen), the same every time.
  it('gives two chosen talents and one hidden one', () => {
    const make = () => createRegion1({}, undefined, { id: 'w-vega', name: 'Vega', chosen: ['forager', 'hardy'] }).character.talents;
    const t = make();
    expect(t.filter(x => x.known)).toEqual([known('forager'), known('hardy')]);
    const hidden = t.filter(x => !x.known);
    expect(hidden).toHaveLength(1);
    expect(['forager', 'hardy']).not.toContain(hidden[0].id);
    expect(hidden[0]).toMatchObject({ id: hiddenTalent(seedOf('w-vega'), ['forager', 'hardy']), tier: 1 });
    expect(make()).toEqual(t);
    expect(validPick(['forager', 'hardy'])).toBe(true);
    expect(validPick(['forager'])).toBe(false);
    expect(validPick(['forager', 'forager'])).toBe(false);
    expect(validPick(['forager', 'wizard'])).toBe(false);
  });

  // 3. Forager: +⌊t/2⌋ food from gathering.
  it('Forager brings back more food from tier 2', () => {
    expect(gained(warden([known('forager', 2)]), 'gather', 'rawFood')).toBe(gained(warden(), 'gather', 'rawFood') + 1);
    expect(gained(warden([known('forager', 1)]), 'gather', 'rawFood')).toBe(gained(warden(), 'gather', 'rawFood'));
  });

  // 4. Hardy: physical work 4%·t lighter, and no cost any more.
  it('Hardy lightens physical work, at no cost', () => {
    expect(spent(warden([known('hardy')]), 'wood').vigor).toBeCloseTo(spent(warden(), 'wood').vigor * 0.96, 5);
    const recover = (t: Talent[]) => { const s = camp(t); return endDay(s).vitals.clarity.current - s.vitals.clarity.current; };
    expect(recover([known('hardy')])).toBeCloseTo(recover([]), 5);
  });

  // 5. Hidden talents work before you know them.
  it('lets a hidden Waterfinder find more water', () => {
    expect(gained(warden([{ id: 'waterfinder', tier: 2, known: false }]), 'water', 'water')).toBe(gained(warden(), 'water', 'water') + 1);
  });

  // 6. Tough's last stand comes at tier 3.
  it('gives Tough its last stand only from tier 3', () => {
    const dying = (tier: number) => camp([known('tough', tier)], { vitals: createVitals({ condition: 5 }), stores: { ...camp([]).stores, water: 0 }, deprivation: { hungry: 0, thirsty: 2 } });
    expect(endDay(dying(2)).outcome?.kind).toBe('died');
    const clung = endDay(dying(3));
    expect(clung.outcome).toBeNull();
    expect(clung.vitals.condition).toBe(1);
    expect(clung.character.lastStandUsed).toBe(true);
  });

  // 7. Old saves: traits become known tier-1 talents, plus a hidden one from the id.
  it('migrates old traits into talents', () => {
    const raw = JSON.parse(serialize(newGame()));
    raw.sim.character = { id: 'w-old', name: 'Old', portrait: null, traits: ['hardy', 'tough'], lastStandUsed: false };
    const c = deserialize(JSON.stringify(raw))!.sim.character;
    expect(c.talents.filter(t => t.known)).toEqual([known('hardy'), known('tough')]);
    expect(c.talents.filter(t => !t.known)).toEqual([{ id: hiddenTalent(seedOf('w-old'), ['hardy', 'tough']), tier: 1, known: false }]);
    expect(c).not.toHaveProperty('traits');
    // A save from before characters (no id) gets no talents at all.
    delete raw.sim.character;
    expect(deserialize(JSON.stringify(raw))!.sim.character.talents).toEqual([]);
  });

  // 8. Talents carry with the living character, and onto the road.
  it('carries talents to the next run and the road', () => {
    const talents: Talent[] = [known('forager', 2), known('hardy'), { id: 'tough', tier: 3, known: false }];
    const done = { ...warden(talents), character: { ...warden().character, id: 'w-vega', talents }, outcome: { choice: 'winter' as const, kind: 'grim' as const, vitals: createVitals() } };
    expect(newRun(done).sim.character.talents).toEqual(talents);
    expect(createRegion1({}, legacyOf(done)).character.talents).toEqual(talents);
    const rode = { ...done, outcome: { choice: 'caravan' as const, kind: 'thrive' as const, vitals: createVitals() } };
    expect(createRoad(rode).character.talents).toEqual(talents);
  });

  // Each remaining talent's lever (pure upsides).
  it('Sharp-minded: all work tires the mind 4%·t less', () => {
    expect(spent(warden([known('sharp', 2)]), 'survey').clarity).toBeCloseTo(spent(warden(), 'survey').clarity * 0.92, 5);
  });

  it('Light Eater: hunger costs 12%·t less', () => {
    const hungry = (t: Talent[]) => nightCondition(camp(t, { stores: { ...camp(t).stores, rawFood: 0 }, deprivation: { hungry: 3, thirsty: 0 } }));
    expect(hungry([known('lightEater', 2)])).toBeCloseTo(hungry([]) * 0.76, 5);
  });

  it('Careful Hands: finer crafts from tier 2', () => {
    const steady = (t: Talent[]) => ({ ...chooseSite(warden(t), 'cave'), stores: { ...warden(t).stores, materials: 20 }, vitals: createVitals({ clarity: 60 }) });
    expect(runAction(steady([]), 'coldGear').tools.at(-1)?.grade).toBe('crude');
    expect(runAction(steady([known('carefulHands', 1)]), 'coldGear').tools.at(-1)?.grade).toBe('crude');
    expect(runAction(steady([known('carefulHands', 2)]), 'coldGear').tools.at(-1)?.grade).toBe('sound');
  });

  it('Quick Learner: practice 12%·t faster', () => {
    expect(runAction(warden([known('quickLearner', 1)]), 'wood').skills.woodcraft).toBeCloseTo(4 * 1.12, 5);
  });

  it('Cold-blooded: cold nights cost 25%·t less (immune at mastery)', () => {
    const cold = (t: Talent[]) => nightCondition({ ...warden(t), stores: { ...warden(t).stores, rawFood: 5, water: 5 }, vitals: createVitals({ condition: 60 }) });
    // The cold night's whole cost (its base and its shortfall, #1306), cut by 25%·t.
    const cost = -cold([]);
    expect(cost).toBeGreaterThan(0);
    expect(cold([known('coldBlooded', 2)]) - cold([])).toBeCloseTo(cost * 0.5, 5);
    expect(cold([known('coldBlooded', 4)]) - cold([])).toBeCloseTo(cost, 5);
  });

  it('Keen Eye: a Novice scout whose scouting is lighter, with no cost elsewhere', () => {
    expect(skillLevel(createRegion1({}, undefined, { chosen: ['keenEye', 'hardy'] }).skills, 'scouting')).toBe(1);
    const fresh = (t: Talent[]) => ({ ...warden(t), skills: {} });
    expect(spent(fresh([known('keenEye', 2)]), 'survey').vigor).toBeCloseTo(spent(fresh([]), 'survey').vigor * 0.9, 5);
    expect(spent(warden([known('keenEye')]), 'wood').clarity).toBeCloseTo(spent(warden(), 'wood').clarity, 5);
  });

  it("Hunter's Patience: tracking 5%·t lighter", () => {
    expect(spent(warden([known('hunter', 2)]), 'track').vigor).toBeCloseTo(spent(warden(), 'track').vigor * 0.9, 5);
  });
});
