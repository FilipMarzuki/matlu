// specs/class-events.ts — 11 events for the class-stratification layer.
//
// Every province is stamped at seed with a `classStructure` (agrarian_serfs,
// free_yeomen, urban_patriciate, pastoral_bands, mixed) and a burgherStrength
// scalar. This catalog is what makes the class-shape visible in the chronicle:
// bread riots when the peasants starve, guild uprisings when the noble
// overreaches, patrician feuds when two burgher families vie for the city,
// civic charters when a merchant council supplants an absentee lord.
//
// Composition:
//   phenomena.ts   → FAMINE fires BREAD_RIOT / PEASANT_JACQUERIE
//   magic.ts       → wealth accrual fires TITHE_REFUSED
//   emergence.ts   → merchant/scholar guilds gate GUILD_UPRISING / PATRONAGE
//   trade.ts       → market fair activity feeds MERCHANT_COUNCIL_FORMED
//
// Determinism: all ambient specs gate on the province's classStructure (a
// static seed-time value in worlds without cultures too), then require the
// catastrophe-run trigger (FAMINE, WEALTH accrual, dynasty-holding-title) to
// have happened, so RNG stays quiet in default runs. The FAMINE / WEALTH gates
// are only reached in catastrophes-enabled or magic-enabled worlds.

import type { EventSpec } from "../event-spec.js";
import type { Dynasty, Province } from "../types.js";
import type { World } from "../world.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the country";
}
function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function titleAt(w: World, provinceId: string) {
  return [...w.titles.values()].find((t) => t.provinceId === provinceId);
}
function holderCulture(w: World, provinceId: string): string | null {
  const t = titleAt(w, provinceId);
  const h = w.char(t?.holderId ?? null);
  return h ? (w.dynasty(h.dynastyId)?.cultureId ?? null) : null;
}
function hasCultureTrait(w: World, provinceId: string, trait: string): boolean {
  const cid = holderCulture(w, provinceId);
  if (!cid) return false;
  const state = w.cultureState(cid);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(cid)?.startingTraits ?? []).includes(trait);
}
function countRecentEventsAt(w: World, type: string, provinceId: string, window: number): number {
  let n = 0;
  for (const e of w.events) {
    if (e.type !== type) continue;
    if (e.provinceId !== provinceId) continue;
    if (w.year - e.year > window) continue;
    n++;
  }
  return n;
}

// ===========================================================================
// PEASANT / RURAL EVENTS (3)
// ===========================================================================

// ---------------------------------------------------------------------------
// BREAD_RIOT — famine in an urban / free-yeomen province → grain-riot in the
// central market. Small pop loss + a chronicle note; escalates JACQUERIE odds.
// ---------------------------------------------------------------------------
const BREAD_RIOT: EventSpec = {
  type: "BREAD_RIOT",
  base: 7,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    const casualties = Number(ev.data["casualties"] ?? 0);
    return `Grain-carts were overturned in the market at ${where}; before the militia restored order, ${casualties > 40 ? "scores" : "some"} had fallen and the granaries were left unguarded.`;
  },
  arc: (ev) => ev.provinceId ? { key: `BR:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "FAMINE",
    prob: (w, e) => {
      if (!w.catastrophesEnabled) return 0;
      const p = w.province(e.provinceId ?? "");
      if (!p) return 0;
      if (p.classStructure !== "urban_patriciate" &&
          p.classStructure !== "free_yeomen" &&
          p.classStructure !== "mixed") return 0;
      // Bigger cities riot more.
      return p.population > 500 ? 0.40 : 0.20;
    },
    fire: (w, e) => {
      const p = w.province(e.provinceId ?? "");
      if (!p) return;
      const casualties = Math.max(10, Math.floor(p.population * 0.02));
      p.population = Math.max(70, p.population - casualties);
      w.log("BREAD_RIOT", { provinceId: p.id, data: { casualties } });
    },
  },
};

// ---------------------------------------------------------------------------
// TITHE_REFUSED — a peasant/rural province revolts when its holding dynasty's
// wealth extraction (as proxied by dynasty wealth growth) crosses a threshold.
// ---------------------------------------------------------------------------
const TITHE_REFUSED: EventSpec = {
  type: "TITHE_REFUSED",
  base: 8,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    const holder = charName(w, ev.actorId);
    return `The peasants at ${where} refused their tithe; ${holder}'s reeves rode home empty-handed and the season closed with the halls half-full.`;
  },
  arc: (ev) => ev.provinceId ? { key: `TR:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.classStructure !== "agrarian_serfs" && p.classStructure !== "free_yeomen") return false;
      if (p.population < 200) return false;
      // Needs a holder whose dynasty has accrued significant wealth (proxy for
      // over-extraction). Wealth threshold scales with title tier.
      const t = titleAt(w, p.id);
      const h = w.char(t?.holderId ?? null);
      if (!h) return false;
      const dyn = w.dynasty(h.dynastyId);
      if (!dyn) return false;
      return (dyn.wealth ?? 0) > 200;
    },
    prob: (_w, item) => {
      const p = item as Province;
      // Blight amplifies unrest; higher blight = higher chance.
      return 0.02 + 0.05 * (p.blightLevel ?? 0);
    },
    fire: (w, item) => {
      const p = item as Province;
      const t = titleAt(w, p.id);
      const h = w.char(t?.holderId ?? null);
      const dyn = w.dynasty(h?.dynastyId ?? "");
      if (dyn) dyn.wealth = Math.max(0, (dyn.wealth ?? 0) - 30);
      w.log("TITHE_REFUSED", {
        provinceId: p.id,
        actorId: h?.id ?? null,
        data: { holderName: h?.name ?? "the lord" },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// PEASANT_JACQUERIE — mass agrarian rising (1358 flavour). Triggered by
// famine+riot escalation OR very high blight in a serf province.
// ---------------------------------------------------------------------------
const PEASANT_JACQUERIE: EventSpec = {
  type: "PEASANT_JACQUERIE",
  base: 10,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    return `A great rising broke out at ${where}; the peasants marched with reaping-hooks against the manor gates, and the countryside was not quiet for years.`;
  },
  arc: (ev) => ev.provinceId ? { key: `PJ:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.classStructure !== "agrarian_serfs") return false;
      // Escalation from prior BREAD_RIOT or TITHE_REFUSED in the last 20 years,
      // OR severe blight.
      const priorUnrest = countRecentEventsAt(w, "BREAD_RIOT", p.id, 20) +
                          countRecentEventsAt(w, "TITHE_REFUSED", p.id, 20);
      return priorUnrest >= 2 || (p.blightLevel ?? 0) > 0.5;
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const p = item as Province;
      const loss = Math.floor(p.population * 0.08);
      p.population = Math.max(80, p.population - loss);
      p.blightLevel = Math.min(1, (p.blightLevel ?? 0) + 0.05);
      w.log("PEASANT_JACQUERIE", { provinceId: p.id, data: { casualties: loss } });
    },
    once: "per-province",
  },
};

// ===========================================================================
// URBAN / BURGHER EVENTS (6)
// ===========================================================================

// ---------------------------------------------------------------------------
// GUILD_UPRISING — merchant/craft guild forces its terms on the local lord.
// Requires mercantile-trait culture + guild present at province (composes
// with the existing guild layer).
// ---------------------------------------------------------------------------
const GUILD_UPRISING: EventSpec = {
  type: "GUILD_UPRISING",
  base: 8,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    const craft = String(ev.data["craft"] ?? "the guild");
    return `The ${craft} of ${where} shuttered their halls and marched on the lord's court; the compact they signed that spring was not the one their forebears had held.`;
  },
  arc: (ev) => ev.provinceId ? { key: `GU:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.classStructure !== "urban_patriciate" && p.classStructure !== "mixed") return false;
      if (p.burgherStrength < 0.3) return false;
      // Needs an active guild in this province.
      const guildsHere = [...w.guilds.values()].filter(
        (g) => g.disbandedYear === null && g.provinceId === p.id
      );
      return guildsHere.length > 0;
    },
    // Higher probability if the local culture is mercantile.
    prob: (w, item) => {
      const p = item as Province;
      return hasCultureTrait(w, p.id, "mercantile") ? 0.05 : 0.02;
    },
    fire: (w, item) => {
      const p = item as Province;
      const guildsHere = [...w.guilds.values()].filter(
        (g) => g.disbandedYear === null && g.provinceId === p.id
      );
      const g = guildsHere.length > 0 ? guildsHere[0] : null;
      p.burgherStrength = Math.min(1, p.burgherStrength + 0.10);
      w.log("GUILD_UPRISING", {
        provinceId: p.id,
        data: { craft: g?.craft ?? "guildsmen" },
      });
    },
    // Recurring — a city can rise more than once.
  },
};

// ---------------------------------------------------------------------------
// PATRICIAN_FEUD — two burgher families vie for city dominance. Reduces
// burgherStrength temporarily as the city fractures.
// ---------------------------------------------------------------------------
const PATRICIAN_FEUD: EventSpec = {
  type: "PATRICIAN_FEUD",
  base: 7,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    return `Two great houses of ${where} came to blows over the merchant-council's chair; before the third summer their factions had bloodied every district and the trade in cloth was down by half.`;
  },
  arc: (ev) => ev.provinceId ? { key: `PF:${ev.provinceId}`, kind: "feud" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.classStructure !== "urban_patriciate") return false;
      if (p.burgherStrength < 0.4) return false;
      return true;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const p = item as Province;
      p.burgherStrength = Math.max(0.1, p.burgherStrength - 0.10);
      w.log("PATRICIAN_FEUD", { provinceId: p.id });
    },
  },
};

// ---------------------------------------------------------------------------
// MERCHANT_COUNCIL_FORMED — burgher institution replaces noble administration
// in a strong-burgher province. Unlocks CIVIC_CHARTER_GRANTED downstream.
// ---------------------------------------------------------------------------
const MERCHANT_COUNCIL_FORMED: EventSpec = {
  type: "MERCHANT_COUNCIL_FORMED",
  base: 9,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    return `A merchant-council was seated at ${where}; twelve elected voices now spoke where one appointed reeve had ruled.`;
  },
  arc: (ev) => ev.provinceId ? { key: `MC:${ev.provinceId}`, kind: "title" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.classStructure !== "urban_patriciate") return false;
      if (p.burgherStrength < 0.55) return false;
      // Must not already have a merchant council here.
      const exists = w.events.some(
        (e) => e.type === "MERCHANT_COUNCIL_FORMED" && e.provinceId === p.id
      );
      return !exists;
    },
    prob: () => 0.04,
    fire: (w, item) => {
      const p = item as Province;
      p.burgherStrength = Math.min(1, p.burgherStrength + 0.05);
      w.log("MERCHANT_COUNCIL_FORMED", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// URBAN_MIGRATION — rural pops flow to burgher-heavy province. Small pop
// transfer from a low-strength neighbour into a strong-burgher province.
// ---------------------------------------------------------------------------
const URBAN_MIGRATION: EventSpec = {
  type: "URBAN_MIGRATION",
  base: 6,
  render: (ev, w) => {
    const to = provName(w, ev.provinceId);
    const from = String(ev.data["fromName"] ?? "the countryside");
    const migrants = Number(ev.data["migrants"] ?? 0);
    return migrants > 20
      ? `A stream of ${migrants} families left ${from} for ${to}; the manor rolls were shorter that autumn, and the city's rented rooms full.`
      : `A quiet stream of families left ${from} for ${to}; the manor rolls were shorter that autumn, and the city's rented rooms full.`;
  },
  arc: (ev) => ev.provinceId ? { key: `UM:${ev.provinceId}`, kind: "dynasty" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.classStructure !== "urban_patriciate") return false;
      if (p.burgherStrength < 0.45) return false;
      // Needs a rural neighbour.
      return p.neighbors.some((nid) => {
        const n = w.province(nid);
        if (!n) return false;
        if (n.classStructure !== "agrarian_serfs" && n.classStructure !== "free_yeomen") return false;
        return n.population > 200;
      });
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const p = item as Province;
      // Find donor.
      let donor: Province | undefined;
      for (const nid of p.neighbors) {
        const n = w.province(nid);
        if (!n) continue;
        if ((n.classStructure === "agrarian_serfs" || n.classStructure === "free_yeomen") && n.population > 200) {
          if (!donor || n.population > donor.population) donor = n;
        }
      }
      if (!donor) return;
      const migrants = Math.floor(donor.population * 0.03);
      donor.population = Math.max(80, donor.population - migrants);
      p.population += migrants;
      w.log("URBAN_MIGRATION", {
        provinceId: p.id,
        data: {
          fromName: donor.name,
          fromProvinceId: donor.id,
          migrants,
        },
      });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// CIVIC_CHARTER_GRANTED — the noble grants (or is forced to grant) a city
// charter. Elevates the province to a persistent self-governing status;
// mechanically bumps burgherStrength and marks the province.
// ---------------------------------------------------------------------------
const CIVIC_CHARTER_GRANTED: EventSpec = {
  type: "CIVIC_CHARTER_GRANTED",
  base: 10,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    return `A charter was granted at ${where}; the burghers would keep their own courts, mint their own coin, and answer no reeve but the one they chose themselves.`;
  },
  arc: (ev) => ev.provinceId ? { key: `CH:${ev.provinceId}`, kind: "title" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.classStructure !== "urban_patriciate") return false;
      // Preconditions: an active merchant council + strong burghers.
      const council = w.events.some(
        (e) => e.type === "MERCHANT_COUNCIL_FORMED" && e.provinceId === p.id
      );
      if (!council) return false;
      if (p.burgherStrength < 0.6) return false;
      const exists = w.events.some(
        (e) => e.type === "CIVIC_CHARTER_GRANTED" && e.provinceId === p.id
      );
      return !exists;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const p = item as Province;
      p.burgherStrength = Math.min(1, p.burgherStrength + 0.15);
      if (!p.zoneFlags.includes("chartered_city")) p.zoneFlags.push("chartered_city");
      w.log("CIVIC_CHARTER_GRANTED", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// NOBLE_HOSTAGE_TAKEN — Bruges-1302 flavour. Burghers seize a visiting lord
// to extract concessions. Chronicle drama; the noble reappears (or doesn't).
// ---------------------------------------------------------------------------
const NOBLE_HOSTAGE_TAKEN: EventSpec = {
  type: "NOBLE_HOSTAGE_TAKEN",
  base: 9,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    const lord = String(ev.data["lord"] ?? "a noble");
    const survived = ev.data["survived"] === true;
    return survived
      ? `The burghers of ${where} laid hands on ${lord} in the guildhall and would not let him ride until the tolls were his no longer.`
      : `The burghers of ${where} laid hands on ${lord} in the guildhall; the lord did not ride out at all, and the tolls became the city's forever.`;
  },
  arc: (ev) => ev.provinceId ? { key: `HO:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.classStructure !== "urban_patriciate") return false;
      if (p.burgherStrength < 0.5) return false;
      // Needs a title-holder to seize.
      const t = titleAt(w, p.id);
      const h = w.char(t?.holderId ?? null);
      if (!h) return false;
      // Preconditions: recent PATRICIAN_FEUD or GUILD_UPRISING signals city-lord tension.
      return countRecentEventsAt(w, "GUILD_UPRISING", p.id, 25) +
             countRecentEventsAt(w, "PATRICIAN_FEUD", p.id, 25) > 0;
    },
    prob: () => 0.03,
    fire: (w, item) => {
      const p = item as Province;
      const t = titleAt(w, p.id);
      const h = w.char(t?.holderId ?? null);
      if (!h) return;
      const survived = w.rng.chance(0.7);
      if (!survived) {
        // A grim outcome — mark holder for downstream death handling.
        h.reputation.just = Math.max(0, h.reputation.just - 0.1);
      }
      p.burgherStrength = Math.min(1, p.burgherStrength + 0.10);
      w.log("NOBLE_HOSTAGE_TAKEN", {
        provinceId: p.id,
        actorId: h.id,
        data: { lord: charName(w, h.id), survived },
      });
    },
  },
};

// ===========================================================================
// NOBILITY-SIDE REACTIONS (2)
// ===========================================================================

// ---------------------------------------------------------------------------
// SUMPTUARY_LAW_PASSED — nobles push back against burgher display of wealth.
// Fires when burghers are strong and the ruling dynasty is proud/high-status.
// ---------------------------------------------------------------------------
const SUMPTUARY_LAW_PASSED: EventSpec = {
  type: "SUMPTUARY_LAW_PASSED",
  base: 6,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    return `An edict was proclaimed at ${where}: no burgher's wife might wear velvet, no guildmaster silver at his belt. The tailors laughed; the burghers did not.`;
  },
  arc: (ev) => ev.provinceId ? { key: `SL:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const p = item as Province;
      if (p.burgherStrength < 0.4) return false;
      // Needs a title-holder with high ambition (proud noble class).
      const t = titleAt(w, p.id);
      const h = w.char(t?.holderId ?? null);
      if (!h) return false;
      return h.drives.ambition > 0.65;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const p = item as Province;
      p.burgherStrength = Math.max(0.05, p.burgherStrength - 0.05);
      w.log("SUMPTUARY_LAW_PASSED", { provinceId: p.id });
    },
  },
};

// ---------------------------------------------------------------------------
// PATRONAGE_EXTENDED — a patrician family bankrolls a scholar/artist. Fires
// when there's an active academy in a strong-burgher province and a wealthy
// dynasty in-scope. Small prestige bump to the academy.
// ---------------------------------------------------------------------------
const PATRONAGE_EXTENDED: EventSpec = {
  type: "PATRONAGE_EXTENDED",
  base: 6,
  render: (ev, w) => {
    const where = provName(w, ev.provinceId);
    const patron = String(ev.data["patron"] ?? "a patrician family");
    const beneficiary = String(ev.data["beneficiary"] ?? "an academy");
    return `${patron} at ${where} pledged their purse to ${beneficiary}; the scholars there wore new cloaks that winter and their letters carried further than before.`;
  },
  arc: (ev) => ev.provinceId ? { key: `PA:${ev.provinceId}`, kind: "culture" } : null,
  ambient: {
    scan: "dynasties",
    gate: (w, item) => {
      if (!w.catastrophesEnabled) return false;
      const d = item as Dynasty;
      if ((d.wealth ?? 0) < 250) return false;
      // Find a home province with strong burghers + an active academy.
      const anyMember = [...w.characters.values()].find((c) => c.alive && c.dynastyId === d.id);
      if (!anyMember) return false;
      const p = w.province(anyMember.provinceId);
      if (!p || p.burgherStrength < 0.4) return false;
      const academyHere = [...w.academies.values()].find(
        (a) => a.closedYear === null && a.provinceId === p.id
      );
      return !!academyHere;
    },
    prob: () => 0.04,
    fire: (w, item) => {
      const d = item as Dynasty;
      const anyMember = [...w.characters.values()].find((c) => c.alive && c.dynastyId === d.id);
      if (!anyMember) return;
      const p = w.province(anyMember.provinceId);
      if (!p) return;
      const academy = [...w.academies.values()].find(
        (a) => a.closedYear === null && a.provinceId === p.id
      );
      if (!academy) return;
      d.wealth = Math.max(0, (d.wealth ?? 0) - 50);
      academy.prestige = Math.min(1, academy.prestige + 0.05);
      w.log("PATRONAGE_EXTENDED", {
        provinceId: p.id,
        data: {
          patron: d.name,
          patronDynastyId: d.id,
          beneficiary: academy.name,
          academyId: academy.id,
        },
      });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
export const CLASS_SPECS: EventSpec[] = [
  BREAD_RIOT,
  TITHE_REFUSED,
  PEASANT_JACQUERIE,
  GUILD_UPRISING,
  PATRICIAN_FEUD,
  MERCHANT_COUNCIL_FORMED,
  URBAN_MIGRATION,
  CIVIC_CHARTER_GRANTED,
  NOBLE_HOSTAGE_TAKEN,
  SUMPTUARY_LAW_PASSED,
  PATRONAGE_EXTENDED,
];
