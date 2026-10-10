/**
 * The road's focus (#1479). The road keeps its own copy of the Warden's focus, and its nights run
 * Region 1's `sleepNight`, which charges Clarity for it and turns a focused concept over. But the
 * Warden tab's chips set the Reach's focus, so on the road a player couldn't change or clear the
 * focus they boarded with, and it charged them every night. The chips now set the road's focus.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, FOCUS_OPEN, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, setRoadFocus, type RoadState } from './road';
import { FOCUS_COST, GOAL_IDS, type Focus } from './focus';
import { SKILL_IDS } from './skills';
import { chooseFocus, serialize, deserialize, type AppState } from '../artificer-app/controller';

/** A Warden who survived the winter with materials to craft, now on the wagon. */
function onTheRoad(focus: Focus | null = null, clarity = 80): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-focus-road', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, focus,
    stores: { ...s.stores, rawFood: 10, water: 10, rations: 6, materials: 20, stone: 10, hides: 4 },
    skills: { woodcraft: 6 },
    outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
  };
  return createRoad(from);
}

/** The app on the road: the Reach's run kept (with its own focus), the road under way. */
const appOnRoad = (road: RoadState, reachFocus: Focus | null = null): AppState => {
  const sim = createRegion1({}, undefined, { id: 'w-focus-road' });
  return { sim: { ...sim, focus: reachFocus }, queue: [], stage: 'road', road };
};

const firstConcept = (s: RoadState) => FOCUS_OPEN({ concepts: s.concepts })[0];
/** A day of helping drive, then the night. */
const helpAndSleep = (s: RoadState) => endRoadDay(runRoadAction(s, 'help'));
/** Clarity low enough that a night's rest doesn't reach the cap (which would clip the focus's cost). */
const TIRED = 45;

describe("The road's focus (#1479)", () => {
  // 1. On the road, a chip sets the road's focus: the one shown, and the one its nights charge for.
  it('sets the road’s focus from the Warden tab, not the Reach’s', () => {
    const concept = firstConcept(onTheRoad());
    const a = chooseFocus(appOnRoad(onTheRoad(), { kind: 'goal', id: 'larder' }), { kind: 'concept', id: concept });
    expect(a.road?.focus).toEqual({ kind: 'concept', id: concept });
    expect(a.sim.focus).toEqual({ kind: 'goal', id: 'larder' });
    // And clearing it: the focus the Warden boarded with can be let go.
    expect(chooseFocus(appOnRoad(onTheRoad({ kind: 'skill', id: 'woodcraft' })), null).road?.focus).toBeNull();
  });

  // 2. A concept not open to the Warden is refused on the road too (#1478), and says why.
  it('refuses a concept the Warden hasn’t come across', () => {
    const road = onTheRoad({ kind: 'goal', id: 'shelter' });
    const after = setRoadFocus(road, { kind: 'concept', id: 'bearings' });
    expect(after.focus).toEqual({ kind: 'goal', id: 'shelter' });
    expect(after.log.at(-1)?.text).toMatch(/can't turn your mind to bearings — you haven't come across/);
  });

  // 3. What a focus does on the road, as the tab's note says: a concept is turned over each night
  //    for its Clarity; a goal or a skill costs the same Clarity and gets nothing for it.
  it('turns a focused concept over each night, and charges every focus its Clarity', () => {
    const none = helpAndSleep(onTheRoad(null, TIRED));
    const concept = firstConcept(onTheRoad());
    const turned = helpAndSleep(onTheRoad({ kind: 'concept', id: concept }, TIRED));
    expect(turned.vitals.clarity.current).toBeCloseTo(none.vitals.clarity.current - FOCUS_COST, 6);
    expect(turned.concepts[concept]?.insight ?? 0).toBeGreaterThan(none.concepts[concept]?.insight ?? 0);
    for (const focus of [...GOAL_IDS.map(id => ({ kind: 'goal', id }) as Focus), ...SKILL_IDS.map(id => ({ kind: 'skill', id }) as Focus)]) {
      const night = helpAndSleep(onTheRoad(focus, TIRED));
      expect([focus, night.vitals.clarity.current]).toEqual([focus, expect.closeTo(none.vitals.clarity.current - FOCUS_COST, 6)]);
      expect([focus, night.concepts, night.skills]).toEqual([focus, none.concepts, none.skills]);
    }
  });

  // The road's focus is now a choice that's saved: it loads back, checked like the Reach's (#1478).
  it('keeps the road’s focus through a save, and drops one that no longer holds', () => {
    const concept = firstConcept(onTheRoad());
    const chosen = chooseFocus(appOnRoad(onTheRoad()), { kind: 'concept', id: concept });
    expect(deserialize(serialize(chosen))?.road?.focus).toEqual({ kind: 'concept', id: concept });
    // A save edited by hand or from a broken build: a goal that doesn't exist, or a concept not open.
    for (const bad of [{ kind: 'goal', id: 'nope' }, { kind: 'concept', id: 'bearings' }, 'skill:woodcraft', 7]) {
      const raw = JSON.parse(serialize(chosen));
      raw.road.focus = bad;
      expect([bad, deserialize(JSON.stringify(raw))?.road?.focus]).toEqual([bad, null]);
    }
  });

  // The note's other half: a craft on the wagon practises at its own pace, whatever the focus.
  it('crafts on the wagon practise the same, whatever the focus', () => {
    const plain = runRoadAction(onTheRoad(), 'craft:stone-knife');
    expect(plain.tools.some(t => t.item === 'stone-knife')).toBe(true);
    const focuses: Focus[] = [...GOAL_IDS.map(id => ({ kind: 'goal', id }) as Focus), ...SKILL_IDS.map(id => ({ kind: 'skill', id }) as Focus), { kind: 'concept', id: firstConcept(onTheRoad()) }];
    for (const focus of focuses) {
      const made = runRoadAction(onTheRoad(focus), 'craft:stone-knife');
      expect([focus, made.skills, made.vitals]).toEqual([focus, plain.skills, plain.vitals]);
    }
  });
});
