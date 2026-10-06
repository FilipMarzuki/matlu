/**
 * Acceptance tests for #1248 — Region 1.5 village quests: fetch, craft,
 * repair, scout and deliver, offered by people who trust you, with the
 * caravan as the deadline. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { createRoad, endRoadDay, runRoadAction, questsHere, villageOf, ROUTE, type RoadState } from './road';
import { questById, OFFER_TRUST, QUEST_TRUST, QUEST_TRUST_VILLAGE, REPAIR_INSIGHT } from './quests';
import { peopleOf } from './villages';
import type { Grade } from './winter';

/** A Region 1 run that survived to the thaw: hale (thrive) or broken (ragged). */
function survived(grade: Grade = 'hale'): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-vega', name: 'Vega', stats: { ...DEFAULT_STATS } });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10 }, outcome: { choice: 'thaw', kind: 'survived', grade, vitals } };
}
/** Ride the road until the caravan is in village `id`. */
function reachVillage(s: RoadState, id: string): RoadState {
  const leg = ROUTE.findIndex(l => l.kind === 'village' && l.id === id);
  while (s.leg < leg && !s.outcome) s = endRoadDay(s);
  return s;
}
/** Ride on until the caravan has left the village you're in. */
function leave(s: RoadState): RoadState {
  const leg = s.leg;
  while (s.leg === leg && !s.outcome) s = endRoadDay(s);
  return s;
}
const at = (id: string, grade: Grade = 'hale'): RoadState => reachVillage(createRoad(survived(grade)), id);
const lastLine = (s: RoadState): string => s.log.at(-1)?.text ?? '';
const fresh = (s: RoadState): RoadState => ({ ...s, hoursToday: 0 });

describe('Village quests (#1248)', () => {
  // 1. A fetch quest for 4 firewood, with 4 in stores: firewood −4, rewards as listed, the journal names the giver.
  it('completes a fetch quest from stores', () => {
    const quest = questById('hf-forge-wood')!;
    expect(quest.needs).toEqual({ kind: 'fetch', item: 'firewood', qty: 4 });
    let s = at('hollowford');
    s = { ...s, stores: { ...s.stores, firewood: 4 } };
    const before = runRoadAction(s, 'accept:hf-forge-wood');
    expect(before.hoursToday).toBe(s.hoursToday);
    const after = runRoadAction(before, 'complete:hf-forge-wood');
    expect(after.stores.firewood).toBe(0);
    expect(after.marks).toBe(before.marks + quest.reward.marks);
    expect(after.trust['hf-orrin']).toBe(before.trust['hf-orrin'] + QUEST_TRUST);
    for (const p of peopleOf('hollowford').filter(p => p.id !== 'hf-orrin')) expect(after.trust[p.id]).toBe(before.trust[p.id] + QUEST_TRUST_VILLAGE);
    expect(after.quests['hf-forge-wood']).toBe('done');
    expect(lastLine(after)).toContain('Orrin');
  });

  // 2. A craft quest for a sound-or-better waterskin, with only a crude one: rejected, saying what's needed.
  it('rejects a craft quest when the item is below the grade', () => {
    let s = at('saltmere');
    s = runRoadAction({ ...s, tools: [{ item: 'waterskin', grade: 'crude' }] }, 'accept:sm-waterskin');
    const after = runRoadAction(s, 'complete:sm-waterskin');
    expect(lastLine(after)).toContain('needs a sound or better waterskin');
    expect(after.quests['sm-waterskin']).toBe('active');
    expect(after.tools).toHaveLength(1);
    expect(after.hoursToday).toBe(s.hoursToday);
    // A sound one does it, and is handed over.
    const ok = runRoadAction({ ...s, tools: [...s.tools, { item: 'waterskin', grade: 'sound' }] }, 'complete:sm-waterskin');
    expect(ok.quests['sm-waterskin']).toBe('done');
    expect(ok.tools).toEqual([{ item: 'waterskin', grade: 'crude' }]);
  });

  // 3. A repair quest needing Tension rank 1 and 4 hours: 4 hours pass, the reward, Tension insight. Without the rank, rejected.
  it('completes a repair quest with the concept rank, and rejects it without', () => {
    expect(questById('sm-sluice')!.needs).toEqual({ kind: 'repair', concept: 'tension', rank: 1, hours: 4 });
    const s = runRoadAction(at('saltmere'), 'accept:sm-sluice');
    const ranked = { ...s, concepts: { ...s.concepts, tension: { rank: 1, insight: 0 } } };
    const after = runRoadAction(ranked, 'complete:sm-sluice');
    expect(after.hoursToday).toBe(ranked.hoursToday + 4);
    expect(after.marks).toBe(ranked.marks + 6);
    expect(after.stores.rations).toBe(ranked.stores.rations + 2);
    expect(after.concepts.tension.insight).toBe(REPAIR_INSIGHT);
    expect(after.quests['sm-sluice']).toBe('done');

    const unranked = runRoadAction({ ...s, concepts: {} }, 'complete:sm-sluice');
    expect(lastLine(unranked)).toContain('tension rank 1');
    expect(unranked.hoursToday).toBe(s.hoursToday);
    expect(unranked.quests['sm-sluice']).toBe('active');
  });

  // 4. A scout quest: its hours plus walking drain; Pathfinding and scouting skill lower the drain.
  it('drains a scout quest like Region 1 scouting', () => {
    const s = runRoadAction(at('saltmere'), 'accept:sm-shore');
    const n = questById('sm-shore')!.needs as { hours: number; walk: number };
    const drain = (from: RoadState): number => from.vitals.vigor.current - runRoadAction(fresh(from), 'complete:sm-shore').vitals.vigor.current;
    const plain = runRoadAction(s, 'complete:sm-shore');
    expect(plain.hoursToday).toBe(s.hoursToday + n.hours + n.walk);
    expect(plain.quests['sm-shore']).toBe('done');
    const base = drain(s);
    expect(base).toBeGreaterThan(0);
    expect(drain({ ...s, techniques: ['pathfinding'] })).toBeLessThan(base);
    expect(drain({ ...s, skills: { ...s.skills, scouting: 60 } })).toBeLessThan(base);
    expect(plain.skills.scouting ?? 0).toBeGreaterThan(s.skills.scouting ?? 0);
  });

  // 5. A deliver quest from village 1: completes on arrival at village 2 with the goods; fails (−10 trust) without them.
  it('completes a delivery on arrival, and fails it if the goods are gone', () => {
    const s = runRoadAction(at('hollowford'), 'accept:hf-hides-saltmere');
    expect(s.stores.hides).toBe(2);
    const there = reachVillage(s, 'saltmere');
    expect(villageOf(there)).toBe('saltmere');
    expect(there.quests['hf-hides-saltmere']).toBe('done');
    expect(there.stores.hides).toBe(0);
    expect(there.marks).toBe(s.marks + 8);

    const sold = { ...s, stores: { ...s.stores, hides: 0 } };
    const failed = reachVillage(sold, 'saltmere');
    expect(failed.quests['hf-hides-saltmere']).toBe('failed');
    expect(failed.trust['hf-tobin']).toBe(sold.trust['hf-tobin'] - 10);
    expect(failed.marks).toBe(sold.marks);
  });

  // 6. An accepted, unfinished quest when the caravan leaves: it expires, trust −5 with the giver, and a journal line.
  it('expires an unfinished quest when the caravan leaves', () => {
    const s = runRoadAction(at('hollowford'), 'accept:hf-forge-wood');
    const gone = leave(s);
    expect(gone.quests['hf-forge-wood']).toBe('expired');
    expect(gone.trust['hf-orrin']).toBe(s.trust['hf-orrin'] - 5);
    expect(gone.log.some(e => e.text.includes('Wood for the forge') && e.text.includes('Orrin'))).toBe(true);
  });

  // 7. A giver with trust under 15: their quest isn't offered.
  it('offers a quest only once the giver trusts you enough', () => {
    const ragged = at('hollowford', 'broken');
    expect(ragged.trust['hf-orrin']).toBeLessThan(OFFER_TRUST);
    expect(questsHere(ragged)).toEqual([]);
    expect(lastLine(runRoadAction(ragged, 'accept:hf-forge-wood'))).toMatch(/skipped/);
    const warmed = { ...ragged, trust: { ...ragged.trust, 'hf-orrin': OFFER_TRUST } };
    expect(questsHere(warmed).map(q => q.id)).toEqual(['hf-forge-wood']);
  });
});
