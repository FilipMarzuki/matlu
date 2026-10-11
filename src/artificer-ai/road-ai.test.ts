/**
 * Acceptance tests for #1251 — the AI harness plays the caravan road:
 * observation, actions, the scripted and random baselines, invariants and the
 * report. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { createRoad, endRoadDay, villageOf, ROUTE, type RoadState } from '../artificer/road';
import { peopleOf } from '../artificer/villages';
import { observeRoad } from './observe';
import { playRoad, playRun, aiCharacterId } from './runner';
import { scriptedPlayer } from './players/scripted';
import { randomPlayer } from './players/random';
import { aggregate, type Transcript } from './report';

/** A Region 1 run at the thaw, well stocked, carrying a sound cold gear. */
function survived(seedId = 'w-vega'): Region1State {
  const s = createRegion1({}, undefined, { id: seedId, name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, tools: [{ item: 'cold-gear', grade: 'sound' }], stores: { ...s.stores, rawFood: 30, water: 20, firewood: 4 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
}
function inFirstVillage(): RoadState {
  let r = createRoad(survived());
  const leg = ROUTE.findIndex(l => l.kind === 'village');
  while (r.leg < leg) r = endRoadDay(r);
  return r;
}

describe('The AI plays the road (#1251)', () => {
  // 1. Village 1: the observation lists each person (role, trust), the open quests and what they need, and the marks.
  it('observes the village, its people, quests and marks', () => {
    const r = { ...inFirstVillage(), marks: 7 };
    const text = observeRoad(r);
    for (const p of peopleOf('hollowford')) expect(text).toContain(`${p.id} · ${p.name}, ${p.role} · trust ${r.trust[p.id]}`);
    expect(text).toContain('QUESTS ON OFFER:');
    expect(text).toContain('hf-forge-wood "Wood for the forge" from Orrin — bring 4 firewood');
    expect(text).toContain('MARKS: 7');
    expect(text).toContain('TRADER: hf-tobin');
  });

  // 2. A reply {"actions": ["sell:cold-gear"]} in a village with a trader: the sale happens. An invalid action is explained back.
  it('applies a model’s road actions, and explains invalid ones', async () => {
    const messages: string[] = [];
    let sold = false;
    const result = await playRoad(survived(), async (message, r) => {
      messages.push(message);
      if (/Your reply was invalid/.test(message)) return '{"thoughts": "fixed", "actions": ["wait"]}';
      if (r.day === 1) return '{"thoughts": "fly", "actions": ["fly:moon"]}';
      if (villageOf(r) && !sold) { sold = true; return '{"thoughts": "sell", "actions": ["sell:cold-gear"]}'; }
      return '{"thoughts": "ride", "actions": ["wait"]}';
    });
    expect(messages[0]).toContain('THE CARAVAN ROAD');
    expect(messages[1]).toMatch(/actions\[0\] "fly:moon" is not a road action/);
    const sale = result.turns.find(t => t.actions.includes('sell:cold-gear'))!;
    expect(sale.journal.some(l => /^Sold sound cold-gear to Tobin for 6 marks/.test(l))).toBe(true);
    expect(sale.progress.marks).toBe(6);
    expect(result.final.tools.some(t => t.item === 'cold-gear')).toBe(false);
    expect(result.record.kind).toBe('arrived');
  });

  // 3. The scripted player, seeded Region 1 run plus the road: arrives in Mistheim alive with 1+ quest done.
  it('gets the scripted player to Mistheim with a quest done', async () => {
    const run = await playRun(scriptedPlayer(), { road: true, characterId: aiCharacterId('scripted', 's1') });
    expect(run.record.kind).toBe('survived');
    expect(run.road?.record.kind).toBe('arrived');
    expect(run.road!.final.vitals.condition).toBeGreaterThan(0);
    expect(run.road!.record.road!.quests).toBeGreaterThanOrEqual(1);
    expect(run.road!.turns.every(t => !t.invalid && !t.violations)).toBe(true);
  }, 30_000);

  // 4. 50 random runs through the road: no invariant breaks.
  it('keeps every invariant through 50 random roads', async () => {
    const broken: string[] = [];
    for (let n = 1; n <= 50; n++) {
      const player = randomPlayer({ mode: n % 2 ? 'legal' : 'uniform', seed: n });
      const reach = { ...survived(`w-rand-${n}`), stores: { ...survived().stores, rawFood: 5 + (n % 20), water: n % 12, hides: n % 4, materials: n % 7 } };
      const res = await playRoad(reach, async (m, r) => (await player.decideRoad!(m, r)).text);
      for (const t of res.turns) if (t.violations) broken.push(`run ${n} day ${t.day}: ${t.violations.join('; ')}`);
      expect(['arrived', 'died', 'collapsed']).toContain(res.record.kind);
    }
    expect(broken).toEqual([]);
  }, 60_000);

  // 5. A finished road run: the report's per-day snapshots include marks, total trust and quests done.
  it('reports the road day by day', async () => {
    const run = await playRun(scriptedPlayer(), { road: true, characterId: aiCharacterId('scripted', 's1') });
    const transcript = JSON.parse(JSON.stringify({ ...run, final: undefined, road: { turns: run.road!.turns, start: run.road!.start, record: run.road!.record } })) as Transcript;
    const [m] = aggregate([transcript]);
    const road = m.road!;
    expect(road.runs).toBe(1);
    expect(road.outcomes).toEqual({ arrived: 1 });
    expect(road.series.marks).toHaveLength(run.road!.turns.length + 1);
    expect(road.series.marks.at(-1)).toBe(run.road!.final.marks);
    expect(road.series.questsDone.at(-1)).toBe(run.road!.record.road!.quests);
    expect(road.series.totalTrust.at(-1)).toBeGreaterThan(road.series.totalTrust[0]!);
    expect(road.actions.talk).toBeGreaterThan(0);
  }, 30_000);
});
