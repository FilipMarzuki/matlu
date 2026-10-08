/**
 * Acceptance tests for #1250 — wiring the caravan road into the game: riding
 * on from the thaw, recording the road's end, carrying marks and contacts,
 * saves mid-road, and who may ride at all. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { canContinue, legacyOfRoad, CONTACT_TRUST, type RunRecord } from '../artificer/legacy';
import { createRoad, endRoadDay, ROUTE, type RoadState } from '../artificer/road';
import type { OutcomeKind } from '../artificer/winter';
import { currentRun, deserialize, newGame, newRun, recordRun, rideCaravan, roadAct, roadEndDay, runRoadQueuedDay, serialize, type AppState } from './controller';

/** A Region 1 run that ended `kind` at the thaw (or earlier), well stocked for the road. */
function ended(kind: OutcomeKind = 'survived'): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-vega', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  const choice = kind === 'survived' ? 'thaw' as const : 'collapse' as const;
  return { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 30, water: 20, firewood: 4 }, outcome: { choice, kind, ...(kind === 'survived' ? { grade: 'hale' as const } : {}), vitals } };
}
const app = (sim: Region1State): AppState => ({ sim, queue: [], stage: 'reach' });
const hollowford = ROUTE.findIndex(l => l.kind === 'village' && l.id === 'hollowford');

/** Ride the whole road, doing Orrin's firewood quest in Hollowford. Returns the state before the last day and after it. */
function rideToTheEnd(a: AppState): { before: AppState; after: AppState } {
  let s = rideCaravan(a), prev = s;
  while (!s.road!.outcome) {
    prev = s;
    const inHollowford = s.road!.leg === hollowford && s.road!.quests['hf-forge-wood'] === undefined;
    s = runRoadQueuedDay(s, inHollowford ? ['accept:hf-forge-wood', 'complete:hf-forge-wood'] : []);
  }
  return { before: prev, after: s };
}

describe('The road in the game (#1250)', () => {
  // 1. A Region 1 run survived at the thaw: rideCaravan → stage road via createRoad, and no run recorded yet.
  it('rides on from the thaw without ending the run', () => {
    const a = app(ended());
    const r = rideCaravan(a);
    expect(r.stage).toBe('road');
    expect(r.road).toEqual(createRoad(a.sim));
    expect(r.sim).toBe(a.sim);
    expect(recordRun([], a, r)).toEqual([]);
  });

  // 2. A road that resolves `arrived`: the record has the kind, villages, quests, marks and the character.
  it('records the road’s end as the run', () => {
    const { before, after } = rideToTheEnd(app(ended()));
    expect(after.road!.outcome?.kind).toBe('arrived');
    const [rec] = recordRun([], before, after);
    expect(rec).toMatchObject({ kind: 'arrived', stage: 'road', characterId: 'w-vega', run: 1 });
    expect(rec.road).toEqual({ villages: ['hollowford', 'saltmere', 'kestrel-gate'], quests: 1, marks: after.road!.marks });
    expect(rec.road!.marks).toBe(5);
    // Recorded once only.
    expect(recordRun([rec], after, after)).toEqual([rec]);
    // A thaw record already made for this run is replaced, keeping its run number.
    const thaw: RunRecord = { ...rec, kind: 'survived', stage: undefined, road: undefined, day: 61, run: 3 };
    const h = recordRun([thaw], before, after);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: 'arrived', run: 3 });
  });

  // 3. Arrived with 2 people at trust 50+ and 12 marks: the road's legacy lists them — but the game's next run
  //    is a stranger (#1455), who gets the tools and not the marks or the friends.
  it('lists marks and contacts in the road’s legacy, but the next Warden is a stranger with the tools', () => {
    const { after } = rideToTheEnd(app(ended()));
    const road: RoadState = { ...after.road!, marks: 12, trust: { 'hf-maren': 55, 'sm-liv': 60, 'hf-tobin': 30 }, tools: [{ item: 'stone-knife', grade: 'sound' }] };
    expect(legacyOfRoad(road).contacts?.sort()).toEqual(['hf-maren', 'sm-liv']);
    const next = newRun(road);
    expect(next.sim.character.id).not.toBe('w-vega');
    expect(next.sim.marks).toBeUndefined();
    expect(next.sim.contacts).toBeUndefined();
    expect(next.sim.tools).toContainEqual({ item: 'stone-knife', grade: 'sound', heirloom: true });
    // The same character carried through `legacyOfRoad` (as the sim still allows) starts the next road with them:
    // marks in hand, and Maren remembers you.
    const same = createRegion1({}, legacyOfRoad(road), { id: 'w-vega', name: 'Vega' });
    expect(same.marks).toBe(12);
    let again = createRoad({ ...same, outcome: ended().outcome });
    expect(again.marks).toBe(12);
    while (again.leg < hollowford) again = endRoadDay(again);
    expect(again.trust['hf-maren']).toBe(CONTACT_TRUST);
    expect(again.trust['hf-tobin']).toBeLessThan(CONTACT_TRUST);
  });

  // 4. A save mid-road round-trips deep-equal; a save from before Region 1.5 loads in the Reach.
  it('saves and loads mid-road, and keeps old saves in the Reach', () => {
    let a = rideCaravan(app(ended()));
    for (let i = 0; i < 4; i++) a = runRoadQueuedDay(a, ['talk:hf-maren']);
    expect(a.road!.outcome).toBeNull();
    expect(deserialize(serialize(a))).toEqual(a);

    const old = JSON.parse(serialize(newGame()));
    delete old.stage;
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded?.stage).toBe('reach');
    expect(loaded?.road).toBeUndefined();
    // A road that isn't one is a broken save, not a silent Reach.
    expect(deserialize(JSON.stringify({ ...JSON.parse(serialize(a)), road: { leg: 'x' } }))).toBeNull();
  });

  // 5. Dying on the road: canContinue is false, and nothing carries.
  it('ends the character who dies on the road', () => {
    const a = rideCaravan(app(ended()));
    const dead: RoadState = { ...a.road!, marks: 9, outcome: { kind: 'died', vitals: a.road!.vitals } };
    const s: AppState = { ...a, road: dead };
    expect(canContinue(currentRun(s))).toBe(false);
    const next = newRun(currentRun(s));
    expect(next.sim.character.id).not.toBe('w-vega');
    expect(next.sim.marks).toBeUndefined();
    expect(next.sim.contacts).toBeUndefined();
  });

  // 6. A run that died or collapsed in Region 1: rideCaravan is refused, and the run ends there.
  it('refuses the road to a run that didn’t survive the winter', () => {
    for (const kind of ['died', 'collapsed'] as const) {
      const a = app(ended(kind));
      expect(rideCaravan(a)).toBe(a);
      const before = { ...a, sim: { ...a.sim, outcome: null } };
      expect(recordRun([], before, a)[0]).toMatchObject({ kind });
    }
    // An unfinished run can't ride either.
    const unfinished = app({ ...ended(), outcome: null });
    expect(rideCaravan(unfinished)).toBe(unfinished);
  });

  // The road screen (#1252) acts as you tap: one action now, or the end of the day.
  it('acts one road action at a time, and ends the day on its own', () => {
    let a = rideCaravan(app(ended()));
    while (a.road!.leg < hollowford) a = roadEndDay(a);
    const talked = roadAct(a, 'talk:hf-maren');
    expect(talked.road!.hoursToday).toBe(a.road!.hoursToday + 2);
    expect(talked.road!.day).toBe(a.road!.day);
    expect(roadEndDay(talked).road!.day).toBe(a.road!.day + 1);
    // Nothing happens outside the road.
    const reach = app(ended());
    expect(roadAct(reach, 'rest')).toBe(reach);
    expect(roadEndDay(reach)).toBe(reach);
  });
});
