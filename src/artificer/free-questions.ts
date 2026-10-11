/**
 * Free questions (#1575, plan #1574): once per person per stay, the Warden can ask anything, in
 * their own words, beside Chat and the topic asks (#1495). The questions are the point: what
 * players ask shows what the game should grow, so every one is kept (artificer-play/questions.ts).
 *
 * v0 has no AI. A question is matched against the topics this person has answers for (asks.ts
 * `topicsKnownBy`), by the words in it:
 * - **named**: the topic's own name ("iron", "the Compact", "Kestrel Gate"), or a word that points
 *   at it (`HINTS`: "ore" is iron, "herbs" are foraging, "the gate" is Kestrel Gate);
 * - **through what they'd say**: the question names someone or something the answer itself talks
 *   about ("Who's Sabine?" to Orrin, whose iron answer sends you to her).
 * The best match is the topic they answer; no match, and they deflect.
 *
 * The owner's call: a free question may pass the gates. A match is answered even when the topic
 * isn't open as a focus, or the person's trust is below its gate. The road applies it
 * (`question:<person>:<topic>`), so the sim never sees the text: only the topic it matched.
 *
 * Pure: matching and the deflection lines. Same question, same person, same match, every time.
 */

import { answerFor, topicsKnownBy } from './asks';
import { SKILLS, type SkillId } from './skills';
import { TOPICS, TOPIC_KINDS, isTopicKind, mentionsIn, topicDef } from './topics';
import conceptsRegistry from './content/concepts.json';

/** Long enough for a real question, short enough not to be a letter. */
export const QUESTION_CHARS = 200;

/** Case-insensitive copies: people type "the compact" as often as "the Compact". */
const ci = (re: RegExp): RegExp => new RegExp(re.source, re.flags.includes('i') ? re.flags : `${re.flags}i`);
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Words that point at a topic without naming it, by focus key. Kept to what someone who'd met
 * these people might really ask: "Where do I get ore?", "Who knows herbs?", "What's past the gate?"
 * Only topics someone has an answer for need a line here; add one with each new answer.
 */
export const HINTS: Readonly<Record<string, RegExp>> = {
  'material:iron': /\b(?:ore|metals?|steel|ironwork|arrowheads?|nails?)\b/i,
  'role:smith': /\b(?:forges?|anvils?|smithy|metalwork(?:ing)?|hammers?)\b/i,
  'place:kestrel-gate': /\b(?:the gate|gate|the wall|tolls?|toll-keeper)\b/i,
  'group:compact': /\b(?:goblins?|goblin bands?)\b/i,
  'skill:foraging': /\b(?:herbs?|mushrooms?|fungi|berries|roots|greens|edible|plants?|wild food)\b/i,
  'quest:hf-hides-saltmere': /\b(?:hides?|skins?|pelts?|Hedda)\b/i,
};

/** How a skill is asked about: "Foraging" → forage, forager, foraging; "First aid" as said. */
function skillPattern(id: string): RegExp | null {
  const name = SKILLS[id as SkillId]?.name.toLowerCase();
  if (!name) return null;
  return name.endsWith('ing') && name.length > 5 ? new RegExp(`\\b${escape(name.slice(0, -3))}\\w*`, 'i') : new RegExp(`\\b${escape(name)}s?\\b`, 'i');
}

const CONCEPT_NAMES: Readonly<Record<string, string>> = Object.fromEntries(conceptsRegistry.concepts.map(c => [c.id, c.name]));

/** Every way `key` can be named in a question. */
function patternsOf(key: string): RegExp[] {
  const at = key.indexOf(':');
  const kind = key.slice(0, at), id = key.slice(at + 1);
  const out: RegExp[] = [];
  if (isTopicKind(kind)) {
    const named = topicDef(kind, id)?.named;
    if (named) out.push(ci(named));
  } else if (kind === 'skill') {
    const p = skillPattern(id);
    if (p) out.push(p);
  } else if (kind === 'concept' && CONCEPT_NAMES[id]) {
    out.push(new RegExp(`\\b${escape(CONCEPT_NAMES[id])}\\b`, 'i'));
  }
  if (HINTS[key]) out.push(HINTS[key]);
  return out;
}

/** Every topic a question names, by name or by hint: the topic table, read case-insensitively. */
const NAMEABLE: readonly { key: string; re: RegExp }[] = [
  ...TOPIC_KINDS.flatMap(kind => Object.entries(TOPICS[kind]).filter(([, d]) => d.named).map(([id, d]) => ({ key: `${kind}:${id}`, re: ci(d.named!) }))),
  ...Object.entries(HINTS).map(([key, re]) => ({ key, re })),
];
const topicsIn = (question: string): Set<string> => new Set(NAMEABLE.filter(n => n.re.test(question)).map(n => n.key));

/** What a name or word in the question is worth: naming the topic beats naming something its answer mentions. */
const NAMED = 3;
const MENTIONED = 1;

/**
 * The topic `personId` answers `question` with, as a focus key, or null if nothing they know is in
 * it. The best-scoring topic wins; on a tie, one they haven't told you yet (`answered`), then the
 * first as written.
 */
export function matchQuestion(personId: string, question: string, answered: readonly string[] = []): string | null {
  const q = question.slice(0, QUESTION_CHARS * 2);
  if (!q.trim()) return null;
  const named = topicsIn(q);
  // Naming the person you're asking says nothing about what you're asking them.
  named.delete(`person:${personId}`);
  let best: { key: string; score: number; fresh: boolean } | null = null;
  for (const key of topicsKnownBy(personId)) {
    const answer = answerFor(personId, key);
    if (!answer) continue;
    const direct = named.has(key) || patternsOf(key).some(re => re.test(q)) ? NAMED : 0;
    const through = mentionsIn(answer.text).filter(k => k !== key && named.has(k)).length * MENTIONED;
    const score = direct + through;
    const fresh = !answered.includes(key);
    if (score > 0 && (!best || score > best.score || (score === best.score && fresh && !best.fresh))) best = { key, score, fresh };
  }
  return best?.key ?? null;
}

/** Whether `personId` has an answer for `key`: the road checks a matched topic with this. */
export const knowsAbout = (personId: string, key: string): boolean => answerFor(personId, key) !== undefined;

const DEFLECTIONS = [
  "I'd have to think on that. Ask me something else next time.",
  "That's not mine to know. Ask me something else, next time you're through.",
  'Hm. You want someone wiser than me for that one.',
  "I couldn't tell you. Ask me about something I'd know.",
];

/** What `name` says to a question they can't answer: one line per person, always the same one. */
export function deflectionOf(personId: string, name: string): string {
  const n = [...personId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `${name} thinks it over. "${DEFLECTIONS[n % DEFLECTIONS.length]}"`;
}
