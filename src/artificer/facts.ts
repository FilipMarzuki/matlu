/**
 * What people on the road know: the knowledge model in the game (slice A, #1609; design in
 * docs/knowledge-model-design.md, model in knowledge.ts).
 *
 * Three things live here:
 * - **FACTS**, everything anyone can say. Today that's the hand-written answers (answers.ts), each
 *   one a person-scope fact in that person's own words, and each teacher's answer about their own
 *   skill. Later slices add facts for wider scopes (a village, a region, an organisation, a role)
 *   to this list, and everyone in the scope knows them without any caller changing.
 * - **Knowers**: each person, as the model sees them (their village, region, People, culture,
 *   role, the skill they teach), built from villages.ts.
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
import { answer, gateOf, SENSITIVITY_TRUST, type Fact, type Knower, type KnowledgeAnswer, type Org, type ScopeKind, type Sensitivity } from './knowledge';
import { SKILLS, type SkillId } from './skills';
import { VILLAGES, TRAVELLERS, type Person } from './villages';

/**
 * The region the three villages share: the north road out of Greywind Reach. The owner's call on
 * the design: villages a few days apart can share a region. Villages have no region field yet, so
 * everyone on the road is in this one until they do.
 */
export const ROAD_REGION = 'north-road';

/** Organisations, by id. None yet: the registry is slice B (#1587). The model treats a missing one as open. */
export const ORGS: Readonly<Record<string, Org>> = {};

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
 * How deep a role reaches into a kind of scope (the design's §2): an elder knows their village's
 * past best; a trader or the caravan master hears the road's news. Everyone else reaches 1. No
 * scope facts exist yet, so this changes nothing today; it's here so slice C's facts land right.
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
    // Organisation membership is slice B (#1587).
    orgs: {},
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
 * their own.
 */
export function resolve(personId: string, topic: string, trust: number, opts: { facts?: readonly Fact[]; others?: readonly Knower[] } = {}): KnowledgeAnswer | undefined {
  const k = KNOWERS[personId];
  if (!k) return undefined;
  return answer(k, topic, trust, opts.facts ?? FACTS, ORGS, opts.others ?? nearbyOf(personId));
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
