// regions.ts — the regional level (#1598): between a province and the realm.
//
// A region is a few neighbouring provinces, a few days across, around a market
// town. Its people share weather, a harvest, a road, a market, their lords'
// quarrels and the news. The province level knows who holds what; the region
// level knows what the countryside talks about: who's rising among the lords,
// whether taxes are heavy, what bread costs, whether the mine is failing, and
// the famine, plague, bandits, hard winter or fair that everyone remembers.
//
// How it fits the engine (docs/regional-level.md has the long version):
//   • Regions are FORMED once, at seed time, from the neighbour graph and the
//     provinces' populations (formRegions). No randomness picks them.
//   • Each year, at the very end of tick(), runRegions READS what the year did
//     (the year's events, harvests, plagues, populations, who holds which
//     title) and keeps a running political and economic state per region.
//     Most regional events are readings of engine events ("a lord seated here
//     died", "famine struck two of its provinces"). A few are the region's own
//     (bandits, a hard winter, a fair, a mine's luck), drawn from the world's
//     separate regional stream (World.regionRng).
//   • Then it PUSHES BACK (pushBack, #1608): a levy thins the provinces whose
//     lords fought, a hard winter and famine cost people and stores (more where
//     the region is poor), bandits rob the roads, trade and prosperity make a
//     province rich or poor (Province.wealth, which World.power reads, so the
//     region's fortunes reach its lords), and a lord's death or a seized seat
//     unsettles its politics, which can turn an old feud into a fresh claim.
//     Its log stays its own (World.regionalEvents) and its randomness its own
//     stream, but the provinces and people it changes are the engine's, so
//     since #1608 the golden hashes include the regional level's consequences.

import { hasTruce } from "./diplomacy.js";
import { carryingCapacity } from "./geography.js";
import { addClaim } from "./inheritance.js";
import { regionalSignificance } from "./sifter.js";
import type {
  CharId,
  EventType,
  Founding,
  HarvestGrade,
  Livelihood,
  Province,
  ProvinceId,
  Region,
  RegionId,
  RegionalCategory,
  RegionalEvent,
  RegionalEventKind,
  Terrain,
  WorldEvent,
} from "./types.js";
import type { World } from "./world.js";

/** About this many provinces per region. The Reach's 11 provinces make 2–3 regions. */
export const PROVINCES_PER_REGION = 4;
/** A region's size, where the world has the provinces for it (owner, 2026-10-11): 3 to 6. */
export const MIN_REGION = 3;
export const MAX_REGION = 6;

// ---------------------------------------------------------------------------
// Forming regions
// ---------------------------------------------------------------------------

/**
 * Group the world's provinces into regions. Deterministic and RNG-free apart
 * from each region's starting venture health (regional stream):
 *
 * 1. Market centres: the most populous provinces, never two next door to each
 *    other (people go to the nearest big market, and two big markets a day
 *    apart would be one region), about one per PROVINCES_PER_REGION provinces.
 * 2. Growth: the smallest region so far claims one unclaimed province that
 *    borders it (preferring one that borders its centre, then the most
 *    populous), and again, until every province is claimed. Always the
 *    smallest, so regions come out much the same size; always a bordering
 *    province, so every region is one piece.
 * 3. A part of the map no centre can reach (an island) gets its own centre.
 * 4. Size, 3 to 6 provinces (MIN_REGION, MAX_REGION): the number of centres is
 *    kept between N/6 and N/3, and a region left under 3 (hemmed in by its
 *    neighbours) takes a bordering province from a neighbour that can spare
 *    one (keeps 3+, stays in one piece, keeps its centre), or else joins a
 *    neighbouring region when the two together are 6 or fewer. A world too
 *    small or too broken up for that (under 3 provinces, an island of 1–2)
 *    keeps its smaller regions.
 */
export function formRegions(w: World): void {
  const P = [...w.provinces.values()];
  if (P.length === 0) return;
  const index = new Map(P.map((p, i) => [p.id, i]));
  const adj = P.map((p) => new Set(p.neighbors.map((n) => index.get(n)).filter((i): i is number => i !== undefined)));

  const target = Math.max(1, Math.min(Math.floor(P.length / MIN_REGION), Math.max(Math.ceil(P.length / MAX_REGION), Math.round(P.length / PROVINCES_PER_REGION))));
  const byPop = P.map((_p, i) => i).sort((a, b) => P[b].population - P[a].population || a - b);
  const centres: number[] = [];
  for (const i of byPop) {
    if (centres.length >= target) break;
    if (centres.every((c) => !adj[c].has(i))) centres.push(i);
  }

  const owner = P.map(() => -1);
  const members: number[][] = centres.map((c, r) => { owner[c] = r; return [c]; });
  for (;;) {
    let claimed = false;
    const order = members.map((_m, r) => r).sort((a, b) => members[a].length - members[b].length || a - b);
    for (const r of order) {
      const centre = members[r][0];
      const candidates = new Set<number>();
      for (const m of members[r]) for (const n of adj[m]) if (owner[n] === -1) candidates.add(n);
      if (candidates.size === 0) continue;
      const pick = [...candidates].sort((a, b) =>
        Number(adj[centre].has(b)) - Number(adj[centre].has(a)) || P[b].population - P[a].population || a - b)[0];
      owner[pick] = r;
      members[r].push(pick);
      claimed = true;
      break; // one claim per round, then the smallest region goes again
    }
    if (claimed) continue;
    const left = byPop.find((i) => owner[i] === -1);
    if (left === undefined) break;
    owner[left] = members.length;
    members.push([left]);
  }
  fixSizes(members, owner, adj, P);

  for (const m of members) {
    if (!m.length) continue; // joined into a neighbour
    const [centreIdx, ...rest] = m;
    const centre = P[centreIdx];
    const provinceIds = [centre.id, ...rest.sort((a, b) => a - b).map((i) => P[i].id)];
    const region = newRegion(w, centre, provinceIds);
    w.regions.set(region.id, region);
    for (const id of provinceIds) w.regionOf.set(id, region.id);
  }
  // Roads: one to each region sharing a border, starting middling.
  for (const r of w.regions.values()) for (const n of neighbourRegions(w, r)) r.roads[n] = 0.4;
}

/**
 * Bring regions under MIN_REGION up to size (step 4 of formRegions): take a
 * bordering province from a neighbour that can spare it, else join a
 * neighbour when the two fit in MAX_REGION. Deterministic: smallest region
 * first, then the most populous province / the smallest neighbour.
 */
function fixSizes(members: number[][], owner: number[], adj: Set<number>[], P: Province[]): void {
  const connected = (m: number[]): boolean => {
    const inside = new Set(m);
    const seen = new Set([m[0]]);
    const stack = [m[0]];
    while (stack.length) for (const n of adj[stack.pop()!]) if (inside.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    return seen.size === m.length;
  };
  for (let guard = 0; guard < P.length * 4; guard++) {
    const small = members
      .map((_m, r) => r)
      .filter((r) => members[r].length > 0 && members[r].length < MIN_REGION)
      .sort((a, b) => members[a].length - members[b].length || a - b);
    if (!small.length) return;
    let changed = false;
    for (const r of small) {
      const m = members[r];
      // Take: a bordering province whose region has some to spare and stays whole.
      const takes: number[] = [];
      for (const i of m) for (const n of adj[i]) {
        const o = owner[n];
        if (o === r || o < 0 || members[o].length <= MIN_REGION || members[o][0] === n) continue;
        if (connected(members[o].filter((x) => x !== n))) takes.push(n);
      }
      if (takes.length) {
        const pick = [...new Set(takes)].sort((a, b) => Number(adj[m[0]].has(b)) - Number(adj[m[0]].has(a)) || P[b].population - P[a].population || a - b)[0];
        const from = owner[pick];
        members[from] = members[from].filter((x) => x !== pick);
        owner[pick] = r;
        m.push(pick);
        changed = true;
        break;
      }
      // Join: the smallest neighbouring region the two fit in; the bigger centre leads.
      const nbrs = [...new Set(m.flatMap((i) => [...adj[i]].map((n) => owner[n])))].filter((o) => o !== r && o >= 0 && members[o].length + m.length <= MAX_REGION);
      if (nbrs.length) {
        const o = nbrs.sort((a, b) => members[a].length - members[b].length || a - b)[0];
        const [keep, gone] = P[members[o][0]].population >= P[m[0]].population ? [o, r] : [r, o];
        for (const i of members[gone]) owner[i] = keep;
        members[keep].push(...members[gone]);
        members[gone] = [];
        changed = true;
        break;
      }
    }
    if (!changed) return;
  }
}

// How well each kind of land suits each livelihood (0..1-ish). Farming also
// scales with fertility; mining with the rock there is (mineralWealth).
const FARM: Record<Terrain, number> = {
  meadow: 1.1, plains: 1.0, coast: 0.7, forest: 0.55, hills: 0.5, steppe: 0.5, swamp: 0.4, jungle: 0.4, mountain: 0.2, desert: 0.1,
};
const LUMBER: Partial<Record<Terrain, number>> = { forest: 0.9, jungle: 0.7, swamp: 0.2, hills: 0.2 };
const MINING: Partial<Record<Terrain, number>> = { mountain: 0.9, hills: 0.6, desert: 0.2 };
const HERDING: Partial<Record<Terrain, number>> = { steppe: 0.9, hills: 0.6, plains: 0.45, meadow: 0.4, mountain: 0.4 };
const PEAT: Partial<Record<Terrain, number>> = { swamp: 0.6 };

/** How well a province suits each livelihood the land can give (not `trading`). */
export function livelihoodScores(p: Province): Record<Exclude<Livelihood, "trading">, number> {
  const t = p.terrain;
  return {
    farming: p.subsurface ? 0 : p.fertility * FARM[t],
    lumber: p.subsurface ? 0 : LUMBER[t] ?? 0,
    mining: p.subsurface ? 0.5 + p.mineralWealth : Math.max(MINING[t] ?? 0, p.mineralWealth),
    fishing: p.subsurface ? 0 : Math.max(p.coastal ? 0.95 : 0, p.lake ? 0.85 : 0, p.riverConnected ? 0.35 : 0, t === "swamp" ? 0.3 : 0),
    herding: p.subsurface ? 0 : HERDING[t] ?? 0,
    peat: p.subsurface ? 0 : PEAT[t] ?? 0,
  };
}

const VENTURE_OF: Record<Exclude<Livelihood, "trading">, string> = {
  farming: "mill", lumber: "lumber camp", mining: "mine", fishing: "fishery", herding: "wool trade", peat: "peat cuttings",
};

function newRegion(w: World, centre: Province, provinceIds: ProvinceId[]): Region {
  const provs = provinceIds.map((id) => w.province(id)!);
  // Each province lives on what its land suits best; the market town lives on
  // its market. Where a province's second-best trade is nearly as good (within
  // 80%) and its best is already the trade of another province in the region,
  // it takes the second, so a region's villages differ where the land allows
  // (owner, #1585 Q5: each village its own economic engine).
  const livelihoods: Record<ProvinceId, Livelihood> = { [centre.id]: "trading" };
  const used = new Set<Livelihood>();
  for (const p of provs.slice(1)) {
    const ranked = (Object.entries(livelihoodScores(p)) as [Livelihood, number][]).sort((a, b) => b[1] - a[1]);
    const [best, second] = ranked;
    const pick = used.has(best[0]) && second && second[1] > 0 && second[1] >= best[1] * 0.8 && !used.has(second[0]) ? second[0] : best[0];
    livelihoods[p.id] = pick;
    used.add(pick);
  }
  // Secondary trades: what else the land supports well (at least 0.4, and at
  // least half its best), besides what it lives on. Founding: what the place
  // grew up around: a market town on a river at its ford, else its land's best
  // trade (before the region's villages spread out over different trades).
  const secondary: Record<ProvinceId, Livelihood[]> = {};
  const founding: Record<ProvinceId, Founding> = {};
  for (const p of provs) {
    const ranked = (Object.entries(livelihoodScores(p)) as [Exclude<Livelihood, "trading">, number][]).sort((a, b) => b[1] - a[1]);
    const top = ranked[0][1];
    secondary[p.id] = ranked.filter(([k, v]) => k !== livelihoods[p.id] && v >= 0.4 && v >= top * 0.5).slice(0, 2).map(([k]) => k);
    founding[p.id] = p.id === centre.id && p.riverConnected ? "crossing" : ranked[0][0];
  }
  // What the region as a whole lives on: the land's best trade weighted by how
  // many people work each province (the market town included: its hinterland).
  const totals = new Map<Livelihood, number>();
  for (const p of provs) for (const [k, s] of Object.entries(livelihoodScores(p)) as [Livelihood, number][]) totals.set(k, (totals.get(k) ?? 0) + s * p.population);
  const primary = [...totals.entries()].sort((a, b) => b[1] - a[1])[0][0] as Exclude<Livelihood, "trading">;
  // The venture sits where the primary trade is strongest, outside the market town if it can.
  const venueOrder = [...provs.slice(1), provs[0]];
  const venue = venueOrder.reduce((best, p) => (livelihoodScores(p)[primary] > livelihoodScores(best)[primary] ? p : best), venueOrder[0]);
  const health = 0.45 + w.regionRng.next() * 0.3;

  const region: Region = {
    id: `r_${centre.id}`,
    name: centre.name,
    centreId: centre.id,
    provinceIds,
    livelihoods,
    secondary,
    founding,
    primary,
    venture: { kind: VENTURE_OF[primary], provinceId: venue.id, health, state: health >= 0.75 ? "thriving" : "steady", since: w.year },
    prosperity: 0.5,
    price: 1,
    harvest: "fair",
    roads: {},
    levy: 0,
    tax: 0.2,
    houses: {},
    leadingHouse: null,
    feuds: {},
    unsettled: 0,
    flags: {},
  };
  const standing = houseStanding(w, region);
  region.houses = standing.houses;
  region.leadingHouse = standing.leading;
  return region;
}

/** Regions sharing a border with this one, in region order. */
export function neighbourRegions(w: World, r: Region): RegionId[] {
  const out = new Set<RegionId>();
  for (const pid of r.provinceIds) for (const n of w.province(pid)?.neighbors ?? []) {
    const other = w.regionOf.get(n);
    if (other && other !== r.id) out.add(other);
  }
  return [...w.regions.keys()].filter((id) => out.has(id));
}

/** "the Hollowford country": how people name a region after its market town (until nameRegions names it). */
export function regionLabel(r: Pick<Region, "name" | "label">): string {
  return r.label ?? `the ${r.name} country`;
}

// ---------------------------------------------------------------------------
// Naming regions (owner, 2026-10-11): a region is called after what matters
// most in it, which its history decides: its market town, a mine or other
// trade it's known for, a hero, a hardship, or a quarrel. So it's named once,
// after the history is lived, from its own log and state, not at formation
// (then only the land is known: no heroes, famines or quarrels yet).
//
// What a region is known for is what sets it apart from its neighbours: over
// 150 years every region has feuds and lean years, so a quarrel or hardship
// names only the region that had clearly the most of it. Each kind of name is
// given once in the world, the strongest claim first, and at least half the
// regions keep their market town's name, so travellers can still find their
// way. No randomness (no World.rng, no regional stream); display only: the
// region's id, and every fact key built on it, stays as it was.
// ---------------------------------------------------------------------------

/** The market town's own score: another name must beat it. */
const MARKET_SCORE = 5;

const LAND_WORD: Record<Terrain, string> = {
  meadow: "Meads", plains: "Fields", hills: "Hills", forest: "Woods", swamp: "Fens", mountain: "Fells",
  steppe: "Downs", coast: "Shore", desert: "Sands", jungle: "Wilds",
};
/** Names for a region known for its trade, best first (the second if the first is taken). */
const TRADE_NAMES: Record<Exclude<Livelihood, "trading">, (venue: string) => string[]> = {
  mining: (v) => ["the Ironvein", `the ${v} Vein`],
  lumber: (v) => ["the Timberwold", `the ${v} Wold`],
  fishing: (v) => ["the Netwater", `the ${v} Water`],
  herding: (v) => ["the Sheepwalks", `the ${v} Walks`],
  peat: (v) => ["the Peatmoors", `the ${v} Moors`],
  farming: (v) => ["the Golden Fields", `the ${v} Fields`],
};

export type RegionNameKind = "hero" | "quarrel" | "hardship" | "trade" | "market";
export interface RegionNameCandidate { regionId: RegionId; kind: RegionNameKind; score: number; names: string[] }

/** Every name each region could go by, with its score, strongest first. */
export function regionNameCandidates(w: World): RegionNameCandidate[] {
  const regions = [...w.regions.values()];
  const tally = (r: Region, ...kinds: RegionalEventKind[]) => w.regionalEvents.filter((e) => e.regionId === r.id && kinds.includes(e.kind)).length;
  const fights = new Map(regions.map((r) => [r.id, tally(r, "FEUD", "BORDER_WAR")]));
  // A famine counts double: it's rarer than plague.
  const hard = new Map(regions.map((r) => [r.id, tally(r, "FAMINE") * 2 + tally(r, "PLAGUE")]));
  const mean = (m: Map<RegionId, number>) => [...m.values()].reduce((a, b) => a + b, 0) / Math.max(1, m.size);
  const fightMean = mean(fights), hardMean = mean(hard);
  const out: RegionNameCandidate[] = [];

  for (const r of regions) {
    const centre = w.province(r.centreId);
    const land = centre ? LAND_WORD[centre.terrain] : "Lands";
    // A hero: someone born to no house who seized a seat here, and whose house
    // still holds land in the region. People name the land after them.
    const hero = w.regionalEvents.find((e) => e.regionId === r.id && e.kind === "SEAT_SEIZED" && e.data["lowborn"] && e.actorId
      && (r.houses[w.char(e.actorId)?.dynastyId ?? ""] ?? 0) > 0);
    // Or a hero of the engine's own (HERO_RISEN, worlds with magic), risen here: read, not drawn.
    const risen = w.events.find((e) => e.type === "HERO_RISEN" && e.actorId && e.provinceId && r.provinceIds.includes(e.provinceId));
    const heroId = risen?.actorId ?? hero?.actorId ?? null;
    const first = heroId ? (w.char(heroId)?.name ?? "").replace(/\s+[IVXLC]+$/, "") : "";
    if (first) out.push({ regionId: r.id, kind: "hero", score: 7, names: [`${first}'s Land`, `the Land of ${first}`] });
    // A quarrel or a hardship: only clearly more than the world's usual (half again the mean).
    const f = fights.get(r.id)!;
    if (f >= 5 && f >= fightMean * 1.5) out.push({ regionId: r.id, kind: "quarrel", score: 4 + 2 * f / Math.max(1, fightMean), names: ["the Marches of Old Feud", "the Feuding March"] });
    const h = hard.get(r.id)!;
    if (h >= 4 && h >= hardMean * 1.5) {
      const famine = tally(r, "FAMINE") * 2 >= tally(r, "PLAGUE");
      out.push({ regionId: r.id, kind: "hardship", score: 4 + 2 * h / Math.max(1, hardMean), names: famine ? [`the Lean ${land}`, `the Hungry ${land}`] : [`the Pale ${land}`, `the Fever ${land}`] });
    }
    // Its trade: a venture thriving now, or a working mine (a landmark people know from afar).
    const venue = w.province(r.venture.provinceId)?.name ?? r.name;
    const primary = r.primary as Exclude<Livelihood, "trading">;
    if (r.venture.state === "thriving") out.push({ regionId: r.id, kind: "trade", score: 5.5, names: TRADE_NAMES[primary](venue) });
    else if (primary === "mining" && r.venture.state !== "closed") out.push({ regionId: r.id, kind: "trade", score: 5.2, names: TRADE_NAMES.mining(venue) });
    out.push({ regionId: r.id, kind: "market", score: MARKET_SCORE, names: [`the ${r.name} country`] });
  }
  return out.sort((a, b) => b.score - a.score || a.regionId.localeCompare(b.regionId));
}

/**
 * Name every region from its history (sets `Region.label`). Called once the
 * history is lived (the Artificer's simulateReach), never during it: it only
 * reads, so the event log and every hash stay as they are. Strongest claim
 * first; each kind but the market town's once; names unique; at least half
 * the regions (rounded up) keep their market town's name.
 */
export function nameRegions(w: World): void {
  const special = Math.floor(w.regions.size / 2);
  const usedKinds = new Set<RegionNameKind>();
  const taken = new Set<string>();
  let given = 0;
  for (const c of regionNameCandidates(w)) {
    const r = w.regions.get(c.regionId)!;
    if (r.label) continue;
    if (c.kind !== "market" && (usedKinds.has(c.kind) || given >= special || c.score <= MARKET_SCORE)) continue;
    const name = c.names.find((n) => !taken.has(n));
    if (!name) continue;
    r.label = name;
    taken.add(name);
    if (c.kind !== "market") { usedKinds.add(c.kind); given++; }
  }
  for (const r of w.regions.values()) r.label ??= `the ${r.name} country`;
}

// ---------------------------------------------------------------------------
// The yearly pass
// ---------------------------------------------------------------------------

const UNREST: ReadonlySet<EventType> = new Set<EventType>([
  "FOOD_RIOT", "MARKETPLACE_RIOT", "PEASANT_REVOLT", "BREAD_RIOT", "TAX_REVOLT", "URBAN_MOB_RIOT", "TAX_COLLECTOR_LYNCHED", "PEASANT_JACQUERIE",
]);
const BANDITS: ReadonlySet<EventType> = new Set<EventType>(["HIGHWAY_ROBBER_LEGEND", "BANDIT_KING_RISES", "MASS_JAILBREAK"]);
const FAIRS: ReadonlySet<EventType> = new Set<EventType>(["GREAT_MARKET_FAIR", "GRAND_FAIR"]);
const ARRIVALS: ReadonlySet<EventType> = new Set<EventType>([
  "REFUGEES_ARRIVE", "SETTLED_NEW_HOMELAND", "BARBARIAN_INVASION", "DIASPORA_FORMED",
  "LOST_ROMAN_LEGION", "LOST_VIKING_EXPEDITION", "LOST_MONGOL_TUMEN", "LOST_GREEK_HOPLITES", "LOST_EGYPTIAN_PRIESTHOOD",
  "LOST_CELTIC_WARBAND", "LOST_SAMURAI_RETINUE", "LOST_BYZANTINE_CATAPHRACTS", "LOST_PERSIAN_IMMORTALS",
  "LOST_CARTHAGINIAN_FLEET", "LOST_NORMAN_KNIGHTS", "LOST_HAN_EXPEDITION",
]);

const CATEGORY: Record<RegionalEventKind, RegionalCategory> = {
  LORD_DIED: "politics", SEAT_VACANT: "politics", SEAT_SEIZED: "politics", HOUSE_RISES: "politics", HOUSE_FALLS: "politics",
  FEUD: "politics", FEUD_FLARES: "politics", BORDER_WAR: "politics", ALLIANCE: "politics", LEVY_RAISED: "politics", TAXES_RAISED: "politics", TAXES_EASED: "politics",
  HARVEST_GOOD: "economy", HARVEST_POOR: "economy", SHORTAGE: "economy", BOOM: "economy", SLUMP: "economy",
  VENTURE_OPENED: "economy", VENTURE_THRIVES: "economy", VENTURE_FAILING: "economy", VENTURE_CLOSED: "economy",
  ROAD_THRIVES: "economy", ROAD_FAILS: "economy",
  FAMINE: "event", PLAGUE: "event", BANDITRY: "event", HARD_WINTER: "event", FAIR: "event", FESTIVAL: "event", MIGRATION: "event", UNREST: "event",
};

type Emit = Partial<Omit<RegionalEvent, "id" | "year" | "regionId" | "kind" | "category" | "significance">>;

function emit(w: World, r: Region, kind: RegionalEventKind, f: Emit = {}): RegionalEvent {
  const data = f.data ?? {};
  return w.logRegional({
    regionId: r.id,
    kind,
    category: CATEGORY[kind],
    provinceId: f.provinceId ?? null,
    actorId: f.actorId ?? null,
    targetId: f.targetId ?? null,
    titleId: f.titleId ?? null,
    otherRegionId: f.otherRegionId ?? null,
    causeEventId: f.causeEventId ?? null,
    data,
    significance: regionalSignificance(kind, data),
  });
}

/** What happened to a region this year, gathered before any region acts (migration reads its neighbours'). */
interface YearSummary {
  year: readonly WorldEvent[]; // all of this year's engine events (shared by every region)
  events: WorldEvent[]; // this year's engine events that happened in the region
  famine: WorldEvent[];
  plagued: ProvinceId[];
  wars: WorldEvent[]; // wars fought over one of its titles
  inWar: Set<CharId>; // its lords who fought this year (anywhere)
  banditry: boolean;
  hardWinter: boolean;
  // For pushBack (#1608): how the region stood going into the year, and where this year's trouble fell.
  prosperityBefore: number;
  winterEvent: RegionalEvent | null;
  banditSpot: ProvinceId | null;
  news: RegionalEvent[]; // this year's regional events in the region
}

/**
 * One year of the regional level. `evStart` is where this year's engine events
 * begin in World.events (tick() passes it). Draws only from World.regionRng.
 */
export function runRegions(w: World, evStart: number): void {
  if (w.regions.size === 0) return;
  adoptStrays(w);
  const yearEvents = w.events.slice(evStart);
  const regStart = w.regionalEvents.length;
  const frost = yearEvents.find((e) => e.type === "GREAT_FROST");

  const summary = new Map<RegionId, YearSummary>();
  for (const r of w.regions.values()) summary.set(r.id, {
    year: yearEvents, events: [], famine: [], plagued: [], wars: [], inWar: new Set(), banditry: false, hardWinter: false,
    prosperityBefore: r.prosperity, winterEvent: null, banditSpot: null, news: [],
  });
  for (const ev of yearEvents) {
    const rid = regionOfEvent(w, ev);
    if (rid) {
      const s = summary.get(rid)!;
      s.events.push(ev);
      if (ev.type === "FAMINE") s.famine.push(ev);
      if (ev.type === "WAR") s.wars.push(ev);
    }
    if (ev.type === "WAR") {
      for (const who of [ev.actorId, ev.targetId]) if (who) for (const t of w.titlesHeldBy(who)) {
        const tr = w.regionOf.get(t.provinceId);
        if (tr) summary.get(tr)!.inWar.add(who);
      }
    }
  }
  for (const r of w.regions.values()) {
    const s = summary.get(r.id)!;
    s.plagued = r.provinceIds.filter((id) => w.province(id)?.plaguedYear === w.year);
  }

  for (const r of w.regions.values()) {
    const s = summary.get(r.id)!;
    politicsFromEvents(w, r, s);
    weatherAndBandits(w, r, s, frost);
    economy(w, r, s);
    gatherings(w, r, s, summary);
    standingAndDues(w, r, s);
  }
  roads(w, summary);

  // Last, the region pushes back into the simulation (#1608), once every
  // region has read the year and the roads are updated.
  for (const ev of w.regionalEvents.slice(regStart)) summary.get(ev.regionId)?.news.push(ev);
  for (const r of w.regions.values()) {
    const s = summary.get(r.id)!;
    pushBack(w, r, {
      levyLords: [...s.inWar],
      hardWinter: s.hardWinter,
      winterEvent: s.winterEvent,
      famine: s.famine.map((e) => e.provinceId).filter((id): id is ProvinceId => !!id),
      bandits: s.banditry ? s.banditSpot : null,
      prosperityBefore: s.prosperityBefore,
      news: s.news,
    });
  }
}

/** A province added after seeding (none are today) joins a bordering region, or starts its own. */
function adoptStrays(w: World): void {
  for (const p of w.provinces.values()) {
    if (w.regionOf.has(p.id)) continue;
    const home = p.neighbors.map((n) => w.regionOf.get(n)).find((r): r is RegionId => !!r);
    if (home) {
      const r = w.regions.get(home)!;
      r.provinceIds.push(p.id);
      r.livelihoods[p.id] = bestLivelihood(p);
      w.regionOf.set(p.id, home);
    } else {
      const r = newRegion(w, p, [p.id]);
      w.regions.set(r.id, r);
      w.regionOf.set(p.id, r.id);
    }
  }
}

function bestLivelihood(p: Province): Livelihood {
  return (Object.entries(livelihoodScores(p)) as [Livelihood, number][]).sort((a, b) => b[1] - a[1])[0][0];
}

/** The region an engine event happened in: its province, else its title's seat. */
export function regionOfEvent(w: World, ev: WorldEvent): RegionId | null {
  const pid = ev.provinceId ?? w.title(ev.titleId)?.provinceId ?? null;
  return pid ? w.regionOf.get(pid) ?? null : null;
}

function politicsFromEvents(w: World, r: Region, s: YearSummary): void {
  // A lord holding three seats in the region dies once, not three times: the
  // engine logs a succession per title, the region tells it once and counts the
  // seats (`seats`). Same for a vacancy, a seizure or a war by the same people.
  const told = new Map<string, RegionalEvent>();
  const once = (ev: WorldEvent): boolean => {
    const key = `${ev.type}|${ev.actorId}|${ev.targetId}`;
    const prior = told.get(key);
    if (prior) { prior.data["seats"] = Number(prior.data["seats"] ?? 1) + 1; return false; }
    return true;
  };
  const remember = (ev: WorldEvent, re: RegionalEvent) => told.set(`${ev.type}|${ev.actorId}|${ev.targetId}`, re);
  for (const ev of s.events) {
    if (["SUCCESSION", "SUCCESSION_CRISIS", "USURP", "LOWBORN_RISE", "WAR"].includes(ev.type) && !once(ev)) continue;
    const before = w.regionalEvents.length;
    switch (ev.type) {
      case "SUCCESSION":
        emit(w, r, "LORD_DIED", { actorId: ev.actorId, targetId: ev.targetId, titleId: ev.titleId, provinceId: w.title(ev.titleId)?.provinceId ?? null, causeEventId: ev.id, data: { tier: w.title(ev.titleId)?.tier ?? "county" } });
        break;
      case "SUCCESSION_CRISIS":
        emit(w, r, "SEAT_VACANT", { targetId: ev.targetId, titleId: ev.titleId, provinceId: w.title(ev.titleId)?.provinceId ?? null, causeEventId: ev.id });
        break;
      case "USURP":
      case "LOWBORN_RISE":
        emit(w, r, "SEAT_SEIZED", { actorId: ev.actorId, targetId: ev.targetId, titleId: ev.titleId, provinceId: w.title(ev.titleId)?.provinceId ?? ev.provinceId, causeEventId: ev.id, data: { lowborn: ev.type === "LOWBORN_RISE" } });
        break;
      case "WAR": {
        const attacker = w.char(ev.actorId), defender = w.char(ev.targetId);
        const local = !!attacker && w.titlesHeldBy(attacker.id).some((t) => w.regionOf.get(t.provinceId) === r.id);
        const data = { attacker_won: !!ev.data["attacker_won"] };
        if (local && attacker && defender) {
          const key = [attacker.dynastyId, defender.dynastyId].sort().join("|");
          r.feuds[key] = w.year;
          emit(w, r, "FEUD", { actorId: ev.actorId, targetId: ev.targetId, titleId: ev.titleId, provinceId: ev.provinceId, causeEventId: ev.id, data });
        } else {
          emit(w, r, "BORDER_WAR", { actorId: ev.actorId, targetId: ev.targetId, titleId: ev.titleId, provinceId: ev.provinceId, causeEventId: ev.id, data });
        }
        break;
      }
      default:
        if (UNREST.has(ev.type)) emit(w, r, "UNREST", { provinceId: ev.provinceId, actorId: ev.actorId, causeEventId: ev.id, data: { cause: ev.type } });
    }
    if (w.regionalEvents.length > before) remember(ev, w.regionalEvents[w.regionalEvents.length - 1]);
  }
}

function weatherAndBandits(w: World, r: Region, s: YearSummary, frost: WorldEvent | undefined): void {
  const rng = w.regionRng;
  // Hard winter: the engine's GREAT_FROST reaches everywhere; otherwise about
  // one winter in fifteen, more in the mountains and in a cold climate phase.
  const mountains = r.provinceIds.filter((id) => w.province(id)?.terrain === "mountain").length / r.provinceIds.length;
  const pWinter = 0.05 + 0.06 * mountains + (w.climate.phase === "cold" ? 0.08 : 0);
  const winterRoll = rng.next();
  if (frost || (w.year - (r.flags.winter ?? -99) >= 3 && winterRoll < pWinter)) {
    r.flags.winter = w.year;
    s.hardWinter = true;
    s.winterEvent = emit(w, r, "HARD_WINTER", { causeEventId: frost?.id ?? null });
  }
  // Banditry: worse when times are hard, the men are away at war, or a seat is
  // empty or held by a child. The engine's own outlaws count too.
  const engineBandit = s.events.find((e) => BANDITS.has(e.type));
  const weak = r.provinceIds.some((id) => {
    const t = w.title(w.province(id)?.titleId ?? null);
    const h = w.char(t?.holderId ?? null);
    return !!t && (!h || w.age(h) < 16);
  });
  // An unsettled region (lords dying, seats changing hands) is easier for outlaws too (#1608).
  const pBandits = 0.02 + 0.15 * (1 - r.prosperity) ** 2 + 0.1 * r.levy + (weak ? 0.05 : 0) + FEEDBACK.unsettledBandits * r.unsettled;
  const banditRoll = rng.next();
  const spot = rng.pick(r.provinceIds.length > 1 ? r.provinceIds.slice(1) : r.provinceIds);
  if (engineBandit || (w.year - (r.flags.bandits ?? -99) >= 4 && banditRoll < pBandits)) {
    r.flags.bandits = w.year;
    s.banditry = true;
    s.banditSpot = engineBandit?.provinceId ?? spot;
    emit(w, r, "BANDITRY", { provinceId: engineBandit?.provinceId ?? spot, actorId: engineBandit?.actorId ?? null, causeEventId: engineBandit?.id ?? null, data: { named: !!engineBandit } });
  }
}

const gradeOf = (food: number): HarvestGrade =>
  food >= 1.22 ? "bumper" : food >= 1.08 ? "good" : food >= 0.85 ? "fair" : food >= 0.7 ? "poor" : "failed";

function economy(w: World, r: Region, s: YearSummary): void {
  const rng = w.regionRng;
  const provs = r.provinceIds.map((id) => w.province(id)!).filter(Boolean);
  const fields = provs.filter((p) => !p.subsurface);
  const food = fields.length ? fields.reduce((a, p) => a + (p.lastHarvest ?? 1), 0) / fields.length : 1;
  const cap = provs.reduce((a, p) => a + carryingCapacity(p), 0);
  const crowding = cap > 0 ? provs.reduce((a, p) => a + p.population, 0) / cap : 1;
  r.harvest = gradeOf(food);

  // Famine and plague: told once per region, however many of its provinces suffered.
  if (s.famine.length) {
    emit(w, r, "FAMINE", {
      provinceId: s.famine.length === 1 ? s.famine[0].provinceId : null,
      causeEventId: s.famine[0].id,
      data: { deaths: s.famine.reduce((a, e) => a + Number(e.data["deaths"] ?? 0), 0), provinces: s.famine.length },
    });
  }
  if (s.plagued.length) {
    const cause = s.year.find((e) => e.type === "PLAGUE");
    emit(w, r, "PLAGUE", { provinceId: s.plagued.length === 1 ? s.plagued[0] : null, causeEventId: cause?.id ?? null, data: { provinces: s.plagued.length, of: r.provinceIds.length } });
  }

  // Bread: dear when the harvest is short or the land is crowded, dearer after a hard winter.
  r.price = round2(clamp((0.75 + 0.35 * crowding) / Math.max(0.45, food) + (s.hardWinter ? 0.2 : 0), 0.5, 3));
  if (!s.famine.length) {
    if (r.harvest === "bumper") emit(w, r, "HARVEST_GOOD", { data: { yield: round2(food) } });
    else if (r.harvest === "failed" || (r.harvest === "poor" && r.price >= 1.4)) emit(w, r, "HARVEST_POOR", { data: { yield: round2(food) } });
    if (r.price >= 1.5 && !r.flags.dear) { r.flags.dear = 1; emit(w, r, "SHORTAGE", { data: { price: r.price } }); }
  }
  if (r.price < 1.2) r.flags.dear = 0;

  // The venture's luck: a random walk nudged by the times, hurt by war at its
  // door, plague and bandits on its road.
  const v = r.venture;
  const drift = rng.gaussian(0, 0.05);
  const reopen = rng.next();
  if (v.state === "closed") {
    if (w.year - v.since >= 8 && reopen < 0.06) {
      Object.assign(v, { health: 0.5, state: "steady", since: w.year });
      emit(w, r, "VENTURE_OPENED", { provinceId: v.provinceId, data: { venture: v.kind } });
    }
  } else {
    const warHere = s.wars.some((e) => e.provinceId === v.provinceId);
    v.health = clamp(v.health + drift + 0.06 * (r.prosperity - 0.5) - (warHere ? 0.08 : 0) - (s.plagued.length ? 0.08 : 0) - (s.banditry ? 0.04 : 0), 0, 1);
    const was = v.state;
    if (v.health >= 0.75 && was !== "thriving") v.state = "thriving";
    else if (v.health <= 0.25 && was !== "failing") v.state = "failing";
    else if (was === "thriving" && v.health < 0.6) v.state = "steady";
    else if (was === "failing" && v.health > 0.4) v.state = "steady";
    if (v.state === "failing" && v.health <= 0.05 && w.year - v.since >= 3) v.state = "closed";
    if (v.state !== was) {
      v.since = w.year;
      const kind: RegionalEventKind | null =
        v.state === "thriving" ? "VENTURE_THRIVES" : v.state === "failing" ? "VENTURE_FAILING" : v.state === "closed" ? "VENTURE_CLOSED" : null;
      if (kind) emit(w, r, kind, { provinceId: v.provinceId, data: { venture: v.kind } });
    }
  }

  // Prosperity eases toward what the year would support: the harvest, room on
  // the land, the venture, the roads; less for levies, plague, famine, a hard
  // winter, war over its seats and bandits.
  const roadsAvg = avg(Object.values(r.roads), 0.4);
  const target =
    0.5 + 0.8 * (food - 1) + 0.3 * (0.8 - crowding) + 0.25 * (v.state === "closed" ? -0.3 : v.health - 0.5) + 0.15 * (roadsAvg - 0.4)
    - 0.3 * r.levy - (s.plagued.length ? 0.2 : 0) - (s.famine.length ? 0.15 : 0) - (s.hardWinter ? 0.08 : 0)
    - (s.wars.length ? 0.1 : 0) - (s.banditry ? 0.05 : 0) - FEEDBACK.unsettledProsperity * r.unsettled;
  r.prosperity = round3(clamp(r.prosperity + (target - r.prosperity) * 0.35, 0, 1));
  if (r.prosperity >= 0.68 && !r.flags.boom) { r.flags.boom = 1; emit(w, r, "BOOM", { data: { prosperity: r.prosperity } }); }
  if (r.prosperity < 0.58) r.flags.boom = 0;
  if (r.prosperity <= 0.32 && !r.flags.slump) { r.flags.slump = 1; emit(w, r, "SLUMP", { data: { prosperity: r.prosperity } }); }
  if (r.prosperity > 0.42) r.flags.slump = 0;
}

function gatherings(w: World, r: Region, s: YearSummary, all: Map<RegionId, YearSummary>): void {
  const rng = w.regionRng;
  for (const ev of s.events) {
    if (ev.type === "FESTIVAL_HELD") emit(w, r, "FESTIVAL", { provinceId: ev.provinceId, causeEventId: ev.id });
    if (ARRIVALS.has(ev.type)) emit(w, r, "MIGRATION", { provinceId: ev.provinceId, actorId: ev.actorId, causeEventId: ev.id, data: { cause: ev.type } });
  }
  // A fair at the market town: in good, quiet years, every seven or more.
  const engineFair = s.events.find((e) => FAIRS.has(e.type));
  const quiet = !s.wars.length && !s.famine.length && !s.plagued.length;
  const fairRoll = rng.next();
  if (engineFair || (quiet && r.prosperity >= 0.6 && w.year - (r.flags.fair ?? -99) >= 7 && fairRoll < 0.3)) {
    r.flags.fair = w.year;
    emit(w, r, "FAIR", { provinceId: r.centreId, causeEventId: engineFair?.id ?? null });
  }
  // People on the move: from a neighbouring region in a bad year (famine,
  // plague, its lords at war) to this one if it's doing well enough.
  for (const n of neighbourRegions(w, r)) {
    const ns = all.get(n)!;
    const bad = ns.famine.length > 0 || ns.plagued.length > 0 || ns.wars.length > 0;
    const roll = rng.next();
    if (bad && r.prosperity >= 0.5 && w.year - (r.flags.migrants ?? -99) >= 5 && roll < 0.35) {
      r.flags.migrants = w.year;
      const why = ns.famine.length ? "famine" : ns.plagued.length ? "plague" : "war";
      emit(w, r, "MIGRATION", { otherRegionId: n, data: { cause: why } });
    }
  }
}

function standingAndDues(w: World, r: Region, s: YearSummary): void {
  // Levies: called up when its lords go to war, home again over a few years.
  r.levy *= 0.55;
  if (s.inWar.size) {
    if (r.levy < 0.2) {
      const lord = [...s.inWar][0];
      const war = s.year.find((e) => e.type === "WAR" && (e.actorId === lord || e.targetId === lord));
      emit(w, r, "LEVY_RAISED", { actorId: lord, titleId: war?.titleId ?? null, causeEventId: war?.id ?? null });
    }
    r.levy = Math.min(1, r.levy + 0.3 * s.inWar.size);
  }
  r.levy = round3(r.levy);

  // Alliances and unions: the region of either party's seats hears of it.
  for (const ev of s.year) {
    if (ev.type !== "ALLIANCE_FORMED" && ev.type !== "DYNASTIC_UNION_FORMED") continue;
    const here = [ev.actorId, ev.targetId].some((c) => c && w.titlesHeldBy(c).some((t) => w.regionOf.get(t.provinceId) === r.id));
    if (here) emit(w, r, "ALLIANCE", { actorId: ev.actorId, targetId: ev.targetId, causeEventId: ev.id, data: { union: ev.type === "DYNASTIC_UNION_FORMED" } });
  }

  // Who's rising and falling among the houses holding its seats.
  const before = r.houses, leadBefore = r.leadingHouse;
  const { houses, leading } = houseStanding(w, r);
  for (const d of Object.keys(before)) {
    if (before[d] > 0 && !houses[d]) emit(w, r, "HOUSE_FALLS", { data: { dynasty: d, house: w.dynasty(d)?.name ?? d } });
  }
  if (leading && leading !== leadBefore) emit(w, r, "HOUSE_RISES", { data: { dynasty: leading, house: w.dynasty(leading)?.name ?? leading, from: leadBefore ? w.dynasty(leadBefore)?.name ?? leadBefore : "" } });
  r.houses = houses;
  r.leadingHouse = leading;

  // Dues: greedy lords tax harder, war needs paying for, and hard times squeeze.
  const lords = r.provinceIds.map((id) => w.char(w.title(w.province(id)?.titleId ?? null)?.holderId ?? null)).filter((c): c is NonNullable<typeof c> => !!c);
  const greed = avg(lords.map((c) => c.drives.greed), 0.5);
  const target = 0.12 + 0.3 * greed + 0.35 * r.levy + (r.prosperity < 0.35 ? 0.1 : 0);
  r.tax = round3(r.tax + (target - r.tax) * 0.5);
  if (r.tax >= 0.45 && !r.flags.taxHigh) { r.flags.taxHigh = 1; emit(w, r, "TAXES_RAISED", { data: { tax: r.tax } }); }
  if (r.tax < 0.33 && r.flags.taxHigh) { r.flags.taxHigh = 0; emit(w, r, "TAXES_EASED", { data: { tax: r.tax } }); }
}

/** Titles seated in the region held by each house, and the leading house (most seats; ties: the higher title, then the earlier seat). */
export function houseStanding(w: World, r: Region): { houses: Record<string, number>; leading: string | null } {
  const houses: Record<string, number> = {};
  const rank: Record<string, number> = {};
  const tierRank = { county: 1, duchy: 2, kingdom: 3 } as const;
  r.provinceIds.forEach((pid, i) => {
    for (const t of w.titles.values()) {
      if (t.provinceId !== pid) continue;
      const h = w.char(t.holderId);
      if (!h) continue;
      houses[h.dynastyId] = (houses[h.dynastyId] ?? 0) + 1;
      rank[h.dynastyId] = Math.max(rank[h.dynastyId] ?? 0, tierRank[t.tier] * 100 - i);
    }
  });
  const leading = Object.keys(houses).sort((a, b) => houses[b] - houses[a] || rank[b] - rank[a] || (a < b ? -1 : 1))[0] ?? null;
  return { houses, leading };
}

/** Road trade between neighbouring regions: busy when both ends prosper and the road is safe. */
function roads(w: World, summary: Map<RegionId, YearSummary>): void {
  for (const r of w.regions.values()) {
    for (const nid of Object.keys(r.roads)) {
      if (nid < r.id) continue; // each road once, from its lower-id end
      const n = w.regions.get(nid);
      if (!n) continue;
      const a = summary.get(r.id)!, b = summary.get(nid)!;
      // The engine's own trade routes (when its trade layer runs) between the two count too.
      let route = 0;
      for (const t of w.tradeRoutes.values()) {
        if (t.closedYear !== null) continue;
        const ends = [w.regionOf.get(t.fromProvinceId), w.regionOf.get(t.toProvinceId)];
        if (ends.includes(r.id) && ends.includes(nid)) route = Math.max(route, t.wealth);
      }
      const across = [...a.inWar].some((c) => b.inWar.has(c)) || a.wars.length > 0 && b.wars.length > 0;
      const target = 0.1 + 0.8 * Math.min(r.prosperity, n.prosperity) + 0.3 * route - (across ? 0.2 : 0) - (a.banditry || b.banditry ? 0.2 : 0);
      const value = round3(clamp(r.roads[nid] + (target - r.roads[nid]) * 0.3, 0, 1));
      r.roads[nid] = value;
      n.roads[r.id] = value;
      const flag = `road:${r.id}|${nid}`;
      const state = r.flags[flag] ?? 0; // 1 thriving, -1 failing, 0 neither
      let kind: RegionalEventKind | null = null;
      if (value >= 0.56 && state !== 1) { r.flags[flag] = 1; kind = "ROAD_THRIVES"; }
      else if (value <= 0.25 && state !== -1) { r.flags[flag] = -1; kind = "ROAD_FAILS"; }
      else if (value > 0.32 && value < 0.48) r.flags[flag] = 0;
      if (kind) {
        emit(w, r, kind, { otherRegionId: nid, data: { trade: value } });
        emit(w, n, kind, { otherRegionId: r.id, data: { trade: value } });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pushing back (#1608): the region's year changes its provinces and people.
//
// Until #1608 the regional level only read the engine. Now, once it has read
// the year, it writes a few clear consequences back into the engine's own
// state: province populations, province wealth, its lords' opinions of each
// other and, now and then, a claim. Those are what the engine's next year
// reads (World.power for wars, scarcity for hunger and expansion, claims and
// opinions for goals and plots), so a region's fortunes ripple into its
// history. Deliberately few effects, each a tunable constant in FEEDBACK, not
// a second simulation. The one new roll (an old feud flaring) draws from
// World.regionRng, never World.rng, so the engine's own rolls stay in step.
// ---------------------------------------------------------------------------

/** The knobs for every feedback, in one place so they're easy to tune. Shares are of a province's people or of its 0..1 wealth. */
export const FEEDBACK = {
  /** A levy: share of a province's people lost in a year its lord fights, at a full levy (killed, maimed, or never coming home). */
  levyToll: 0.03,
  /** ...and how far a full levy drags its wealth down (fields untended while the men are away). */
  levyWork: 0.15,
  /** A hard winter: share of people it kills, in a region getting by (scaled by hardship). */
  winterToll: 0.015,
  /** ...and the stores it eats (wealth), scaled the same way. */
  winterStores: 0.08,
  /** Famine: share of people it kills on top of the engine's own toll, scaled by hardship. */
  famineToll: 0.03,
  /** ...and the stores it eats. */
  famineStores: 0.15,
  /** Bandits: wealth lost where they work. */
  banditWealth: 0.08,
  /** ...and traffic lost on the engine's trade routes (TradeRoute.wealth) that touch the region. */
  banditRoute: 0.1,
  /** How fast a province's wealth eases toward what the region's prosperity and trade support, a year. */
  wealthPull: 0.25,
  /** How much the region's roads (their trade over the usual 0.4) add to its provinces' wealth; doubled at the market town. */
  roadWealth: 0.3,
  /** How much the venture's health (over 0.5) adds to the wealth of the province it's in. */
  ventureWealth: 0.2,
  /** How much the engine's busiest open trade route through a province adds to its wealth. */
  routeWealth: 0.15,
  /** Unsettlement added by a lord's death, a great lord's (duchy or kingdom), an empty seat, a seized seat. */
  unsettleDeath: 0.1,
  unsettleGreatDeath: 0.2,
  unsettleVacant: 0.2,
  unsettleSeized: 0.3,
  /** Unsettlement kept from one year to the next (the rest fades). */
  unsettleKeep: 0.6,
  /** Opinion each of its lords loses of each lord of another house there, a year, at full unsettlement. */
  unsettledOpinion: 6,
  /** Chance a year, at full unsettlement, that a live feud flares into a claim on the rival's seat. */
  feudFlare: 0.6,
  /** A feud is live this many years after its lords last fought (long enough for sons to take it up). */
  feudMemory: 25,
  /** Opinion the two lords lose of each other when their feud flares. */
  feudFlareOpinion: 15,
  /** Unsettlement's pull on banditry (chance a year) and on prosperity's target. */
  unsettledBandits: 0.1,
  unsettledProsperity: 0.1,
} as const;

/**
 * How hard a hardship bites in a region of this prosperity: 1 in a region
 * getting by (0.5), up to 1.5 in a destitute one (0), down to 0.5 in a rich one
 * (1). A poor region has no stores to fall back on, so the same winter or
 * famine kills more.
 */
export function hardship(prosperity: number): number {
  return 0.5 + (1 - clamp(prosperity, 0, 1));
}

/** What pushBack needs from the region's year: plain data, so tests can hand it one. */
export interface Pressure {
  /** Its lords who fought this year: their provinces' men were called up. */
  levyLords: CharId[];
  hardWinter: boolean;
  /** The year's HARD_WINTER event, if any: it learns how many died. */
  winterEvent?: RegionalEvent | null;
  /** Its provinces the engine's famine struck this year. */
  famine: ProvinceId[];
  /** Where bandits worked this year, if they did. */
  bandits: ProvinceId | null;
  /** The region's prosperity going into the year: how much it had to fall back on. */
  prosperityBefore: number;
  /** This year's regional events in the region (its lords' deaths and seized seats unsettle it). */
  news: readonly RegionalEvent[];
}

/** Take a share of a province's people (never below the engine's floor of 50); returns how many were lost. */
function thin(p: Province, share: number): number {
  const before = p.population;
  p.population = Math.max(50, p.population - Math.round(p.population * share));
  return before - p.population;
}

/**
 * One year of the region pushing back into the simulation (#1608). Called by
 * runRegions for every region after the year is read; exported for the tests.
 */
export function pushBack(w: World, r: Region, y: Pressure): void {
  const F = FEEDBACK;
  const bite = hardship(y.prosperityBefore);
  const provs = r.provinceIds.map((id) => w.province(id)).filter((p): p is Province => !!p);
  const roadsAvg = avg(Object.values(r.roads), 0.4);

  // --- Wealth: eases toward what the region's prosperity and trade support.
  // The market town gains most from the roads; the venture's province from the
  // venture; a province on one of the engine's trade routes from its traffic.
  // A levy drags it down: the fields go untended while the men are away.
  for (const p of provs) {
    let route = 0;
    for (const t of w.tradeRoutes.values()) {
      if (t.closedYear === null && (t.fromProvinceId === p.id || t.toProvinceId === p.id)) route = Math.max(route, t.wealth);
    }
    const venture = p.id !== r.venture.provinceId ? 0 : r.venture.state === "closed" ? -0.5 : r.venture.health - 0.5;
    const target = clamp(
      r.prosperity + F.roadWealth * (roadsAvg - 0.4) * (p.id === r.centreId ? 2 : 1) + F.ventureWealth * venture + F.routeWealth * route - F.levyWork * r.levy,
      0, 1);
    const now = p.wealth ?? 0.5;
    p.wealth = now + (target - now) * F.wealthPull;
  }

  // --- A levy thins the provinces whose lords fought this year.
  const levied = new Set(y.levyLords);
  if (levied.size && r.levy > 0) {
    for (const p of provs) {
      const holder = w.title(p.titleId)?.holderId;
      if (holder && levied.has(holder)) thin(p, F.levyToll * r.levy);
    }
  }

  // --- A hard winter kills, and eats the stores: more where the region is poor.
  // Underground halls are spared (no fields to freeze, no roads to close).
  if (y.hardWinter) {
    let dead = 0;
    for (const p of provs) {
      if (p.subsurface) continue;
      dead += thin(p, F.winterToll * bite);
      p.wealth = (p.wealth ?? 0.5) - F.winterStores * bite;
    }
    if (y.winterEvent) {
      const people = provs.reduce((a, p) => a + p.population, 0) + dead;
      y.winterEvent.data["deaths"] = dead;
      y.winterEvent.data["share"] = round3(people > 0 ? dead / people : 0);
      y.winterEvent.significance = regionalSignificance("HARD_WINTER", y.winterEvent.data);
    }
  }

  // --- Famine: the engine already took its toll; a poor region loses more on top.
  for (const id of new Set(y.famine)) {
    const p = w.province(id);
    if (!p || w.regionOf.get(id) !== r.id) continue;
    thin(p, F.famineToll * bite);
    p.wealth = (p.wealth ?? 0.5) - F.famineStores * bite;
  }

  // --- Bandits rob where they work, and the trade on the region's roads.
  if (y.bandits) {
    const p = w.province(y.bandits);
    if (p) p.wealth = (p.wealth ?? 0.5) - F.banditWealth;
    for (const t of w.tradeRoutes.values()) {
      if (t.closedYear !== null) continue;
      if (w.regionOf.get(t.fromProvinceId) === r.id || w.regionOf.get(t.toProvinceId) === r.id) t.wealth = Math.max(0, t.wealth - F.banditRoute);
    }
  }
  for (const p of provs) p.wealth = round3(clamp(p.wealth ?? 0.5, 0, 1));

  // --- Politics: a lord's death, an empty seat or a seized one unsettles the region.
  let unsettled = r.unsettled * F.unsettleKeep;
  for (const ev of y.news) {
    if (ev.kind === "LORD_DIED") unsettled += ev.data["tier"] !== "county" ? F.unsettleGreatDeath : F.unsettleDeath;
    else if (ev.kind === "SEAT_VACANT") unsettled += F.unsettleVacant;
    else if (ev.kind === "SEAT_SEIZED") unsettled += F.unsettleSeized;
  }
  r.unsettled = round3(clamp(unsettled, 0, 1));
  if (r.unsettled <= 0) return;

  // While it's unsettled, its lords of different houses trust each other less.
  // (The engine's opinion drift eases opinions back toward neutral each year.)
  const lords: { id: CharId; dynastyId: string; seat: string }[] = [];
  for (const p of provs) {
    const h = w.char(w.title(p.titleId)?.holderId ?? null);
    if (h?.alive && !lords.some((l) => l.id === h.id)) lords.push({ id: h.id, dynastyId: h.dynastyId, seat: p.titleId });
  }
  const chill = Math.round(F.unsettledOpinion * r.unsettled);
  if (chill > 0) {
    for (const a of lords) for (const b of lords) {
      if (a.id !== b.id && a.dynastyId !== b.dynastyId) w.adjustOpinion(w.char(a.id)!, b.id, -chill);
    }
  }

  // An old feud can flare: when the region is unsettled and the two houses'
  // lords there aren't bound by a truce (often their sons, not the men who
  // fought), the more vengeful one may lay claim to the other's seat. The
  // engine's goals turn a claim into a war, so a feud can grow into war.
  for (const [key, year] of Object.entries(r.feuds)) {
    if (year >= w.year || w.year - year > F.feudMemory) continue;
    const [da, db] = key.split("|");
    const a = lords.find((l) => l.dynastyId === da), b = lords.find((l) => l.dynastyId === db);
    if (!a || !b || a.id === b.id || hasTruce(w, a.id, b.id)) continue; // a war within one house leaves a "d|d" feud: no rival to claim against
    if (w.regionRng.next() >= F.feudFlare * r.unsettled) continue;
    const ca = w.char(a.id)!, cb = w.char(b.id)!;
    const [claimant, rival, seat] = cb.drives.vengeance > ca.drives.vengeance ? [cb, ca, a.seat] : [ca, cb, b.seat];
    if (claimant.claims.some((c) => c.titleId === seat)) continue;
    addClaim(claimant, { titleId: seat, strength: "weak", basis: `the old feud of ${year}`, year: w.year });
    w.adjustOpinion(claimant, rival.id, -F.feudFlareOpinion);
    w.adjustOpinion(rival, claimant.id, -F.feudFlareOpinion);
    emit(w, r, "FEUD_FLARES", { actorId: claimant.id, targetId: rival.id, titleId: seat, provinceId: w.title(seat)?.provinceId ?? null, data: { since: year } });
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const avg = (xs: number[], empty: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : empty);
