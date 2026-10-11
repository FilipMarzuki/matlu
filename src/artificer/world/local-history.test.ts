/**
 * #1613 — there is always recent history: every road village's last LOCAL_YEARS of local
 * politics and events (local-history.ts), read as facts for the knowledge model.
 *
 * Written first, one test per Given/When/Then scenario of the issue's "Done when":
 * 1. every road village has local politics and events within living memory, for every seed;
 * 2. hand-written village history wins where it exists, and generation fills the rest;
 * 3. facts carry truth, reach and sensitivity from how public the thing was and the teller's
 *    stake in it, over several seeds.
 * Plus what the issue asks of the generation: drawn from what the engine knows, deterministic,
 * on its own random stream.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { seedOf } from '../rng';
import { knows, answer, type Knower } from '../knowledge';
import { runHistory } from './history';
import { remembered, sensitivityOf } from './remembered';
import { LIVING_MEMORY, type ProvinceHistory, type RegionHistory, type RegionLine } from './history-format';
import {
  CRAFTED_LOCAL, LOCAL_SLOTS, LOCAL_YEARS, POLITICS, localHistory, localSensitivity, stakeIn,
  type CraftedLocal, type LocalInput,
} from './local-history';

const SEEDS = ['play-s1', 'play-abc', 'w-test-0', 'w-test-1', 'w-test-2', 'play-local-1613'].map(seedOf);

// One told history per seed, shared by the tests that read real histories (each costs ~0.4 s).
const histories = new Map<number, ReturnType<typeof runHistory>>();
const historyOf = (seed: number) => { if (!histories.has(seed)) histories.set(seed, runHistory(seed)); return histories.get(seed)!; };
// Told up front, with room to spare: the full suite runs many files at once, and six histories
// in one test can pass vitest's 5 s default on a busy machine.
beforeAll(() => { for (const seed of SEEDS) historyOf(seed); }, 120_000);

// A plain-data village to tell, for the scenarios that set the engine's state by hand.
const PRESENT = 151;
function province(o: Partial<ProvinceHistory> = {}): ProvinceHistory {
  return { id: 'p3', name: 'Saltmere', culture: 'Waterstead', title: 'Hundred of Saltmere', holder: 'Ivar of Hedlund', house: 'Hedlund', lines: [], ...o };
}
function country(o: Partial<RegionHistory> = {}): RegionHistory {
  return {
    id: 'saltmere-country', name: 'the Saltmere country', centre: { id: 'p3', name: 'Saltmere' },
    provinces: [{ id: 'p3', name: 'Saltmere', livelihood: 'fishing', secondary: [], founding: 'fishing', wealth: 0.5 }],
    primary: 'fishing', venture: { kind: 'fishery', province: 'Elsewhere', state: 'steady', since: 20 },
    prosperity: 0.5, price: 1, harvest: 'fair', levy: 0, tax: 0.35, unsettled: 0, leadingHouse: 'Hedlund',
    lords: [], feuds: [], alliances: [], roads: [], lines: [], ...o,
  };
}
const line = (kind: string, ago: number, o: Partial<RegionLine> = {}): RegionLine =>
  ({ year: PRESENT - ago, kind, category: 'event', significance: 4, province: 'Saltmere', text: kind, ...o });
const input = (o: Partial<LocalInput> = {}): LocalInput =>
  ({ seed: 7, present: PRESENT, village: 'saltmere', province: province(), country: country(), ...o });
// No hand-written history: everything generated.
const NONE: CraftedLocal = {};

describe('Given any seed, when the road villages are remembered, then each has recent local history (#1613, done-when 1)', () => {
  it('gives every road village local politics and local events within living memory, for every seed', () => {
    for (const seed of SEEDS) {
      const h = historyOf(seed);
      const r = remembered(h);
      for (const v of r.villages) {
        const at = `${v.village}, seed ${seed}`;
        const { entries, facts } = v.local;
        expect(entries.some(e => e.category === 'politics'), at).toBe(true);
        expect(entries.some(e => e.category === 'event'), at).toBe(true);
        // Who leads the village is always known: there's always a leader entry.
        expect(entries.filter(e => e.slot === 'leader'), at).toHaveLength(1);
        for (const e of entries) {
          expect(e.ago, at).toBeGreaterThanOrEqual(0);
          expect(e.ago, at).toBeLessThanOrEqual(LOCAL_YEARS);
          expect(e.year, at).toBe(h.year - e.ago);
          expect(e.text.length, at).toBeGreaterThan(10);
          // Generated text never leaves a placeholder unfilled.
          expect(e.text, at).not.toMatch(/undefined|NaN|\$\{/);
        }
        // Oldest first, one entry per slot.
        expect(entries.map(e => e.year)).toEqual([...entries.map(e => e.year)].sort((a, b) => a - b));
        expect(new Set(entries.map(e => e.slot)).size).toBe(entries.length);
        // Each entry is told as a village fact the village knows as true: it's within living memory.
        for (const e of entries) {
          const f = facts.find(x => x.id === `local:${v.village}:${e.slot}`)!;
          expect(f, at).toBeDefined();
          expect(f.scope).toEqual({ kind: 'village', id: v.village });
          expect(f.truth).toBe('true');
          expect(f.about).toContain(`place:${v.village}`);
          expect(f.text).toContain(`in year ${e.year}`);
        }
      }
      const ids = r.villages.flatMap(v => v.local.facts.map(f => f.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('is deterministic, reads a kept (JSON) history the same, and leaves the told history as it was', () => {
    const h = historyOf(SEEDS[0]);
    const before = JSON.stringify(h);
    const a = remembered(h);
    expect(remembered(JSON.parse(before))).toEqual(a);
    expect(remembered(h)).toEqual(a);
    // Reading never changes the history: the local layer lives on its own stream, outside the engine.
    expect(JSON.stringify(h)).toBe(before);
    // Different seeds tell different villages.
    const b = remembered(historyOf(SEEDS[1]));
    expect(b.villages.map(v => v.local.entries.map(e => e.text))).not.toEqual(a.villages.map(v => v.local.entries.map(e => e.text)));
  });
});

describe('Given hand-written history for a village, when its local history is told, then the crafted wins and generation fills the rest (#1613, done-when 2)', () => {
  it('uses the crafted entry for its slot, and generates every other always-told slot', () => {
    const crafted: CraftedLocal = { saltmere: [{ slot: 'leader', ago: 5, text: 'The well-council chose Anselm to keep the book.', publicity: 'public', people: ['sm-anselm'] }] };
    const { entries } = localHistory(input(), crafted);
    const leader = entries.filter(e => e.slot === 'leader');
    expect(leader).toHaveLength(1);
    expect(leader[0]).toMatchObject({ crafted: true, text: 'The well-council chose Anselm to keep the book.', ago: 5, year: PRESENT - 5, people: ['sm-anselm'] });
    for (const slot of ['dispute', 'trade', 'mishap'] as const) expect(entries.find(e => e.slot === slot)?.crafted, slot).toBe(false);
  });

  it('does not reroll the other slots when a slot is crafted: each slot has its own stream', () => {
    const generated = localHistory(input(), NONE).entries;
    const crafted = localHistory(input(), { saltmere: [{ slot: 'mishap', ago: 2, text: 'The mere froze to the bottom.', publicity: 'public' }] }).entries;
    const bySlot = (es: typeof generated) => Object.fromEntries(es.filter(e => e.slot !== 'mishap').map(e => [e.slot, e.text]));
    expect(bySlot(crafted)).toEqual(bySlot(generated));
  });

  it('keeps the road villages\' own hand-written history in every seed', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      for (const v of remembered(historyOf(seed)).villages) {
        for (const c of CRAFTED_LOCAL[v.village] ?? []) {
          const e = v.local.entries.find(x => x.slot === c.slot)!;
          expect(e).toMatchObject({ crafted: true, text: c.text, ago: c.ago });
        }
      }
    }
    // Every road village has some hand-written history, and none of it is older than the local layer reaches.
    for (const id of ['hollowford', 'saltmere', 'kestrel-gate'] as const) {
      expect(CRAFTED_LOCAL[id]?.length, id).toBeGreaterThan(0);
      for (const c of CRAFTED_LOCAL[id]!) {
        expect(c.ago).toBeLessThanOrEqual(LOCAL_YEARS);
        expect(LOCAL_SLOTS).toContain(c.slot);
      }
    }
  });
});

describe('Given how public a thing was and who tells it, then its facts carry that sensitivity, not one blanket rule (#1613, done-when 3)', () => {
  it('grades by publicity and stake: a fire open to all, a quarrel guarded by those in it, a scandal private', () => {
    expect(localSensitivity('public', false)).toBe('public');
    expect(localSensitivity('public', true)).toBe('public');
    // A quarrel the whole village saw at the moot: told openly by neighbours, guarded by its parties.
    expect(localSensitivity('open', false)).toBe('public');
    expect(localSensitivity('open', true)).toBe('guarded');
    // A family's own trouble, and a scandal: the same steps as remembered.ts uses for a house's affairs.
    expect(localSensitivity('house', false)).toBe(sensitivityOf('house', false));
    expect(localSensitivity('house', true)).toBe(sensitivityOf('house', true));
    expect(localSensitivity('family', false)).toBe('private');
    expect(localSensitivity('family', true)).toBe('secret');
  });

  it('knows who has a stake: a party to it, by family or by name', () => {
    const e = { families: ['Brekke'], people: ['hf-tobin'] };
    expect(stakeIn(e, { family: 'Brekke' })).toBe(true);
    expect(stakeIn(e, { id: 'hf-tobin' })).toBe(true);
    expect(stakeIn(e, { id: 'hf-maren', family: 'Strand' })).toBe(false);
    expect(stakeIn(e, {})).toBe(false);
  });

  it('gives a party on the road their own, more guarded telling, and the neighbours the open one', () => {
    const crafted: CraftedLocal = { saltmere: [{ slot: 'dispute', ago: 3, text: 'Hedda and the Strands fell out over a net.', publicity: 'open', people: ['sm-hedda'], families: ['Strand'] }] };
    const { facts } = localHistory(input(), crafted);
    const village = facts.find(f => f.id === 'local:saltmere:dispute')!;
    const hers = facts.find(f => f.id === 'local:saltmere:dispute:sm-hedda')!;
    expect(village).toMatchObject({ scope: { kind: 'village', id: 'saltmere' }, sensitivity: 'public', depth: 1 });
    expect(village.about).toEqual(['place:saltmere', 'person:sm-hedda']);
    expect(hers).toMatchObject({ scope: { kind: 'person', id: 'sm-hedda' }, sensitivity: 'guarded', text: village.text });
    // Asked about the village, Hedda answers from her own telling (the more specific scope), and you need her trust;
    // a neighbour tells the open version to anyone.
    const hedda: Knower = { id: 'sm-hedda', name: 'Hedda', home: 'saltmere', region: 'north-road', people: 'Deepwalkers', culture: 'harborfolk', role: 'trader', orgs: {} };
    const liv: Knower = { ...hedda, id: 'sm-liv', name: 'Liv', role: 'healer' };
    const only = [village, hers];
    expect(answer(hedda, 'place:saltmere', 0, only, {})).toMatchObject({ kind: 'not-yet', fact: { id: hers.id }, trust: 25 });
    expect(answer(hedda, 'place:saltmere', 25, only, {})).toMatchObject({ kind: 'told', fact: { id: hers.id } });
    expect(answer(liv, 'place:saltmere', 0, only, {})).toMatchObject({ kind: 'told', fact: { id: village.id } });
    // A public thing needs no second telling: a party tells it as openly as anyone.
    const open = localHistory(input(), { saltmere: [{ slot: 'dispute', ago: 3, text: 'Bodil owes Hedda three barrels.', publicity: 'public', people: ['sm-hedda', 'cv-bodil'] }] }).facts;
    expect(open.filter(f => f.id.startsWith('local:saltmere:dispute'))).toHaveLength(1);
  });

  it('makes what touches the ruling house one step more guarded for the whole village, as remembered.ts does', () => {
    // Heavy dues: the moot goes to the lord's steward, which the village is careful how it tells.
    const { entries, facts } = localHistory(input({ country: country({ tax: 0.6 }) }), NONE);
    const council = entries.find(e => e.slot === 'council')!;
    expect(council).toMatchObject({ lord: true, publicity: 'open' });
    expect(council.text).toMatch(/dues/);
    expect(facts.find(f => f.id === 'local:saltmere:council')!.sensitivity).toBe('guarded');
    // With no lord holding the place, nobody has that stake.
    const vacant = localHistory(input({ province: province({ holder: null, house: null }), country: country({ tax: 0.6 }) }), NONE).facts;
    expect(vacant.find(f => f.id === 'local:saltmere:council')!.sensitivity).toBe('public');
  });

  it('sets reach by how public it was: everyone knows a fire, most a family\'s trouble, only the best-placed a scandal', () => {
    for (const seed of SEEDS) {
      const h = historyOf(seed);
      for (const v of remembered(h).villages) {
        const house = h.provinces.find(p => p.id === v.province.id)!.house;
        for (const e of v.local.entries) {
          const f = v.local.facts.find(x => x.id === `local:${v.village}:${e.slot}`)!;
          expect(f.depth).toBe({ public: 1, open: 1, house: 2, family: 3 }[e.publicity]);
          const stake = e.lord && !!house;
          expect(f.sensitivity).toBe(localSensitivity(e.publicity, stake));
          expect(f.truth).toBe(e.ago <= LIVING_MEMORY ? 'true' : 'rumour');
          expect(POLITICS.has(e.slot)).toBe(e.category === 'politics');
        }
        // An elder (village depth 3) knows all of the village's local history; a newcomer only the open part.
        const elder: Knower = { id: 'x', name: 'X', home: v.village, region: 'north-road', people: 'Markfolk', culture: 'fieldborn', role: 'elder', orgs: {}, reach: { village: 3 } };
        const newcomer: Knower = { ...elder, reach: {} };
        const villageFacts = v.local.facts.filter(f => f.scope.kind === 'village');
        expect(villageFacts.every(f => knows(elder, f))).toBe(true);
        expect(villageFacts.filter(f => knows(newcomer, f)).every(f => f.depth === 1)).toBe(true);
      }
    }
  });
});

describe('Given the engine\'s state, when a village\'s history is generated, then it is drawn from it (#1613)', () => {
  it('dates the village\'s hard year by its country\'s told hard winter, famine or plague', () => {
    const winter = localHistory(input({ country: country({ lines: [line('HARD_WINTER', 6)] }) }), NONE).entries.find(e => e.slot === 'mishap')!;
    expect(winter).toMatchObject({ ago: 6, year: PRESENT - 6 });
    expect(winter.text).toMatch(/winter/i);
    const famine = localHistory(input({ country: country({ lines: [line('HARD_WINTER', 6), line('FAMINE', 9, { province: null })] }) }), NONE).entries.find(e => e.slot === 'mishap')!;
    expect(famine).toMatchObject({ ago: 9 });
    expect(famine.text).toMatch(/hungry|seed/i);
    // Another province's winter, or one older than the local layer reaches, isn't this village's.
    const elsewhere = localHistory(input({ country: country({ lines: [line('HARD_WINTER', 6, { province: 'Kestrel Gate' }), line('HARD_WINTER', LOCAL_YEARS + 3)] }) }), NONE).entries.find(e => e.slot === 'mishap')!;
    expect(elsewhere.text).not.toMatch(/wolf winter/i);
  });

  it('tells a good or bad year for the village\'s own trade, from its wealth and its venture', () => {
    // With no economy written for it (`{}`), the village lives on what the engine says: fishing.
    const rich = localHistory(input({ country: country({ provinces: [{ id: 'p3', name: 'Saltmere', livelihood: 'fishing', secondary: [], founding: 'fishing', wealth: 0.8 }] }) }), NONE, {}).entries.find(e => e.slot === 'trade')!;
    expect(rich.text).toMatch(/^It was a good year for Saltmere: the nets/);
    const poor = localHistory(input({ country: country({ provinces: [{ id: 'p3', name: 'Saltmere', livelihood: 'fishing', secondary: [], founding: 'fishing', wealth: 0.2 }] }) }), NONE, {}).entries.find(e => e.slot === 'trade')!;
    expect(poor.text).toMatch(/^It was a bad year for Saltmere: the fish/);
    // The country's venture, when it's here and changed within the local years, is the village's trade news.
    const venture = localHistory(input({ country: country({ venture: { kind: 'fishery', province: 'Saltmere', state: 'failing', since: PRESENT - 4 } }) }), NONE).entries.find(e => e.slot === 'trade')!;
    expect(venture).toMatchObject({ ago: 4 });
    expect(venture.text).toMatch(/fishery/);
  });

  it('sends the village\'s young men to the lord\'s levy when its country\'s men are away at war', () => {
    const council = localHistory(input({ country: country({ levy: 0.3 }) }), NONE).entries.find(e => e.slot === 'council')!;
    expect(council.text).toMatch(/levy/);
    expect(council.lord).toBe(true);
  });

  it('names its people from the village\'s own culture, never a road person\'s name or a lord\'s house', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const h = historyOf(seed);
      const houses = new Set(h.provinces.map(p => p.house).filter(Boolean) as string[]);
      for (const v of remembered(h).villages) {
        for (const e of v.local.entries.filter(x => !x.crafted)) {
          for (const f of e.families) expect(houses.has(f), `${f} in ${v.village}`).toBe(false);
          // No road person's given name in generated text (it would read as them).
          for (const name of ['Maren', 'Tobin', 'Isa', 'Orrin', 'Hedda', 'Anselm', 'Yrsa', 'Gunnar', 'Liv', 'Veit', 'Sabine', 'Arvid', 'Runa', 'Bodil', 'Pim', 'Ottilia']) {
            expect(e.text, `${v.village}: ${e.text}`).not.toMatch(new RegExp(`\\b${name}\\b`));
          }
        }
      }
    }
  });
});
