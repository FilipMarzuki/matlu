/**
 * #1599 — each road village lives on something different: its economy (economy.ts), and what it
 * does in play with the `village-economies` switch: prices and stock at its market, a job from
 * its trade, and what the arrival tells of it. Off, and in runs from before the switch, the road
 * plays exactly as it did.
 *
 * The issue is `world` (exempt from ATDD), so these check its "Done when" as plain tests.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { createRoad, endRoadDay, questsHere, runRoadAction, tradeTerms, ROUTE, type RoadState } from './road';
import { KIND_OF, TRADER_STOCK, buyPrice, sellPrice, type Kind } from './trade';
import { QUESTS } from './quests';
import { VILLAGES } from './villages';
import { FEATURES } from './features';
import { ANCHORS } from './world/provinces';
import {
  VILLAGE_ECONOMY, arrivalLines, economyLine, economyOfProvince, localMarket, tradesOf, ventureFits, PLENTIFUL, SCARCE,
} from './economy';

/** A hale Region 1 run at the thaw with marks to spend, its world's switches as given. */
function survived(features?: Record<string, boolean>): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-econ', name: 'Vega', stats: { ...DEFAULT_STATS } });
  const vitals = createVitals({ condition: 90 });
  return {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, firewood: 10, stone: 10, hides: 4, rations: 4 },
    outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, ...(features ? { features } : {}) } },
  };
}
/** Ride the road to the village with this id. */
function reachVillage(s: RoadState, id: string): RoadState {
  const leg = ROUTE.findIndex(l => l.kind === 'village' && l.id === id);
  while (s.leg < leg && !s.outcome) s = endRoadDay(s);
  return s;
}
const ON = { 'village-economies': true };
const OFF = { 'village-economies': false };
const at = (id: string, features?: Record<string, boolean>) => reachVillage(createRoad(survived(features)), id);

describe('Each road village has a stated economy (#1599)', () => {
  it('gives every road village a dominant trade, secondary trades and a founding, each village living on something different', () => {
    for (const id of ANCHORS) {
      const e = VILLAGE_ECONOMY[id];
      expect(e.crafted, id).toBe(true);
      expect(e.secondary.length, id).toBeGreaterThanOrEqual(1);
      expect(e.secondary, id).not.toContain(e.dominant);
      expect(e.story, id).toMatch(new RegExp(`^${VILLAGES[id].name} grew up around `));
      expect(e.scene.length, id).toBeGreaterThan(40);
    }
    // The owner's ask: a player feels the difference between them by what they live on.
    expect(new Set(ANCHORS.map(id => VILLAGE_ECONOMY[id].dominant)).size).toBe(ANCHORS.length);
    expect(new Set(ANCHORS.map(id => VILLAGE_ECONOMY[id].plentiful.join())).size).toBe(ANCHORS.length);
  });

  it('agrees with what villages.ts and its people say: the founding can differ from today\'s trade', () => {
    // Hollowford: the ford came first ("The ford was here before the village"), barley and sheep now.
    expect(VILLAGE_ECONOMY.hollowford).toMatchObject({ dominant: 'farming', founding: 'crossing' });
    expect(VILLAGES.hollowford.landscape).toMatch(/barley/);
    // Saltmere: "The book says the mere was sweet water once": it grew up fishing, and lives on salt.
    expect(VILLAGE_ECONOMY.saltmere).toMatchObject({ dominant: 'salt', founding: 'fishing' });
    // Kestrel Gate: the wall across the pass; "The toll pays for the wall"; "iron off the passes".
    expect(VILLAGE_ECONOMY['kestrel-gate']).toMatchObject({ dominant: 'tolls', founding: 'pass' });
    expect(tradesOf(VILLAGE_ECONOMY['kestrel-gate'])).toEqual(expect.arrayContaining(['trading', 'mining']));
    for (const id of ANCHORS) {
      const e = VILLAGE_ECONOMY[id];
      const trader = VILLAGES[id].people.find(p => p.role === 'trader')!;
      // What the village makes, its trader already stocks.
      for (const g of e.plentiful) expect(TRADER_STOCK[trader.id].sells, `${id} ${g}`).toContain(g);
      // What it lacks, someone there wants: the trader's wants, or a villager's need for an item of that kind.
      const wanted = new Set<Kind>([...TRADER_STOCK[trader.id].wants, ...VILLAGES[id].people.flatMap(p => (p.need.kind === 'item' ? [KIND_OF[p.need.item]] : []))]);
      expect(e.scarce.some(k => wanted.has(k)), id).toBe(true);
    }
  });

  it('gives a generated place the engine\'s economy, and a road village its own whatever the engine says', () => {
    expect(economyOfProvince({ name: 'Ravenford', livelihood: 'lumber', secondary: ['herding'], founding: 'crossing' }))
      .toEqual({ dominant: 'lumber', secondary: ['herding'], founding: 'crossing', crafted: false });
    expect(economyLine('Ravenford', economyOfProvince({ name: 'Ravenford', livelihood: 'lumber', secondary: ['herding'], founding: 'crossing' })))
      .toBe('Ravenford grew up around the ford; today it lives on timber, and on its flocks besides.');
    // The engine made Saltmere a lumber town: it's still the salt village.
    expect(economyOfProvince({ name: 'Saltmere', livelihood: 'lumber', secondary: [], founding: 'lumber' })).toBe(VILLAGE_ECONOMY.saltmere);
    // A venture fits a place only if the place lives on its trade.
    expect(ventureFits(VILLAGE_ECONOMY.saltmere, 'fishery')).toBe(true);
    expect(ventureFits(VILLAGE_ECONOMY.saltmere, 'lumber camp')).toBe(false);
    expect(ventureFits(VILLAGE_ECONOMY['kestrel-gate'], 'mine')).toBe(true);
  });
});

describe('With village economies on, each village\'s economy changes trade (#1599)', () => {
  it('registers the switch as an experimental rule feature, on in new games, off for runs from before it', () => {
    expect(FEATURES.find(f => f.id === 'village-economies')).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1599 });
  });

  it('makes what the village makes cheap to buy and worth less to sell, and what it lacks dear and worth more', () => {
    const on = tradeTerms(at('hollowford', ON))!;
    const off = tradeTerms(at('hollowford', OFF))!;
    expect(on.local).toEqual(localMarket('hollowford'));
    // Hides are Hollowford's own (sheepfolds): 4 hides, base 3, buy ×1.25: off 15, on 15 × 0.75 = 11.
    expect(buyPrice('hides', 4, off)).toBe(15);
    expect(buyPrice('hides', 4, on)).toBe(Math.round(4 * 3 * 1.25 * PLENTIFUL));
    expect(sellPrice('hides', 'sound', 4, on)).toBeLessThan(sellPrice('hides', 'sound', 4, off));
    // Tools are scarce there ("Iron I can't help you with; that's Gate work"): they sell for more.
    expect(sellPrice('stone-knife', 'sound', 1, on)).toBe(Math.round(4 * 1.5 * SCARCE));
    expect(sellPrice('stone-knife', 'sound', 1, off)).toBe(6);
  });

  it('prices the same good differently village to village, so carrying goods down the road pays', () => {
    const price = (id: string) => buyPrice('rations', 1, tradeTerms(at(id, ON))!);
    // Saltmere salts them (cheap); Kestrel Gate, a pass with no fields, lacks food (dear).
    expect(price('saltmere')).toBeLessThan(price('kestrel-gate'));
    const sell = (id: string) => sellPrice('rations', 'sound', 4, tradeTerms(at(id, ON))!);
    expect(sell('kestrel-gate')).toBeGreaterThan(sell('saltmere'));
  });

  it('gives a market town keener prices on what isn\'t local: Kestrel Gate lives on its toll and its market', () => {
    const gate = tradeTerms(at('kestrel-gate', ON))!;
    expect(gate.local?.market).toBe(true);
    expect(tradeTerms(at('hollowford', ON))!.local?.market).toBe(false);
    // Materials are neither plentiful nor scarce at the Gate: 10 × 1.1 = 11, not 10 × 1.25 = 13.
    expect(buyPrice('materials', 10, gate)).toBe(11);
    expect(buyPrice('materials', 10, tradeTerms(at('kestrel-gate', OFF))!)).toBe(13);
  });

  it('stocks what the village makes, and buying and selling run at those prices', () => {
    for (const id of ANCHORS) {
      const t = tradeTerms(at(id, ON))!;
      for (const g of VILLAGE_ECONOMY[id].plentiful) expect(t.sells, `${id} ${g}`).toContain(g);
    }
    const s = { ...at('saltmere', ON), marks: 20 };
    const after = runRoadAction(s, 'buy:rations:4');
    expect(after.marks).toBe(20 - buyPrice('rations', 4, tradeTerms(s)!));
    expect(after.marks).toBe(20 - Math.round(4 * 2 * 1.25 * PLENTIFUL));
  });

  it('leaves trade exactly as it was with the switch off and in runs from before it', () => {
    for (const features of [OFF, undefined]) {
      for (const id of ANCHORS) {
        const t = tradeTerms(at(id, features))!;
        expect(t.local, `${id} ${JSON.stringify(features)}`).toBeUndefined();
        expect(t.sells).toEqual(TRADER_STOCK[t.trader].sells);
      }
    }
  });
});

describe('With village economies on, each village offers a job from its trade, and its arrival tells what it lives on (#1599)', () => {
  const trusted = (s: RoadState): RoadState => ({ ...s, trust: Object.fromEntries(Object.keys(s.trust).map(k => [k, 60])) });

  it('offers each village one job from its trade, only with the switch on', () => {
    const gated = QUESTS.filter(q => q.feature === 'village-economies');
    expect(new Set(gated.map(q => q.village))).toEqual(new Set(ANCHORS));
    // One quest per giver still (the road view shows one at a time).
    expect(new Set(QUESTS.map(q => q.giver)).size).toBe(QUESTS.length);
    for (const id of ANCHORS) {
      const job = gated.find(q => q.village === id)!;
      expect(questsHere(trusted(at(id, ON))).map(q => q.id), id).toContain(job.id);
      expect(questsHere(trusted(at(id, OFF))).map(q => q.id), id).not.toContain(job.id);
      expect(questsHere(trusted(at(id))).map(q => q.id), id).not.toContain(job.id);
    }
  });

  it('refuses a trade job with the switch off, and pays it out with it on', () => {
    expect(runRoadAction(trusted(at('saltmere', OFF)), 'accept:sm-smoke-racks').log.at(-1)?.text).toMatch(/no one here is offering/);
    let s = runRoadAction(trusted(at('saltmere', ON)), 'accept:sm-smoke-racks');
    expect(s.quests['sm-smoke-racks']).toBe('active');
    const before = s;
    s = runRoadAction(s, 'complete:sm-smoke-racks');
    expect(s.quests['sm-smoke-racks']).toBe('done');
    expect(s.stores.firewood).toBe(before.stores.firewood - 6);
    expect(s.stores.rations).toBe(before.stores.rations + 3);
  });

  it('tells each village\'s scene, trade and market on arrival, only with the switch on', () => {
    for (const id of ANCHORS) {
      const lines = arrivalLines(id)!;
      expect(lines[0]).toBe(VILLAGE_ECONOMY[id].scene);
      expect(lines[1]).toBe(VILLAGE_ECONOMY[id].story);
      expect(lines[2]).toMatch(/cheap here; .* dear, and sell well\.$/);
      expect(at(id, ON).log.some(l => l.text.includes(VILLAGE_ECONOMY[id].scene)), id).toBe(true);
      expect(at(id, OFF).log.some(l => l.text.includes(VILLAGE_ECONOMY[id].scene)), id).toBe(false);
    }
    expect(arrivalLines('hollowford')![2]).toBe('Fresh food and hides are cheap here; tools and firewood are dear, and sell well.');
  });
});
