/**
 * The knowledge model's prototype (spike #1577, docs/knowledge-model-design.md): a handful of facts
 * across world, region, village, role, organisation and person scopes, and four people from the
 * road, one of them confidently wrong and one who lies. The data lives here, not in the game (the
 * game's facts are in facts.ts, #1609): these test the model alone.
 */

import { describe, it, expect } from 'vitest';
import { answer, knows, gateOf, type Fact, type Knower, type Org } from './knowledge';

const ORGS: Record<string, Org> = {
  compact: { id: 'compact', name: 'the Compact', secrecy: 'secret' },
  'compact-of-knowing': { id: 'compact-of-knowing', name: "the Pandor's Compact of Knowing", secrecy: 'bound-to-tell' },
};

const FACTS: Fact[] = [
  { id: 'road-ends', about: ['place:mistheim'], scope: { kind: 'world' }, sensitivity: 'public', truth: 'true', text: 'Every caravan ends in Mistheim.' },
  // A rumour everyone on the road repeats, and it's wrong: the price rose for another reason.
  { id: 'iron-war', about: ['material:iron'], scope: { kind: 'region', id: 'north-road' }, sensitivity: 'public', truth: 'false', text: 'Iron doubled in price because of a war in the passes.' },
  { id: 'mill-wheel', about: ['place:hollowford'], scope: { kind: 'village', id: 'hollowford' }, sensitivity: 'public', truth: 'true', depth: 2, text: 'The mill wheel cracked two springs ago, and goblins from the quarry mended it.' },
  { id: 'iron-heat', about: ['material:iron', 'role:smith'], scope: { kind: 'role', id: 'smith' }, sensitivity: 'guarded', truth: 'true', text: 'Heat iron to the colour of a fire going out, never white.', lead: 'kg-sabine' },
  { id: 'compact-news', about: ['group:compact'], scope: { kind: 'org', id: 'compact' }, sensitivity: 'guarded', truth: 'true', text: 'The Compact pays in news: a turned well, a closed road, we hear it first.' },
  { id: 'compact-sells', about: ['group:compact'], scope: { kind: 'org', id: 'compact-of-knowing' }, sensitivity: 'public', truth: 'true', text: 'The goblins sell us what their Delvers find, and we must tell anyone who asks.' },
  { id: 'orrin-sister', about: ['person:hf-orrin'], scope: { kind: 'person', id: 'hf-orrin' }, sensitivity: 'private', truth: 'true', text: "My sister's girl hunts the high streams." },
];

const base = { region: 'north-road', orgs: {} } as const;
const ORRIN: Knower = { ...base, id: 'hf-orrin', name: 'Orrin', home: 'hollowford', people: 'Bergfolk', culture: 'ridgefolk', role: 'smith', skill: 'woodcraft' };
const MAREN: Knower = { ...base, id: 'hf-maren', name: 'Maren', home: 'hollowford', people: 'Markfolk', culture: 'fieldborn', role: 'elder', reach: { village: 3 } };
// Tobin keeps Compact business to himself, and says so in a way that isn't true, until he trusts you.
const TOBIN: Knower = {
  ...base, id: 'hf-tobin', name: 'Tobin', home: 'hollowford', people: 'Goblins', culture: 'bazaar-folk', role: 'trader', orgs: { compact: 2 }, reach: { region: 3 },
  lies: [{ about: 'group:compact', text: 'The Compact? A story big folk tell about goblins.', why: 'protects his own', until: 50 }],
};
const ANSELM: Knower = { ...base, id: 'sm-anselm', name: 'Anselm', home: 'saltmere', people: 'Pandor', culture: 'archive-keepers', role: 'teacher', orgs: { 'compact-of-knowing': 1 } };
const EVERYONE = [ORRIN, MAREN, TOBIN, ANSELM];
const ask = (k: Knower, topic: string, trust: number) => answer(k, topic, trust, FACTS, ORGS, EVERYONE);

describe('What people know (#1577 prototype)', () => {
  it('answers with the most specific fact: the smith’s craft before the road’s rumour', () => {
    const r = ask(ORRIN, 'material:iron', 30);
    expect(r).toMatchObject({ kind: 'told', fact: { id: 'iron-heat' } });
    expect(r.kind === 'told' && r.fact.lead).toBe('kg-sabine');
  });

  it('holds a guarded fact until trust opens it', () => {
    expect(ask(ORRIN, 'material:iron', 10)).toMatchObject({ kind: 'not-yet', trust: 25 });
    expect(ask(ORRIN, 'person:hf-orrin', 30)).toMatchObject({ kind: 'not-yet', trust: 50 });
    expect(ask(ORRIN, 'person:hf-orrin', 60)).toMatchObject({ kind: 'told', hedge: 'I saw it myself' });
  });

  it('lets someone be confidently wrong: the game knows, the answer doesn’t say', () => {
    const r = ask(MAREN, 'material:iron', 0);
    expect(r).toMatchObject({ kind: 'told', fact: { id: 'iron-war', truth: 'false' }, hedge: 'Everyone says' });
  });

  it('lets someone lie for a reason, until they trust you; then the organisation’s secrecy still holds', () => {
    const lied = ask(TOBIN, 'group:compact', 30);
    expect(lied).toMatchObject({ kind: 'lied', why: 'protects his own', withheld: { id: 'compact-news' } });
    // Past the lie, the Compact keeps its business secret from outsiders: guarded becomes secret.
    expect(gateOf(FACTS.find(f => f.id === 'compact-news')!, ORGS)).toBe(75);
    expect(ask(TOBIN, 'group:compact', 60)).toMatchObject({ kind: 'not-yet', trust: 75 });
    expect(ask(TOBIN, 'group:compact', 80)).toMatchObject({ kind: 'told', fact: { id: 'compact-news' } });
  });

  it('opens every gate for an organisation bound to tell: the Pandor tell anyone who asks', () => {
    expect(ask(ANSELM, 'group:compact', 0)).toMatchObject({ kind: 'told', fact: { id: 'compact-sells' } });
  });

  it('knows as deep as their place reaches: the elder knows the village’s past, the trader passing through doesn’t', () => {
    const mill = FACTS.find(f => f.id === 'mill-wheel')!;
    expect(knows(MAREN, mill)).toBe(true);
    expect(knows(TOBIN, mill)).toBe(false);
    // Knowing nothing, Tobin sends you to someone who would: the elder.
    expect(ask(TOBIN, 'place:hollowford', 90)).toEqual({ kind: 'unknown', referral: 'hf-maren' });
  });

  it('sends you to the most specific knower, and to no one for what nobody here knows', () => {
    expect(ask(MAREN, 'role:smith', 90)).toEqual({ kind: 'unknown', referral: 'hf-orrin' });
    expect(ask(MAREN, 'place:mistheim', 0)).toMatchObject({ kind: 'told', fact: { id: 'road-ends' } });
    expect(ask(ORRIN, 'group:dyprike', 90)).toEqual({ kind: 'unknown', referral: null });
  });
});
