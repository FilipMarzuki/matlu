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
 * With the `knowledge-questions` switch (#1611), knowledge-questions.ts matches against the
 * knowledge model's topics and scopes instead, and answers through its resolution (gates hold
 * there); it builds on the pieces here (`questionFor`, `bestKnownMatch`, `deflectionOf`).
 *
 * Pure: matching and the deflection lines. Same question, same person, same match, every time.
 */

import { answerFor, topicsKnownBy } from './asks';
import { ALL_FACTS, FACTS, hasScopeFacts } from './facts';
import type { Fact } from './knowledge';
import { SKILLS, type SkillId } from './skills';
import { TOPICS, TOPIC_KINDS, isTopicKind, mentionsIn, topicDef } from './topics';
import { personById } from './villages';
import { isPastKey, pastBonus, pastPatterns } from './past-topics';
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
const BASE_HINTS: Readonly<Record<string, RegExp>> = {
  'material:iron': /\b(?:ore|metals?|steel|ironwork|arrowheads?|nails?)\b/i,
  'role:smith': /\b(?:forges?|anvils?|smithy|metalwork(?:ing)?|hammers?)\b/i,
  'place:kestrel-gate': /\b(?:the gate|gate|the wall|tolls?|toll-keeper)\b/i,
  'group:compact': /\b(?:goblins?|goblin bands?)\b/i,
  'skill:foraging': /\b(?:herbs?|mushrooms?|fungi|berries|roots|greens|edible|plants?|wild food)\b/i,
  'quest:hf-hides-saltmere': /\b(?:hides?|skins?|pelts?|Hedda)\b/i,
};

/**
 * What everyone knows (#1610): the villages, the road, and who does what. Nobody knows these
 * topics without the scope-facts switch, and they're only read in a run that has it (`scoped`
 * below): a word like "sheep" names Hollowford, and Hollowford is mentioned in answers people gave
 * before, so read in every run they'd change what an old-style question matches through a mention.
 */
const SCOPE_HINTS: Readonly<Record<string, RegExp>> = {
  'place:north-road': /\b(?:the road|this road|roads|route|journey|how far|how long|bandits?|dangers?|dangerous)\b/i,
  'place:hollowford': /\b(?:the ford|stepping stones|terraces|high fields|barley|sheep)\b/i,
  'place:saltmere': /\b(?:the mere|mere|salt lake|the lake|wells?)\b/i,
  'place:mistheim': /\b(?:lowlands?)\b/i,
  'role:elder': /\b(?:in charge|rules? (?:here|this)|leaders?|chief|headman|headwoman)\b/i,
  'role:trader': /\b(?:merchants?|shops?|wares|goods|store)\b/i,
  'role:healer': /\b(?:heal|medicine|doctor|sick|ill|fever|hurt|injur(?:y|ed|ies))\b/i,
  'role:hunter': /\b(?:hunt|game|deer|tracks?|tracking|traps?)\b/i,
  'role:teacher': /\b(?:teach(?:es)?|learn|lessons?|training)\b/i,
  'role:caravaneer': /\b(?:the caravan|caravan master|wagons?)\b/i,
  'role:tinker': /\b(?:mend|repair|fix|broken|axles?)\b/i,
  'skill:firstaid': /\b(?:wounds?|bandages?|splints?|bleeding)\b/i,
};

/** Every hint, in any run: what a topic can be named by when the scope facts are on. */
export const HINTS: Readonly<Record<string, RegExp>> = { ...BASE_HINTS, ...SCOPE_HINTS };
const hintsFor = (scoped: boolean): Readonly<Record<string, RegExp>> => (scoped ? HINTS : BASE_HINTS);

/** How a skill is asked about: "Foraging" → forage, forager, foraging; "First aid" as said. */
function skillPattern(id: string): RegExp | null {
  const name = SKILLS[id as SkillId]?.name.toLowerCase();
  if (!name) return null;
  return name.endsWith('ing') && name.length > 5 ? new RegExp(`\\b${escape(name.slice(0, -3))}\\w*`, 'i') : new RegExp(`\\b${escape(name)}s?\\b`, 'i');
}

const CONCEPT_NAMES: Readonly<Record<string, string>> = Object.fromEntries(conceptsRegistry.concepts.map(c => [c.id, c.name]));

/** Every way `key` can be named in a question; without `scoped` (a run without the scope facts, #1610), not by their hints. */
export function patternsOf(key: string, scoped = true): RegExp[] {
  // A place's history (#1656, past-topics.ts): only its facts carry these keys, so they only
  // match in a run with `history-in-play` on.
  if (isPastKey(key)) return pastPatterns(key);
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
  const hint = hintsFor(scoped)[key];
  if (hint) out.push(hint);
  return out;
}

/** Every topic a question names, by name or by hint: the topic table, read case-insensitively. */
const nameable = (scoped: boolean): readonly { key: string; re: RegExp }[] => [
  ...TOPIC_KINDS.flatMap(kind => Object.entries(TOPICS[kind]).filter(([, d]) => d.named).map(([id, d]) => ({ key: `${kind}:${id}`, re: ci(d.named!) }))),
  ...Object.entries(hintsFor(scoped)).map(([key, re]) => ({ key, re })),
];
const NAMEABLE = nameable(true);
const NAMEABLE_UNSCOPED = nameable(false);
export const topicsIn = (question: string, scoped = true): Set<string> => new Set((scoped ? NAMEABLE : NAMEABLE_UNSCOPED).filter(n => n.re.test(question)).map(n => n.key));

/** What a name or word in the question is worth: naming the topic beats naming something its answer mentions. */
export const NAMED = 3;
export const MENTIONED = 1;

/**
 * A question as matched against what `personId` might say: cut to length, with the person's own
 * name taken out. Naming the person you're asking says nothing about what you're asking them
 * ("Hedda, what's Saltmere like?" isn't about the hides she's owed, though her name points at
 * them). Empty when nothing's left.
 */
export function questionFor(personId: string, question: string): string {
  const name = personById(personId)?.name;
  const q = (name ? question.replace(new RegExp(`\\b${escape(name)}\\b`, 'gi'), ' ') : question).slice(0, QUESTION_CHARS * 2);
  return q.trim() ? q : '';
}

/** A topic a question matched among what someone knows, how well (`NAMED`, `MENTIONED`), and whether it's new to you. */
export interface KnownMatch { key: string; score: number; fresh: boolean }

/**
 * The best of the topics `personId` knows something about that `q` (already `questionFor`) names,
 * or null. The best-scoring topic wins; on a tie, one they haven't told you yet (`answered`), then
 * the first as written. `facts` defaults to the game's.
 */
export function bestKnownMatch(personId: string, q: string, answered: readonly string[] = [], facts?: readonly Fact[]): KnownMatch | null {
  if (!q) return null;
  // The scope facts' hints are read only in a run with the scope facts (#1610).
  const scoped = facts !== undefined && hasScopeFacts(facts);
  const named = topicsIn(q, scoped);
  named.delete(`person:${personId}`);
  let best: KnownMatch | null = null;
  for (const key of topicsKnownBy(personId, facts)) {
    const answer = answerFor(personId, key, facts);
    if (!answer) continue;
    // A history topic that names the event itself outranks "what happened here" (#1656, `pastBonus`).
    const direct = named.has(key) || patternsOf(key, scoped).some(re => re.test(q)) ? NAMED + pastBonus(key) : 0;
    const through = mentionsIn(answer.text).filter(k => k !== key && named.has(k)).length * MENTIONED;
    const score = direct + through;
    const fresh = !answered.includes(key);
    if (score > 0 && (!best || score > best.score || (score === best.score && fresh && !best.fresh))) best = { key, score, fresh };
  }
  return best;
}

/**
 * The topic `personId` answers `question` with, as a focus key, or null if nothing they know is in
 * it. The best-scoring topic wins; on a tie, one they haven't told you yet (`answered`), then the
 * first as written. This is #1575's matching, which a run without `knowledge-questions` plays;
 * knowledge-questions.ts `matchFreeQuestion` picks between the two by the run's switches.
 * `facts` are the run's (facts.ts `factsFor`, #1610); today's if not given.
 */
export function matchQuestion(personId: string, question: string, answered: readonly string[] = [], facts: readonly Fact[] = FACTS): string | null {
  return bestKnownMatch(personId, questionFor(personId, question), answered, facts)?.key ?? null;
}

/**
 * Whether `personId` has an answer for `key` in any game: the API keeps a web question's
 * self-reported topic with this. Every fact counts (`ALL_FACTS`), the scope facts (#1610) too,
 * since the API doesn't know which switches the asking game had.
 */
export const knowsAbout = (personId: string, key: string, facts: readonly Fact[] = ALL_FACTS): boolean => answerFor(personId, key, facts) !== undefined;

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
