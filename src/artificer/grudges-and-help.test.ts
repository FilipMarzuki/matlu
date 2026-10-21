/**
 * Acceptance tests for grudges, and what counts as helping someone (#1659, a follow-up to the
 * ties of #1588). Behind the `grudges-and-help` rule switch.
 *
 * The issue's scenarios, one test each:
 * - Grudge          → 'Given a grudge from A to B, When A is asked about B, …'
 * - Repeat visits   → 'Given the player trades at someone's shop on several visits, …'
 * - Kin             → 'Given the player does a task for someone's kin, …'
 * - Trade and tasks → 'Given a fair trade or a finished task, …'
 * - Taking a side   → 'Given the player takes A's side against a rival B, …'
 * - Switch off      → 'Given the switch off, …'
 * Then what holds them up: the switch's registration, and the deed record help is read from.
 */

import { describe, it, expect } from 'vitest';
import { FACTS, factsFor, resolve } from './facts';
import { featureById, featureOn, ruleFeatures } from './features';
import { ask } from './asks';
import { CUSTOM_TRUST, deedEffects, helpEffects, type HelpDeed } from './help';
import { QUEST_TRUST, QUEST_TRUST_VILLAGE } from './quests';
import { SALE_TRUST } from './trade';
import { HELP_FEATURE, HELP_TIE_FACTS, TIE_FACTS, helpRipples, tiesOf } from './ties';
import { personById } from './villages';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, type RoadState } from './road';
import { makeWarden, serialize, deserialize, type AppState } from '../artificer-app/controller';

const ON = ruleFeatures();
const OFF = { ...ON, [HELP_FEATURE]: false };
/** Today's game: every switch as a new game has it, before this one existed (read as its `absent`). */
const TODAY: Record<string, boolean> = Object.fromEntries(Object.entries(ON).filter(([k]) => k !== HELP_FEATURE));

/** A Warden out of the Reach, in a world with `features`, carrying plenty to sell, on the road until `until` says stop. */
function ride(features: Record<string, boolean>, until: (r: RoadState) => boolean, from?: RoadState): RoadState {
  let r = from;
  if (!r) {
    const s = createRegion1({}, undefined, { id: 'w-help', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
    const vitals = createVitals({ vigor: 90, clarity: 90, condition: 90 });
    const r1: Region1State = {
      ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12, hides: 10, firewood: 10 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
      config: { ...s.config, world: { ...s.config.world, features } },
    };
    r = { ...createRoad(r1), marks: 50 };
  }
  for (let i = 0; i < 30 && !until(r); i++) r = endRoadDay(r);
  return r;
}
const inVillage = (id: string) => (r: RoadState) => villageOf(r) === id;
/** Do an action, and how much `pid`'s trust moved by it. */
function act(r: RoadState, id: string, pid: string): [RoadState, number] {
  const next = runRoadAction(r, id as Parameters<typeof runRoadAction>[1]);
  return [next, (next.trust[pid] ?? 0) - (r.trust[pid] ?? 0)];
}
/** Trust Tobin gains from selling him a hide on each of `days` days in Hollowford, as one total. */
function custom(features: Record<string, boolean>, days: number): { gain: number; road: RoadState } {
  let r = ride(features, inVillage('hollowford'));
  let gain = 0;
  for (let d = 0; d < days; d++) {
    if (d) r = endRoadDay(r);
    expect(villageOf(r)).toBe('hollowford');
    const [next, g] = act(r, 'sell:hides:1', 'hf-tobin');
    expect(next.marks).toBeGreaterThan(r.marks); // the sale went through
    r = next;
    gain += g;
  }
  return { gain, road: r };
}

describe('#1659 acceptance', () => {
  it('Grudge: Given a grudge from A to B, When A is asked about B, Then A\'s account is coloured by it, and B\'s account of A is not', () => {
    // Gunnar holds a grudge against Anselm; Anselm holds no view of Gunnar.
    const tie = tiesOf('sm-gunnar', ON).find(t => t.other === 'sm-anselm');
    expect(tie?.kind).toBe('grudge');
    expect(tie!.opinion).toBeLessThan(0);
    expect(tiesOf('sm-anselm', ON).some(t => t.other === 'sm-gunnar')).toBe(false);
    const facts = factsFor(ON);
    // A's account of B: his grudge, in his own words, at full confidence — and unfair (it's false).
    const gunnar = resolve('sm-gunnar', 'person:sm-anselm', 100, { facts });
    expect(gunnar?.kind === 'told' && gunnar.fact.id).toBe('tie:gunnar-anselm:sm-gunnar');
    expect(gunnar?.kind === 'told' && gunnar.fact.text).toBe(tie!.says);
    expect(gunnar?.kind === 'told' && gunnar.fact.truth).toBe('false');
    const a = ask(personById('sm-gunnar')!, 'person:sm-anselm', 'Anselm', 100, [], { facts });
    expect(a.kind === 'told' && a.answer.text).toBe(tie!.says);
    // Without the grudge (the switch off), Gunnar answers as he did before.
    const before = resolve('sm-gunnar', 'person:sm-anselm', 100, { facts: factsFor(OFF) });
    expect(before?.kind === 'told' ? before.fact.id : null).not.toBe('tie:gunnar-anselm:sm-gunnar');
    // B's account of A: the same with the grudge as without it.
    expect(resolve('sm-anselm', 'person:sm-gunnar', 100, { facts })).toEqual(resolve('sm-anselm', 'person:sm-gunnar', 100, { facts: factsFor(OFF) }));
  });

  it('Repeat visits: Given the player trades at someone\'s shop on several visits, Then their standing with them rises more than one visit gives', () => {
    const one = custom(ON, 1).gain, three = custom(ON, 3).gain;
    expect(one).toBe(SALE_TRUST);
    // Two return visits earn a regular's welcome on top of each sale.
    expect(three).toBe(3 * SALE_TRUST + 2 * CUSTOM_TRUST);
    expect(three).toBeGreaterThan(3 * one);
    // More than three sales on one visit: those are one visit.
    let r = ride(ON, inVillage('hollowford'));
    let same = 0;
    for (let i = 0; i < 3; i++) { const [next, g] = act(r, 'sell:hides:1', 'hf-tobin'); r = next; same += g; }
    expect(three).toBeGreaterThan(same);
  });

  it('Kin: Given the player does a task for someone\'s kin, Then the kin\'s relative warms to the player', () => {
    // Arvid at the Gate is Pim's cousin; Pim rides the wagon, so you've known him since the thaw.
    expect(tiesOf('cv-pim', ON).find(t => t.other === 'kg-arvid')?.kind).toBe('kin');
    const job = (features: Record<string, boolean>): number => {
      const r = ride(features, inVillage('kestrel-gate'));
      const [after] = act({ ...r, quests: { ...r.quests, 'kg-ore-track': 'active' } }, 'complete:kg-ore-track', 'kg-arvid');
      expect(after.quests['kg-ore-track']).toBe('done');
      return after.trust['cv-pim'] - r.trust['cv-pim'];
    };
    expect(job(ON)).toBe(Math.round(QUEST_TRUST / 2));
    expect(job(OFF)).toBe(0);
  });

  it('Trade and tasks: Given a fair trade or a finished task, Then standing rises', () => {
    // A fair purchase: their price, paid.
    const r = ride(ON, inVillage('hollowford'));
    const [bought, gain] = act(r, 'buy:rawFood:1', 'hf-tobin');
    expect(bought.stores.rawFood).toBe(r.stores.rawFood + 1);
    expect(gain).toBe(SALE_TRUST);
    // A sale, as ever.
    expect(act(r, 'sell:hides:1', 'hf-tobin')[1]).toBe(SALE_TRUST);
    // A job done: Orrin's wood for the forge.
    const [done, forge] = act({ ...r, quests: { ...r.quests, 'hf-forge-wood': 'active' } }, 'complete:hf-forge-wood', 'hf-orrin');
    expect(done.quests['hf-forge-wood']).toBe('done');
    expect(forge).toBe(QUEST_TRUST);
    // All three are on the record help is read from, in order.
    expect(bought.helps).toEqual([{ day: r.day, who: 'hf-tobin', kind: 'bought' }]);
    expect(done.helps).toEqual([{ day: r.day, who: 'hf-orrin', kind: 'task', quest: 'hf-forge-wood' }]);
  });

  it('Taking a side: Given the player takes A\'s side against a rival B, Then A warms and B cools', () => {
    // Carrying Tobin's hides to Hedda is doing Tobin's work: his rival Maren hears of it at once.
    const side = (features: Record<string, boolean>) => {
      let r = ride(features, inVillage('hollowford'));
      r = runRoadAction({ ...r, quests: { ...r.quests, 'hf-hides-saltmere': 'active' } }, 'rest');
      const before = r;
      r = ride(features, inVillage('saltmere'), r);
      expect(r.quests['hf-hides-saltmere']).toBe('done');
      return { tobin: r.trust['hf-tobin'] - before.trust['hf-tobin'], maren: r.trust['hf-maren'] - before.trust['hf-maren'], hedda: r.trust['sm-hedda'], r };
    };
    const on = side(ON), off = side(OFF);
    expect(on.tobin).toBe(QUEST_TRUST);
    // Without the switch Maren warms a little, as all Hollowford does for a job done there; with it,
    // she sees you take her rival's side, and cools by more than that.
    expect(off.maren).toBe(QUEST_TRUST_VILLAGE);
    expect(on.maren - off.maren).toBe(-Math.round(QUEST_TRUST / 2));
    expect(on.maren).toBeLessThan(0);
    // His friend Hedda, met on the same arrival, warms too.
    expect(on.hedda).toBeGreaterThan(off.hedda);
    expect(on.r.log.some(l => /Maren that you've taken Tobin's side/.test(l.text))).toBe(true);
    // A grudge cools the same way, one way only: help Anselm and Gunnar cools; help Gunnar and Anselm doesn't notice.
    expect(helpRipples('sm-anselm', QUEST_TRUST, ON)['sm-gunnar']).toBe(-Math.round(QUEST_TRUST / 2));
    expect(helpRipples('sm-gunnar', QUEST_TRUST, ON)['sm-anselm']).toBeUndefined();
  });

  it('Switch off: Given the switch off, Then play equals today\'s', () => {
    expect(featureOn(TODAY, HELP_FEATURE)).toBe(false);
    // The same play, switched off and from before the switch: the same road, to the last line.
    const script = (features: Record<string, boolean>): RoadState => {
      let r = custom(features, 3).road;
      r = runRoadAction(r, 'buy:rawFood:1');
      r = runRoadAction({ ...r, quests: { ...r.quests, 'hf-forge-wood': 'active', 'hf-hides-saltmere': 'active' } }, 'complete:hf-forge-wood');
      return ride(features, inVillage('kestrel-gate'), r);
    };
    const off = script(OFF), today = script(TODAY);
    expect({ ...off, features: undefined }).toEqual({ ...today, features: undefined });
    // Nothing recorded, and today's rules: a sale's trust per sale, none for buying, no word along ties.
    expect(off.helps).toBeUndefined();
    expect(custom(OFF, 3).gain).toBe(3 * custom(OFF, 1).gain);
    let r = ride(OFF, inVillage('hollowford'));
    expect(act(r, 'buy:rawFood:1', 'hf-tobin')[1]).toBe(0);
    // And people say what they said: no grudge, no kin tie.
    expect(factsFor(OFF)).toBe(factsFor(TODAY));
    for (const f of HELP_TIE_FACTS) expect(factsFor(OFF)).not.toContain(f);
    expect(tiesOf('cv-pim', OFF)).toEqual([]);
    r = ride(ON, inVillage('hollowford'));
    expect(r.helps).toBeUndefined(); // nothing recorded until there's something to record
  });
});

describe('The grudges-and-help switch', () => {
  it('is an experimental rules feature, on in a new game, off for runs from before it', () => {
    expect(featureById(HELP_FEATURE)).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1659 });
    expect(featureOn(undefined, HELP_FEATURE)).toBe(false);
    expect(featureOn(ON, HELP_FEATURE)).toBe(true);
  });

  it('adds its ties\' facts only with ties on too, and leaves the ties of #1588 as they were', () => {
    for (const f of HELP_TIE_FACTS) expect(factsFor(ON)).toContain(f);
    expect(factsFor({ ...ON, ties: false })).toBe(factsFor({ ...OFF, ties: false }));
    expect(factsFor(undefined)).toBe(FACTS);
    expect(TIE_FACTS.some(f => HELP_TIE_FACTS.includes(f))).toBe(false);
  });
});

describe('Help, read off the record of deeds', () => {
  const sold = (day: number, who = 'hf-tobin'): HelpDeed => ({ day, who, kind: 'sold' });

  it('reads the whole history in order, deed by deed: what each deed adds is what it adds after the ones before', () => {
    const deeds: HelpDeed[] = [sold(3), sold(3), sold(4), { day: 4, who: 'hf-tobin', kind: 'bought' }, sold(5), { day: 5, who: 'hf-orrin', kind: 'task', quest: 'hf-forge-wood' }];
    const total = helpEffects(deeds, ON);
    // Two return visits, one purchase; Orrin's job reaches his friend Sabine.
    expect(total['hf-tobin']).toBeGreaterThanOrEqual(2 * CUSTOM_TRUST + SALE_TRUST);
    expect(total['kg-sabine']).toBeGreaterThan(0);
    const summed: Record<string, number> = {};
    deeds.forEach((d, i) => { for (const [k, v] of Object.entries(deedEffects(deeds.slice(0, i), d, ON))) summed[k] = (summed[k] ?? 0) + v; });
    expect(summed).toEqual(total);
    // Order matters: the same deeds, the first visit last, earn the same; one visit, nothing extra.
    expect(helpEffects([sold(3), sold(3), sold(3)], ON)).toEqual({});
  });

  it('a regular\'s custom reaches their ties too, and nothing reaches them with ties off', () => {
    // Tobin's rival Maren cools a little each day you come back to his stall; his friend Hedda warms.
    const e = helpEffects([sold(1), sold(2)], ON);
    expect(e['hf-tobin']).toBe(CUSTOM_TRUST);
    expect(e['hf-maren']).toBeLessThan(0);
    expect(e['sm-hedda']).toBeGreaterThan(0);
    expect(helpEffects([sold(1), sold(2)], { ...ON, ties: false })).toEqual({ 'hf-tobin': CUSTOM_TRUST });
  });

  it('keeps the record through a save, in order, and drops only a deed in the wrong shape', () => {
    const road = custom(ON, 2).road;
    expect(road.helps).toEqual([sold(road.day - 1), sold(road.day)]);
    const app = { ...makeWarden({ id: 'w-help-save' }), stage: 'road', road } as AppState;
    expect(deserialize(serialize(app))?.road?.helps).toEqual(road.helps);
    const raw = JSON.parse(serialize(app));
    raw.road.helps = [...raw.road.helps, { day: 'x', who: 'hf-tobin', kind: 'sold' }, { day: 3, who: 'hf-tobin', kind: 'stole' }];
    expect(deserialize(JSON.stringify(raw))?.road?.helps).toEqual(road.helps);
    delete raw.road.helps;
    expect(deserialize(JSON.stringify(raw))?.road?.helps).toBeUndefined();
  });
});
