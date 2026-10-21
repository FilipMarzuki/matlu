/**
 * Acceptance tests for #1661, behind the `reach-and-secrets` rule switch: who a rumour reached
 * knows it in play (claims.ts `reachOf`, `knownBy`), and insiders keep their organisation's business
 * (knowledge.ts `Keeping`, `keeperOf`).
 *
 * One block per Given/When/Then in the issue:
 * - **Far rumour** → "1. Far rumour"
 * - **Insider, outsider asks** → "2. Insider, outsider asks"
 * - **Insider, trusted or member** → "3. Insider, trusted or member"
 * - **Leak** → "4. Leak"
 * - **Switch off** → "5. Switch off"
 * And the owner's answer on what comes first (2026-10-12, "news first, then lore") → "6. News first, then lore".
 * Then what holds them up: the switch itself, and the rumours' facts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ask } from './asks';
import { claimEntries, driftOf, knownBy, reachKind, reachOf, rumourFacts, PROPOSITIONS, propositionOfFact, REACH_FEATURE, type RumourEntry, type RumourHop } from './claims';
import { factsFor, knowerOf, resolve, HEARSAY, ORGS } from './facts';
import { claimsHeard } from './journal';
import { featureById, featureOn, ruleFeatures } from './features';
import { keeperOf, type Fact } from './knowledge';
import { VILLAGES, TRAVELLERS, type Person } from './villages';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, type RoadState } from './road';

/** A new game's rules: every switch at its default, `reach-and-secrets` on. */
const ON = ruleFeatures();
/** The same game with this issue's switch off. */
const OFF = { ...ON, [REACH_FEATURE]: false };
const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
const person = (id: string): Person => EVERYONE.find(p => p.id === id)!;
const rumour = (id: string): RumourEntry => claimEntries().rumours.find(r => r.id === id)!;

/**
 * A rumour close to its source: Maren saw it, and told Isa, her neighbour. Neither talks for a
 * living, so nobody has carried it down the road yet (`reachKind`: near).
 */
const NEAR: RumourEntry = {
  id: 'test-near', label: 'Drowned sheep', about: ['place:hollowford'], core: '{n} sheep drowned at {where}.',
  truth: { n: 3, where: 'the mill race' }, places: ['the mill race', 'the ford', 'the high fields'],
  path: ['hf-maren', 'hf-isa'], placeholder: true, source: 'test',
};

/** How bent a set of tellings is: on average, how far each one's number has grown from the truth, as a share of it. */
const bentness = (r: RumourEntry, hops: readonly RumourHop[]): number =>
  hops.reduce((sum, h) => sum + (h.n - r.truth.n) / r.truth.n + (h.where !== r.truth.where ? 1 : 0), 0) / hops.length;

const keeping = { keeping: { memberOf: [] as string[] } };

function ride(features: Record<string, boolean>, until: (r: RoadState) => boolean): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-reach', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, features } },
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

describe('#1661 acceptance', () => {
  let atGate: RoadState, offGate: RoadState;
  beforeAll(() => {
    atGate = ride(ON, r => villageOf(r) === 'kestrel-gate');
    offGate = ride(OFF, r => villageOf(r) === 'kestrel-gate');
  });

  describe('1. Far rumour', () => {
    it('Given a far-reaching rumour, Then more road people know it than a near one, and the far tellings are more bent', () => {
      const far = rumour('pass-wolves');
      expect(reachKind(far)).toBe('far');
      expect(reachKind(NEAR)).toBe('near');
      const farKnown = knownBy(far, ON), nearKnown = knownBy(NEAR, ON);
      expect(farKnown.length).toBeGreaterThan(nearKnown.length);
      // Beyond the one who saw it: the far tellings have grown and moved further from the truth.
      expect(bentness(far, farKnown.slice(1))).toBeGreaterThan(bentness(NEAR, nearKnown.slice(1)));
      // A near rumour hasn't left home: it passed only between neighbours.
      for (const x of reachOf(NEAR, ON)) expect(x.carriage, x.person).toBe('village');
      // And in play: everyone it reached can tell it, each bent their own way, not only its path.
      const holders = (features: Record<string, boolean>) => new Set(factsFor(features).filter(f => f.id.startsWith('rumour:pass-wolves:')).map(f => f.scope.id));
      expect(holders(OFF)).toEqual(new Set(far.path));
      expect(holders(ON).size).toBe(farKnown.length);
      expect(holders(ON).size).toBeGreaterThan(holders(OFF).size);
      // Maren isn't on its path: with the switch on, asked about the north road, she passes on the wolves.
      const maren = resolve('hf-maren', 'place:north-road', 100, { facts: factsFor(ON) });
      expect(maren).toMatchObject({ kind: 'told', fact: { id: expect.stringMatching(/^rumour:pass-wolves:\d+:hf-maren$/), truth: 'rumour', hearsay: true } });
      expect(resolve('hf-maren', 'place:north-road', 100, { facts: factsFor(OFF) })).toMatchObject({ kind: 'told', fact: { scope: { kind: 'region' } } });
    });
  });

  describe('2. Insider, outsider asks', () => {
    it('Given a group secret and an outsider at low trust, When an insider is asked, Then they deflect', () => {
      const facts = factsFor(ON);
      // Arvid is of the Compact, which is secret: asked about it at 25, he keeps its business, and says so.
      expect(resolve('kg-arvid', 'group:compact', 25, { facts, ...keeping })).toMatchObject({ kind: 'not-yet', keptFor: 'compact' });
      const line = ask(person('kg-arvid'), 'group:compact', 'the Compact', 25, [], { facts, ...keeping });
      expect(line).toEqual({ kind: 'not-yet', line: 'Arvid looks away. "That\'s the Compact\'s business, and not for outsiders."' });
      // An organisation's own fact too: Tobin on the Compact's dealings with the [Heralds].
      expect(resolve('hf-tobin', 'group:vidde-accords', 74, { facts, ...keeping })).toMatchObject({ kind: 'not-yet', trust: 75, keptFor: 'compact' });
      // On the road, at the Gate.
      const after = askOnRoad(atGate, 'kg-arvid', 'group:compact', 25);
      expect(after.log.at(-1)!.text).toMatch(/That's the Compact's business, and not for outsiders/);
      expect(after.asked?.['kg-arvid'] ?? []).toEqual([]);
    });
  });

  describe('3. Insider, trusted or member', () => {
    it('Given the same at high trust, or for a member, Then they tell it', () => {
      const facts = factsFor(ON);
      expect(resolve('kg-arvid', 'group:compact', 50, { facts, ...keeping })).toMatchObject({ kind: 'told', fact: { id: 'answer:kg-arvid:group:compact' } });
      expect(resolve('kg-arvid', 'group:compact', 0, { facts, keeping: { memberOf: ['compact'] } })).toMatchObject({ kind: 'told' });
      expect(resolve('hf-tobin', 'group:vidde-accords', 0, { facts, keeping: { memberOf: ['compact'] } })).toMatchObject({ kind: 'told', fact: { scope: { kind: 'org', id: 'compact' } } });
      // Standing with the organisation counts as trust with every member of it, for its business.
      expect(resolve('kg-arvid', 'group:compact', 25, { facts, standing: { compact: 25 }, ...keeping })).toMatchObject({ kind: 'told' });
      // On the road, at the Gate, trusted enough.
      const after = askOnRoad(atGate, 'kg-arvid', 'group:compact', 50);
      expect(after.log.at(-1)!.text).toMatch(/^Arvid: "The Compact pays in maps/);
    });
  });

  describe('4. Leak', () => {
    it('Given the leak rules, Then a non-member who heard it through gossip may still tell it', () => {
      const facts = factsFor(ON);
      const news = rumour('compact-news');
      // Bodil isn't of the Compact: the news got out to her through Pim, who talks for a living.
      expect(ORGS.compact.secrecy).toBe('secret');
      expect(knowerOf('cv-bodil')!.orgs.compact).toBeUndefined();
      expect(news.path).toContain('cv-bodil');
      const bodil = resolve('cv-bodil', 'group:compact', 25, { facts, ...keeping });
      expect(bodil).toMatchObject({ kind: 'told', fact: { id: `rumour:compact-news:${news.path.indexOf('cv-bodil')}`, sensitivity: 'guarded' } });
      expect(bodil?.kind === 'told' && bodil.fact.keptBy).toBeFalsy();
      // Someone it reached past its path, on a leak roll, tells it too.
      const reached = facts.filter(f => f.id.startsWith('rumour:compact-news:') && f.hearsay && !knowerOf(f.scope.id!)!.orgs.compact);
      expect(reached.length).toBeGreaterThan(0);
      const told = reached.filter(f => resolve(f.scope.id!, 'group:compact', 25, { facts, ...keeping })?.kind === 'told');
      expect(told.length).toBeGreaterThan(0);
      // While the members who hold it keep it as the Compact's own.
      for (const f of facts.filter(x => x.id.startsWith('rumour:compact-news:') && knowerOf(x.scope.id!)!.orgs.compact !== undefined)) {
        expect(f.keptBy, f.id).toBe('compact');
        expect(keeperOf(knowerOf(f.scope.id!)!, f, ORGS), f.id).toBe('compact');
      }
    });
  });

  describe('6. News first, then lore', () => {
    it('Given someone a far rumour reached, When they are asked about the road twice, Then they pass on the rumour first, and the road\'s common knowledge after', () => {
      const atFord = ride(ON, r => villageOf(r) === 'hollowford');
      const first = askOnRoad(atFord, 'hf-maren', 'place:north-road', 100);
      expect(first.log.at(-1)!.text).toMatch(/^Maren: "Everyone's saying it: .*wolves/i);
      expect(first.asked?.['hf-maren']).toEqual([`${HEARSAY}place:north-road`]);
      const second = askOnRoad(first, 'hf-maren', 'place:north-road', 100);
      const lore = resolve('hf-maren', 'place:north-road', 100, { facts: factsFor(ON), skipHearsay: true });
      expect(lore).toMatchObject({ kind: 'told', fact: { scope: { kind: 'region' } } });
      expect(lore?.kind === 'told' && second.log.at(-1)!.text).toBe(lore?.kind === 'told' && `Maren: "${lore.fact.text}"`);
      expect(second.asked?.['hf-maren']).toEqual([`${HEARSAY}place:north-road`, 'place:north-road']);
      // Asked a third time, she's told you all she knows.
      expect(askOnRoad(second, 'hf-maren', 'place:north-road', 100).log.at(-1)!.text).toMatch(/has already told you what they know/);
      // The journal keeps both: the rumour as she passed it on, and the road's word.
      const heard = claimsHeard(second.asked, factsFor(ON)).filter(c => c.person === 'hf-maren');
      expect(heard.map(c => c.proposition)).toContain('pass-wolves');
    });
  });

  describe('5. Switch off', () => {
    it('Given the switch off, Then play equals today\'s', () => {
      expect(featureOn(OFF, REACH_FEATURE)).toBe(false);
      // The rumours' facts are their paths' alone, built exactly as before this issue.
      const before = (features: Record<string, boolean>): Fact[] => claimEntries().rumours
        .filter(r => !r.feature || featureOn(features, r.feature))
        .flatMap(r => driftOf(r, features).map(h => ({ id: `rumour:${r.id}:${h.hop}`, about: r.about, text: h.text, scope: { kind: 'person' as const, id: h.holder }, sensitivity: h.sensitivity, truth: h.truth, claimSource: h.source })));
      expect(rumourFacts(OFF)).toEqual(before(OFF));
      expect(factsFor(OFF).some(f => f.keptBy !== undefined || f.hearsay !== undefined)).toBe(false);
      for (const r of [...claimEntries().rumours, NEAR]) expect(knownBy(r, OFF)).toEqual(driftOf(r, OFF));
      // A near rumour spreads as #1589 had it: the road can still carry it.
      expect(reachOf(NEAR, OFF).some(x => x.carriage === 'road')).toBe(true);
      // An insider below the gate says "not yet", as before.
      expect(resolve('kg-arvid', 'group:compact', 25, { facts: factsFor(OFF) })).toEqual({ kind: 'not-yet', fact: expect.objectContaining({ id: 'answer:kg-arvid:group:compact' }), trust: 50 });
      const after = askOnRoad(offGate, 'kg-arvid', 'group:compact', 25);
      expect(after.log.at(-1)!.text).toBe('Arvid looks at you a long moment. "Maybe. Ask me again when I know you better."');
      // And a run from before the switch reads it off.
      expect(featureOn(undefined, REACH_FEATURE)).toBe(false);
    });
  });
});

describe('The reach-and-secrets switch', () => {
  it('is a rules feature new with this issue, on in a new game', () => {
    expect(featureById(REACH_FEATURE)).toMatchObject({ kind: 'rules', stage: 'experimental', default: true, absent: false, issue: 1661 });
    expect(featureOn(ON, REACH_FEATURE)).toBe(true);
  });

  it('reach is of bent rumours: with `rumour-drift` off, the switch changes no rumour', () => {
    const first = { ...ON, 'rumour-drift': false };
    expect(rumourFacts(first)).toEqual(rumourFacts({ ...first, [REACH_FEATURE]: false }));
  });

  it('reach is seeded: the same facts every time, and a run keeps the same array', () => {
    expect(rumourFacts(ON)).toEqual(rumourFacts(ON));
    expect(factsFor({ ...ON })).toBe(factsFor(ON));
    expect(factsFor(OFF)).not.toBe(factsFor(ON));
  });

  it('nobody passes on a rumour about themself, and everyone it reached speaks to the same proposition', () => {
    const facts = factsFor(ON).filter(f => f.id.startsWith('rumour:'));
    expect(facts.some(f => f.id.startsWith('rumour:hedda-debt:') && f.scope.id === 'sm-hedda')).toBe(false);
    for (const f of facts) expect(propositionOfFact(f.id), f.id).toBe(f.id.split(':')[1]);
    expect(PROPOSITIONS['pass-wolves']).toBeDefined();
  });
});
