/**
 * Acceptance tests for ties between the road's people (#1588, knowledge slice D,
 * docs/knowledge-model-design.md §5): a small graph of who's kin, friend, rival or in debt to
 * whom, each side's opinion of the other as a claim with a truth, and word that travels along it.
 * Behind the `ties` rule switch.
 *
 * The issue's three scenarios come first (Given/When/Then), then what holds them up: the graph's
 * shape and sources, the switch, and that runs from before it replay unchanged.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_FACTS, FACTS, claimsTold, factsFor, resolve } from './facts';
import { featureOn, ruleFeatures } from './features';
import { ask, TELLS } from './asks';
import { QUESTS } from './quests';
import { TIE_FACTS, TIE_WORD, elsewhereEntries, helpedBy, tieEntries, tieWord, tiesOf } from './ties';
import { VILLAGES, TRAVELLERS, personById, type Person } from './villages';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, villageOf, type RoadState } from './road';

const root = join(__dirname, '..', '..');
const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
const ON = ruleFeatures();
const OFF = { ...ON, ties: false };

/** A Warden out of the Reach with `deeds`, in a world with `features`, riding on until `until` says stop. */
function ride(features: Record<string, boolean> | undefined, deeds: string[], until: (r: RoadState) => boolean, tweak?: (r: RoadState) => RoadState): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-ties', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, deeds, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, ...(features ? { features } : {}) } },
  };
  let r = createRoad(from);
  let tweaked = false;
  for (let i = 0; i < 30 && !until(r); i++) {
    // Once in the first village, `tweak` stands in for what the Warden did there (a quest done).
    if (tweak && !tweaked && villageOf(r) === 'hollowford') { r = tweak(r); tweaked = true; }
    r = endRoadDay(r);
  }
  return r;
}

describe('#1588 acceptance', () => {
  it('Given a tie from Orrin to Sabine (friend, opinion high), When Orrin is asked about Sabine, Then he answers from a personal fact about her, at its sensitivity', () => {
    const tie = tiesOf('hf-orrin').find(t => t.other === 'kg-sabine');
    expect(tie?.kind).toBe('friend');
    expect(tie!.opinion).toBeGreaterThanOrEqual(50);
    const facts = factsFor(ON);
    const told = resolve('hf-orrin', 'person:kg-sabine', 100, { facts });
    expect(told?.kind).toBe('told');
    if (told?.kind !== 'told') return;
    expect(told.fact.scope).toEqual({ kind: 'person', id: 'hf-orrin' });
    expect(told.fact.id).toMatch(/^tie:/);
    // At its sensitivity: held below the gate, told at it.
    const gate = { public: 0, guarded: 25, private: 50, secret: 75 }[told.fact.sensitivity];
    expect(gate).toBeGreaterThan(0);
    expect(resolve('hf-orrin', 'person:kg-sabine', gate - 1, { facts })?.kind).toBe('not-yet');
    expect(resolve('hf-orrin', 'person:kg-sabine', gate, { facts })?.kind).toBe('told');
    // And as an ask on the road says it, in his words.
    const r = ask(personById('hf-orrin')!, 'person:kg-sabine', 'Sabine', gate, [], { facts });
    expect(r.kind).toBe('told');
    expect(r.kind === 'told' && r.answer.text).toBe(told.fact.text);
  });

  it('Given Maren\'s opinion of Tobin is a false claim, When she\'s asked about him, Then she says it with confidence, and the game records it as false', () => {
    const facts = factsFor(ON);
    const r = resolve('hf-maren', 'person:hf-tobin', 100, { facts });
    expect(r?.kind).toBe('told');
    if (r?.kind !== 'told') return;
    expect(r.fact.truth).toBe('false');
    // With confidence: her own word, not "I heard".
    expect(r.hedge).toBe('I saw it myself');
    // The ask carries the claim's truth, which the player never sees.
    const a = ask(personById('hf-maren')!, 'person:hf-tobin', 'Tobin', 100, [], { facts });
    expect(a.kind === 'told' && a.truth).toBe('false');
    // Recorded: what's been told (`asked`) is enough to say which claims heard were false.
    expect(claimsTold({ 'hf-maren': ['person:hf-tobin'] }, facts)).toEqual([{ person: 'hf-maren', topic: 'person:hf-tobin', fact: r.fact.id, truth: 'false' }]);
    // And it can be caught: someone else on the road says otherwise, and is right.
    const hedda = resolve('sm-hedda', 'person:hf-tobin', 100, { facts });
    expect(hedda?.kind === 'told' && hedda.fact.truth).toBe('true');
  });

  describe('Given the Warden helped someone\'s friend, When they first meet, Then their starting rapport is higher than without the tie', () => {
    // A road person helped: Orrin's quest done in Hollowford; his friend Sabine is met at Kestrel Gate.
    const forge = (r: RoadState): RoadState => ({ ...r, quests: { ...r.quests, 'hf-forge-wood': 'done' } });
    const atGate = (r: RoadState) => villageOf(r) === 'kestrel-gate';
    // Someone elsewhere helped: the old scholar under the rock, Anselm's friend, met at Saltmere.
    const atMere = (r: RoadState) => villageOf(r) === 'saltmere';
    let gateOn: RoadState, gateOff: RoadState, gateNone: RoadState, mereOn: RoadState, mereOff: RoadState, mereNone: RoadState;
    beforeAll(() => {
      gateOn = ride(ON, [], atGate, forge);
      gateOff = ride(OFF, [], atGate, forge);
      gateNone = ride(ON, [], atGate);
      mereOn = ride(ON, ['warmed-the-scholar'], atMere);
      mereOff = ride(OFF, ['warmed-the-scholar'], atMere);
      mereNone = ride(ON, [], atMere);
    }, 60_000);

    it('a friend on the road: Sabine starts warmer when Orrin was helped, by his word', () => {
      expect(atGate(gateOn) && atGate(gateOff) && atGate(gateNone)).toBe(true);
      expect(gateOn.trust['kg-sabine']).toBeGreaterThan(gateOff.trust['kg-sabine']);
      expect(gateOn.trust['kg-sabine'] - gateOff.trust['kg-sabine']).toBe(tieWord('kg-sabine', new Set(['hf-orrin'])));
      // Without the help, no word: the tie alone carries nothing.
      expect(gateNone.trust['kg-sabine']).toBe(gateOff.trust['kg-sabine']);
      // Someone at the Gate with no tie to Orrin is met the same either way.
      expect(gateOn.trust['kg-veit']).toBe(gateOff.trust['kg-veit']);
    });

    it('a friend elsewhere: Anselm starts warmer when the Warden warmed the old scholar', () => {
      expect(mereOn.trust['sm-anselm']).toBeGreaterThan(mereOff.trust['sm-anselm']);
      expect(mereNone.trust['sm-anselm']).toBe(mereOff.trust['sm-anselm']);
      expect(mereOn.trust['sm-gunnar']).toBe(mereOff.trust['sm-gunnar']);
    });
  });
});

describe('The tie graph', () => {
  const ids = new Set(EVERYONE.map(p => p.id));
  const elsewhere = new Set(elsewhereEntries().map(e => e.id));
  const deeds = new Set(Object.values(TELLS).flatMap(t => Object.keys(t)));

  it('ties people on the road to each other and to people elsewhere, each side with its own opinion', () => {
    for (const t of tieEntries()) {
      expect(t.between, t.id).toHaveLength(2);
      expect(ids.has(t.between[0]), `${t.id}: ${t.between[0]}`).toBe(true);
      expect(ids.has(t.between[1]) || elsewhere.has(t.between[1]), `${t.id}: ${t.between[1]}`).toBe(true);
      expect(['kin', 'friend', 'rival', 'debt', 'colleague']).toContain(t.kind);
      expect(Object.keys(t.views).length, t.id).toBeGreaterThan(0);
      for (const [holder, v] of Object.entries(t.views)) {
        expect(t.between, `${t.id}: ${holder} isn't in the tie`).toContain(holder);
        // Only someone on the road holds a view the game reads: nobody elsewhere is asked.
        expect(ids.has(holder), `${t.id}: ${holder}`).toBe(true);
        expect(v.opinion).toBeGreaterThanOrEqual(-100);
        expect(v.opinion).toBeLessThanOrEqual(100);
      }
      expect(t.placeholder, `${t.id} is hand-written: a placeholder for the owner`).toBe(true);
    }
    expect(new Set(tieEntries().map(t => t.id)).size).toBe(tieEntries().length);
  });

  it('people elsewhere are the ones the Reach\'s deeds touched, and a deed that helped them is one the road knows', () => {
    for (const e of elsewhereEntries()) {
      expect(ids.has(e.id), `${e.id} clashes with someone on the road`).toBe(false);
      if (e.helpedBy) expect(deeds.has(e.helpedBy), `${e.id}: ${e.helpedBy}`).toBe(true);
      expect(tieEntries().some(t => t.between.includes(e.id)), `${e.id} has no tie`).toBe(true);
    }
  });

  it('names the canon each tie rests on, and the line is really there', () => {
    for (const t of [...tieEntries(), ...elsewhereEntries()]) {
      const [file, label] = t.source.split(' › ');
      expect(existsSync(join(root, file)), `${t.id}: no file ${file}`).toBe(true);
      expect(label, `${t.id}: say which line`).toBeTruthy();
      expect(readFileSync(join(root, file), 'utf8').includes(label), `${t.id}: no "${label}" in ${file}`).toBe(true);
    }
  });

  it('a view with words is a person-scope fact about the other, held by the one who has the view', () => {
    for (const t of tieEntries()) for (const [holder, v] of Object.entries(t.views)) {
      const other = t.between.find(x => x !== holder)!;
      const f = TIE_FACTS.find(x => x.id === `tie:${t.id}:${holder}`);
      if (!v.says || !ids.has(other)) { expect(f, `${t.id}:${holder}`).toBeUndefined(); continue; }
      expect(f?.scope).toEqual({ kind: 'person', id: holder });
      expect(f?.about).toEqual([`person:${other}`]);
      expect(f?.truth).toBe(v.truth ?? 'true');
    }
  });

  it('helped: the givers of quests done, and anyone elsewhere a deed helped', () => {
    const giver = QUESTS.find(q => q.id === 'hf-forge-wood')!.giver;
    expect([...helpedBy({ 'hf-forge-wood': 'done', 'sm-sluice': 'failed' }, ['warmed-the-scholar'])].sort()).toEqual([giver, 'reach-scholar'].sort());
    expect(helpedBy({}, undefined).size).toBe(0);
  });

  it('word carries only from those they think well of, as warmly as they do, the warmest one', () => {
    // Maren thinks poorly of Tobin: helping him says nothing to her.
    expect(tieWord('hf-maren', new Set(['hf-tobin']))).toBe(0);
    const sabineOfOrrin = tiesOf('kg-sabine').find(t => t.other === 'hf-orrin')!.opinion;
    expect(tieWord('kg-sabine', new Set(['hf-orrin']))).toBe(Math.round(TIE_WORD * sabineOfOrrin / 100));
    expect(tieWord('kg-sabine', new Set())).toBe(0);
  });
});

describe('The ties switch', () => {
  it('is a rules feature, new with this issue: runs from before it play without ties', () => {
    expect(featureOn(undefined, 'ties')).toBe(false);
    expect(featureOn(ON, 'ties')).toBe(true);
  });

  it('adds the ties\' facts to a run that has it, and to every fact any game can hold', () => {
    for (const f of TIE_FACTS) {
      expect(factsFor(ON)).toContain(f);
      expect(ALL_FACTS).toContain(f);
      expect(factsFor(OFF)).not.toContain(f);
    }
    expect(factsFor(ON)).toBe(ALL_FACTS);
    expect(factsFor(undefined)).toBe(FACTS);
    expect(factsFor(OFF)).toBe(factsFor(OFF));
  });

  it('changes no answer a person gave before, but about another person', () => {
    const before = factsFor(OFF), after = factsFor(ON);
    for (const p of EVERYONE) {
      for (const f of before) for (const topic of f.about) {
        if (topic.startsWith('person:')) continue;
        const a = resolve(p.id, topic, Infinity, { facts: before, others: [] });
        const b = resolve(p.id, topic, Infinity, { facts: after, others: [] });
        expect(b, `${p.id} on ${topic}`).toEqual(a);
      }
    }
  });

  it('only true claims needn\'t agree with canon; the false one is the opinion the issue names', () => {
    expect(TIE_FACTS.filter(f => f.truth !== 'true').map(f => f.id)).toEqual(['tie:maren-tobin:hf-maren']);
  });
});
