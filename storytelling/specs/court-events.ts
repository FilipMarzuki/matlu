// specs/court-events.ts — the bedchamber, the boudoir, and the ministry.
//
// Formal succession runs on legitimate marriages. Real courts run on
// concubines, favourite mistresses, gelded ministers who outlast a dynasty,
// and the intrigue that unravels when someone's shadow-cabinet is exposed.
// Distinct from succession-legitimacy (which is about ELIGIBILITY) — this
// is about who actually holds the ruler's ear.

import type { EventSpec } from "../event-spec.js";
import type { Character, Title } from "../types.js";
import type { World } from "../world.js";

function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  return c.name;
}
function titleName(w: World, id: string | null): string {
  return w.title(id)?.name ?? "the crown";
}
function activeConcubine(w: World, rulerId: string): Character | null {
  const ev = w.events.find(
    (e) => e.type === "CONCUBINE_FAVORED" && e.targetId === rulerId,
  );
  return ev ? w.char(ev.actorId) ?? null : null;
}

// ---------------------------------------------------------------------------
// CONCUBINE_FAVORED — high-lust ruler takes a lowborn favourite.
// ---------------------------------------------------------------------------
const CONCUBINE_FAVORED: EventSpec = {
  type: "CONCUBINE_FAVORED",
  base: 6,
  render: (ev, w) => `${charName(w, ev.targetId)} took ${charName(w, ev.actorId)} as a concubine — the court took note, and the queen took none of it well.`,
  arc: (ev) => ev.targetId ? { key: `P:${ev.targetId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom" && t.tier !== "duchy") return false;
      const holder = w.char(t.holderId);
      if (!holder) return false;
      if (w.age(holder) < 25 || w.age(holder) > 55) return false;
      if (holder.drives.lust < 0.55) return false;
      // Already has an active concubine?
      if (activeConcubine(w, holder.id)) return false;
      // A lowborn adult of appropriate age exists at the same province.
      return !!w.living().find(
        (c) => c.provinceId === t.provinceId && c.lowborn && w.age(c) >= 18 && w.age(c) <= 35,
      );
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const t = item as Title;
      const favorite = w.living().find(
        (c) => c.provinceId === t.provinceId && c.lowborn && w.age(c) >= 18 && w.age(c) <= 35,
      );
      if (!favorite) return;
      w.log("CONCUBINE_FAVORED", {
        actorId: favorite.id, targetId: t.holderId, titleId: t.id, provinceId: t.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// CONCUBINE_BEARS_HEIR — Ottoman / Ming pattern. Reactive to a CONCUBINE_
// FAVORED after some years passed. Dynastic implications: the child gets a
// weak claim to the ruler's titles.
// ---------------------------------------------------------------------------
const CONCUBINE_BEARS_HEIR: EventSpec = {
  type: "CONCUBINE_BEARS_HEIR",
  base: 8,
  render: (ev, w) => `The concubine ${charName(w, ev.actorId)} bore a child to the seat of ${titleName(w, ev.titleId)} — the line of succession twisted by the news.`,
  arc: (ev) => ev.targetId ? { key: `P:${ev.targetId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      const concubineEvent = w.events.find(
        (e) => e.type === "CONCUBINE_FAVORED" && e.titleId === t.id
             && w.year - e.year >= 1 && w.year - e.year <= 8,
      );
      if (!concubineEvent) return false;
      const already = w.events.some(
        (e) => e.type === "CONCUBINE_BEARS_HEIR" && e.titleId === t.id,
      );
      return !already;
    },
    prob: () => 0.15,
    fire: (w, item) => {
      const t = item as Title;
      const concubineEvent = w.events.find(
        (e) => e.type === "CONCUBINE_FAVORED" && e.titleId === t.id,
      );
      if (!concubineEvent) return;
      w.log("CONCUBINE_BEARS_HEIR", {
        actorId: concubineEvent.actorId, targetId: t.holderId,
        titleId: t.id, provinceId: t.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// MISTRESS_INFLUENCES_CROWN — de Pompadour analog. A favoured lover starts
// shaping policy. Distinct from FAVORITE_ASCENDS (which is any non-noble).
// ---------------------------------------------------------------------------
const MISTRESS_INFLUENCES_CROWN: EventSpec = {
  type: "MISTRESS_INFLUENCES_CROWN",
  base: 7,
  render: (ev, w) => `The mistress ${charName(w, ev.actorId)} shaped every appointment and every audience of ${charName(w, ev.targetId)}'s court — the true seat of ${titleName(w, ev.titleId)} was her salon.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      const concubineEvent = w.events.find(
        (e) => e.type === "CONCUBINE_FAVORED" && e.titleId === t.id && w.year - e.year >= 5,
      );
      if (!concubineEvent) return false;
      const already = w.events.some(
        (e) => e.type === "MISTRESS_INFLUENCES_CROWN" && e.titleId === t.id,
      );
      return !already;
    },
    prob: () => 0.05,
    fire: (w, item) => {
      const t = item as Title;
      const concubineEvent = w.events.find(
        (e) => e.type === "CONCUBINE_FAVORED" && e.titleId === t.id,
      );
      if (!concubineEvent) return;
      w.log("MISTRESS_INFLUENCES_CROWN", {
        actorId: concubineEvent.actorId, targetId: t.holderId,
        titleId: t.id, provinceId: t.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// EUNUCH_MINISTER_ASCENDS — a gelded court official runs the palace.
// Fires in caste_rigid cultures with a high-piety, low-lust, high-int
// lowborn adult — approximated via low-lust + low-ambition-but-high-piety.
// ---------------------------------------------------------------------------
const EUNUCH_MINISTER_ASCENDS: EventSpec = {
  type: "EUNUCH_MINISTER_ASCENDS",
  base: 7,
  render: (ev, w) => `${charName(w, ev.actorId)}, a gelded servant of the palace, rose to run the ministry of ${titleName(w, ev.titleId)} — no dynasty could name him kin, and no dynasty could dismiss him.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (!c.lowborn) return false;
      if (w.age(c) < 30 || w.age(c) > 60) return false;
      if (c.drives.lust > 0.2) return false;
      if (c.drives.piety < 0.55) return false;
      // Must be in a caste_rigid province with a titled ruler.
      const dyn = w.dynasty(c.dynastyId);
      if (!dyn?.cultureId) return false;
      const state = w.cultureState(dyn.cultureId);
      const starting = w.cultures.get(dyn.cultureId)?.startingTraits ?? [];
      const casteish = state.eliteTraits.has("caste_rigid")
                    || state.folkTraits.has("caste_rigid")
                    || starting.includes("caste_rigid");
      if (!casteish) return false;
      return !w.events.some((e) => e.type === "EUNUCH_MINISTER_ASCENDS" && e.actorId === c.id);
    },
    prob: () => 0.004,
    fire: (w, item) => {
      const c = item as Character;
      const t = [...w.titles.values()].find((x) => x.provinceId === c.provinceId);
      w.log("EUNUCH_MINISTER_ASCENDS", {
        actorId: c.id, titleId: t?.id ?? null, provinceId: c.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// COURT_INTRIGUE_UNRAVELS — a shadow cabinet is exposed. Fires reactive to
// a MURDER or a FAVORITE_ASCENDS in a court that already has a mistress /
// concubine / eunuch minister in play.
// ---------------------------------------------------------------------------
const COURT_INTRIGUE_UNRAVELS: EventSpec = {
  type: "COURT_INTRIGUE_UNRAVELS",
  base: 8,
  render: (ev, w) => `A web of court intrigue unravelled at ${titleName(w, ev.titleId)} — favourites unmasked, ministers denounced, and the audience chamber emptied of every friendly face.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      const shadows = w.events.filter(
        (e) => e.titleId === t.id && w.year - e.year < 20
             && (e.type === "MISTRESS_INFLUENCES_CROWN"
              || e.type === "EUNUCH_MINISTER_ASCENDS"
              || e.type === "FAVORITE_ASCENDS"),
      );
      if (shadows.length < 2) return false;
      const already = w.events.some(
        (e) => e.type === "COURT_INTRIGUE_UNRAVELS" && e.titleId === t.id && w.year - e.year < 30,
      );
      return !already;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const t = item as Title;
      w.log("COURT_INTRIGUE_UNRAVELS", {
        titleId: t.id, provinceId: t.provinceId, targetId: t.holderId,
      });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
export const COURT_SPECS: EventSpec[] = [
  CONCUBINE_FAVORED,
  CONCUBINE_BEARS_HEIR,
  MISTRESS_INFLUENCES_CROWN,
  EUNUCH_MINISTER_ASCENDS,
  COURT_INTRIGUE_UNRAVELS,
];
