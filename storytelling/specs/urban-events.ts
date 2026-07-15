// specs/urban-events.ts — 12 civic/urban-life specs.
//
// The rhythm of city life between the great catastrophes and dynastic wars:
// markets, festivals, tax revolts, tournaments, public works. Events that
// give a chronicle its "meanwhile, in the streets" texture.

import type { EventSpec } from "../event-spec.js";
import type { Character, Province } from "../types.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the city";
}
function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function provinceHolder(w: World, provinceId: string): Character | null {
  const title = [...w.titles.values()].find((t) => t.provinceId === provinceId);
  return w.char(title?.holderId ?? null) ?? null;
}
function traitAt(w: World, provinceId: string, trait: string): boolean {
  const holder = provinceHolder(w, provinceId);
  const cultureId = holder ? w.dynasty(holder.dynastyId)?.cultureId : null;
  if (!cultureId) return false;
  const state = w.cultureState(cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(cultureId)?.startingTraits ?? []).includes(trait);
}
function anyRecentEvent(w: World, type: string, provinceId: string, window: number): boolean {
  return w.events.some(
    (e) => e.type === type && e.provinceId === provinceId && w.year - e.year < window,
  );
}

// ---------------------------------------------------------------------------
// MARKETPLACE_RIOT — famine or high pop pressure with weak governance
// ---------------------------------------------------------------------------
const MARKETPLACE_RIOT: EventSpec = {
  type: "MARKETPLACE_RIOT",
  base: 6,
  render: (ev, w) => `A marketplace riot broke out in ${provName(w, ev.provinceId)} — bread was in short supply, and the guards outnumbered.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "FAMINE",
    prob: (w, e) => {
      const p = w.province(e.provinceId ?? "");
      if (!p || p.population < 150) return 0;
      return 0.35;
    },
    fire: (w, e) => {
      w.log("MARKETPLACE_RIOT", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// FESTIVAL_HELD — 10+ years no famine/plague, stable ruler
// ---------------------------------------------------------------------------
const FESTIVAL_HELD: EventSpec = {
  type: "FESTIVAL_HELD",
  base: 4,
  render: (ev, w) => `A great festival was held in ${provName(w, ev.provinceId)} — the streets were hung with lanterns and the taverns full.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.population < 200) return false;
      if (anyRecentEvent(w, "FAMINE", p.id, 10)) return false;
      if (anyRecentEvent(w, "PLAGUE", p.id, 10)) return false;
      if (anyRecentEvent(w, "WAR", p.id, 10)) return false;
      return !!provinceHolder(w, p.id);
    },
    prob: () => 0.06,
    fire: (w, item) => {
      const p = item as Province;
      w.log("FESTIVAL_HELD", { provinceId: p.id });
    },
    maxPerTick: 2, // multiple provinces can festival same year
  },
};

// ---------------------------------------------------------------------------
// ROYAL_TOUR — old kingdom-tier ruler + no war
// ---------------------------------------------------------------------------
const ROYAL_TOUR: EventSpec = {
  type: "ROYAL_TOUR",
  base: 6,
  render: (ev, w) => `${charName(w, ev.actorId)} made a royal tour of the realm — old faces saw their king, and old grievances were remembered.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const title = item as { tier: string; provinceId: string; holderId: string | null };
      if (title.tier !== "kingdom") return false;
      const holder = w.char(title.holderId);
      if (!holder) return false;
      if (w.age(holder) < 40) return false;
      return !anyRecentEvent(w, "WAR", title.provinceId, 8);
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const title = item as { id: string; provinceId: string; holderId: string | null };
      w.log("ROYAL_TOUR", { actorId: title.holderId, titleId: title.id, provinceId: title.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// GRAND_FAIR — MERCHANT_LEAGUE + years of peace
// ---------------------------------------------------------------------------
const GRAND_FAIR: EventSpec = {
  type: "GRAND_FAIR",
  base: 6,
  render: (ev, w) => `The grand fair of ${provName(w, ev.provinceId)} drew traders from far coasts — silver flowed through the province like a second river.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "MERCHANT_LEAGUE_FORMED",
    prob: () => 0.6,
    fire: (w, e) => {
      w.log("GRAND_FAIR", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// PLAGUE_QUARANTINE — coastal PLAGUE + literacy_valued holder
// ---------------------------------------------------------------------------
const PLAGUE_QUARANTINE: EventSpec = {
  type: "PLAGUE_QUARANTINE",
  base: 7,
  render: (ev, w) => `The port of ${provName(w, ev.provinceId)} was quarantined — the pilots turned back ships from the plague-touched coast, and the port paid dearly for it.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "PLAGUE",
    prob: (w, e) => {
      const p = w.province(e.provinceId ?? "");
      if (!p?.coastal) return 0;
      return traitAt(w, p.id, "literacy_valued") ? 0.5 : 0;
    },
    fire: (w, e) => {
      w.log("PLAGUE_QUARANTINE", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// PUBLIC_WORKS_BEGUN — guild + wealth + no war for 20y
// ---------------------------------------------------------------------------
const PUBLIC_WORKS_BEGUN: EventSpec = {
  type: "PUBLIC_WORKS_BEGUN",
  base: 6,
  render: (ev, w) => `The great works of ${provName(w, ev.provinceId)} broke ground — aqueducts, walls, a bridge that would outlast the ruler who built it.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      // Any guild event at this province.
      const hasGuild = w.events.some(
        (e) => (e.type === "MASONS_GUILD_CHARTERED" || e.type === "MERCHANT_LEAGUE_FORMED"
             || e.type === "GUILD_CHARTERED") && e.provinceId === p.id,
      );
      if (!hasGuild) return false;
      const holder = provinceHolder(w, p.id);
      const dyn = w.dynasty(holder?.dynastyId ?? "");
      if (!dyn || dyn.wealth < 400) return false;
      return !anyRecentEvent(w, "WAR", p.id, 20);
    },
    prob: () => 0.1,
    fire: (w, item) => {
      const p = item as Province;
      w.log("PUBLIC_WORKS_BEGUN", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// TAX_REVOLT — caste_rigid or slavery culture with wealth extraction
// ---------------------------------------------------------------------------
const TAX_REVOLT: EventSpec = {
  type: "TAX_REVOLT",
  base: 7,
  render: (ev, w) => `A tax revolt gripped ${provName(w, ev.provinceId)} — the tithes had grown too heavy, and the collectors were driven from the streets.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.population < 150) return false;
      const holder = provinceHolder(w, p.id);
      const dyn = w.dynasty(holder?.dynastyId ?? "");
      if (!dyn || dyn.wealth < 600) return false;
      return traitAt(w, p.id, "caste_rigid") || traitAt(w, p.id, "slavery");
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const p = item as Province;
      w.log("TAX_REVOLT", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// GRAND_TOURNAMENT — knightly order + peace + kingdom holder
// ---------------------------------------------------------------------------
const GRAND_TOURNAMENT: EventSpec = {
  type: "GRAND_TOURNAMENT",
  base: 6,
  render: (ev, w) => `A grand tournament was hosted at ${provName(w, ev.provinceId)} — knights of the great houses gathered to prove their steel.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      const hasOrder = w.events.some(
        (e) => e.type === "KNIGHTLY_ORDER_FOUNDED" && e.provinceId === p.id,
      );
      if (!hasOrder) return false;
      return !anyRecentEvent(w, "WAR", p.id, 5);
    },
    prob: () => 0.2,
    fire: (w, item) => {
      const p = item as Province;
      w.log("GRAND_TOURNAMENT", { provinceId: p.id });
    },
  },
};

// ---------------------------------------------------------------------------
// MAY_DAY_PARADE — mercantile + peace + coastal
// ---------------------------------------------------------------------------
const MAY_DAY_PARADE: EventSpec = {
  type: "MAY_DAY_PARADE",
  base: 4,
  render: (ev, w) => `The May Day parade wound through ${provName(w, ev.provinceId)} — flowers in every window, ribbons on every mast.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (!p.coastal) return false;
      if (!traitAt(w, p.id, "mercantile")) return false;
      return !anyRecentEvent(w, "WAR", p.id, 5) && !anyRecentEvent(w, "PLAGUE", p.id, 5);
    },
    prob: () => 0.1,
    fire: (w, item) => {
      const p = item as Province;
      w.log("MAY_DAY_PARADE", { provinceId: p.id });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// STREET_PROPHET — DARK_PROPHET_RISES + high pop
// ---------------------------------------------------------------------------
const STREET_PROPHET: EventSpec = {
  type: "STREET_PROPHET",
  base: 5,
  render: (ev, w) => `A street prophet drew crowds in ${provName(w, ev.provinceId)} — the doctrines were confused, but the crowd was not.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "DARK_PROPHET_RISES",
    prob: (w, e) => {
      const p = w.province(e.provinceId ?? "");
      return p && p.population > 250 ? 0.4 : 0;
    },
    fire: (w, e) => {
      w.log("STREET_PROPHET", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// ARCHITECT_APPRENTICED — MASONS_GUILD_CHARTERED + scholar in province
// ---------------------------------------------------------------------------
const ARCHITECT_APPRENTICED: EventSpec = {
  type: "ARCHITECT_APPRENTICED",
  base: 5,
  render: (ev, w) => `${charName(w, ev.actorId)} took up the architect's rule and compass in ${provName(w, ev.provinceId)}.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "MASONS_GUILD_CHARTERED",
    prob: (w, e) => {
      const scholar = w.living().find((c) => c.provinceId === e.provinceId && c.charClass === "scholar");
      return scholar ? 0.6 : 0;
    },
    fire: (w, e) => {
      const scholar = w.living().find((c) => c.provinceId === e.provinceId && c.charClass === "scholar");
      if (!scholar) return;
      w.log("ARCHITECT_APPRENTICED", { actorId: scholar.id, provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// CIVIC_FEUD — rival houses in same province + recent MURDER
// ---------------------------------------------------------------------------
const CIVIC_FEUD: EventSpec = {
  type: "CIVIC_FEUD",
  base: 7,
  render: (ev, w) => `A civic feud between two great houses of ${provName(w, ev.provinceId)} turned the streets into a battleground of livery and dagger.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "MURDER",
    prob: (w, e) => {
      const killer = w.char(e.actorId);
      const victim = w.char(e.targetId);
      if (!killer || !victim) return 0;
      if (killer.dynastyId === victim.dynastyId) return 0; // kinslaying, not civic feud
      if (killer.provinceId !== victim.provinceId) return 0;
      const p = w.province(killer.provinceId);
      if (!p || p.population < 200) return 0;
      return 0.2;
    },
    fire: (w, e) => {
      const killer = w.char(e.actorId);
      if (!killer) return;
      w.log("CIVIC_FEUD", { provinceId: killer.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
export const URBAN_SPECS: EventSpec[] = [
  MARKETPLACE_RIOT,
  FESTIVAL_HELD,
  ROYAL_TOUR,
  GRAND_FAIR,
  PLAGUE_QUARANTINE,
  PUBLIC_WORKS_BEGUN,
  TAX_REVOLT,
  GRAND_TOURNAMENT,
  MAY_DAY_PARADE,
  STREET_PROPHET,
  ARCHITECT_APPRENTICED,
  CIVIC_FEUD,
];
