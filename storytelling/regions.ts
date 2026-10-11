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
//   • It writes only to its own state and log (World.regions,
//     World.regionalEvents) and never feeds back into the simulation, so the
//     canonical event log, and every golden hash, is exactly what it was.
//     Feeding back (a levy thinning a province, a hard winter killing) is an
//     open question for later; it would move the hashes.

import { carryingCapacity } from "./geography.js";
import { regionalSignificance } from "./sifter.js";
import type {
  CharId,
  EventType,
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

/** About this many provinces per region. The Reach's 8–12 provinces make 3–4 regions. */
export const PROVINCES_PER_REGION = 3;

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
 */
export function formRegions(w: World): void {
  const P = [...w.provinces.values()];
  if (P.length === 0) return;
  const index = new Map(P.map((p, i) => [p.id, i]));
  const adj = P.map((p) => new Set(p.neighbors.map((n) => index.get(n)).filter((i): i is number => i !== undefined)));

  const target = Math.max(1, Math.round(P.length / PROVINCES_PER_REGION));
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

  for (const m of members) {
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

/** "the Hollowford country": how people name a region after its market town. */
export function regionLabel(r: Pick<Region, "name">): string {
  return `the ${r.name} country`;
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
  FEUD: "politics", BORDER_WAR: "politics", ALLIANCE: "politics", LEVY_RAISED: "politics", TAXES_RAISED: "politics", TAXES_EASED: "politics",
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
}

/**
 * One year of the regional level. `evStart` is where this year's engine events
 * begin in World.events (tick() passes it). Draws only from World.regionRng.
 */
export function runRegions(w: World, evStart: number): void {
  if (w.regions.size === 0) return;
  adoptStrays(w);
  const yearEvents = w.events.slice(evStart);
  const frost = yearEvents.find((e) => e.type === "GREAT_FROST");

  const summary = new Map<RegionId, YearSummary>();
  for (const r of w.regions.values()) summary.set(r.id, { year: yearEvents, events: [], famine: [], plagued: [], wars: [], inWar: new Set(), banditry: false, hardWinter: false });
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
    emit(w, r, "HARD_WINTER", { causeEventId: frost?.id ?? null });
  }
  // Banditry: worse when times are hard, the men are away at war, or a seat is
  // empty or held by a child. The engine's own outlaws count too.
  const engineBandit = s.events.find((e) => BANDITS.has(e.type));
  const weak = r.provinceIds.some((id) => {
    const t = w.title(w.province(id)?.titleId ?? null);
    const h = w.char(t?.holderId ?? null);
    return !!t && (!h || w.age(h) < 16);
  });
  const pBandits = 0.02 + 0.15 * (1 - r.prosperity) ** 2 + 0.1 * r.levy + (weak ? 0.05 : 0);
  const banditRoll = rng.next();
  const spot = rng.pick(r.provinceIds.length > 1 ? r.provinceIds.slice(1) : r.provinceIds);
  if (engineBandit || (w.year - (r.flags.bandits ?? -99) >= 4 && banditRoll < pBandits)) {
    r.flags.bandits = w.year;
    s.banditry = true;
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
    - (s.wars.length ? 0.1 : 0) - (s.banditry ? 0.05 : 0);
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

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const avg = (xs: number[], empty: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : empty);
