/**
 * #1656 — road people answer from their place's remembered and regional history (knowledge slice F).
 *
 * One Warden throughout, `w-hist-1`: their seed's history gives Hollowford a plague 83 years ago
 * (year 68) that the village's long-lived Lövfolk healer (Isa) and Bergfolk smith (Orrin) saw, and
 * its short-lived human elder (Maren, Riksfolk with humans on the road) only heard of, bent
 * ("killing 400" for 326); and its country (the Wrenwood country) a famine 133 years ago that
 * only its trader (Tobin, who reaches deepest into the region) and Isa still tell. Found by
 * searching Warden ids for such a history, so the scenarios have something to show.
 *
 * Telling a history runs the engine's 150 years (a quarter to half a second, more on a busy CI
 * runner), so each one is told once in `beforeAll`, with room to spare, and handed in as the page
 * hands its worker's in (`keepHistory`).
 *
 * The issue's Given/When/Then, mapped to the tests that cover them:
 * 1. A road person's village remembers an event; asked about it, they tell it as their People and
 *    culture remember it → "1. tells an event as the teller's People and culture remember it".
 * 2. Two Peoples in one mixed village, an event beyond human living memory: the long-lived one
 *    tells it `true`, the short-lived one a bent `rumour`, and the journal holds both under their
 *    tellers → "2. a mixed village's long- and short-lived tell one plague two ways…".
 * 3. Someone who doesn't know a regional event answers by the not-known rules: candour, and a
 *    referral where one exists → "3. someone who doesn't know a regional event…".
 * 4. The switch off: answers, facts and the journal as today's, for the same seed → "4. with the
 *    switch off…".
 * 5. The same seed twice, or a save reloaded from JSON: the same answers → "5. the same seed…".
 * The switch's place in the registry is pinned in features.test.ts and artificer-play/features.test.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { factsFor } from './facts';
import { featureOn, ruleFeatures } from './features';
import { forgetHistories, historyFacts, keepHistory, pastEventOf, playFacts } from './history-in-play';
import { matchFreeQuestion } from './knowledge-questions';
import { deflectionOf } from './free-questions';
import { createRegion1, type Region1State } from './region1';
import { createRoad, endRoadDay, journalNow, runRoadAction, villageOf, type RoadState, type RoadActionId } from './road';
import { createVitals } from './vitality';
import { seedOf } from './rng';
import { runHistory } from './world/history';
import { remembered } from './world/remembered';
import type { ReachHistory } from './world/history-format';
import { observeRoad } from '../artificer-ai/observe';
import { apply, gameFrom, view, type Game } from '../artificer-play/session';

const WARDEN = 'w-hist-1';
// #1656 as it shipped: runs saved before #1658's `history-retold` keep these answers (history-retold.test.ts has #1658's).
const ON = { ...ruleFeatures(), 'history-retold': false };
const OFF = { ...ON, 'history-in-play': false };
const FLAT = { ...ON, 'old-history-drift': false };
const PLAGUE = 'history:hollowford:68:0';

let history: ReachHistory;
let again: ReachHistory;
beforeAll(() => {
  history = runHistory(seedOf(WARDEN));
  // The same seed told a second time, from scratch: scenario 5.
  again = runHistory(seedOf(WARDEN));
  keepHistory(history);
}, 60_000);

/** The Warden out of the Reach in a world with `features`, ridden on to Hollowford. */
function atHollowford(features: Record<string, boolean>): RoadState {
  const s = createRegion1({}, undefined, { id: WARDEN, name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = {
    ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
    config: { ...s.config, world: { ...s.config.world, features } },
  };
  let r = createRoad(from);
  for (let i = 0; i < 30 && villageOf(r) !== 'hollowford'; i++) r = endRoadDay(r);
  expect(villageOf(r)).toBe('hollowford');
  return r;
}

/** A free question, as the page and the API ask it: matched against the run's facts, played as the topic. */
function question(r: RoadState, pid: string, text: string, trust?: number): { topic: string | null; next: RoadState; line: string } {
  const at = trust === undefined ? r : { ...r, trust: { ...r.trust, [pid]: trust } };
  const topic = matchFreeQuestion(pid, text, at.asked?.[pid] ?? [], at.features, { facts: playFacts(at) });
  const next = runRoadAction(at, `question:${pid}${topic ? `:${topic}` : ''}` as RoadActionId);
  return { topic, next, line: next.log.slice(at.log.length).map(l => l.text).find(t => t.startsWith('You ask') || t.includes('thinks it over')) ?? '' };
}

/** The plague of year 68 as Hollowford remembers it: every telling, by who tells it. */
const tellingsOf = (features: Record<string, boolean>) =>
  remembered(history, undefined, undefined, features).villages.find(v => v.village === 'hollowford')!.facts.filter(f => f.id === PLAGUE || f.id.startsWith(`${PLAGUE}:told-by:`));
const heldBy = (features: Record<string, boolean>, people: string) => tellingsOf(features).find(f => f.heldBy?.some(h => h.people === people))!;

describe('#1656 road people answer from their place\'s history', () => {
  it('1. tells an event as the teller\'s People and culture remember it', () => {
    const r = atHollowford(ON);
    const orrin = question(r, 'hf-orrin', 'What happened in the plague?');
    expect(orrin.topic).toBe('past:plague');
    // Orrin is Bergfolk (240 years): he saw it, so he tells it as it was.
    const bergfolk = heldBy(ON, 'Bergfolk');
    expect(bergfolk.truth).toBe('true');
    // (What you make of how they say it, journal.ts `readsAsLie`, may follow: it's the Warden's read, not their words.)
    expect(orrin.line.startsWith(`You ask Orrin about the plague. Orrin: "${bergfolk.text}"`)).toBe(true);
    // Maren (Riksfolk, as the run plays her) tells her People's telling, not his.
    const maren = question(r, 'hf-maren', 'Tell me about the plague.');
    expect(maren.line.startsWith(`You ask Maren about the plague. Maren: "${heldBy(ON, 'Riksfolk').text}"`)).toBe(true);
    expect(maren.line).not.toContain(bergfolk.text);
    // Without old history bending, everyone tells it as the history does: one telling, the engine's words.
    const flat = tellingsOf(FLAT);
    expect(flat).toHaveLength(1);
    expect(question(atHollowford(FLAT), 'hf-maren', 'Tell me about the plague.').line.startsWith(`You ask Maren about the plague. Maren: "${flat[0].text}"`)).toBe(true);
  });

  it('2. a mixed village\'s long- and short-lived tell one plague two ways, and the journal holds both under their tellers', () => {
    let r = atHollowford(ON);
    const maren = question(r, 'hf-maren', 'What happened in the plague?');
    r = maren.next;
    const isa = question(r, 'hf-isa', 'What happened in the plague?');
    r = isa.next;
    const lovfolk = heldBy(ON, 'Lövfolk'), riksfolk = heldBy(ON, 'Riksfolk');
    // Beyond human living memory (40 years), within the Lövfolk's: Isa's is the eyewitness telling.
    expect(lovfolk.truth).toBe('true');
    expect(riksfolk.truth).toBe('rumour');
    expect(riksfolk.text).not.toBe(lovfolk.text);
    expect(isa.line).toContain(lovfolk.text);
    // The country tells the same plague (world/remembered.ts `sameEvent`), so the journal files it
    // under the country's happening, where another village's telling of it would go too.
    const happening = pastEventOf(playFacts(r).find(f => f.id === PLAGUE)!)!;
    expect(happening).toEqual({ proposition: 'past|region:wrenwood-country:68:2', label: 'The Wrenwood country, year 68' });
    // The clash is flagged as it's heard, as any two accounts that don't agree are.
    expect(r.log.map(l => l.text)).toContain('That doesn\'t square with what Maren told you about the Wrenwood country, year 68. Your journal has both.');
    const entry = journalNow(r)!.find(e => e.proposition === happening.proposition)!;
    expect(entry.label).toBe(happening.label);
    expect(entry.status).toBe('contradicted');
    expect(entry.claims.map(c => [c.person, c.text, c.truth])).toEqual([
      ['hf-maren', riksfolk.text, 'rumour'],
      ['hf-isa', lovfolk.text, 'true'],
    ]);
    // Maren says she heard it; and, as for any rumour, the journal never marks which is so.
    expect(entry.claims[0].hedge).toBe('I heard');
    expect(entry.claims.every(c => c.right === undefined)).toBe(true);
    // The AI's view of the road shows the same journal.
    const seen = observeRoad(r);
    expect(seen).toContain('The Wrenwood country, year 68 — CONTRADICTED');
    expect(seen).toContain(`Maren (I heard): "${riksfolk.text}"`);
    expect(seen).toContain(`Isa (Everyone says): "${lovfolk.text}"`);
  });

  it('3. someone who doesn\'t know a regional event answers by the not-known rules: a referral, or a deflection', () => {
    const r = atHollowford(ON);
    // The Wrenwood country's famine of year 18 is a legend only those who reach deepest into the
    // region still tell (depth 3): Tobin the trader does; Orrin, the smith, doesn't.
    const facts = playFacts(r);
    const famine = facts.filter(f => f.about.includes('past:famine') && f.id.endsWith('@hollowford'));
    expect(famine.length).toBeGreaterThan(0);
    const orrin = question(r, 'hf-orrin', 'Was there ever a famine?');
    expect(orrin.topic).toBe('past:famine');
    expect(orrin.line).toBe('You ask Orrin about the famine. Orrin thinks, and shakes their head. "I couldn\'t tell you — Tobin would know."');
    // Tobin does know, and tells his own People's telling.
    const tobin = question(r, 'hf-tobin', 'Was there ever a famine?');
    expect(tobin.line).toContain('Famine struck');
    expect(tobin.line).toContain(famine.find(f => f.tellers?.includes('hf-tobin'))!.text);
    // Referrals off: nobody to name, so the question isn't placed and they deflect, word for word as before.
    const alone = question(atHollowford({ ...ON, referrals: false }), 'hf-orrin', 'Was there ever a famine?');
    expect(alone.topic).toBeNull();
    expect(alone.line).toBe(deflectionOf('hf-orrin', 'Orrin'));
    // And what they know but you haven't earned stays behind its gate: a feud between houses is guarded.
    expect(question(r, 'hf-orrin', 'Have there been any wars?', 0).line).toMatch(/Ask me again when I know you better/);
    expect(question(r, 'hf-orrin', 'Have there been any wars?', 25).line).toMatch(/fought over|at odds/);
  });

  it('4. with the switch off, the facts, answers and journal are today\'s, for the same seed', () => {
    const r = atHollowford(OFF);
    expect(featureOn(undefined, 'history-in-play')).toBe(false);
    // The very array `factsFor` gives, history kept or not.
    expect(playFacts(r)).toBe(factsFor(OFF));
    const play = (s: RoadState) => {
      for (const [pid, q] of [['hf-maren', 'What happened in the plague?'], ['hf-isa', 'What happened here long ago?'], ['hf-orrin', 'Was there ever a famine?'], ['hf-tobin', 'Where does the iron here come from?']] as const) s = question(s, pid, q).next;
      return s;
    };
    const kept = play(r);
    forgetHistories();
    try {
      // No history anywhere: today's game exactly.
      expect(play(r)).toEqual(kept);
      expect(journalNow(play(r))).toEqual(journalNow(kept));
    } finally {
      keepHistory(history);
    }
    // And nobody tells of the plague: it isn't in any fact.
    expect(kept.log.map(l => l.text).join('\n')).not.toContain('pestilence');
  });

  it('5. the same seed twice, or a save reloaded from JSON, gives the same answers', () => {
    // The same seed's history told twice, and kept as the page keeps it (plain JSON): the same facts.
    expect(historyFacts(again, ON)).toEqual(historyFacts(history, ON));
    expect(historyFacts(JSON.parse(JSON.stringify(history)) as ReachHistory, ON)).toEqual(historyFacts(history, ON));
    const play = (r: RoadState, reload: boolean) => {
      const out: string[] = [];
      for (const [pid, q] of [['hf-maren', 'What happened in the plague?'], ['hf-isa', 'What happened in the plague?'], ['hf-tobin', 'Was there ever a famine?']] as const) {
        const a = question(r, pid, q);
        out.push(a.line);
        // A reload: the save read back from JSON, and the history from the page's storage.
        if (reload) { forgetHistories(); keepHistory(JSON.parse(JSON.stringify(history)) as ReachHistory); }
        r = reload ? JSON.parse(JSON.stringify(a.next)) as RoadState : a.next;
      }
      return { out, journal: journalNow(r) };
    };
    const once = play(atHollowford(ON), false);
    expect(play(atHollowford(ON), false)).toEqual(once);
    expect(play(atHollowford(ON), true)).toEqual(once);
    // The journal's happening is found again on the reloaded facts: every telling of the plague under one.
    const happening = pastEventOf(playFacts(atHollowford(ON)).find(f => f.id === PLAGUE)!)!.proposition;
    expect(once.journal!.find(e => e.proposition === happening)!.claims).toHaveLength(2);
    const tellings = playFacts(atHollowford(ON)).filter(f => f.id === PLAGUE || f.id.startsWith(`${PLAGUE}:told-by:`));
    expect(tellings.map(f => f.text)).toEqual(tellingsOf(ON).map(f => f.text));
    expect(tellings.every(f => pastEventOf(f)?.proposition === happening)).toBe(true);
  });

  it('5. the API plays a question the same way, and refuses nothing new', () => {
    const s = createRegion1({}, undefined, { id: WARDEN, name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
    const vitals = createVitals({ condition: 90 });
    const sim: Region1State = {
      ...s, day: 61, vitals, tools: [], stores: { ...s.stores, rawFood: 30, water: 30 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
      config: { ...s.config, world: { ...s.config.world, features: ON } },
    };
    let g: Game = gameFrom({ sim, queue: [], stage: 'reach' }, WARDEN);
    const must = (m: Parameters<typeof apply>[1]) => { const r = apply(g, m); if (!r.ok) throw new Error(r.error); g = r.game; return r; };
    for (let i = 0; i < 6 && view(g).phase === 'meeting'; i++) must(view(g).moves[0].move);
    for (let i = 0; i < 30 && (view(g).phase === 'road-encounter' || villageOf(g.app.road!) !== 'hollowford'); i++) must(view(g).phase === 'road-encounter' ? view(g).moves[0].move : { endDay: true });
    expect(villageOf(g.app.road!)).toBe('hollowford');
    const r = must({ ask: { person: 'hf-isa', question: 'What happened in the plague?' } });
    expect(r.played).toEqual({ do: 'question:hf-isa:past:plague' });
    expect(r.asked?.answered).toBe(true);
    expect(g.app.road!.log.map(l => l.text).join('\n')).toContain(heldBy(ON, 'Lövfolk').text);
  });
});
