/**
 * Acceptance tests for #1244 — Region 1.5 core: the caravan road (route,
 * clock, survival on the move). One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, runRoadDay, ROUTE, ROAD_DAYS, type RoadState } from './road';

/** A Region 1 run that left with the caravan, `thrive` or `ragged`, for a Warden with some history. */
function leftWithCaravan(kind: 'thrive' | 'ragged', condition = 90): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-vega', name: 'Vega', portrait: 'tinkerer', traits: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 60, clarity: 70, condition });
  return {
    ...s,
    day: 11,
    vitals,
    stores: { ...s.stores, rawFood: 3, water: 4, rations: 6, materials: 5 },
    skills: { woodcraft: 40, scouting: 8 },
    techniques: ['grain', 'landmarks'],
    known: [...s.known, 'trap-snare'],
    tools: [{ item: 'stone-knife', grade: 'sound' }],
    outcome: { choice: 'caravan', kind, vitals },
  };
}

/** A road placed on a given leg and day of that leg, with stores set. */
function at(s: RoadState, leg: number, legDay: number, stores: Partial<RoadState['stores']> = {}): RoadState {
  return { ...s, leg, legDay, stores: { ...s.stores, ...stores } };
}

const lastLine = (s: RoadState) => s.log.at(-1)?.text ?? '';
const travelLeg = ROUTE.findIndex(l => l.kind === 'travel');
const firstVillage = ROUTE.findIndex(l => l.kind === 'village');

describe('The caravan road (#1244)', () => {
  it('is three villages with travel between them, 18 days in all', () => {
    expect(ROUTE.filter(l => l.kind === 'village').map(l => l.days)).toEqual([3, 3, 4]);
    expect(ROUTE.filter(l => l.kind === 'travel').map(l => l.days)).toEqual([2, 2, 2, 2]);
    expect(ROUTE.at(-1)?.kind).toBe('travel');
    expect(ROAD_DAYS).toBe(18);
  });

  // 1. A thriving caravan exit starts the road with everything the Warden has.
  it('starts the road with the same Warden, knowledge and goods', () => {
    const from = leftWithCaravan('thrive');
    const road = createRoad(from);
    expect(road).toMatchObject({ leg: 0, legDay: 1, day: 1, arrival: 'thrive', outcome: null });
    expect(ROUTE[road.leg].kind).toBe('travel');
    expect(road.character).toEqual(from.character);
    expect(road.vitals).toEqual(from.vitals);
    expect(road.skills).toEqual(from.skills);
    expect(road.techniques).toEqual(from.techniques);
    expect(road.known).toEqual(from.known);
    expect(road.tools).toEqual(from.tools);
    // Rations are just food on the road.
    expect(road.stores).toMatchObject({ rawFood: 9, rations: 0, water: 4, materials: 5 });
  });

  // 2. A ragged exit: the caravan took you in half-frozen.
  it('starts a ragged Warden worn, with Condition capped at 70', () => {
    const road = createRoad(leftWithCaravan('ragged', 90));
    expect(road.vitals.condition).toBe(70);
    expect(road.arrival).toBe('ragged');
    expect(road.log.map(l => l.text).join('\n')).toMatch(/half-frozen/);
    expect(createRoad(leftWithCaravan('ragged', 50)).vitals.condition).toBe(50);
  });

  it('only starts from a caravan exit', () => {
    const solo = { ...leftWithCaravan('thrive'), outcome: { choice: 'solo' as const, kind: 'crossed' as const, vitals: createVitals() } };
    expect(() => createRoad(solo)).toThrow(/caravan/);
    expect(() => createRoad({ ...leftWithCaravan('thrive'), outcome: null })).toThrow(/caravan/);
  });

  // 3. The end of a travel leg brings the caravan into the next village.
  it('arrives at the first village after two travel days', () => {
    let s = createRoad(leftWithCaravan('thrive'));
    s = endRoadDay(s);
    expect(s).toMatchObject({ leg: travelLeg, legDay: 2, day: 2 });
    s = endRoadDay(s);
    expect(s).toMatchObject({ leg: firstVillage, legDay: 1, day: 3 });
    const village = ROUTE[firstVillage];
    expect(village.kind === 'village' && village.name).toBeTruthy();
    expect(lastLine(s)).toContain(village.kind === 'village' ? village.name : '?');
  });

  // 4. The caravan keeps its schedule.
  it('moves on at the end of a village stay, ready or not', () => {
    const s = createRoad(leftWithCaravan('thrive'));
    const lastDay = at(s, firstVillage, ROUTE[firstVillage].days, { rawFood: 5, water: 5 });
    const next = endRoadDay(lastDay);
    expect(next.leg).toBe(firstVillage + 1);
    expect(ROUTE[next.leg].kind).toBe('travel');
    expect(next.legDay).toBe(1);
    expect(next.log.map(l => l.text).join('\n')).toMatch(/The caravan rolls out at dawn/);
  });

  // 5. The caravan waters you on the road; in a village you fend for yourself.
  it('waters you from the barrels on travel days, not in villages', () => {
    const s = createRoad(leftWithCaravan('thrive'));
    const onRoad = endRoadDay(at(s, travelLeg, 1, { water: 0, rawFood: 3 }));
    expect(onRoad.deprivation.thirsty).toBe(0);
    expect(onRoad.stores.water).toBe(0);
    const withOwn = endRoadDay(at(s, travelLeg, 1, { water: 3, rawFood: 3 }));
    expect(withOwn.stores.water).toBe(3);
    const inVillage = endRoadDay(at(s, firstVillage, 1, { water: 0, rawFood: 3 }));
    expect(inVillage.deprivation.thirsty).toBe(1);
    expect(inVillage.log.map(l => l.text).join('\n')).toMatch(/Thirsty/);
  });

  // 6. Survival rules still apply: starvation kills, as in Region 1.
  it('kills a starving Warden on the road', () => {
    const s = createRoad(leftWithCaravan('thrive'));
    const starving = { ...at(s, travelLeg, 1, { rawFood: 0 }), deprivation: { hungry: 4, thirsty: 0 }, vitals: createVitals({ condition: 5 }), character: { ...s.character, traits: [] } };
    const dead = endRoadDay(starving);
    expect(dead.outcome).toMatchObject({ kind: 'died' });
    expect(lastLine(dead)).toMatch(/starvation/);
    // Nothing more happens once the road is over.
    expect(endRoadDay(dead)).toEqual(dead);
    expect(runRoadAction(dead, 'rest')).toEqual(dead);
  });

  // 7. The last travel day ends in Mistheim.
  it('arrives in Mistheim at the end of the route', () => {
    const s = createRoad(leftWithCaravan('thrive'));
    const last = at(s, ROUTE.length - 1, ROUTE.at(-1)!.days, { rawFood: 3 });
    const done = endRoadDay(last);
    expect(done.outcome).toMatchObject({ kind: 'arrived' });
    expect(lastLine(done)).toMatch(/Mistheim/);
  });

  // 8. Deterministic: same start, same actions, same result.
  it('plays out the same way every time', () => {
    const play = () => {
      let s = createRoad(leftWithCaravan('thrive'));
      for (let d = 0; d < 6; d++) s = runRoadDay(s, ['rest', 'wait']).state;
      return s;
    };
    expect(play()).toEqual(play());
  });

  it('rests and waits through a day', () => {
    const s = { ...createRoad(leftWithCaravan('thrive')), vitals: createVitals({ vigor: 50 }) };
    const rested = runRoadAction(s, 'rest');
    expect(rested.hoursToday).toBe(3);
    expect(rested.vitals.vigor.current).toBeGreaterThan(50);
    expect(runRoadAction(rested, 'wait').hoursToday).toBe(14);
  });
});
