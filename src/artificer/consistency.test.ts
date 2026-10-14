/**
 * Acceptance tests for consistency being rewarded (#1663): the road's people learn what to expect
 * of the Warden from the deed record. Behind the `consistency` rule switch.
 *
 * The issue's scenarios, one test each:
 * - Steady record   → 'Steady record: Given a player who paid fair at every trade, …'
 * - Erratic record  → 'Erratic record: Given a player who alternated fair and cheating, …'
 * - Word travels    → 'Word travels: Given a record known in one village, …'
 * - Hard bargainer  → 'Hard bargainer: Given a consistently hard bargainer, …'
 * - Switch off      → 'Switch off: Given the switch off, …'
 * The owner's addition (comment of 2026-10-12):
 * - Hard vs fair    → 'Hard vs fair: Given a consistent hard bargainer and a consistent fair dealer, …'
 * Then what holds them up: the two functions on their own (each with its own tests, neither reading
 * the other), recency, siding, the deeds recorded in play, the save, and the switch's registration.
 *
 * There's no haggling on the road yet and the Warden never lies, so `haggled` and `lied` deeds are
 * synthetic here: the functions read them, play doesn't record them yet.
 */

import { describe, it, expect } from 'vitest';
import { featureById, featureOn, ruleFeatures } from './features';
import { type HelpDeed } from './help';
import { HELP_FEATURE } from './ties';
import { buyPrice, friendly, FRIEND_TRUST } from './trade';
import { observeRoad } from '../artificer-ai/observe';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, tradeTerms, villageOf, type RoadState } from './road';
import { makeWarden, serialize, deserialize, type AppState } from '../artificer-app/controller';
import {
  CONSISTENCY_FEATURE, CONFIDE, HAGGLE_ROUNDS, HEDGE, SUSPICION,
  brokenWordKnown, heardBy, predictability, recordGate, trust,
} from './consistency';

const ON = ruleFeatures();
const OFF = { ...ON, [CONSISTENCY_FEATURE]: false };
/** Today's game: every switch as a new game has it, before this one existed (read as its `absent`). */
const TODAY: Record<string, boolean> = Object.fromEntries(Object.entries(ON).filter(([k]) => k !== CONSISTENCY_FEATURE));

const deed = (kind: HelpDeed['kind'], who = 'hf-tobin', day = 1): HelpDeed => ({ day, who, kind });
const times = (n: number, kind: HelpDeed['kind'], who = 'hf-tobin'): HelpDeed[] => Array.from({ length: n }, (_, i) => deed(kind, who, i + 1));
const fair = (n: number, who = 'hf-tobin') => times(n, 'sold', who);
const hard = (n: number, who = 'hf-tobin') => times(n, 'haggled', who);
/** Fair and cheating by turns, ending on a cheat. */
const erratic = (n: number, who = 'hf-tobin'): HelpDeed[] => Array.from({ length: n }, (_, i) => deed(i % 2 ? 'haggled' : 'sold', who, i + 1));

/** A Warden out of the Reach, in a world with `features`, carrying plenty to sell, on the road until `until` says stop. */
function ride(features: Record<string, boolean>, until: (r: RoadState) => boolean, from?: RoadState): RoadState {
  let r = from;
  if (!r) {
    const s = createRegion1({}, undefined, { id: 'w-steady', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
    const vitals = createVitals({ vigor: 90, clarity: 90, condition: 90 });
    const r1: Region1State = {
      ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12, hides: 10, firewood: 10 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
      config: { ...s.config, world: { ...s.config.world, features } },
    };
    r = { ...createRoad(r1), marks: 60 };
  }
  for (let i = 0; i < 30 && !until(r); i++) r = endRoadDay(r);
  return r;
}
const inVillage = (id: string) => (r: RoadState) => villageOf(r) === id;
const act = (r: RoadState, id: string): RoadState => runRoadAction(r, id as Parameters<typeof runRoadAction>[1]);
/** Three fair sales to Tobin on the first day in Hollowford, then the next morning. */
function threeFairSales(features: Record<string, boolean>): RoadState {
  let r = ride(features, inVillage('hollowford'));
  for (let i = 0; i < 3; i++) r = act(r, 'sell:hides:1');
  return endRoadDay(r);
}
const linesSince = (before: RoadState, after: RoadState): string[] => after.log.slice(before.log.length).map(l => l.text);

describe('#1663 acceptance', () => {
  it('Steady record: Given a player who paid fair at every trade, Then a trader offers better or expected terms, and says why', () => {
    const p = predictability(fair(4), 'hf-tobin', ON);
    expect(p.terms).toBe('expected');
    expect(p.hedge).toBe(1);
    expect(p.says).toMatch(/You always pay fair/);
    // In play: three fair sales to Tobin, and the next day's first trade says why.
    const steady = threeFairSales(ON), today = threeFairSales(OFF);
    expect(steady.helps?.map(d => d.kind)).toEqual(['sold', 'sold', 'sold']);
    const next = act(steady, 'buy:rawFood:1');
    expect(linesSince(steady, next).join(' ')).toMatch(/Tobin: "You always pay fair, so I know where we stand\. Your word's good with me/);
    // Better or expected: never worse than today's, and here better (the regular's rate).
    const on = tradeTerms(steady)!, off = tradeTerms(today)!;
    expect(on.trust).toBe(off.trust);
    expect(on.hedge).toBeUndefined();
    expect(buyPrice('rawFood', 10, on)).toBeLessThan(buyPrice('rawFood', 10, off));
  });

  it('names the regular\'s rate wherever prices show it: the AI\'s view says "friend\'s rate" when a record earns it below friend trust', () => {
    const steady = threeFairSales(ON);
    const t = tradeTerms(steady)!;
    expect(t.trust).toBeLessThan(FRIEND_TRUST);
    expect(friendly(t)).toBe(true);
    expect(observeRoad(steady)).toMatch(/friend’s rate/);
    expect(observeRoad(threeFairSales(OFF))).not.toMatch(/friend’s rate/);
  });

  it('Erratic record: Given a player who alternated fair and cheating, Then terms and candour are worse than for a steadily neutral player', () => {
    const p = predictability(erratic(4), 'hf-tobin', ON);
    expect(p.terms).toBe('hedged');
    expect(p.hedge).toBe(HEDGE);
    expect(p.says).toMatch(/I never know where I stand with you/);
    // A steadily neutral player: nothing to go on either way, so today's terms and gates.
    const neutral = predictability([], 'hf-tobin', ON);
    expect(neutral.terms).toBe('unknown');
    expect(neutral.hedge).toBe(1);
    // Candour: their gates read higher for the erratic one.
    expect(recordGate(erratic(4), 'hf-tobin', ON)).toBe(-SUSPICION);
    expect(recordGate([], 'hf-tobin', ON)).toBe(0);
    // Terms, in play: the same road and the same trust, but an erratic record known to Tobin.
    const r = ride(ON, inVillage('hollowford'));
    const worse = tradeTerms({ ...r, helps: erratic(4) })!, plain = tradeTerms(r)!;
    expect(worse.trust).toBe(plain.trust);
    expect(buyPrice('rawFood', 10, worse)).toBeGreaterThan(buyPrice('rawFood', 10, plain));
    // Dealt with on days before this stay, so this is the first trade with Tobin today.
    const next = act({ ...r, helps: erratic(4).map(d => ({ ...d, day: 0 })) }, 'buy:rawFood:1');
    expect(next.log.map(l => l.text).join(' ')).toMatch(/Tobin: "I never know where I stand with you/);
  });

  it('Word travels: Given a record known in one village, Then a tied person in the next village already knows it', () => {
    // Tobin of Hollowford and Hedda of Saltmere are friends: she hears of how you dealt with him.
    const record = fair(4);
    expect(heardBy(record, 'sm-hedda', ON)).toEqual(record);
    expect(predictability(record, 'sm-hedda', ON).terms).toBe('expected');
    expect(trust(record, 'sm-hedda', ON).credit).toBe(true);
    // Gunnar of Saltmere has no tie to Tobin: he hasn't heard.
    expect(heardBy(record, 'sm-gunnar', ON)).toEqual([]);
    expect(predictability(record, 'sm-gunnar', ON).terms).toBe('unknown');
    // The caravan carries it ahead: a deed with its merchant is known in every village.
    expect(heardBy(fair(2, 'cv-runa'), 'sm-gunnar', ON)).toHaveLength(2);
    // In play: Hedda, met for the first time in Saltmere, already knows what to expect.
    const there = ride(ON, inVillage('saltmere'), threeFairSales(ON));
    const next = act(there, 'sell:hides:1');
    expect(linesSince(there, next).join(' ')).toMatch(/Hedda: "You always pay fair/);
  });

  it('Hard bargainer: Given a consistently hard bargainer, Then they\'re treated predictably: no extra suspicion, and fewer rounds of haggling', () => {
    const p = predictability(hard(4), 'hf-tobin', ON);
    expect(p.terms).toBe('expected');
    expect(p.hedge).toBe(1);
    expect(p.suspicion).toBe(0);
    expect(p.haggleRounds).toBeLessThan(HAGGLE_ROUNDS);
    expect(p.haggleRounds).toBeLessThan(predictability(erratic(4), 'hf-tobin', ON).haggleRounds);
    expect(p.says).toMatch(/drive it hard, I know/);
    // No suspicion in their gates either (and no confidences: that's trust's, below).
    expect(recordGate(hard(4), 'hf-tobin', ON)).toBe(0);
  });

  it('Hard vs fair: Given a consistent hard bargainer and a consistent fair dealer, Then both get expected terms, and only the fair dealer gets credit and confidences', () => {
    const [h, f] = [hard(4), fair(4)];
    expect(predictability(h, 'hf-tobin', ON).terms).toBe('expected');
    expect(predictability(f, 'hf-tobin', ON).terms).toBe('expected');
    expect(trust(f, 'hf-tobin', ON)).toMatchObject({ credit: true, confide: CONFIDE });
    expect(trust(h, 'hf-tobin', ON)).toMatchObject({ credit: false, confide: 0 });
    expect(recordGate(f, 'hf-tobin', ON)).toBe(CONFIDE);
    // And an erratic one gets neither.
    expect(predictability(erratic(4), 'hf-tobin', ON).terms).toBe('hedged');
    expect(trust(erratic(4), 'hf-tobin', ON).credit).toBe(false);
    // In play: the same trust, the same prices for the hard bargainer, the regular's rate for the fair dealer.
    const r = ride(ON, inVillage('hollowford'));
    const plain = buyPrice('rawFood', 10, tradeTerms(r)!);
    expect(buyPrice('rawFood', 10, tradeTerms({ ...r, helps: h })!)).toBe(plain);
    expect(buyPrice('rawFood', 10, tradeTerms({ ...r, helps: f })!)).toBeLessThan(plain);
  });

  it('Switch off: Given the switch off, Then play equals today\'s', () => {
    expect(featureOn(TODAY, CONSISTENCY_FEATURE)).toBe(false);
    // Trades over days, a job left undone, a delivery that fails, and on to the next villages.
    const script = (features: Record<string, boolean>): RoadState => {
      let r = threeFairSales(features);
      r = act(r, 'buy:rawFood:1');
      r = { ...r, quests: { ...r.quests, 'hf-forge-wood': 'active', 'hf-hides-saltmere': 'active' }, stores: { ...r.stores, hides: 0 } };
      r = ride(features, inVillage('saltmere'), r);
      r = act(r, 'sell:rawFood:2');
      return ride(features, inVillage('kestrel-gate'), r);
    };
    const off = script(OFF), today = script(TODAY);
    expect({ ...off, features: undefined }).toEqual({ ...today, features: undefined });
    // Nothing beyond help recorded, and nothing read.
    expect(off.helps?.every(d => d.kind === 'sold' || d.kind === 'bought' || d.kind === 'task')).toBe(true);
    expect(recordGate(fair(4), 'hf-tobin', OFF)).toBe(0);
    expect(recordGate(erratic(4), 'hf-tobin', TODAY)).toBe(0);
    // On, the same script records the job left and the delivery failed, in order.
    expect(script(ON).helps?.filter(d => d.kind === 'expired' || d.kind === 'failed').map(d => [d.kind, d.quest])).toEqual([['expired', 'hf-forge-wood'], ['failed', 'hf-hides-saltmere']]);
  });
});

describe('predictability (#1663): how consistent the record is, whichever way it points', () => {
  it('knows nothing of someone with no record they know, and needs more than one deed to call it steady', () => {
    expect(predictability([], 'hf-tobin', ON)).toMatchObject({ score: 0, terms: 'unknown', hedge: 1, suspicion: 0, haggleRounds: HAGGLE_ROUNDS });
    expect(predictability(fair(1), 'hf-tobin', ON).terms).toBe('unknown');
    expect(predictability(fair(3), 'hf-tobin', ON).terms).toBe('expected');
  });

  it('is the same for a steady record either way: it reads consistency, not virtue', () => {
    expect(predictability(hard(5), 'hf-tobin', ON).score).toBeCloseTo(predictability(fair(5), 'hf-tobin', ON).score, 10);
    expect(predictability(times(5, 'expired'), 'hf-tobin', ON).score).toBeCloseTo(predictability(times(5, 'task'), 'hf-tobin', ON).score, 10);
  });

  it('is deterministic', () => {
    expect(predictability(erratic(7), 'sm-hedda', ON)).toEqual(predictability(erratic(7), 'sm-hedda', ON));
  });
});

describe('trust (#1663): how well the record dealt, adversarial deeds lowering it by themselves', () => {
  it('earns credit and confidences only from a record of dealing well, and not from one good deed', () => {
    expect(trust(fair(1), 'hf-tobin', ON).credit).toBe(false);
    expect(trust(fair(3), 'hf-tobin', ON).credit).toBe(true);
    expect(trust(times(3, 'task'), 'hf-tobin', ON).credit).toBe(true);
    expect(trust(hard(6), 'hf-tobin', ON).score).toBeLessThan(0);
    expect(trust(times(3, 'expired'), 'hf-tobin', ON).score).toBeLessThan(0);
  });

  it('counts a lie against the Warden worse than a hard bargain', () => {
    expect(trust(times(2, 'lied'), 'hf-tobin', ON).score).toBeLessThan(trust(hard(2), 'hf-tobin', ON).score);
  });

  it('reads nothing of predictability: two fair and two hard earn no credit, alternating or in blocks', () => {
    // Two fair and two hard, alternating or in blocks: the order changes predictability, and trust
    // only by the weights of recency, never by how consistent it looks.
    const alternating = erratic(4), blocks = [...fair(2), ...hard(2)];
    expect(predictability(alternating, 'hf-tobin', ON).score).not.toBeCloseTo(predictability(blocks, 'hf-tobin', ON).score, 2);
    expect(trust(alternating, 'hf-tobin', ON).credit).toBe(false);
    expect(trust(blocks, 'hf-tobin', ON).credit).toBe(false);
  });
});

describe('Memory: recent behaviour slowly outweighs an old pattern', () => {
  it('one slip after a long fair record isn\'t enough to call it erratic, and a long change turns it', () => {
    const slip = [...fair(6), deed('haggled')];
    expect(predictability(slip, 'hf-tobin', ON).terms).not.toBe('hedged');
    expect(trust(slip, 'hf-tobin', ON).score).toBeGreaterThan(0);
    // As many hard bargains as fair ones, but the hard ones are recent: it reads hard now.
    expect(trust([...fair(6), ...hard(6)], 'hf-tobin', ON).score).toBeLessThan(0);
    expect(trust([...hard(6), ...fair(6)], 'hf-tobin', ON).score).toBeGreaterThan(0);
  });
});

describe('Siding (#1663): with the same people, or switching', () => {
  it('reads a job for their rival as siding against them, and switching sides as erratic', () => {
    // Maren and Tobin are rivals. Jobs for Tobin are jobs against Maren.
    const forTobin = times(3, 'task', 'hf-tobin'), forMaren = times(3, 'task', 'hf-maren');
    expect(trust(forMaren, 'hf-maren', ON).credit).toBe(true);
    expect(trust(forTobin, 'hf-maren', ON).credit).toBe(false);
    // Switching between them: Maren never knows which side you're on.
    const switching = Array.from({ length: 6 }, (_, i) => deed('task', i % 2 ? 'hf-tobin' : 'hf-maren', i + 1));
    expect(predictability(switching, 'hf-maren', ON).score).toBeLessThan(predictability(forMaren, 'hf-maren', ON).score);
  });
});

describe('People say it: "Last time you promised the same."', () => {
  it('a quest giver who knows you left their friend\'s job undone says so', () => {
    // Orrin of Hollowford and Sabine of Kestrel Gate are friends.
    expect(brokenWordKnown([deed('expired', 'hf-orrin')], 'kg-sabine', ON)).toBe(true);
    expect(brokenWordKnown([deed('expired', 'hf-orrin'), deed('task', 'hf-orrin')], 'kg-sabine', ON)).toBe(false);
    let r = ride(ON, inVillage('kestrel-gate'));
    r = { ...r, helps: [deed('expired', 'hf-orrin')], trust: { ...r.trust, 'kg-sabine': 100 } };
    const next = act(r, 'accept:kg-hinges');
    expect(next.quests['kg-hinges']).toBe('active');
    expect(linesSince(r, next)).toContain('Sabine: "Last time you promised the same."');
    const off = act({ ...r, features: OFF }, 'accept:kg-hinges');
    expect(linesSince(r, off).join(' ')).not.toMatch(/Last time/);
  });
});

describe('The record through a save, and the switch', () => {
  it('keeps the new deed kinds through a save', () => {
    const road = { ...ride(ON, inVillage('hollowford')), helps: [deed('sold'), deed('expired', 'hf-orrin'), deed('failed'), deed('haggled'), deed('lied')] };
    const app = { ...makeWarden({ id: 'w-steady-save' }), stage: 'road', road } as AppState;
    expect(deserialize(serialize(app))?.road?.helps).toEqual(road.helps);
  });

  it('is an experimental rules feature, on in a new game, off for runs from before it', () => {
    expect(featureById(CONSISTENCY_FEATURE)).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1663 });
    expect(featureOn(undefined, CONSISTENCY_FEATURE)).toBe(false);
    expect(featureOn(ON, CONSISTENCY_FEATURE)).toBe(true);
  });

  it('records nothing without the deed list grudges-and-help keeps', () => {
    const noHelp = { ...ON, [HELP_FEATURE]: false };
    let r = ride(noHelp, inVillage('hollowford'));
    r = { ...r, quests: { ...r.quests, 'hf-forge-wood': 'active' } };
    expect(ride(noHelp, inVillage('saltmere'), r).helps).toBeUndefined();
  });
});
