/**
 * Acceptance tests for #1497 (epic #1493, docs/focus-and-dialogue-design.md §5): an answer can
 * point to someone elsewhere. A lead records who, where, about what and who told you; it shows in
 * the quest log, opens its person as a focus, and makes them readier to answer on its topic.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, type RoadState } from './road';
import { answerFor, LEAD_TRUST } from './asks';
import { topicsOpen } from './topics';
import type { Focus } from './focus';
import { questLog, roadView } from '../artificer-app/road-view';
import { observeRoad } from '../artificer-ai/observe';
import { serialize, deserialize } from '../artificer-app/controller';

const IRON: Focus = { kind: 'material', id: 'iron' };

/** A Warden on the caravan road, well stocked for the whole way. */
function road(): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-leads', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  return createRoad(from);
}

/** Ride on, resting, until the caravan is in `village`. */
function until(r: RoadState, village: string): RoadState {
  let s = r;
  for (let i = 0; i < 20 && villageOf(s) !== village && !s.outcome; i++) s = endRoadDay(s);
  return s;
}

/** At Hollowford, focused on iron, Orrin trusting you enough: asked about iron. */
function toldByOrrin(): RoadState {
  const at = answerFor('hf-orrin', 'material:iron')!;
  const r = until(road(), 'hollowford');
  return runRoadAction({ ...r, focus: IRON, trust: { ...r.trust, 'hf-orrin': at.at + 5 } }, 'ask:hf-orrin');
}

describe('Leads (#1497)', () => {
  // 1. Orrin's iron answer points to Sabine at Kestrel Gate: a lead in the quest log, and Sabine can be focused.
  it('records a lead when an answer points to someone elsewhere', () => {
    const after = toldByOrrin();
    expect(after.leads).toEqual([{ who: 'kg-sabine', where: 'kestrel-gate', about: 'material:iron', from: 'hf-orrin' }]);
    const log = questLog(after);
    expect(log).toMatch(/LEADS/);
    expect(log).toMatch(/Sabine/);
    expect(log).toMatch(/Orrin/);
    // The lead opens Sabine as a focus, whatever words the answer used.
    expect(topicsOpen({ ...after, heard: [] })).toContain('person:kg-sabine');
    // The AI sees it too.
    expect(observeRoad(after)).toMatch(/LEADS:.*kg-sabine/);
  });

  // 2. At Kestrel Gate with the lead: "the one Orrin mentioned", and her iron answer opens to a stranger.
  it('makes the one they mentioned readier to answer', () => {
    const sabine = answerFor('kg-sabine', 'material:iron')!;
    // Her answer is gated, and the lead is enough to open it.
    expect(sabine.at).toBeGreaterThan(0);
    expect(sabine.at).toBeLessThanOrEqual(LEAD_TRUST);
    const there = until(toldByOrrin(), 'kestrel-gate');
    expect(villageOf(there)).toBe('kestrel-gate');
    expect(roadView(there, { person: null })).toContain('the one Orrin mentioned');
    // A stranger, and nothing noticed about her (noticing, #1496, opens a gate of its own).
    const stranger: RoadState = { ...there, focus: IRON, trust: { ...there.trust, 'kg-sabine': 0 }, noticed: {} };
    expect(runRoadAction(stranger, 'ask:kg-sabine').log.at(-1)?.text).toContain(sabine.text);
    // Without the lead, a stranger hears "not yet".
    expect(runRoadAction({ ...stranger, leads: [] }, 'ask:kg-sabine').log.at(-1)?.text).not.toContain(sabine.text);
  });

  // 3. Leads keep through a save; a save from before has none.
  it('keeps leads through a save', () => {
    const r = toldByOrrin();
    expect(r.leads).toHaveLength(1);
    const app = { sim: createRegion1({}, undefined, { id: 'w-leads' }), queue: [], stage: 'road' as const, road: r };
    expect(deserialize(serialize(app))?.road?.leads).toEqual(r.leads);
    const { leads: _gone, ...before } = r;
    expect(deserialize(serialize({ ...app, road: before }))?.road?.leads).toBeUndefined();
    // Leads saved in the wrong shape load as none, and a bad entry is dropped; the road still loads.
    const bad = (leads: unknown) => deserialize(serialize({ ...app, road: { ...r, leads } as unknown as RoadState }))?.road;
    expect(bad('oops')?.leads).toBeUndefined();
    expect(bad([{ who: 'kg-sabine' }, ...r.leads!])?.leads).toEqual(r.leads);
    expect(() => runRoadAction(bad('oops')!, 'rest')).not.toThrow();
    // A lead no one's answer gives is dropped (Maren never sent you to Sabine); a real one is rebuilt
    // from the data, whatever the save says about where.
    expect(bad([{ who: 'kg-sabine', about: 'material:iron', from: 'hf-maren' }])?.leads).toEqual([]);
    expect(bad([{ ...r.leads![0], where: 'saltmere' }])?.leads).toEqual(r.leads);
    // A focus on Sabine, open only through the lead, is still allowed when the save loads.
    const sabine: Focus = { kind: 'person', id: 'kg-sabine' };
    expect(deserialize(serialize({ ...app, road: { ...r, heard: [], focus: sabine } }))?.road?.focus).toEqual(sabine);
    expect(deserialize(serialize({ ...app, road: { ...before, heard: [], focus: sabine } }))?.road?.focus).toBeNull();
  });

  // Asking again doesn't record the same lead twice.
  it('records each lead once', () => {
    const once = toldByOrrin();
    expect(once.leads).toHaveLength(1);
    const again = runRoadAction(once, 'ask:hf-orrin');
    expect(again.leads).toEqual(once.leads);
  });
});
