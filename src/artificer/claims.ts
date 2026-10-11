/**
 * Rumours, mistakes and lies on the road (#1580, knowledge slice G; design in
 * docs/knowledge-model-design.md §7). The knowledge model (knowledge.ts) gave every fact a truth;
 * this is where people stop always telling it.
 *
 * Three kinds of claim that aren't simply so:
 * - **Honestly wrong.** Someone believes a thing that isn't true: Maren's grudge against Tobin
 *   (ties.ts), or a rumour they were told. They say it in good faith, and sure of it.
 * - **A rumour.** Someone saw something (`path[0]`), told someone, who told someone. Each telling
 *   loses a little confidence and the story **drifts**: the number grows, and the place can move
 *   (Talk of the Town, Ryan et al. 2015: beliefs mutate as they spread). Travellers and traders,
 *   the road's **weak ties** (Granovetter 1973), carry news furthest, and furthest from the truth.
 * - **A lie, for a reason.** A person says something else instead of what they know, until they
 *   trust you enough to stop. Every lie names its **motive** in the data (an organisation they keep
 *   secrets for, a friend they cover for, a grudge, a profit, fear or pride), and `motiveProblem`
 *   checks that the data really holds it up: Tobin is of the Compact, and the Compact is secret.
 *
 * The game always knows the truth: a rumour's hops carry `truth: 'rumour'`, a lie is a lie. The
 * player hears only words, and how sure they sound. The journal (journal.ts) sets the claims
 * side by side, so a lie is caught when two accounts clash, and a rumour settled by going to look.
 *
 * Here: the claims as written (content/claims.json, every entry a placeholder for the owner),
 * the drift rule and the facts it gives the knowledge model, and the run's lies. Behind the
 * `rumours-and-lies` rule switch: facts.ts `factsFor` adds the rumours, `liesFor` the lies.
 *
 * Pure and deterministic. The drift is seeded from the rumour's id and the hop, with a generator of
 * its own (rng.ts), so it takes nothing from any of the sim's streams and every run hears the same.
 */

import type { ClaimSource, Fact, Lie, Truth } from './knowledge';
import { featureOn, type FeatureSwitches } from './features';
import { ROAD_ORGS } from './orgs';
import { tieEntries } from './ties';
import { generator, seedOf } from './rng';
import { VILLAGES, TRAVELLERS, type Person } from './villages';
import claimsFile from './content/claims.json';

/** Where a claim can be checked for yourself (#1580): being in this village, and what you see there. */
export interface Check { visit: string; text: string }

/**
 * Something people make claims about: what the journal files claims under. `label` is how the
 * journal names it, neutral on purpose (never the answer); `facts` are the facts (by id) that speak
 * to it. The truth is each fact's own `truth`: the game knows, the player finds out.
 */
export interface PropositionEntry {
  id: string;
  label: string;
  facts: readonly string[];
  check?: Check;
  placeholder?: boolean;
  /** The canon it rests on (`file › label`). */
  source: string;
}

/**
 * Why someone lies, grounded in the data. The kinds follow the issue: protecting their group (an
 * organisation they keep secrets for), protecting a friend (a tie they think well of), a grudge (a
 * tie they don't), profit (a trader with something to sell), fear or pride (said in `why` alone).
 */
export type Motive =
  | { kind: 'org'; org: string }
  | { kind: 'friend'; tie: string }
  | { kind: 'grudge'; tie: string }
  | { kind: 'profit'; item?: string }
  | { kind: 'fear' }
  | { kind: 'pride' };

/** A lie as written: who says it, about what, the words, how sure they make it sound, and why. */
export interface LieEntry {
  id: string;
  person: string;
  /** The topic it's said about (a focus key). */
  about: string;
  /** What it's a claim about, for the journal. */
  proposition: string;
  /** How sure they make it sound: a lie borrows an honest claim's hedge. */
  sounds: Exclude<ClaimSource, 'made-up'>;
  /** The trust at which they stop lying (the true number, never the felt word). */
  until: number;
  motive: Motive;
  text: string;
  /** Why, in words: what the game knows and the player never reads. */
  why: string;
  placeholder?: boolean;
  source: string;
}

/** A rumour as written: what was really seen, the words, the places it can drift to, and who passed it on. */
export interface RumourEntry {
  id: string;
  /** How the journal names it. */
  label: string;
  about: readonly string[];
  /** The words, with `{n}` and `{where}` filled in at each hop. */
  core: string;
  truth: { n: number; where: string };
  /** Where it can be said to have happened, the true place among them. */
  places: readonly string[];
  /** Who holds it, in the order it was told on: the first saw it. */
  path: readonly string[];
  check?: Check;
  placeholder?: boolean;
  source: string;
}

// A JSON import types every string as `string` (so `sounds` isn't a ClaimSource); `as unknown as`
// trusts the interfaces instead, and claims.test.ts checks the data really has those shapes.
const PROPOSITION_ENTRIES = claimsFile.propositions as unknown as readonly PropositionEntry[];
const LIE_ENTRIES = claimsFile.lies as unknown as readonly LieEntry[];
const RUMOUR_ENTRIES = claimsFile.rumours as unknown as readonly RumourEntry[];

/** Everything as written: what a reviewer checks against canon. */
export const claimEntries = (): { propositions: readonly PropositionEntry[]; lies: readonly LieEntry[]; rumours: readonly RumourEntry[] } =>
  ({ propositions: PROPOSITION_ENTRIES, lies: LIE_ENTRIES, rumours: RUMOUR_ENTRIES });

const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
const PEOPLE: Readonly<Record<string, Person>> = Object.fromEntries(EVERYONE.map(p => [p.id, p]));
const HOMED = new Set(Object.values(VILLAGES).flatMap(v => v.people.map(p => p.id)));

// ── Rumours and their drift ─────────────────────────────────────────────────

/** How sure the one who saw it is. */
export const SAW_CONFIDENCE = 0.9;
/** What's left of a claim's confidence each time it's told on (#1580: a claim told on loses confidence). */
export const TOLD_ON = 0.7;
/** The most a number grows at one hop, as a share of itself (a weak tie doubles it). It always grows by at least 1. */
export const DRIFT_GROWTH = 0.5;
/** The chance the place moves at one hop (a weak tie doubles it). */
export const PLACE_SHIFT = 0.25;

/**
 * Whether `personId` is one of the road's weak ties (Granovetter 1973): a traveller with no village
 * of their own, or a trader whose living is the road's news. They hear regional rumours first, and
 * a rumour grows more in their telling.
 */
export function carriesFar(personId: string): boolean {
  const p = PEOPLE[personId];
  return !!p && (!HOMED.has(personId) || p.role === 'trader' || p.role === 'caravaneer');
}

/** One hop of a rumour: who holds it, what they'd say, and how far it's come from the truth. */
export interface RumourHop {
  holder: string;
  hop: number;
  n: number;
  where: string;
  text: string;
  truth: Truth;
  source: Exclude<ClaimSource, 'made-up'>;
  confidence: number;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** A number as people say it: in words up to twenty, then in figures. */
const spoken = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const named = (pid: string): string => PEOPLE[pid]?.name ?? pid;

/** How each hop is hedged: the one who saw it; someone told by them, who names who; and after that, common talk. */
const sourceAt = (hop: number): Exclude<ClaimSource, 'made-up'> => (hop === 0 ? 'saw' : hop === 1 ? 'told' : 'common');

/**
 * Every hop of a rumour, from the one who saw it on, by a seeded rule. At each hop after the first:
 * - the number grows by up to DRIFT_GROWTH of itself, and always by at least one (hearsay is never
 *   exact, and nobody ever says "fewer than I heard");
 * - with chance PLACE_SHIFT the place moves to another of its `places`;
 * - a weak tie holding it (`carriesFar`) doubles both;
 * - confidence falls by TOLD_ON.
 * Seeded per rumour and hop (`rumour|<id>|<hop>`), never by who's asking, so it's the same in
 * every run, and changing the path after a hop never changes the hops before it.
 */
export function driftOf(r: RumourEntry): RumourHop[] {
  const out: RumourHop[] = [];
  let n = r.truth.n, where = r.truth.where;
  r.path.forEach((holder, hop) => {
    if (hop > 0) {
      const rand = generator(seedOf(`rumour|${r.id}|${hop}`));
      const far = carriesFar(holder) ? 2 : 1;
      n += Math.max(1, Math.round(n * rand() * DRIFT_GROWTH * far));
      const others = r.places.filter(p => p !== where);
      // Two draws, always taken, so whether the place moves never changes what the next draw is.
      const moves = rand() < PLACE_SHIFT * far;
      const pick = rand();
      if (moves && others.length) where = others[Math.floor(pick * others.length)];
    }
    const core = r.core.replace('{n}', spoken(n)).replace('{where}', where);
    const source = sourceAt(hop);
    const text = source === 'saw' ? `I saw it myself: ${core}` : source === 'told' ? `I heard it from ${named(r.path[hop - 1])}: ${core}` : `Everyone's saying it: ${core}`;
    const truth: Truth = n === r.truth.n && where === r.truth.where ? 'true' : 'rumour';
    out.push({ holder, hop, n, where, text, truth, source, confidence: SAW_CONFIDENCE * TOLD_ON ** hop });
  });
  return out;
}

/**
 * What the rumours give the knowledge model: each hop is a fact in its holder's own scope
 * (`rumour:<id>:<hop>`), so it's the most specific thing they know about the topic, and carries
 * where they got it (`claimSource`), which is the hedge they say it with.
 */
export function rumourFacts(): Fact[] {
  return RUMOUR_ENTRIES.flatMap(r => driftOf(r).map(h => ({
    id: `rumour:${r.id}:${h.hop}`,
    about: r.about,
    text: h.text,
    scope: { kind: 'person' as const, id: h.holder },
    sensitivity: 'public' as const,
    truth: h.truth,
    claimSource: h.source,
  })));
}

/** The rumours' facts, built once. */
export const RUMOUR_FACTS: readonly Fact[] = rumourFacts();

/** A rumour fact's hop, by fact id: which rumour, and how far it's come. */
const HOPS: ReadonlyMap<string, { rumour: RumourEntry; hop: RumourHop }> = new Map(
  RUMOUR_ENTRIES.flatMap(r => driftOf(r).map(h => [`rumour:${r.id}:${h.hop}`, { rumour: r, hop: h }] as const)),
);
/** The hop a fact is, if it's a rumour's. */
export const rumourHopOf = (factId: string): { rumour: RumourEntry; hop: RumourHop } | undefined => HOPS.get(factId);

// ── Propositions ────────────────────────────────────────────────────────────

/** What people make claims about, by id: the written ones, and each rumour (its hops are its facts). */
export const PROPOSITIONS: Readonly<Record<string, PropositionEntry>> = Object.fromEntries([
  ...PROPOSITION_ENTRIES.map(p => [p.id, p] as const),
  ...RUMOUR_ENTRIES.map(r => [r.id, {
    id: r.id, label: r.label, facts: r.path.map((_, hop) => `rumour:${r.id}:${hop}`),
    ...(r.check ? { check: r.check } : {}), placeholder: r.placeholder, source: r.source,
  }] as const),
]);

const BY_FACT: ReadonlyMap<string, string> = new Map(Object.values(PROPOSITIONS).flatMap(p => p.facts.map(f => [f, p.id] as const)));
/** The proposition a fact speaks to, if any. */
export const propositionOfFact = (factId: string): string | undefined => BY_FACT.get(factId);

// ── Lies ────────────────────────────────────────────────────────────────────

/** Every lie, by who tells it, as the knowledge model reads it (knowledge.ts `Lie`). */
const ROAD_LIES: Readonly<Record<string, readonly Lie[]>> = LIE_ENTRIES.reduce<Record<string, Lie[]>>((by, l) => {
  (by[l.person] ??= []).push({ id: l.id, about: l.about, text: l.text, why: l.why, until: l.until, sounds: l.sounds });
  return by;
}, {});

const NO_LIES: Readonly<Record<string, readonly Lie[]>> = {};

/**
 * The lies a run plays with, by person, by its saved switches: every written lie with
 * `rumours-and-lies` on, none off (and in every run from before the switch, where a person who'd
 * rather not say says "not yet", as they always did).
 */
export const liesFor = (features: FeatureSwitches | undefined): Readonly<Record<string, readonly Lie[]>> =>
  (featureOn(features, 'rumours-and-lies') ? ROAD_LIES : NO_LIES);

/** A lie as written, by id. */
export const lieById = (id: string): LieEntry | undefined => LIE_ENTRIES.find(l => l.id === id);

/**
 * What's wrong with a lie's motive, against the data, or null if it holds:
 * - **org**: they belong to it, and it keeps its business from outsiders (secret or guarded);
 * - **friend** / **grudge**: a tie they hold a view in, warm for a friend, cold for a grudge;
 * - **profit**: they trade for a living;
 * - **fear** / **pride**: only their `why` says so.
 * And anyone in an organisation bound to tell (the Pandor's Compact of Knowing) never lies.
 */
export function motiveProblem(l: LieEntry): string | null {
  const p = PEOPLE[l.person];
  if (!p) return `no one called ${l.person} on the road`;
  if (!l.why.trim()) return 'a lie needs a reason';
  if (!(l.until > 0 && l.until <= 100)) return `stops lying at trust ${l.until}: must be 1–100`;
  const orgs = Object.keys(p.orgs ?? {});
  if (orgs.some(o => ROAD_ORGS[o]?.secrecy === 'bound-to-tell')) return `${p.name} is bound to tell`;
  const m = l.motive;
  switch (m.kind) {
    case 'org': {
      const secrecy = ROAD_ORGS[m.org]?.secrecy;
      if (!orgs.includes(m.org)) return `${p.name} isn't of ${m.org}`;
      return secrecy === 'secret' || secrecy === 'guarded' ? null : `${m.org} keeps nothing from outsiders (${secrecy})`;
    }
    case 'friend':
    case 'grudge': {
      const view = tieEntries().find(t => t.id === m.tie && t.between.includes(l.person))?.views[l.person];
      if (!view) return `${p.name} holds no view in a tie ${m.tie}`;
      return (m.kind === 'friend' ? view.opinion > 0 : view.opinion < 0) ? null : `${p.name}'s opinion (${view.opinion}) isn't a ${m.kind}'s`;
    }
    case 'profit':
      return p.role === 'trader' || p.role === 'caravaneer' ? null : `${p.name} doesn't trade for a living`;
    case 'fear':
    case 'pride':
      return null;
  }
}
