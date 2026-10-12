/**
 * Free questions answered by the knowledge model (#1611, knowledge slice E; design in
 * docs/knowledge-model-design.md §8). Behind the `knowledge-questions` rule switch: a run without
 * it plays free questions as #1575 did (free-questions.ts `matchQuestion`, answers past the gates).
 *
 * **Matching.** A question is matched, in this order, to:
 * 1. a topic the person knows a fact about, named outright ("iron", "ore", "Kestrel Gate"). Any
 *    scope counts: their own words, their job's, their village's, their region's (whatever facts.ts
 *    holds; slice C adds the wider scopes, and they're matched without any change here);
 * 2. their People's or culture's ways, from the world lore (#1590, culture-lore.ts `matchLore`):
 *    "What do the Bergfolk believe?", "What do you do when someone dies?", "What do your people
 *    think of the Fae?";
 * 3. a topic they know something about only because their answer mentions what the question names
 *    ("Who's Sabine?" to Orrin): weaker than the lore, which answers what was asked;
 * 4. with referrals on, a topic the question names that they don't know but someone nearby does.
 * Nothing, and they deflect, as before.
 *
 * **Answering.** As the model resolves it (facts.ts `resolve`): the most specific fact they know,
 * if your trust opens its gate, else *not yet*; knowing nothing, who nearby would (referrals). Lore
 * is said as culture-lore.ts voices it: a view that's wrong or half true comes out only at the
 * trust its culture's candour and the belief's strength allow, hedged before it's plain.
 *
 * **The stored move never carries the words** (owner, #1575): it's `question:<person>[:<topic>]`,
 * and a lore topic is a key too, so it replays without the question. A lore key names whose ways
 * and what about them:
 *
 *   <holder>[+<holder>]/<lore topic>[/<of>[+<of>]]   e.g.  group:Bergfolk/values
 *                                                          culture:caravan-folk+group:Goblins/mourning
 *                                                          group:Markfolk/view/group:Fae
 *                                                          culture:ridgefolk/view/group:Riksfolk+group:Strandfolk
 *
 * where a holder (and `of`) is a People's topic key (`group:<People>`, as topics.ts has it) or a
 * culture's (`culture:<id>`, culture-lore.ts `topicKeyOf`). `culture:` isn't a topics.ts kind on
 * purpose: those kinds are what you can focus on and what lore lines mark as heard, and adding one
 * would change both in every run. The `/` keeps lore keys apart from every focus key.
 *
 * Pure and deterministic: no randomness, nothing read but the arguments and the game's data.
 */

import { answerFor, type Answer } from './asks';
import { ALL_FACTS, answerOf, factsFor, hasScopeFacts, keptLine, passedOn, resolve } from './facts';
import type { Fact, Keeping, Lie, ScopeKind, Standing } from './knowledge';
import {
  CUSTOM_KINDS, candourOf, cultureLore, effectiveCandour, matchLore, peopleLore, scopedClaims, topicKeyOf, voicedAt, voicingGates,
  type LoreScope, type LoreTopic, type Place, type ScopedClaim, type Voicing,
} from './culture-lore';
import { NAMED, bestKnownMatch, deflectionOf, matchQuestion, patternsOf, questionFor, HINTS } from './free-questions';
import { featureOn, type FeatureSwitches } from './features';
import { focusInline, parseFocus } from './focus';
import { TOPICS, TOPIC_KINDS } from './topics';
import { SKILL_IDS } from './skills';
import { asPlayed, personById, type Person } from './villages';
import { isPastKey, pastAbout, pastPatterns } from './past-topics';
import conceptsRegistry from './content/concepts.json';

// ── Lore keys ───────────────────────────────────────────────────────────────

const LORE_TOPICS: readonly LoreTopic[] = ['values', 'taboos', ...CUSTOM_KINDS, 'view'];

/** A People's or culture's topic key read back, if the lore has it: `group:Bergfolk`, `culture:ridgefolk`. */
function scopeOfKey(key: string): LoreScope | null {
  if (key.startsWith('group:') && peopleLore(key.slice(6))) return { kind: 'people', id: key.slice(6) };
  if (key.startsWith('culture:') && cultureLore(key.slice(8))) return { kind: 'culture', id: key.slice(8) };
  return null;
}

/**
 * A lore key read back. A view is of one group (`of`), or of several when the question named an
 * umbrella ("humans", #1631): `ofs` has them all, and `of` is the first.
 */
export interface LoreKey { holders: LoreScope[]; topic: LoreTopic; of?: LoreScope; ofs?: LoreScope[] }

/** A lore key read back, or null if it isn't one (every focus key, and anything malformed). */
export function parseLoreKey(key: string): LoreKey | null {
  const parts = key.split('/');
  if (parts.length < 2 || parts.length > 3) return null;
  const holders = parts[0].split('+').map(scopeOfKey);
  const topic = parts[1] as LoreTopic;
  if (!holders.length || holders.some(h => h === null) || !LORE_TOPICS.includes(topic)) return null;
  // Only a view is of someone, and a view is always of someone (one group, or several: `of+of`).
  const ofs = parts[2] !== undefined ? parts[2].split('+').map(scopeOfKey) : undefined;
  if ((topic === 'view') !== (ofs !== undefined) || ofs?.some(o => o === null)) return null;
  return { holders: holders as LoreScope[], topic, ...(ofs ? { of: ofs[0]!, ofs: ofs as LoreScope[] } : {}) };
}

const sameScope = (a: LoreScope, b: LoreScope | undefined): boolean => !!b && a.kind === b.kind && a.id === b.id;

/** Each scope once, in the order first met. */
const distinct = (scopes: readonly LoreScope[]): LoreScope[] => scopes.filter((s, i, all) => all.findIndex(t => sameScope(s, t)) === i);

/**
 * The key for what `matchLore` found: whose claims (in the order it gave them), about what. Every
 * claim it returns for one question shares a topic, and a view's claims are about the group the
 * question named, or the groups an umbrella stands for ("humans"), so this is enough to find the
 * same claims again (`loreClaims`).
 */
export function loreKeyOf(claims: readonly ScopedClaim[]): string | null {
  if (!claims.length) return null;
  const holders = distinct(claims.map(c => c.scope));
  const { topic } = claims[0];
  const ofs = topic === 'view' ? distinct(claims.map(c => c.of).filter((o): o is LoreScope => !!o)) : [];
  return `${holders.map(topicKeyOf).join('+')}/${topic}${ofs.length ? `/${ofs.map(topicKeyOf).join('+')}` : ''}`;
}

/** Whether `p` belongs to a People or culture: the only lore anyone answers from is their own. */
const belongsTo = (p: Person, s: LoreScope): boolean => (s.kind === 'people' ? p.people === s.id : p.culture === s.id);

/**
 * The claims `p` would draw on for a lore key, whatever your trust, or null if it isn't theirs to
 * tell (a People or culture they're not in) or nothing's written. `matchLore` only ever answers
 * from the asker's own People and culture, so a key naming anyone else came from somewhere else.
 */
export function loreClaims(p: Person, key: string): ScopedClaim[] | null {
  const k = parseLoreKey(key);
  if (!k || !k.holders.every(h => belongsTo(p, h))) return null;
  const ofs = k.ofs ?? [];
  const claims = k.holders.flatMap(h => scopedClaims(h).filter(c => c.topic === k.topic && (k.topic !== 'view' || ofs.some(o => sameScope(o, c.of)))));
  return claims.length ? claims : null;
}

/**
 * The lore key `p` answers `q` (a question as `questionFor` leaves it) with, or null. A question
 * putting a view to them about nothing the lore knows ("What do you think of the caravan?")
 * isn't asking about their ways, though `matchLore` would read it as their values: no match.
 */
function loreKeyFor(p: Person, q: string): string | null {
  const m = matchLore(q, p);
  if (!m || (m.query.topic === 'view' && !m.query.subject && !m.query.of)) return null;
  return loreKeyOf(m.claims);
}

// ── Topics a question names, for referrals ──────────────────────────────────

/**
 * Every topic a question can name, with every way it can be named: topics.ts's, the hints, skills
 * and concepts. `base` leaves out the scope facts' hints (#1610), for a run without them.
 */
const NAMEABLE: readonly { key: string; res: RegExp[]; base: RegExp[] }[] = [
  ...TOPIC_KINDS.flatMap(kind => Object.keys(TOPICS[kind]).map(id => `${kind}:${id}`)),
  ...Object.keys(HINTS),
  ...SKILL_IDS.map(id => `skill:${id}`),
  ...conceptsRegistry.concepts.map(c => `concept:${c.id}`),
].filter((k, i, all) => all.indexOf(k) === i).map(key => ({ key, res: patternsOf(key), base: patternsOf(key, false) })).filter(n => n.res.length > 0);

/** Where in `q` a topic is first named, or -1. */
function firstAt(res: readonly RegExp[], q: string): number {
  const at = res.map(re => q.search(re)).filter(i => i >= 0);
  return at.length ? Math.min(...at) : -1;
}

/**
 * A topic `q` names that `personId` doesn't know, but someone near them does: the first named in
 * the question that has someone to send you to. Null if none.
 */
function referralTopic(personId: string, q: string, facts?: readonly Fact[]): string | null {
  const scoped = facts !== undefined && hasScopeFacts(facts);
  // A place's history (#1656): its topics are a seed's own (its houses and places), so they're
  // read off the facts, after the fixed ones. A run without `history-in-play` has none.
  const past = [...new Set((facts ?? []).flatMap(f => f.about.filter(isPastKey)))].map(key => ({ key, res: pastPatterns(key) }));
  const named = [...NAMEABLE.map(n => ({ key: n.key, res: scoped ? n.res : n.base })), ...past].map(n => ({ key: n.key, at: firstAt(n.res, q) }))
    .filter(n => n.at >= 0 && n.key !== `person:${personId}`)
    // Earliest in the question first; the same place, the order above (stable sort).
    .sort((a, b) => a.at - b.at);
  for (const { key } of named) {
    const r = resolve(personId, key, 0, facts ? { facts } : {});
    if (r?.kind === 'unknown' && r.referral) return key;
  }
  return null;
}

// ── Matching ────────────────────────────────────────────────────────────────

/**
 * The topic a free question to `personId` plays as, by the run's switches (`features`, the run's
 * saved rule features): with `knowledge-questions` on, the knowledge model's matching (this file's
 * header); off, #1575's (`matchQuestion`), so a run from before it matches as it always did.
 * The facts matched against are the run's too (facts.ts `factsFor`): with `scope-facts` (#1610)
 * on, what their village, the road and their trade know as well. `opts.facts` overrides them; tests
 * pass their own.
 */
export function matchFreeQuestion(personId: string, question: string, answered: readonly string[], features: FeatureSwitches | undefined, opts: { facts?: readonly Fact[] } = {}): string | null {
  const facts = opts.facts ?? factsFor(features);
  if (!featureOn(features, 'knowledge-questions')) return matchQuestion(personId, question, answered, facts);
  const q = questionFor(personId, question);
  if (!q) return null;
  // Most specific first, as the model answers: what they know, named outright, beats their
  // People's ways; their ways beat a topic they'd only mention; knowing nothing, a referral.
  const known = bestKnownMatch(personId, q, answered, facts);
  if (known && known.score >= NAMED) return known.key;
  // Their People as the run plays them (#1631): with humans on the road, Maren's is the Riksfolk.
  const found = personById(personId);
  const p = found ? asPlayed(found, features) : undefined;
  const lore = p ? loreKeyFor(p, q) : null;
  if (lore) return lore;
  if (known) return known.key;
  return featureOn(features, 'referrals') ? referralTopic(personId, q, facts) : null;
}

/**
 * Whether `topic` is one a free question to `personId` could have matched with the switch on: a
 * topic they know, a lore key that's theirs, or one someone nearby could be named for. The API
 * keeps a web question's self-reported topic only if it is (or `knowsAbout`, for the old matching).
 * Every fact counts (`ALL_FACTS`), the scope facts (#1610) too, as for `knowsAbout`: the API
 * doesn't know which switches the asking game had.
 */
export function isQuestionTopic(personId: string, topic: string, facts: readonly Fact[] = ALL_FACTS): boolean {
  if (answerFor(personId, topic, facts)) return true;
  // Either way they can be played (#1631): as written, or with humans on the road.
  const p = personById(personId);
  // A place's history (#1656): its facts are a seed's, which the API doesn't have for a web
  // question, so any history topic a question could name counts, asked of a village's people.
  if (p && isPastKey(topic) && pastPatterns(topic).length) return true;
  if (p && (loreClaims(p, topic) || loreClaims(asPlayed(p, { 'humans-on-the-road': true }), topic))) return true;
  const r = resolve(personId, topic, 0, { facts });
  return r?.kind === 'unknown' && r.referral !== null;
}

// ── Answering ───────────────────────────────────────────────────────────────

export type QuestionAnswer =
  /** Told: the words, as an Answer (its gate, insight and lead), the scope they came from, and whether you'd heard them before. */
  | { kind: 'told'; line: string; answer: Answer; scope: ScopeKind; again: boolean; hearsay?: boolean }
  /** They know, and you haven't earned it yet. */
  | { kind: 'not-yet'; line: string }
  /** They said something else instead (#1580): a lie, read like an answer; `again` if they'd told you it before. */
  | { kind: 'lied'; line: string; lie: Lie; again: boolean }
  /** They don't know; `who` (a person id) would. Only with referrals on. */
  | { kind: 'referral'; line: string; who: string }
  /** Nothing they can place: the deflection, word for word as before. */
  | { kind: 'deflect'; line: string };

/** How a lore topic reads mid-sentence, of the person's own people. */
const LORE_ABOUT: Readonly<Record<LoreTopic, string>> = {
  values: 'what their people hold dear', taboos: 'what their people won\'t do', greeting: 'how their people greet',
  trade: 'how their people trade', mourning: 'how their people mourn', debt: 'how their people settle a debt', view: 'what their people think of',
};
const groupName = (s: LoreScope): string => `the ${s.kind === 'people' ? s.id : cultureLore(s.id)?.name ?? s.id}`;

/** How a free question's topic reads mid-sentence: "iron", "the Compact", "how their people mourn". */
export function questionAbout(topic: string): string {
  const lore = parseLoreKey(topic);
  if (lore) return lore.ofs ? `${LORE_ABOUT.view} ${lore.ofs.map(groupName).join(' and ')}` : LORE_ABOUT[lore.topic];
  const f = parseFocus(topic);
  return f ? focusInline(f) : pastAbout(topic) ?? topic;
}

/**
 * A claim as said. Hedged (culture-lore.ts `voicedAt`): they'll say it, but carefully. Said only
 * because you're a close friend: they say so. Plain: as written.
 */
function sayClaim(c: ScopedClaim, v: Exclude<Voicing, 'held-back'>): string {
  if (v === 'hedged') return `Between us: ${c.text}`;
  if (v === 'close') return `Since it's you: ${c.text}`;
  return c.text;
}

/** At most this many claims in one answer: a question gets an answer, not a lecture. */
const LORE_CLAIMS_SAID = 2;

const NOT_YET = (name: string): string => `${name} looks at you a long moment. "Maybe. Ask me again when I know you better."`;

/**
 * What `p` answers a free question that matched `topic`, given your trust (the true number, with
 * what noticing and leads add, as for an ask) and what they've told you before (`answered`).
 * The gate is decided here, in code, never by whatever voices the answer. `opts.place` is where
 * they are (#1619): it nudges how openly they voice their people's views.
 */
export function answerQuestion(p: Person, topic: string, trust: number, answered: readonly string[], opts: { referrals?: boolean; facts?: readonly Fact[]; place?: Place; standing?: Standing; lies?: Readonly<Record<string, readonly Lie[]>>; keeping?: Keeping } = {}): QuestionAnswer {
  const deflect: QuestionAnswer = { kind: 'deflect', line: deflectionOf(p.id, p.name) };
  if (!topic) return deflect;
  const asked = `You ask ${p.name} about ${questionAbout(topic)}.`;
  const again = answered.includes(topic);

  if (topic.includes('/')) {
    const claims = loreClaims(p, topic);
    if (!claims) return deflect;
    // Their culture's candour, nudged by where they are (#1619): `place` comes only with the
    // `candour-by-place` switch on (road.ts `questionPlace`), so without it this is the culture's own.
    const candour = effectiveCandour(candourOf(p.culture), opts.place);
    const said = claims.map(c => ({ c, v: voicedAt(c, candour, trust) })).filter((x): x is { c: ScopedClaim; v: Exclude<Voicing, 'held-back'> } => x.v !== 'held-back');
    if (!said.length) return { kind: 'not-yet', line: `${asked} ${NOT_YET(p.name)}` };
    const text = said.slice(0, LORE_CLAIMS_SAID).map(({ c, v }) => sayClaim(c, v)).join(' ');
    // The answer's gate is the highest any claim said needed: a view said only to a friend is a
    // secret told, and the road treats it as one (a moment of truth, #1578).
    const at = Math.max(...said.slice(0, LORE_CLAIMS_SAID).map(({ c }) => voicingGates(c, candour).said));
    return { kind: 'told', line: `${asked} ${p.name}: "${text}"`, answer: { at, text }, scope: said[0].c.scope.kind, again };
  }

  // Standing with an organisation (#1587) counts toward its facts, as for an ask; only passed with its switch on.
  // So do the run's lies (#1580): only passed with their switch on. So does keeping (#1661).
  // News first, then lore (#1661): once they've passed on a rumour that reached them, they answer
  // from what they know; knowing nothing else, they tell you the news again, nothing new.
  const passed = passedOn(answered, topic);
  const resolved = (skipHearsay: boolean) => resolve(p.id, topic, trust, { ...(opts.facts ? { facts: opts.facts } : {}), ...(opts.standing ? { standing: opts.standing } : {}), ...(opts.lies ? { lies: opts.lies } : {}), ...(opts.keeping ? { keeping: opts.keeping } : {}), skipHearsay });
  let r = resolved(passed);
  let heard = again;
  if (passed && (!r || r.kind === 'unknown')) { r = resolved(false); heard = true; }
  if (!r) return deflect;
  if (r.kind === 'lied') return { kind: 'lied', line: `${asked} ${p.name}: "${r.text}"`, lie: r.lie, again: answered.includes(`claimed:${topic}`) };
  if (r.kind === 'told') {
    const answer = answerOf(r.fact);
    return { kind: 'told', line: `${asked} ${p.name}: "${answer.text}"`, answer, scope: r.fact.scope.kind, again: heard, ...(r.fact.hearsay ? { hearsay: true } : {}) };
  }
  // An insider keeping their organisation's business says so (#1661): only with `keeping` passed.
  if (r.kind === 'not-yet') return { kind: 'not-yet', line: `${asked} ${r.keptFor ? keptLine(p.name, r.keptFor) : NOT_YET(p.name)}` };
  const who = opts.referrals && r.referral ? personById(r.referral) : undefined;
  if (!who) return deflect;
  return { kind: 'referral', line: `${asked} ${p.name} thinks, and shakes their head. "I couldn't tell you — ${who.name} would know."`, who: who.id };
}
