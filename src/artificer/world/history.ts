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
import type { WorldEvent } from '../../../storytelling/types';
import type { CharacterSpec, DynastySpec, TitleSpec, WorldSpec } from '../../../storytelling/world-spec';
import { generator, seedOf } from '../rng';
import { generateReach, type Reach } from './reach';
import { provincesOf, type Province, type Provinces } from './provinces';
import { PEOPLES_OF, REACH_CULTURES, REACH_PEOPLES, TITLE_WORDS, cultureName, lawOf, type ReachCulture } from './peoples';
import { HISTORY_VERSION, type ReachHistory } from './history-format';

export { HISTORY_VERSION, type ReachHistory, type ProvinceHistory, type HistoryLine } from './history-format';

/** How long the engine runs. Year 1 is when the oldest houses of the Reach first held land. */
export const HISTORY_YEARS = 150;
/** The last this many years are told event by event ("living memory"); older years as threads. */
export const LIVING_MEMORY = 40;
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
    return { id: `d_${t.id}`, name, culture: p.culture, race: weighted(rnd, PEOPLES_OF[p.culture]) };
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
  return { reach, provinces, world };
}

/** Run the Reach's history for a seed and write it up as plain data. */
export function runHistory(seed: number, years = HISTORY_YEARS): ReachHistory {
  const { provinces, world } = simulateReach(seed, years);
  const { chronicle } = sift(world, TELL_THRESHOLD);
  const arcs = extractArcs(world, chronicle);
  const text = renderLayeredChronicle(world, chronicle, arcs, { living: LIVING_MEMORY, chronicle: years });

  // Which province an event happened in: its own, or the seat of the title it's about.
  const where = (ev: WorldEvent) => ev.provinceId ?? world.title(ev.titleId)?.provinceId ?? null;
  return {
    version: HISTORY_VERSION,
    seed,
    year: world.year,
    provinces: provinces.list.map(p => {
      const title = world.province(p.id)?.titleId ? world.title(world.province(p.id)!.titleId) : undefined;
      const holder = title?.holderId ? world.char(title.holderId) : undefined;
      // One line per deed: the engine often logs a deed twice (a murder, and the kinslaying it was),
      // so keep only the most significant event per person per year.
      const seen = new Set<string>();
      const lines = chronicle
        .filter(ev => where(ev) === p.id)
        .sort((a, b) => b.significance - a.significance || a.id - b.id)
        .filter(ev => { const k = `${ev.year}|${ev.actorId ?? ev.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, LINES_PER_PROVINCE)
        .sort((a, b) => a.year - b.year || a.id - b.id)
        .map(ev => ({ year: ev.year, text: renderEvent(world, ev) }));
      return {
        id: p.id,
        name: p.name,
        culture: cultureName(p.culture),
        title: title?.name ?? p.name,
        holder: holder ? fullName(world, holder.id) : null,
        lines,
      };
    }),
    chronicle: text,
    logged: world.events.length,
    told: chronicle.length,
  };
}

/** A fingerprint of the event log: the same seed must always log the same events (tests pin it). */
export function eventLogKey(events: readonly WorldEvent[]): string {
  return events.map(e => `${e.id}|${e.year}|${e.type}|${e.actorId}|${e.targetId}|${e.titleId}|${e.provinceId}`).join('\n');
}

/** "Ivar of Hedlund", the way the engine's chronicle names people. */
function fullName(world: World, id: string): string {
  const c = world.char(id)!;
  const house = world.dynasty(c.dynastyId);
  return house ? `${c.name} of ${house.name}` : c.name;
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
