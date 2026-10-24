/**
 * A told history of the Reach as plain data (#1540): what the worker posts back and what the page
 * keeps in storage, so a reload doesn't tell it again.
 *
 * Kept apart from history.ts so the page can read a kept history without importing the history
 * engine: only the worker (src/artificer-app/history.worker.ts) loads `storytelling/`.
 */

/** Bump when a change makes the same seed tell a different history, so kept histories are told again. */
// 4: histories carry their regions, and the chronicle their big regional events (#1598).
// 5: each province keeps one event from living memory when it has any, and lines carry their
// kind and house (#1586).
// 6: regions push back into the simulation (#1608), so the same seed lives a different history;
//    regions carry how unsettled they are, and their provinces how well off.
// 7: hard winters and famine carry off named people, and their titles pass the same year (#1617).
// 8: the Reach's human Peoples take part in the engine's odd patches of humans and strange growth
//    (#1633), so the same seed lives a different history.
export const HISTORY_VERSION = 8;

/**
 * The last this many years are told event by event ("living memory"); older years as threads.
 * Lives here, not in history.ts, so code that reads a told history (what the road villages
 * remember, remembered.ts) can tell living memory from legend without loading the engine.
 */
export const LIVING_MEMORY = 40;

export interface HistoryLine {
  year: number;
  text: string;
  /** The engine's event type (`WAR`, `MURDER`, `MADNESS_ONSET`…): how public it was (remembered.ts `publicityOf`). */
  kind?: string;
  /** The house the deed touches (its doer's, e.g. "Hedlund"), if any: who has a stake in it. */
  house?: string | null;
}

export interface ProvinceHistory {
  id: string;
  name: string;
  culture: string;
  /** The lordship seated there, e.g. "Hundred of Ravenford". */
  title: string;
  /** Who holds it at the end, e.g. "Ivar of Hedlund" (null if it lies vacant). */
  holder: string | null;
  /** The holder's house, e.g. "Hedlund" (null if it lies vacant or the holder has none). */
  house: string | null;
  /** Its most significant events, oldest first, one of them within living memory if any is (history.ts `pickLines`). */
  lines: HistoryLine[];
}

/** One of a region's regional events, told (storytelling/regions.ts, render.ts renderRegionalEvent). */
export interface RegionLine {
  year: number;
  /** The engine's regional event kind, e.g. `FAMINE`, `LORD_DIED`, `VENTURE_FAILING`. */
  kind: string;
  category: 'politics' | 'economy' | 'event';
  /** The sifter's score (storytelling/sifter.ts regionalSignificance): 2 a fair, 6 a famine. */
  significance: number;
  /** The province it happened in, when it's one place. */
  province: string | null;
  text: string;
}

/**
 * A region at the end of the history (#1598): a few neighbouring provinces around a market
 * town, what it lives on, how it's doing, who leads it, and what happened there.
 */
export interface RegionHistory {
  /** `hollowford-country`: the market town's name as a key, plus `-country`, so it never reads
   *  the same as a province's own region id (PR #1592's regions.ts `regionOf` gives `hollowford`). */
  id: string;
  /** What people call it, named from its history (storytelling/regions.ts nameRegions): "the
   *  Hollowford country" (its market town), "the Timberwold" (its trade), "Sigmund's Land" (a
   *  hero), "the Lean Woods" (a hardship), "the Marches of Old Feud" (a quarrel). Display only:
   *  `id` stays the market town's. */
  name: string;
  centre: { id: string; name: string };
  /** The centre first. Each lives on its own trade (`livelihood`, its dominant one: the land's
   *  best, or the market's), may have `secondary` trades its land also supports, and grew up
   *  around its `founding` (a trade, or `crossing`: a ford), which can differ from today's.
   *  `wealth` 0–1 is how well off it is (0.5 getting by; #1608: trade and prosperity raise it,
   *  levies, hard winters, famine and bandits take from it). */
  provinces: { id: string; name: string; livelihood: string; secondary: string[]; founding: string; wealth: number }[];
  /** What the region as a whole lives on: farming, lumber, mining, fishing, herding or peat. */
  primary: string;
  /** Its big enterprise (a mine, a lumber camp…), where it is, how it's doing, and since when. */
  venture: { kind: string; province: string; state: 'thriving' | 'steady' | 'failing' | 'closed'; since: number };
  /** 0–1: how well the region is doing (0.5 getting by). */
  prosperity: number;
  /** Bread price, 1 = usual. */
  price: number;
  harvest: 'bumper' | 'good' | 'fair' | 'poor' | 'failed';
  /** 0–1: how many men are away at war; how heavy the lords' dues are. */
  levy: number;
  tax: number;
  /** 0–1: how unsettled its politics are (#1608): raised by lords' deaths and empty or seized seats. */
  unsettled: number;
  /** The house holding the most of its seats, e.g. "Hedlund" (null if none). */
  leadingHouse: string | null;
  /** Who holds each of its seats now, centre first: "Ivar of Hedlund holds the Hundred of Ravenford." */
  lords: { province: string; text: string }[];
  /** Houses whose lords have fought each other here lately (the last 10 years). */
  feuds: { houses: [string, string]; year: number }[];
  /** Standing alliances among its lords, as pairs of names. */
  alliances: [string, string][];
  /** Road trade with each neighbouring region, 0–1. */
  roads: { to: string; name: string; trade: number }[];
  /** Its told regional events, oldest first: the notable ones of living memory, and a few legends. */
  lines: RegionLine[];
}

/**
 * An organisation the engine founded (#1587): a guild, an academy, or a mercenary or pirate company,
 * as it stands at the end of the history. What the road's bridge (organisations.ts) reads to let a
 * road village's people belong to it, and to say what it did.
 */
export interface HistoryOrg {
  /** The engine's id (`g3`): stable for the same history. */
  id: string;
  /** "Guild of Sunmeadow Weavers", "Academy of Rivenbrook". */
  name: string;
  kind: 'guild' | 'academy' | 'company';
  /** A guild's craft (`smithing`, `trade`, `letters`…) or a company's kind (`mercenary`, `pirate`); null for an academy. */
  craft: string | null;
  /** The province its hall (or home port) is in. */
  province: string;
  founded: number;
  /** The year it was dissolved, closed or disbanded; null if it stands. */
  ended: number | null;
  /** Living members, as the engine counts them (masters, scholars, company men). */
  members: number;
  /** Its master, rector or captain, as the chronicle names people ("Ivar of Hedlund"), or null. */
  head: string | null;
  /** The invention a guild keeps to itself, by name, if any. */
  monopoly: string | null;
}

export interface ReachHistory {
  version: number;
  seed: number;
  /** The year the history ends: the present, when the Warden arrives. */
  year: number;
  provinces: ProvinceHistory[];
  /** The regions the provinces are grouped in (#1598). */
  regions: RegionHistory[];
  /**
   * Set when this history was told with the three road villages seated on the hex map (#1905,
   * `provincesOf`'s `roadAnchors` option) rather than inside the Reach. Absent means today's
   * `'reach'` setting, so a kept history from before this option existed reads the same as one
   * told with it off.
   */
  roadAnchors?: 'hexes';
  /**
   * The organisations the engine founded (#1587). Absent in a history kept before them: read as
   * none. Telling them changes nothing else in the history (they're read after it's lived), so the
   * version stays: a kept history without them simply has none until it's told again.
   */
  orgs?: HistoryOrg[];
  /** The whole chronicle as text: the chronicle's threads, then living memory year by year. */
  chronicle: string;
  /** Events the engine logged, and how many were worth telling. */
  logged: number;
  told: number;
}

/**
 * A kept history, if it's this seed's, from this version of the generator, and told with the same
 * `roadAnchors` setting the caller wants now (#1905): a history told with the villages on the hex
 * map isn't a 'reach' run's, and a 'reach' history (or one kept from before this option existed,
 * which carries no field) isn't a hex-world run's, so either mismatch is told again.
 */
export function keptHistory(raw: string | null, seed: number, roadAnchors?: 'hexes'): ReachHistory | null {
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Partial<ReachHistory>;
    if (h.version !== HISTORY_VERSION || h.seed !== seed || !Array.isArray(h.provinces) || !Array.isArray(h.regions) || typeof h.chronicle !== 'string') return null;
    return h.roadAnchors === roadAnchors ? h as ReachHistory : null;
  } catch {
    return null;
  }
}
