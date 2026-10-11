/**
 * Acceptance tests for rumours, confidence and lies (#1580, knowledge slice G;
 * docs/knowledge-model-design.md §7): people who are honestly wrong, people who lie for a reason,
 * rumours that drift as they travel, the player's journal of who said what, and reading a lie.
 * Behind the `rumours-and-lies` rule switch.
 *
 * The issue's "done when" scenarios come first (Given/When/Then), one block each, then what holds
 * them up: the data's shape and sources, the switch, and runs from before it replaying unchanged.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_FACTS, FACTS, factsFor, resolve } from './facts';
import { featureById, featureOn, ruleFeatures } from './features';
import { ask } from './asks';
import { claimEntries, driftOf, liesFor, motiveProblem, rumourFacts, RUMOUR_FACTS, PROPOSITIONS, carriesFar, TOLD_ON, type RumourEntry } from './claims';
import { claimsHeard, journalOf, lieReadChance, readsAsLie, respondedOn, LIE_EDGE } from './journal';
import { VILLAGES, TRAVELLERS, personById, type Person } from './villages';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, type RoadState } from './road';
import { observeRoad } from '../artificer-ai/observe';
import type { Reader } from './rapport';
import type { Stats } from './stats';

const root = join(__dirname, '..', '..');
const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
// #1580's rules as they shipped: with `rumour-drift` on too (#1589, rumour-drift.test.ts) the
// rumours bend by who tells them, and these pins would move.
const ON = { ...ruleFeatures(), 'rumour-drift': false };
const OFF = { ...ON, 'rumours-and-lies': false };
const FACTS_ON = factsFor(ON);
const LIES_ON = liesFor(ON);

/** A Warden out of the Reach, in a world with `features`, riding on until `until` says stop. */
function ride(features: Record<string, boolean> | undefined, until: (r: RoadState) => boolean): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-claims', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, ...(features ? { features } : {}) } },
  };
  let r = createRoad(from);
  for (let i = 0; i < 30 && !until(r); i++) r = endRoadDay(r);
  return r;
}

/** Ask `pid` about `topic` on the road with `trust`: the state after. */
function askOnRoad(r: RoadState, pid: string, topic: string, trust: number): RoadState {
  const [kind, id] = topic.split(':');
  return runRoadAction({ ...r, focus: { kind, id } as RoadState['focus'], trust: { ...r.trust, [pid]: trust } }, `ask:${pid}`);
}

const STATS_10: Stats = { str: 10, con: 10, agi: 10, int: 10, wil: 10, cha: 10 };
const reader = (over: Partial<Reader> = {}): Reader => ({ id: 'w-reader', stats: STATS_10, clarity: 80, ragged: false, ...over });

describe('#1580 acceptance', () => {
  describe('Claims carry a source and a confidence, and a rumour drifts by a seeded rule', () => {
    const wolves = claimEntries().rumours.find(r => r.id === 'pass-wolves')!;

    it('Given Runa saw the wolves herself, When the rumour passes to Pim and on to Liv, Then the number grows and confidence falls at each hop, and the drift is pinned', () => {
      const hops = driftOf(wolves);
      expect(hops.map(h => h.holder)).toEqual(['kg-runa', 'cv-pim', 'sm-liv']);
      // The one who saw it says what was there, and is sure.
      expect(hops[0]).toMatchObject({ n: 3, where: 'the high pass above the Gate', source: 'saw', truth: 'true' });
      // Told on, it's hearsay: the number never shrinks, and grows at every hop.
      for (let i = 1; i < hops.length; i++) {
        expect(hops[i].n).toBeGreaterThan(hops[i - 1].n);
        expect(hops[i].truth).toBe('rumour');
        expect(hops[i].confidence).toBeCloseTo(hops[i - 1].confidence * TOLD_ON, 6);
      }
      expect(hops.map(h => h.source)).toEqual(['saw', 'told', 'common']);
      // Pinned: the seeded rule gives exactly this, every run.
      expect(hops.map(h => [h.n, h.where])).toEqual(PINNED_WOLVES);
      expect(hops[1].text).toMatch(/^I heard it from Runa: /);
      expect(hops[2].text).toMatch(/^Everyone's saying it: /);
    });

    it('Given the same rumour, When it drifts twice, Then it drifts the same way (seeded, not random)', () => {
      expect(driftOf(wolves)).toEqual(driftOf(wolves));
      const fish = claimEntries().rumours.find(r => r.id === 'mere-fish')!;
      expect(driftOf(fish).map(h => [h.n, h.where])).toEqual(PINNED_FISH);
      expect(driftOf(fish)[2].text).toBe('Everyone\'s saying it: twelve fish floating belly-up at the still north end of the mere in a single morning. Whatever is in the water there, don\'t drink it.');
    });

    it('Given a traveller carries a rumour on, When it drifts, Then it grows at least as much as when a villager does: weak ties carry news furthest from the truth', () => {
      expect(carriesFar('cv-pim')).toBe(true);
      expect(carriesFar('hf-tobin')).toBe(true);
      expect(carriesFar('sm-liv')).toBe(false);
      const test = (path: string[]): RumourEntry => ({ ...wolves, id: 'test-rumour', path, truth: { n: 10, where: wolves.places[0] } });
      const byTraveller = driftOf(test(['kg-runa', 'cv-pim']))[1];
      const byVillager = driftOf(test(['kg-runa', 'kg-veit']))[1];
      expect(byTraveller.n - 10).toBeGreaterThanOrEqual(byVillager.n - 10);
    });

    it('Given a rumour in the run, When someone on its path is asked, Then they answer with their hop, hedged by where they got it', () => {
      const liv = resolve('sm-liv', 'place:north-road', 100, { facts: FACTS_ON });
      expect(liv).toMatchObject({ kind: 'told', hedge: 'Everyone says', fact: { truth: 'rumour', claimSource: 'common' } });
      const runa = resolve('kg-runa', 'place:north-road', 100, { facts: FACTS_ON });
      expect(runa).toMatchObject({ kind: 'told', hedge: 'I saw it myself', fact: { truth: 'true' } });
    });
  });

  describe('At least one person in each village is wrong about something, and one lies, each with a reason in the data', () => {
    it.each(Object.keys(VILLAGES))('Given %s, When its people are asked everything they know, Then one of them is wrong and one lies', village => {
      const people = VILLAGES[village].people.map(p => p.id);
      const wrong = people.filter(pid => FACTS_ON.some(f => f.scope.kind === 'person' && f.scope.id === pid && f.truth !== 'true'));
      expect(wrong.length, `${village}: nobody is wrong`).toBeGreaterThan(0);
      const liars = people.filter(pid => (LIES_ON[pid] ?? []).length > 0);
      expect(liars.length, `${village}: nobody lies`).toBeGreaterThan(0);
    });

    it('Given every lie, When its motive is checked against the data, Then it holds: an organisation they keep secrets for, a friend, a grudge, a stake', () => {
      for (const l of claimEntries().lies) expect(motiveProblem(l), l.id).toBeNull();
      // Someone bound to tell never lies: the Pandor tell anyone who asks.
      expect(LIES_ON['sm-anselm'] ?? []).toEqual([]);
    });

    it('Given every lie, When the road is asked about it, Then someone else (or the liar later) says otherwise: every lie is catchable', () => {
      for (const l of claimEntries().lies) {
        const p = PROPOSITIONS[l.proposition];
        expect(p, `${l.id}: no proposition ${l.proposition}`).toBeDefined();
        const honest = p.facts.map(id => FACTS_ON.find(f => f.id === id)).filter(f => f?.truth === 'true');
        expect(honest.length, `${l.id}: nothing true to catch it with`).toBeGreaterThan(0);
      }
    });
  });

  describe('The journal of who said what: corroboration, contradiction, and checking for yourself', () => {
    it('Given Tobin lied about the Compact and Maren told the truth, When the journal is read, Then the two clash', () => {
      const heard = claimsHeard({ 'hf-tobin': ['claimed:group:compact'], 'hf-maren': ['group:compact'] }, FACTS_ON, LIES_ON);
      expect(heard.find(c => c.person === 'hf-tobin')).toMatchObject({ truth: 'lie', hedge: 'I saw it myself', proposition: 'compact-is-real' });
      const entry = journalOf(heard, []).find(e => e.proposition === 'compact-is-real')!;
      expect(entry.status).toBe('contradicted');
    });

    it('Given Maren and Anselm both say the Compact is real, from their own knowledge, When the journal is read, Then it’s corroborated and firmer than either alone', () => {
      const one = journalOf(claimsHeard({ 'hf-maren': ['group:compact'] }, FACTS_ON, LIES_ON), []).find(e => e.proposition === 'compact-is-real')!;
      const two = journalOf(claimsHeard({ 'hf-maren': ['group:compact'], 'sm-anselm': ['group:compact'] }, FACTS_ON, LIES_ON), []).find(e => e.proposition === 'compact-is-real')!;
      expect(one.status).toBe('heard');
      expect(two.status).toBe('corroborated');
      expect(two.firmness).toBeGreaterThan(one.firmness);
    });

    it('Given two people who heard a rumour from the same person, When the journal is read, Then they don’t count twice', () => {
      const heard = claimsHeard({ 'cv-pim': ['place:north-road'], 'sm-liv': ['place:north-road'] }, FACTS_ON, LIES_ON);
      expect(new Set(heard.map(c => c.origin))).toEqual(new Set(['kg-runa']));
      const entry = journalOf(heard, []).find(e => e.proposition === 'pass-wolves')!;
      // They tell different versions (it drifted between them), so they clash rather than agree.
      expect(entry.status).toBe('contradicted');
      // And two tellings of the same source are no firmer than its firmest one.
      expect(entry.firmness).toBeCloseTo(Math.max(...heard.map(c => c.confidence)), 6);
    });

    it('Given Liv’s wolves, When the Warden reaches Kestrel Gate and sees the pass, Then the claim is settled, and the journal says who was right', () => {
      const heard = claimsHeard({ 'sm-liv': ['place:north-road'] }, FACTS_ON, LIES_ON);
      expect(journalOf(heard, ['hollowford', 'saltmere']).find(e => e.proposition === 'pass-wolves')!.status).toBe('heard');
      const checked = journalOf(heard, ['hollowford', 'saltmere', 'kestrel-gate']).find(e => e.proposition === 'pass-wolves')!;
      expect(checked.status).toBe('checked');
      expect(checked.seen).toMatch(/three grey wolves/);
      expect(checked.claims[0].right).toBe(false);
    });
  });

  describe('Reading a lie uses rapport, Charisma and Clarity, and can be wrong both ways', () => {
    it('Given a stranger, When the Warden reads them, Then it’s little better than chance (about 54%)', () => {
      expect(lieReadChance(reader(), 0, false)).toBeCloseTo(0.5 + LIE_EDGE, 6);
    });

    it('Given more rapport, more Charisma, a clearer head or evidence in hand, When reading, Then the read is truer; tired, it’s worse', () => {
      const base = lieReadChance(reader(), 20, false);
      expect(lieReadChance(reader(), 80, false)).toBeGreaterThan(base);
      expect(lieReadChance(reader({ stats: { ...STATS_10, cha: 16 } }), 20, false)).toBeGreaterThan(base);
      expect(lieReadChance(reader({ clarity: 10 }), 20, false)).toBeLessThan(base);
      expect(lieReadChance(reader(), 20, true)).toBeGreaterThan(base);
      expect(lieReadChance(reader({ stats: { ...STATS_10, cha: 20 } }), 100, true)).toBeLessThanOrEqual(0.95);
    });

    it('Given many readers, When they read one liar and one honest person, Then some miss the lie and some suspect the honest one', () => {
      const ids = Array.from({ length: 200 }, (_, i) => `w-${i}`);
      const missed = ids.filter(id => !readsAsLie(reader({ id }), 'hf-tobin', 'group:compact', true, 0, false)).length;
      const suspected = ids.filter(id => readsAsLie(reader({ id }), 'hf-maren', 'group:compact', false, 0, false)).length;
      expect(missed).toBeGreaterThan(40);
      expect(suspected).toBeGreaterThan(40);
      // Seeded: the same Warden reads the same person the same way.
      expect(readsAsLie(reader({ id: 'w-7' }), 'hf-tobin', 'group:compact', true, 0, false)).toBe(readsAsLie(reader({ id: 'w-7' }), 'hf-tobin', 'group:compact', true, 0, false));
    });
  });

  describe('On the road, and the AI view gets the same claims and hedges a person does', () => {
    let atFord: RoadState, offFord: RoadState;
    beforeAll(() => {
      atFord = ride(ON, r => villageOf(r) === 'hollowford');
      offFord = ride(OFF, r => villageOf(r) === 'hollowford');
    }, 60_000);

    it('Given Tobin keeps the Compact’s business, When asked about it below his trust, Then he lies, it reads like any answer, and the journal keeps it', () => {
      const r = askOnRoad(atFord, 'hf-tobin', 'group:compact', 20);
      const line = r.log.at(-1)!.text;
      expect(line).toContain(`Tobin: "${LIES_ON['hf-tobin'][0].text}"`);
      expect(r.asked?.['hf-tobin']).toEqual(['claimed:group:compact']);
      // Asked again, he sticks to it, and no time passes.
      const again = runRoadAction(r, 'ask:hf-tobin');
      expect(again.hoursToday).toBe(r.hoursToday);
      // The AI reads the same words, hedge and all.
      const seen = observeRoad(r);
      expect(seen).toContain('WHO SAID WHAT');
      expect(seen).toContain('Tobin (I saw it myself)');
    });

    it('Given the lie, When Maren then tells the truth, Then the clash is flagged in the journal', () => {
      const lied = askOnRoad(atFord, 'hf-tobin', 'group:compact', 20);
      const r = askOnRoad(lied, 'hf-maren', 'group:compact', 30);
      expect(r.log.some(l => /doesn't square with what Tobin told you/.test(l.text))).toBe(true);
      expect(observeRoad(r)).toMatch(/The Compact.*CONTRADICTED/);
    });

    it('Given the lie, When Tobin later trusts the Warden enough, Then he tells the truth, and the journal says he told otherwise before', () => {
      const lied = askOnRoad(atFord, 'hf-tobin', 'group:compact', 20);
      const r = askOnRoad(lied, 'hf-tobin', 'group:compact', 50);
      expect(r.log.some(l => l.text.includes(`Tobin: "${FACTS.find(f => f.id === 'answer:hf-tobin:group:compact')!.text}"`))).toBe(true);
      expect(r.log.some(l => /isn't what Tobin told you before/.test(l.text))).toBe(true);
      expect(r.asked?.['hf-tobin']).toEqual(['claimed:group:compact', 'group:compact']);
    });

    it('Given Liv told the Warden about wolves, When the caravan reaches Kestrel Gate, Then the Warden sees for themself, and the journal marks her wrong', () => {
      let r = ride(ON, x => villageOf(x) === 'saltmere');
      r = askOnRoad(r, 'sm-liv', 'place:north-road', 30);
      expect(r.log.at(-1)!.text).toContain('five grey wolves on the Gate road below the wall');
      for (let i = 0; i < 10 && villageOf(r) !== 'kestrel-gate'; i++) r = endRoadDay(r);
      const wolves = claimEntries().rumours.find(x => x.id === 'pass-wolves')!;
      expect(r.log.some(l => l.text === wolves.check!.text)).toBe(true);
      expect(observeRoad(r)).toMatch(/Wolves on the north road — CHECKED for yourself.*Liv \(Everyone says\).*✗ not so/);
    }, 60_000);

    it('Given a free question to Tobin about the Compact, When the knowledge model answers it, Then he lies there too, and the road keeps it the same way', () => {
      const r = runRoadAction({ ...atFord, trust: { ...atFord.trust, 'hf-tobin': 20 } }, 'question:hf-tobin:group:compact');
      expect(r.log.at(-1)!.text).toContain(LIES_ON['hf-tobin'][0].text);
      expect(r.asked?.['hf-tobin']).toEqual(['claimed:group:compact']);
      // He responded: the play API and the web game record the question as answered (review of #1649).
      expect(respondedOn(r.asked?.['hf-tobin'], 'group:compact')).toBe(true);
    });

    it('Given what a person has answered, When a reader asks whether they responded on a topic, Then a lie told instead counts, and nothing else does', () => {
      expect(respondedOn(['group:compact'], 'group:compact')).toBe(true);
      expect(respondedOn(['claimed:group:compact'], 'group:compact')).toBe(true);
      expect(respondedOn(['claimed:group:compact'], 'place:north-road')).toBe(false);
      expect(respondedOn([], 'group:compact')).toBe(false);
      expect(respondedOn(undefined, 'group:compact')).toBe(false);
    });

    it('Given the switch off, When Tobin is asked below his trust, Then he says "not yet", as before', () => {
      const r = askOnRoad(offFord, 'hf-tobin', 'group:compact', 20);
      expect(r.log.at(-1)!.text).toMatch(/Ask me again when I know you better/);
      expect(r.asked?.['hf-tobin'] ?? []).toEqual([]);
    });
  });
});

/** The pass-wolves rumour's drift, pinned: [number, place] at each hop. A change to the drift rule moves these. */
const PINNED_WOLVES: [number, string][] = [[3, 'the high pass above the Gate'], [4, 'the Gate road below the wall'], [5, 'the Gate road below the wall']];
/** The mere-fish rumour's, likewise: Runa the route-singer, a weak tie, doubles it. */
const PINNED_FISH: [number, string][] = [[4, 'the still north end of the mere'], [8, 'the still north end of the mere'], [12, 'the still north end of the mere']];

describe('The claims data', () => {
  it('names the canon each entry rests on, and the line is really there', () => {
    const { propositions, lies, rumours } = claimEntries();
    for (const e of [...propositions, ...lies, ...rumours]) {
      const [file, label] = e.source.split(' › ');
      expect(existsSync(join(root, file)), `${e.id}: no file ${file}`).toBe(true);
      expect(readFileSync(join(root, file), 'utf8').includes(label), `${e.id}: no "${label}" in ${file}`).toBe(true);
      expect(e.placeholder, `${e.id}: hand-written, for the owner`).toBe(true);
    }
  });

  it('every proposition’s facts exist, and no fact speaks to two', () => {
    const seen = new Set<string>();
    for (const p of claimEntries().propositions) for (const id of p.facts) {
      expect(ALL_FACTS.some(f => f.id === id), `${p.id}: no fact ${id}`).toBe(true);
      expect(seen.has(id), `${id} is on two propositions`).toBe(false);
      seen.add(id);
    }
  });

  it('every lie and rumour is about people on the road and topics that exist', () => {
    const ids = new Set(EVERYONE.map(p => p.id));
    for (const l of claimEntries().lies) expect(ids.has(l.person), l.id).toBe(true);
    for (const r of claimEntries().rumours) {
      for (const pid of r.path) expect(ids.has(pid), `${r.id}: ${pid}`).toBe(true);
      expect(r.places).toContain(r.truth.where);
      if (r.check) expect(VILLAGES[r.check.visit], r.id).toBeDefined();
    }
    for (const p of claimEntries().propositions) if (p.check) expect(VILLAGES[p.check.visit], p.id).toBeDefined();
  });

  it('rumour facts are person-scope, one per hop, and the one who saw it holds the truth', () => {
    expect(RUMOUR_FACTS).toEqual(rumourFacts());
    // The rumours that came with this issue; those that came with a later switch are tested with it.
    for (const r of claimEntries().rumours.filter(x => !x.feature)) {
      const mine = RUMOUR_FACTS.filter(f => f.id.startsWith(`rumour:${r.id}:`));
      expect(mine.map(f => f.scope.id)).toEqual(r.path);
      expect(mine[0].truth).toBe('true');
    }
  });

  it('a lie needs a person to have heard it from: the person who says it is someone on the road', () => {
    for (const p of EVERYONE) for (const l of LIES_ON[p.id] ?? []) expect(personById(p.id) ?? TRAVELLERS.find(t => t.id === p.id), l.about).toBeDefined();
  });
});

describe('The rumours-and-lies switch', () => {
  it('is a rules feature, new with this issue: runs from before it play without lies or rumours', () => {
    expect(featureById('rumours-and-lies')).toMatchObject({ kind: 'rules', stage: 'experimental', default: true, absent: false, issue: 1580 });
    expect(featureOn(undefined, 'rumours-and-lies')).toBe(false);
    expect(liesFor(undefined)).toEqual({});
    expect(liesFor(OFF)).toEqual({});
  });

  it('adds the rumours’ facts to a run that has it, and to every fact any game can hold', () => {
    for (const f of RUMOUR_FACTS) {
      expect(FACTS_ON).toContain(f);
      expect(factsFor(OFF)).not.toContain(f);
      // A new game holds each of them too, in the words they bend to by default (#1589).
      expect(ALL_FACTS.some(a => a.id === f.id), f.id).toBe(true);
    }
    expect(factsFor(undefined)).toBe(FACTS);
  });

  it('with the switch off, an ask reads as before: a liar says "not yet"', () => {
    const tobin = personById('hf-tobin')!;
    const off = ask(tobin, 'group:compact', 'the Compact', 20, [], { facts: factsFor(OFF), lies: liesFor(OFF) });
    expect(off.kind).toBe('not-yet');
    const on = ask(tobin, 'group:compact', 'the Compact', 20, [], { facts: FACTS_ON, lies: LIES_ON });
    expect(on.kind).toBe('lied');
  });
});
