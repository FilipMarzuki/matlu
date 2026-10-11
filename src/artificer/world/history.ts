/**
 * The Reach's generated history (#1540, plan: docs/spikes/artificer-generated-world.md).
 *
 * Each run gets a new Reach (reach.ts), split into provinces (provinces.ts). This hands those
 * provinces to the history engine (`storytelling/`) as a starting world: a lordship per province,
 * gathered under two or three realms, each held by a house of the province's culture. The engine
 * then lives through HISTORY_YEARS, a year per `tick`, and logs what happened: successions, wars,
 * feuds, famines, marriages. The sifter keeps what's worth telling and the renderer writes it up.
 *
 * Pure and deterministic, like the grid. It takes a few seconds, so the page runs it in a Web
 * Worker (src/artificer-app/history.worker.ts) and keeps the result, and nothing in the sim reads it
 * yet: history affecting play is a later phase.
 */

import { loadWorld } from '../../../storytelling/seed';
import { tick } from '../../../storytelling/tick';
import { sift } from '../../../storytelling/sifter';
import { extractArcs } from '../../../storytelling/arcs';
import { renderEvent, renderLayeredChronicle } from '../../../storytelling/render';
import type { World } from '../../../storytelling/world';
import type { RegionalEvent, WorldEvent } from '../../../storytelling/types';
import type { CharacterSpec, DynastySpec, TitleSpec, WorldSpec } from '../../../storytelling/world-spec';
import { generator, seedOf } from '../rng';
import { generateReach, type Reach } from './reach';
import { provincesOf, type Province, type Provinces } from './provinces';
import { REACH_CULTURES, REACH_PEOPLES, TITLE_WORDS, cultureName, lawOf, racesOf, type ReachCulture } from './peoples';
import { HISTORY_VERSION, LIVING_MEMORY, type HistoryOrg, type ReachHistory, type RegionHistory, type RegionLine } from './history-format';
import { remembered, type Remembered } from './remembered';
import { renderRegionalEvent, renderRegionalEventNamed } from '../../../storytelling/render';
import { nameRegions, regionLabel } from '../../../storytelling/regions';
import { hasAlliance } from '../../../storytelling/diplomacy';

export { HISTORY_VERSION, LIVING_MEMORY, type ReachHistory, type ProvinceHistory, type HistoryLine, type RegionHistory, type RegionLine, type HistoryOrg } from './history-format';

/** How long the engine runs. Year 1 is when the oldest houses of the Reach first held land. */
export const HISTORY_YEARS = 150;
/** How significant an event must be to be told (the sifter's scale; the engine's own default is 4). */
const TELL_THRESHOLD = 5;
/** What each province remembers: its most significant events, at most this many. */
const LINES_PER_PROVINCE = 3;

/**
 * The starting world for the engine: every province, a lordship over each, and the houses that
 * hold them. Realms: the two or three most populous provinces (not next door to each other) seat
 * a realm, and every other province owes fealty to the nearest realm seat.
 */
export function reachSpec(reach: Reach, provinces: Provinces): WorldSpec {
  const rnd = generator(seedOf(`${reach.seed}|world|houses`));
  const P = provinces.list;
  const hops = provinceHops(P);

  const realmCount = P.length <= 8 ? 2 : 3;
  const byPopulation = P.map((_p, i) => i).sort((a, b) => P[b].population - P[a].population || a - b);
  const realmSeats: number[] = [];
  for (const i of byPopulation) if (realmSeats.length < realmCount && realmSeats.every(r => hops[r][i] >= 2)) realmSeats.push(i);
  // Every province follows the realm seat fewest borders away (the earlier-picked seat on a tie).
  const realmOf = P.map((_p, i) => {
    let best = -1;
    realmSeats.forEach((r, k) => { if (hops[r][i] < Infinity && (best === -1 || hops[r][i] < hops[realmSeats[best]][i])) best = k; });
    return best;
  });

  const titles: TitleSpec[] = [];
  const holdsOf = new Map<string, Province>(); // title id → its seat
  realmSeats.forEach((r, k) => {
    const p = P[r];
    titles.push({ id: `t_r${k}`, name: `${TITLE_WORDS[p.culture].duchy} of ${p.name}`, tier: 'duchy', law: lawOf(p.culture), seat: p.id, liege: null });
    holdsOf.set(`t_r${k}`, p);
  });
  P.forEach((p, i) => {
    if (realmSeats.includes(i)) return;
    const liege = realmOf[i] >= 0 ? `t_r${realmOf[i]}` : null;
    titles.push({ id: `t_${p.id}`, name: `${TITLE_WORDS[p.culture].county} of ${p.name}`, tier: 'county', law: lawOf(p.culture), seat: p.id, liege });
    holdsOf.set(`t_${p.id}`, p);
  });

  // A house for each lordship, named from its culture's surnames (its province's name once those run out).
  const usedSurnames = new Set<string>();
  const dynasties: DynastySpec[] = titles.map(t => {
    const p = holdsOf.get(t.id)!;
    const pool = cultureOf(p.culture).surnames!.filter(s => !usedSurnames.has(s));
    const name = pool.length ? pool[Math.floor(rnd() * pool.length)] : p.name;
    usedSurnames.add(name);
    return { id: `d_${t.id}`, name, culture: p.culture, race: weighted(rnd, racesOf(p.culture)) };
  });

  // Each house starts as a holder, a spouse and their children. Parents come before children: the
  // engine creates characters in this order, which also fixes its random stream.
  const start = 1;
  const characters: CharacterSpec[] = [];
  let n = 0;
  const person = (o: Omit<CharacterSpec, 'id' | 'father' | 'mother' | 'spouse' | 'founds' | 'holds' | 'claims'> & Partial<CharacterSpec>): CharacterSpec => {
    const c: CharacterSpec = { id: `c${n++}`, father: null, mother: null, spouse: null, founds: null, holds: null, claims: [], ...o };
    characters.push(c);
    return c;
  };
  const heads = new Map<string, CharacterSpec>(); // title id → its holder
  for (const t of titles) {
    const p = holdsOf.get(t.id)!;
    const culture = cultureOf(p.culture);
    const dynasty = `d_${t.id}`;
    const drives = () => culture.driveBias!.map(b => Math.round(Math.max(0, Math.min(1, b + (rnd() - 0.5) * 0.4)) * 100) / 100);
    const name = (sex: 'male' | 'female') => { const pool = sex === 'male' ? culture.namesMale : culture.namesFemale; return pool[Math.floor(rnd() * pool.length)]; };
    const sex = rnd() < 0.75 ? 'male' : 'female';
    const other = sex === 'male' ? 'female' : 'male';
    const born = start - 28 - Math.floor(rnd() * 25);
    const head = person({ name: name(sex), sex, dynasty, birthYear: born, province: p.id, drives: drives(), founds: dynasty, holds: t.id });
    const spouse = person({ name: name(other), sex: other, dynasty, birthYear: born + Math.floor(rnd() * 9) - 4, province: p.id, drives: drives(), spouse: head.id });
    const [father, mother] = sex === 'male' ? [head, spouse] : [spouse, head];
    const kids = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < kids; k++) {
      const s = rnd() < 0.5 ? 'male' : 'female';
      person({ name: name(s), sex: s, dynasty, birthYear: start - Math.floor(rnd() * 18), province: p.id, drives: drives(), father: father.id, mother: mother.id });
    }
    heads.set(t.id, head);
  }
  // A grievance to start with: in each realm, the house of its richest vassal says it's the elder
  // line and the realm should be theirs. A weak claim, but the engine's lords act on claims.
  realmSeats.forEach((_r, k) => {
    const vassals = titles.filter(t => t.liege === `t_r${k}`).sort((a, b) => holdsOf.get(b.id)!.population - holdsOf.get(a.id)!.population);
    if (vassals.length >= 2) heads.get(vassals[0].id)!.claims.push({ title: `t_r${k}`, strength: 'weak', basis: 'the elder line', year: start - 5 });
  });

  return {
    startYear: start,
    provinces: P.map(p => ({
      // Not `coastal`, even by a lake: to the engine a coast is the sea, with ports, pirates and
      // voyages to new lands, and the Reach is inland.
      id: p.id, name: p.name, terrain: p.terrain, fertility: p.fertility, coastal: false, river: p.river,
      neighbors: p.neighbors, population: p.population, mana: p.mana,
      // For the engine's regional economy only (#1598): a lake to fish, and how much of the land is
      // bare rock (scree and fell) to mine. Nothing else in the engine reads either on a surface
      // province, but since #1608 the regional economy pushes back (a thriving mine makes its
      // province rich, and its lord stronger), so they shape the history too.
      lake: p.lakeside,
      mineralWealth: Math.round(rockShare(reach, p) * 100) / 100,
    })),
    titles,
    dynasties,
    characters,
    cultures: [...REACH_CULTURES],
    races: [...REACH_PEOPLES],
  };
}

/** The Reach, its provinces and the engine's world after HISTORY_YEARS: everything `runHistory` summarises. */
export function simulateReach(seed: number, years = HISTORY_YEARS): { reach: Reach; provinces: Provinces; world: World } {
  const reach = generateReach(seed);
  const provinces = provincesOf(reach);
  // The engine gets its own seed, derived like the grid's streams, so it shares no stream with the sim.
  const world = loadWorld(reachSpec(reach, provinces), seedOf(`${seed}|world|history`));
  for (let y = 0; y < years; y++) tick(world);
  // Name the regions from the history just lived (a mine, a hero, a hardship, a quarrel, or the
  // market town). After the last tick and RNG-free, so the event log stays as it was.
  nameRegions(world);
  return { reach, provinces, world };
}

/** Run the Reach's history for a seed and write it up as plain data. */
export function runHistory(seed: number, years = HISTORY_YEARS): ReachHistory {
  const { provinces, world } = simulateReach(seed, years);
  const { chronicle } = sift(world, TELL_THRESHOLD);
  const arcs = extractArcs(world, chronicle);
  // The big regional events join the told chronicle here, at the telling layer: they're read from
  // the regional log after the history is lived, so nothing goes into World.events or draws from
  // World.rng, and the event log (and every hash) stays as it was.
  const extra = regionalChronicle(world, new Set(chronicle.map(e => e.id)));
  const text = renderLayeredChronicle(world, chronicle, arcs, { living: LIVING_MEMORY, chronicle: years, extra });

  // Which province an event happened in: its own, or the seat of the title it's about.
  const where = (ev: WorldEvent) => ev.provinceId ?? world.title(ev.titleId)?.provinceId ?? null;
  return {
    version: HISTORY_VERSION,
    seed,
    year: world.year,
    provinces: provinces.list.map(p => {
      const title = world.province(p.id)?.titleId ? world.title(world.province(p.id)!.titleId) : undefined;
      const holder = title?.holderId ? world.char(title.holderId) : undefined;
      const lines = pickLines(chronicle.filter(ev => where(ev) === p.id), world.year)
        .map(ev => ({ year: ev.year, text: renderEvent(world, ev), kind: ev.type, house: houseOf(world, ev) }));
      return {
        id: p.id,
        name: p.name,
        culture: cultureName(p.culture),
        title: title?.name ?? p.name,
        holder: holder ? fullName(world, holder.id) : null,
        house: holder ? world.dynasty(holder.dynastyId)?.name ?? null : null,
        lines,
      };
    }),
    regions: regionsOf(world),
    orgs: orgsOf(world),
    chronicle: text,
    logged: world.events.length,
    told: chronicle.length,
  };
}

/**
 * What each road village remembers (remembered.ts), from nothing but the seed: for a game that
 * has no told history to hand, like a server game (API, MCP, console), where no worker ran.
 * Telling the history is nearly all the cost (a quarter to half a second in Node: the engine's
 * 150 years), and reading it is a few milliseconds. So a caller that already has the history
 * (the page keeps it) passes it to `remembered` instead, and one that doesn't should keep the
 * history, or this result, per seed rather than call this on every request: both are plain data.
 */
export function rememberedOf(seed: number): Remembered {
  return remembered(runHistory(seed));
}

/**
 * How significant a regional event must be to join the chronicle (the sifter's scale,
 * sifter.ts regionalSignificance). Within living memory 5: famine and plague (6–7), a house
 * losing its last seat in a region (5), a seat seized or left empty, a feud, a great lord's death
 * (5). Not a fair or festival (2), a hard winter, bandits or a bad harvest (3), a failing mine
 * (3–4). Older than living memory 6: only famine, plague and seizures are still told.
 */
export const REGION_CHRONICLE_THRESHOLD = 5;
export const REGION_CHRONICLE_LEGEND_THRESHOLD = 6;

/**
 * The regional events the chronicle tells (#1598), oldest first, each naming its region. One
 * that only retells an event the chronicle already tells (a seizure, a lord's death) is left out,
 * unless it's a famine or plague across more than one of the region's lands: that's news the
 * province lines don't give.
 */
export function regionalChronicleEvents(world: World, told: ReadonlySet<number>): RegionalEvent[] {
  const present = world.year;
  return world.regionalEvents
    .filter(e => e.significance >= (present - e.year <= LIVING_MEMORY ? REGION_CHRONICLE_THRESHOLD : REGION_CHRONICLE_LEGEND_THRESHOLD))
    .filter(e => {
      if (e.causeEventId === null || !told.has(e.causeEventId)) return true;
      return (e.kind === 'FAMINE' || e.kind === 'PLAGUE') && Number(e.data['provinces'] ?? 1) > 1;
    })
    .sort((a, b) => a.year - b.year || a.id - b.id);
}

/** Those events as the chronicle's extra lines (render.ts renderLayeredChronicle `extra`). */
export function regionalChronicle(world: World, told: ReadonlySet<number>): { year: number; text: string }[] {
  return regionalChronicleEvents(world, told).map(e => ({ year: e.year, text: renderRegionalEventNamed(world, e) }));
}

/** Regional events told per region: the most notable of living memory, and of the years before. */
const REGION_LIVING_LINES = 16;
const REGION_LEGEND_LINES = 5;
/** Notable enough to tell: within living memory a lord's death or a bad harvest (3) and up; older, only the great events (5). */
const REGION_LIVING_THRESHOLD = 3;
const REGION_LEGEND_THRESHOLD = 5;
/** A feud is still "lately" this many years after the lords last fought. */
const FEUD_YEARS = 10;

/** The engine's regions (storytelling/regions.ts, #1598) at the end of the history, as plain data. */
export function regionsOf(world: World): RegionHistory[] {
  const present = world.year;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const idOf = (rid: string) => `${slug(world.regions.get(rid)!.name)}-country`;
  const provName = (id: string | null) => (id ? world.province(id)?.name ?? null : null);
  const houseName = (d: string) => world.dynasty(d)?.name ?? d;
  return [...world.regions.values()].map(r => {
    const mine = world.regionalEvents.filter(e => e.regionId === r.id);
    const notable = (living: boolean, threshold: number, cap: number, category?: string) => mine
      .filter(e => (present - e.year <= LIVING_MEMORY) === living && e.significance >= threshold && (!category || e.category === category))
      .sort((a, b) => b.significance - a.significance || b.year - a.year || a.id - b.id)
      .slice(0, cap);
    // Living memory gets a share per kind, so a turbulent run of lords' deaths and seizures
    // doesn't crowd out the famines, failing mines and fairs people also talk about.
    const perKind = Math.floor(REGION_LIVING_LINES / 3);
    const lines: RegionLine[] = [
      ...notable(false, REGION_LEGEND_THRESHOLD, REGION_LEGEND_LINES),
      ...(['politics', 'economy', 'event'] as const).flatMap(k => notable(true, REGION_LIVING_THRESHOLD, perKind, k)),
    ]
      .sort((a, b) => a.year - b.year || a.id - b.id)
      .map(e => ({ year: e.year, kind: e.kind, category: e.category, significance: e.significance, province: provName(e.provinceId), text: renderRegionalEvent(world, e) }));
    const holders = r.provinceIds.flatMap(pid => {
      const t = world.title(world.province(pid)?.titleId ?? null);
      return t?.holderId && world.char(t.holderId)?.alive ? [{ title: t, holder: t.holderId }] : [];
    });
    const alliances: [string, string][] = [];
    holders.forEach((a, i) => holders.slice(i + 1).forEach(b => {
      if (a.holder !== b.holder && hasAlliance(world, a.holder, b.holder) && !alliances.some(([x, y]) => x === fullName(world, a.holder) && y === fullName(world, b.holder))) alliances.push([fullName(world, a.holder), fullName(world, b.holder)]);
    }));
    return {
      id: idOf(r.id),
      name: regionLabel(r),
      centre: { id: r.centreId, name: r.name },
      provinces: r.provinceIds.map(id => ({ id, name: provName(id)!, livelihood: r.livelihoods[id], secondary: [...r.secondary[id]], founding: r.founding[id], wealth: world.province(id)?.wealth ?? 0.5 })),
      primary: r.primary,
      venture: { kind: r.venture.kind, province: provName(r.venture.provinceId)!, state: r.venture.state, since: r.venture.since },
      prosperity: r.prosperity,
      price: r.price,
      harvest: r.harvest,
      levy: r.levy,
      tax: r.tax,
      unsettled: r.unsettled,
      leadingHouse: r.leadingHouse ? houseName(r.leadingHouse) : null,
      lords: holders.map(h => ({ province: provName(h.title.provinceId)!, text: `${fullName(world, h.holder)} holds the ${h.title.name}.` })),
      feuds: Object.entries(r.feuds)
        // Lately, and still live: both houses have people left, and one still holds a seat here.
        .filter(([key, year]) => present - year <= FEUD_YEARS
          && key.split('|').every(d => world.dynastyMembers(d).length > 0)
          && key.split('|').some(d => (r.houses[d] ?? 0) > 0))
        .map(([key, year]) => ({ houses: key.split('|').map(houseName) as [string, string], year })),
      alliances,
      roads: Object.entries(r.roads).map(([to, trade]) => ({ to: idOf(to), name: regionLabel(world.regions.get(to)!), trade })),
      lines,
    };
  });
}

/**
 * Which of a province's told events it keeps: its LINES_PER_PROVINCE most significant, oldest
 * first, with one place reserved for living memory (#1586). The most significant events tend to
 * be old (across 24 seeds only a fifth of kept events were within LIVING_MEMORY, and half the road
 * villages had nothing true and recent to tell), so when none of the top ones is within living
 * memory but some event is, the most significant recent one takes the last place. A province with
 * no recent event keeps its top ones as before.
 *
 * Only chooses among events already logged and sifted: the engine's random stream and event log
 * are untouched (history.test.ts pins the log), so only what's told changes (HISTORY_VERSION 5).
 */
export function pickLines<E extends Pick<WorldEvent, 'id' | 'year' | 'significance' | 'actorId'>>(events: readonly E[], present: number, n = LINES_PER_PROVINCE): E[] {
  // One line per deed: the engine often logs a deed twice (a murder, and the kinslaying it was),
  // so keep only the most significant event per person per year.
  const seen = new Set<string>();
  const ranked = [...events]
    .sort((a, b) => b.significance - a.significance || a.id - b.id)
    .filter(ev => { const k = `${ev.year}|${ev.actorId ?? ev.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // The same test as the chronicle's LIVING MEMORY section and remembered.ts `recall`.
  const living = (ev: E) => present - ev.year <= LIVING_MEMORY;
  const kept = ranked.slice(0, n);
  const recent = ranked.find(living);
  // (If fewer than n were told, all are kept, recent included, so this only ever swaps out the last.)
  if (n > 0 && recent && !kept.some(living)) kept[kept.length - 1] = recent;
  return kept.sort((a, b) => a.year - b.year || a.id - b.id);
}

/**
 * Server games (API, MCP, console) have no told history to hand, and telling one costs a quarter
 * to half a second, too much for every new game (PR #1592's timings). So they're to compute what
 * the villages remember lazily, the first time a road question needs a regional fact, and keep it
 * per seed: this is that keeping, a small LRU of the last `size` seeds (most games are played by
 * the seed that started them, and a handful of live games per instance is the common case).
 * Not wired into play yet: no caller needs regional facts so far. `tell` is for tests.
 */
export function rememberedCache(size = 4, tell: (seed: number) => Remembered = rememberedOf): (seed: number) => Remembered {
  const kept = new Map<number, Remembered>(); // insertion order = least recently used first
  return seed => {
    let r = kept.get(seed);
    if (r) kept.delete(seed);
    else r = tell(seed);
    kept.set(seed, r);
    while (kept.size > Math.max(1, size)) kept.delete(kept.keys().next().value!);
    return r;
  };
}

/** The house a deed touches: its doer's (or, with no doer, the one it was done to), for who has a stake in telling it. */
function houseOf(world: World, ev: WorldEvent): string | null {
  const who = world.char(ev.actorId ?? ev.targetId);
  const id = who?.dynastyId ?? (typeof ev.data.dynasty === 'string' ? ev.data.dynasty : null);
  return id ? world.dynasty(id)?.name ?? null : null;
}

/** A fingerprint of the event log: the same seed must always log the same events (tests pin it). */
export function eventLogKey(events: readonly WorldEvent[]): string {
  return events.map(e => `${e.id}|${e.year}|${e.type}|${e.actorId}|${e.targetId}|${e.titleId}|${e.provinceId}`).join('\n');
}

/**
 * The engine's organisations as they stand at the end (#1587): its guilds, academies and companies,
 * as plain data for the road's bridge (organisations.ts). Read off the world after it's lived, so
 * nothing is drawn from World.rng and the event log stays as it was.
 */
export function orgsOf(world: World): HistoryOrg[] {
  // A head the engine names who has since died may be gone from the roster: name them only if known.
  const named = (id: string | null): string | null => (id && world.char(id) ? fullName(world, id) : null);
  return [
    ...[...world.guilds.values()].map(g => ({
      id: g.id, name: g.name, kind: 'guild' as const, craft: g.craft, province: g.provinceId, founded: g.foundedYear, ended: g.disbandedYear,
      members: g.memberIds.length, head: named(g.masterId), monopoly: g.monopolyInventionId ? world.inventions.get(g.monopolyInventionId)?.name ?? null : null,
    })),
    ...[...world.academies.values()].map(a => ({
      id: a.id, name: a.name, kind: 'academy' as const, craft: null, province: a.provinceId, founded: a.foundedYear, ended: a.closedYear,
      members: a.memberIds.length, head: named(a.masterId), monopoly: null,
    })),
    ...[...world.companies.values()].map(c => ({
      id: c.id, name: c.name, kind: 'company' as const, craft: c.kind, province: c.homeProvinceId, founded: c.formedYear, ended: c.disbandedYear,
      members: c.memberCount, head: named(c.captainId), monopoly: null,
    })),
  ];
}

/** "Ivar of Hedlund", the way the engine's chronicle names people. */
function fullName(world: World, id: string): string {
  const c = world.char(id)!;
  const house = world.dynasty(c.dynastyId);
  return house ? `${c.name} of ${house.name}` : c.name;
}

/** The share of a province's land that's scree, fell or snow: rock, not soil. */
function rockShare(reach: Reach, p: Province): number {
  const land = p.cells.filter(i => reach.cells[i].biome !== 'lake' && reach.cells[i].biome !== 'river');
  if (!land.length) return 0;
  return land.filter(i => ['scree', 'fell', 'snow'].includes(reach.cells[i].biome)).length / land.length;
}

const cultureOf = (c: ReachCulture) => REACH_CULTURES.find(s => s.id === c)!;

function weighted<T extends string>(rnd: () => number, options: readonly [T, number][]): T {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [t, w] of options) { if ((r -= w) < 0) return t; }
  return options[options.length - 1][0];
}

/** Borders crossed between every pair of provinces (breadth-first from each). */
function provinceHops(P: readonly Province[]): number[][] {
  const index = new Map(P.map((p, i) => [p.id, i]));
  return P.map((_p, from) => {
    const d = P.map(() => Infinity);
    d[from] = 0;
    let frontier = [from];
    while (frontier.length) {
      const next: number[] = [];
      for (const i of frontier) for (const nb of P[i].neighbors) { const j = index.get(nb)!; if (d[j] === Infinity) { d[j] = d[i] + 1; next.push(j); } }
      frontier = next;
    }
    return d;
  });
}
