// specs/crime-events.ts — individual outlaws, folk-legends of the wrong side.
//
// Robin Hood, Jesse James, the Whitechapel murders, Blackbeard, Colonel
// Blood. Non-noble criminals whose deeds enter the chronicle by weight of
// repetition or symbolic outrage. Distinct from the revolt layer (which is
// collective, agrarian) — these are named individuals.

import type { EventSpec } from "../event-spec.js";
import type { Character, Province, Title } from "../types.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the countryside";
}
function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  return c.name;
}
function anyRecentAt(w: World, type: string, provinceId: string, window: number): boolean {
  return w.events.some(
    (e) => e.type === type && e.provinceId === provinceId && w.year - e.year < window,
  );
}

// ---------------------------------------------------------------------------
// SERIAL_KILLER_STALKS — three or more MURDERs in same province in short span.
// ---------------------------------------------------------------------------
const SERIAL_KILLER_STALKS: EventSpec = {
  type: "SERIAL_KILLER_STALKS",
  base: 8,
  render: (ev, w) => `A serial killer stalked ${provName(w, ev.provinceId)} — three bodies in as many years, no one caught, the chroniclers gave them a name.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      const recentMurders = w.events.filter(
        (e) => e.type === "MURDER" && e.provinceId === p.id && w.year - e.year < 6,
      );
      if (recentMurders.length < 3) return false;
      return !anyRecentAt(w, "SERIAL_KILLER_STALKS", p.id, 30);
    },
    prob: () => 0.4,
    fire: (w, item) => {
      const p = item as Province;
      w.log("SERIAL_KILLER_STALKS", { provinceId: p.id });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// HIGHWAY_ROBBER_LEGEND — a lowborn outlaw becomes folk hero. Robin Hood.
// ---------------------------------------------------------------------------
const HIGHWAY_ROBBER_LEGEND: EventSpec = {
  type: "HIGHWAY_ROBBER_LEGEND",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} became a highway-robber whose name filled the ballads — the countryside told their tale in whispers and songs.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!c.lowborn) return false;
      if (w.age(c) < 22 || w.age(c) > 45) return false;
      if (c.level < 5) return false;
      if (c.drives.ambition < 0.5) return false;
      if (c.drives.greed < 0.5) return false;
      if (w.titlesHeldBy(c.id).length > 0) return false;
      // Province must have a stark inequality signal: caste or slavery.
      const dyn = w.dynasty(c.dynastyId);
      if (!dyn?.cultureId) return false;
      const traits = w.cultureState(dyn.cultureId);
      const starting = w.cultures.get(dyn.cultureId)?.startingTraits ?? [];
      const oppressive = ["caste_rigid", "slavery"].some(
        (t) => traits.eliteTraits.has(t) || traits.folkTraits.has(t) || starting.includes(t),
      );
      return oppressive;
    },
    prob: () => 0.002,
    fire: (w, item) => {
      const c = item as Character;
      w.log("HIGHWAY_ROBBER_LEGEND", { actorId: c.id, provinceId: c.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// PIRATE_BLACK_FLAG — a named pirate captain rises at a coastal province.
// Distinct from PIRATE_RAID (a raid); this is a REPUTATION event.
// ---------------------------------------------------------------------------
const PIRATE_BLACK_FLAG: EventSpec = {
  type: "PIRATE_BLACK_FLAG",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} raised a black flag over the harbours of ${provName(w, ev.provinceId)} — the merchant lords would learn their name in the ledger of their losses.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (w.age(c) < 25 || w.age(c) > 55) return false;
      if (c.level < 6) return false;
      if (c.drives.ambition < 0.6) return false;
      if (w.titlesHeldBy(c.id).length > 0) return false;
      const p = w.province(c.provinceId);
      if (!p?.coastal) return false;
      // Requires a recent PIRATE_RAID at THIS or a neighbouring province.
      const raidNearby = w.events.some(
        (e) => e.type === "PIRATE_RAID" && w.year - e.year < 8
             && (e.provinceId === p.id || p.neighbors.includes(e.provinceId ?? "")),
      );
      return raidNearby;
    },
    prob: () => 0.015,
    fire: (w, item) => {
      const c = item as Character;
      w.log("PIRATE_BLACK_FLAG", { actorId: c.id, provinceId: c.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// MASS_JAILBREAK — dungeon breach in a wealthy or high-pop province. A folk-
// storied event ("prisoners of the Bastille").
// ---------------------------------------------------------------------------
const MASS_JAILBREAK: EventSpec = {
  type: "MASS_JAILBREAK",
  base: 7,
  render: (ev, w) => `A mass jailbreak split open the dungeons of ${provName(w, ev.provinceId)} — chains struck off, guards overpowered, the escapees vanished into the wide countryside.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      if (p.subsurface) return false;
      if (p.population < 300) return false;
      // Recent chaos: revolt, riot, war at this province.
      const chaos = w.events.some(
        (e) => e.provinceId === p.id && w.year - e.year < 5
             && (e.type === "PEASANT_REVOLT" || e.type === "URBAN_MOB_RIOT"
              || e.type === "FOOD_RIOT" || e.type === "WAR"),
      );
      if (!chaos) return false;
      return !anyRecentAt(w, "MASS_JAILBREAK", p.id, 40);
    },
    prob: () => 0.03,
    fire: (w, item) => {
      const p = item as Province;
      w.log("MASS_JAILBREAK", { provinceId: p.id });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// CROWN_JEWELS_STOLEN — symbol-of-power theft (Colonel Blood).
// ---------------------------------------------------------------------------
const CROWN_JEWELS_STOLEN: EventSpec = {
  type: "CROWN_JEWELS_STOLEN",
  base: 9,
  render: (ev, w) => `The crown jewels vanished from the vaults of ${provName(w, ev.provinceId)} — no dungeon held them, no chronicler could name the thief, and the seat of the kingdom sat lighter for it.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom") return false;
      return !w.events.some(
        (e) => e.type === "CROWN_JEWELS_STOLEN" && e.provinceId === t.provinceId,
      );
    },
    prob: () => 0.0015,
    fire: (w, item) => {
      const t = item as Title;
      w.log("CROWN_JEWELS_STOLEN", {
        titleId: t.id, provinceId: t.provinceId, targetId: t.holderId,
      });
    },
    once: "per-province",
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
export const CRIME_SPECS: EventSpec[] = [
  SERIAL_KILLER_STALKS,
  HIGHWAY_ROBBER_LEGEND,
  PIRATE_BLACK_FLAG,
  MASS_JAILBREAK,
  CROWN_JEWELS_STOLEN,
];
