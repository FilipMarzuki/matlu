/**
 * Acceptance tests for #1611 (knowledge slice E, epic #1595): free questions match the knowledge
 * model's topics and scopes, and are answered through its resolution (scope, trust gates,
 * referral), People and culture questions through the world lore (#1590) with its voicing. Behind
 * the `knowledge-questions` rule switch; a run without it plays free questions as before (#1575).
 *
 * The game's facts today are people's own words and teachers' skills (slice A); village, region
 * and role facts come with slice C. So the scope scenarios pass their own facts in, through the
 * same functions the road calls, the way facts.test.ts and knowledge.test.ts do.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, ROUTE, type RoadState } from './road';
import { answerFor } from './asks';
import { FACTS, ROAD_REGION, resolve } from './facts';
import type { Fact } from './knowledge';
import { matchLore } from './culture-lore';
import { deflectionOf, matchQuestion } from './free-questions';
import { answerQuestion, isQuestionTopic, matchFreeQuestion } from './knowledge-questions';
import { personById } from './villages';
import { FEATURES, featureOn } from './features';
import { hollowfordGame } from '../artificer-play/fixtures';
import { apply, type Game } from '../artificer-play/session';

/** The switches a new game has with this slice: free questions, referrals and the knowledge model's matching. */
const ON = { 'free-questions': true, referrals: true, 'knowledge-questions': true } as const;

/** A Warden on the caravan road at Hollowford (the first village), with no focus and the given switches. */
function atHollowford(features: Record<string, boolean> | undefined, trust: Record<string, number> = {}): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-know-q', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, rations: 6 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let r = createRoad(from);
  for (let i = 0; i < 10 && r.leg < village; i++) r = endRoadDay(r);
  return { ...r, focus: null, trust: { ...r.trust, ...trust }, ...(features ? { features: { ...features } } : {}) };
}

/** On to Saltmere, the second village. */
function atSaltmere(features: Record<string, boolean>, trust: Record<string, number> = {}): RoadState {
  let r = atHollowford(features);
  const saltmere = ROUTE.findIndex(l => l.kind === 'village' && l.id === 'saltmere');
  for (let i = 0; i < 20 && r.leg < saltmere; i++) r = endRoadDay(r);
  return { ...r, trust: { ...r.trust, ...trust } };
}

const written = (before: RoadState, after: RoadState): string => after.log.slice(before.log.length).map(l => l.text).join(' ');

/**
 * Facts for wider scopes, as slice C will write them: one per scope the issue names. Each is
 * about a topic a question can name (the village, Mistheim at the road's end, healers).
 */
const SCOPED: readonly Fact[] = [
  { id: 'test:hollowford-mill', about: ['place:hollowford'], text: 'The mill wheel cracked two winters back; the goblins mended it.', scope: { kind: 'village', id: 'hollowford' }, sensitivity: 'public', truth: 'true' },
  { id: 'test:mistheim-road', about: ['place:mistheim'], text: 'The road down to Mistheim floods every thaw at the third bridge.', scope: { kind: 'region', id: ROAD_REGION }, sensitivity: 'guarded', truth: 'true' },
  { id: 'test:healers', about: ['role:healer'], text: 'A healer carries willow bark and clean linen, and never charges a child.', scope: { kind: 'role', id: 'healer' }, sensitivity: 'public', truth: 'true' },
];
const WITH_SCOPED = [...FACTS, ...SCOPED];

describe('A question about a village, region, People or role fact the asked person knows (#1611)', () => {
  it('matches a village fact and answers it at the village scope', () => {
    const topic = matchFreeQuestion('hf-maren', 'What happened in Hollowford?', [], ON, { facts: WITH_SCOPED });
    expect(topic).toBe('place:hollowford');
    const a = answerQuestion(personById('hf-maren')!, topic!, 0, [], { referrals: true, facts: WITH_SCOPED });
    expect(a.kind).toBe('told');
    expect(a.kind === 'told' && a.scope).toBe('village');
    expect(a.line).toContain('The mill wheel cracked');
  });

  it('matches a region fact, and holds its trust gate: not yet at 0, told at 25', () => {
    const topic = matchFreeQuestion('hf-tobin', 'Is the road to Mistheim safe?', [], ON, { facts: WITH_SCOPED });
    expect(topic).toBe('place:mistheim');
    const tobin = personById('hf-tobin')!;
    expect(answerQuestion(tobin, topic!, 0, [], { referrals: true, facts: WITH_SCOPED }).kind).toBe('not-yet');
    const told = answerQuestion(tobin, topic!, 25, [], { referrals: true, facts: WITH_SCOPED });
    expect(told.kind === 'told' && told.scope).toBe('region');
    expect(told.line).toContain('third bridge');
  });

  it('matches a role fact and answers it at the role scope', () => {
    const topic = matchFreeQuestion('hf-isa', 'What do healers carry?', [], ON, { facts: WITH_SCOPED });
    expect(topic).toBe('role:healer');
    const a = answerQuestion(personById('hf-isa')!, topic!, 0, [], { referrals: true, facts: WITH_SCOPED });
    expect(a.kind === 'told' && a.scope).toBe('role');
  });

  it('matches a People question through the world lore, played as the People’s topic, and answered on the road', () => {
    const q = 'What do the Bergfolk believe?';
    const topic = matchFreeQuestion('hf-orrin', q, [], ON);
    // Keeps the People's topic key (`group:Bergfolk`), with what about them it asked.
    expect(topic).toBe('group:Bergfolk/values');
    const lore = matchLore(q, personById('hf-orrin')!, 0)!;
    const before = atHollowford(ON);
    const after = runRoadAction(before, `question:hf-orrin:${topic}`);
    expect(written(before, after)).toContain(lore.claims[0].text);
    expect(after.asked?.['hf-orrin']).toContain(topic);
  });

  it('matches a culture question, played as `culture:<id>`', () => {
    // Tobin is caravan-folk; asked how his own people mourn, he answers from his culture first.
    const topic = matchFreeQuestion('hf-tobin', 'What do you do when someone dies?', [], ON);
    expect(topic).toMatch(/^culture:caravan-folk(\+group:Goblins)?\/mourning$/);
  });

  it('still answers a person’s own words first: the most specific fact wins', () => {
    expect(matchFreeQuestion('hf-maren', 'Are there goblins near the ford?', [], ON)).toBe('group:compact');
    expect(matchFreeQuestion('hf-orrin', 'Where do people get ore?', [], ON)).toBe('material:iron');
  });
});

describe('People and culture questions respect voicing at the current trust (#1611)', () => {
  // Maren is Markfolk; her People's view of the Fae is one they keep back from strangers.
  const q = 'What do your people think of the Fae?';

  it('holds a guarded view back from a stranger: not yet', () => {
    const topic = matchFreeQuestion('hf-maren', q, [], ON)!;
    expect(topic).toBe('group:Markfolk/view/group:Fae');
    const at0 = matchLore(q, personById('hf-maren')!, 0)!;
    expect(at0.claims).toEqual([]);
    const before = atHollowford(ON, { 'hf-maren': 0 });
    const after = runRoadAction(before, `question:hf-maren:${topic}`);
    expect(written(before, after)).toMatch(/Ask me again when I know you better/);
    expect(after.asked?.['hf-maren'] ?? []).not.toContain(topic);
  });

  it('says it once trust opens it, as the lore voices it at that trust', () => {
    const topic = matchFreeQuestion('hf-maren', q, [], ON)!;
    const lore = matchLore(q, personById('hf-maren')!, 75)!;
    expect(lore.claims.length).toBeGreaterThan(0);
    const before = atHollowford(ON, { 'hf-maren': 75 });
    const after = runRoadAction(before, `question:hf-maren:${topic}`);
    expect(written(before, after)).toContain(lore.claims[0].text);
  });
});

describe('A question about something they don’t know, that someone nearby does (#1611)', () => {
  it('matches the topic and refers the player to who would know', () => {
    // Hedda knows nothing of iron; someone in Saltmere or on the caravan does.
    const topic = matchFreeQuestion('sm-hedda', 'Where do I get iron ore?', [], ON);
    expect(topic).toBe('material:iron');
    const referral = resolve('sm-hedda', 'material:iron', 0);
    expect(referral?.kind === 'unknown' && referral.referral).toBeTruthy();
    const who = personById((referral as { referral: string }).referral)!;
    const before = atSaltmere(ON);
    const after = runRoadAction(before, 'question:sm-hedda:material:iron');
    expect(written(before, after)).toContain(`${who.name} would know`);
    expect(after.questioned).toContain('sm-hedda');
  });

  it('deflects instead, with referrals off: there is no one to send you to', () => {
    const off = { ...ON, referrals: false };
    expect(matchFreeQuestion('sm-hedda', 'Where do I get iron ore?', [], off)).toBeNull();
    const before = atSaltmere(off);
    const after = runRoadAction(before, 'question:sm-hedda:material:iron');
    expect(after.log.at(-1)?.text).toBe(deflectionOf('sm-hedda', 'Hedda'));
  });
});

describe('A question the model can’t match (#1611)', () => {
  it('deflects as today', () => {
    expect(matchFreeQuestion('hf-orrin', 'What is your favourite colour?', [], ON)).toBeNull();
    expect(matchFreeQuestion('hf-orrin', 'Orrin, how are you today?', [], ON)).toBeNull();
    // An opinion of something the lore doesn't know isn't a question about their ways.
    expect(matchFreeQuestion('sm-hedda', 'Hedda, what do you think of the caravan?', [], ON)).toBeNull();
    const before = atHollowford(ON);
    const after = runRoadAction(before, 'question:hf-orrin');
    expect(after.log.at(-1)?.text).toBe(deflectionOf('hf-orrin', 'Orrin'));
  });

  it('deflects a topic key that isn’t one, however it was sent', () => {
    const before = atHollowford(ON);
    const after = runRoadAction(before, 'question:hf-orrin:group:Bergfolk/nonsense');
    expect(after.log.at(-1)?.text).toBe(deflectionOf('hf-orrin', 'Orrin'));
    // Someone else's People's lore isn't theirs to tell: Orrin isn't Markfolk.
    const other = runRoadAction(atHollowford(ON), 'question:hf-orrin:group:Markfolk/values');
    expect(other.log.at(-1)?.text).toBe(deflectionOf('hf-orrin', 'Orrin'));
  });
});

describe('Any free question is stored as `question:<person>[:<topic>]`, without its words (#1611)', () => {
  const withSwitches = (g: Game): Game => ({ ...g, app: { ...g.app, road: { ...g.app.road!, features: { ...ON } } } });

  it.each([
    ['hf-orrin', 'Where do people round here get ore?'],
    ['hf-orrin', 'What do the Bergfolk believe?'],
    ['hf-maren', 'What do your people think of the Fae?'],
    ['hf-tobin', 'What is the meaning of life?'],
    ['hf-isa', 'Who teaches hunting around here?'],
  ])('%s: "%s"', (person, question) => {
    const r = apply(withSwitches(hollowfordGame()), { ask: { person, question } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const move = (r.played as { do: string }).do;
    // A person id, then at most a topic key: no spaces, so no sentence can ride along.
    expect(move).toMatch(/^question:[a-z]+-[a-z]+(?::\S+)?$/);
    expect(move).not.toContain(question);
    const topic = move.split(/^question:[a-z]+-[a-z]+:?/)[1] || null;
    expect(r.asked?.topic ?? null).toBe(topic);
    if (topic) expect(isQuestionTopic(person, topic)).toBe(true);
  });
});

describe('The switch, and runs from before it (#1611)', () => {
  it('registers knowledge-questions as an experimental rule feature, on in new games, off for runs from before it', () => {
    expect(FEATURES.find(f => f.id === 'knowledge-questions')).toMatchObject({ stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1611 });
    expect(featureOn(undefined, 'knowledge-questions')).toBe(false);
  });

  it('matches as before with it off', () => {
    const off = { 'free-questions': true, referrals: true };
    for (const [pid, q] of [['hf-orrin', 'What do the Bergfolk believe?'], ['sm-hedda', 'Where do I get iron ore?'], ['hf-orrin', 'Where do people get ore?']] as const) {
      expect(matchFreeQuestion(pid, q, [], off)).toBe(matchQuestion(pid, q));
    }
  });

  it('replays an old run’s question exactly: answered past the gates, as #1575 played it', () => {
    const iron = answerFor('hf-orrin', 'material:iron')!;
    expect(iron.at).toBeGreaterThan(0);
    const before = atHollowford(undefined, { 'hf-orrin': 0 });
    const after = runRoadAction(before, 'question:hf-orrin:material:iron');
    expect(written(before, after)).toContain(iron.text);
    // With the switch on, the same move meets the gate.
    const gated = atHollowford(ON, { 'hf-orrin': 0 });
    const g2 = runRoadAction(gated, 'question:hf-orrin:material:iron');
    expect(written(gated, g2)).not.toContain(iron.text);
    expect(written(gated, g2)).toMatch(/Ask me again when I know you better/);
  });
});
