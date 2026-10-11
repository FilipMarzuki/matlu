/**
 * Asking people about what you're focused on (#1495, epic #1493 — docs/focus-and-dialogue-design.md §2).
 *
 * Talking to someone on the road is a short conversation: Chat (the lore line, `talk` in
 * villages.ts) and **Ask about <your focus>**. Focus is attention: what you're turning over is
 * what you think to ask about. The person:
 * - **knows**: an answer, told once their trust reaches its gate;
 * - **won't say yet**: they know, and you're still a stranger;
 * - **doesn't know**: which is worth knowing too.
 *
 * What they name in an answer you've come across (`mentionsIn`), so an answer can point you on:
 * "Sabine at Kestrel Gate works it" opens Sabine, and Kestrel Gate, as a focus.
 *
 * Pure: `ask` and the lookups over the knowledge model (facts.ts, #1609); the hand-written answers
 * themselves are in answers.ts. The road (`ask:<person>`) applies the result.
 */

import { VILLAGES, TRAVELLERS, type Person } from './villages';
import type { Answer } from './answers';
import { answerOf, knowerOf, resolve, FACTS } from './facts';
import { knows } from './knowledge';

// The answers themselves moved to answers.ts (#1609); re-exported so existing imports still work.
export { ANSWERS, type Answer } from './answers';

/** An ask is an hour's talk. */
export const ASK_HOURS = 1;
/** The trust an answer earns: people like being asked about what they know. */
export const ASK_TRUST = 2;
/** A lead is worth one trust gate with the person it points to, on its topic: someone sent you (#1497). */
export const LEAD_TRUST = 25;

/**
 * A lead (#1497): someone an answer pointed you to. Who (a person id), where (their village, if
 * they have one), about what (a focus key), and who told you (a person id).
 */
export interface Lead { who: string; where?: string; about: string; from: string }

/** The trust telling someone what you did earns (#1499): more than asking, since it's about their own. */
export const TELL_TRUST = 10;

/** Something you did in the Reach, told to someone it means something to (#1499): what you say, and what they answer. */
export interface Tell { label: string; answer: Answer }

/**
 * What you can tell, by person id and deed (#1499, design §2: "asks from what happened"). A deed
 * an encounter recorded opens it; told once, it's remembered (as `deed:<id>` in what they've answered).
 */
export const TELLS: Readonly<Record<string, Readonly<Record<string, Tell>>>> = {
  // The Vidde Accords: the Viddfolk keep the road, and the road keeps its debts.
  'sm-yrsa': {
    'herald-owes-you': { label: 'the lost herald', answer: { at: 0, text: 'That was you? She came down the valley singing about a stranger who knew east from west. Under the Accords the road keeps its debts. Sit; the next fire is yours.' } },
  },
  'cv-runa': {
    'herald-owes-you': { label: 'the lost herald', answer: { at: 0, text: 'Oh, I have that verse already. I didn\'t know it was you in it. Now I have to fix the rhyme.' } },
  },
  // A Pandor writes everything down, and reads what other Pandor write.
  'sm-anselm': {
    'warmed-the-scholar': { label: 'the old scholar under the rock', answer: { at: 0, text: 'Under the overhang, talking to his notes? He writes to the book every winter. This year he wrote that someone brought him firewood. He doesn\'t usually mention people. Let me show you the page; he drew the joint he taught you.', insight: { concept: 'joinery', amount: 1 } } },
  },
  // The refuge takes in whoever the road spits out; one came through who'd been fed.
  'sm-liv': {
    'fed-the-stranger': { label: 'the starving man on the path', answer: { at: 0, text: 'A Markfolk man, thin as a rake? He came through the refuge a month ago and said a Warden up there shared their food when they had little. He\'s mending nets on the north shore now. You\'ll eat with us tonight.' } },
  },
  // The hunter at the stream was from Hollowford, and Orrin knows everyone who hunts there.
  'hf-orrin': {
    'heard-road-early': { label: 'the hunter by the stream', answer: { at: 0, text: 'A Bergfolk woman gutting hares, autumn, high stream? That\'s my sister\'s girl. She said someone was wintering up there and she didn\'t give them a week. Well. Look at you.' } },
  },
};

/** What `deeds` let you tell `personId`: the deed and the tell, for each one they'd hear. */
export const tellsFor = (personId: string, deeds: readonly string[] | undefined): { deed: string; tell: Tell }[] =>
  Object.entries(TELLS[personId] ?? {}).filter(([deed]) => (deeds ?? []).includes(deed)).map(([deed, tell]) => ({ deed, tell }));

/** Everyone on the road, by id: the villages' people and the caravan's own. */
const PEOPLE: Readonly<Record<string, Person>> = Object.fromEntries([...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS].map(p => [p.id, p]));

/** Where `who` lives: a village id, or undefined for someone on the road (the caravan's own). */
const homeOf = (who: string): string | undefined => Object.values(VILLAGES).find(v => v.people.some(p => p.id === who))?.id;

/** The lead an answer gives, told by `from` when asked about `key`. */
export function leadOf(a: Answer, key: string, from: string): Lead | undefined {
  if (!a.lead || !PEOPLE[a.lead.who]) return undefined;
  const where = homeOf(a.lead.who);
  return { who: a.lead.who, ...(where ? { where } : {}), about: a.lead.about ?? key, from };
}

/**
 * A saved lead, checked against what people say: kept only if `from` has an answer that sends you
 * to `who` about `about`, and rebuilt from that answer (so `where` comes from the data, not the save).
 * A lead no answer gives is dropped, as a saved focus you can no longer hold is (`readFocus`).
 */
export function leadOnLoad(who: string, about: string, from: string): Lead | undefined {
  for (const key of topicsKnownBy(from)) {
    const a = answerFor(from, key);
    const l = a && leadOf(a, key, from);
    if (l && l.who === who && l.about === about) return l;
  }
  return undefined;
}

/** Whether a lead sends you to `who` about `key`: they'll answer it one trust gate early. */
export const sentTo = (leads: readonly Lead[] | undefined, who: string, key: string): boolean => (leads ?? []).some(l => l.who === who && l.about === key);

/**
 * What `personId` would say about the focus `key`, if they know anything (and at what trust).
 *
 * Since #1609 a thin wrapper over the knowledge model: the most specific fact they know about it,
 * as an Answer, whatever your trust. Asking with infinite trust is how "whatever your trust" is
 * said to the model: every gate opens, so the fact comes back `told` if they know one at all.
 * No one else is passed in, since who'd know instead doesn't matter here.
 */
export function answerFor(personId: string, key: string): Answer | undefined {
  const r = resolve(personId, key, Infinity, { others: [] });
  return r?.kind === 'told' ? answerOf(r.fact) : undefined;
}

/**
 * Every focus key `personId` has an answer for: the topics of every fact they know, in the order
 * the facts are written (their own hand-written answers, then a teacher's own skill), each once.
 */
export function topicsKnownBy(personId: string): string[] {
  const k = knowerOf(personId);
  if (!k) return [];
  // A Set keeps the first time each key is seen, in insertion order, so the result is deduplicated
  // without losing the order the facts are written in.
  return [...new Set(FACTS.filter(f => knows(k, f)).flatMap(f => f.about))];
}

export type AskResult =
  | { kind: 'told'; line: string; answer: Answer }
  | { kind: 'not-yet'; line: string }
  /**
   * They don't know. `referral` is who nearby would (the knowledge model's transactive memory,
   * #1609), or null. With referrals on (`opts.referrals`) the line names them; off, it's the line
   * from before referrals, word for word.
   */
  | { kind: 'unknown'; line: string; referral: string | null }
  /** Asked and answered before: nothing new, and no time spent. */
  | { kind: 'again'; line: string };

/**
 * Ask `p` about the focus `key` (`about` is how it reads mid-sentence: "iron", "the Compact"),
 * given their trust in you and the topics they've already answered. The knowledge model decides
 * (facts.ts `resolve`): told, not yet (the gate is the true trust you bring, never a felt word),
 * or doesn't know, and who nearby would.
 */
export function ask(p: Person, key: string, about: string, trust: number, answered: readonly string[], opts: { referrals?: boolean } = {}): AskResult {
  if (answered.includes(key)) return { kind: 'again', line: `${p.name} has already told you what they know about ${about}.` };
  const r = resolve(p.id, key, trust);
  if (!r || r.kind === 'unknown') {
    const referral = r?.referral ?? null;
    // The referrals switch (#1609) is the run's, so the caller passes it in: a caller that doesn't
    // (or a run with it off) reads exactly as before referrals.
    const name = opts.referrals && referral ? PEOPLE[referral]?.name : undefined;
    const line = name
      ? `${p.name} thinks, and shakes their head. "I couldn't tell you — ${name} would know."`
      : `${p.name} thinks, and shakes their head. "I don't know much about ${about}."`;
    return { kind: 'unknown', line, referral };
  }
  // No one lies yet (that's slice G, #1580), so the model only says told, not yet or unknown here;
  // a lie would read as not yet until then, which is what the person would be doing: not telling.
  if (r.kind !== 'told') return { kind: 'not-yet', line: `${p.name} looks at you a long moment. "Maybe. Ask me again when I know you better."` };
  const a = answerOf(r.fact);
  return { kind: 'told', line: `${p.name}: "${a.text}"`, answer: a };
}
