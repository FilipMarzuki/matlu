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
 *
 * **How rumours bend (#1589)**, behind its own `rumour-drift` switch (so a run from #1580 keeps
 * its drift on replay): the dice are the story's and the bend is the teller's. Each hop is seeded
 * by the rumour and the path it came by, and whoever tells it bends it their way:
 * - **a name swaps** for someone of the same People (the true one's, as the run plays them);
 * - **their culture's bias** shapes it, in the story engine's own words (storytelling/types.ts
 *   `PerceptualBias`, a culture's `biasSeed` in world/peoples.ts): a loss-averse people tell it
 *   worse, an honour-bound one stakes their word on it, a fatalist shrugs it smaller, someone who
 *   holds to what they first heard won't let the place move. The road and the history speak the
 *   same language;
 * - **who carries it** is a rule: a village's people tell each other, an organisation's members
 *   tell each other (as carefully as the organisation is: the Pandor exactly, a goblin band
 *   loosely), and the road's weak ties carry it between villages (`carriage`);
 * - **a secret leaks** the way the engine's inventions do (storytelling/types.ts `leakProbBase`,
 *   halved when guild-protected): it starts with a member, gets out through one who talks for a
 *   living, and sounds less sure once it's out (`leakProblem`, `reachOf`).
 *
 * **Varied by the run (#1662)**, behind the `run-rumours` switch: the written rumours and lies stay
 * as a base, and each run adds rumours made from its own history and people (run-rumours.ts, through
 * `factsOfRumours`, so they drift and reach by the rules above) and, by its seed, maybe one more
 * liar from a pool (`poolLies`, `liesFor`), keeping the road at LIARS.
 */

import type { PerceptualBias } from '../../storytelling/types';
import type { ClaimSource, Fact, Lie, Reliability, Sensitivity, Truth } from './knowledge';
import { featureOn, ruleFeatures, type FeatureSwitches } from './features';
import { ROAD_ORGS } from './orgs';
import { tieEntries } from './ties';
import { generator, seedOf, shuffled } from './rng';
import { VILLAGES, TRAVELLERS, asPlayed, type Person } from './villages';
import { REACH_CULTURES } from './world/peoples';
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

/**
 * Why a lie was told, as what catching it costs (#1660, the owner's answers of 2026-10-12):
 * - **protective**: covering for someone (Sabine for Orrin). Caught, they come clean and say why.
 * - **loyal**: keeping a group's business (Tobin for the Compact). Caught, the same.
 * - **greedy**: lying for gain (Hedda on salt). Caught, their trust drops, they guard their other
 *   secrets more, and their friends hear of it (caught-lies.ts).
 * `motive` is what the data grounds the lie in; `reason` is how the liar feels about having told it.
 */
export type LieReason = 'protective' | 'loyal' | 'greedy';

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
  /** What catching it costs (#1660, `caught-lies`). */
  reason: LieReason;
  /** What they say when the Warden shows they know (#1660): why, coming clean; or all they'll say, for a greedy lie. */
  caught: string;
  placeholder?: boolean;
  source: string;
}

/** A rumour as written: what was really seen, the words, the places it can drift to, and who passed it on. */
export interface RumourEntry {
  id: string;
  /** How the journal names it. */
  label: string;
  about: readonly string[];
  /** The words, with `{n}`, `{where}` and `{who}` filled in at each hop. */
  core: string;
  /** What was really so: the number, the place, and (#1589) who, a person on the road by id. */
  truth: { n: number; where: string; who?: string };
  /** Where it can be said to have happened, the true place among them. */
  places: readonly string[];
  /** Who holds it, in the order it was told on: the first saw it. */
  path: readonly string[];
  check?: Check;
  /**
   * The organisation whose secret it is (#1589), by id: it starts with a member, passes among
   * members, and gets out through one who talks for a living (`leakProblem`).
   */
  leak?: string;
  /** The rule switch it arrives with, if not with `rumours-and-lies` itself: none before it. */
  feature?: string;
  placeholder?: boolean;
  source: string;
}

/**
 * How a road culture the story engine doesn't seat tells a rumour (#1589): its bias seeds, in the
 * engine's words. The Reach's cultures carry theirs in world/peoples.ts, where the history reads
 * them too; these are the rest of the road's.
 */
export interface TellerEntry {
  culture: string;
  biasSeed: Partial<Record<PerceptualBias, number>>;
  placeholder?: boolean;
  source: string;
}

// A JSON import types every string as `string` (so `sounds` isn't a ClaimSource); `as unknown as`
// trusts the interfaces instead, and claims.test.ts checks the data really has those shapes.
const PROPOSITION_ENTRIES = claimsFile.propositions as unknown as readonly PropositionEntry[];
const LIE_ENTRIES = claimsFile.lies as unknown as readonly LieEntry[];
const POOL_LIE_ENTRIES = claimsFile.poolLies as unknown as readonly LieEntry[];
const RUMOUR_ENTRIES = claimsFile.rumours as unknown as readonly RumourEntry[];
const TELLER_ENTRIES = claimsFile.tellers as unknown as readonly TellerEntry[];

/** Everything as written: what a reviewer checks against canon. */
export const claimEntries = (): { propositions: readonly PropositionEntry[]; lies: readonly LieEntry[]; poolLies: readonly LieEntry[]; rumours: readonly RumourEntry[]; tellers: readonly TellerEntry[] } =>
  ({ propositions: PROPOSITION_ENTRIES, lies: LIE_ENTRIES, poolLies: POOL_LIE_ENTRIES, rumours: RUMOUR_ENTRIES, tellers: TELLER_ENTRIES });

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
  /** Who the rumour names at this hop, if it names anyone (#1589). */
  who?: string;
  /** How carefully it's told (#1589): a leaked secret is the organisation's to keep until it's out. */
  sensitivity: Sensitivity;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** A number as people say it: in words up to twenty, then in figures. */
const spoken = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const named = (pid: string): string => PEOPLE[pid]?.name ?? pid;

/** How each hop is hedged: the one who saw it; someone told by them, who names who; and after that, common talk. */
const sourceAt = (hop: number): Exclude<ClaimSource, 'made-up'> => (hop === 0 ? 'saw' : hop === 1 ? 'told' : 'common');

/**
 * Every hop of a rumour, from the one who saw it on, by #1580's seeded rule (every run from before
 * `rumour-drift` hears it this way). At each hop after the first:
 * - the number grows by up to DRIFT_GROWTH of itself, and always by at least one (hearsay is never
 *   exact, and nobody ever says "fewer than I heard");
 * - with chance PLACE_SHIFT the place moves to another of its `places`;
 * - a weak tie holding it (`carriesFar`) doubles both;
 * - confidence falls by TOLD_ON.
 * Seeded per rumour and hop (`rumour|<id>|<hop>`), never by who's asking, so it's the same in
 * every run, and changing the path after a hop never changes the hops before it.
 */
function firstDrift(r: RumourEntry): RumourHop[] {
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
    const source = sourceAt(hop);
    const text = told(r, source, n, where, r.truth.who, r.path[hop - 1]);
    const truth: Truth = n === r.truth.n && where === r.truth.where ? 'true' : 'rumour';
    out.push({ holder, hop, n, where, text, truth, source, confidence: SAW_CONFIDENCE * TOLD_ON ** hop, sensitivity: 'public' });
  });
  return out;
}

/** A hop's words: the core with its blanks filled, hedged by where the holder got it (`from`: who told them). */
function told(r: RumourEntry, source: Exclude<ClaimSource, 'made-up'>, n: number, where: string, who: string | undefined, from: string | undefined): string {
  const core = r.core.replace('{n}', spoken(n)).replace('{where}', where).replace('{who}', who ? named(who) : '');
  return source === 'saw' ? `I saw it myself: ${core}` : source === 'told' ? `I heard it from ${named(from ?? '')}: ${core}` : `Everyone's saying it: ${core}`;
}

// ── How rumours bend (#1589) ────────────────────────────────────────────────

/** The chance a name swaps at one hop, for someone of the same People (a weak tie doubles it). */
export const NAME_SWAP = 0.25;
/** A bias this strong in the teller shows in their words: they add their own line. */
export const FRAME_AT = 0.3;
/** However much a teller vouches for it, a claim told on loses at least this much of its confidence. */
export const MOST_TOLD_ON = 0.9;
/** A secret that's just got out is told in a whisper and half-denied: this much of its confidence is left. */
export const LEAK_DOUBT = 0.8;

/**
 * How one bias bends a rumour in the telling, per unit of the teller's bias:
 * - `growth`: how much more (or less) the number grows (a loss-averse teller tells it worse);
 * - `vouch`: how much of the confidence a telling loses they keep, by staking their word on it;
 * - `settle`: how much less the place moves (they hold to the version they first heard);
 * - `frame`: the line they add of their own, when the bias is strong enough (FRAME_AT).
 */
export interface Bend { growth?: number; vouch?: number; settle?: number; frame?: string }

/**
 * Every bias the story engine knows (storytelling/types.ts `PerceptualBias`), and how it bends a
 * rumour on the road. Keyed by the engine's own words, so a culture's `biasSeed` means the same
 * thing in the history and on the road, and a bias the engine adds is a compile error here until
 * it's given a bend (or `null`: it changes how people act in the history, not how they retell
 * news). The lines are placeholders for the owner.
 */
export const TELLING_BENDS: Readonly<Record<PerceptualBias, Bend | null>> = {
  // Losses sting about twice what gains please (the engine's note): bad news grows in the telling.
  loss_aversion: { growth: 1, frame: 'And it will be worse by the time it reaches us.' },
  // A slight demands satisfaction: they tell it as a wrong someone must answer for, and vouch for it.
  honor_bound: { vouch: 0.5, frame: 'Someone will have to answer for it, and I would say so to their face.' },
  // Accepts losses as fate: it shrinks in the telling, as things that can't be helped do.
  fatalist: { growth: -0.5, frame: 'Nothing to be done about it, mind.' },
  // Reads everything as a trade: the same news, with what it does to prices.
  mercantile: { frame: 'Mark what it does to prices on the road.' },
  // Won't let go of what they've put in: the version they first heard stays put.
  sunk_cost: { settle: 1, frame: 'That is how I heard it, and that is how it was.' },
  // Hears what they want: a rumour they half expected grows a little.
  confirmation: { growth: 0.5 },
  // Sees the hopeful reading: it grows a little less.
  wishful: { growth: -0.5 },
  providential: null,
  doctrinal: null,
  betrayal_scarred: null,
  grief_locked: null,
  conqueror_confident: null,
};

/** Every road culture's bias seeds: the Reach's from the story engine's specs, the rest written for the road. */
const BIASES: Readonly<Record<string, Partial<Record<PerceptualBias, number>>>> = Object.fromEntries([
  ...REACH_CULTURES.map(c => [c.id, c.biasSeed ?? {}] as const),
  ...TELLER_ENTRIES.map(t => [t.culture, t.biasSeed] as const),
]);

/** A culture's bias seeds, in the story engine's words; none for a culture nobody wrote any for. */
export const tellingBias = (culture: string): Partial<Record<PerceptualBias, number>> => BIASES[culture] ?? {};

/** How someone of a culture tells a rumour on: what their biases add up to. */
export interface Telling {
  /** How much the number grows, against an unbiased teller's (1). */
  growth: number;
  /** What's left of the confidence after they tell it (TOLD_ON for an unbiased teller). */
  toldOn: number;
  /** How likely the place is to move, against an unbiased teller's (1). */
  shift: number;
  /** The line they add, from their strongest bias with one, if it's strong enough. */
  frame?: string;
}

/**
 * How someone of `culture` tells a rumour on: each of their biases bends it by its weight
 * (TELLING_BENDS), and the strongest with a line of its own adds it. Ties go to the bias written
 * first, so it's the same every time.
 */
export function tellingOf(culture: string): Telling {
  let growth = 1, vouch = 0, settle = 0, top = 0;
  let frame: string | undefined;
  for (const [bias, weight] of Object.entries(tellingBias(culture)) as [PerceptualBias, number][]) {
    const bend = TELLING_BENDS[bias];
    if (!bend || !weight) continue;
    growth += weight * (bend.growth ?? 0);
    vouch += weight * (bend.vouch ?? 0);
    settle += weight * (bend.settle ?? 0);
    if (bend.frame && weight >= FRAME_AT && weight > top) { frame = bend.frame; top = weight; }
  }
  return {
    growth: Math.max(0, growth),
    toldOn: Math.min(MOST_TOLD_ON, TOLD_ON + (1 - TOLD_ON) * vouch),
    shift: Math.max(0, 1 - settle),
    ...(frame ? { frame } : {}),
  };
}

/**
 * How much a hop between members of the same organisation drifts, by how careful it is
 * (knowledge.ts `Reliability`): the Pandor write it down and pass it on exactly; a goblin band's
 * news is fast and loose. Between people who share none, 1.
 */
export const ORG_DRIFT: Readonly<Record<Reliability, number>> = { careful: 0, fair: 1, loose: 1.5 };

const HOME: ReadonlyMap<string, string> = new Map(Object.values(VILLAGES).flatMap(v => v.people.map(p => [p.id, v.id] as const)));
const orgsOf = (pid: string): string[] => Object.keys(PEOPLE[pid]?.orgs ?? {});
const sharedOrgs = (a: string, b: string): string[] => orgsOf(a).filter(o => orgsOf(b).includes(o));
const isMember = (pid: string, org: string): boolean => orgsOf(pid).includes(org);

/** How a hop's drift goes between two people: the most careful organisation they share, else 1. */
function orgDrift(from: string, to: string): number {
  const shared = sharedOrgs(from, to);
  return shared.length ? Math.min(...shared.map(o => ORG_DRIFT[ROAD_ORGS[o]?.reliability ?? 'fair'])) : 1;
}

/** How a claim gets from one person to the next (#1589): within a village, within an organisation, or along the road. */
export type Carriage = 'village' | 'org' | 'road';

/**
 * How `from` can pass a claim to `to`, or null if they can't: a village's people tell each other;
 * an organisation's members tell each other, wherever they live (#1587); and the road's weak
 * ties (`carriesFar`) carry it between villages, telling or told. Anyone else never meets.
 */
export function carriage(from: string, to: string): Carriage | null {
  const home = HOME.get(from);
  if (home && home === HOME.get(to)) return 'village';
  if (sharedOrgs(from, to).length) return 'org';
  if (carriesFar(from) || carriesFar(to)) return 'road';
  return null;
}

/** What's wrong with a rumour's path, or null: each hop by a carriage the road has, and nobody twice. */
export function pathProblem(r: RumourEntry): string | null {
  if (new Set(r.path).size !== r.path.length) return 'someone hears it twice';
  for (let i = 1; i < r.path.length; i++) {
    if (!carriage(r.path[i - 1], r.path[i])) return `${named(r.path[i - 1])} and ${named(r.path[i])} share no village, organisation or road`;
  }
  return r.leak ? leakProblem(r) : null;
}

/**
 * What's wrong with a leaked secret, or null: the organisation keeps its business from outsiders
 * (secret or guarded); the one who saw it is a member; and it gets out, through a member who
 * talks for a living (a weak tie, `carriesFar`), the way secrets leak.
 */
export function leakProblem(r: RumourEntry): string | null {
  const org = r.leak ? ROAD_ORGS[r.leak] : undefined;
  if (!org) return `no organisation ${r.leak}`;
  if (org.secrecy !== 'secret' && org.secrecy !== 'guarded') return `${org.name} keeps nothing to leak (${org.secrecy})`;
  if (!isMember(r.path[0], org.id)) return `${named(r.path[0])} isn't of ${org.name}`;
  const out = r.path.findIndex(pid => !isMember(pid, org.id));
  if (out < 0) return `it never leaves ${org.name}`;
  return carriesFar(r.path[out - 1]) ? null : `${named(r.path[out - 1])} lets it out but doesn't talk for a living`;
}

/**
 * Who a name can swap to: anyone else on the road of the true one's People, as the run plays
 * them, but never one of the tellers so far (nobody says "I heard from Arvid that Arvid did it").
 */
function swapsFor(trueWho: string, current: string, tellers: readonly string[], features: FeatureSwitches | undefined): string[] {
  const truly = PEOPLE[trueWho];
  if (!truly) return [];
  const people = asPlayed(truly, features).people;
  return EVERYONE.filter(p => p.id !== current && !tellers.includes(p.id) && asPlayed(p, features).people === people).map(p => p.id);
}

/**
 * Every hop of a rumour as it bends (#1589). At each hop after the first, one generator seeded
 * by the rumour and the path it came by (`rumour-drift|<id>|<who told it so far>`), so it's the
 * same in every run, and two people it could reach next roll the same dice and differ only in how
 * they tell it. Five draws, always taken, so one bend never changes what the next draw is:
 * - the number grows as #1580's does, by the teller's culture's `growth`;
 * - the place moves with chance PLACE_SHIFT, by the culture's `shift`;
 * - the name swaps with chance NAME_SWAP for someone else of the true one's People (`swapsFor`);
 * - a weak tie holding it doubles all three, and a hop between members of one organisation takes
 *   its care (ORG_DRIFT: the careful pass it on exactly, the number and all);
 * - confidence falls by the teller's `toldOn` (an honour-bound teller keeps more of it), and by
 *   LEAK_DOUBT more at the hop a secret gets out;
 * - a teller whose bias is strong enough adds their own line.
 * The number never falls, so it never shrinks below the truth.
 */
function bentDrift(r: RumourEntry, features: FeatureSwitches | undefined): RumourHop[] {
  return bentPath(r, features).map(b => b.hop);
}

/** How a rumour stands with one holder as it bends: what it says, how sure, and whether it's out of its organisation yet. */
interface Bent { n: number; where: string; who?: string; confidence: number; outside: boolean }

/** A holder's hop, with how it stands and the chain it came down (the one who saw it first, the holder last). */
interface BentHop { hop: RumourHop; state: Bent; chain: readonly string[] }

/** `bentDrift`, with each hop's state and chain: what a telling on from any of them starts from (#1661, `reachedDrift`). */
function bentPath(r: RumourEntry, features: FeatureSwitches | undefined): BentHop[] {
  const out: BentHop[] = [];
  let state: Bent = { n: r.truth.n, where: r.truth.where, ...(r.truth.who ? { who: r.truth.who } : {}), confidence: SAW_CONFIDENCE, outside: false };
  r.path.forEach((holder, hop) => {
    let frame: string | undefined;
    if (hop > 0) ({ frame, ...state } = bendOnce(r, state, r.path.slice(0, hop), holder, features));
    out.push({ hop: hopOf(r, hop, holder, state, frame, r.path[hop - 1]), state, chain: r.path.slice(0, hop + 1) });
  });
  return out;
}

/**
 * One telling on (#1589's rule, `bentDrift`): `holder` hears it from the last of `chain` (who had
 * it as `was`), by the dice of the chain it came down, and bends it their way.
 */
function bendOnce(r: RumourEntry, was: Bent, chain: readonly string[], holder: string, features: FeatureSwitches | undefined): Bent & { frame?: string } {
  const org = r.leak ? ROAD_ORGS[r.leak] : undefined;
  const from = chain[chain.length - 1];
  const rand = generator(seedOf(`rumour-drift|${r.id}|${chain.join('>')}`));
  const telling = tellingOf(PEOPLE[holder]?.culture ?? '');
  const drift = (carriesFar(holder) ? 2 : 1) * orgDrift(from, holder);
  const grow = rand(), moves = rand(), pick = rand(), swaps = rand(), whom = rand();
  let { n, where, who, confidence, outside } = was;
  if (drift > 0) {
    n += Math.max(1, Math.round(n * grow * DRIFT_GROWTH * drift * telling.growth));
    const others = r.places.filter(p => p !== where);
    if (moves < PLACE_SHIFT * drift * telling.shift && others.length) where = others[Math.floor(pick * others.length)];
    const pool = who && r.truth.who ? swapsFor(r.truth.who, who, [...chain, holder], features) : [];
    if (swaps < NAME_SWAP * drift && pool.length) who = pool[Math.floor(whom * pool.length)];
  }
  confidence *= telling.toldOn;
  if (org && !outside && !isMember(holder, org.id)) { confidence *= LEAK_DOUBT; outside = true; }
  return { n, where, ...(who ? { who } : {}), confidence, outside, ...(telling.frame ? { frame: telling.frame } : {}) };
}

/** A holder's hop as they'd tell it, from how it stands with them (`from`: who told them). */
function hopOf(r: RumourEntry, hop: number, holder: string, b: Bent, frame: string | undefined, from: string | undefined): RumourHop {
  const org = r.leak ? ROAD_ORGS[r.leak] : undefined;
  const source = sourceAt(hop);
  const words = told(r, source, b.n, b.where, b.who, from);
  const truth: Truth = b.n === r.truth.n && b.where === r.truth.where && b.who === r.truth.who ? 'true' : 'rumour';
  // A secret is the organisation's to keep while it's among members (gated as the organisation
  // keeps its business, knowledge.ts SECRECY_FLOOR); once out, people are still careful with it.
  const sensitivity: Sensitivity = !org ? 'public' : b.outside ? 'guarded' : org.secrecy === 'secret' ? 'secret' : 'guarded';
  return { holder, hop, n: b.n, where: b.where, text: frame ? `${words} ${frame}` : words, truth, source, confidence: b.confidence, ...(b.who ? { who: b.who } : {}), sensitivity };
}

/**
 * Every hop of a rumour: as it bends (#1589, `bentDrift`) with `rumour-drift` on in the run, else
 * by #1580's rule (`firstDrift`), as every run from before the switch heard it.
 */
export const driftOf = (r: RumourEntry, features?: FeatureSwitches): RumourHop[] =>
  (featureOn(features, 'rumour-drift') ? bentDrift(r, features) : firstDrift(r));

// ── Who a claim reaches (#1589) ─────────────────────────────────────────────

/** Below this confidence nobody bothers to pass a claim on: about the fifth telling. */
export const FORGOTTEN_AT = 0.25;
/** The chance a member lets a secret out to one outsider: halved for a secret organisation, as the engine halves a guild's. */
export const LEAK_CHANCE: Readonly<Record<'guarded' | 'secret', number>> = { guarded: 0.5, secret: 0.25 };

/** Someone a claim reaches: at which hop, from whom, how, and how sure it is by then. */
export interface Reached { person: string; hop: number; from: string; carriage: Carriage; confidence: number }

/** The rule switch that puts reach in play (#1661): who a rumour reached knows it, and insiders keep their organisation's secrets. */
export const REACH_FEATURE = 'reach-and-secrets';

/**
 * How far a rumour has travelled by the time the Warden comes (#1661): **far** once a weak tie has
 * carried it between villages (a hop of its path by the road, `carriage`), else **near**, still
 * close to where it started. Read off the path as written.
 */
export const reachKind = (r: RumourEntry): 'near' | 'far' =>
  (r.path.some((pid, i) => i > 0 && carriage(r.path[i - 1], pid) === 'road') ? 'far' : 'near');

/**
 * Everyone a rumour reaches beyond its path (#1589), nearest first: from each holder, everyone
 * they can pass it to (`carriage`), and on from them, until it's too unsure to bother with
 * (FORGOTTEN_AT). A leaked secret crosses from a member to an outsider only on a leak roll
 * (LEAK_CHANCE, doubled for a member who talks for a living), seeded by the rumour and the two of
 * them. With `reach-and-secrets` on (#1661) a near rumour (`reachKind`) hasn't left home yet:
 * it passes between neighbours only, never by the road or to fellow members elsewhere, so it
 * reaches fewer and is told truer; and everyone a rumour reaches knows it in play (`rumourFacts`).
 * Off, nothing in play reads it: the path is who holds it.
 */
export function reachOf(r: RumourEntry, features?: FeatureSwitches): Reached[] {
  const hops = driftOf(r, features);
  const near = featureOn(features, REACH_FEATURE) && reachKind(r) === 'near';
  const org = r.leak ? ROAD_ORGS[r.leak] : undefined;
  const secrecy = org?.secrecy === 'secret' || org?.secrecy === 'guarded' ? org.secrecy : undefined;
  const seen = new Set(hops.map(h => h.holder));
  const out: Reached[] = [];
  let frontier = hops.map(h => ({ person: h.holder, hop: h.hop, confidence: h.confidence }));
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const f of frontier) for (const p of EVERYONE) {
      if (seen.has(p.id)) continue;
      const how = carriage(f.person, p.id);
      if (!how || (near && how !== 'village')) continue;
      let confidence = f.confidence * tellingOf(p.culture).toldOn;
      if (org && secrecy && isMember(f.person, org.id) && !isMember(p.id, org.id)) {
        const chance = LEAK_CHANCE[secrecy] * (carriesFar(f.person) ? 2 : 1);
        if (generator(seedOf(`rumour-leak|${r.id}|${f.person}>${p.id}`))() >= chance) continue;
        confidence *= LEAK_DOUBT;
      }
      if (confidence < FORGOTTEN_AT) continue;
      seen.add(p.id);
      out.push({ person: p.id, hop: f.hop + 1, from: f.person, carriage: how, confidence });
      next.push({ person: p.id, hop: f.hop + 1, confidence });
    }
    frontier = next;
  }
  return out;
}

/**
 * How everyone a rumour reached tells it (#1661), nearest first: each hears it from whoever passed
 * it on (`reachOf`) and bends it their way, by #1589's rule, rolled on the chain it came down
 * (`bendOnce`), so someone it could have reached next on its path tells it as they would have
 * there. The further it's come, the more it's bent. How sure it is, is how sure `reachOf` found it.
 */
function reachedDrift(r: RumourEntry, features: FeatureSwitches | undefined): RumourHop[] {
  const had = new Map<string, BentHop>(bentPath(r, features).map(b => [b.hop.holder, b] as const));
  return reachOf(r, features).map(x => {
    const from = had.get(x.from)!;
    const { frame, ...state } = bendOnce(r, from.state, from.chain, x.person, features);
    const reached: BentHop = { hop: hopOf(r, x.hop, x.person, { ...state, confidence: x.confidence }, frame, x.from), state: { ...state, confidence: x.confidence }, chain: [...from.chain, x.person] };
    had.set(x.person, reached);
    return reached.hop;
  });
}

/**
 * Everyone who knows a rumour, and how they tell it (#1661): its path (`driftOf`), and with
 * `reach-and-secrets` and `rumour-drift` on, everyone it reached (`reachedDrift`). Off, its path.
 */
export const knownBy = (r: RumourEntry, features?: FeatureSwitches): RumourHop[] =>
  [...driftOf(r, features), ...(reachInPlay(features) ? reachedDrift(r, features) : [])];

/** Whether a run's rumours reach past their paths (#1661): reach is of bent rumours, so it needs `rumour-drift` too. */
const reachInPlay = (features: FeatureSwitches | undefined): boolean =>
  featureOn(features, REACH_FEATURE) && featureOn(features, 'rumour-drift');

/** A rumour fact's hop, by the fact itself: which rumour, and how far it's come. Filled as each set of facts is built. */
const HOPS = new WeakMap<Fact, { rumour: RumourEntry; hop: RumourHop }>();

/** The rumours a run plays with: those that came with `rumours-and-lies`, and each that came with a later switch (`feature`) that's on. */
const rumoursIn = (features: FeatureSwitches | undefined): RumourEntry[] =>
  RUMOUR_ENTRIES.filter(r => !r.feature || featureOn(features, r.feature));

/**
 * What the rumours give the knowledge model: each hop is a fact in its holder's own scope
 * (`rumour:<id>:<hop>`), so it's the most specific thing they know about the topic, and carries
 * where they got it (`claimSource`), which is the hedge they say it with. By the run's switches:
 * which rumours, and how they drift (`driftOf`). With none given, #1580's, as it shipped.
 *
 * With `reach-and-secrets` on (#1661): everyone a bent rumour reached knows it too
 * (`rumour:<id>:<hop>:<person>`, `knownBy`) as news heard in passing (knowledge.ts `hearsay`: told
 * after what they know of their own village, before what everyone says), but nobody repeats a
 * rumour about themself; and a leaked secret held by a member of its organisation is kept by it
 * (`keptBy`), as its own business.
 */
export function rumourFacts(features?: FeatureSwitches): Fact[] {
  return factsOfRumours(rumoursIn(features), features);
}

/**
 * The facts any rumours give the knowledge model, by `rumourFacts`' rule: the written ones, or
 * (#1662, run-rumours.ts) those made for one run. `hearsay` marks every holder's fact as news
 * heard in passing, the path's too (knowledge.ts `hearsay`): a run's own rumours then answer after
 * what a person knows of themself, their organisations and their village, and before what the
 * country and the road say, so they add answers without taking any written one's place.
 */
export function factsOfRumours(rumours: readonly RumourEntry[], features: FeatureSwitches | undefined, opts: { hearsay?: boolean } = {}): Fact[] {
  const keeping = featureOn(features, REACH_FEATURE);
  return rumours.flatMap(r => knownBy(r, features)
    .filter((h, i) => i < r.path.length || !r.about.includes(`person:${h.holder}`))
    .map((h, i) => {
      const fact: Fact = {
        id: i < r.path.length ? `rumour:${r.id}:${h.hop}` : `rumour:${r.id}:${h.hop}:${h.holder}`,
        about: r.about,
        text: h.text,
        scope: { kind: 'person' as const, id: h.holder },
        sensitivity: h.sensitivity,
        truth: h.truth,
        claimSource: h.source,
        ...(keeping && r.leak && isMember(h.holder, r.leak) ? { keptBy: r.leak } : {}),
        ...(i < r.path.length && !opts.hearsay ? {} : { hearsay: true }),
      };
      HOPS.set(fact, { rumour: r, hop: h });
      return fact;
    }));
}

const RUMOUR_SETS = new Map<string, readonly Fact[]>();

/**
 * Which set of rumour facts a run's switches give, as a key: by the switches that change them,
 * `rumour-drift` (which rumours, and how they bend) and, with it on, `humans-on-the-road` (who
 * someone is, so who a name can swap to) and `reach-and-secrets` (who else knows them, #1661).
 */
export const rumourSetKey = (features: FeatureSwitches | undefined): string =>
  (featureOn(features, 'rumour-drift') ? `${featureOn(features, 'humans-on-the-road') ? 'bent+humans' : 'bent'}${featureOn(features, REACH_FEATURE) ? '+reach' : ''}` : 'first');

/** The rumours' facts a run plays with, by its saved switches: each combination built once and kept, so a run's facts are always the same array. */
export function rumourFactsFor(features: FeatureSwitches | undefined): readonly Fact[] {
  const key = rumourSetKey(features);
  let facts = RUMOUR_SETS.get(key);
  if (!facts) { facts = rumourFacts(features); RUMOUR_SETS.set(key, facts); }
  return facts;
}

/** The rumours' facts as #1580 shipped them: every run from before `rumour-drift` hears these. */
export const RUMOUR_FACTS: readonly Fact[] = rumourFactsFor({ 'rumour-drift': false, 'humans-on-the-road': false });

/** The rumours' facts a new game plays with, by every rule switch's default. */
export const DEFAULT_RUMOUR_FACTS: readonly Fact[] = rumourFactsFor(ruleFeatures());

/** The hop a fact is, if it's a rumour's (one of the facts `rumourFactsFor` built). */
export const rumourHopOf = (fact: Fact): { rumour: RumourEntry; hop: RumourHop } | undefined => HOPS.get(fact);

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
/**
 * The proposition a fact speaks to, if any. Someone a rumour reached (#1661, `rumour:<id>:<hop>:<person>`)
 * speaks to the rumour, as its path's holders do.
 */
export const propositionOfFact = (factId: string): string | undefined => {
  const reached = /^rumour:([^:]+):\d+:/.exec(factId)?.[1];
  return BY_FACT.get(factId) ?? (reached && PROPOSITIONS[reached] ? reached : undefined);
};

// ── Lies ────────────────────────────────────────────────────────────────────

/** A lie as written, as the knowledge model reads it. */
const asLie = (l: LieEntry): Lie => ({ id: l.id, about: l.about, text: l.text, why: l.why, until: l.until, sounds: l.sounds });

/** Every lie, by who tells it, as the knowledge model reads it (knowledge.ts `Lie`). */
const ROAD_LIES: Readonly<Record<string, readonly Lie[]>> = LIE_ENTRIES.reduce<Record<string, Lie[]>>((by, l) => {
  (by[l.person] ??= []).push(asLie(l));
  return by;
}, {});

const NO_LIES: Readonly<Record<string, readonly Lie[]>> = {};

/** The rule switch that varies the run's liars (#1662), and its rumours (run-rumours.ts). */
export const RUN_RUMOURS = 'run-rumours';

/**
 * How many of the road's people lie in one run (#1662; the owner: "3 of 18 is about right"): the
 * three written liars always (the written lies stay as a base), and with `run-rumours` on, up to
 * one more from the pool (`poolLies`). So 3–4 of the road's 17.
 */
export const LIARS = { min: 3, max: 4 } as const;

/** The pooled liars, by person, in the order written: each has one lie (or more) that only some runs hear. */
const POOL_LIARS: readonly string[] = [...new Set(POOL_LIE_ENTRIES.map(l => l.person))];

/** Each seed's lies, built once and kept (a handful: one run plays at a time, a few on a server). */
const RUN_LIES = new Map<number, Readonly<Record<string, readonly Lie[]>>>();
const RUN_LIES_KEPT = 16;

/**
 * Which pooled liars join the written ones in a run (#1662), by its seed alone: how many (0 up to
 * LIARS.max − LIARS.min, one draw), then which (a shuffle of the pool). Both are seeded by their own
 * string keys (`run-lies|<seed>`, `run-lies|<seed>|order`), never by a draw from the sim's
 * streams, so switching this on changes no other dice in the run, and nothing new is saved: a
 * reloaded run reads the same liars off the same seed.
 */
export function pooledLiars(seed: number): string[] {
  const extra = Math.floor(generator(seedOf(`run-lies|${seed}`))() * (LIARS.max - LIARS.min + 1));
  return shuffled(POOL_LIARS, seedOf(`run-lies|${seed}|order`)).slice(0, extra);
}

/**
 * The lies a run plays with, by person, by its saved switches: every written lie with
 * `rumours-and-lies` on, none off (and in every run from before the switch, where a person who'd
 * rather not say says "not yet", as they always did). With `run-rumours` on too (#1662) and the
 * run's seed given, the pooled liars its seed picks (`pooledLiars`) lie as well. Without a seed, or
 * with the switch off, the written lies alone: the very same object, as before.
 */
export function liesFor(features: FeatureSwitches | undefined, seed?: number): Readonly<Record<string, readonly Lie[]>> {
  if (!featureOn(features, 'rumours-and-lies')) return NO_LIES;
  if (seed === undefined || !featureOn(features, RUN_RUMOURS)) return ROAD_LIES;
  let lies = RUN_LIES.get(seed);
  if (!lies) {
    const picked = new Set(pooledLiars(seed));
    const by: Record<string, Lie[]> = Object.fromEntries(Object.entries(ROAD_LIES).map(([pid, ls]) => [pid, [...ls]]));
    for (const l of POOL_LIE_ENTRIES) if (picked.has(l.person)) (by[l.person] ??= []).push(asLie(l));
    lies = by;
    RUN_LIES.set(seed, lies);
    while (RUN_LIES.size > RUN_LIES_KEPT) RUN_LIES.delete(RUN_LIES.keys().next().value!);
  }
  return lies;
}

/** The lies a run plays with (`liesFor`), read off the run itself: its switches, and its Warden, whose id seeds it. */
export const liesOfRun = (run: { features?: FeatureSwitches; character: { id: string } }): Readonly<Record<string, readonly Lie[]>> =>
  liesFor(run.features, seedOf(run.character.id));

/** A lie as written, by id: the written ones, then the pool's (#1662). */
export const lieById = (id: string): LieEntry | undefined => LIE_ENTRIES.find(l => l.id === id) ?? POOL_LIE_ENTRIES.find(l => l.id === id);

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
