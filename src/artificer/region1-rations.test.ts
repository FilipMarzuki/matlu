/**
 * Acceptance tests for #1305 — rationing and cabin fever: a standing eating
 * plan that stretches the larder at a cost, food that keeps in the frost, and
 * a mind that frays when cooped up too long. One test per Given/When/Then
 * scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, setEating, CABIN_FEVER_FROM, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { STEADY_WORLD } from './test-helpers';
import { parseDecision } from '../artificer-ai/decision';
import { newGame, serialize, deserialize, chooseEating } from '../artificer-app/controller';

/** A Warden in a walled cave on `day`, with water to spare and `food` raw food. */
function camped(day: number, food: number, world = FLAT_WORLD, over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world }), 'scout'), 'cave');
  // A fresh day: the setup scout's trip out doesn't count.
  return { ...s, day, hoursToday: 0, today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false }, tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' }, vitals: createVitals(), stores: { ...s.stores, rawFood: food, rations: 0, water: 40, firewood: 60 }, ...over };
}
const nights = (s: Region1State, n: number, queue: Parameters<typeof runDay>[1] = []): Region1State => {
  for (let i = 0; i < n && !s.outcome; i++) s = runDay(s, queue).state;
  return s;
};

describe('Rationing and cabin fever (#1305)', () => {
  // 1. Half rations: 10 food over 10 nights eats 5, and costs far less Condition than no food at all.
  it('stretches the larder on half rations, at a small cost', () => {
    const half = nights(setEating(camped(5, 10), 'half'), 10);
    expect(half.stores.rawFood).toBe(5);
    expect(half.deprivation.hungry).toBe(0);
    expect(half.log.some(l => l.text === 'Half rations — a lean night.')).toBe(true);
    const fasting = nights(setEating(camped(5, 10), 'none'), 10);
    expect(fasting.stores.rawFood).toBe(10); // fasting leaves the food alone
    expect(half.vitals.condition).toBeGreaterThan(fasting.vitals.condition);
    // A lean night costs a little Condition; a fed one heals.
    const lean = runDay(setEating(camped(5, 10, FLAT_WORLD, { vitals: createVitals({ condition: 60 }) }), 'half'), []).state;
    expect(lean.vitals.condition).toBe(59);
  });

  // 2. Seven nights of half rations wear the Vigor cap down; full rations let it come back.
  it('wears the body down on half rations, and lets it recover on full', () => {
    const full = nights(camped(5, 30), 7, ['wood']);
    const half = nights(setEating(camped(5, 30), 'half'), 7, ['wood']);
    expect(half.vitals.vigor.cap).toBeLessThan(full.vitals.vigor.cap);
    const back = nights(setEating(half, 'full'), 7, ['wood']);
    expect(back.vitals.vigor.cap).toBeGreaterThan(half.vitals.vigor.cap);
  });

  // 3. Below freezing, food keeps: a winter night eats the one meal and nothing else is lost.
  it('keeps fresh food through a freezing night', () => {
    const s = camped(45, 8, STEADY_WORLD, { weatherToday: 'overcast' });
    const after = runDay(s, []).state;
    expect(after.stores.rawFood).toBe(7);
  });

  // 4. Five days cooped up lower the Clarity cap; a day outside (or absorbing work) ends the streak.
  it('brings cabin fever after days cooped up, and lifts it once you get out', () => {
    let cooped = camped(40, 30, STEADY_WORLD, { weatherToday: 'overcast' });
    let control = cooped;
    for (let d = 0; d < 5; d++) {
      cooped = runDay({ ...cooped, weatherToday: 'overcast' }, ['rest']).state;
      // The control rests the same, but its streak is wiped each night: no cabin fever.
      control = runDay({ ...control, weatherToday: 'overcast', cabinDays: 0 }, ['rest']).state;
    }
    expect(cooped.cabinDays).toBe(5);
    expect(cooped.log.some(l => /Cabin fever/.test(l.text))).toBe(true);
    expect(cooped.vitals.clarity.cap).toBeLessThan(control.vitals.clarity.cap);
    // Out on the land ends the streak; so does study or a craft.
    expect(runDay({ ...cooped, weatherToday: 'overcast' }, ['water']).state.cabinDays).toBe(0);
    expect(runDay({ ...cooped, weatherToday: 'overcast' }, [{ q: 'study', opts: { concept: 'joinery' } }]).state.cabinDays).toBe(0);
    expect(CABIN_FEVER_FROM).toBe(3);
    // The flat world keeps no streak.
    expect(nights(camped(40, 30), 5, ['rest']).cabinDays ?? 0).toBe(0);
  });

  // 5. The plan survives a save; old saves eat full rations.
  it('keeps the eating plan through a save', () => {
    const half = chooseEating(newGame(), 'half');
    expect(deserialize(serialize(half))?.sim.eating).toBe('half');
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.eating;
    expect(deserialize(JSON.stringify(raw))?.sim.eating ?? 'full').toBe('full');
    raw.sim.eating = 'feast';
    expect(deserialize(JSON.stringify(raw))?.sim.eating).toBeUndefined();
    // The AI sets it the same way a person does.
    const reply = (eating: unknown) => parseDecision(JSON.stringify({ thoughts: '', focus: null, eating, site: null, queue: [] }));
    expect(reply('half')).toMatchObject({ ok: true, decision: { eating: 'half' } });
    expect(reply('feast').ok).toBe(false);
    expect(reply(null).ok).toBe(true);
  });
});
