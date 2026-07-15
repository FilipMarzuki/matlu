// specs/faction-events.ts — 12 faction / organisational-emergence specs.
//
// Factions are the "third estate" between the noble houses and the pops —
// organisations that outlast any individual member. Knightly orders, thieves'
// guilds, merchant leagues, monastic circles. They emerge from patterns in
// state (repeat murders → thieves' guild; multiple challenge kills at one
// province → adventurers' guild hall).

import type { EventSpec } from "../event-spec.js";
import type { Character, Province } from "../types.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the land";
}
function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function provinceHolderCulture(w: World, provinceId: string): string | null {
  const title = [...w.titles.values()].find((t) => t.provinceId === provinceId);
  const holder = w.char(title?.holderId ?? null);
  return holder ? (w.dynasty(holder.dynastyId)?.cultureId ?? null) : null;
}
function traitAt(w: World, provinceId: string, trait: string): boolean {
  const cultureId = provinceHolderCulture(w, provinceId);
  if (!cultureId) return false;
  const state = w.cultureState(cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(cultureId)?.startingTraits ?? []).includes(trait);
}
function countInProvince(w: World, provinceId: string, cls: string): number {
  let n = 0;
  for (const c of w.living()) {
    if (c.provinceId !== provinceId) continue;
    if (c.charClass === cls) n++;
  }
  return n;
}
function countRecentEventsAtProvince(w: World, type: string, provinceId: string, window: number): number {
  let n = 0;
  for (const e of w.events) {
    if (e.type !== type) continue;
    if (e.provinceId !== provinceId) continue;
    if (w.year - e.year > window) continue;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// KNIGHTLY_ORDER_FOUNDED — warrior_culture + 3+ knights in one province
// ---------------------------------------------------------------------------
const KNIGHTLY_ORDER_FOUNDED: EventSpec = {
  type: "KNIGHTLY_ORDER_FOUNDED",
  base: 8,
  render: (ev, w) => `A knightly order was founded at ${provName(w, ev.provinceId)} — its sworn blades would answer to no single crown.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (countInProvince(w, p.id, "knight") < 3) return false;
      return traitAt(w, p.id, "warrior_culture");
    },
    prob: () => 0.08,
    fire: (w, item) => {
      const p = item as Province;
      w.log("KNIGHTLY_ORDER_FOUNDED", { provinceId: p.id, data: { knights: countInProvince(w, p.id, "knight") } });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// THIEVES_GUILD_FORMS — 3+ MURDERs at same province within 30 years
// ---------------------------------------------------------------------------
const THIEVES_GUILD_FORMS: EventSpec = {
  type: "THIEVES_GUILD_FORMS",
  base: 7,
  render: (ev, w) => `In the shadows of ${provName(w, ev.provinceId)}, a thieves' guild took shape — after so many murders, the criminal element had learned to organise.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.population < 200) return false;
      return countRecentEventsAtProvince(w, "MURDER", p.id, 30) >= 3;
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const p = item as Province;
      w.log("THIEVES_GUILD_FORMS", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// MERCHANT_LEAGUE_FORMED — province is endpoint of 3+ trade routes (built on
// existing MARKET_MONOPOLY logic but distinct: the LEAGUE is the merchants
// organising themselves rather than the province becoming a hub)
// ---------------------------------------------------------------------------
const MERCHANT_LEAGUE_FORMED: EventSpec = {
  type: "MERCHANT_LEAGUE_FORMED",
  base: 7,
  render: (ev, w) => `The merchants of ${provName(w, ev.provinceId)} bound themselves into a league — a common purse, common law, common enemies.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      let routes = 0;
      for (const e of w.events) {
        if (e.type !== "TRADE_ROUTE_ESTABLISHED") continue;
        const from = String(e.data["fromProvinceId"] ?? "");
        const to   = String(e.data["toProvinceId"] ?? "");
        if (from !== p.id && to !== p.id) continue;
        routes++;
      }
      if (routes < 3) return false;
      return countInProvince(w, p.id, "merchant") >= 2;
    },
    prob: () => 0.15,
    fire: (w, item) => {
      const p = item as Province;
      w.log("MERCHANT_LEAGUE_FORMED", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// HERETIC_MOVEMENT — zealous_faith culture under internal contest
// ---------------------------------------------------------------------------
const HERETIC_MOVEMENT: EventSpec = {
  type: "HERETIC_MOVEMENT",
  base: 8,
  render: (ev, w) => `A heretical movement gathered strength in ${provName(w, ev.provinceId)} — the old orthodoxy would answer.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "CULTURAL_CONTESTED",
    prob: (_w, e) => e.data["trait"] === "zealous_faith" ? 0.5 : 0,
    fire: (w, e) => {
      const cultureId = String(e.data["culture"] ?? "");
      const provinces = [...w.provinces.values()].filter((p) => provinceHolderCulture(w, p.id) === cultureId);
      if (provinces.length === 0) return;
      const p = w.rng.pick(provinces);
      w.log("HERETIC_MOVEMENT", { provinceId: p.id, data: { culture: cultureId } });
    },
  },
};

// ---------------------------------------------------------------------------
// ROYAL_INQUISITION — HERESY_TRIAL institutionalises into standing office
// ---------------------------------------------------------------------------
const ROYAL_INQUISITION: EventSpec = {
  type: "ROYAL_INQUISITION",
  base: 9,
  render: (ev, w) => `A royal inquisition was chartered at ${provName(w, ev.provinceId)} — heresy would no longer be tried case by case but hunted as policy.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "HERESY_TRIAL",
    prob: (w, e) => {
      // Only if this is the SECOND heresy trial at this province — the first
      // is a moment, the second is a pattern.
      const count = w.events.filter((x) =>
        x.type === "HERESY_TRIAL" && x.provinceId === e.provinceId,
      ).length;
      return count >= 2 ? 0.4 : 0;
    },
    fire: (w, e) => {
      const already = w.events.some(
        (x) => x.type === "ROYAL_INQUISITION" && x.provinceId === e.provinceId,
      );
      if (already) return;
      w.log("ROYAL_INQUISITION", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// MASONS_GUILD_CHARTERED — reactive to LIBRARY_FOUNDED + literacy_valued
// ---------------------------------------------------------------------------
const MASONS_GUILD_CHARTERED: EventSpec = {
  type: "MASONS_GUILD_CHARTERED",
  base: 7,
  render: (ev, w) => `The masons of ${provName(w, ev.provinceId)} organised into a guild — the stone-work of a generation would be theirs.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "LIBRARY_FOUNDED",
    prob: (w, e) => {
      const cultureId = provinceHolderCulture(w, e.provinceId ?? "");
      if (!cultureId) return 0;
      const state = w.cultureState(cultureId);
      const has = state.eliteTraits.has("literacy_valued") || state.folkTraits.has("literacy_valued")
               || (w.cultures.get(cultureId)?.startingTraits ?? []).includes("literacy_valued");
      return has ? 0.5 : 0;
    },
    fire: (w, e) => {
      w.log("MASONS_GUILD_CHARTERED", { provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// ADVENTURERS_GUILD_HALL — 3+ CHALLENGE_VANQUISHED at same province
// ---------------------------------------------------------------------------
const ADVENTURERS_GUILD_HALL: EventSpec = {
  type: "ADVENTURERS_GUILD_HALL",
  base: 8,
  render: (ev, w) => `An adventurers' guild hall was raised at ${provName(w, ev.provinceId)} — heroes had made a habit of this coast.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      const vanq = w.events.filter(
        (e) => e.type === "CHALLENGE_VANQUISHED" && e.provinceId === p.id,
      ).length;
      return vanq >= 3;
    },
    prob: () => 0.2,
    fire: (w, item) => {
      const p = item as Province;
      w.log("ADVENTURERS_GUILD_HALL", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// MERCENARY_COMPANY_RAISED — reactive to WAR + wealthy dynasty
// ---------------------------------------------------------------------------
const MERCENARY_COMPANY_RAISED: EventSpec = {
  type: "MERCENARY_COMPANY_RAISED",
  base: 6,
  render: (ev, w) => `${charName(w, ev.actorId)} raised a company of mercenaries — silver, not blood, would answer the war.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "WAR",
    prob: (w, e) => {
      const holder = w.char(e.actorId);
      const dyn = w.dynasty(holder?.dynastyId ?? "");
      if (!dyn || dyn.wealth < 500) return 0;
      return 0.15;
    },
    fire: (w, e) => {
      w.log("MERCENARY_COMPANY_RAISED", {
        actorId: e.actorId,
        provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// BANDIT_KING_RISES — vacant title + high pop + no war 20y + ambitious warrior
// ---------------------------------------------------------------------------
const BANDIT_KING_RISES: EventSpec = {
  type: "BANDIT_KING_RISES",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} became a bandit king — in the vacuum of ${provName(w, ev.provinceId)}, sworn men followed the outlaw.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (c.drives.ambition < 0.7) return false;
      if (c.charClass !== "soldier" && c.charClass !== "hunter" && c.charClass !== "knight") return false;
      if (w.titlesHeldBy(c.id).length > 0) return false;
      const prov = w.province(c.provinceId);
      if (!prov || prov.population < 200) return false;
      // Is this province's title vacant?
      const title = [...w.titles.values()].find((t) => t.provinceId === c.provinceId);
      if (title?.holderId) return false;
      // No recent WAR here
      const recentWar = w.events.some(
        (e) => e.type === "WAR" && e.provinceId === c.provinceId && w.year - e.year < 20,
      );
      return !recentWar;
    },
    prob: () => 0.08,
    fire: (w, item) => {
      const c = item as Character;
      w.log("BANDIT_KING_RISES", { actorId: c.id, provinceId: c.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// ASSASSINS_LODGE_FOUNDED — 3+ MURDERs where actor is in same dynasty
// ---------------------------------------------------------------------------
const ASSASSINS_LODGE_FOUNDED: EventSpec = {
  type: "ASSASSINS_LODGE_FOUNDED",
  base: 8,
  render: (ev, _w) => {
    const house = String(ev.data["house"] ?? "an old house");
    return `An assassins' lodge was traced back to house ${house} — the killings had a pattern that not even nobles could hide.`;
  },
  arc: (ev) => {
    const h = String(ev.data["house"] ?? "");
    return h ? { key: `D:${h}`, kind: "dynasty" } : null;
  },
  ambient: {
    scan: "dynasties",
    gate: (w, item) => {
      const dyn = item as { id: string; name: string };
      let murders = 0;
      for (const e of w.events) {
        if (e.type !== "MURDER") continue;
        const killer = w.char(e.actorId);
        if (killer?.dynastyId === dyn.id) murders++;
      }
      return murders >= 3;
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const dyn = item as { name: string };
      w.log("ASSASSINS_LODGE_FOUNDED", { data: { house: dyn.name } });
    },
    once: "world",
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// PIRATE_CONFEDERATION — 3+ PIRATE_RAID at same province
// ---------------------------------------------------------------------------
const PIRATE_CONFEDERATION: EventSpec = {
  type: "PIRATE_CONFEDERATION",
  base: 9,
  render: (ev, w) => `The pirates that had preyed on ${provName(w, ev.provinceId)} joined into a confederation — the coast became a lawless kingdom of its own.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (!p.coastal) return false;
      const raids = w.events.filter(
        (e) => e.type === "PIRATE_RAID" && e.provinceId === p.id,
      ).length;
      return raids >= 3;
    },
    prob: () => 0.15,
    fire: (w, item) => {
      const p = item as Province;
      w.log("PIRATE_CONFEDERATION", { provinceId: p.id });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
// WITCHCOVEN_FORMS — high mana + no zealous_faith + necro/stormcaller present
// ---------------------------------------------------------------------------
const WITCHCOVEN_FORMS: EventSpec = {
  type: "WITCHCOVEN_FORMS",
  base: 8,
  render: (ev, w) => `A witch-coven gathered secretly in ${provName(w, ev.provinceId)} — where the faith had not taken root, the older arts remained.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.manaDensity < 0.5) return false;
      const cultureId = provinceHolderCulture(w, p.id);
      if (!cultureId) return false;
      const state = w.cultureState(cultureId);
      const zealous = state.eliteTraits.has("zealous_faith") || state.folkTraits.has("zealous_faith")
                    || (w.cultures.get(cultureId)?.startingTraits ?? []).includes("zealous_faith");
      if (zealous) return false;
      // Need a mage-class character in province.
      return w.living().some((c) =>
        c.provinceId === p.id && (c.charClass === "necromancer" || c.charClass === "stormcaller"),
      );
    },
    prob: () => 0.06,
    fire: (w, item) => {
      const p = item as Province;
      w.log("WITCHCOVEN_FORMS", { provinceId: p.id, data: { mana: p.manaDensity } });
    },
    once: "per-province",
  },
};

// ---------------------------------------------------------------------------
export const FACTION_SPECS: EventSpec[] = [
  KNIGHTLY_ORDER_FOUNDED,
  THIEVES_GUILD_FORMS,
  MERCHANT_LEAGUE_FORMED,
  HERETIC_MOVEMENT,
  ROYAL_INQUISITION,
  MASONS_GUILD_CHARTERED,
  ADVENTURERS_GUILD_HALL,
  MERCENARY_COMPANY_RAISED,
  BANDIT_KING_RISES,
  ASSASSINS_LODGE_FOUNDED,
  PIRATE_CONFEDERATION,
  WITCHCOVEN_FORMS,
];
