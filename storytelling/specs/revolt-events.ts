// specs/revolt-events.ts — popular unrest below the noble layer.
//
// The engine already models noble war (goals, claims, wars, sieges) and
// dynasty scheming. This file adds the OTHER kind of political violence —
// peasants, urban mobs, merchants withdrawing labour, tax collectors
// lynched in the countryside. Together with succession-legitimacy these
// give the chronicle a "not just kings and queens" texture.

import type { EventSpec } from "../event-spec.js";
import type { Character, Province } from "../types.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the countryside";
}
function provinceHolder(w: World, provinceId: string): Character | null {
  const title = [...w.titles.values()].find((t) => t.provinceId === provinceId);
  return w.char(title?.holderId ?? null) ?? null;
}
function cultureHasTrait(w: World, c: Character, trait: string): boolean {
  const dyn = w.dynasty(c.dynastyId);
  if (!dyn?.cultureId) return false;
  const state = w.cultureState(dyn.cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(dyn.cultureId)?.startingTraits ?? []).includes(trait);
}
function anyRecentAt(w: World, type: string, provinceId: string, window: number): boolean {
  return w.events.some(
    (e) => e.type === type && e.provinceId === provinceId && w.year - e.year < window,
  );
}

// ---------------------------------------------------------------------------
// PEASANT_REVOLT — agrarian uprising after sustained pressure (blight,
// famine, or high inequality). Wat Tyler, Jacquerie.
// ---------------------------------------------------------------------------
const PEASANT_REVOLT: EventSpec = {
  type: "PEASANT_REVOLT",
  base: 9,
  render: (ev, w) => `Peasants of ${provName(w, ev.provinceId)} rose in open revolt — the scythe, the flail, and the pitchfork against the manor.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.subsurface) return false;
      if (p.population < 200) return false;
      // Only rural (non-city). Any zone flag with "city" would suppress; we
      // approximate with "rural = fertility above minimum".
      const holder = provinceHolder(w, p.id);
      if (!holder) return false;
      // Pressure: FAMINE/BLIGHT within 15 years or extraction culture.
      const distress = w.events.some(
        (e) => (e.type === "FAMINE" || e.type === "BLIGHT_SPREADS" || e.type === "BLIGHT_DEEPENS")
            && e.provinceId === p.id && w.year - e.year < 15,
      );
      const oppressive = cultureHasTrait(w, holder, "caste_rigid")
                      || cultureHasTrait(w, holder, "slavery");
      if (!distress && !oppressive) return false;
      return !anyRecentAt(w, "PEASANT_REVOLT", p.id, 30);
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const p = item as Province;
      w.log("PEASANT_REVOLT", { provinceId: p.id });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// URBAN_MOB_RIOT — the crowd, no clear leader, in a large urban province.
// ---------------------------------------------------------------------------
const URBAN_MOB_RIOT: EventSpec = {
  type: "URBAN_MOB_RIOT",
  base: 7,
  render: (ev, w) => `A mob boiled through the streets of ${provName(w, ev.provinceId)} — grievances no chronicler could name, but violence enough to remember.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.subsurface) return false;
      if (p.population < 400) return false;
      // Rising after any negative event within the last 3 years.
      const distress = w.events.some(
        (e) => e.provinceId === p.id && w.year - e.year < 3
             && (e.type === "PLAGUE" || e.type === "FAMINE" || e.type === "TAX_COLLECTOR_LYNCHED"
              || e.type === "URBAN_MOB_RIOT" || e.type === "FOOD_RIOT"),
      );
      if (!distress) return false;
      return !anyRecentAt(w, "URBAN_MOB_RIOT", p.id, 8);
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const p = item as Province;
      w.log("URBAN_MOB_RIOT", { provinceId: p.id });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// FOOD_RIOT — during or just after a FAMINE in a populous province.
// ---------------------------------------------------------------------------
const FOOD_RIOT: EventSpec = {
  type: "FOOD_RIOT",
  base: 7,
  render: (ev, w) => `A bread riot broke out in ${provName(w, ev.provinceId)} — the granaries were forced open, and the price of a loaf became a chapter in the chronicle.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "FAMINE",
    prob: (w, e) => {
      const p = w.province(e.provinceId ?? "");
      if (!p || p.population < 300) return 0;
      return 0.5;
    },
    fire: (w, e) => {
      w.log("FOOD_RIOT", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// MERCHANT_STRIKE — mercantile culture withholds trade to pressure the crown.
// ---------------------------------------------------------------------------
const MERCHANT_STRIKE: EventSpec = {
  type: "MERCHANT_STRIKE",
  base: 7,
  render: (ev, w) => `The merchants of ${provName(w, ev.provinceId)} closed their books and shuttered their stalls — the crown would meet their terms or go hungry.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.subsurface) return false;
      if (p.population < 300) return false;
      const holder = provinceHolder(w, p.id);
      if (!holder) return false;
      if (!cultureHasTrait(w, holder, "mercantile")) return false;
      return !anyRecentAt(w, "MERCHANT_STRIKE", p.id, 25);
    },
    prob: () => 0.008,
    fire: (w, item) => {
      const p = item as Province;
      w.log("MERCHANT_STRIKE", { provinceId: p.id });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// TAX_COLLECTOR_LYNCHED — rural extraction meets the pitchfork.
// ---------------------------------------------------------------------------
const TAX_COLLECTOR_LYNCHED: EventSpec = {
  type: "TAX_COLLECTOR_LYNCHED",
  base: 6,
  render: (ev, w) => `In ${provName(w, ev.provinceId)} a tax collector was dragged from his horse and killed — the crown's writ ran no further that summer.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.subsurface) return false;
      if (p.population < 100) return false;
      const holder = provinceHolder(w, p.id);
      if (!holder) return false;
      // Extraction cultures OR sustained blight increase the rural friction.
      const oppression = cultureHasTrait(w, holder, "slavery")
                     || cultureHasTrait(w, holder, "caste_rigid")
                     || p.blightLevel > 0.2;
      if (!oppression) return false;
      return !anyRecentAt(w, "TAX_COLLECTOR_LYNCHED", p.id, 12);
    },
    prob: () => 0.01,
    fire: (w, item) => {
      const p = item as Province;
      w.log("TAX_COLLECTOR_LYNCHED", { provinceId: p.id });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
export const REVOLT_SPECS: EventSpec[] = [
  PEASANT_REVOLT,
  URBAN_MOB_RIOT,
  FOOD_RIOT,
  MERCHANT_STRIKE,
  TAX_COLLECTOR_LYNCHED,
];
