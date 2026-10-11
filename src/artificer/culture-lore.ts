/**
 * World lore (#1590): what each of the 15 Mistheim Peoples, and each culture on the caravan road,
 * honours, what shames them, how they greet, trade, mourn and settle a debt, what they believe
 * about the others, and how they sound. The words live in content/peoples-lore.json and
 * content/cultures-lore.json; this module reads them, turns them into scoped claims, and matches a
 * question to the right ones. docs/culture-lore.md says where each part came from.
 *
 * It's meant to feed the knowledge model's scope content (#1577 slice C, design in
 * docs/knowledge-model-design.md): a `ScopedClaim` is that design's `Fact` with a `people:<id>` or
 * `culture:<id>` scope, carrying the same `truth` and `sensitivity`, so rumours, confidence and lies
 * (#1580) can use the beliefs here that are half-true or wrong (each says what is `actually` so).
 * The shape is kept close to the spike's `Fact` on purpose, without importing it: the spike isn't
 * merged.
 *
 * Nothing reads this yet: no road, free-question, save or RNG change comes with it.
 * Pure and deterministic: the same question always matches the same claims.
 */

import peoplesFile from './content/peoples-lore.json';
import culturesFile from './content/cultures-lore.json';
import type { People } from './villages';

/** What the world says about a claim (the knowledge model's `Truth`). The player never sees it. */
export type Truth = 'true' | 'rumour' | 'false';

/** How guarded a claim is: the trust it takes to hear it (the knowledge model's `Sensitivity`). */
export type Sensitivity = 'public' | 'guarded' | 'private' | 'secret';

/**
 * One thing a member of a People or culture would say. `source` names the canon it rests on as
 * `file § heading › label` (heading and label optional), so a reviewer can find it in seconds.
 * `invented` marks what canon doesn't say outright: written to fit the source, not quoted from it.
 */
export interface LoreClaim {
  text: string;
  truth: Truth;
  source: string;
  invented?: boolean;
  sensitivity?: Sensitivity;
  /** How deep in the scope it lies (1 everyone knows it, 3 only the best-placed). 1 if not said. */
  depth?: 1 | 2 | 3;
  /** For a rumour or a false belief: what is really so, and where canon says it. */
  actually?: { text: string; source: string };
}

/** A line of voice: a saying, or how a People or culture talks. Not a claim about the world. */
export interface Saying {
  text: string;
  source: string;
  invented?: boolean;
}

/** The customs every People and culture has an entry for. */
export const CUSTOM_KINDS = ['greeting', 'trade', 'mourning', 'debt'] as const;
// `(typeof X)[number]` turns a readonly tuple of strings into the union of its members:
// 'greeting' | 'trade' | 'mourning' | 'debt'. One list, so the type can't drift from it.
export type CustomKind = (typeof CUSTOM_KINDS)[number];

/** Everything written for one People or one culture. */
export interface GroupLore {
  id: string;
  /** How it's named in canon: the People's id, or the culture's name in macro-world/cultures.json. */
  name: string;
  /** Every way a question might name it ("dwarves", "the Dyprike"), for the matcher. */
  names: readonly string[];
  voice: Saying;
  values: readonly LoreClaim[];
  taboos: readonly LoreClaim[];
  customs: Readonly<Record<CustomKind, LoreClaim>>;
  /** What they believe about each of the others, by id: every other People, or every other road culture. */
  views: Readonly<Record<string, readonly LoreClaim[]>>;
  sayings: readonly Saying[];
}

export interface PeopleLore extends GroupLore { id: People }
export type CultureLore = GroupLore;

/** The 15 Mistheim Peoples, in docs/peoples-and-races.md's order. Typed against villages.ts's `People`. */
export const PEOPLES: readonly People[] = ['Bergfolk', 'Lövfolk', 'Markfolk', 'Viddfolk', 'Steinfolk', 'Pandor', 'Deepwalkers', 'Merfolk', 'Goblins', 'Fae', 'Giants', 'Dragons', 'Everstill', 'Constructs', 'Remnants'];

// TypeScript types an imported JSON file from its contents, with every string widened to `string`
// (so `truth` reads as `string`, not `Truth`). `as unknown as` tells the compiler to trust our
// interface instead; culture-lore.test.ts checks the data really has that shape.
const PEOPLE_LORE: readonly PeopleLore[] = peoplesFile.peoples as unknown as readonly PeopleLore[];
const CULTURE_LORE: readonly CultureLore[] = culturesFile.cultures as unknown as readonly CultureLore[];

export const allPeopleLore = (): readonly PeopleLore[] => PEOPLE_LORE;
export const allCultureLore = (): readonly CultureLore[] => CULTURE_LORE;
/** What's written for a People, by its TitleCase id ("Bergfolk"). */
export const peopleLore = (id: string): PeopleLore | undefined => PEOPLE_LORE.find(p => p.id === id);
/** What's written for a culture, by its cultures.json id ("ridgefolk"). */
export const cultureLore = (id: string): CultureLore | undefined => CULTURE_LORE.find(c => c.id === id);

// ---- Scoped claims: the knowledge model's facts ------------------------------------------------

export type LoreScopeKind = 'people' | 'culture';
/** Who can know a claim: the members of a People, or of a culture (the knowledge model's `Scope`). */
export interface LoreScope { kind: LoreScopeKind; id: string }

/** What a claim is about, within its scope. */
export type LoreTopic = 'values' | 'taboos' | CustomKind | 'view';

/** A claim ready for the knowledge model: the spike's `Fact`, plus where it came from. */
export interface ScopedClaim {
  /** Stable and readable: `people:Bergfolk/view:Goblins/0`. */
  id: string;
  scope: LoreScope;
  topic: LoreTopic;
  /** For a view: who it's about. */
  of?: LoreScope;
  /** Topic keys it answers: the group's (`group:Bergfolk`, `culture:ridgefolk`) and `lore:<topic>`. */
  about: readonly string[];
  text: string;
  truth: Truth;
  sensitivity: Sensitivity;
  depth: 1 | 2 | 3;
  source: string;
  invented: boolean;
  actually?: { text: string; source: string };
}

const loreOf = (s: LoreScope): GroupLore | undefined => (s.kind === 'people' ? peopleLore(s.id) : cultureLore(s.id));

/**
 * A group's topic key. People use the key topics.ts already gives them (`group:Bergfolk`); cultures
 * have no topic kind yet, so `culture:<id>` is new, for when the knowledge model adds one.
 */
export const topicKeyOf = (s: LoreScope): string => (s.kind === 'people' ? `group:${s.id}` : `culture:${s.id}`);

function toScoped(scope: LoreScope, topic: LoreTopic, c: LoreClaim, i: number, of?: LoreScope): ScopedClaim {
  const at = `${scope.kind}:${scope.id}/${topic}${of ? `:${of.id}` : ''}/${i}`;
  return {
    id: at,
    scope,
    topic,
    ...(of ? { of } : {}),
    // A view answers questions about who it's about ("goblins"); everything else, about its own group.
    about: [topicKeyOf(of ?? scope), `lore:${topic}`],
    text: c.text,
    truth: c.truth,
    sensitivity: c.sensitivity ?? 'public',
    depth: c.depth ?? 1,
    source: c.source,
    invented: c.invented === true,
    ...(c.actually ? { actually: c.actually } : {}),
  };
}

/** Every claim written for one People or culture, as scoped claims (sayings and voice aren't claims). */
export function scopedClaims(scope: LoreScope): ScopedClaim[] {
  const g = loreOf(scope);
  if (!g) return [];
  return [
    ...g.values.map((c, i) => toScoped(scope, 'values', c, i)),
    ...g.taboos.map((c, i) => toScoped(scope, 'taboos', c, i)),
    ...CUSTOM_KINDS.map(k => toScoped(scope, k, g.customs[k], 0)),
    ...Object.entries(g.views).flatMap(([id, cs]) => cs.map((c, i) => toScoped(scope, 'view', c, i, { kind: scope.kind, id }))),
  ];
}

/** Every claim for every People and culture. */
export const allScopedClaims = (): ScopedClaim[] => [
  ...PEOPLE_LORE.map(p => scopedClaims({ kind: 'people', id: p.id })),
  ...CULTURE_LORE.map(c => scopedClaims({ kind: 'culture', id: c.id })),
].flat();

/** How a People or culture sounds: a line on their voice, and their sayings. */
export function voiceOf(scope: LoreScope): { voice: Saying; sayings: readonly Saying[] } | undefined {
  const g = loreOf(scope);
  return g ? { voice: g.voice, sayings: g.sayings } : undefined;
}

// ---- Matching a question -----------------------------------------------------------------------
// In the style of free-questions.ts: no AI, just names and a few words that point at a topic.

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Words that point at a lore topic, tried in this order: the first that matches wins. Customs come
 * first because they're the most specific ("What do the Bergfolk believe about the dead?" is about
 * mourning); views before values, since "believe about" is a view and "believe" alone a value.
 */
export const TOPIC_HINTS: readonly (readonly [LoreTopic, RegExp])[] = [
  ['mourning', /\b(?:die|dies|died|dying|death|deaths|dead|mourn(?:s|ing)?|funerals?|graves?|bur(?:y|ies|ied|ial))\b/i],
  ['greeting', /\b(?:greet(?:s|ing|ings)?|hello|say hi|welcome|introduce)\b/i],
  ['debt', /\b(?:debts?|owe[sd]?|owing|repay|pay(?:s|ing)? (?:it )?back|loans?|lend|borrow)\b/i],
  ['trade', /\b(?:trade[sd]?|trading|buy(?:s|ing)?|sell(?:s|ing)?|bargain(?:s|ing)?|haggl(?:e|es|ing)|prices?|market)\b/i],
  ['taboos', /\b(?:taboos?|shames?|shameful|ashamed|forbidden|not allowed|never do|must not|mustn't|rude|insult(?:s|ing)?|offend(?:s|ed)?)\b/i],
  ['view', /\b(?:think (?:of|about)|thoughts on|feel about|opinion of|make of|get (?:on|along) with|say about|believe about|trust|hate)\b/i],
  ['values', /\b(?:believe[sd]?|beliefs?|values?|valued|honou?r(?:s|ed)?|care about|cares about|proud|pride|important|respect)\b/i],
];

/** "you" in a question; "your people" (or folk, kind) leans to the person's People over their culture. */
const YOU = /\b(?:you|your|yours|yourself|yourselves)\b/i;
const YOUR_PEOPLE = /\byour (?:people|folk|kind|kin)\b/i;

/** Every way each People and culture can be named, longest first so "Viddfolk Camps" beats "Viddfolk". */
const NAMERS: readonly { scope: LoreScope; re: RegExp }[] = [
  ...PEOPLE_LORE.map(g => ({ scope: { kind: 'people' as const, id: g.id }, names: g.names })),
  ...CULTURE_LORE.map(g => ({ scope: { kind: 'culture' as const, id: g.id }, names: g.names })),
].map(({ scope, names }) => ({
  scope,
  re: new RegExp(`\\b(?:${[...names].sort((a, b) => b.length - a.length).map(escape).join('|')})\\b`, 'gi'),
}));

/** The groups a question names, in the order it names them, each once. Overlaps go to the longer name. */
function groupsIn(q: string): { scope: LoreScope; at: number }[] {
  const hits = NAMERS.flatMap(n => [...q.matchAll(n.re)].map(m => ({ scope: n.scope, at: m.index ?? 0, len: m[0].length })));
  hits.sort((a, b) => a.at - b.at || b.len - a.len);
  const kept: typeof hits = [];
  for (const h of hits) {
    const last = kept[kept.length - 1];
    if (last && h.at < last.at + last.len) continue; // inside a longer name already kept
    if (!kept.some(k => k.scope.kind === h.scope.kind && k.scope.id === h.scope.id)) kept.push(h);
  }
  return kept.map(({ scope, at }) => ({ scope, at }));
}

/** What a question asks, read off its words. */
export interface LoreQuery {
  /** The group asked about, as named ("the Bergfolk"); null if none is ("What do you do…?"). */
  subject: LoreScope | null;
  /** The group a view is about ("…think of goblins?"). */
  of: LoreScope | null;
  topic: LoreTopic | null;
  /** Put to the person themself: 'people' for "your people", 'culture' for a plain "you". */
  you: LoreScopeKind | null;
}

/** Reads a question: which groups it names, what about them, and whether it asks the person themself. */
export function parseLoreQuestion(question: string): LoreQuery {
  const q = question.slice(0, 400);
  const hint = TOPIC_HINTS.map(([topic, re]) => ({ topic, m: re.exec(q) })).find(h => h.m);
  const topic = hint?.topic ?? null;
  const you: LoreScopeKind | null = YOUR_PEOPLE.test(q) ? 'people' : YOU.test(q) ? 'culture' : null;
  const groups = groupsIn(q);
  if (groups.length >= 2) {
    // "What do the Bergfolk think of goblins?": the first named holds the view, the second is its object.
    return { subject: groups[0].scope, of: groups[1].scope, topic: topic === null || topic === 'values' ? 'view' : topic, you };
  }
  const only = groups[0];
  // "What do you think of goblins?": one group, named after the view words, put to the person: it's the object.
  if (only && topic === 'view' && you && hint?.m && only.at > hint.m.index) return { subject: null, of: only.scope, topic, you };
  return { subject: only?.scope ?? null, of: null, topic, you };
}

/** Who's being asked, as the lore sees them: their People and their culture (a villages.ts `Person` will do). */
export interface LoreKnower { people: string; culture: string }

export interface LoreMatch { query: LoreQuery; claims: readonly ScopedClaim[] }

const belongs = (k: LoreKnower, s: LoreScope): boolean => (s.kind === 'people' ? k.people === s.id : k.culture === s.id);

/**
 * The claims that answer `question`, asked of `knower` (or of nobody in particular), most specific
 * first. A member of the group named answers from its own lore ("What do the Bergfolk believe?" to
 * Orrin: the Bergfolk's values); anyone else answers with what their own People or culture thinks
 * of that group (the same question to Maren: the Markfolk's view of the Bergfolk), and doesn't speak
 * for another group's opinions. Asked about themself ("What do you do when someone dies?"), a person
 * answers from their culture, then their People. No group (and no "you" with a topic word), or
 * nothing written: null.
 */
export function matchLore(question: string, knower?: LoreKnower): LoreMatch | null {
  const query = parseLoreQuestion(question);
  // A view with nobody it's about ("What do the Bergfolk think?") is their beliefs: their values.
  const topic: LoreTopic = query.topic === 'view' && !query.of ? 'values' : query.topic ?? (query.of ? 'view' : 'values');
  const own: LoreScope[] = knower
    ? query.you === 'people'
      ? [{ kind: 'people', id: knower.people }, { kind: 'culture', id: knower.culture }]
      : [{ kind: 'culture', id: knower.culture }, { kind: 'people', id: knower.people }]
    : [];
  // "You" alone says nothing about lore ("What's your favourite colour?"): it takes a topic word too.
  const subjects = query.subject ? [query.subject] : query.you && query.topic ? own : [];

  const claims: ScopedClaim[] = [];
  for (const s of subjects) {
    if (!knower || belongs(knower, s)) {
      const all = scopedClaims(s);
      claims.push(...(topic === 'view'
        ? all.filter(c => c.topic === 'view' && c.of?.kind === query.of?.kind && c.of?.id === query.of?.id)
        : all.filter(c => c.topic === topic)));
    } else if (topic !== 'view') {
      // An outsider: what their own People (or culture) thinks of the group named.
      const mine: LoreScope = { kind: s.kind, id: s.kind === 'people' ? knower.people : knower.culture };
      claims.push(...scopedClaims(mine).filter(c => c.topic === 'view' && c.of?.id === s.id));
    }
  }
  const unique = claims.filter((c, i) => claims.findIndex(d => d.id === c.id) === i);
  return unique.length ? { query, claims: unique } : null;
}
