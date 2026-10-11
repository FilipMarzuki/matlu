/**
 * Organisations from the generated history (#1587, knowledge slice B): the bridge from the story
 * engine's guilds, academies and companies (history.ts `orgsOf`) to the road. Where a road
 * village's province has one standing at the end of the history, it becomes an organisation the
 * knowledge model reads (knowledge.ts `Org`): the village's people whose work fits can belong to it,
 * and its facts are what the engine says it did (when it was founded, who heads it, how many it
 * counts, what it keeps to itself), with one fact the whole village knows: that its hall is there.
 *
 * Nothing in play reads these yet, as with what the villages remember (remembered.ts): the history
 * runs in a worker, and bringing it into the sim is slice F. Then these join the road's registry
 * (orgs.ts), the memberships join `Person.orgs`, and the facts join `factsFor`'s. Their topic,
 * `group:history-<id>`, needs a topic of its own by then (topics.ts has none for them yet).
 *
 * Only guilds have ranks, to start (the owner's call, #1587): apprentice, journeyman, master. The
 * engine's guildmaster is the master, someone off the road, so a village member is a journeyman:
 * they know what the guild says among its own, not what only the master knows.
 *
 * Pure and deterministic: plain data in, plain data out, no randomness, no engine.
 */

import type { Fact, Org, Reliability, Secrecy } from '../knowledge';
import { VILLAGES, type Person } from '../villages';
import type { HistoryOrg, ReachHistory } from './history-format';
import type { VillageRegion } from './regions';

/** A guild's ranks, lowest first: rank n is `ENGINE_GUILD_RANKS[n - 1]`, and knows its facts to depth n. */
export const ENGINE_GUILD_RANKS: readonly string[] = ['apprentice', 'journeyman', 'master'];
/** The rank a road villager holds in a guild: journeyman. The master is the engine's own. */
const VILLAGER_GUILD_RANK = 2;

/**
 * Who in a village can belong to each kind of engine organisation: whose work fits a guild's craft,
 * and who teaches, for an academy. A company (mercenaries, pirates) takes no one from the road's
 * villages yet, and arcana is rare-class work nobody on the road does.
 */
const FITS: Readonly<Record<string, (p: Person) => boolean>> = {
  smithing: p => p.role === 'smith',
  trade: p => p.role === 'trader',
  letters: p => p.role === 'teacher' || p.role === 'healer',
  textiles: p => p.teaches?.skill === 'handcraft',
  arms: p => p.role === 'hunter',
  academy: p => p.role === 'teacher',
};

/** How each kind keeps its knowledge from outsiders, and how far to trust what it says (#1580). */
const MANNER: Readonly<Record<HistoryOrg['kind'], { secrecy: Secrecy; reliability: Reliability }>> = {
  // A guild guards its craft: that's what the charter is for.
  guild: { secrecy: 'guarded', reliability: 'fair' },
  // An academy exists to be asked, and writes things down.
  academy: { secrecy: 'open', reliability: 'careful' },
  // Hired swords talk big and keep their contracts close.
  company: { secrecy: 'guarded', reliability: 'loose' },
};

/** What the engine calls its head, and how it came to be, by kind. */
const WORDS: Readonly<Record<HistoryOrg['kind'], { head: string; began: string; members: string }>> = {
  guild: { head: 'master of it', began: 'chartered', members: 'masters' },
  academy: { head: 'its rector', began: 'founded', members: 'scholars' },
  company: { head: 'its captain', began: 'raised', members: 'men' },
};

export interface EngineOrgs {
  /** The organisations, by id (`history-<engine id>`). */
  orgs: Record<string, Org>;
  /** What their members know (scope `org`), and what each village knows of the one there (scope `village`). */
  facts: Fact[];
  /** Who on the road belongs, by person id: their rank in each (`Knower.orgs`). */
  members: Record<string, Record<string, number>>;
}

/** The organisation `o` as the model reads it. */
function orgOf(o: HistoryOrg): Org {
  return {
    id: `history-${o.id}`,
    name: o.name,
    kind: o.kind === 'company' && o.craft ? `${o.craft} company` : o.kind,
    ...MANNER[o.kind],
    ...(o.kind === 'guild' ? { ranks: ENGINE_GUILD_RANKS } : {}),
  };
}

/** What the engine says `o` did, as facts: its members' (by depth), and its village's. */
function factsOf(o: HistoryOrg, village: string, present: number): Fact[] {
  const id = `history-${o.id}`;
  const topic = `group:${id}`;
  const w = WORDS[o.kind];
  const ago = present - o.founded;
  const fact = (what: string, text: string, depth: 1 | 2 | 3, sensitivity: Fact['sensitivity']): Fact =>
    ({ id: `${id}:${what}`, about: [topic], text, scope: { kind: 'org', id }, sensitivity, truth: 'true', depth });
  return [
    // Everyone in the village knows the hall is there; that much is no secret.
    { id: `${id}:hall`, about: [`place:${village}`, topic], text: `The ${o.name} has its hall here.`, scope: { kind: 'village', id: village }, sensitivity: 'public', truth: 'true' },
    fact('founded', `The ${o.name} was ${w.began} in ${o.founded}, ${ago} ${ago === 1 ? 'year' : 'years'} ago.`, 1, 'public'),
    fact('members', `It has ${o.members} ${w.members} on its rolls.`, 1, 'public'),
    ...(o.head ? [fact('head', `${o.head} is ${w.head} now.`, 2, 'guarded')] : []),
    // What a guild keeps to itself is the master's to know: a journeyman hasn't been trusted with it.
    ...(o.monopoly ? [fact('monopoly', `It keeps the ${o.monopoly} to itself: no one outside is taught it.`, 3, 'secret')] : []),
  ];
}

/**
 * The engine's organisations in the road villages' provinces, from a told history: those still
 * standing at its end, with the village people who'd belong and what each says. `where` is the
 * same seed's road villages and their provinces (regions.ts `roadRegions`). A history kept before
 * organisations (no `orgs`) has none.
 */
export function engineOrgs(history: ReachHistory, where: readonly VillageRegion[]): EngineOrgs {
  const out: EngineOrgs = { orgs: {}, facts: [], members: {} };
  for (const o of history.orgs ?? []) {
    if (o.ended !== null) continue;
    const at = where.find(w => w.province.id === o.province);
    if (!at) continue;
    const org = orgOf(o);
    out.orgs[org.id] = org;
    const fits = FITS[o.kind === 'guild' ? o.craft ?? '' : o.kind];
    const joined = fits ? (VILLAGES[at.village]?.people ?? []).filter(fits) : [];
    for (const p of joined) out.members[p.id] = { ...out.members[p.id], [org.id]: o.kind === 'guild' ? VILLAGER_GUILD_RANK : 1 };
    // With no one on the road to belong, only the village's own fact: nobody here knows its business.
    const facts = factsOf(o, at.village, history.year);
    out.facts.push(...(joined.length ? facts : facts.filter(f => f.scope.kind === 'village')));
  }
  return out;
}
