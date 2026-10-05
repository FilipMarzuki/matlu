/**
 * Acceptance tests for #1238 — Focus: a concept, goal or skill the mind works
 * on, locked to Survival under pressure. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, setFocus, survivalLockOf, type Region1State } from './region1';
import { createVitals } from './vitality';
import { parseFocus, FOCUS_COST } from './focus';
import { deserialize, serialize, newGame } from '../artificer-app/controller';

const insight = (s: Region1State, c = 'joinery') => s.concepts[c]?.insight ?? 0;
const fresh = (over: Partial<Region1State> = {}): Region1State => ({ ...runAction(createRegion1(), 'scout'), hoursToday: 0, vitals: createVitals(), ...over });
const focused = (key: string, over: Partial<Region1State> = {}) => setFocus(fresh(over), parseFocus(key));
/** A roofed, fed and watered camp at nightfall. */
function camp(over: Partial<Region1State> = {}): Region1State {
  let s = chooseSite(fresh(), 'cave');
  s = runAction({ ...s, stores: { ...s.stores, materials: 20 } }, 'build');
  return { ...s, stores: { ...s.stores, rawFood: 5, water: 5 }, vitals: createVitals({ vigor: 60, clarity: 70 }), today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false }, ...over };
}

describe('Focus (#1238)', () => {
  // 1. Concept: 0.3 insight per hour worked, credited at night.
  it('turns a focused concept over while you work', () => {
    const s = setFocus(camp({ hoursToday: 10 }), parseFocus('concept:joinery'));
    expect(insight(endDay(s)) - insight(s)).toBeCloseTo(3, 5);
  });

  // 2. Goal: matching actions yield +1 and drain ×0.9.
  it('makes goal work richer and lighter', () => {
    const food = (s: Region1State) => runAction(s, 'gather').stores.rawFood - s.stores.rawFood;
    const vig = (s: Region1State) => s.vitals.vigor.current - runAction(s, 'gather').vitals.vigor.current;
    expect(food(focused('goal:larder'))).toBe(food(fresh()) + 1);
    expect(vig(focused('goal:larder'))).toBeCloseTo(vig(fresh()) * 0.9, 5);
    // Not a larder action: no bonus.
    expect(runAction(focused('goal:larder'), 'wood').stores.firewood).toBe(runAction(fresh(), 'wood').stores.firewood);
  });

  // 3. Skill: practice ×3 (deliberate practice, #1241; was ×2 in #1238).
  it('triples practice in a focused skill', () => {
    expect(runAction(focused('skill:woodcraft'), 'wood').skills.woodcraft).toBe(12);
    expect(runAction(focused('skill:woodcraft'), 'gather').skills.foraging).toBe(5);
  });

  // 4. Cost: 4 Clarity a night.
  it('costs Clarity to keep a focus', () => {
    // Start low enough that sleep doesn't reach the cap (the cap clamp would hide the cost).
    const low = { vitals: createVitals({ vigor: 60, clarity: 35 }) };
    const plain = endDay(camp(low)).vitals.clarity.current;
    const withFocus = endDay(setFocus(camp(low), parseFocus('skill:hunting'))).vitals.clarity.current;
    expect(plain - withFocus).toBeCloseTo(FOCUS_COST, 5);
  });

  // 5. Unreliable below 30 Clarity: effects halved.
  it('halves focus when the mind is frayed', () => {
    const tired = { vitals: createVitals({ clarity: 20 }) };
    // ×3 halved toward 1 → ×2.
    expect(runAction(focused('skill:woodcraft', tired), 'wood').skills.woodcraft).toBe(8);
    const s = setFocus(camp({ hoursToday: 10, vitals: createVitals({ vigor: 60, clarity: 20 }) }), parseFocus('concept:joinery'));
    expect(insight(endDay(s)) - insight(s)).toBeCloseTo(1.5, 5);
  });

  // 6. Lock on thirst: Survival; no concept insight; survival actions +1.
  it('locks to Survival when thirsty', () => {
    const thirsty = setFocus(camp({ deprivation: { hungry: 0, thirsty: 1 }, hoursToday: 10 }), parseFocus('concept:joinery'));
    expect(survivalLockOf(thirsty)).toBe('thirsty');
    expect(insight(endDay(thirsty))).toBe(insight(thirsty));
    const w = (s: Region1State) => runAction(s, 'water').stores.water - s.stores.water;
    const base = camp({ hoursToday: 0 });
    expect(w({ ...thirsty, hoursToday: 0 })).toBe(w(base) + 1);
  });

  // 7. Other causes, each with a reason.
  it('locks for starving, worn down, and winter closing in', () => {
    expect(survivalLockOf(camp({ deprivation: { hungry: 2, thirsty: 0 } }))).toBe('starving');
    expect(survivalLockOf(camp({ deprivation: { hungry: 1, thirsty: 0 } }))).toBeNull();
    expect(survivalLockOf(camp({ vitals: createVitals({ condition: 39 }) }))).toBe('worn down');
    expect(survivalLockOf(camp({ day: 28 }))).toBe('winter is close');
    expect(survivalLockOf(camp({ day: 9 }))).toBeNull();
  });

  // 8. Unlock: the chosen focus applies again once the cause clears.
  it('returns to the chosen focus when the pressure lifts', () => {
    const s = setFocus(camp({ deprivation: { hungry: 0, thirsty: 1 } }), parseFocus('skill:woodcraft'));
    const wood = (st: Region1State) => (runAction(st, 'wood').skills.woodcraft ?? 0) - (st.skills.woodcraft ?? 0);
    expect(wood(s)).toBe(4);
    const night = endDay(s); // drank tonight → thirst streak resets
    expect(survivalLockOf(night)).toBeNull();
    expect(night.log.map(l => l.text).join('\n')).toMatch(/focus returns to Woodcraft/i);
    expect(wood({ ...night, vitals: createVitals() })).toBe(12);
  });

  // 9. Saves: older saves have no focus.
  it('loads a save from before focus with none', () => {
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.focus;
    expect(deserialize(JSON.stringify(raw))?.sim.focus).toBeNull();
    expect(parseFocus('goal:larder')).toEqual({ kind: 'goal', id: 'larder' });
    expect(parseFocus('skill:nope')).toBeNull();
  });
});
