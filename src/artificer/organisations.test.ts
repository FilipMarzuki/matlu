/**
 * Acceptance tests for knowledge slice B (#1587, docs/knowledge-model-design.md §4): organisations
 * on the road. A registry (orgs.ts, content/organisations.json) open to any kind of organisation,
 * `Person.orgs` with a rank in each, secrecy toward outsiders, the Warden's standing with an
 * organisation, and signs of membership, behind the `organisations` rule switch.
 *
 * The issue's three scenarios come first, then what holds them up: the registry's shape, the
 * standing a deed earns, and that membership signs are the ones noticing already had.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { answer, knows, gateOf, SENSITIVITY_TRUST, type Fact, type Org, type Sensitivity } from './knowledge';
import { ALL_FACTS, FACTS, ORGS, factsFor, knowerOf, resolve } from './facts';
import { featureOn, ruleFeatures } from './features';
import { ORG_FACTS, STANDING_PER_DEED, orgEntries, orgFactEntries, membersOf, standingFrom } from './orgs';
import { SIGNS } from './notice';
import { TOPICS, isTopicKind } from './topics';
import { VILLAGES, TRAVELLERS, type Person } from './villages';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, type RoadState } from './road';
import { serialize, deserialize, makeWarden } from '../artificer-app/controller';

const root = join(__dirname, '..', '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

/** The text under a markdown heading, down to the next heading of the same or a higher level (as facts-scope.test.ts has it). */
function sectionOf(md: string, heading: string): string | null {
  const lines = md.split('\n');
  const level = (l: string): number => /^(#+)\s/.exec(l)?.[1].length ?? 0;
  const i = lines.findIndex(l => level(l) > 0 && l.replace(/^#+\s+/, '').trim() === heading);
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !(level(lines[j]) > 0 && level(lines[j]) <= level(lines[i]))) j++;
  return lines.slice(i, j).join('\n');
}

/** What's wrong with a source (`file § heading › label`, or `file › label`), or null. */
function sourceProblem(source: string): string | null {
  const [head, label] = source.split(' › ');
  const [file, heading] = head.split(' § ');
  if (!file || !existsSync(join(root, file))) return `no file "${file}"`;
  if (!label) return 'no label: say which line it rests on';
  const text = read(file);
  const section = heading ? sectionOf(text, heading) : text;
  if (section === null) return `no heading "${heading}" in ${file}`;
  if (!section.includes(label)) return `no "${label}" under ${heading ?? file}`;
  return null;
}
const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
const ON = ruleFeatures();
const OFF = { ...ON, organisations: false };
const SENSITIVITIES: readonly Sensitivity[] = ['public', 'guarded', 'private', 'secret'];

/** A topic no one on the road has a fact about, so a test fact is the only thing that answers it. */
const LONELY = 'group:dyprike';
const fact = (over: Partial<Fact>): Fact => ({ id: 'test', about: [LONELY], text: 'A test fact.', scope: { kind: 'org', id: 'compact' }, sensitivity: 'public', truth: 'true', ...over });

/** A Warden out of the Reach with `deeds`, in a world with `features`, riding on until `until` says stop. */
function ride(features: Record<string, boolean> | undefined, deeds: string[], until: (r: RoadState) => boolean): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-orgs', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, deeds, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, ...(features ? { features } : {}) } },
  };
  let r = createRoad(from);
  for (let i = 0; i < 20 && !until(r); i++) r = endRoadDay(r);
  return r;
}

/** Ask `pid` about `topic` on the road, with `trust` (the rest of the road as it stands). The last line said. */
function askOnRoad(r: RoadState, pid: string, topic: string, trust: number): string | undefined {
  const [kind, id] = topic.split(':');
  const before = { ...r, focus: { kind, id } as RoadState['focus'], trust: { ...r.trust, [pid]: trust } };
  return runRoadAction(before, `ask:${pid}`).log.at(-1)?.text;
}

describe('Organisations: the issue’s scenarios (#1587)', () => {
  // 1. Given Tobin is of the Compact at rank 2 and a Compact fact is depth 3,
  //    When he's asked about it, Then he doesn't know it; a rank-3 member does.
  it('a member knows their organisation’s facts only as deep as their rank reaches', () => {
    const tobin = knowerOf('hf-tobin')!;
    expect(tobin.orgs).toHaveProperty('compact');
    const deep = fact({ depth: 3 });
    const atTwo = { ...tobin, orgs: { ...tobin.orgs, compact: 2 } };
    const atThree = { ...tobin, orgs: { ...tobin.orgs, compact: 3 } };
    expect(knows(atTwo, deep)).toBe(false);
    expect(answer(atTwo, LONELY, 100, [deep], ORGS)).toEqual({ kind: 'unknown', referral: null });
    expect(knows(atThree, deep)).toBe(true);
    expect(answer(atThree, LONELY, 100, [deep], ORGS)).toMatchObject({ kind: 'told', fact: { id: 'test' } });
    // An outsider knows none of it, whatever their rank anywhere else.
    expect(knows(knowerOf('hf-maren')!, fact({}))).toBe(false);
  });

  // 2. Given an organisation marked `secret`, When a member is asked about a `guarded` fact of it
  //    by an outsider, Then the gate is `secret`'s (75); for `bound-to-tell`, every gate is 0.
  it('an organisation’s secrecy sets what members tell outsiders: secret lifts a guarded fact to 75; bound to tell opens every gate', () => {
    expect(ORGS.compact.secrecy).toBe('secret');
    expect(gateOf(fact({ sensitivity: 'guarded' }), ORGS)).toBe(SENSITIVITY_TRUST.secret);
    expect(SENSITIVITY_TRUST.secret).toBe(75);
    expect(ORGS['compact-of-knowing'].secrecy).toBe('bound-to-tell');
    for (const s of SENSITIVITIES) expect([s, gateOf(fact({ sensitivity: s, scope: { kind: 'org', id: 'compact-of-knowing' } }), ORGS)]).toEqual([s, 0]);
    // On the road: Tobin keeps the Compact's dealings with the [Heralds] from you until 75.
    const facts = factsFor(ON);
    expect(resolve('hf-tobin', 'group:vidde-accords', 74, { facts })).toMatchObject({ kind: 'not-yet', trust: 75 });
    expect(resolve('hf-tobin', 'group:vidde-accords', 75, { facts })).toMatchObject({ kind: 'told', fact: { scope: { kind: 'org', id: 'compact' } } });
    // And Anselm must read the book to anyone, however private: told at trust 0.
    expect(resolve('sm-anselm', 'place:saltmere', 0, { facts })).toMatchObject({ kind: 'told', fact: { scope: { kind: 'org', id: 'compact-of-knowing' } } });
  });

  // 3. Given a saved road from before organisations, When it loads, Then it plays unchanged.
  it('a road saved before organisations loads and plays as it did: no organisation facts, no standing, the same signs', () => {
    expect(featureOn(undefined, 'organisations')).toBe(false);
    expect(factsFor(undefined)).toBe(FACTS);
    expect(factsFor({ ...OFF, 'scope-facts': false })).toBe(FACTS);
    expect(factsFor(OFF).some(f => f.scope.kind === 'org')).toBe(false);

    // A Warden who did the herald a kindness, on a road from before the switches, saved and loaded.
    const atSaltmere = ride(undefined, ['herald-owes-you'], r => villageOf(r) === 'saltmere');
    const app = makeWarden({ id: 'w-orgs-save' });
    const loaded = deserialize(serialize({ ...app, stage: 'road', road: atSaltmere }))!.road!;
    expect(loaded.features).toBeUndefined();
    const told = runRoadAction(loaded, 'tell:sm-yrsa:herald-owes-you');
    // Telling Yrsa says what it always said, and no word goes round an organisation.
    expect(told.log.slice(loaded.log.length).map(l => l.text).join(' ')).not.toMatch(/Word of it/);
    // Asked about the Accords, Yrsa answers from what Saltmere knows, as before (or not at all,
    // without the scope facts): never from the Accords' own facts.
    const before = askOnRoad(told, 'sm-yrsa', 'group:vidde-accords', 90);
    expect(before).toBe(askOnRoad({ ...told, features: { 'scope-facts': false, referrals: false, organisations: false } }, 'sm-yrsa', 'group:vidde-accords', 90));
    // The same signs to notice as before organisations (pinned in full below).
    expect(Object.keys(SIGNS).sort()).toEqual(['hf-isa', 'hf-tobin', 'kg-arvid', 'kg-runa', 'kg-sabine', 'sm-yrsa']);
  });
});

describe('The organisation registry (#1587)', () => {
  const entries = orgEntries();

  it('holds any kind of organisation: each has an id, a name, a kind in its own words, a secrecy and a reliability', () => {
    expect(new Set(entries.map(o => o.id)).size).toBe(entries.length);
    for (const o of entries) {
      expect(o.name, o.id).toBeTruthy();
      expect(typeof o.kind, o.id).toBe('string');
      expect(o.kind.length, o.id).toBeGreaterThan(0);
      expect(['open', 'guarded', 'secret', 'bound-to-tell'], o.id).toContain(o.secrecy);
      expect(['careful', 'fair', 'loose'], o.id).toContain(o.reliability);
      // The owner's call (#1587): only guilds get ranks, to start.
      if (o.ranks) expect(o.kind, o.id).toBe('guild');
      if (o.topic) {
        const [k, id] = o.topic.split(':');
        expect(isTopicKind(k) && TOPICS[k][id], `${o.id} topic ${o.topic}`).toBeTruthy();
      }
      // Written by hand for the road, for the owner to review, from canon it names.
      expect(o.placeholder, o.id).toBe(true);
      expect(sourceProblem(o.source), `${o.id}: ${o.source}`).toBeNull();
    }
    expect(ORGS).toEqual(Object.fromEntries(entries.map(o => [o.id, o])));
  });

  it('the model reads nothing of an organisation’s kind: a hunting party keeps its secrets like any other', () => {
    const party: Org = { id: 'party', name: 'the Hare Stream hunters', secrecy: 'secret', kind: 'hunting party' };
    const f = fact({ scope: { kind: 'org', id: 'party' }, sensitivity: 'public' });
    const member = { ...knowerOf('hf-orrin')!, orgs: { party: 1 } };
    expect(answer(member, LONELY, 50, [f], { party })).toMatchObject({ kind: 'not-yet', trust: 75 });
    expect(answer(member, LONELY, 75, [f], { party })).toMatchObject({ kind: 'told' });
  });

  it('lists the members the lore names, each in an organisation that exists, at a rank it has', () => {
    expect(membersOf('compact').map(p => p.id)).toEqual(['hf-tobin', 'kg-arvid', 'cv-pim']);
    expect(membersOf('compact-of-knowing').map(p => p.id)).toEqual(['sm-anselm']);
    expect(membersOf('vidde-accords').map(p => p.id)).toEqual(['sm-yrsa', 'cv-runa']);
    expect(membersOf('dyprike').map(p => p.id)).toEqual(['hf-orrin', 'kg-runa']);
    expect(membersOf('caravan').map(p => p.id)).toEqual(['cv-bodil', 'cv-pim', 'cv-ottilia', 'cv-runa']);
    for (const p of EVERYONE) {
      for (const [org, m] of Object.entries(p.orgs ?? {})) {
        expect(ORGS[org], `${p.id} in ${org}`).toBeDefined();
        const top = ORGS[org].ranks?.length ?? 1;
        expect(m.rank, `${p.id} in ${org}`).toBeGreaterThanOrEqual(1);
        expect(m.rank, `${p.id} in ${org}`).toBeLessThanOrEqual(top);
      }
      // The model sees the same memberships, as ranks.
      expect(knowerOf(p.id)!.orgs).toEqual(Object.fromEntries(Object.entries(p.orgs ?? {}).map(([o, m]) => [o, m.rank])));
    }
  });

  it('its facts are the model’s, each scoped to an organisation with members who know it, about a topic that exists, with a source', () => {
    const files = orgFactEntries();
    expect(new Set(files.map(e => e.id)).size).toBe(files.length);
    expect(ORG_FACTS.length).toBe(files.length);
    for (const e of files) {
      expect(e.scope.kind, e.id).toBe('org');
      expect(ORGS[e.scope.id!], e.id).toBeDefined();
      expect(membersOf(e.scope.id!).some(p => knows(knowerOf(p.id)!, ORG_FACTS.find(f => f.id === `org:${e.id}`)!)), e.id).toBe(true);
      for (const t of e.about) {
        const [k, id] = t.split(':');
        expect(isTopicKind(k) && TOPICS[k][id], `${e.id} about ${t}`).toBeTruthy();
      }
      expect(sourceProblem(e.source), `${e.id}: ${e.source}`).toBeNull();
      expect(e.truth, e.id).toBe('true');
      expect(e.placeholder, e.id).toBe(true);
    }
    // In every game that can hold them, and only behind the switch.
    for (const f of ORG_FACTS) expect(ALL_FACTS).toContain(f);
    expect(factsFor(ON)).toBe(ALL_FACTS);
  });

  it('changes no answer anyone gave before: a person’s own words still come first', () => {
    for (const p of EVERYONE) {
      for (const f of FACTS.filter(x => x.scope.id === p.id)) {
        for (const t of f.about) {
          const before = resolve(p.id, t, Infinity, { facts: FACTS });
          const after = resolve(p.id, t, Infinity, { facts: factsFor(ON) });
          expect([p.id, t, after]).toEqual([p.id, t, before]);
        }
      }
    }
  });
});

describe('Standing with an organisation (#1587)', () => {
  it('a deed told to one member is known to the whole organisation: standing, apart from any one person’s trust', () => {
    expect(standingFrom({})).toEqual({});
    expect(standingFrom({ 'sm-yrsa': ['deed:herald-owes-you'] })).toEqual({ 'vidde-accords': STANDING_PER_DEED });
    // The same deed told to two members counts once.
    expect(standingFrom({ 'sm-yrsa': ['deed:herald-owes-you'], 'cv-runa': ['deed:herald-owes-you'] })).toEqual({ 'vidde-accords': STANDING_PER_DEED });
    // Told to someone outside it, it earns nothing there.
    expect(standingFrom({ 'hf-maren': ['deed:herald-owes-you'] })).toEqual({});
    // A topic asked isn't a deed.
    expect(standingFrom({ 'sm-yrsa': ['group:vidde-accords'] })).toEqual({});
  });

  it('standing opens an organisation’s facts with its other members, and nothing else', () => {
    const facts = factsFor(ON);
    const standing = standingFrom({ 'sm-yrsa': ['deed:herald-owes-you'] });
    expect(resolve('cv-runa', 'group:vidde-accords', 0, { facts })).toMatchObject({ kind: 'not-yet', trust: 25 });
    expect(resolve('cv-runa', 'group:vidde-accords', 0, { facts, standing })).toMatchObject({ kind: 'told', fact: { scope: { kind: 'org', id: 'vidde-accords' } } });
    // A fact of another scope keeps its own gate: standing with the Accords doesn't open the road's business.
    const own = resolve('cv-runa', 'place:kestrel-gate', 0, { facts, standing });
    expect(own).toEqual(resolve('cv-runa', 'place:kestrel-gate', 0, { facts }));
  });

  it('on the road: tell Yrsa about the herald, and Runa of the caravan will tell you of the Accords on the wagon', () => {
    const atSaltmere = ride(ON, ['herald-owes-you'], r => villageOf(r) === 'saltmere');
    const told = runRoadAction(atSaltmere, 'tell:sm-yrsa:herald-owes-you');
    expect(told.log.slice(atSaltmere.log.length).map(l => l.text).join(' ')).toMatch(/Word of it will go round the Vidde Accords/);
    // Trust is per person and untouched for Runa: what changed is the Accords' standing.
    expect(told.trust['cv-runa']).toBe(atSaltmere.trust['cv-runa']);
    const onTheWagon = (from: RoadState) => { let r = from; for (let i = 0; i < 10 && villageOf(r); i++) r = endRoadDay(r); return r; };
    const after = onTheWagon(told);
    expect(villageOf(after)).toBeFalsy();
    expect(askOnRoad(after, 'cv-runa', 'group:vidde-accords', 0)).toMatch(/^Runa: "/);
    // Without the tell, Runa holds it back from a stranger.
    expect(askOnRoad(onTheWagon(atSaltmere), 'cv-runa', 'group:vidde-accords', 0)).toMatch(/Ask me again when I know you better/);
    // With the switch off, no word goes round, and Runa doesn't know the Accords' business at all.
    const off = runRoadAction({ ...atSaltmere, features: OFF }, 'tell:sm-yrsa:herald-owes-you');
    expect(off.log.slice(atSaltmere.log.length).map(l => l.text).join(' ')).not.toMatch(/Word of it/);
    expect(askOnRoad(onTheWagon(off), 'cv-runa', 'group:vidde-accords', 90)).toMatch(/shakes their head/);
  });
});

describe('Signs of membership (#1587, noticing #1496)', () => {
  it('come from membership, and are exactly the signs noticing had before', () => {
    // Pinned from notice.ts as it was before organisations: the Compact's two signs now come from
    // Tobin's and Arvid's memberships; the rest are written per person, as before.
    expect(SIGNS).toEqual({
      'hf-tobin': { 'group:compact': 'A small stamped metal disc hangs on a thong inside Tobin\'s collar: a Compact-seal token, the kind goblin bands carry as a letter of introduction.' },
      'hf-isa': { 'skill:foraging': 'Isa\'s apron pockets bulge with dried caps and roots, each one wrapped and labelled in a small, tidy hand.' },
      'sm-yrsa': { 'material:iron': 'Yrsa\'s arrows are tipped with iron, not flint, and every point is stamped on the tang with a small kestrel.' },
      'kg-arvid': { 'group:compact': 'Arvid\'s map case is goblin work, and the map in it shows the high pass with ruins marked that are on no Gate chart.' },
      'kg-sabine': { 'material:iron': 'Sabine\'s forearms are freckled with small round burns, the kind a forge throws when the iron is worked hot.' },
      'kg-runa': { 'skill:foraging': 'Runa\'s boots are stained yellow-green to the ankle. Feverfew grows thick on the high slopes, and she has walked through a lot of it.' },
    });
    const tobin = EVERYONE.find(p => p.id === 'hf-tobin')!;
    expect(tobin.orgs?.compact?.sign).toBe(SIGNS['hf-tobin']['group:compact']);
  });
});
