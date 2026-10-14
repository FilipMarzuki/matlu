/**
 * Rumours made from the run's own world (#1662, a follow-up to rumours and lies, #1580). The
 * written rumours (content/claims.json) are the same in every run; these are made for one run, by
 * its seed, from what that run's world holds, so two runs hear different talk on the road:
 * - **ties and debts** (content/ties.json): a quarrel between rivals, a debt, a loan between friends;
 * - **organisations** (orgs.ts): a member seen where they shouldn't be, a secret that leaked;
 * - **news** (the told history, within NEWS_YEARS): what happened lately in a road village or its country;
 * - **old tellings** (the told history, beyond living memory): a disaster of long ago, and its dead.
 *
 * Each is an ordinary `RumourEntry`: a **teller** (`path[0]`, who saw it or first told it), a
 * **source** (what in the run it was made from, `file › what`), the truth (the game knows it), and
 * a path along which it was told on. So it bends at each hop by #1589's rule (claims.ts
 * `driftOf`: the number grows, the place moves, a name swaps, the teller's culture shapes it),
 * reaches whoever the road carries it to by #1661's (`reachOf`, `knownBy`), and is filed and
 * caught in the journal (journal.ts) like a written one: two tellings that don't agree are flagged.
 *
 * **Which ones.** The road's own (ties and organisations): ROAD_PICKS of them. From the history:
 * one piece of news and one old telling, the old telling among the LORE_TOP most memorable
 * (past-topics.ts `memorabilityOf`). In play they're told news first, then lore, the most memorable
 * first (the owner's answer on #1661), and every holder's fact is news heard in passing (claims.ts
 * `factsOfRumours`' `hearsay`): it answers after what a person knows of themself, their
 * organisations and their village, so it adds answers and takes no written one's place.
 *
 * **Seeded, and nothing saved.** Every choice draws from a generator seeded by its own string key
 * (`run-rumours|<seed>|…`, rng.ts), never from the sim's streams or the history engine's, so
 * switching this on changes no other dice: replays, the golden hashes and the AI bench's random
 * baselines play as before with it off. The seed is the run's (its Warden's, as the history's), so
 * a run reloaded from its save makes the same rumours, and nothing new is kept in the save.
 *
 * Behind the `run-rumours` rule switch, with `rumours-and-lies`, `rumour-drift` and
 * `history-in-play` on too (they bend, and are told from the history). The pooled liars that
 * come with the same switch are claims.ts `liesFor`'s. Every line here is a placeholder for the owner.
 *
 * Pure and deterministic, given the history.
 */

import { RUN_RUMOURS, carriage, carriesFar, claimEntries, factsOfRumours, pathProblem, type RumourEntry } from './claims';
import { featureOn, type FeatureSwitches } from './features';
import type { Fact } from './knowledge';
import { ROAD_ORGS } from './orgs';
import { KIND_TOPICS, PAST, deadIn, eventNoun, memorabilityOf, namedEvent } from './past-topics';
import { generator, seedOf, shuffled } from './rng';
import { tieEntries } from './ties';
import { topicDef } from './topics';
import { TRAVELLERS, VILLAGES, asPlayed, type Person } from './villages';
import { LIVING_MEMORY, type ReachHistory } from './world/history-format';
import { livingMemoryOf } from './world/old-history';
import { remembered } from './world/remembered';

export { RUN_RUMOURS };

/** What a run's rumour was made from: a tie, an organisation, recent news, or an old telling. */
export type RunRumourKind = 'tie' | 'org' | 'news' | 'lore';

/** A rumour made for one run: a written rumour's shape, with what it came from, who first told it, and how memorable it is. */
export interface RunRumour extends RumourEntry {
  kind: RunRumourKind;
  /** Who saw it, or first told it: `path[0]`. */
  teller: string;
  /** How memorable it is, for the order they're told in (past-topics.ts `memorabilityOf`; the road's own count as a small event, 1). */
  memorable: number;
}

/** How many of the road's own rumours (ties and organisations) a run has. */
export const ROAD_PICKS = 2;
/** How recent a happening must be, in years, to be told as news. */
export const NEWS_YEARS = 20;
/** An old telling is picked among this many of the run's most memorable. */
export const LORE_TOP = 3;

const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
const PEOPLE: Readonly<Record<string, Person>> = Object.fromEntries(EVERYONE.map(p => [p.id, p]));
const HOME: ReadonlyMap<string, string> = new Map(Object.values(VILLAGES).flatMap(v => v.people.map(p => [p.id, v.id] as const)));
const residentsOf = (village: string): string[] => (VILLAGES[village]?.people ?? []).map(p => p.id);

/** Where on the road something happens, by village: the spot people name. A placeholder for the owner. */
const SPOT: Readonly<Record<string, string>> = {
  hollowford: 'the ford at Hollowford',
  saltmere: 'the racks at Saltmere',
  'kestrel-gate': 'the gate at Kestrel Gate',
};
const SPOTS: readonly string[] = Object.values(SPOT);

/** Whether a run makes its own rumours: its switch, and the ones its rumours stand on. */
export const runRumoursOn = (features: FeatureSwitches | undefined): boolean =>
  featureOn(features, RUN_RUMOURS) && featureOn(features, 'rumours-and-lies') && featureOn(features, 'rumour-drift') && featureOn(features, 'history-in-play');

const pick = <T>(items: readonly T[], r: number): T => items[Math.floor(r * items.length)];
const between = (lo: number, hi: number, r: number): number => lo + Math.floor(r * (hi - lo + 1));
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * A path for a rumour: from its teller, each next holder someone the last can pass it to (claims.ts
 * `carriage`: a neighbour, a fellow member, or by the road), nobody twice and never one it's about
 * (`avoid`), 3 or 4 long. Tried a few times on the same generator until the road's rules pass it
 * (`pathProblem`, a leak's included); null if none does.
 */
function pathFor(base: Omit<RumourEntry, 'path'>, teller: string, avoid: ReadonlySet<string>, rand: () => number): string[] | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const length = between(3, 4, rand());
    const path = [teller];
    while (path.length < length) {
      const last = path[path.length - 1];
      const next = EVERYONE.filter(p => !path.includes(p.id) && !avoid.has(p.id) && carriage(last, p.id));
      if (!next.length) break;
      path.push(pick(next, rand()).id);
    }
    if (path.length >= 3 && !pathProblem({ ...base, path })) return path;
  }
  return null;
}

// ── The road's own: ties and organisations ─────────────────────────────────

/** How each kind of tie is talked about: the words (`{other}` is the other party, never swapped), and the number's range. Placeholders. */
const TIE_TALK: Readonly<Record<string, { core: string; label: string; n: [number, number] }>> = {
  rival: { core: '{who} and {other} had words at {where}, and it took {n} neighbours to part them.', label: 'A quarrel between {a} and {b}', n: [2, 5] },
  grudge: { core: '{who} and {other} had words at {where}, and it took {n} neighbours to part them.', label: 'A quarrel between {a} and {b}', n: [2, 5] },
  debt: { core: '{who} owes {other} {n} silver, borrowed at {where}, and hasn\'t paid a penny of it back.', label: 'What {a} and {b} owe', n: [3, 12] },
  friend: { core: '{who} lent {other} {n} silver at {where}, and never once asked for it back.', label: 'A loan between {a} and {b}', n: [3, 12] },
  kin: { core: '{who} lent {other} {n} silver at {where}, and never once asked for it back.', label: 'A loan between {a} and {b}', n: [3, 12] },
};

/**
 * A rumour of each tie on the road (content/ties.json) in the run, by its kind (`TIE_TALK`), with
 * this run's truth: which of the two did it, where, and how much. A tie a written rumour already
 * tells (Hedda's barrels, owed by Bodil) is left to it, so the game never holds two truths of one
 * debt. Seen by a neighbour of the place it happened, never by either of the two.
 */
function tieRumours(seed: number, features: FeatureSwitches | undefined): RunRumour[] {
  const written = claimEntries().rumours;
  return tieEntries().flatMap(t => {
    const talk = TIE_TALK[t.kind];
    const [a, b] = t.between;
    if (!talk || !PEOPLE[a] || !PEOPLE[b] || (t.feature && !featureOn(features, t.feature))) return [];
    if (written.some(r => r.truth.who && t.between.includes(r.truth.who) && t.between.some(x => x !== r.truth.who && r.about.includes(`person:${x}`)))) return [];
    const rand = generator(seedOf(`run-rumours|${seed}|tie|${t.id}`));
    const who = rand() < 0.5 ? a : b;
    const other = who === a ? b : a;
    const homes = [HOME.get(a), HOME.get(b)].filter((v): v is string => !!v);
    const village = homes.length ? pick(homes, rand()) : pick(Object.keys(SPOT), rand());
    const n = between(talk.n[0], talk.n[1], rand());
    const saw = residentsOf(village).filter(p => p !== a && p !== b);
    const teller = saw.length ? pick(saw, rand()) : pick(TRAVELLERS.map(p => p.id).filter(p => p !== a && p !== b), rand());
    const base: Omit<RumourEntry, 'path'> = {
      id: `run-tie-${t.id}`,
      label: talk.label.replace('{a}', PEOPLE[a].name).replace('{b}', PEOPLE[b].name),
      about: [`person:${a}`, `person:${b}`],
      core: talk.core.replace('{other}', PEOPLE[other].name),
      truth: { n, where: SPOT[village], who },
      places: SPOTS,
      placeholder: true,
      source: `src/artificer/content/ties.json › ${t.id}`,
    };
    const path = pathFor(base, teller, new Set([a, b]), rand);
    return path ? [{ ...base, path, kind: 'tie' as const, teller, memorable: 1 }] : [];
  });
}

/**
 * A rumour of each organisation people can ask about (a `group:` topic): one of its members seen
 * meeting strangers with its sign, after dark. For an organisation that keeps its business
 * (secret or guarded) it's its secret, and it gets out the way secrets do (claims.ts `leakProblem`:
 * seen by a member, out through one who talks for a living) when the road allows it; when it
 * can't (no member talks for a living), an outsider saw it. For an open one, a member brings it word.
 */
function orgRumours(seed: number): RunRumour[] {
  return Object.values(ROAD_ORGS).flatMap(org => {
    if (!topicDef('group', org.id)) return [];
    const members = EVERYONE.filter(p => p.orgs?.[org.id]).map(p => p.id);
    if (!members.length) return [];
    const rand = generator(seedOf(`run-rumours|${seed}|org|${org.id}`));
    const who = pick(members, rand());
    const n = between(2, 6, rand());
    const where = pick(SPOTS, rand());
    const name = org.name.replace(/^The /, 'the ');
    const keeps = org.secrecy === 'secret' || org.secrecy === 'guarded';
    const base: Omit<RumourEntry, 'path'> = {
      id: `run-org-${org.id}`,
      label: keeps ? `Who meets ${name} after dark` : `Word for ${name}`,
      about: [`group:${org.id}`],
      core: keeps
        ? `{who} was seen meeting {n} strangers wearing ${name}'s sign at {where}, after dark, where nobody was meant to see.`
        : `{who} brought ${name} word of {n} strangers camped by {where}.`,
      truth: { n, where, who },
      places: SPOTS,
      placeholder: true,
      source: `src/artificer/orgs.ts › ${org.id}`,
    };
    const avoid = new Set([who]);
    const order = shuffled(EVERYONE.map(p => p.id).filter(p => p !== who), seedOf(`run-rumours|${seed}|org|${org.id}|tellers`));
    if (keeps) {
      // Its secret, if a member who saw it can let it out the way secrets leak.
      for (const teller of order.filter(p => members.includes(p) && carriesFar(p))) {
        const path = pathFor({ ...base, leak: org.id }, teller, avoid, rand);
        if (path) return [{ ...base, leak: org.id, path, kind: 'org' as const, teller, memorable: 1 }];
      }
    }
    const teller = order.find(p => (keeps ? !members.includes(p) : members.includes(p)));
    const path = teller ? pathFor(base, teller, avoid, rand) : null;
    return teller && path ? [{ ...base, path, kind: 'org' as const, teller, memorable: 1 }] : [];
  });
}

/**
 * The road's own rumours a run has (ties and organisations, ROAD_PICKS of them), by its seed
 * alone: what's on the road whatever the history. None with the switch off.
 */
export function roadRumours(seed: number, features: FeatureSwitches | undefined): RunRumour[] {
  if (!runRumoursOn(features)) return [];
  return shuffled([...tieRumours(seed, features), ...orgRumours(seed)], seedOf(`run-rumours|${seed}|road`)).slice(0, ROAD_PICKS);
}

// ── From the told history: news, and old tellings ──────────────────────────

/** How each is told: the event named (past-topics.ts `eventNoun`), the number and the place left to bend. Placeholders. */
// Each is said after the teller's hedge ("I saw it myself:", "I heard it from Hedda:", "Everyone's
// saying it:"), so the words claim nothing about where they got it.
const NEWS_CORE = (noun: string): string => `${cap(noun)} came to {where} {n} winters back, and folk there still talk of little else.`;
const LORE_CORE = (noun: string): string => `${cap(noun)} at {where}, in the old days: {n} dead before it was done.`;

/**
 * The run's history as rumours: each road village's own events and its country's, news if it's
 * within NEWS_YEARS (the number is how many winters back), an old telling if it's beyond living
 * memory and the history counts its dead (the number is the dead). Told first by someone of the
 * place, and on along the road; an old telling only by someone who saw it, whose People live long
 * enough to remember it (world/old-history.ts `livingMemoryOf`: a Lövfolk healer, not a human
 * elder), since the first telling says "I saw it myself". Whatever bends, the truth is the history's.
 */
function historyRumours(history: ReachHistory, features: FeatureSwitches | undefined): { news: RunRumour[]; lore: RunRumour[] } {
  const memory = remembered(history, undefined, undefined, features);
  const news: RunRumour[] = [];
  const lore: RunRumour[] = [];
  const seen = new Set<string>();
  const villageNames = memory.villages.map(v => VILLAGES[v.village]?.name ?? v.village);
  for (const v of memory.villages) {
    const p = history.provinces.find(q => q.id === v.province.id);
    const country = v.country ? history.regions.find(r => r.id === v.country) ?? null : null;
    if (!p) continue;
    const village = VILLAGES[v.village]?.name ?? v.village;
    // Who can tell a country's news: anyone from a road village in it.
    const countryFolk = memory.villages.filter(w => w.country && w.country === v.country).flatMap(w => residentsOf(w.village));
    const lines = [
      ...p.lines.map((l, k) => ({ id: `${v.village}-${l.year}-${k}`, kind: l.kind, text: l.text, year: l.year, where: village, folk: residentsOf(v.village), topics: [`place:${v.village}`] })),
      ...(country && !seen.has(country.id) ? country.lines.map((l, k) => ({
        id: `${country.id}-${l.year}-${k}`, kind: l.kind, text: l.text, year: l.year,
        where: (l.province && history.provinces.find(q => q.id === l.province)?.name) || country.name,
        folk: countryFolk, topics: [`${PAST}around`],
      })) : []),
    ];
    if (country) seen.add(country.id);
    for (const l of lines) {
      const ago = history.year - l.year;
      const dead = deadIn(l.text);
      // News is something the game has a name for ("the hard winter", not the engine's raw kind), two winters back or more.
      const isNews = ago >= 2 && ago <= NEWS_YEARS && !!l.kind && namedEvent(l.kind);
      const isLore = ago > LIVING_MEMORY && dead > 0;
      const folk = isLore ? l.folk.filter(pid => livingMemoryOf(asPlayed(PEOPLE[pid], features).people) >= ago) : l.folk;
      if ((!isNews && !isLore) || !folk.length) continue;
      const rand = generator(seedOf(`run-rumours|${history.seed}|history|${l.id}`));
      const noun = eventNoun(l.kind ?? 'EVENT');
      const kindTopic = l.kind && KIND_TOPICS[l.kind] ? [`${PAST}${KIND_TOPICS[l.kind]}`] : [];
      const others = shuffled([...new Set([...villageNames, ...(country?.provinces.map(q => q.name) ?? [])])].filter(x => x !== l.where), seedOf(`run-rumours|${history.seed}|places|${l.id}`)).slice(0, 2);
      const teller = pick(folk, rand());
      const base: Omit<RumourEntry, 'path'> = {
        id: `run-${isNews ? 'news' : 'lore'}-${slug(l.id)}`,
        label: `${cap(noun)} at ${l.where}`,
        about: [...kindTopic, ...l.topics],
        core: isNews ? NEWS_CORE(noun) : LORE_CORE(noun),
        truth: { n: isNews ? ago : dead, where: l.where },
        places: [l.where, ...others],
        placeholder: true,
        source: `told history (seed ${history.seed}) › ${l.text}`,
      };
      const path = pathFor(base, teller, new Set(), rand);
      if (!path) continue;
      (isNews ? news : lore).push({ ...base, path, kind: isNews ? 'news' : 'lore', teller, memorable: memorabilityOf(l.kind, l.text, ago) });
    }
  }
  return { news, lore };
}

// ── A run's rumours ────────────────────────────────────────────────────────

/**
 * The rumours a run makes of its world (this file's header): the road's own (`roadRumours`), one
 * piece of the history's news and one of its old tellings, ordered news first, then lore, the most
 * memorable first. By the history's seed, which is the run's. None with the switch off.
 */
export function runRumours(history: ReachHistory, features: FeatureSwitches | undefined): RunRumour[] {
  if (!runRumoursOn(features)) return [];
  const seed = history.seed;
  const { news, lore } = historyRumours(history, features);
  const oneNews = shuffled(news, seedOf(`run-rumours|${seed}|news`)).slice(0, 1);
  const top = [...lore].sort((a, b) => b.memorable - a.memorable || a.id.localeCompare(b.id)).slice(0, LORE_TOP);
  const oneLore = shuffled(top, seedOf(`run-rumours|${seed}|lore`)).slice(0, 1);
  const byMemory = (a: RunRumour, b: RunRumour) => b.memorable - a.memorable;
  return [...[...roadRumours(seed, features), ...oneNews].sort(byMemory), ...oneLore];
}

/**
 * The knowledge model's facts for a run's rumours: as any rumour's (claims.ts `factsOfRumours`),
 * every holder's heard in passing, so they add answers and change none a person already gave.
 */
export const runRumourFacts = (history: ReachHistory, features: FeatureSwitches | undefined): Fact[] =>
  factsOfRumours(runRumours(history, features), features, { hearsay: true });
