/**
 * Consistency is rewarded (#1663): the road's people learn what to expect of the Warden.
 *
 * People judge the Warden not only by single deeds (help.ts, #1659) but by a **track record** they
 * can rely on. The record is read off the deed history the road already keeps (`RoadState.helps`,
 * in order), so a save carries nothing new beyond the deed kinds below. Four traits (the owner's
 * answer 1 of 2026-10-12):
 *
 * | Trait    | +1 (one way)                    | −1 (the other way)               |
 * | -------- | ------------------------------- | -------------------------------- |
 * | dealing  | pays fair (`sold`, `bought`)    | haggles hard (`haggled`)         |
 * | word     | keeps it (`task`)               | abandons it (`failed`, `expired`) |
 * | truth    | (nothing recorded yet)          | caught lying (`lied`)            |
 * | sides    | a job done for them or a friend | a job done for their rival       |
 *
 * Memory is **recency-weighted** (answer 2): each trait's latest deed counts fully, each one before
 * it DECAY as much as the one after, so a recent change slowly outweighs an old pattern.
 *
 * Two **separate pure functions** over the history (the owner: "2 separate functions"), and neither
 * reads the other's result:
 * - `predictability(deeds, person)`: how *consistent* the record they know is, whichever way it
 *   points. Steady earns expected terms, fewer haggling rounds and no suspicion; erratic earns a
 *   hedge on the price and suspicion (their gates read higher).
 * - `trust(deeds, person)`: how *well* the Warden has dealt, with adversarial deeds (hard bargains,
 *   siding against them, broken word, lies) lowering it by themselves. Trusted earns credit (in
 *   today's trade: the regular's rate) and confidences (their gates read lower).
 * So a consistent hard bargainer is predictable but not trusted (quick, expected terms; no credit,
 * no confidences), a consistent fair dealer is both, and an erratic one is neither.
 *
 * **Word travels** (`heardBy`): a person knows the deeds done with them, with anyone in their own
 * village, with anyone they're tied to (ties.ts, so the next village's friend has heard), and with
 * the caravan's people, who carry word ahead to every village; the caravan's own see everything.
 *
 * What has no source in the game yet: there's no haggling on the road (every trade is at the
 * trader's price, so every trade is fair dealing) and the Warden never lies to anyone. The
 * `haggled` and `lied` kinds are read here all the same, and tested with synthetic deeds, so the
 * day haggling or the Warden's own lies arrive they only need recording.
 *
 * Behind the `consistency` rule switch (absent: false): off, nothing is recorded and nothing here
 * is read. Its deeds are the ones `grudges-and-help` records, so it needs that switch too.
 *
 * Pure and deterministic.
 */

import { featureOn, type FeatureSwitches } from './features';
import type { HelpDeed } from './help';
import { helpRipples, tiesOf } from './ties';
import { TRAVELLERS, VILLAGES } from './villages';

/** The rule switch this comes with. */
export const CONSISTENCY_FEATURE = 'consistency';

export type Trait = 'dealing' | 'word' | 'truth' | 'sides';

/** How much less each earlier deed in a trait counts than the one after it: recent behaviour slowly outweighs an old pattern. */
export const DECAY = 0.85;
/** Evidence a record needs before it counts for much: a record of weight W counts W / (W + PRIOR). */
export const PRIOR = 2;
/** Predictability at or above this is a steady record: people know what to expect. */
export const STEADY = 0.5;
/** Predictability at or below this is an erratic one: people hedge. */
export const ERRATIC = -0.3;
/** Trust at or above this earns credit and confidences. */
export const TRUSTED = 0.5;
/** An erratic record's hedge: you pay this much more and are paid this much less. */
export const HEDGE = 1.1;
/** How much higher an erratic record makes someone's gates read: they're wary of you. */
export const SUSPICION = 5;
/** How much lower a trusted record makes someone's gates read: they confide sooner. */
export const CONFIDE = 5;
/** Haggling rounds a trade takes with a stranger; a steady record cuts it to one, an erratic one adds one. */
export const HAGGLE_ROUNDS = 3;

/** One event of a trait, as the person sees it: which way it went. */
interface Mark { trait: Trait; sign: 1 | -1 }

/** Which village a road person lives in, or null for the caravan's and anyone elsewhere. */
const villageOfPerson = (pid: string): string | null =>
  Object.entries(VILLAGES).find(([, v]) => v.people.some(p => p.id === pid))?.[0] ?? null;

const isTraveller = (pid: string): boolean => TRAVELLERS.some(t => t.id === pid);

/**
 * The deeds `person` knows of, in order (word travels): done with them, with someone in their
 * village, with someone they're tied to (and hold a view of), or with the caravan, whose people
 * carry it ahead. The caravan's own ride with the Warden and know every deed.
 */
export function heardBy(deeds: readonly HelpDeed[], person: string, features?: FeatureSwitches): HelpDeed[] {
  if (isTraveller(person)) return [...deeds];
  const village = villageOfPerson(person);
  const tied = new Set(tiesOf(person, features).map(t => t.other));
  return deeds.filter(d => d.who === person || tied.has(d.who) || isTraveller(d.who) || (village !== null && villageOfPerson(d.who) === village));
}

/**
 * What one deed tells `person` about the Warden's traits. Siding is from their side: a job done
 * for them, or for someone their ties make them glad of, is with them; one for their rival, or
 * someone they think ill of, is against them (ties.ts `helpRipples`, read for its sign only).
 */
function marksOf(deed: HelpDeed, person: string, features: FeatureSwitches | undefined): Mark[] {
  switch (deed.kind) {
    case 'sold': case 'bought': return [{ trait: 'dealing', sign: 1 }];
    case 'haggled': return [{ trait: 'dealing', sign: -1 }];
    case 'failed': case 'expired': return [{ trait: 'word', sign: -1 }];
    case 'lied': return [{ trait: 'truth', sign: -1 }];
    case 'task': {
      const out: Mark[] = [{ trait: 'word', sign: 1 }];
      const side = deed.who === person ? 1 : Math.sign(helpRipples(deed.who, 100, features)[person] ?? 0);
      if (side) out.push({ trait: 'sides', sign: side as 1 | -1 });
      return out;
    }
  }
}

/** Each trait's recency-weighted record: its weight (how much evidence) and its sum (which way). */
function records(deeds: readonly HelpDeed[], person: string, features: FeatureSwitches | undefined): Map<Trait, { weight: number; sum: number; last: 1 | -1 }> {
  const byTrait = new Map<Trait, (1 | -1)[]>();
  for (const d of heardBy(deeds, person, features)) for (const m of marksOf(d, person, features)) byTrait.set(m.trait, [...(byTrait.get(m.trait) ?? []), m.sign]);
  const out = new Map<Trait, { weight: number; sum: number; last: 1 | -1 }>();
  for (const [trait, signs] of byTrait) {
    let weight = 0, sum = 0;
    // The latest counts fully, the one before DECAY, the one before that DECAY², …
    signs.forEach((s, i) => { const w = DECAY ** (signs.length - 1 - i); weight += w; sum += w * s; });
    out.set(trait, { weight, sum, last: signs[signs.length - 1] });
  }
  return out;
}

export interface Predictability {
  /** −1 erratic … 0 unknown … 1 steady: how consistent the record they know is, whichever way it points. */
  score: number;
  /** What it earns: expected terms, a hedge, or (too little known) today's terms. */
  terms: 'expected' | 'hedged' | 'unknown';
  /** The price multiplier their wariness puts on a deal: HEDGE when erratic, else 1. */
  hedge: number;
  /** How much higher their gates read: SUSPICION when erratic, else 0. A steady record, even a hard one, brings none. */
  suspicion: number;
  /** Rounds of haggling a trade takes (no haggling on the road yet: read by nothing in play). */
  haggleRounds: number;
  /** What they say about it, if anything: "You always pay fair", "I never know where I stand with you". */
  says?: string;
}

/**
 * How predictable the Warden is to `person`, from the deeds they know of (#1663). Per trait: the
 * recency-weighted mean (−1…1) says which way it points; how far from 0 it is says how consistent
 * (a steady record, either way, is 1; one that alternates is near 0), mapped to −1…1 around a
 * half-and-half mix, and counted by how much evidence there is. The traits are then averaged by
 * their evidence. Reads nothing of `trust`.
 */
export function predictability(deeds: readonly HelpDeed[], person: string, features?: FeatureSwitches): Predictability {
  const recs = records(deeds, person, features);
  let total = 0, score = 0;
  for (const r of recs.values()) {
    const consistency = Math.abs(r.sum / r.weight);
    score += r.weight * (2 * consistency - 1) * (r.weight / (r.weight + PRIOR));
    total += r.weight;
  }
  score = total ? score / total : 0;
  const terms = score >= STEADY ? 'expected' : score <= ERRATIC ? 'hedged' : 'unknown';
  const dealing = recs.get('dealing');
  const says = terms === 'hedged' ? 'I never know where I stand with you. I\'ll want a little more on it.'
    : terms !== 'expected' ? undefined
      : dealing && dealing.sum > 0 ? 'You always pay fair, so I know where we stand.'
        : dealing && dealing.sum < 0 ? 'You\'ll drive it hard, I know. No point dancing about it: here\'s my price.'
          : 'I know what to expect of you.';
  return {
    score,
    terms,
    hedge: terms === 'hedged' ? HEDGE : 1,
    suspicion: terms === 'hedged' ? SUSPICION : 0,
    haggleRounds: terms === 'expected' ? 1 : terms === 'hedged' ? HAGGLE_ROUNDS + 1 : HAGGLE_ROUNDS,
    ...(says ? { says } : {}),
  };
}

/** What each deed is worth to trust: fair dealing and kept word add, adversarial deeds take away by themselves, a lie most of all. */
const TRUST_WORTH: Readonly<Record<Trait, Readonly<Record<1 | -1, number>>>> = {
  dealing: { 1: 1, [-1]: -1 },
  word: { 1: 1, [-1]: -1 },
  truth: { 1: 1, [-1]: -2 },
  sides: { 1: 1, [-1]: -1 },
};

export interface Trust {
  /** How far the record they know earns their trust: negative for an adversarial one, 0 unknown, towards 1 well earned. */
  score: number;
  /** Whether they'd extend you credit. Trade has no tab yet, so in play it's the regular's terms (trade.ts FRIEND_RATE). */
  credit: boolean;
  /** How much lower their gates read: CONFIDE when trusted, else 0. Guarded topics stay guarded otherwise. */
  confide: number;
  /** What they say about it, if anything. */
  says?: string;
}

/**
 * How far the record `person` knows earns their trust (#1663): every deed they know of is worth
 * TRUST_WORTH, recency-weighted, over the evidence plus PRIOR (so one good deed is not a record).
 * A hard bargain or siding against them counts against it on its own, however consistent. Reads
 * nothing of `predictability`.
 */
export function trust(deeds: readonly HelpDeed[], person: string, features?: FeatureSwitches): Trust {
  let weight = 0, sum = 0;
  for (const [trait, r] of records(deeds, person, features)) {
    // Each trait's weighted sum splits back into its good and bad parts: (W ± S) / 2.
    const good = (r.weight + r.sum) / 2, bad = (r.weight - r.sum) / 2;
    sum += good * TRUST_WORTH[trait][1] + bad * TRUST_WORTH[trait][-1];
    weight += r.weight;
  }
  const score = sum / (weight + PRIOR);
  const trusted = score >= TRUSTED;
  return {
    score,
    credit: trusted,
    confide: trusted ? CONFIDE : 0,
    ...(trusted ? { says: 'Your word\'s good with me. You\'ll have the regular\'s rate.' } : {}),
  };
}

/** Whether the last promise `person` knows the Warden made was broken: "Last time you promised the same." */
export function brokenWordKnown(deeds: readonly HelpDeed[], person: string, features?: FeatureSwitches): boolean {
  return records(deeds, person, features).get('word')?.last === -1;
}

/**
 * How much a person's gates move for the Warden's record (#1663): lower by what trust confides,
 * higher by what erratic suspicion holds back; the two are added, neither reading the other.
 * 0 with the `consistency` switch off, and in every run from before it.
 */
export function recordGate(deeds: readonly HelpDeed[] | undefined, person: string, features: FeatureSwitches | undefined): number {
  if (!featureOn(features, CONSISTENCY_FEATURE) || !deeds?.length) return 0;
  return trust(deeds, person, features).confide - predictability(deeds, person, features).suspicion;
}
