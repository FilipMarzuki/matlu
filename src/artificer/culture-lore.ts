/**
 * World lore (#1590): what each of the 18 Mistheim Peoples, and each culture on the caravan road,
 * honours, what shames them, how they greet, trade, mourn and settle a debt, what they believe
 * about the others, how openly they say it, and how they sound. The words live in
 * content/peoples-lore.json and content/cultures-lore.json; this module reads them, turns them into
 * scoped claims, decides what a person would say at a given trust, and matches a question to the
 * right claims. docs/culture-lore.md says where each part came from.
 *
 * It's meant to feed the knowledge model's scope content (#1577 slice C, design in
 * docs/knowledge-model-design.md, prototype in knowledge.ts): a `ScopedClaim` is that model's `Fact`
 * with a `people:<id>` or `culture:<id>` scope, carrying the same `truth` and `sensitivity`, so
 * rumours, confidence and lies (#1580) can use the beliefs here that are half-true or wrong (each
 * says what is `actually` so). The trust gates are knowledge.ts's own (`SENSITIVITY_TRUST`).
 *
 * Free questions read it (#1611, knowledge-questions.ts, behind the `knowledge-questions` switch):
 * a question about a People's or culture's ways is matched with `matchLore` and said as `voicedAt`
 * voices it, with the candour nudged by where they are (#1619, behind `candour-by-place`).
 * Nothing else does: no save or RNG change comes with it.
 * Pure and deterministic: the same question, asked of the same person at the same trust, always
 * matches the same claims.
 */

import peoplesFile from './content/peoples-lore.json';
import culturesFile from './content/cultures-lore.json';
import type { People } from './villages';
import { SENSITIVITY_TRUST, type Sensitivity, type Truth } from './knowledge';

export type { Sensitivity, Truth };

/**
 * How strongly a belief is held: `firm` (they'd argue it), `held` (they believe it), `loose` (they
 * half believe it). Only matters for a view that's wrong or half true: see `voicing`.
 */
export const STRENGTHS = ['firm', 'held', 'loose'] as const;
export type Strength = (typeof STRENGTHS)[number];

/**
 * How openly a culture's people voice an opinion to an outsider: `blunt` (straight out), `plain`
 * (once they know you a little), `guarded` (politeness first). Set per culture, from its temperament.
 */
export const CANDOURS = ['blunt', 'plain', 'guarded'] as const;
export type Candour = (typeof CANDOURS)[number];

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
  /** How strongly it's held. Every wrong or half-true view says; `held` if not. */
  strength?: Strength;
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

/**
 * A People the lore knows: villages.ts's 15, the Wildkin, the 16th (owner, 2026-10-11, #1606), and the
 * two human Peoples, the Riksfolk and the Strandfolk (owner, 2026-10-11, #1623: the Markfolk are the
 * orcs, humans are their own Peoples). Nobody on the road is one of these three yet, so villages.ts's
 * `People` stays as it is.
 */
export type LorePeople = People | 'Wildkin' | 'Riksfolk' | 'Strandfolk';

export interface PeopleLore extends GroupLore { id: LorePeople }

export interface CultureLore extends GroupLore {
  /** How openly its people voice an opinion to an outsider. */
  candour: Candour;
  /** What it believes about each of the 18 Peoples (its `views` are of the other road cultures). */
  peopleViews: Readonly<Record<LorePeople, readonly LoreClaim[]>>;
}

/** The 18 Mistheim Peoples, in docs/peoples-and-races.md's order (the Wildkin 16th, then the human Peoples, #1623). */
export const PEOPLES: readonly LorePeople[] = ['Bergfolk', 'Lövfolk', 'Markfolk', 'Viddfolk', 'Steinfolk', 'Pandor', 'Deepwalkers', 'Merfolk', 'Goblins', 'Fae', 'Giants', 'Dragons', 'Everstill', 'Constructs', 'Remnants', 'Wildkin', 'Riksfolk', 'Strandfolk'];

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
  /** For a wrong or half-true view only: how strongly it's held (`held` if the data doesn't say). */
  strength?: Strength;
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
    ...(topic === 'view' && c.truth !== 'true' ? { strength: c.strength ?? 'held' } : {}),
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
    // A culture's views of the Peoples. Ids can't clash with its views of cultures: culture ids are
    // lower-case ("ridgefolk"), People ids TitleCase ("Goblins").
    ...('peopleViews' in g
      ? Object.entries((g as CultureLore).peopleViews).flatMap(([id, cs]) => cs.map((c, i) => toScoped(scope, 'view', c, i, { kind: 'people', id })))
      : []),
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

// ---- Voicing: what a person says at a given trust ----------------------------------------------
//
// Whether someone says a prejudice or a wrong belief out loud, and how, isn't fixed (owner,
// 2026-10-11). It depends on how openly their culture speaks to outsiders (`candour`), how strongly
// they hold the belief (`strength`), and how far you've earned their trust. The rule:
//
//   openness = candour (blunt 2, plain 1, guarded 0) + strength (firm 2, held 1, loose 0), 0 to 4
//   said, hedged, from trust 75 − 25 × openness; said plainly from 25 more (both kept within 0–75)
//
// on the knowledge model's trust levels (0 / 25 / 50 / 75). A blunt culture's firm belief is said
// plainly to a stranger; a guarded culture's loose one only to a close friend, at 75. A claim's own
// sensitivity is a floor on both. The rule covers views that are wrong or half true; every other
// claim (customs, values, true views) is simply said once trust reaches its sensitivity.

/** How a claim comes out: `close` means it's said, but only because you're a close friend (75). */
export type Voicing = 'plain' | 'hedged' | 'close' | 'held-back';

const CANDOUR_OPENNESS: Readonly<Record<Candour, number>> = { blunt: 2, plain: 1, guarded: 0 };
const STRENGTH_OPENNESS: Readonly<Record<Strength, number>> = { firm: 2, held: 1, loose: 0 };
/** The highest trust level: a close friend. */
const CLOSE = SENSITIVITY_TRUST.secret;
const clampTrust = (n: number): number => Math.min(CLOSE, Math.max(0, n));

/** What the voicing rule needs to know about a claim. */
export type Voiceable = Pick<ScopedClaim, 'topic' | 'truth' | 'sensitivity' | 'strength'>;

/** The trust at which a claim is first said (hedged), and the trust at which it's said plainly. */
export function voicingGates(claim: Voiceable, candour: Candour): { said: number; plain: number } {
  const floor = SENSITIVITY_TRUST[claim.sensitivity];
  if (claim.topic !== 'view' || claim.truth === 'true') return { said: floor, plain: floor };
  const open = CANDOUR_OPENNESS[candour] + STRENGTH_OPENNESS[claim.strength ?? 'held'];
  return {
    said: Math.max(floor, clampTrust(75 - 25 * open)),
    plain: Math.max(floor, clampTrust(100 - 25 * open)),
  };
}

/** Whether, and how, a person of a culture with `candour` says `claim` to you at `trust`. */
export function voicedAt(claim: Voiceable, candour: Candour, trust: number): Voicing {
  const { said, plain } = voicingGates(claim, candour);
  if (trust < said) return 'held-back';
  // Said and plain at the same level: plainly, unless that level is the close friend's.
  if (said === plain) return said >= CLOSE ? 'close' : 'plain';
  return trust >= plain ? 'plain' : 'hedged';
}

/** A culture's candour; `plain` for a culture without lore (one not on the road). */
export const candourOf = (cultureId: string): Candour => cultureLore(cultureId)?.candour ?? 'plain';

// ---- Place: where they are now nudges how openly they speak (#1619) ----------------------------
//
// The culture's candour is how its people speak in ordinary times. Where they are now nudges it
// (owner, 2026-10-11): "hard region weather gets more blunt, simple. Can also depend on local lord
// or similar things." The rule, as a shift on the candour scale (guarded, plain, blunt):
//
//   +1  a hard place (poor, hard-pressed) or harsh weather (winter, a storm, snow): no time for niceties
//   −1  a feared or strict lord: people keep their heads down        +1  a lax or well-liked one
//   −1  an uneasy region (lords dead, seats changed hands): careful with strangers
//
// added up and kept to one step either way, then kept on the scale (a blunt people can't get
// blunter). One step at most, so a guarded culture never sounds blunt: cultures still sound like
// themselves. A hard place under a feared lord cancels out.

/** How a place's lord (or whoever holds it: a gate's wardens, a hold's council) comes across. */
export const LORD_TEMPERS = ['feared', 'strict', 'lax', 'liked'] as const;
export type LordTemper = (typeof LORD_TEMPERS)[number];

/**
 * Where someone is, as far as how they speak goes. Every field is optional: an empty place is
 * ordinary times, and changes nothing. place-candour.ts reads one off a region or a road village.
 */
export interface Place {
  /** Poor, cold or hard-pressed: times hard, bread dear, the harvest failed, the place on hard times. */
  hard?: boolean;
  /** The season: winter is harsh (winter.ts's seasons, or the road's). */
  season?: string;
  /** The weather today: a storm or snow is harsh (world.ts `WeatherId`). */
  weather?: string;
  lord?: LordTemper;
  /** Unsettled lately (#1608): lords dead, seats seized or changed hands. */
  uneasy?: boolean;
}

/** Seasons and weather harsh enough to make people blunt. */
export const HARSH_SEASONS: readonly string[] = ['winter'];
export const HARSH_WEATHER: readonly string[] = ['storm', 'snow'];

const LORD_SHIFT: Readonly<Record<LordTemper, number>> = { feared: -1, strict: -1, lax: 1, liked: 1 };

/** How far a place moves candour: −1 (one step more guarded), 0, or +1 (one step blunter). */
export function placeShift(place?: Place): -1 | 0 | 1 {
  if (!place) return 0;
  const harsh = place.hard === true
    || (place.season !== undefined && HARSH_SEASONS.includes(place.season))
    || (place.weather !== undefined && HARSH_WEATHER.includes(place.weather));
  const sum = (harsh ? 1 : 0) + (place.lord ? LORD_SHIFT[place.lord] : 0) + (place.uneasy ? -1 : 0);
  return Math.max(-1, Math.min(1, sum)) as -1 | 0 | 1;
}

/** A culture's candour where they are now: one step at most from its own (see above). No place, its own. */
export function effectiveCandour(candour: Candour, place?: Place): Candour {
  const open = CANDOUR_OPENNESS[candour] + placeShift(place);
  // CANDOUR_OPENNESS runs guarded 0, plain 1, blunt 2: read it back, kept on the scale.
  return (['guarded', 'plain', 'blunt'] as const)[Math.max(0, Math.min(2, open))];
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

export interface LoreMatch {
  query: LoreQuery;
  /** What they'd say: everything that answers, or, given a trust, only what they'd voice at it. */
  claims: readonly ScopedClaim[];
  /** Given a trust: how each claim comes out, by claim id. */
  voicing?: Readonly<Record<string, Exclude<Voicing, 'held-back'>>>;
  /** Given a trust: they know more that answers, and are keeping it back. */
  holdingBack?: boolean;
  /** When holding back: the lowest trust at which they'd say more. */
  opensAt?: number;
}

const belongs = (k: LoreKnower, s: LoreScope): boolean => (s.kind === 'people' ? k.people === s.id : k.culture === s.id);

/** What `holder` believes about `of`. */
const viewsOf = (holder: LoreScope, of: LoreScope): ScopedClaim[] =>
  scopedClaims(holder).filter(c => c.topic === 'view' && c.of?.kind === of.kind && c.of.id === of.id);

/** The first of `holders` with a view of `of`, and only theirs. */
const firstViews = (holders: readonly LoreScope[], of: LoreScope): ScopedClaim[] =>
  holders.map(h => viewsOf(h, of)).find(cs => cs.length > 0) ?? [];

/**
 * The claims that answer `question`, asked of `knower` (or of nobody in particular), most specific
 * first. A member of the group named answers from its own lore ("What do the Bergfolk believe?" to
 * Orrin: the Bergfolk's values), and doesn't speak for another group's opinions.
 *
 * Asked about themself ("What do you do when someone dies?"), a person answers from their culture,
 * then their People: both, the culture's custom first (in a mixed culture it wins over the
 * People's). Asked what they think of a group, or about a group they're not in, they answer with
 * one view: their culture's when it has one, else their People's ("your people" turns the order
 * round). Cultures hold views of every People and every road culture; Peoples only of Peoples.
 *
 * Given a `trust`, only what they'd say at it is returned (see `voicedAt`, with the knower's
 * culture's candour; with nobody in particular, the claim's own culture's, else `plain`), with how
 * each is said, and whether they're holding something back. Without one, everything that answers.
 * Given a `place` too, the candour is the one they speak with there (`effectiveCandour`, #1619).
 * No group (and no "you" with a topic word), or nothing written: null.
 */
export function matchLore(question: string, knower?: LoreKnower, trust?: number, place?: Place): LoreMatch | null {
  const query = parseLoreQuestion(question);
  // A view with nobody it's about ("What do the Bergfolk think?") is their beliefs: their values.
  const topic: LoreTopic = query.topic === 'view' && !query.of ? 'values' : query.topic ?? (query.of ? 'view' : 'values');
  const own: LoreScope[] = knower
    ? query.you === 'people'
      ? [{ kind: 'people', id: knower.people }, { kind: 'culture', id: knower.culture }]
      : [{ kind: 'culture', id: knower.culture }, { kind: 'people', id: knower.people }]
    : [];

  const claims: ScopedClaim[] = [];
  if (query.subject) {
    const s = query.subject;
    if (!knower || belongs(knower, s)) {
      const all = scopedClaims(s);
      claims.push(...(topic === 'view'
        ? all.filter(c => c.topic === 'view' && c.of?.kind === query.of?.kind && c.of?.id === query.of?.id)
        : all.filter(c => c.topic === topic)));
    } else if (topic !== 'view') {
      // An outsider: what their culture (else their People) thinks of the group named.
      claims.push(...firstViews(own, s));
    }
  } else if (query.you && query.topic) {
    // "You" alone says nothing about lore ("What's your favourite colour?"): it takes a topic word too.
    if (topic === 'view') { if (query.of) claims.push(...firstViews(own, query.of)); }
    else for (const s of own) claims.push(...scopedClaims(s).filter(c => c.topic === topic));
  }
  const unique = claims.filter((c, i) => claims.findIndex(d => d.id === c.id) === i);
  if (!unique.length) return null;
  if (trust === undefined) return { query, claims: unique };

  const voicing: Record<string, Exclude<Voicing, 'held-back'>> = {};
  const said: ScopedClaim[] = [];
  const held: number[] = [];
  for (const c of unique) {
    const own = knower ? candourOf(knower.culture) : c.scope.kind === 'culture' ? candourOf(c.scope.id) : 'plain';
    // Where they are now nudges it (#1619): the caller passes a place only with its switch on.
    const candour = effectiveCandour(own, place);
    const v = voicedAt(c, candour, trust);
    if (v === 'held-back') held.push(voicingGates(c, candour).said);
    else { voicing[c.id] = v; said.push(c); }
  }
  return { query, claims: said, voicing, holdingBack: held.length > 0, ...(held.length ? { opensAt: Math.min(...held) } : {}) };
}
