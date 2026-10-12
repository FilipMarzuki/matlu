/**
 * Road people answer from their place's history (#1656, knowledge slice F; design in
 * docs/knowledge-model-design.md). The world engine writes each road village's past: who holds
 * it, what happened there and in its country, and, with `old-history-drift` (#1650), how each
 * People and culture there remembers it. This puts that into the knowledge model, so a question
 * about the old plague, the lord, or "what happened here" finds it.
 *
 * Behind the `history-in-play` rule switch: off (and in every run from before it), a run's facts
 * are `factsFor`'s, the very same array, so nothing a player reads changes.
 *
 * **What each person knows.** A village's one list (world/remembered.ts `placeKnowledge`: its own
 * facts and its country's, merged where both tell one thing), with three changes for play:
 * - **Their own People's telling.** With old history bending, an old event is told one way per
 *   People and culture (`heldBy`), and a person knows the telling their own (as the run plays them,
 *   villages.ts `asPlayed`) holds: the fact names them among its `tellers` (knowledge.ts). The
 *   country's old news is told by the village's own holders too (`villageHolders`), not by the
 *   country's Peoples: it's what the people you're talking to heard. So in a mixed village the old
 *   Lövfolk healer who saw a plague tells it as it was, and the human elder tells it bent.
 * - **The country's facts are the village's people's.** The model gives everyone on the road one
 *   region (facts.ts ROAD_REGION), so a country's fact is put on the north road, told only by the
 *   village's people (`tellers`), as deep as the region reaches for them: a trader knows the
 *   country's old legends (depth 3), most people only its news. Its id gets `@<village>`, since
 *   two road villages can share a country and each tells its news its own way.
 * - **Topics to ask by** (past-topics.ts): `past:here`, `past:plague`, `past:house:crowhelm`…
 * Its own recent past (world/local-history.ts, #1613) comes after, as "what happened here" only.
 * The model does the rest unchanged: sensitivity and trust gates, the most specific fact first (a
 * person's own words, then their village's scope facts, before history), referrals to who knows.
 *
 * **The journal of who said what** (journal.ts) keeps each dated event as a claim, under one
 * proposition per happening (`pastEventOf`): the village's and its country's telling of one plague
 * are one entry, and a bent telling and a true one sit side by side, contradicting. As for any
 * rumour, the journal never marks which is so: there's nothing to go and look at for a plague a
 * hundred years gone, so the player weighs who saw it.
 *
 * **Where the history comes from.** A told history is 150 years of the engine, a quarter to half
 * a second in Node, more in a browser, so it's never told inside a move. The page tells it in a
 * worker as a run starts (artificer-app/main.ts) and hands it here (`keepHistory`); the server and
 * the AI runner, which have no worker, tell it on first need (`tellHistoriesWith(runHistory)`) and
 * keep it per seed. This file never imports the engine, so the page's bundle stays small.
 *
 * **Told better (#1658), with the `history-retold` switch on too** (off, as #1656 left it):
 * - **An eyewitness says so.** A teller whose own People and culture still have someone who saw it
 *   (its `heldBy` group retold it 0 times, world/old-history.ts) says "I saw it myself" in the
 *   journal; everyone else telling the same words keeps their hedge (`PastEvent.witnesses`).
 * - **The caravan knows the legends.** The caravan's people tell the dated events of every country
 *   along the road, as the country tells them (its own Peoples' main telling), as deep as their
 *   reach in the region goes: Bodil and Runa the old legends, the others its news. Not a village's
 *   own events, its lords and feuds, or its recent local past: that's local detail (`caravanFacts`).
 * - **The best story first.** Every dated event and local happening carries how memorable it is
 *   (`memorabilityOf`), and a person whose answer is one of them tells the most memorable they
 *   know (knowledge.ts `answer`), so "what happened here?" gets the great plague, not the quarrel
 *   at the ford-moot. A question naming the plague still beats "what happened here" (past-topics.ts
 *   `pastBonus`).
 * - **The journal names the event**: "The plague in the Wrenwood country, year 68".
 *
 * Pure and deterministic, given the history: the same seed tells the same history, and these are
 * read off it with no dice of their own. A run's seed is its Warden's (`seedOf(character.id)`),
 * as the page's map and history are, so nothing new is saved.
 */

import type { Fact } from './knowledge';
import { ROAD_REGION, factsFor } from './facts';
import { featureOn, featuresOf, type FeatureSwitches } from './features';
import { KIND_TOPICS, PAST, eventNoun, pastSlug } from './past-topics';
import { seedOf } from './rng';
import { topicDef } from './topics';
import { TRAVELLERS, VILLAGES, asPlayed } from './villages';
import type { ReachHistory } from './world/history-format';
import { regionHolders, villageHolders } from './world/old-history';
import { factsOfRegion } from './world/regional-facts';
import { NORTH_ROAD } from './world/regions';
import { placeKnowledge, remembered, type PlaceFact } from './world/remembered';

// ── Where a run's history comes from ────────────────────────────────────────

/** How many seeds' histories are kept: one run is played at a time, a handful on a server. */
const KEPT = 4;
const histories = new Map<number, ReachHistory>(); // insertion order = least recently used first
let teller: ((seed: number) => ReachHistory) | null = null;

/** Keep `h` as its seed's history, the most recently used: the page's worker hands it in here. */
export function keepHistory(h: ReachHistory): void {
  histories.delete(h.seed);
  histories.set(h.seed, h);
  while (histories.size > KEPT) histories.delete(histories.keys().next().value!);
}

/**
 * How to tell a seed's history when none was handed in: the server and the AI runner pass the
 * engine's `runHistory` (world/history.ts). Not set, a run with no history kept plays without it.
 */
export function tellHistoriesWith(tell: ((seed: number) => ReachHistory) | null): void {
  teller = tell;
}

/** A seed's history: kept, or told now if a teller is set; null if neither. */
export function historyFor(seed: number): ReachHistory | null {
  const h = histories.get(seed) ?? teller?.(seed) ?? null;
  if (h) keepHistory(h);
  return h;
}

/** Forget every kept history and fact set (tests start clean with it). */
export function forgetHistories(): void {
  histories.clear();
  SETS.clear();
}

// ── The journal's propositions ──────────────────────────────────────────────

/**
 * A dated event's claim, for the journal: which happening it tells, how the journal names it, and
 * (with `history-retold`, #1658) who among its tellers saw it themself, by person id.
 */
export interface PastEvent { proposition: string; label: string; witnesses?: readonly string[] }

// Filled as each set of facts is built, as claims.ts keeps a rumour's hops: the journal finds a
// history fact's happening by the fact itself, so ids stay what they are.
const EVENTS = new WeakMap<Fact, PastEvent>();

/** The happening a history fact tells, if it's a dated event (one of `playFacts`'s). */
export const pastEventOf = (f: Fact): PastEvent | undefined => EVENTS.get(f);

/** A dated event's id read back: whose (`history:<village>` or `region:<country>`), the year, and which of that year. */
const EVENT_ID = /^((?:history|region):[^:@]+):(\d+):(\d+)(?::told-by:[^@]*)?$/;

// ── How memorable an event is ───────────────────────────────────────────────

/** What a kind of event weighs in memory (#1658): the dead of a plague, a famine or a war, then a new lord. Anything else 1. */
const KIND_WEIGHT: Readonly<Record<string, number>> = { plague: 3, famine: 3, war: 3, lord: 2 };

/** What a happening of a village's own recent past (#1613: a quarrel, a fire, a wedding) weighs: as little as any small event. */
export const LOCAL_WEIGHT = 1;

/**
 * How memorable a dated event is (#1658): which story "what happened here?" is answered with
 * (knowledge.ts `answer`). Simple on purpose, and read off the history's own words, so everyone
 * ranks one event the same however their People tell it:
 * - its kind (`KIND_WEIGHT`): a plague, a famine or a war 3, a new lord 2, anything else 1;
 * - its dead: one more for every hundred killed, as the history counts them ("killing 326": 3.26);
 * - a tie goes to the older: a millionth for each year ago, less than one death's worth.
 * So a great plague of long ago outweighs a lord's change, which outweighs a quarrel last spring.
 */
export function memorabilityOf(kind: string | undefined, words: string, ago: number): number {
  const dead = Number(words.match(/\bkilling (\d[\d,]*)/)?.[1].replace(/,/g, '') ?? 0);
  return (KIND_WEIGHT[KIND_TOPICS[kind ?? ''] ?? ''] ?? 1) + dead / 100 + ago / 1e6;
}

/** How memorable a happening of a village's recent past is: LOCAL_WEIGHT, and the older first on a tie. */
const localMemorability = (text: string, present: number): number => {
  const year = Number(text.match(/\bin year (\d+)/)?.[1] ?? present);
  return LOCAL_WEIGHT + (present - year) / 1e6;
};

// ── The facts ───────────────────────────────────────────────────────────────

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

type Province = ReachHistory['provinces'][number];
type Country = ReachHistory['regions'][number];

/** A dated event's id (`history:<village>:<year>:<k>` or `region:<country>:<year>:<k>`) read back to its told line. */
function lineOf(id: string, p: Province, country: Country | null): { kind?: string; text: string; year: number } | undefined {
  const k = Number(id.split(':')[3]);
  return id.startsWith('history:') ? p.lines[k] : country?.lines[k];
}

/**
 * How the journal names a happening: with `history-retold` (#1658), by what it was and where
 * ("The plague in the Wrenwood country, year 68", "The solar eclipse in Kestrel Gate, year 78");
 * without, or for a line with no kind, by where alone, as #1656 did ("The Wrenwood country, year 68").
 */
function labelOf(id: string, retold: boolean, village: string, p: Province, country: Country | null): string {
  const year = id.split(':')[2];
  const ofCountry = id.startsWith('region:');
  const kind = retold ? lineOf(id, p, country)?.kind : undefined;
  if (!kind) return `${ofCountry ? cap(country?.name ?? village) : village}, year ${year}`;
  return `${cap(eventNoun(kind))} in ${ofCountry ? country?.name ?? village : village}, year ${year}`;
}

/**
 * Everything the road villages' people know of their history, as the knowledge model's facts:
 * each village's one list, told by its own people (this file's header). `features` are the run's.
 */
export function historyFacts(history: ReachHistory, features: FeatureSwitches | undefined): Fact[] {
  const drift = featureOn(features, 'old-history-drift');
  const retold = featureOn(features, 'history-retold');
  const memory = remembered(history, undefined, undefined, features);
  const villages = memory.villages.flatMap(v => {
    const p = history.provinces.find(q => q.id === v.province.id)!;
    const country = v.country ? history.regions.find(r => r.id === v.country) ?? null : null;
    // The country's old news as the village's own people tell it (#1650), not the country's Peoples.
    const known: PlaceFact[] = placeKnowledge(v.village, p, v.facts, country, history.year, drift ? villageHolders(v.village, features) : undefined);
    const residents = (VILLAGES[v.village]?.people ?? []).map(x => asPlayed(x, features));
    const village = VILLAGES[v.village]?.name ?? v.village;

    // A village event its country also tells is merged into one fact (`mergeFacts`), which names
    // the country's in `absorbs`: the journal files every telling of it, the village's other
    // tellings too, under the country's, so another village of the country telling the same
    // plague as its country's news lines up with it.
    const proposition = new Map<string, string>();
    for (const f of known) if (f.absorbs?.length && EVENT_ID.test(f.id)) proposition.set(f.id, f.absorbs[0]);

    const told = known.map(f => {
      const ev = f.id.match(EVENT_ID);
      const base = ev ? `${ev[1]}:${ev[2]}:${ev[3]}` : null;
      const ofCountry = f.scope.kind === 'region' && f.scope.id === v.country;
      const heldBy = f.heldBy;
      // Who tells it: those whose People and culture hold this telling; for a country's fact,
      // only the village's people (the rest of the road lives in no country it knows).
      const tellers = heldBy
        ? residents.filter(r => heldBy.some(h => h.people === r.people && h.culture === r.culture)).map(r => r.id)
        : ofCountry ? residents.map(r => r.id) : undefined;
      // Who among them saw it (#1658): their People and culture haven't retold it yet.
      const witnesses = retold && heldBy
        ? residents.filter(r => heldBy.some(h => h.people === r.people && h.culture === r.culture && h.retellings === 0)).map(r => r.id)
        : [];
      const line = base ? lineOf(base, p, country) : undefined;
      const fact: Fact = {
        ...f,
        id: ofCountry ? `${f.id}@${v.village}` : f.id,
        about: [...f.about, ...pastTopics(f, v.village, p, country, base)],
        ...(ofCountry ? { scope: { kind: 'region' as const, id: ROAD_REGION } } : {}),
        ...(tellers ? { tellers } : {}),
        // A legend is something they heard, and they say so (knowledge.ts `hedgeOf`, journal.ts).
        ...(f.truth === 'rumour' ? { claimSource: 'told' as const } : {}),
        ...(retold && line ? { memorable: memorabilityOf(line.kind, line.text, history.year - line.year) } : {}),
      };
      if (base) {
        const id = proposition.get(base) ?? base;
        EVENTS.set(fact, { proposition: `past|${id}`, label: labelOf(id, retold, village, p, country), ...(witnesses.length ? { witnesses } : {}) });
      }
      return fact;
    });
    // Its own recent past (#1613, world/local-history.ts: who speaks for it, a quarrel, a fire),
    // as "what happened here" only. Those facts are also about the village and the people in them
    // (`place:saltmere`, `person:sm-hedda`), and a party's own telling is a person-scope fact,
    // which would answer before what they say of their village or of themself today: kept to the
    // history's own topic, they add answers and change none.
    const local = v.local.facts.map(f => ({ ...f, about: [`${PAST}here`], ...(retold ? { memorable: localMemorability(f.text, history.year) } : {}) }));
    return [...told, ...local];
  });
  return retold ? [...villages, ...caravanFacts(history, memory.villages, features)] : villages;
}

/**
 * What the caravan knows of the countries along the road (#1658): every dated event of each road
 * village's country, as the country itself tells it (its own Peoples' main telling, with old
 * history bending; the engine's words without), told only by the caravan's people. Like any
 * country fact here it's put on the north road at the country's depth, so how much of it each
 * traveller knows is their reach in the region: Bodil and Runa (region 3) the old legends, the
 * others its news. A village's own events, its lords and feuds, and its recent local past aren't
 * theirs: that's local detail. Filed under the same happening as a village's telling (the
 * country's event, `region:<country>:<year>:<k>`), so the journal sets them side by side.
 */
function caravanFacts(history: ReachHistory, villages: readonly { village: string; province: { id: string }; country: string | null }[], features: FeatureSwitches | undefined): Fact[] {
  const drift = featureOn(features, 'old-history-drift');
  const travellers = TRAVELLERS.map(t => t.id);
  const seen = new Set<string>();
  return villages.flatMap(v => {
    const country = v.country ? history.regions.find(r => r.id === v.country) ?? null : null;
    if (!country || seen.has(country.id)) return [];
    seen.add(country.id);
    const p = history.provinces.find(q => q.id === v.province.id)!;
    return factsOfRegion(country, history.year, drift ? regionHolders(history, country.id) : undefined)
      .filter(f => EVENT_ID.test(f.id) && !f.id.includes(':told-by:'))
      .map(f => {
        const line = lineOf(f.id, p, country);
        const fact: Fact = {
          ...f,
          id: `${f.id}@caravan`,
          about: [...f.about, ...pastTopics(f, v.village, p, country, f.id)],
          scope: { kind: 'region', id: ROAD_REGION },
          tellers: travellers,
          ...(f.truth === 'rumour' ? { claimSource: 'told' as const } : {}),
          ...(line ? { memorable: memorabilityOf(line.kind, line.text, history.year - line.year) } : {}),
        };
        EVENTS.set(fact, { proposition: `past|${f.id}`, label: labelOf(f.id, true, v.village, p, country) });
        return fact;
      });
  });
}

/**
 * The `past:` topics a fact answers, besides its own (past-topics.ts): who holds a place; a
 * village's events as "what happened here", a country's as "in these parts"; an event by its
 * kind and the house it touches; any place it names that isn't a road village.
 */
function pastTopics(f: PlaceFact, village: string, p: Province, country: Country | null, base: string | null): string[] {
  const out: string[] = [];
  const house = (name: string | null | undefined) => { if (name) out.push(`${PAST}house:${pastSlug(name)}`); };
  const kind = (k: string | undefined) => { if (k && KIND_TOPICS[k]) out.push(`${PAST}${KIND_TOPICS[k]}`); };
  if (f.id === `history:${village}:holder` || f.id === `history:${NORTH_ROAD}:${village}`) {
    out.push(`${PAST}lord`);
    house(p.house);
  } else if (base?.startsWith('history:')) {
    const line = p.lines[Number(base.split(':')[3])];
    kind(line?.kind);
    house(line?.house);
    // The general topic after the particular ones: "What happened in the plague?" names both, and
    // on a tie the first a person knows wins (free-questions.ts `bestKnownMatch`), so it's the plague.
    out.push(`${PAST}here`);
  } else if (base?.startsWith('region:') && country) {
    kind(country.lines[Number(base.split(':')[3])]?.kind);
    out.push(`${PAST}around`);
  } else if (country) {
    // How things stand in the country: its lords, feuds and leading house are about who holds what.
    const what = f.id.slice(`region:${country.id}:`.length);
    if (what.startsWith('lord:')) out.push(`${PAST}lord`);
    if (what === 'leading-house') { out.push(`${PAST}lord`); house(country.leadingHouse); }
    if (what.startsWith('feud:')) {
      out.push(`${PAST}war`);
      // The feud's id is regional-facts.ts's, slugged its way (ASCII only).
      const idOf = (houses: readonly string[]) => `feud:${houses.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      for (const h of country.feuds.find(x => idOf(x.houses) === what)?.houses ?? []) house(h);
    }
  }
  // A place it names that has no topic of its own (a road village has: `place:hollowford`).
  for (const a of f.about) if (a.startsWith('place:') && !topicDef('place', a.slice(6))) out.push(`${PAST}place:${a.slice(6)}`);
  return [...new Set(out)].filter(t => !f.about.includes(t));
}

// ── A run's facts ───────────────────────────────────────────────────────────

/** What a run is, for its facts: its saved rule switches and its Warden (whose id seeds its world). */
export interface RunOf { features?: FeatureSwitches; character: { id: string } }

// Each run's facts are built once and kept, so a run's facts are always the same array (claims.ts
// and the journal find a fact's hop and happening by the fact itself). Keyed by seed and every
// rule switch, as `featuresOf` reads them: more switches than matter, which only costs a rebuild.
const SETS = new Map<string, readonly Fact[]>();
const SETS_KEPT = 8;

/**
 * The facts a run plays with: `factsFor`'s, and with `history-in-play` on, its villages' history
 * after them (so a person's own words, their organisation's and their village's scope facts still
 * answer first, and history only answers what they didn't know). Off, `factsFor`'s very array.
 * With the switch on and no history to hand (a page whose worker hasn't finished, a test that
 * keeps none), `factsFor`'s too, and nothing is kept, so the history counts once it's there.
 */
export function playFacts(run: RunOf): readonly Fact[] {
  const base = factsFor(run.features);
  if (!featureOn(run.features, 'history-in-play')) return base;
  const seed = seedOf(run.character.id);
  const key = `${seed}|${JSON.stringify(featuresOf(run.features))}`;
  let facts = SETS.get(key);
  if (facts) { SETS.delete(key); SETS.set(key, facts); return facts; }
  const h = historyFor(seed);
  if (!h) return base;
  facts = [...base, ...historyFacts(h, run.features)];
  SETS.set(key, facts);
  while (SETS.size > SETS_KEPT) SETS.delete(SETS.keys().next().value!);
  return facts;
}
