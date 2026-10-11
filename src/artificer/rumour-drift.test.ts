/**
 * Acceptance tests for how rumours bend as they travel (#1589), behind the `rumour-drift` rule
 * switch: the drift seeded by the claim and the path it came by, a name swapped within a People,
 * the teller's culture bending it in the story engine's own bias words, who carries a claim to
 * whom, and secrets that leak.
 *
 * The issue's acceptance scenarios come first (Given/When/Then), one block each, then what holds
 * them up: the vocabulary, the carriage rule, leaks, reach, the switch and the road.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PerceptualBias } from '../../storytelling/types';
import { FACTS, factsFor } from './facts';
import { featureById, featureOn, ruleFeatures } from './features';
import {
  carriage, claimEntries, driftOf, leakProblem, liesFor, pathProblem, reachOf, rumourFacts, tellingBias, tellingOf,
  DRIFT_GROWTH, FORGOTTEN_AT, LEAK_DOUBT, RUMOUR_FACTS, SAW_CONFIDENCE, TELLING_BENDS, TOLD_ON, type RumourEntry,
} from './claims';
import { claimsHeard, journalOf, type HeardClaim } from './journal';
import { VILLAGES, TRAVELLERS, asPlayed, type Person } from './villages';
import { REACH_CULTURES } from './world/peoples';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, type RoadState } from './road';
import { observeRoad } from '../artificer-ai/observe';

const root = join(__dirname, '..', '..');
const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
const PERSON = (id: string): Person => EVERYONE.find(p => p.id === id)!;
/** A new game's rules: every switch at its default, so `rumour-drift` and `humans-on-the-road` on. */
const ON = ruleFeatures();
/** The same game as #1580 shipped it. */
const FIRST = { ...ON, 'rumour-drift': false };
const rumour = (id: string): RumourEntry => claimEntries().rumours.find(r => r.id === id)!;

describe('#1589 acceptance', () => {
  describe('1. A number told across 3 hops drifts the same way every time, loses confidence at every hop, and never shrinks below the truth', () => {
    it('Given the debt Bodil owes Hedda, told on three times, When drift runs twice, Then the results are identical, confidence falls every hop, and the number never falls below the truth', () => {
      const debt = rumour('hedda-debt');
      expect(debt.path.length - 1).toBe(3);
      const once = driftOf(debt, ON), twice = driftOf(debt, ON);
      expect(twice).toEqual(once);
      for (let i = 1; i < once.length; i++) {
        expect(once[i].confidence).toBeLessThan(once[i - 1].confidence);
        expect(once[i].n).toBeGreaterThanOrEqual(once[i - 1].n);
        expect(once[i].n).toBeGreaterThanOrEqual(debt.truth.n);
      }
      // Pinned: the seeded rule gives exactly this, in every run.
      expect(once.map(h => [h.n, h.where, h.who])).toEqual(PINNED.hedda);
    });

    it('Given every rumour and fifty made-up ones down every kind of path, When they bend, Then the same holds for all of them: seeded, falling confidence, never below the truth', () => {
      const made = Array.from({ length: 50 }, (_, i): RumourEntry => ({
        ...rumour('pass-wolves'), id: `made-${i}`, truth: { n: 1 + (i % 7), where: rumour('pass-wolves').places[0] },
        path: [EVERYONE[i % EVERYONE.length].id, 'cv-pim', EVERYONE[(i * 5 + 3) % EVERYONE.length].id, 'cv-runa'].filter((p, j, a) => a.indexOf(p) === j),
      }));
      for (const r of [...claimEntries().rumours, ...made]) {
        const hops = driftOf(r, ON);
        expect(driftOf(r, ON)).toEqual(hops);
        expect(hops[0]).toMatchObject({ n: r.truth.n, where: r.truth.where, truth: 'true', confidence: SAW_CONFIDENCE });
        for (let i = 1; i < hops.length; i++) {
          expect(hops[i].confidence, `${r.id} hop ${i}`).toBeLessThan(hops[i - 1].confidence);
          expect(hops[i].n, `${r.id} hop ${i}`).toBeGreaterThanOrEqual(Math.max(r.truth.n, hops[i - 1].n));
        }
      }
    });

    it('Given a rumour, When the path it came by changes, Then the hops after the change bend another way, and the hops before it don\'t', () => {
      const debt = rumour('hedda-debt');
      const other = { ...debt, path: [...debt.path.slice(0, 2), 'cv-ottilia', 'hf-tobin'] };
      expect(driftOf(other, ON).slice(0, 2)).toEqual(driftOf(debt, ON).slice(0, 2));
    });
  });

  describe('2. Two cultures with different biases bend the same claim in the direction their bias names', () => {
    // Pim (a weak tie) tells it on to someone in Hollowford: Maren is fieldborn, loss-averse; Orrin
    // ridgefolk, honour-bound and a little fatalist. The same claim, the same path so far, so the
    // same dice: only the telling differs.
    const claim = (to: string, n = 20): RumourEntry => ({ ...rumour('pass-wolves'), id: 'bias-test', truth: { n, where: rumour('pass-wolves').places[0] }, path: ['cv-pim', to] });

    it('Given a loss-averse culture and an honour-bound one, When each passes the same claim, Then the loss-averse tells it worse, and the honour-bound vouches for it and says so', () => {
      expect(tellingBias('fieldborn').loss_aversion).toBeGreaterThan(0);
      expect(tellingBias('ridgefolk').honor_bound).toBeGreaterThan(0);
      const maren = driftOf(claim('hf-maren'), ON)[1], orrin = driftOf(claim('hf-orrin'), ON)[1];
      expect(maren.n).toBeGreaterThan(orrin.n);
      expect(orrin.confidence).toBeGreaterThan(maren.confidence);
      expect(maren.text.endsWith(TELLING_BENDS.loss_aversion!.frame!)).toBe(true);
      expect(orrin.text.endsWith(TELLING_BENDS.honor_bound!.frame!)).toBe(true);
    });

    it('Given many claims, When a loss-averse teller and a fatalist one each pass them on, Then the loss-averse one\'s number is never smaller, and often larger', () => {
      // Liv is refuge-keeper (fatalist first), Gunnar waterstead (loss-averse); both of Saltmere.
      expect(tellingOf('waterstead').growth).toBeGreaterThan(tellingOf('refuge-keepers').growth);
      let larger = 0;
      for (let i = 0; i < 60; i++) {
        const r = (to: string): RumourEntry => ({ ...claim(to, 6 + i), id: `bias-${i}`, path: ['sm-hedda', to] });
        const worse = driftOf(r('sm-gunnar'), ON)[1].n, shrugged = driftOf(r('sm-liv'), ON)[1].n;
        expect(worse).toBeGreaterThanOrEqual(shrugged);
        if (worse > shrugged) larger++;
      }
      expect(larger).toBeGreaterThan(20);
    });

    it('Given every bias the engine seeds a culture with, When it bends a telling, Then it bends the way its name says', () => {
      const one = (b: PerceptualBias) => ({ ...TELLING_BENDS[b] });
      expect(one('loss_aversion').growth).toBeGreaterThan(0);      // tells it worse
      expect(one('fatalist').growth).toBeLessThan(0);              // shrugs it smaller
      expect(one('honor_bound').vouch).toBeGreaterThan(0);         // stakes their word on it
      expect(one('sunk_cost').settle).toBeGreaterThan(0);          // holds to what they first heard
      expect(one('mercantile').frame).toMatch(/price/);            // reads it as a trade
    });
  });

  describe('3. A claim from one source counts once in the journal, however many repeat it', () => {
    it('Given Yrsa, Runa and Arvid all heard of Hedda\'s debt from Bodil (one way or another), When the journal counts it, Then it\'s one source, and no firmer than its surest telling', () => {
      const heard = claimsHeard({ 'sm-yrsa': ['person:sm-hedda'], 'cv-runa': ['person:sm-hedda'], 'kg-arvid': ['person:sm-hedda'] }, factsFor(ON), liesFor(ON));
      expect(heard).toHaveLength(3);
      expect(new Set(heard.map(c => c.origin))).toEqual(new Set(['cv-bodil']));
      const entry = journalOf(heard, []).find(e => e.proposition === 'hedda-debt')!;
      expect(entry.firmness).toBeCloseTo(Math.max(...heard.map(c => c.confidence)), 6);
      expect(entry.status).not.toBe('corroborated');
    });

    it('Given two people who heard the very same version from the same source, When the journal counts it, Then they agree but it\'s still only heard, not corroborated', () => {
      const [a] = claimsHeard({ 'cv-runa': ['person:sm-hedda'] }, factsFor(ON), liesFor(ON));
      const b: HeardClaim = { ...a, person: 'kg-sabine' };
      const entry = journalOf([a, b], [])[0];
      expect(entry.status).toBe('heard');
      expect(entry.firmness).toBeCloseTo(a.confidence, 6);
    });

    it('Given a name that swapped on the way, When two accounts name different people, Then they\'re two versions: the journal flags the clash', () => {
      const heard = claimsHeard({ 'sm-yrsa': ['person:sm-hedda'], 'kg-arvid': ['person:sm-hedda'] }, factsFor(ON), liesFor(ON));
      expect(journalOf(heard, [])[0].status).toBe('contradicted');
    });
  });
});

describe('Names swap within a People', () => {
  it('Given a rumour that names someone, When it bends, Then every name it ends up with is someone else of the true one\'s People, as the run plays them, and never one of its tellers', () => {
    for (const features of [ON, { ...ON, 'humans-on-the-road': false }]) {
      for (const r of claimEntries().rumours.filter(x => x.truth.who)) {
        const people = asPlayed(PERSON(r.truth.who!), features).people;
        driftOf(r, features).forEach((h, i) => {
          expect(asPlayed(PERSON(h.who!), features).people, `${r.id} hop ${i}`).toBe(people);
          if (h.who !== r.truth.who) expect(r.path.slice(0, i + 1)).not.toContain(h.who);
        });
      }
    }
    // The debt does swap on the way: by its last hop it's someone else Hedda is owed by.
    expect(driftOf(rumour('hedda-debt'), ON).at(-1)!.who).not.toBe('cv-bodil');
  });
});

describe('The bias vocabulary is the story engine\'s', () => {
  it('every culture on the road has bias seeds: the Reach\'s as the history has them, the rest written for the road', () => {
    for (const p of EVERYONE) expect(Object.keys(tellingBias(p.culture)).length, `${p.id} (${p.culture})`).toBeGreaterThan(0);
    for (const c of REACH_CULTURES) expect(tellingBias(c.id)).toBe(c.biasSeed);
    const tellers = claimEntries().tellers;
    for (const t of tellers) {
      expect(REACH_CULTURES.some(c => c.id === t.culture), `${t.culture} is the engine's already`).toBe(false);
      for (const [bias, w] of Object.entries(t.biasSeed)) {
        expect(Object.keys(TELLING_BENDS), `${t.culture}: ${bias}`).toContain(bias);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
    expect(new Set(tellers.map(t => t.culture)).size).toBe(tellers.length);
  });

  it('the tellers name the canon they rest on, and the line is really there', () => {
    for (const t of claimEntries().tellers) {
      const [file, label] = t.source.split(' › ');
      expect(existsSync(join(root, file)), `${t.culture}: no file ${file}`).toBe(true);
      expect(readFileSync(join(root, file), 'utf8').includes(label), `${t.culture}: no "${label}" in ${file}`).toBe(true);
      expect(t.placeholder, `${t.culture}: hand-written, for the owner`).toBe(true);
    }
  });

  it('a culture with no biases tells it as #1580 did: TOLD_ON, no bend, no line of its own', () => {
    expect(tellingOf('nobody-wrote-this')).toEqual({ growth: 1, toldOn: TOLD_ON, shift: 1 });
  });
});

describe('Who carries what', () => {
  it('a village\'s people tell each other, an organisation\'s members tell each other, and the road\'s weak ties carry it between villages', () => {
    expect(carriage('sm-hedda', 'sm-yrsa')).toBe('village');
    expect(carriage('hf-orrin', 'kg-runa')).toBe('org');      // both of the Dyprike
    expect(carriage('sm-yrsa', 'cv-runa')).toBe('org');       // both of the Vidde Accords
    expect(carriage('kg-veit', 'cv-bodil')).toBe('road');     // the caravan master carries it
    expect(carriage('hf-tobin', 'kg-veit')).toBe('road');     // a trader does too
    expect(carriage('hf-maren', 'kg-veit')).toBeNull();       // two elders who never meet
  });

  it('every written rumour travels by those ways, and nobody hears it twice', () => {
    for (const r of claimEntries().rumours) expect(pathProblem(r), r.id).toBeNull();
    expect(pathProblem({ ...rumour('pass-wolves'), path: ['hf-maren', 'kg-veit'] })).toMatch(/share no village, organisation or road/);
    expect(pathProblem({ ...rumour('pass-wolves'), path: ['kg-runa', 'cv-pim', 'kg-runa'] })).toMatch(/twice/);
  });

  it('an organisation passes it on as carefully as it is: a goblin band\'s news grows faster than a stranger\'s would', () => {
    // From Arvid, to Pim (both of the Compact, `loose`) and to Ottilia (no organisation shared):
    // both weak ties, the same dice, and Pim's culture bends no number. The band's hop grows more.
    let more = 0;
    for (let i = 0; i < 30; i++) {
      const r = (to: string): RumourEntry => ({ ...rumour('pass-wolves'), id: `org-${i}`, truth: { n: 10, where: rumour('pass-wolves').places[0] }, path: ['kg-arvid', to] });
      const band = driftOf(r('cv-pim'), ON)[1].n, stranger = driftOf(r('cv-ottilia'), ON)[1].n;
      expect(band).toBeGreaterThanOrEqual(stranger);
      if (band > stranger) more++;
    }
    expect(more).toBeGreaterThan(10);
    expect(DRIFT_GROWTH).toBeGreaterThan(0);
  });
});

describe('Secrets that leak', () => {
  const leak = rumour('compact-news');

  it('Given the Compact\'s news trade, When it\'s told on, Then it starts with a member, gets out through one who talks for a living, and sounds less sure once out', () => {
    expect(leakProblem(leak)).toBeNull();
    const hops = driftOf(leak, ON);
    // Among members it's the Compact's secret; out, people are still careful with it.
    expect(hops.map(h => h.sensitivity)).toEqual(['secret', 'secret', 'guarded', 'guarded']);
    // The hop it gets out (Pim to Bodil) loses LEAK_DOUBT more than the telling alone would.
    expect(hops[2].confidence).toBeCloseTo(hops[1].confidence * tellingOf(PERSON('cv-bodil').culture).toldOn * LEAK_DOUBT, 9);
    expect(hops[3].confidence).toBeCloseTo(hops[2].confidence * tellingOf(PERSON('hf-orrin').culture).toldOn, 9);
  });

  it('Given a secret that would leak through someone who doesn\'t talk for a living, or from an organisation with nothing to keep, Then it\'s refused', () => {
    expect(leakProblem({ ...leak, path: ['kg-runa', 'kg-veit'], leak: 'dyprike' })).toMatch(/doesn't talk for a living/);
    expect(leakProblem({ ...leak, leak: 'vidde-accords', path: ['sm-yrsa', 'cv-runa', 'kg-veit'] })).toMatch(/keeps nothing to leak/);
    expect(leakProblem({ ...leak, path: ['cv-bodil', 'hf-orrin'] })).toMatch(/isn't of The Compact/);
    expect(leakProblem({ ...leak, path: ['kg-arvid', 'cv-pim'] })).toMatch(/never leaves/);
  });
});

describe('Who a claim reaches', () => {
  it('Given a rumour, When it spreads beyond its path, Then each person it reaches got it by a way the road has, from someone who had it, until it\'s too unsure to bother with', () => {
    for (const r of claimEntries().rumours) {
      const reached = reachOf(r, ON);
      expect(reachOf(r, ON)).toEqual(reached);
      const had = new Set(r.path);
      for (const x of reached) {
        expect(r.path, r.id).not.toContain(x.person);
        expect(had.has(x.from), `${r.id}: ${x.person} from ${x.from}`).toBe(true);
        expect(carriage(x.from, x.person)).toBe(x.carriage);
        expect(x.confidence).toBeGreaterThanOrEqual(FORGOTTEN_AT);
        had.add(x.person);
      }
    }
    // Liv's village hears the wolves from her, at second hand from a weak tie or more.
    expect(reachOf(rumour('pass-wolves'), ON).map(x => x.person)).toEqual(expect.arrayContaining(['sm-gunnar', 'sm-anselm']));
  });

  it('Given a secret, When it spreads, Then it reaches nobody the same news wouldn\'t if it were no secret, and reaches them later and less surely', () => {
    // On the road nearly everyone meets a weak tie, so news reaches nearly everyone in the end; a
    // secret gets there the long way round, past the members who kept it.
    const secret = reachOf(leak(), ON);
    const open = new Map(reachOf({ ...leak(), leak: undefined }, ON).map(x => [x.person, x] as const));
    let later = 0;
    for (const x of secret) {
      const o = open.get(x.person)!;
      expect(o, x.person).toBeDefined();
      expect(x.hop).toBeGreaterThanOrEqual(o.hop);
      expect(x.confidence).toBeLessThanOrEqual(o.confidence + 1e-9);
      if (x.hop > o.hop) later++;
    }
    expect(later).toBeGreaterThan(0);
  });
  const leak = () => rumour('compact-news');
});

describe('The rumour-drift switch', () => {
  it('is a rules feature new with this issue: runs from before it hear #1580\'s drift, and neither new rumour', () => {
    expect(featureById('rumour-drift')).toMatchObject({ kind: 'rules', stage: 'experimental', default: true, absent: false, issue: 1589 });
    expect(featureOn(undefined, 'rumour-drift')).toBe(false);
    for (const r of claimEntries().rumours.filter(x => !x.feature)) expect(driftOf(r, FIRST)).toEqual(driftOf(r));
    expect(rumourFacts(FIRST)).toEqual(RUMOUR_FACTS);
    const ids = (features: Record<string, boolean>) => new Set(factsFor(features).filter(f => f.id.startsWith('rumour:')).map(f => f.id.split(':')[1]));
    expect(ids(FIRST)).toEqual(new Set(['pass-wolves', 'mere-fish']));
    expect(ids(ON)).toEqual(new Set(['pass-wolves', 'mere-fish', 'hedda-debt', 'compact-news']));
    // It bends rumours, so without them it adds nothing.
    expect(factsFor({ ...ON, 'rumours-and-lies': false }).some(f => f.id.startsWith('rumour:'))).toBe(false);
  });

  it('a run keeps the same facts array for the same switches, and the facts a new game plays with', () => {
    expect(factsFor({ ...ON })).toBe(factsFor(ON));
    expect(factsFor({ ...ON, 'humans-on-the-road': false })).not.toBe(factsFor(ON));
    expect(factsFor(undefined)).toBe(FACTS);
  });

  it('the bent rumours are pinned: a change to the rule moves these', () => {
    for (const [id, pin] of Object.entries(PINNED)) {
      const r = claimEntries().rumours.find(x => x.id.startsWith(id))!;
      expect(driftOf(r, ON).map(h => [h.n, h.where, h.who]), r.id).toEqual(pin);
    }
  });
});

describe('On the road, with the switch on', () => {
  let atSaltmere: RoadState;
  beforeAll(() => {
    const s = createRegion1({}, undefined, { id: 'w-drift', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
    const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
    const from: Region1State = {
      ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
      config: { ...s.config, world: { ...s.config.world, features: ON } },
    };
    let r = createRoad(from);
    for (let i = 0; i < 30 && villageOf(r) !== 'saltmere'; i++) r = endRoadDay(r);
    atSaltmere = r;
  }, 60_000);

  it('Given Liv at Saltmere, When asked about the north road, Then she tells the wolves as they bent on the way to her, fatalist shrug and all, and the AI reads the same words', () => {
    expect(villageOf(atSaltmere)).toBe('saltmere');
    const r = runRoadAction({ ...atSaltmere, focus: { kind: 'place', id: 'north-road' } as RoadState['focus'], trust: { ...atSaltmere.trust, 'sm-liv': 30 } }, 'ask:sm-liv');
    const liv = driftOf(rumour('pass-wolves'), ON)[2];
    expect(r.log.at(-1)!.text).toContain(liv.text);
    expect(liv.text.endsWith(TELLING_BENDS.fatalist!.frame!)).toBe(true);
    expect(observeRoad(r)).toContain('Wolves on the north road');
  });

  it('Given Yrsa at Saltmere, When asked about Hedda, Then she passes on the debt as Bodil told it her, staking her word on it, and the journal keeps it', () => {
    const r = runRoadAction({ ...atSaltmere, focus: { kind: 'person', id: 'sm-hedda' } as RoadState['focus'], trust: { ...atSaltmere.trust, 'sm-yrsa': 30 } }, 'ask:sm-yrsa');
    const yrsa = driftOf(rumour('hedda-debt'), ON)[1];
    expect(r.log.at(-1)!.text).toContain(yrsa.text);
    expect(yrsa.text.endsWith(TELLING_BENDS.honor_bound!.frame!)).toBe(true);
    expect(observeRoad(r)).toContain('Who owes Hedda');
  });
});

/** Each rumour's bent drift with a new game's switches, pinned: [number, place, who] at each hop. */
const PINNED: Record<string, [number, string, string | undefined][]> = {
  'pass-wolves': [[3, 'the high pass above the Gate', undefined], [5, 'the ford road out of Hollowford', undefined], [7, 'the ford road out of Hollowford', undefined]],
  'mere-fish': [[4, 'the still north end of the mere', undefined], [5, 'the still north end of the mere', undefined], [7, 'the still north end of the mere', undefined]],
  hedda: [[3, 'the Saltmere racks', 'cv-bodil'], [4, 'the Saltmere racks', 'cv-bodil'], [6, 'the Saltmere racks', 'cv-bodil'], [9, 'the spring market at the Gate', 'sm-gunnar']],
  'compact-news': [[2, 'the high fields', 'hf-tobin'], [4, 'the ford', 'hf-tobin'], [5, 'the ford', 'hf-tobin'], [7, 'the ford', 'hf-tobin']],
};
