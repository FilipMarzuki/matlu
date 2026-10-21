/**
 * #1627 — are the village economies' prices right? A deterministic check of what a careful player
 * earns carrying goods down the road, with the `village-economies` switch on and off.
 *
 * The owner's answer on the multipliers (×0.75 plentiful, ×1.25 scarce, ×1.1 a market town's
 * markup) was "make a best guess", so this is the guess, checked:
 *
 * - **A careful carrier.** Start at Hollowford with 20 marks (about what selling a winter's spare
 *   stone and wood, or two jobs, brings). At each village, sell what you carried, then spend every
 *   mark on the one good that sells for most at the next village. At strangers' prices that's
 *   hides from Hollowford to Saltmere (×1.33 on what they cost) and salt rations from Saltmere to
 *   the Gate (×1.33), so 20 marks come to 35 at the Gate. At friends' prices (trust 50) it's ×1.63
 *   a leg and 20 come to 53. Without the switch it was ×1.2 a leg (a trader's ×1.5 for a wanted
 *   kind), 20 to 29.
 * - **Against the jobs.** The road's jobs pay 72 marks besides goods. Carrying 20 marks the
 *   whole road earns 15 more at strangers' prices (33 at friends'), so trading pays and a careful
 *   player feels the villages differ, but it doesn't outearn the work. The carry can't snowball
 *   either: the road only runs one way, so there are two legs to carry on. The multipliers stay.
 * - **What changed.** The check found a money pump at every stall: a trader who sells a good and
 *   wants its kind paid ×1.5 for it against a ×1.25 markup, so buying a heap and selling it
 *   straight back made marks every hour (and a friend's rate, the Gate's keen markup, or a high
 *   Charisma made it worse). That was true before the switch too; runs without the switch keep it,
 *   so they replay the same. With the switch, a trader pays at most ×0.8 of their own price for a
 *   good they sell (economy.ts `BUY_BACK`).
 *
 * The issue is `world` (exempt from ATDD); these are plain tests of its "Done when".
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { createRoad, endRoadDay, tradeTerms, ROUTE, type RoadState } from './road';
import { buyPrice, isGood, sellPrice, TRADER_STOCK, type Good, type Terms } from './trade';
import { QUESTS } from './quests';
import { ANCHORS } from './world/provinces';
import { BUY_BACK, MARKET_MARKUP, PLENTIFUL, SCARCE } from './economy';

/** A hale thaw survivor on the road, its world's switches as given. */
function survived(features?: Record<string, boolean>): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-prices', name: 'Vega', stats: { ...DEFAULT_STATS } });
  const vitals = createVitals({ condition: 90 });
  return {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, firewood: 10, rations: 4 },
    outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, ...(features ? { features } : {}) } },
  };
}
function reachVillage(s: RoadState, id: string): RoadState {
  const leg = ROUTE.findIndex(l => l.kind === 'village' && l.id === id);
  while (s.leg < leg && !s.outcome) s = endRoadDay(s);
  return s;
}
const ON = { 'village-economies': true };
const OFF = { 'village-economies': false };

type Stall = Terms & { trader: string; sells: readonly string[] };
/** The village trader's terms, at a stranger's trust (0) or a friend's (60). */
function stall(id: string, features: Record<string, boolean>, trust = 0, priceFactor = 1): Stall {
  const s = reachVillage(createRoad(survived(features)), id);
  if (s.outcome) throw new Error(`never reached ${id}`);
  return { ...tradeTerms(s)!, trust, priceFactor };
}

/**
 * The careful carrier: sell everything carried at each stop, then put every mark into the good
 * that returns most at the next stop (real lot prices, rounded as the game rounds them). Returns
 * the marks at the last village, and each leg's choice.
 */
function carry(stalls: readonly Stall[], marks: number): { marks: number; legs: string[] } {
  let held: { good: Good; qty: number } | null = null;
  const legs: string[] = [];
  for (let i = 0; i < stalls.length; i++) {
    const here = stalls[i];
    if (held) { marks += sellPrice(held.good, 'sound', held.qty, here); held = null; }
    const next = stalls[i + 1];
    if (!next) break;
    let best: { good: Good; qty: number; gain: number } | null = null;
    for (const g of here.sells.filter(isGood)) {
      let qty = 0;
      while (buyPrice(g, qty + 1, here) <= marks) qty++;
      if (!qty) continue;
      const gain = sellPrice(g, 'sound', qty, next) - buyPrice(g, qty, here);
      if (gain > 0 && (!best || gain > best.gain)) best = { good: g, qty, gain };
    }
    if (best) { marks -= buyPrice(best.good, best.qty, here); held = { good: best.good, qty: best.qty }; legs.push(`${best.qty} ${best.good}`); } else legs.push('-');
  }
  return { marks, legs };
}

describe('Prices checked against a careful player carrying goods down the road (#1627)', () => {
  const road = (features: Record<string, boolean>, trust = 0) => ANCHORS.map(id => stall(id, features, trust));

  it('keeps the multipliers', () => {
    expect([PLENTIFUL, SCARCE, MARKET_MARKUP, BUY_BACK]).toEqual([0.75, 1.25, 1.1, 0.8]);
  });

  it('pays a careful carrier about a third a leg at strangers\' prices: 20 marks come to 35 at the Gate', () => {
    const on = carry(road(ON), 20);
    expect(on.legs).toEqual(['7 hides', '14 rations']);
    expect(on.marks).toBe(35);
    // At a friend's prices, each leg pays more (×1.63), and 20 come to 53.
    expect(carry(road(ON, 60), 20).marks).toBe(53);
    // Without the switch only a trader's wanted kind made a carry pay (×1.2 a leg): 20 came to 29.
    expect(carry(road(OFF), 20).marks).toBe(29);
  });

  it('earns less carrying than the road\'s jobs pay', () => {
    const jobs = QUESTS.reduce((n, q) => n + q.reward.marks, 0);
    expect(jobs).toBe(72);
    const earned = carry(road(ON), 20).marks - 20;
    expect(earned).toBeGreaterThan(0);
    expect(earned).toBeLessThan(jobs / 4);
  });

  it('never pays more for a heap than the same stall sells it for, with the switch on, at any trust or Charisma', () => {
    // Charisma 4 to 18 (priceFactor 1.12 to 0.84), a stranger and a friend, lots of 1 to 20.
    for (const id of ANCHORS) for (const trust of [0, 60]) for (let cha = 4; cha <= 18; cha++) {
      const t = stall(id, ON, trust, 1 - 0.02 * (cha - 10));
      for (const g of t.sells.filter(isGood)) for (let qty = 1; qty <= 20; qty++) {
        expect(sellPrice(g, 'sound', qty, t), `${id} ${g}×${qty} trust ${trust} CHA ${cha}`).toBeLessThanOrEqual(buyPrice(g, qty, t));
      }
    }
  });

  it('caps the caravan merchant on the wagon too, with the switch on', () => {
    const wagon = (features: Record<string, boolean>) => tradeTerms(createRoad(survived(features)))!;
    expect(wagon(ON).trader).toBe('cv-runa');
    // Runa sells materials and wants raw goods: ×1.5 against her ×1.25 markup without the cap.
    expect(TRADER_STOCK['cv-runa']).toMatchObject({ wants: expect.arrayContaining(['raw']), sells: expect.arrayContaining(['materials']) });
    expect(sellPrice('materials', 'sound', 10, wagon(ON))).toBe(10); // 12.5 × 0.8
    expect(buyPrice('materials', 10, wagon(ON))).toBe(13);
    expect(wagon(ON).local).toBeUndefined(); // no village market on the wagon
  });

  it('leaves prices as they were with the switch off and in runs from before it, pump and all, so they replay the same', () => {
    for (const features of [OFF, {}]) {
      const ford = stall('hollowford', features);
      expect(ford.buyBack).toBeUndefined();
      // Four hides: 15 to buy from Tobin, 18 to sell back to him (he wants leather).
      expect(buyPrice('hides', 4, ford)).toBe(15);
      expect(sellPrice('hides', 'sound', 4, ford)).toBe(18);
    }
  });
});
