/**
 * Acceptance tests for #1498 (epic #1493, docs/focus-and-dialogue-design.md slice E): the first
 * real content for asking, noticing and leads — enough that asking pays on one road.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, setRoadFocus, villageOf, type RoadState } from './road';
import { answerFor } from './asks';
import { SIGNS } from './notice';
import { VILLAGES, TRAVELLERS } from './villages';
import type { Focus } from './focus';
import { roadView } from '../artificer-app/road-view';

/** The six topics slice E writes for. */
const TOPICS = ['material:iron', 'group:compact', 'role:smith', 'skill:foraging', 'place:kestrel-gate', 'quest:hf-hides-saltmere'] as const;

/** Every villager, with their village. */
const VILLAGERS = Object.values(VILLAGES).flatMap(v => v.people.map(p => ({ id: p.id, village: v.id })));

describe('First dialogue content (#1498)', () => {
  // 1. Each topic: at least two people with something to say, in at least two villages.
  it('gives each topic people to ask in more than one village', () => {
    for (const key of TOPICS) {
      const who = VILLAGERS.filter(p => answerFor(p.id, key));
      expect([key, who.length >= 2]).toEqual([key, true]);
      expect([key, new Set(who.map(p => p.village)).size >= 2]).toEqual([key, true]);
    }
    // The caravan's own people have things to say too, on the travel days between.
    expect(TRAVELLERS.some(p => TOPICS.some(key => answerFor(p.id, key)))).toBe(true);
  });

  // 2. The iron chain, end to end, as a player would: Orrin names iron, you focus on it and ask
  //    him, he sends you to Sabine at Kestrel Gate, and she tells you, a stranger, what she knows.
  it('runs the iron lead chain from Hollowford to Kestrel Gate', () => {
    const s = createRegion1({}, undefined, { id: 'w-chain', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
    const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
    const from: Region1State = { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
    let r: RoadState = createRoad(from);
    for (let i = 0; i < 10 && villageOf(r) !== 'hollowford'; i++) r = endRoadDay(r);
    const iron: Focus = { kind: 'material', id: 'iron' };
    // Before Orrin says the word, iron isn't something you can turn your mind to.
    expect(setRoadFocus(r, iron).focus).not.toEqual(iron);
    r = runRoadAction(r, 'talk:hf-orrin');
    r = setRoadFocus(r, iron);
    expect(r.focus).toEqual(iron);
    r = runRoadAction(r, 'ask:hf-orrin');
    expect(r.leads?.[0]).toMatchObject({ who: 'kg-sabine', where: 'kestrel-gate', about: 'material:iron', from: 'hf-orrin' });
    for (let i = 0; i < 20 && villageOf(r) !== 'kestrel-gate'; i++) r = endRoadDay(r);
    expect(roadView(r, { person: null })).toContain('the one Orrin mentioned');
    const before = r.concepts['heat-treatment']?.insight ?? 0;
    const told = runRoadAction({ ...r, focus: iron, noticed: {} }, 'ask:kg-sabine');
    expect(told.log.at(-1)?.text).toContain(answerFor('kg-sabine', 'material:iron')!.text);
    expect(told.concepts['heat-treatment']?.insight ?? 0).toBeGreaterThan(before);
  });

  // 3. Signs to notice, for the Compact and for iron.
  it('has signs for the Compact and for iron', () => {
    const signsFor = (key: string) => Object.entries(SIGNS).filter(([, by]) => by[key]).map(([id]) => id);
    expect(signsFor('group:compact').length).toBeGreaterThanOrEqual(2);
    expect(signsFor('material:iron').length).toBeGreaterThanOrEqual(2);
  });

  // The Compact is the goblins' own: its members show a sign and keep it close; outsiders talk.
  it('keeps the Compact a goblin secret', () => {
    for (const [id, by] of Object.entries(SIGNS)) {
      if (!by['group:compact']) continue;
      expect([id, VILLAGES[VILLAGERS.find(p => p.id === id)!.village].people.find(p => p.id === id)!.people]).toEqual([id, 'Goblins']);
      // A member answers only a friend.
      expect([id, (answerFor(id, 'group:compact')?.at ?? 0) >= 50]).toEqual([id, true]);
    }
  });
});
