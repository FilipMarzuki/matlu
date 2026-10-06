/**
 * Acceptance tests for #1247 — Region 1.5 trade: marks, item values, and
 * grade setting the price. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { createRoad, endRoadDay, runRoadAction, villageOf, ROUTE, type RoadState } from './road';
import { BASE_VALUE, TRADER_STOCK, buyPrice, sellPrice, traderAmong } from './trade';
import { peopleOf } from './villages';
import type { Grade } from './crafting';

/** A hale Region 1 run at the thaw, carrying `tools`, with the given CHA. */
function survived(tools: Region1State['tools'] = [], cha = 10): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-vega', name: 'Vega', stats: { ...DEFAULT_STATS, cha } });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, tools, stores: { ...s.stores, rawFood: 10, water: 10 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
}
/** Ride the road to the village with this id. */
function reachVillage(s: RoadState, id: string): RoadState {
  const leg = ROUTE.findIndex(l => l.kind === 'village' && l.id === id);
  while (s.leg < leg && !s.outcome) s = endRoadDay(s);
  return s;
}
const coldGear = (grade: Grade) => [{ item: 'cold-gear', grade }];
const lastLine = (s: RoadState): string => s.log.at(-1)?.text ?? '';

describe('Trade (#1247)', () => {
  // 1. A sound cold gear (base 6) to a trader who doesn't want cloth: +6 marks, and it leaves tools.
  it('sells a sound tool at its base value', () => {
    expect(BASE_VALUE['cold-gear']).toBe(6);
    expect(TRADER_STOCK['hf-tobin'].wants).not.toContain('cloth');
    const s = reachVillage(createRoad(survived(coldGear('sound'))), 'hollowford');
    const after = runRoadAction(s, 'sell:cold-gear');
    expect(after.marks).toBe(s.marks + 6);
    expect(after.tools.some(t => t.item === 'cold-gear')).toBe(false);
    expect(after.hoursToday).toBe(s.hoursToday + 1);
  });

  // 2. The same gear at fine grade, to a trader who wants cloth: round(6 × 1.6 × 1.5) = 14.
  it('pays more for grade and for what the trader wants', () => {
    expect(TRADER_STOCK['sm-hedda'].wants).toContain('cloth');
    const s = reachVillage(createRoad(survived(coldGear('fine'))), 'saltmere');
    const after = runRoadAction(s, 'sell:cold-gear');
    expect(after.marks).toBe(s.marks + 14);
  });

  // 3. Trust 50+: buying 3 food (base 1, ×1.25) costs round(3 × 1.25 × 0.9) = 3, and food rises by 3.
  it('gives a friend’s discount at trust 50 or more', () => {
    let s = reachVillage(createRoad(survived()), 'hollowford');
    s = { ...s, marks: 10, trust: { ...s.trust, 'hf-tobin': 50 } };
    const after = runRoadAction(s, 'buy:rawFood:3');
    expect(after.marks).toBe(10 - 3);
    expect(after.stores.rawFood).toBe(s.stores.rawFood + 3);
  });

  // 4. Too few marks: rejected with the price, no hours spent.
  it('rejects a purchase you can’t afford, naming the price', () => {
    const s = { ...reachVillage(createRoad(survived()), 'hollowford'), marks: 2 };
    const after = runRoadAction(s, 'buy:rawFood:3');
    expect(lastLine(after)).toContain('4 marks');
    expect(after.marks).toBe(2);
    expect(after.stores.rawFood).toBe(s.stores.rawFood);
    expect(after.hoursToday).toBe(s.hoursToday);
  });

  // 5. No trader: "No one here is trading" (on the wagon between villages, and in any village without one).
  it('rejects trade where no one is trading', () => {
    const wagon = createRoad(survived(coldGear('sound')));
    expect(villageOf(wagon)).toBeNull();
    for (const id of ['sell:cold-gear', 'buy:rawFood'] as const) {
      const after = runRoadAction({ ...wagon, marks: 10 }, id);
      expect(lastLine(after)).toContain('No one here is trading');
      expect(after.hoursToday).toBe(wagon.hoursToday);
    }
    // A village of only non-traders has no one to trade with.
    expect(traderAmong(peopleOf('hollowford').filter(p => p.role !== 'trader'))).toBeNull();
  });

  // 6. A completed sale: the trader's trust rises by 1.
  it('earns the trader’s trust with a sale', () => {
    const s = reachVillage(createRoad(survived(coldGear('sound'))), 'hollowford');
    const after = runRoadAction(s, 'sell:cold-gear');
    expect(after.trust['hf-tobin']).toBe(s.trust['hf-tobin'] + 1);
  });

  // Charisma (#1255): CHA 15 (factor 0.9) buys 10 food at round(10 × 1.25 × 0.9) = 11.
  it('lets Charisma deal fairer', () => {
    let s = reachVillage(createRoad(survived([], 15)), 'hollowford');
    s = { ...s, marks: 20, trust: { ...s.trust, 'hf-tobin': 30 } };
    const after = runRoadAction(s, 'buy:rawFood:10');
    expect(after.marks).toBe(20 - 11);
    // Selling pays ÷ factor: a sound cold gear to a non-wanting trader at CHA 15 fetches round(6 / 0.9) = 7.
    expect(sellPrice('cold-gear', 'sound', 1, { wants: [], trust: 0, priceFactor: 0.9 })).toBe(7);
    expect(buyPrice('rawFood', 10, { wants: [], trust: 0, priceFactor: 0.9 })).toBe(11);
  });

  it('sells your worst copy unless a grade is named', () => {
    const s = reachVillage(createRoad(survived([{ item: 'cold-gear', grade: 'fine' }, { item: 'cold-gear', grade: 'crude' }])), 'hollowford');
    const after = runRoadAction(s, 'sell:cold-gear');
    expect(after.tools.map(t => t.grade)).toEqual(['fine']);
    const named = runRoadAction(s, 'sell:cold-gear:fine');
    expect(named.tools.map(t => t.grade)).toEqual(['crude']);
  });
});
