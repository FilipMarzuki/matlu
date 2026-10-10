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
 * Pure: the answers, and `ask`. The road (`ask:<person>`) applies the result.
 */

import { VILLAGES, TRAVELLERS, type Person } from './villages';
import { SKILLS, type SkillId } from './skills';

/** An ask is an hour's talk. */
export const ASK_HOURS = 1;
/** The trust an answer earns: people like being asked about what they know. */
export const ASK_TRUST = 2;

export interface Answer {
  /** The trust it takes before they'll say it. */
  at: number;
  text: string;
  /** Insight in a concept, for an answer that teaches something. */
  insight?: { concept: string; amount: number };
}

/**
 * What people know, by person id and focus key (`material:iron`, `group:compact`, `skill:…`,
 * `concept:…`). A starter set; the first real content is #1498.
 */
export const ANSWERS: Readonly<Record<string, Readonly<Record<string, Answer>>>> = {
  'hf-orrin': {
    'material:iron': { at: 25, text: 'Iron? Not from these hills. They give stone and grudges. Sabine at Kestrel Gate works it; the ironborne bring ore down off the passes, and she buys the best of it.' },
  },
  'hf-tobin': {
    'material:iron': { at: 0, text: 'Iron travels badly and sells well. I\'ve never had enough to sell. Everything that goes through Kestrel Gate pays a toll in something, and the smiths there take theirs in ore.' },
    'group:compact': { at: 50, text: 'The Compact? Merchants who write everything down and forget nothing. They don\'t trade in hides. They trade in knowing first.' },
  },
  'hf-maren': {
    'group:compact': { at: 25, text: 'The Compact sent a clerk up here once to count our sheep. We counted him back down the hill.' },
  },
  'kg-sabine': {
    'material:iron': { at: 0, text: 'Heat it to the colour of a fire going out, never white. White burns the heart out of it. Then let it tell you when it\'s ready; good iron sings.', insight: { concept: 'heat-treatment', amount: 0.5 } },
  },
  'kg-arvid': {
    'group:compact': { at: 25, text: 'The Compact pays in maps. Not money. Maps of places that aren\'t on anyone else\'s, and they never sell the same one twice.' },
  },
};

/** Everyone on the road, by id: the villages' people and the caravan's own. */
const PEOPLE: Readonly<Record<string, Person>> = Object.fromEntries([...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS].map(p => [p.id, p]));

/** A teacher always knows their own skill: they'll tell anyone, and point them to a lesson. */
function teacherAnswer(p: Person, key: string): Answer | undefined {
  if (!p.teaches || key !== `skill:${p.teaches.skill}`) return undefined;
  const name = SKILLS[p.teaches.skill as SkillId]?.name ?? p.teaches.skill;
  const shows = p.teaches.techniques.length ? ` I can show you ${p.teaches.techniques.length === 1 ? 'one way' : `${p.teaches.techniques.length} ways`} to do it better.` : '';
  return { at: 0, text: `${name}? That's what I teach.${shows} Come and learn when you have the time.` };
}

/** What `personId` would say about the focus `key`, if they know anything (and at what trust). */
export function answerFor(personId: string, key: string): Answer | undefined {
  const p = PEOPLE[personId];
  return ANSWERS[personId]?.[key] ?? (p ? teacherAnswer(p, key) : undefined);
}

export type AskResult =
  | { kind: 'told'; line: string; answer: Answer }
  | { kind: 'not-yet'; line: string }
  | { kind: 'unknown'; line: string }
  /** Asked and answered before: nothing new, and no time spent. */
  | { kind: 'again'; line: string };

/**
 * Ask `p` about the focus `key` (`about` is how it reads mid-sentence: "iron", "the Compact"),
 * given their trust in you and the topics they've already answered.
 */
export function ask(p: Person, key: string, about: string, trust: number, answered: readonly string[]): AskResult {
  if (answered.includes(key)) return { kind: 'again', line: `${p.name} has already told you what they know about ${about}.` };
  const a = answerFor(p.id, key);
  if (!a) return { kind: 'unknown', line: `${p.name} thinks, and shakes their head. "I don't know much about ${about}."` };
  if (trust < a.at) return { kind: 'not-yet', line: `${p.name} looks at you a long moment. "Maybe. Ask me again when I know you better."` };
  return { kind: 'told', line: `${p.name}: "${a.text}"`, answer: a };
}
