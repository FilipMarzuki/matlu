/**
 * #1658 — history in play, told better: eyewitnesses say so, the caravan knows the legends, the
 * best story first, events named. Behind the `history-retold` rule switch, on top of
 * `history-in-play` (#1656, history-in-play.test.ts, which keeps #1656's answers with it off).
 *
 * Warden `w-hist-1`, as in history-in-play.test.ts: Hollowford's change of lord in year 80 (Ulf II
 * of Fernhurst) is told in the same words by Isa (Lövfolk, who saw it: 0 retellings) and Maren
 * (Riksfolk, 2 retellings), and its country (the Wrenwood country) has a famine of year 18 only
 * the best-placed still tell. Warden `w-hist-341`: Hollowford's great plague of year 22 (129
 * years ago, killing 500), which Tobin knows, beside his own part in a quarrel at the ford-moot
 * three years ago (a person-scope fact, which #1656 answers "what happened here?" with). Both
 * found by searching Warden ids for such a history.
 *
 * Each history is told once in `beforeAll` (the engine's 150 years, a quarter to half a second,
 * more on a busy CI runner) and handed in as the page hands its worker's in (`keepHistory`).
 *
 * The issue's Given/When/Then, mapped to the tests that cover them:
 * 1. Eyewitness hedge: an eyewitness teller and a non-witness neighbour telling the same event,
 *    both asked → "I saw it myself" for the witness, "Everyone says" for the other → "1. …".
 * 2. Caravan, legend: a country legend, the caravan asked → it tells it → "2. …".
 * 3. Caravan, local detail: a village-scope event, the caravan asked → it doesn't know it → "3. …".
 * 4. Most memorable first: a person who knows a small recent event and a large old plague, asked
 *    "what happened here" → the plague → "4. …".
 * 5. Named labels: a country event → its journal label names the event kind → "5. …".
 * The switch's place in the registry is pinned in features.test.ts and artificer-play/features.test.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { knowerOf, resolve } from './facts';
import { ruleFeatures } from './features';
import { keepHistory, memorabilityOf, pastEventOf, playFacts } from './history-in-play';
import { knows } from './knowledge';
import { matchFreeQuestion } from './knowledge-questions';
import { createRegion1, type Region1State } from './region1';
import { createRoad, endRoadDay, journalNow, runRoadAction, villageOf, type RoadState, type RoadActionId } from './road';
import { createVitals } from './vitality';
import { seedOf } from './rng';
import { runHistory } from './world/history';
import type { ReachHistory } from './world/history-format';

const WARDEN = 'w-hist-1';
const PLAGUE_WARDEN = 'w-hist-341';
const ON = ruleFeatures();
/** #1656 as it shipped, for the contrast: what a run saved before this switch keeps. */
const BEFORE = { ...ON, 'history-retold': false };

let history: ReachHistory;
beforeAll(() => {
  history = runHistory(seedOf(WARDEN));
  keepHistory(history);
  keepHistory(runHistory(seedOf(PLAGUE_WARDEN)));
}, 60_000);

/** A Warden out of the Reach in a world with `features`, on the road. */
function setOut(features: Record<string, boolean>, warden = WARDEN): RoadState {
  const s = createRegion1({}, undefined, { id: warden, name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, features } },
  };
  return createRoad(from);
}

/** Ridden on to Hollowford. */
function atHollowford(features: Record<string, boolean>, warden = WARDEN): RoadState {
  let r = setOut(features, warden);
  for (let i = 0; i < 30 && villageOf(r) !== 'hollowford'; i++) r = endRoadDay(r);
  expect(villageOf(r)).toBe('hollowford');
  return r;
}

/** Between villages, with the caravan's people around you. */
function onTheRoad(features: Record<string, boolean>): RoadState {
  let r = setOut(features);
  for (let i = 0; i < 30 && villageOf(r); i++) r = endRoadDay(r);
  expect(villageOf(r)).toBeFalsy();
  return r;
}

/** A free question, as the page and the API ask it: matched against the run's facts, played as the topic. */
function question(r: RoadState, pid: string, text: string): { topic: string | null; next: RoadState; line: string } {
  const topic = matchFreeQuestion(pid, text, r.asked?.[pid] ?? [], r.features, { facts: playFacts(r) });
  const next = runRoadAction(r, `question:${pid}${topic ? `:${topic}` : ''}` as RoadActionId);
  return { topic, next, line: next.log.slice(r.log.length).map(l => l.text).find(t => t.startsWith('You ask') || t.includes('thinks it over') || t.includes('shakes')) ?? next.log.slice(r.log.length).map(l => l.text).join(' ') };
}

const SUCCESSION = 'history:hollowford:80:1';

describe('#1658 history in play, told better', () => {
  it('1. an eyewitness says "I saw it myself"; a neighbour telling the same words, "Everyone says"', () => {
    const played = (features: Record<string, boolean>) => {
      let r = atHollowford(features);
      const isa = question(r, 'hf-isa', 'Tell me about the house of Fernhurst.');
      expect(isa.topic).toBe('past:house:fernhurst');
      r = isa.next;
      r = question(r, 'hf-maren', 'Tell me about the house of Fernhurst.').next;
      return journalNow(r)!.find(e => e.proposition === `past|${SUCCESSION}`)!;
    };
    // One telling, the same words for both: Isa's Lövfolk saw it (0 retellings), Maren's Riksfolk didn't (2).
    const fact = playFacts(atHollowford(ON)).find(f => f.id === SUCCESSION)! as { heldBy?: { people: string; retellings: number }[] };
    expect(fact.heldBy?.find(h => h.people === 'Lövfolk')?.retellings).toBe(0);
    expect(fact.heldBy?.find(h => h.people === 'Riksfolk')?.retellings).toBeGreaterThan(0);
    const entry = played(ON);
    expect(entry.claims.map(c => [c.person, c.hedge])).toEqual([['hf-isa', 'I saw it myself'], ['hf-maren', 'Everyone says']]);
    expect(entry.claims[0].text).toBe(entry.claims[1].text);
    // A witness is a source of their own, so the two agree as two sources.
    expect(entry.status).toBe('corroborated');
    // Before the switch, both say "Everyone says": one village's talk.
    expect(played(BEFORE).claims.map(c => c.hedge)).toEqual(['Everyone says', 'Everyone says']);
  });

  it('2. the caravan tells a country legend', () => {
    const r = onTheRoad(ON);
    // The Wrenwood country's famine of year 18 is a legend (133 years, depth 3): Bodil, the caravan
    // master, reaches deepest into the region, and tells it as the country does.
    const famine = playFacts(r).find(f => f.id === 'region:wrenwood-country:18:0@caravan')!;
    expect(famine.tellers).toContain('cv-bodil');
    expect(famine.depth).toBe(3);
    const bodil = question(r, 'cv-bodil', 'Was there ever a famine?');
    expect(bodil.topic).toBe('past:famine');
    expect(bodil.line).toBe(`You ask Bodil about the famine. Bodil: "${famine.text}"`);
    // Filed with the villages' tellings of the same famine, under the country's happening.
    expect(journalNow(bodil.next)!.map(e => e.proposition)).toEqual(['past|region:wrenwood-country:18:0']);
    // Before the switch the caravan knows no country's history: the question can't be placed.
    expect(question(onTheRoad(BEFORE), 'cv-bodil', 'Was there ever a famine?').topic).toBeNull();
  });

  it('3. the caravan doesn\'t know a village-scope event', () => {
    const r = onTheRoad(ON);
    const bodil = knowerOf('cv-bodil')!;
    // Hollowford's change of lord is the village's own: no traveller knows it, nor any of a
    // village's events, its recent past, or its country's lords and feuds.
    const local = playFacts(r).filter(f => /^(history|local):/.test(f.id) || /^region:[^:]+:(lord|feud|leading-house)/.test(f.id));
    expect(local.some(f => f.id === SUCCESSION)).toBe(true);
    expect(local.filter(f => f.scope.kind !== 'region' && knows(bodil, f))).toEqual([]);
    expect(local.filter(f => f.id.startsWith('region:') && knows(bodil, f))).toEqual([]);
    // Asked about the house the change of lord touches, or what happened in a village, he knows nothing of it.
    const facts = playFacts(r);
    expect(resolve('cv-bodil', 'past:house:fernhurst', Infinity, { facts })?.kind).toBe('unknown');
    expect(resolve('cv-bodil', 'past:here', Infinity, { facts })?.kind).toBe('unknown');
    // (Fernhurst the place is in his country's news, bandits on its roads: that he can tell.)
    const asked = question(r, 'cv-bodil', 'Tell me about the house of Fernhurst.');
    expect(asked.line).not.toContain('Ulf II of Fernhurst took');
  });

  it('4. "what happened here?" gets the most memorable story a person knows: the great plague, not a recent quarrel', () => {
    const plague = 'history:hollowford:22:0';
    const facts = playFacts(atHollowford(ON, PLAGUE_WARDEN));
    const tobinKnows = facts.filter(f => f.about.includes('past:here') && knows(knowerOf('hf-tobin')!, f));
    // Tobin knows both: his part in the quarrel three years ago (his own telling, which outranks a
    // village's), and the plague 129 years ago that killed 500.
    const quarrel = tobinKnows.find(f => f.id === 'local:hollowford:dispute:hf-tobin')!;
    const told = tobinKnows.find(f => f.id === plague || f.id.startsWith(`${plague}:told-by:`))!;
    expect(quarrel.text).toMatch(/^3 years ago/);
    expect(told.text).toMatch(/^129 years ago.*pestilence/);
    expect(told.memorable!).toBeGreaterThan(quarrel.memorable!);
    // Memorability: kind, then a point per hundred dead, then the older on a tie.
    expect(memorabilityOf('PLAGUE', 'killing 500.', 129)).toBeCloseTo(3 + 5, 3);
    expect(memorabilityOf('SUCCESSION', 'took the hall', 10)).toBeCloseTo(2, 3);
    expect(memorabilityOf('SOLAR_ECLIPSE', 'The sun went dark', 73)).toBeGreaterThan(memorabilityOf('SOLAR_ECLIPSE', 'The sun went dark', 72));
    const asked = question(atHollowford(ON, PLAGUE_WARDEN), 'hf-tobin', 'What happened here?');
    expect(asked.topic).toBe('past:here');
    expect(asked.line).toContain(told.text);
    // Before the switch, his own telling of the quarrel answers, as #1656 played it: guarded, so not yet.
    expect(quarrel.sensitivity).not.toBe('public');
    expect(question(atHollowford(BEFORE, PLAGUE_WARDEN), 'hf-tobin', 'What happened here?').line).toMatch(/Ask me again when I know you better/);
    // And a question naming an event still beats "what happened here" (#1656's tie-break, unchanged).
    expect(question(atHollowford(ON, PLAGUE_WARDEN), 'hf-tobin', 'What happened here in the plague?').topic).toBe('past:plague');
  });

  it('5. a country event\'s journal label names the event kind', () => {
    const r = atHollowford(ON);
    const facts = playFacts(r);
    expect(pastEventOf(facts.find(f => f.id === 'region:wrenwood-country:18:0@hollowford')!)!.label).toBe('The famine in the Wrenwood country, year 18');
    // Hollowford's plague is the country's too, so it's named as the country's.
    expect(pastEventOf(facts.find(f => f.id === 'history:hollowford:68:0')!)!.label).toBe('The plague in the Wrenwood country, year 68');
    expect(pastEventOf(facts.find(f => f.id === 'region:wrenwood-country:68:2@caravan')!)!.label).toBe('The plague in the Wrenwood country, year 68');
    // A village's own event is named by its village.
    expect(pastEventOf(facts.find(f => f.id === SUCCESSION)!)!.label).toBe('The new lord in Hollowford, year 80');
    // And the journal shows it so.
    const asked = question(r, 'hf-isa', 'What happened in the plague?');
    expect(journalNow(asked.next)!.map(e => e.label)).toEqual(['The plague in the Wrenwood country, year 68']);
    // Before the switch, by where alone.
    expect(pastEventOf(playFacts(atHollowford(BEFORE)).find(f => f.id === 'history:hollowford:68:0')!)!.label).toBe('The Wrenwood country, year 68');
  });
});
