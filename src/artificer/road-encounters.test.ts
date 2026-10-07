/**
 * Acceptance tests for #1349 — road encounters: at most one a day, rolled at dawn, using the road's
 * currencies (marks, the caravan's trust); the day waits for the answer; a lost fight can kill;
 * none where the Reach had none; and the AI harness answers them. One test per scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD } from './world';
import { createRoad, endRoadDay, runRoadAction, runRoadDay, chooseRoadOption, roadEncounterFor, type RoadState } from './road';
import { ENCOUNTERS, encounterById, encounterFor, optionsFor, chanceOf, rollOutcome } from './encounters';
import { seedOf } from './talents';
import { playRoad } from '../artificer-ai/runner';
import { randomPlayer } from '../artificer-ai/players/random';

/** A Warden at the thaw, well stocked, in a world with or without encounters. */
function reach(id: string, encounters = true): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters } }, undefined, { id, name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 30, water: 20, firewood: 4 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
}
/** A Warden whose road meets something at dawn on road day 2 (still on the wagon). */
function metOnDay2(): string {
  for (let i = 0; i < 200; i++) if (roadEncounterFor(seedOf(`w-road-enc-${i}`), 2, 'travel')) return `w-road-enc-${i}`;
  throw new Error('no Warden meets anything on road day 2');
}
/** A road with `id` waiting in front of you. */
const facing = (id: string, extra: Partial<RoadState> = {}, who = 'w-road-face'): RoadState =>
  ({ ...createRoad(reach(who)), pending: { id, day: 1, hour: 8, ring: 1, action: 'road', state: 'calm', margin: 0 }, ...extra });
const option = (id: string, opt: string) => encounterById(id)!.options.find(o => o.id === opt)!;
const view = (r: RoadState) => r as unknown as Region1State;

describe('Road encounters (#1349)', () => {
  // 1. A dawn whose roll hits: a road encounter waits, and nothing else happens until it's answered.
  it('meets something at dawn, and the day waits for the answer', () => {
    const r = endRoadDay(createRoad(reach(metOnDay2())));
    expect(r.day).toBe(2);
    const t = encounterById(r.pending!.id)!;
    expect(t.road === 'wagon' || t.road === 'any').toBe(true);
    expect(r.log.at(-1)!.text).toBe(t.text);
    // Nothing moves until it's answered.
    expect(runRoadAction(r, 'rest')).toBe(r);
    expect(endRoadDay(r)).toBe(r);
    expect(runRoadDay(r, ['rest', 'wait'])).toEqual({ state: r, remaining: ['rest', 'wait'] });
    // Answered, the day goes on.
    const open = optionsFor(view(r), t).find(o => !o.unmet)!.option.id;
    const answered = chooseRoadOption(r, open);
    expect(answered.pending).toBeNull();
    expect(runRoadAction(answered, 'rest').hoursToday).toBeGreaterThan(answered.hoursToday);
    // Road encounters are never met in the Reach, and every road day has at most one.
    for (let d = 1; d <= 300; d++) expect(encounterFor(seedOf('w-reach'), d, 12, 3, 'autumn', true)?.road).toBeUndefined();
    expect(ENCOUNTERS.filter(e => e.road).length).toBe(6);
  });

  // 2. Bandits with 5+ marks: paying costs 5 marks and wins Bodil's trust; with fewer, "pay" is closed with the reason.
  it('lets you pay the bandits in marks, if you have them', () => {
    const r = facing('bandits-at-ford', { marks: 7 });
    const paid = chooseRoadOption(r, 'pay');
    expect(paid.marks).toBe(2);
    expect(paid.trust['cv-bodil']).toBe(r.trust['cv-bodil'] + 5);
    expect(paid.pending).toBeNull();
    expect(optionsFor(view(facing('bandits-at-ford', { marks: 4 })), encounterById('bandits-at-ford')!).find(o => o.option.id === 'pay')!.unmet).toBe('needs 5 marks');
    expect(chooseRoadOption(facing('bandits-at-ford', { marks: 4 }), 'pay').marks).toBe(4);
    // Marks and trust move with other encounters too: helping Pim with the axle wins his trust.
    const axle = facing('broken-axle', {}, 'w-axle');
    const helped = chooseRoadOption(axle, 'hands');
    expect(helped.trust['cv-bodil']).toBe(axle.trust['cv-bodil'] + 3);
    expect(helped.hoursToday).toBe(axle.hoursToday + 2);
  });

  // 3. A lost fight at the ford at low Condition: the road ends, died, killed by bandits.
  it('can kill: a lost fight at the ford', () => {
    let who = '';
    for (let i = 0; i < 200 && !who; i++) {
      const r = facing('bandits-at-ford', {}, `w-ford-${i}`);
      if (rollOutcome(seedOf(r.character.id), r.pending!, option('bandits-at-ford', 'fight'), chanceOf(view(r), option('bandits-at-ford', 'fight'))).tier === 'fail') who = `w-ford-${i}`;
    }
    const r = facing('bandits-at-ford', { vitals: createVitals({ condition: 30 }) }, who);
    const after = chooseRoadOption(r, 'fight');
    expect(after.outcome?.kind).toBe('died');
    expect(after.log.at(-1)!.text).toBe('Killed by bandits at the ford.');
    // With more Condition, the same bolt is a wound, not the end.
    const tough = chooseRoadOption({ ...r, vitals: createVitals({ condition: 90 }) }, 'fight');
    expect(tough.outcome).toBeNull();
    expect(tough.vitals.condition).toBe(50);
  });

  // 4. A Reach run with encounters off: its road meets nothing.
  it('meets nothing on the road where the Reach had no encounters', () => {
    let r = createRoad(reach(metOnDay2(), false));
    while (!r.outcome) { expect(r.pending ?? null).toBeNull(); r = endRoadDay(r); }
    expect(r.outcome.kind).toBe('arrived');
  });

  // 5. The AI harness: answers through decideEncounter, falls back to the safest after two invalid answers, and random roads keep every invariant.
  it('is played by the AI harness', async () => {
    const asked: string[] = [];
    const res = await playRoad(reach(metOnDay2()), async () => '{"thoughts": "ride", "actions": ["wait"]}', undefined, undefined, async message => { asked.push(message); return '{"choice":"fly"}'; });
    expect(asked[0]).toMatch(/^ENCOUNTER — road day 2, on the caravan road\. The day waits until you choose\./);
    expect(asked[1]).toMatch(/^Your choice was invalid:\n- "fly" is not an option here/);
    const met = res.turns.flatMap(t => t.encounters ?? []);
    expect(met[0]).toMatchObject({ forced: true, reply: '{"choice":"fly"}' });
    expect(res.turns.find(t => t.encounters)!.day).toBe(2);
    // Without a way to answer, the safest is taken, unmarked by any reply.
    const mute = await playRoad(reach(metOnDay2()), async () => '{"thoughts": "ride", "actions": ["wait"]}');
    expect(mute.turns.flatMap(t => t.encounters ?? [])[0]).toMatchObject({ forced: true });
    // 30 random roads.
    const broken: string[] = [];
    let seen = 0;
    for (let n = 1; n <= 30; n++) {
      const p = randomPlayer({ mode: n % 2 ? 'legal' : 'uniform', seed: n });
      const r = await playRoad(reach(`w-rand-road-${n}`), async (m, rs) => (await p.decideRoad!(m, rs)).text, undefined, undefined, async (m, rs) => (await p.decideEncounter!(m, view(rs))).text);
      for (const t of r.turns) { if (t.violations) broken.push(`run ${n} day ${t.day}: ${t.violations.join('; ')}`); seen += t.encounters?.length ?? 0; }
      expect(['arrived', 'died', 'collapsed']).toContain(r.record.kind);
      expect(r.final.pending ?? null).toBeNull();
    }
    expect(broken).toEqual([]);
    expect(seen).toBeGreaterThan(10);
  }, 60_000);
});
