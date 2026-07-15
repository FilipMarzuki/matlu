// specs/maritime-events.ts — 15 maritime event specs.
//
// Path A of the maritime plan: events on the existing coastal/port provinces.
// No new geography (no ocean tiles, no islands as first-class provinces —
// that's Path B, queued for a follow-up PR). Every spec here fires purely
// on the two existing coast tiles (Saltmere, Gullhaven) and their trade
// partners.
//
// Reuses the EventSpec catalog (event-spec.ts). Zero engine edits.

import type { EventSpec } from "../event-spec.js";
import type { Character, Province } from "../types.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the coast";
}
function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function isPort(p: Province): boolean {
  return p.zoneFlags.includes("port");
}
function cultureHasTrait(w: World, c: Character, trait: string): boolean {
  const dyn = w.dynasty(c.dynastyId);
  if (!dyn?.cultureId) return false;
  const state = w.cultureState(dyn.cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(dyn.cultureId)?.startingTraits ?? []).includes(trait);
}

// ---------------------------------------------------------------------------
// SEA_STORM — ambient at any coastal province, low base rate
// ---------------------------------------------------------------------------
const SEA_STORM: EventSpec = {
  type: "SEA_STORM",
  base: 5,
  render: (ev, w) => {
    const d = Number(ev.data["deaths"] ?? 0);
    const toll = d > 0 ? ` ${d} were drowned in the surge.` : "";
    return `A great storm rose off ${provName(w, ev.provinceId)}, dark waves battering the shore.${toll}`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (_w, item) => (item as Province).coastal === true,
    prob: () => 0.03,
    fire: (w, item) => {
      const p = item as Province;
      const loss = Math.round(p.population * 0.03);
      p.population = Math.max(50, p.population - loss);
      w.log("SEA_STORM", { provinceId: p.id, data: { deaths: loss } });
    },
  },
};

// ---------------------------------------------------------------------------
// TSUNAMI — reactive from ERUPTION at coastal-adjacent province
// ---------------------------------------------------------------------------
const TSUNAMI: EventSpec = {
  type: "TSUNAMI",
  base: 10,
  render: (ev, w) => `A great wave, born of the eruption, drove into the coast at ${provName(w, ev.provinceId)}. Whole villages were lost.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "ERUPTION",
    prob: (w, e) => {
      // Only fires if some coastal province neighbours the eruption.
      const erup = w.province(e.provinceId ?? "");
      if (!erup) return 0;
      const coastalNeighbour = erup.neighbors
        .map((n) => w.province(n))
        .some((p) => p?.coastal);
      return coastalNeighbour ? 0.4 : 0;
    },
    fire: (w, e) => {
      const erup = w.province(e.provinceId ?? "");
      if (!erup) return;
      const target = erup.neighbors
        .map((n) => w.province(n))
        .find((p) => p?.coastal);
      if (!target) return;
      const loss = Math.round(target.population * 0.25);
      target.population = Math.max(50, target.population - loss);
      w.log("TSUNAMI", { provinceId: target.id, data: { deaths: loss, sourceEruptionId: e.id } });
    },
  },
};

// ---------------------------------------------------------------------------
// PIRATE_RAID — ambient at coastal, prob scales with active trade routes
// ---------------------------------------------------------------------------
const PIRATE_RAID: EventSpec = {
  type: "PIRATE_RAID",
  base: 6,
  render: (ev, w) => {
    const d = Number(ev.data["deaths"] ?? 0);
    return `Pirates fell on ${provName(w, ev.provinceId)} — ${d} killed and much wealth lost to the reavers.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (_w, item) => (item as Province).coastal === true,
    prob: (w, item) => {
      const p = item as Province;
      // Count active sea trade routes at this province.
      let routes = 0;
      for (const e of w.events) {
        if (e.type !== "TRADE_ROUTE_ESTABLISHED") continue;
        if (e.data["conduit"] !== "sea") continue;
        const from = String(e.data["fromProvinceId"] ?? "");
        const to   = String(e.data["toProvinceId"] ?? "");
        if (from !== p.id && to !== p.id) continue;
        // Skip if a later DISRUPTED torn this pair down.
        const pair = [from, to].sort().join("~");
        const disrupted = w.events.some(
          (x) => x.type === "TRADE_ROUTE_DISRUPTED" &&
                 x.year > e.year &&
                 [String(x.data["fromProvinceId"]), String(x.data["toProvinceId"])].sort().join("~") === pair,
        );
        if (!disrupted) routes++;
      }
      return Math.min(0.15, 0.01 + routes * 0.04);
    },
    fire: (w, item) => {
      const p = item as Province;
      const loss = Math.round(p.population * 0.04);
      p.population = Math.max(50, p.population - loss);
      w.log("PIRATE_RAID", { provinceId: p.id, data: { deaths: loss } });
    },
  },
};

// ---------------------------------------------------------------------------
// WHALING_BOOM — coastal windfall, boosts wealth of ruling dynasty
// ---------------------------------------------------------------------------
const WHALING_BOOM: EventSpec = {
  type: "WHALING_BOOM",
  base: 6,
  render: (ev, w) => {
    const catch_ = Number(ev.data["catch"] ?? 0);
    return `A great whaling season came to ${provName(w, ev.provinceId)} — ${catch_} beasts taken, and silver flooded the port.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (_w, item) => (item as Province).coastal === true,
    prob: () => 0.02,
    fire: (w, item) => {
      const p = item as Province;
      const title = [...w.titles.values()].find((t) => t.provinceId === p.id);
      const holder = w.char(title?.holderId ?? null);
      const dyn = w.dynasty(holder?.dynastyId ?? "");
      if (dyn) dyn.wealth = Math.min(2000, dyn.wealth + 150);
      p.population = Math.min(p.population + 30, p.population + 30);
      w.log("WHALING_BOOM", { provinceId: p.id, data: { catch: 20 + w.rng.int(0, 30) } });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// FISHERY_COLLAPSE — reactive to prior WHALING_BOOM at same province
// ---------------------------------------------------------------------------
const FISHERY_COLLAPSE: EventSpec = {
  type: "FISHERY_COLLAPSE",
  base: 7,
  render: (ev, w) => `The fisheries of ${provName(w, ev.provinceId)} collapsed — the nets came up empty for years afterward.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (!p.coastal) return false;
      // Whaling boom fired here in the last 20 years?
      return w.events.some(
        (e) => e.type === "WHALING_BOOM" && e.provinceId === p.id && w.year - e.year <= 20,
      );
    },
    prob: () => 0.08,
    fire: (w, item) => {
      const p = item as Province;
      p.fertility = Math.max(0.1, p.fertility - 0.08);
      w.log("FISHERY_COLLAPSE", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// NEW_LANDS_DISCOVERED — coastal + ambitious low-comfort merchant/hunter
// ---------------------------------------------------------------------------
const NEW_LANDS_DISCOVERED: EventSpec = {
  type: "NEW_LANDS_DISCOVERED",
  base: 9,
  render: (ev, w) => `${charName(w, ev.actorId)} sailed beyond the known coasts and returned with word of new lands.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (w.age(c) < 20 || w.age(c) > 55) return false;
      const prov = w.province(c.provinceId);
      if (!prov?.coastal) return false;
      if (c.drives.ambition < 0.6) return false;
      if (c.comfort > 0.4) return false;
      const culture = w.dynasty(c.dynastyId)?.cultureId;
      return culture ? cultureHasTrait(w, c, "mercantile") || cultureHasTrait(w, c, "warrior_culture") : false;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const c = item as Character;
      w.log("NEW_LANDS_DISCOVERED", { actorId: c.id, provinceId: c.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// NAVAL_BATTLE — reactive to WAR where both provinces are coastal
// ---------------------------------------------------------------------------
const NAVAL_BATTLE: EventSpec = {
  type: "NAVAL_BATTLE",
  base: 8,
  render: (ev, w) => `A great fleet action was fought off ${provName(w, ev.provinceId)} — ships burned to the waterline.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "WAR",
    prob: (w, e) => {
      const p = w.province(e.provinceId ?? "");
      if (!p?.coastal) return 0;
      const attacker = w.char(e.actorId);
      if (!attacker) return 0;
      const aProv = w.province(attacker.provinceId);
      if (!aProv?.coastal) return 0;
      return 0.5;
    },
    fire: (w, e) => {
      w.log("NAVAL_BATTLE", {
        actorId: e.actorId,
        targetId: e.targetId,
        titleId: e.titleId,
        provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// SHIPWRECK — reactive to SEA_STORM, possibly kills a coastal character
// ---------------------------------------------------------------------------
const SHIPWRECK: EventSpec = {
  type: "SHIPWRECK",
  base: 7,
  render: (ev, w) => `A great ship broke on the reefs of ${provName(w, ev.provinceId)} — ${charName(w, ev.actorId)} was among the lost.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "SEA_STORM",
    prob: () => 0.2,
    fire: (w, e) => {
      const candidates = w.living().filter((c) =>
        c.provinceId === e.provinceId && w.age(c) >= 16 && w.age(c) <= 60,
      );
      if (candidates.length === 0) return;
      const victim = w.rng.pick(candidates);
      w.log("SHIPWRECK", { actorId: victim.id, provinceId: e.provinceId });
      // Do NOT markDead here — the SHIPWRECK is the story; the underlying
      // death (if any) is a separate concern. Keep this spec pure.
    },
  },
};

// ---------------------------------------------------------------------------
// PLAGUE_SHIP — coastal province with active sea trade partner PLAGUE-hit
// ---------------------------------------------------------------------------
const PLAGUE_SHIP: EventSpec = {
  type: "PLAGUE_SHIP",
  base: 9,
  render: (ev, w) => `A plague ship put in at ${provName(w, ev.provinceId)}, and the pestilence took root before the crew could be quarantined.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "PLAGUE",
    prob: (w, e) => {
      const infected = w.province(e.provinceId ?? "");
      if (!infected) return 0;
      // Any sea trade route connects infected to another coastal province?
      for (const other of w.events) {
        if (other.type !== "TRADE_ROUTE_ESTABLISHED") continue;
        if (other.data["conduit"] !== "sea") continue;
        const from = String(other.data["fromProvinceId"] ?? "");
        const to   = String(other.data["toProvinceId"] ?? "");
        if (from === infected.id || to === infected.id) return 0.3;
      }
      return 0;
    },
    fire: (w, e) => {
      const infected = w.province(e.provinceId ?? "");
      if (!infected) return;
      // Pick the OTHER endpoint of the first matching active sea route.
      for (const other of w.events) {
        if (other.type !== "TRADE_ROUTE_ESTABLISHED") continue;
        if (other.data["conduit"] !== "sea") continue;
        const from = String(other.data["fromProvinceId"] ?? "");
        const to   = String(other.data["toProvinceId"] ?? "");
        const partnerId = from === infected.id ? to : (to === infected.id ? from : null);
        if (!partnerId) continue;
        const partner = w.province(partnerId);
        if (!partner) continue;
        const loss = Math.round(partner.population * 0.1);
        partner.population = Math.max(50, partner.population - loss);
        w.log("PLAGUE_SHIP", { provinceId: partnerId, data: { deaths: loss, sourceProvinceId: infected.id } });
        return;
      }
    },
  },
};

// ---------------------------------------------------------------------------
// TRADING_COMPANY_FORMS — MARKET_MONOPOLY + mercantile culture + 40+ years old
// ---------------------------------------------------------------------------
const TRADING_COMPANY_FORMS: EventSpec = {
  type: "TRADING_COMPANY_FORMS",
  base: 9,
  render: (ev, w) => `A great trading company was chartered at ${provName(w, ev.provinceId)} — it would answer to no single crown.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (!p.coastal) return false;
      // MARKET_MONOPOLY fired here 40+ years ago?
      const monopoly = w.events.find(
        (e) => e.type === "MARKET_MONOPOLY" && e.provinceId === p.id && w.year - e.year >= 40,
      );
      if (!monopoly) return false;
      const title = [...w.titles.values()].find((t) => t.provinceId === p.id);
      const holder = w.char(title?.holderId ?? null);
      if (!holder) return false;
      return cultureHasTrait(w, holder, "mercantile");
    },
    prob: () => 0.1,
    fire: (w, item) => {
      const p = item as Province;
      w.log("TRADING_COMPANY_FORMS", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// LIGHTHOUSE_BUILT — port + wealthy scholar or merchant character in province
// ---------------------------------------------------------------------------
const LIGHTHOUSE_BUILT: EventSpec = {
  type: "LIGHTHOUSE_BUILT",
  base: 6,
  render: (ev, w) => `A lighthouse was raised at ${provName(w, ev.provinceId)} — ships would no longer break blind on the reefs.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (!p.coastal || !isPort(p)) return false;
      // Need a wealthy dynasty holding this or an adjacent province.
      const title = [...w.titles.values()].find((t) => t.provinceId === p.id);
      const holder = w.char(title?.holderId ?? null);
      const dyn = w.dynasty(holder?.dynastyId ?? "");
      if (!dyn || dyn.wealth < 300) return false;
      // AND a scholar or merchant lives at this province.
      return w.living().some((c) =>
        c.provinceId === p.id && (c.charClass === "scholar" || c.charClass === "merchant"),
      );
    },
    prob: () => 0.15,
    fire: (w, item) => {
      const p = item as Province;
      if (!p.zoneFlags.includes("lighthouse")) p.zoneFlags.push("lighthouse");
      w.log("LIGHTHOUSE_BUILT", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// NAVIGATION_CHART_MADE — port + literacy_valued — protects future trade
// ---------------------------------------------------------------------------
const NAVIGATION_CHART_MADE: EventSpec = {
  type: "NAVIGATION_CHART_MADE",
  base: 6,
  render: (ev, w) => `The pilots of ${provName(w, ev.provinceId)} set down the great chart of coasts — routes safer for a generation.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (!p.coastal || !isPort(p)) return false;
      const title = [...w.titles.values()].find((t) => t.provinceId === p.id);
      const holder = w.char(title?.holderId ?? null);
      if (!holder) return false;
      if (!cultureHasTrait(w, holder, "literacy_valued")) return false;
      // A living scholar in the same province.
      return w.living().some((c) => c.provinceId === p.id && c.charClass === "scholar");
    },
    prob: () => 0.06,
    fire: (w, item) => {
      const p = item as Province;
      if (!p.zoneFlags.includes("charted")) p.zoneFlags.push("charted");
      w.log("NAVIGATION_CHART_MADE", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// SEA_MONSTER_SPOTTED — high-mana coastal, a persistent local menace
// ---------------------------------------------------------------------------
const SEA_MONSTER_SPOTTED: EventSpec = {
  type: "SEA_MONSTER_SPOTTED",
  base: 6,
  render: (ev, w) => `Sailors of ${provName(w, ev.provinceId)} spoke of a great sea-thing rising from the deep. Some believed them.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (_w, item) => {
      const p = item as Province;
      return p.coastal && p.manaDensity > 0.4;
    },
    prob: () => 0.04,
    fire: (w, item) => {
      const p = item as Province;
      w.log("SEA_MONSTER_SPOTTED", { provinceId: p.id, data: { mana: p.manaDensity } });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// ISLAND_COLONY_FOUNDED — after NEW_LANDS_DISCOVERED, discoverer's house colonizes
// ---------------------------------------------------------------------------
const ISLAND_COLONY_FOUNDED: EventSpec = {
  type: "ISLAND_COLONY_FOUNDED",
  base: 8,
  render: (ev, w) => `The house of ${String(ev.data["house"] ?? "the discoverer")} planted a colony in the new-found lands beyond ${provName(w, ev.provinceId)}.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "NEW_LANDS_DISCOVERED",
    prob: () => 0.3,
    fire: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return;
      const dyn = w.dynasty(c.dynastyId);
      w.log("ISLAND_COLONY_FOUNDED", {
        actorId: c.id,
        provinceId: e.provinceId,
        data: { house: dyn?.name ?? "" },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// SIREN_LURE — high-mana coast preys on a martial character
// ---------------------------------------------------------------------------
const SIREN_LURE: EventSpec = {
  type: "SIREN_LURE",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} was drawn to the singing rocks off ${provName(w, ev.provinceId)} and was seen no more.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (w.age(c) < 18 || w.age(c) > 50) return false;
      if (c.charClass !== "knight" && c.charClass !== "soldier") return false;
      const p = w.province(c.provinceId);
      return !!p && p.coastal && p.manaDensity > 0.35;
    },
    prob: () => 0.008,
    fire: (w, item) => {
      const c = item as Character;
      w.log("SIREN_LURE", { actorId: c.id, provinceId: c.provinceId });
      // Do NOT markDead — the SIREN_LURE event IS the story; letting fate.ts
      // pick up the disappearance keeps concerns separated. Character stays
      // alive in this pass; expand in a follow-up if desired.
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
export const MARITIME_SPECS: EventSpec[] = [
  SEA_STORM,
  TSUNAMI,
  PIRATE_RAID,
  WHALING_BOOM,
  FISHERY_COLLAPSE,
  NEW_LANDS_DISCOVERED,
  NAVAL_BATTLE,
  SHIPWRECK,
  PLAGUE_SHIP,
  TRADING_COMPANY_FORMS,
  LIGHTHOUSE_BUILT,
  NAVIGATION_CHART_MADE,
  SEA_MONSTER_SPOTTED,
  ISLAND_COLONY_FOUNDED,
  SIREN_LURE,
];
