/**
 * Acceptance tests for #1246 — Region 1.5 villages and people: per-person
 * trust, talking, lore gated by trust, and word that travels ahead of you.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { createRoad, endRoadDay, runRoadAction, villageOf, ROUTE, type RoadState } from './road';
import { VILLAGES, TRAVELLERS, peopleOf, talk, TALK_HOURS, type Person } from './villages';
import { QUESTS } from './quests';
import type { Grade } from './winter';

/** A Region 1 run that survived to the thaw, `hale` (thrive) or `broken` (ragged), with the given CHA. */
function survived(grade: Grade, cha = 10): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-vega', name: 'Vega', stats: { ...DEFAULT_STATS, cha } });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10 }, outcome: { choice: 'thaw', kind: 'survived', grade, vitals } };
}
/** Ride the road until the caravan reaches the village at ROUTE index `leg`. */
function reach(s: RoadState, leg: number): RoadState {
  while (s.leg < leg && !s.outcome) s = endRoadDay(s);
  return s;
}
const firstVillage = ROUTE.findIndex(l => l.kind === 'village');
const secondVillage = ROUTE.findIndex((l, i) => l.kind === 'village' && i > firstVillage);
const lastLine = (s: RoadState): string => s.log.at(-1)?.text ?? '';

describe('Villages and people (#1246)', () => {
  // 1. Village 1 after a thriving arrival: everyone at trust 20. After a ragged one, 10.
  it('opens the first village at the arrival’s trust', () => {
    const thrive = reach(createRoad(survived('hale')), firstVillage);
    expect(villageOf(thrive)).toBe('hollowford');
    for (const p of peopleOf('hollowford')) expect(thrive.trust[p.id]).toBe(20);
    const ragged = reach(createRoad(survived('broken')), firstVillage);
    for (const p of peopleOf('hollowford')) expect(ragged.trust[p.id]).toBe(10);
  });

  // 2. A talk at trust 20, lore gated at 0 and 25: trust +5 and the next ungated line; gated lines wait for trust.
  it('raises trust by talking, and shares lore as trust allows', () => {
    const s = reach(createRoad(survived('hale')), firstVillage);
    const maren = peopleOf('hollowford')[0];
    const after = runRoadAction(s, `talk:${maren.id}`);
    expect(after.trust[maren.id]).toBe(25);
    expect(after.hoursToday).toBe(s.hoursToday + TALK_HOURS);
    expect(lastLine(after)).toContain(maren.lore[0].text);
    // The next line is gated at 25 — now reached.
    const again = runRoadAction(after, `talk:${maren.id}`);
    expect(lastLine(again)).toContain(maren.lore[1].text);
    // A line gated above trust waits: Maren's third is at 50.
    const third = runRoadAction({ ...again, hoursToday: 0 }, `talk:${maren.id}`);
    expect(third.trust[maren.id]).toBe(35);
    expect(lastLine(third)).toMatch(/Not yet/);
    expect(lastLine(third)).not.toContain(maren.lore[2].text);
  });

  // 3. Everything told: trust still rises — by 2, then less each time.
  it('keeps raising trust once all is told, with diminishing returns', () => {
    const p: Person = { id: 'x', name: 'X', role: 'elder', people: 'Markfolk', culture: 'fieldborn', personality: 'x', need: { kind: 'job', job: 'y' }, lore: [{ at: 0, text: 'one' }] };
    const told = talk(p, 40, 1, 0);
    expect(told.trust).toBe(42);
    expect(told.line).toMatch(/easy hour/);
    const second = talk(p, told.trust, told.told, told.idleTalks);
    expect(second.trust).toBe(43);
    expect(talk(p, 99, 1, 0).trust).toBe(100); // capped
  });

  // 4. Leaving village 1 at an average trust of 60: village 2 opens at base + 6.
  it('lets word travel to the next village', () => {
    let s = reach(createRoad(survived('hale')), firstVillage);
    s = { ...s, trust: Object.fromEntries(peopleOf('hollowford').map(p => [p.id, 60])) };
    s = reach(s, secondVillage);
    expect(villageOf(s)).toBe('saltmere');
    for (const p of peopleOf('saltmere')) expect(s.trust[p.id]).toBe(20 + 6);
  });

  // 5. Every village person's culture is a real id in macro-world/cultures.json.
  it('gives everyone a real culture', () => {
    const ids = new Set((JSON.parse(readFileSync('macro-world/cultures.json', 'utf8')).cultures as { id: string }[]).map(c => c.id));
    const people = Object.values(VILLAGES).flatMap(v => v.people);
    expect(people.length).toBeGreaterThanOrEqual(12);
    for (const v of Object.values(VILLAGES)) expect(v.people.length).toBeGreaterThanOrEqual(4);
    for (const p of people) {
      expect(ids.has(p.culture), `${p.id}: ${p.culture}`).toBe(true);
      expect(p.lore.length).toBeGreaterThanOrEqual(3);
      expect(p.lore.length).toBeLessThanOrEqual(5);
    }
    expect(Object.keys(VILLAGES)).toEqual(ROUTE.filter(l => l.kind === 'village').map(l => (l as { id: string }).id));
  });

  // 6. A talk with someone not in this village is rejected, and costs no hours.
  it('rejects a talk with someone who isn’t here', () => {
    const s = reach(createRoad(survived('hale')), firstVillage);
    const elsewhere = peopleOf('saltmere')[0];
    const after = runRoadAction(s, `talk:${elsewhere.id}`);
    expect(after.hoursToday).toBe(s.hoursToday);
    expect(after.trust[elsewhere.id]).toBeUndefined();
    expect(lastLine(after)).toMatch(/skipped/);
    // On the wagon, there's no one to talk to.
    const road = createRoad(survived('hale'));
    expect(runRoadAction(road, `talk:${peopleOf('hollowford')[0].id}`).hoursToday).toBe(0);
  });

  // Charisma (#1255): CHA 14 and a thriving arrival — village 1 opens at trust 24.
  it('adds Charisma to everyone’s starting trust', () => {
    const s = reach(createRoad(survived('hale', 14)), firstVillage);
    for (const p of peopleOf('hollowford')) expect(s.trust[p.id]).toBe(24);
  });

  // The lore pass (#1253): real Peoples and cultures, a teacher and a trader in every village,
  // every quest template used, and three fellow travellers to talk to on the wagon.
  it('fills the road with canon people, and travellers on the wagon', () => {
    const PEOPLES = ['Bergfolk', 'Lövfolk', 'Markfolk', 'Viddfolk', 'Steinfolk', 'Pandor', 'Deepwalkers', 'Merfolk', 'Goblins', 'Fae', 'Giants', 'Dragons', 'Everstill', 'Constructs', 'Remnants'];
    const cultures = new Set((JSON.parse(readFileSync('macro-world/cultures.json', 'utf8')).cultures as { id: string }[]).map(c => c.id));
    for (const v of Object.values(VILLAGES)) {
      expect(v.people.some(p => p.teaches), `${v.id} has a teacher`).toBe(true);
      expect(v.people.some(p => p.role === 'trader'), `${v.id} has a trader`).toBe(true);
      for (const c of v.cultures) expect(cultures.has(c), `${v.id}: ${c}`).toBe(true);
      expect(v.landscape && v.corruption && v.why).toBeTruthy();
    }
    for (const p of [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS]) {
      expect(PEOPLES, p.id).toContain(p.people);
      expect(cultures.has(p.culture), `${p.id}: ${p.culture}`).toBe(true);
      expect(p.personality.length).toBeGreaterThan(0);
    }
    expect(new Set(QUESTS.map(q => q.needs.kind))).toEqual(new Set(['fetch', 'craft', 'repair', 'scout', 'deliver']));
    expect(TRAVELLERS).toHaveLength(3);
    for (const t of TRAVELLERS) expect(t.lore).toHaveLength(3);
    // On the wagon, the travellers are there to talk to.
    const road = createRoad(survived('hale'));
    const bodil = TRAVELLERS[0];
    expect(road.trust[bodil.id]).toBe(20);
    const after = runRoadAction(road, `talk:${bodil.id}`);
    expect(after.hoursToday).toBe(TALK_HOURS);
    expect(lastLine(after)).toContain(bodil.lore[0].text);
  });
});
