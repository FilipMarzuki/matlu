/**
 * Acceptance tests for #1499 (epic #1493, docs/focus-and-dialogue-design.md §2, §4): what you've
 * done, what you're turning over and what you've learned open options, in conversations on the
 * road and in encounters, through one gate.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, type RoadState } from './road';
import { ENCOUNTERS, unmet, type EncounterOption } from './encounters';
import { TELLS, TELL_TRUST, ASK_HOURS } from './asks';
import { observeRoad } from '../artificer-ai/observe';
import { roadView } from '../artificer-app/road-view';
import { serialize, deserialize } from '../artificer-app/controller';

/** A Warden out of the Reach with these deeds, riding on until `village`. */
function rideTo(village: string, deeds: string[]): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-deeds', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = { ...s, day: 61, vitals, deeds, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  let r = createRoad(from);
  for (let i = 0; i < 20 && villageOf(r) !== village; i++) r = endRoadDay(r);
  return r;
}

const option = (requires: EncounterOption['requires']): EncounterOption =>
  ({ id: 'x', label: 'X', odds: 1, requires, success: { text: 'ok' }, fail: { text: 'no' } }) as EncounterOption;

describe('Deeds and gates (#1499)', () => {
  // 1. A deed opens something to tell the right person; without it, there's nothing to tell.
  it('lets a deed open a tell, and only with the deed', () => {
    const tell = TELLS['sm-yrsa']?.['herald-owes-you'];
    expect(tell).toBeDefined();
    const did = rideTo('saltmere', ['herald-owes-you']);
    expect(villageOf(did)).toBe('saltmere');
    expect(observeRoad(did)).toMatch(/tell:sm-yrsa:herald-owes-you/);
    expect(roadView(did, { person: 'sm-yrsa' })).toContain(tell!.label.toUpperCase());
    const after = runRoadAction(did, 'tell:sm-yrsa:herald-owes-you');
    expect(after.log.slice(did.log.length).map(l => l.text).join(' ')).toContain(tell!.answer.text);
    expect(after.hoursToday - did.hoursToday).toBe(ASK_HOURS);
    expect(after.trust['sm-yrsa']).toBe(Math.min(100, (did.trust['sm-yrsa'] ?? 0) + TELL_TRUST));
    // Told once: it's remembered, and telling again changes nothing.
    const again = runRoadAction(after, 'tell:sm-yrsa:herald-owes-you');
    expect([again.hoursToday, again.trust['sm-yrsa']]).toEqual([after.hoursToday, after.trust['sm-yrsa']]);

    const didnt = rideTo('saltmere', []);
    expect(observeRoad(didnt)).not.toMatch(/tell:sm-yrsa/);
    expect(roadView(didnt, { person: 'sm-yrsa' })).not.toContain(tell!.label.toUpperCase());
    const tried = runRoadAction(didnt, 'tell:sm-yrsa:herald-owes-you');
    expect(tried.hoursToday).toBe(didnt.hoursToday);
  });

  // 2. An option that needs a focus is open with it, and greyed with the reason without it.
  it('gates an encounter option on your focus', () => {
    const w = createRegion1({}, undefined, { id: 'w-gate' });
    const river = option({ focus: 'place:river' });
    expect(unmet({ ...w, focus: { kind: 'place', id: 'river' } }, river)).toBeNull();
    expect(unmet({ ...w, focus: null }, river)).toMatch(/river/);
    // The same gate for what you've done, and what you've learned.
    expect(unmet({ ...w, deeds: ['fed-the-stranger'] }, option({ deed: 'fed-the-stranger' }))).toBeNull();
    expect(unmet({ ...w, deeds: [] }, option({ deed: 'fed-the-stranger' }))).not.toBeNull();
    expect(unmet({ ...w, heard: ['group:compact'] } as typeof w, option({ knows: 'group:compact' }))).toBeNull();
    expect(unmet(w, option({ knows: 'group:compact' }))).not.toBeNull();
    // Real ones: the corrupted ground reads differently with stone on your mind; the road herald remembers the lost one.
    const stone = ENCOUNTERS.find(t => t.id === 'corrupted-ground')!.options.find(o => o.requires?.focus === 'material:stone');
    expect(stone).toBeDefined();
    const herald = ENCOUNTERS.find(t => t.id === 'herald-on-the-road')!.options.find(o => o.requires?.deed === 'herald-owes-you');
    expect(herald).toBeDefined();
  });

  // Deeds ride along out of the Reach, and keep through a save; a road from before has none.
  it('carries deeds onto the road and through a save', () => {
    const r = rideTo('hollowford', ['fed-the-stranger']);
    expect(r.deeds).toEqual(['fed-the-stranger']);
    const app = { sim: createRegion1({}, undefined, { id: 'w-deeds' }), queue: [], stage: 'road' as const, road: r };
    expect(deserialize(serialize(app))?.road?.deeds).toEqual(['fed-the-stranger']);
    const { deeds: _gone, ...before } = r;
    expect(deserialize(serialize({ ...app, road: before }))?.road?.deeds).toBeUndefined();
  });
});
