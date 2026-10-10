/**
 * Acceptance tests for #1494 (epic #1493, docs/focus-and-dialogue-design.md §1): focus can take a
 * topic — a material, place, group, person, quest or job — once the Warden has come across it.
 * Asking people about it comes with #1495; this slice is the focus itself.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, setFocus, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, setRoadFocus, ROUTE, type RoadState } from './road';
import { FOCUS_COST, parseFocus, focusLabel, type Focus } from './focus';
import { topicsOpen, mentionsIn } from './topics';
import { chooseFocus, serialize, deserialize, type AppState } from '../artificer-app/controller';

/** A Warden who survived the winter, on the wagon with the caravan's people. */
function onTheRoad(clarity = 80): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-topics', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals,
    stores: { ...s.stores, rawFood: 10, water: 10, rations: 6, stone: 4, hides: 2 },
    outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
  };
  return createRoad(from);
}

/** Ride on until the caravan reaches Hollowford, the first village. */
function atHollowford(): RoadState {
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let s = onTheRoad();
  for (let i = 0; i < 10 && s.leg < village; i++) s = endRoadDay(s);
  expect(s.leg).toBe(village);
  return s;
}

const role = (id: string): Focus => ({ kind: 'role', id });
const app = (road: RoadState): AppState => ({ sim: createRegion1({}, undefined, { id: 'w-topics' }), queue: [], stage: 'road', road });

describe('Focus on topics (#1494)', () => {
  // 1. Jobs come across by meeting someone who does them.
  it('offers a job once the Warden has met someone who does it', () => {
    const road = onTheRoad();
    // The caravan's own people ride from the start: a healer (Ottilia), but no smith.
    expect(topicsOpen(road)).toContain('role:healer');
    expect(topicsOpen(road)).not.toContain('role:smith');
    // Hollowford has a smith (Orrin): meeting him opens smithing, and Orrin himself, and his village.
    const there = atHollowford();
    expect(topicsOpen(there)).toEqual(expect.arrayContaining(['role:smith', 'person:hf-orrin', 'place:hollowford', 'group:Bergfolk']));
    expect(setRoadFocus(there, role('smith')).focus).toEqual(role('smith'));
  });

  // 2. A topic heard named in a lore line can be focused; one never come across is refused, with the reason.
  it('opens a topic heard in conversation, and refuses one never come across', () => {
    const there = atHollowford();
    const compact: Focus = { kind: 'group', id: 'compact' };
    const refused = setRoadFocus(there, compact);
    expect(refused.focus).toBeNull();
    expect(refused.log.at(-1)?.text).toMatch(/haven't come across the Compact/);
    // Tobin's last lore line names the Compact.
    const told = runRoadAction({ ...there, trust: { ...there.trust, 'hf-tobin': 80 }, told: { ...there.told, 'hf-tobin': 3 } }, 'talk:hf-tobin');
    expect(told.log.at(-1)?.text).toMatch(/Compact/);
    expect(topicsOpen(told)).toContain('group:compact');
    expect(setRoadFocus(told, compact).focus).toEqual(compact);
  });

  // 3. A topic focus costs its Clarity like any focus, and changes no hours.
  it('costs a topic focus its Clarity each night, like any focus', () => {
    const sleep = (s: RoadState) => endRoadDay(runRoadAction(s, 'help'));
    const none = sleep(onTheRoad(45));
    const focused = sleep({ ...onTheRoad(45), focus: role('healer') });
    expect(focused.vitals.clarity.current).toBeCloseTo(none.vitals.clarity.current - FOCUS_COST, 6);
    expect(focused.hoursToday).toBe(none.hoursToday);
  });

  // 4. A topic focus survives a save if it's still come across; otherwise it loads as no focus.
  it('keeps a topic focus through a save, and drops one that no longer holds', () => {
    const chosen = chooseFocus(app(atHollowford()), role('smith'));
    expect(deserialize(serialize(chosen))?.road?.focus).toEqual(role('smith'));
    for (const bad of [role('smith'), { kind: 'material', id: 'unobtainium' }, { kind: 'person', id: 'nobody' }]) {
      const raw = JSON.parse(serialize(app(onTheRoad())));
      raw.road.focus = bad;
      expect([bad, deserialize(JSON.stringify(raw))?.road?.focus]).toEqual([bad, null]);
    }
  });

  // In the Reach, too: the materials in hand are come across, and nothing else is.
  it('knows the materials a Warden holds, in the Reach as on the road', () => {
    const s = createRegion1({}, undefined, { id: 'w-topics' });
    const holding = { ...s, stores: { ...s.stores, stone: 3 } };
    expect(topicsOpen(holding)).toContain('material:stone');
    expect(setFocus(holding, { kind: 'material', id: 'stone' }).focus).toEqual({ kind: 'material', id: 'stone' });
    expect(setFocus(holding, { kind: 'material', id: 'iron' }).focus).toBeNull();
  });

  it('reads topics out of what people say', () => {
    expect(mentionsIn('The Compact pays better for news than for hides.')).toEqual(expect.arrayContaining(['group:compact', 'material:hides']));
    expect(mentionsIn('Kestrel Gate takes a toll on everything that moves.')).toContain('place:kestrel-gate');
    // A word inside another isn't the topic: "ironborne" isn't iron.
    expect(mentionsIn('The ironborne camp is loud.')).not.toContain('material:iron');
  });

  it('parses and labels topic focuses', () => {
    expect(parseFocus('material:iron')).toEqual({ kind: 'material', id: 'iron' });
    expect(parseFocus('group:compact')).toEqual({ kind: 'group', id: 'compact' });
    expect(parseFocus('person:hf-orrin')).toEqual({ kind: 'person', id: 'hf-orrin' });
    expect(parseFocus('material:unobtainium')).toBeNull();
    expect(focusLabel({ kind: 'group', id: 'compact' })).toBe('The Compact');
    expect(focusLabel({ kind: 'person', id: 'hf-orrin' })).toBe('Orrin');
  });
});
