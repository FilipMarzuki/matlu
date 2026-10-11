/**
 * What people on the road know: the knowledge model in the game (slice A, #1609; design in
 * docs/knowledge-model-design.md, model in knowledge.ts).
 *
 * Three things live here:
 * - **FACTS**, what anyone could say before slice C: the hand-written answers (answers.ts), each
 *   one a person-scope fact in that person's own words, and each teacher's answer about their own
 *   skill. **SCOPE_FACTS** (slice C, #1610, content/scope-facts.json) are written once for a wider
 *   scope (a village, the road, a role, a taught skill), and everyone in the scope knows them.
 *   They're a rules feature (`scope-facts`): `factsFor` gives a run the facts its switches allow,
 *   and the asks pass them in. A caller that passes nothing gets FACTS, today's answers.
 * - **Knowers**: each person, as the model sees them (their village, region, People, culture,
 *   role, the skill they teach, the organisations they belong to and their rank in each), built
 *   from villages.ts.
 * - **resolve**: the model's `answer` with the game's facts, people and organisations filled in.
 *   asks.ts (`ask`, `answerFor`, `topicsKnownBy`) reads everything through it.
 *
 * Nothing a player reads changed when this came in: each answer keeps its words, and its trust
 * gate (0 / 25 / 50) is its fact's sensitivity (public / guarded / private), which the model turns
 * back into the same number. Gates read the true trust you bring, never rapport's felt word (#1578).
 *
 * Pure and deterministic: data built once from other data, no randomness.
 */

import { ANSWERS, type Answer } from './answers';
import { answer, gateOf, SENSITIVITY_TRUST, type Fact, type Knower, type KnowledgeAnswer, type Lie, type Org, type ScopeKind, type Sensitivity, type Standing, type Truth } from './knowledge';
import { ORG_FACTS, ROAD_ORGS, ranksOf } from './orgs';
import { TIE_FACTS } from './ties';
import { DEFAULT_RUMOUR_FACTS, rumourFactsFor, rumourSetKey } from './claims';
import { featureOn, ruleFeatures, type FeatureSwitches } from './features';
import { SKILLS, type SkillId } from './skills';
import { VILLAGES, TRAVELLERS, type Person } from './villages';
import scopeFactsFile from './content/scope-facts.json';

/**
 * The region the three villages share: the north road out of Greywind Reach. The owner's call on
 * the design: villages a few days apart can share a region. Villages have no region field yet, so
 * everyone on the road is in this one until they do.
 */
export const ROAD_REGION = 'north-road';

/**
 * Organisations, by id (#1587, knowledge slice B): the road's registry (orgs.ts). The model treats
 * one missing from it as open. Membership is on people (`Person.orgs`), and always read: it changes
 * no answer by itself, only with the organisations' facts, which come with the `organisations` switch.
 */
export const ORGS: Readonly<Record<string, Org>> = ROAD_ORGS;

/**
 * The sensitivity an answer's trust gate stands for. The model's tiers sit on the same scale the
 * road gates on (knowledge.ts `SENSITIVITY_TRUST`), so this is that table read backwards.
 */
function sensitivityAt(at: number): Sensitivity {
  const s = (Object.keys(SENSITIVITY_TRUST) as Sensitivity[]).find(k => SENSITIVITY_TRUST[k] === at);
  // An answer gated anywhere else (say 30) has no tier; failing loudly here keeps a content
  // mistake from quietly changing a gate. The tests load this module, so CI catches it first.
  if (!s) throw new Error(`An answer's trust gate must be 0, 25, 50 or 75, not ${at}`);
  return s;
}

/** A hand-written answer as a person-scope fact: their words, their gate, their insight and lead. */
function answerFact(personId: string, key: string, a: Answer): Fact {
  return {
    id: `answer:${personId}:${key}`,
    about: [key],
    text: a.text,
    scope: { kind: 'person', id: personId },
    sensitivity: sensitivityAt(a.at),
    // The canon rule (the owner's answer 6) holds for true facts, and every hand-written answer is one.
    truth: 'true',
    ...(a.lead ? { lead: a.lead.who } : {}),
    ...(a.lead?.about ? { leadAbout: a.lead.about } : {}),
    ...(a.insight ? { insight: a.insight } : {}),
  };
}

/** A teacher always knows their own skill: they'll tell anyone, and point them to a lesson. */
function teacherFact(p: Person): Fact | null {
  if (!p.teaches) return null;
  const name = SKILLS[p.teaches.skill as SkillId]?.name ?? p.teaches.skill;
  const n = p.teaches.techniques.length;
  const shows = n ? ` I can show you ${n === 1 ? 'one way' : `${n} ways`} to do it better.` : '';
  return {
    id: `teaches:${p.id}`,
    about: [`skill:${p.teaches.skill}`],
    text: `${name}? That's what I teach.${shows} Come and learn when you have the time.`,
    scope: { kind: 'person', id: p.id },
    sensitivity: 'public',
    truth: 'true',
  };
}

/** Everyone on the road: the villages' people, then the caravan's own. */
const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];

/**
 * Every fact in the game. Order matters: when a person knows two facts at the same scope about
 * the same topic, the one written first answers (the model's sort is stable). So the hand-written
 * answers come before the teachers' rule, and a teacher with their own words on their skill (Isa
 * on foraging) says those, as before.
 */
export const FACTS: readonly Fact[] = [
  ...Object.entries(ANSWERS).flatMap(([pid, byKey]) => Object.entries(byKey).map(([key, a]) => answerFact(pid, key, a))),
  ...EVERYONE.map(teacherFact).filter((f): f is Fact => f !== null),
];

/**
 * A scope fact as written in content/scope-facts.json (#1610, knowledge slice C): the model's
 * `Fact`, plus where it came from. `source` names the canon it rests on (`file § heading › label`,
 * or `file › label` for code). `canonised` dates a fact written for the game to fit canon (not quoted
 * from it) that the owner then made canon after a review (2026-10-11, #1610); canon from here on.
 * Only true facts so far: the canon rule (the owner's answer 6) holds for every one.
 */
export interface ScopeFactEntry extends Omit<Fact, 'id' | 'sensitivity'> {
  id: string;
  sensitivity?: Sensitivity;
  source: string;
  canonised?: string;
}

// TypeScript types an imported JSON file from its contents with every string widened to `string`
// (so `scope.kind` reads as `string`, not `ScopeKind`). `as unknown as` tells the compiler to trust
// the interface instead; facts-scope.test.ts checks the data really has that shape.
const SCOPE_ENTRIES: readonly ScopeFactEntry[] = scopeFactsFile.facts as unknown as readonly ScopeFactEntry[];

/** Every scope fact as written, with its source: what a reviewer checks against canon. */
export const scopeFactEntries = (): readonly ScopeFactEntry[] => SCOPE_ENTRIES;

/**
 * What everyone in a village, on the road, in a trade or a taught skill knows (#1610): the scope
 * facts as the model reads them. Public unless the file says, as the owner put it (by publicity
 * and stake): trade, places and the road are public; a neighbour's past is guarded.
 *
 * The road's generated regional facts (world/regional-facts.ts, world/remembered.ts) join here in
 * slice F, once the history runs in the sim: they're already `Fact`-shaped, scoped to the same
 * `region:north-road` (world/regions.ts CRAFTED_REGIONS) and the villages, so they append to this
 * list (or to `factsFor`'s) and every reader picks them up.
 */
export const SCOPE_FACTS: readonly Fact[] = SCOPE_ENTRIES.map(e => ({
  id: `scope:${e.id}`,
  about: e.about,
  text: e.text,
  scope: e.scope,
  sensitivity: e.sensitivity ?? 'public',
  truth: e.truth,
  ...(e.depth ? { depth: e.depth } : {}),
  ...(e.lead ? { lead: e.lead } : {}),
}));

/** Whether a set of facts has the scope facts in it (`factsFor` with the switch on, or ALL_FACTS). */
export const hasScopeFacts = (facts: readonly Fact[]): boolean => facts.some(f => f.id.startsWith('scope:'));

/**
 * Every fact a new game can hold: today's, the scope facts, the organisations' (#1587), the ties'
 * (#1588) and the rumours' (#1580), as they bend by default (#1589). A run with `rumour-drift` off
 * hears the same rumours told #1580's way: the same fact ids, other words (claims.ts `RUMOUR_FACTS`).
 */
export const ALL_FACTS: readonly Fact[] = [...FACTS, ...SCOPE_FACTS, ...ORG_FACTS, ...TIE_FACTS, ...DEFAULT_RUMOUR_FACTS];

/**
 * The switchable sets of facts, in the order they join today's: what everyone knows (#1610), the
 * organisations' (#1587), and what people say of those they're tied to (#1588).
 */
const SWITCHED_FACTS: readonly { feature: string; facts: (features: FeatureSwitches | undefined) => readonly Fact[] }[] = [
  { feature: 'scope-facts', facts: () => SCOPE_FACTS },
  { feature: 'organisations', facts: () => ORG_FACTS },
  { feature: 'ties', facts: () => TIE_FACTS },
  // The rumours depend on more switches than their own (#1589: how they bend, and who someone is).
  { feature: 'rumours-and-lies', facts: rumourFactsFor },
];

// Each combination of switches is built once and kept, so a run's facts are always the same array
// (and the common cases are the very arrays above: none of the switches, FACTS; all of them,
// ALL_FACTS). Keyed by which switches are on, as a string of 0s and 1s, in SWITCHED_FACTS' order
// ('1010': scope facts and ties, no organisations or rumours): sixteen combinations at most, and
// with the rumours on, which of their sets (claims.ts `rumourSetKey`).
const FACT_SETS = new Map<string, readonly Fact[]>([['0000', FACTS], [`1111|${rumourSetKey(ruleFeatures())}`, ALL_FACTS]]);

/**
 * The facts a run plays with, by its saved rule switches: with `scope-facts` on, the scope facts
 * after today's (so a person's own words still come first); with `organisations` on (#1587), the
 * organisations' facts after those; with `ties` on (#1588), what people say of those they're tied
 * to. Off, and in every run from before a switch, without them, so those runs replay with the
 * answers they had.
 *
 * Today's facts are all a person's own, the most specific scope there is, so adding any set
 * never changes an answer someone already gave: it only answers what they didn't know (an
 * organisation's fact does come before what their village or the road says, being more
 * specific, and so does a tie's, about the person it's a view of: Maren's own opinion of Tobin
 * before what all Hollowford says of him), changes who they'd refer you to, and adds leads.
 * With `rumours-and-lies` on (#1580), each rumour as it reached the people on its path: theirs
 * alone, so the same holds. With `rumour-drift` on too (#1589), each bent by who told it, and
 * two more rumours (a debt, and a secret that leaked).
 */
export function factsFor(features: FeatureSwitches | undefined): readonly Fact[] {
  const bits = SWITCHED_FACTS.map(s => (featureOn(features, s.feature) ? '1' : '0')).join('');
  const key = bits.endsWith('1') ? `${bits}|${rumourSetKey(features)}` : bits;
  let facts = FACT_SETS.get(key);
  if (!facts) {
    facts = [...FACTS, ...SWITCHED_FACTS.filter((_, i) => bits[i] === '1').flatMap(s => s.facts(features))];
    FACT_SETS.set(key, facts);
  }
  return facts;
}

/**
 * How deep a role reaches into a kind of scope (the design's §2): an elder knows their village's
 * past best; a trader or the caravan master hears the road's news. Everyone else reaches 1.
 */
const REACH: Partial<Record<Person['role'], Partial<Record<ScopeKind, 1 | 2 | 3>>>> = {
  elder: { village: 3 },
  trader: { region: 3 },
  caravaneer: { region: 3 },
};

/** Where `p` lives: a village id, or undefined for the caravan's own. */
const homeOf = (p: Person): string | undefined => Object.values(VILLAGES).find(v => v.people.some(x => x.id === p.id))?.id;

function toKnower(p: Person): Knower {
  const home = homeOf(p);
  const reach = REACH[p.role];
  return {
    id: p.id,
    name: p.name,
    ...(home ? { home } : {}),
    region: ROAD_REGION,
    people: p.people,
    culture: p.culture,
    role: p.role,
    ...(p.teaches ? { skill: p.teaches.skill } : {}),
    // Their rank in each organisation they belong to (#1587, `Person.orgs`).
    orgs: ranksOf(p),
    ...(reach ? { reach } : {}),
  };
}

const KNOWERS: Readonly<Record<string, Knower>> = Object.fromEntries(EVERYONE.map(p => [p.id, toKnower(p)]));

/** `personId` as the model sees them, or undefined for no one on the road. */
export const knowerOf = (personId: string): Knower | undefined => KNOWERS[personId];

/**
 * Who's near `personId` to send you to: the people of their village and the caravan, which
 * travels with you. For one of the caravan's own, the caravan.
 */
export function nearbyOf(personId: string): Knower[] {
  const k = KNOWERS[personId];
  if (!k) return [];
  const village = k.home ? VILLAGES[k.home]?.people ?? [] : [];
  return [...village, ...TRAVELLERS].map(p => KNOWERS[p.id]).filter(o => o.id !== personId);
}

/**
 * What `personId` answers about `topic`, given your trust (the true number, with what noticing
 * and leads add): the model's told / not yet / lied / doesn't know (and who would). Undefined for
 * no one on the road. `facts` and `others` default to the game's; tests and later slices can pass
 * their own. `standing` is the Warden's with each organisation (#1587, orgs.ts `standingFrom`):
 * it counts toward an organisation's own facts with any of its members; none if not passed.
 * `lies` are the run's (#1580, claims.ts `liesFor`), by person; none if not passed.
 */
export function resolve(personId: string, topic: string, trust: number, opts: { facts?: readonly Fact[]; others?: readonly Knower[]; standing?: Standing; lies?: Readonly<Record<string, readonly Lie[]>> } = {}): KnowledgeAnswer | undefined {
  const known = KNOWERS[personId];
  if (!known) return undefined;
  // The run's lies (#1580, claims.ts `liesFor`), by person: none unless its switch passes them, so a
  // person who'd rather not say says "not yet", as before. The model reads lies off the Knower.
  const lies = opts.lies?.[personId];
  const k = lies?.length ? { ...known, lies } : known;
  return answer(k, topic, trust, opts.facts ?? FACTS, ORGS, opts.others ?? nearbyOf(personId), opts.standing ?? {});
}

/** A fact as the road's Answer: its words, the trust it takes, and any insight or lead. */
export function answerOf(f: Fact): Answer {
  return {
    at: gateOf(f, ORGS),
    text: f.text,
    ...(f.insight ? { insight: f.insight } : {}),
    ...(f.lead ? { lead: { who: f.lead, ...(f.leadAbout ? { about: f.leadAbout } : {}) } } : {}),
  };
}

/** A claim someone told the Warden that isn't simply so (#1588): who said it, about what, the fact, and its truth. */
export interface ClaimTold { person: string; topic: string; fact: string; truth: Exclude<Truth, 'true'> }

/**
 * The claims told so far that aren't true, read off what's been told (`asked`: the topics each
 * person has answered) and the run's facts. Nothing new is saved: what someone answered a topic
 * with is the most specific fact they know about it, and the model finds the same one again
 * (asking with infinite trust only opens gates, it never picks a different fact). Keys that are
 * no fact's topic (a deed told, a People's ways) find nothing and are skipped. The game always
 * knows the truth (design §7) while the player hears only the words. The journal of who said what
 * (#1580, journal.ts `claimsHeard`) reads `asked` the same way, lies told (`claimed:<topic>`) too.
 */
export function claimsTold(asked: Readonly<Record<string, readonly string[]>> | undefined, facts: readonly Fact[] = FACTS): ClaimTold[] {
  const out: ClaimTold[] = [];
  for (const [person, topics] of Object.entries(asked ?? {})) for (const topic of topics) {
    const r = resolve(person, topic, Infinity, { facts, others: [] });
    if (r?.kind === 'told' && r.fact.truth !== 'true') out.push({ person, topic, fact: r.fact.id, truth: r.fact.truth });
  }
  return out;
}
