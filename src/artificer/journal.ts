/**
 * The journal of who said what (#1580, knowledge slice G; design in
 * docs/knowledge-model-design.md §7), and reading a lie.
 *
 * The player keeps claims, not facts: who told them what, and how sure they sounded, set side by
 * side under what it's about, like Outer Wilds' ship log in rumour mode. From that:
 * - **corroboration**: independent sources saying the same thing make it firmer. Two people who
 *   heard it from the same third person don't count twice, and two villagers repeating what their
 *   village says count once (it's one source: common talk);
 * - **contradiction**: two accounts that don't agree are flagged. That's how a lie is caught: the
 *   owner's call (2026-10-11) is that every lie is catchable this way;
 * - **checking for yourself** settles it: being where it happened, you see what's so, and the
 *   journal marks who was right.
 *
 * Nothing new is saved. Everything is read off what's been told (`asked`: the topics each person
 * answered, and `claimed:<topic>` for a lie told instead, road.ts), the run's facts and lies, and
 * where the caravan has been, as facts.ts `claimsTold` does.
 *
 * **Reading a lie** is weak, as it is for people: about 54% (Bond and DePaulo 2006, a meta-analysis
 * of 206 studies), better the better you know them (rapport, #1578), with evidence in hand, with
 * Charisma and a clear head. It can be wrong both ways: you can miss a lie, and you can suspect
 * someone honest. Seeded per Warden, person and topic, with a generator of its own (rng.ts), so it
 * takes nothing from the sim's streams and the same Warden reads the same answer the same way.
 *
 * Pure and deterministic.
 */

import { FACTS, resolve } from './facts';
import { SOURCE_HEDGE, type ClaimSource, type Fact, type Lie, type Truth } from './knowledge';
import { PROPOSITIONS, lieById, propositionOfFact, rumourHopOf, SAW_CONFIDENCE } from './claims';
import { readError, type Reader } from './rapport';
import { pastEventOf, type PastEvent } from './history-in-play';
import { generator, seedOf } from './rng';

/** The prefix in `asked` that marks a lie told instead of an answer: `claimed:<topic>`. */
export const CLAIMED = 'claimed:';

/**
 * Whether a person responded on a topic: told you (`topic` in what they've answered) or lied to you
 * instead (`claimed:<topic>`). A lie reads like any answer, so every reader that asks "did they
 * answer?" of `asked` goes through here rather than a bare `includes(topic)`, which misses lies.
 */
export const respondedOn = (asked: readonly string[] | undefined, topic: string): boolean =>
  !!asked && (asked.includes(topic) || asked.includes(`${CLAIMED}${topic}`));

/** How sure each source sounds, as a confidence the journal weighs claims by. */
export const SOURCE_CONFIDENCE: Readonly<Record<Exclude<ClaimSource, 'made-up'>, number>> = { saw: SAW_CONFIDENCE, told: 0.6, common: 0.5 };

/** A claim the Warden has heard: who, about what, the words, how sure they sounded, and (hidden) whether it's so. */
export interface HeardClaim {
  person: string;
  /** The topic they were asked (a focus key). */
  topic: string;
  text: string;
  /** Where they said they got it. A liar names an honest source. */
  source: Exclude<ClaimSource, 'made-up'>;
  /** How they said it: "I saw it myself", "I heard", "Everyone says". */
  hedge: string;
  /** How sure it sounds, 0–1. */
  confidence: number;
  /** What it's a claim about (claims.ts PROPOSITIONS). */
  proposition: string;
  /** Which account it is: claims with the same version agree. `so` for what's true. */
  version: string;
  /** Where it really came from: two claims from one origin are one source. */
  origin: string;
  /** What the world says of it. Never shown until checked. */
  truth: Truth | 'lie';
  /** Once checked for yourself: whether it was so. */
  right?: boolean;
  /**
   * How the journal names what it's about, for a claim about a dated event of a place's history
   * (#1656, history-in-play.ts), whose propositions are a history's own and not in PROPOSITIONS.
   */
  label?: string;
}

/** Where a fact sits says where its holder got it: their own, their organisation's or trade's word, or what everyone says. */
function sourceOf(f: Fact): Exclude<ClaimSource, 'made-up'> {
  if (f.claimSource) return f.claimSource;
  if (f.scope.kind === 'person') return 'saw';
  if (f.scope.kind === 'org' || f.scope.kind === 'role' || f.scope.kind === 'skill') return 'told';
  return 'common';
}

/** A told fact as a heard claim, or null for one nobody makes claims about. */
function claimOfFact(person: string, topic: string, f: Fact): HeardClaim | null {
  // A place's history (#1656): each dated event is a claim about what happened, under its happening.
  const past = pastEventOf(f);
  if (past) return claimOfPast(person, topic, f, past);
  const proposition = propositionOfFact(f.id);
  if (!proposition) return null;
  const hop = rumourHopOf(f);
  const source = sourceOf(f);
  // A rumour's version is what it says (the number, the place, and who, #1589): two hops that say
  // the same thing agree. Anything else true is `so`, and each untrue fact is its own account.
  const version = f.truth === 'true' ? 'so' : hop ? `${hop.hop.n}|${hop.hop.where}${hop.hop.who ? `|${hop.hop.who}` : ''}` : `fact:${f.id}`;
  // A rumour comes from whoever saw it; a person's own word from them; a scope's from the scope.
  const origin = hop ? hop.rumour.path[0] : f.scope.kind === 'person' ? f.scope.id! : `${f.scope.kind}:${f.scope.id ?? ''}`;
  return { person, topic, text: f.text, source, hedge: SOURCE_HEDGE[source], confidence: hop ? hop.hop.confidence : SOURCE_CONFIDENCE[source], proposition, version, origin, truth: f.truth };
}

/**
 * A history fact as a heard claim (#1656): an eyewitness telling is `so`; a legend's version is
 * what it says, so two tellings in the same words agree wherever they're told, and differing ones
 * contradict. Its origin is the place and the People and culture whose telling it is: two
 * neighbours repeating their village's account are one source (common talk, as for any scope
 * fact), and the old Lövfolk healer's account is not the human elder's.
 *
 * With `history-retold` (#1658), a teller who saw it (`PastEvent.witnesses`: their People and
 * culture haven't retold it yet) says so, "I saw it myself", and is a source of their own, as
 * anyone's own word is: two who saw it are two witnesses, not one village's talk.
 */
function claimOfPast(person: string, topic: string, f: Fact, { proposition, label, witnesses }: PastEvent): HeardClaim {
  const saw = !!witnesses?.includes(person);
  const source = saw ? 'saw' : sourceOf(f);
  const held = (f as { heldBy?: readonly { people: string; culture: string }[] }).heldBy?.[0];
  // The village it's told in: its scope, or for a country's news, the village named after its `@`.
  const place = f.id.includes('@') ? f.id.slice(f.id.lastIndexOf('@') + 1) : f.scope.id ?? '';
  const origin = saw ? person : `past:${place}${held ? `|${held.people}/${held.culture}` : ''}`;
  return {
    person, topic, text: f.text, source, hedge: SOURCE_HEDGE[source], confidence: SOURCE_CONFIDENCE[source],
    proposition, version: f.truth === 'true' ? 'so' : `told:${f.text}`, origin, truth: f.truth, label,
  };
}

/** A lie told as a heard claim, or null for one that's no claim about anything. */
function claimOfLie(person: string, topic: string, l: Lie): HeardClaim | null {
  const entry = l.id ? lieById(l.id) : undefined;
  if (!entry || !PROPOSITIONS[entry.proposition]) return null;
  const source = l.sounds ?? 'saw';
  return { person, topic, text: l.text, source, hedge: SOURCE_HEDGE[source], confidence: SOURCE_CONFIDENCE[source], proposition: entry.proposition, version: `lie:${entry.id}`, origin: person, truth: 'lie' };
}

/**
 * Every claim heard so far that anyone makes claims about, read off what's been told. A topic
 * answered was answered with the most specific fact they know (asked with infinite trust only
 * opens gates, never picks another fact, as `claimsTold` has it); `claimed:<topic>` was a lie,
 * found in the run's `lies`. In the order they're kept: by person, then as told.
 */
export function claimsHeard(asked: Readonly<Record<string, readonly string[]>> | undefined, facts: readonly Fact[] = FACTS, lies: Readonly<Record<string, readonly Lie[]>> = {}): HeardClaim[] {
  const out: HeardClaim[] = [];
  for (const [person, topics] of Object.entries(asked ?? {})) for (const key of topics) {
    if (key.startsWith(CLAIMED)) {
      const topic = key.slice(CLAIMED.length);
      const lie = lies[person]?.find(l => l.about === topic);
      const c = lie && claimOfLie(person, topic, lie);
      if (c) out.push(c);
      continue;
    }
    const r = resolve(person, key, Infinity, { facts, others: [] });
    const c = r?.kind === 'told' ? claimOfFact(person, key, r.fact) : null;
    if (c) out.push(c);
  }
  return out;
}

export type ClaimStatus =
  /** One account, from one source. */
  | 'heard'
  /** Independent sources agree. */
  | 'corroborated'
  /** Two accounts don't agree. */
  | 'contradicted'
  /** You've seen for yourself. */
  | 'checked';

/** What the journal shows under one thing: the claims about it, how they stand, and how firm the best account is. */
export interface JournalEntry {
  proposition: string;
  label: string;
  status: ClaimStatus;
  /** How firm the best-supported account is, 0–1: 1 − ∏(1 − confidence) over its independent sources. */
  firmness: number;
  claims: HeardClaim[];
  /** What you saw, once checked. */
  seen?: string;
}

/**
 * How firm a set of claims that agree is: each independent source counts once, at its surest, and
 * they combine as independent evidence does (the chance they're all wrong falls with each one).
 */
function firmnessOf(claims: readonly HeardClaim[]): number {
  const byOrigin = new Map<string, number>();
  for (const c of claims) byOrigin.set(c.origin, Math.max(byOrigin.get(c.origin) ?? 0, c.confidence));
  return 1 - [...byOrigin.values()].reduce((miss, c) => miss * (1 - c), 1);
}

/**
 * The journal, from the claims heard and the villages the caravan has been to (`visited`, in route
 * order; being there is how a claim with a `check` is settled). One entry per thing claimed about,
 * in the order first heard.
 */
export function journalOf(heard: readonly HeardClaim[], visited: readonly string[]): JournalEntry[] {
  const order: string[] = [];
  const by = new Map<string, HeardClaim[]>();
  for (const c of heard) {
    if (!by.has(c.proposition)) { by.set(c.proposition, []); order.push(c.proposition); }
    by.get(c.proposition)!.push(c);
  }
  return order.map(id => {
    const claims = by.get(id)!;
    // A history's happenings (#1656) aren't written propositions: they carry their own name, and
    // there's nowhere to go and check a plague a hundred years gone.
    const p = PROPOSITIONS[id] ?? { label: claims[0].label ?? id, check: undefined };
    const versions = new Map<string, HeardClaim[]>();
    for (const c of claims) versions.set(c.version, [...(versions.get(c.version) ?? []), c]);
    const firmness = Math.max(...[...versions.values()].map(firmnessOf));
    const checked = p.check && visited.includes(p.check.visit) ? p.check : undefined;
    if (checked) return { proposition: id, label: p.label, status: 'checked', firmness, claims: claims.map(c => ({ ...c, right: c.version === 'so' })), seen: checked.text };
    const origins = new Set(claims.map(c => c.origin));
    const status: ClaimStatus = versions.size > 1 ? 'contradicted' : origins.size > 1 ? 'corroborated' : 'heard';
    return { proposition: id, label: p.label, status, firmness, claims };
  });
}

// ── Reading a lie ───────────────────────────────────────────────────────────

/** The edge over chance a stranger's read has: people catch lies about 54% of the time (Bond and DePaulo 2006). */
export const LIE_EDGE = 0.04;
/** The edge knowing someone well adds, at full trust (rapport, #1578). */
export const RAPPORT_EDGE = 0.25;
/** The edge holding evidence adds: a claim already heard that says otherwise. */
export const EVIDENCE_EDGE = 0.2;
/** No read is ever certain. */
export const BEST_READ = 0.95;

/**
 * The chance `reader` reads a claim right (a lie as a lie, the truth as the truth), given how well
 * they know the person (`trust`, the true number) and whether they hold evidence. The edges add,
 * and the reader's error (rapport.ts `readError`: Charisma narrows it, a tired mind widens it)
 * divides them: a clear-headed, charming Warden reads truer; an exhausted one barely beats a coin.
 */
export function lieReadChance(reader: Reader, trust: number, evidence: boolean): number {
  const known = Math.max(0, Math.min(100, trust)) / 100;
  const edge = (LIE_EDGE + RAPPORT_EDGE * known + (evidence ? EVIDENCE_EDGE : 0)) / readError(reader.stats, reader.clarity);
  return Math.min(BEST_READ, 0.5 + edge);
}

/**
 * Whether `reader` suspects what `personId` said about `topic`. Read right, a lie is suspected and
 * the truth isn't; read wrong, the other way round. One draw from a generator seeded by the
 * Warden, the person and the topic: the same Warden always reads the same answer the same way.
 */
export function readsAsLie(reader: Reader, personId: string, topic: string, isLie: boolean, trust: number, evidence: boolean): boolean {
  const right = generator(seedOf(`${reader.id}|lie|${personId}|${topic}`))() < lieReadChance(reader, trust, evidence);
  return isLie ? right : !right;
}
