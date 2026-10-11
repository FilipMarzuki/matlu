/**
 * Organisations on the road (#1587, knowledge slice B; design in docs/knowledge-model-design.md §4).
 *
 * People know things because of who they belong to. An organisation is a scope of its own: its
 * members know its facts, as deep as their rank reaches; its **secrecy** says what they'll tell
 * an outsider (the Compact keeps everything at `secret`; the Pandor's Compact of Knowing is
 * **bound to tell**); and the Warden can earn **standing** with it as a whole, apart from any one
 * member's trust: a deed told to one member is known to them all.
 *
 * Any kind of organisation fits (the owner's call, #1587): guilds, treaties, goblin bands, cults,
 * secret societies, hunting parties. Its `kind` is plain words the game never branches on: the
 * model reads only its secrecy and ranks (knowledge.ts), so a new kind is new data, not new code.
 * To start, only guilds have ranks, and the Warden can't join one.
 *
 * Here: the registry and its facts (content/organisations.json, every entry a placeholder for the
 * owner to review), who belongs (from `Person.orgs`, villages.ts), the standing the Warden has
 * earned, and the signs of membership noticing reads (#1496). Organisations the story engine's
 * history founds in a road village's province are a bridge of their own (world/organisations.ts).
 *
 * Pure and deterministic: data built once from other data, no randomness.
 */

import type { Fact, Org, Reliability, Sensitivity, Standing } from './knowledge';
import { VILLAGES, TRAVELLERS, type Person } from './villages';
import orgsFile from './content/organisations.json';

/** An organisation on the road: the model's `Org`, with the road's own say on it. */
export interface RoadOrg extends Org {
  kind: string;
  reliability: Reliability;
  /** The focus key it's talked about by (`group:compact`), if it has one: what its members' signs are signs of. */
  topic?: string;
  /** Deeds it remembers (`herald-owes-you`): told to any one member, the whole organisation knows. */
  honours?: readonly string[];
  /** Written by hand for the road, for the owner to review. */
  placeholder?: boolean;
  /** The canon it rests on (`file § heading › label`). */
  source: string;
}

/** An organisation's fact as written: the model's `Fact` (its id without the `org:` prefix), and its source. */
export interface OrgFactEntry extends Omit<Fact, 'sensitivity'> {
  sensitivity?: Sensitivity;
  placeholder?: boolean;
  source: string;
}

// A JSON import is typed with every string widened to `string` (so `secrecy` reads as `string`,
// not `Secrecy`); `as unknown as` trusts the interfaces instead, and organisations.test.ts checks
// the data really has those shapes.
const ORG_ENTRIES: readonly RoadOrg[] = orgsFile.orgs as unknown as readonly RoadOrg[];
const FACT_ENTRIES: readonly OrgFactEntry[] = orgsFile.facts as unknown as readonly OrgFactEntry[];

/** Every organisation as written. */
export const orgEntries = (): readonly RoadOrg[] => ORG_ENTRIES;
/** Every organisation fact as written, with its source: what a reviewer checks against canon. */
export const orgFactEntries = (): readonly OrgFactEntry[] => FACT_ENTRIES;

/** The road's organisations, by id. */
export const ROAD_ORGS: Readonly<Record<string, RoadOrg>> = Object.fromEntries(ORG_ENTRIES.map(o => [o.id, o]));

/**
 * What the organisations' members know, as the model reads it. Ids get an `org:` prefix, as the
 * scope facts get `scope:`, so a fact's id says where it came from. Public unless written otherwise:
 * the organisation's secrecy lifts the gate toward outsiders anyway (knowledge.ts `gateOf`).
 */
export const ORG_FACTS: readonly Fact[] = FACT_ENTRIES.map(e => ({
  id: `org:${e.id}`,
  about: e.about,
  text: e.text,
  scope: e.scope,
  sensitivity: e.sensitivity ?? 'public',
  truth: e.truth,
  ...(e.depth ? { depth: e.depth } : {}),
  ...(e.lead ? { lead: e.lead } : {}),
}));

/** Everyone on the road, villagers first, then the caravan's own (the order the rest of the game uses). */
const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];

/** The members of `orgId` on the road, in that order. */
export const membersOf = (orgId: string): Person[] => EVERYONE.filter(p => p.orgs?.[orgId] !== undefined);

/** `p`'s rank in each organisation they belong to: what the knowledge model reads (`Knower.orgs`). */
export const ranksOf = (p: Person): Record<string, number> =>
  Object.fromEntries(Object.entries(p.orgs ?? {}).map(([org, m]) => [org, m.rank]));

/** Standing one deed earns with an organisation: one trust gate (0 / 25 / 50 / 75), as a lead is. */
export const STANDING_PER_DEED = 25;

/**
 * The Warden's standing with each organisation, from what they've told its members: each deed an
 * organisation honours, told to any one of them (`asked[member]` holds `deed:<id>` once told,
 * road.ts `tellOf`), is worth STANDING_PER_DEED with all of them, once however many heard it.
 *
 * Read off what's been told rather than kept, so a save carries nothing new: a road from before
 * organisations already holds everything its standing is made of.
 */
export function standingFrom(asked: Readonly<Record<string, readonly string[]>> | undefined): Standing {
  const out: Record<string, number> = {};
  for (const org of ORG_ENTRIES) {
    const told = new Set(membersOf(org.id).flatMap(p => asked?.[p.id] ?? []));
    const deeds = (org.honours ?? []).filter(d => told.has(`deed:${d}`)).length;
    if (deeds) out[org.id] = deeds * STANDING_PER_DEED;
  }
  return out;
}

/** The organisations of `personId`'s that remember `deed`: where word of it goes when they hear it. */
export const honouringOrgs = (personId: string, deed: string): RoadOrg[] =>
  ORG_ENTRIES.filter(o => o.honours?.includes(deed) && EVERYONE.some(p => p.id === personId && p.orgs?.[o.id]));

/**
 * Signs of membership (#1496), by person id and topic key: what a member's `sign` shows, filed
 * under their organisation's topic. Noticing (notice.ts `SIGNS`) reads these with the signs
 * written per person.
 */
export const MEMBERSHIP_SIGNS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(
  EVERYONE.map(p => [p.id, Object.fromEntries(Object.entries(p.orgs ?? {}).flatMap(([org, m]) => {
    const topic = ROAD_ORGS[org]?.topic;
    return m.sign && topic ? [[topic, m.sign]] : [];
  }))] as const).filter(([, signs]) => Object.keys(signs).length > 0),
);
