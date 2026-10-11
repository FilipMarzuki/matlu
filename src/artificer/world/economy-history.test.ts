/**
 * #1599 — what the road villages live on, as their history and their region tell it. The story
 * engine scores the land at each road village's seat like any other, so left to itself it can
 * call Saltmere a lumber town or give Kestrel Gate a good year for the nets. The read layer
 * (local-history.ts, regional-facts.ts) reads each village's economy (economy.ts) instead, so a
 * hand-written village never contradicts its landscape, and the engine's stream is untouched.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { seedOf } from '../rng';
import { VILLAGE_ECONOMY, tradesOf } from '../economy';
import { runHistory } from './history';
import { remembered } from './remembered';
import { factsOfRegion } from './regional-facts';
import { localHistory } from './local-history';
import type { ProvinceHistory, RegionHistory, RegionLine } from './history-format';
import type { AnchorId } from './provinces';

const SEEDS = ['play-s1', 'play-abc', 'w-test-0', 'w-test-1', 'play-econ-1599'].map(seedOf);
const histories: ReturnType<typeof runHistory>[] = [];
// Told up front (each ~0.4 s), with room to spare on a busy machine.
beforeAll(() => { for (const seed of SEEDS) histories.push(runHistory(seed)); }, 120_000);

/** What each trade's generated news says, so a village that doesn't live on a trade never hears it. */
const TRADE_SIGNS: Readonly<Record<string, RegExp>> = {
  farming: /barley|\bmill\b/,
  fishing: /\bnets\b|fish went deep|fishery|smoke-house/,
  lumber: /\blogs?\b|lumber camp|saw-pit/,
  herding: /\bewes?\b|lambing|wool trade|stone folds/,
  mining: /\bseam\b|ore-carts|\bmine\b|ore-shed/,
  peat: /cuttings|drying barn/,
};
/** The trades a village doesn't live on, as signs it mustn't show. */
const foreign = (v: AnchorId) => Object.entries(TRADE_SIGNS).filter(([t]) => !tradesOf(VILLAGE_ECONOMY[v]).includes(t as never));

describe('A road village\'s history and region tell the economy written for it (#1599)', () => {
  it('tells each road village\'s trade in its region\'s facts as written, for every seed', () => {
    let seen = 0;
    for (const h of histories) for (const r of h.regions) for (const p of r.provinces) {
      const v = Object.entries({ Hollowford: 'hollowford', Saltmere: 'saltmere', 'Kestrel Gate': 'kestrel-gate' }).find(([n]) => n === p.name)?.[1] as AnchorId | undefined;
      if (!v) continue;
      seen++;
      const fact = factsOfRegion(r, h.year).find(f => f.id === `region:${r.id}:livelihood:${v}`);
      expect(fact?.text, `${v} seed ${h.seed}`).toBe(VILLAGE_ECONOMY[v].story);
    }
    // Every road village is in a generated region in every seed.
    expect(seen).toBe(histories.length * 3);
  });

  it('never gives a road village local news of a trade it doesn\'t live on, for every seed', () => {
    for (const h of histories) {
      for (const v of remembered(h).villages) {
        const village = v.village as AnchorId;
        for (const e of v.local.entries.filter(x => !x.crafted && ['trade', 'dispute', 'building'].includes(x.slot))) {
          for (const [trade, sign] of foreign(village)) expect(e.text, `${village} (${trade}), seed ${h.seed}: ${e.text}`).not.toMatch(sign);
        }
      }
    }
  });

  it('tells a venture the engine put at a road village that doesn\'t live on it as out beyond the village', () => {
    for (const h of histories) for (const r of h.regions) {
      for (const f of factsOfRegion(r, h.year)) {
        // "The lumber camp at Saltmere", where Saltmere lives on salt, never.
        expect(f.text, f.text).not.toMatch(/lumber camp at Saltmere|wool trade at Saltmere|\bmill at Saltmere|peat cuttings at Saltmere|fishery at Kestrel Gate|lumber camp at Kestrel Gate|\bmill at Kestrel Gate|fishery at Hollowford|\bmine at Hollowford|lumber camp at Hollowford/);
      }
    }
  });
});

// Plain-data histories that set the engine's state by hand, against the written economies.
const PRESENT = 151;
const province = (name: string, o: Partial<ProvinceHistory> = {}): ProvinceHistory =>
  ({ id: 'p3', name, culture: 'Waterstead', title: `Hundred of ${name}`, holder: null, house: null, lines: [], ...o });
function country(name: string, livelihood: string, venture: string, o: Partial<RegionHistory> = {}): RegionHistory {
  return {
    id: 'x-country', name: 'the X country', centre: { id: 'p1', name: 'Elsewhere' },
    provinces: [{ id: 'p1', name: 'Elsewhere', livelihood: 'trading', secondary: [], founding: 'crossing', wealth: 0.5 }, { id: 'p3', name, livelihood, secondary: [], founding: livelihood, wealth: 0.8 }],
    primary: livelihood, venture: { kind: venture, province: name, state: 'thriving', since: PRESENT - 3 },
    prosperity: 0.5, price: 1, harvest: 'fair', levy: 0, tax: 0.3, unsettled: 0, leadingHouse: null,
    lords: [], feuds: [], alliances: [], roads: [], lines: [], ...o,
  };
}
const ventureLine = (name: string, text: string): RegionLine => ({ year: PRESENT - 3, kind: 'VENTURE_THRIVES', category: 'economy', significance: 3, province: name, text });

describe('Given the engine says otherwise, a road village still lives on what\'s written for it (#1599)', () => {
  it('Kestrel Gate, which the engine made a fishing town with a thriving fishery, has its good year at the gate, not in the nets', () => {
    const c = country('Kestrel Gate', 'fishing', 'fishery');
    const trade = localHistory({ seed: 3, present: PRESENT, village: 'kestrel-gate', province: province('Kestrel Gate'), country: c }, {}).entries.find(e => e.slot === 'trade')!;
    expect(trade.text).not.toMatch(/nets|fish/);
    expect(trade.text).toMatch(/^It was a good year for Kestrel Gate: more wagons came through the gate/);
  });

  it('Saltmere, which the engine made a lumber town, has a good year raking salt; its own fishery is still its news', () => {
    const lumber = localHistory({ seed: 3, present: PRESENT, village: 'saltmere', province: province('Saltmere'), country: country('Saltmere', 'lumber', 'lumber camp') }, {}).entries.find(e => e.slot === 'trade')!;
    expect(lumber.text).toMatch(/the crust came in thick/);
    expect(lumber.text).not.toMatch(/lumber|logs/);
    // A fishery there fits: Saltmere lives on the fish it salts.
    const fishery = localHistory({ seed: 3, present: PRESENT, village: 'saltmere', province: province('Saltmere'), country: country('Saltmere', 'lumber', 'fishery') }, {}).entries.find(e => e.slot === 'trade')!;
    expect(fishery).toMatchObject({ ago: 3 });
    expect(fishery.text).toMatch(/fishery did well/);
  });

  it('tells the lumber camp the engine put in Saltmere\'s province as out beyond Saltmere, in its region\'s facts and news', () => {
    const c = country('Saltmere', 'lumber', 'lumber camp', { lines: [ventureLine('Saltmere', 'The lumber camp at Saltmere was thriving, in the X country.')] });
    const facts = factsOfRegion(c, PRESENT);
    expect(facts.find(f => f.id === 'region:x-country:livelihood:saltmere')?.text).toBe(VILLAGE_ECONOMY.saltmere.story);
    expect(facts.find(f => f.id === 'region:x-country:venture')?.text).toBe('The lumber camp out beyond Saltmere is thriving.');
    expect(facts.find(f => f.kind === 'economy' && f.year === PRESENT - 3)?.text).toMatch(/The lumber camp out beyond Saltmere was thriving/);
    // A generated place's venture stays at it.
    const elsewhere = country('Ravenford', 'lumber', 'lumber camp', { lines: [ventureLine('Ravenford', 'The lumber camp at Ravenford was thriving.')] });
    expect(factsOfRegion(elsewhere, PRESENT).find(f => f.id === 'region:x-country:venture')?.text).toBe('The lumber camp at Ravenford is thriving.');
    expect(factsOfRegion(elsewhere, PRESENT).find(f => f.id === 'region:x-country:livelihood:ravenford')?.text).toBe('Ravenford grew up around the woods, and still lives on timber.');
  });
});
