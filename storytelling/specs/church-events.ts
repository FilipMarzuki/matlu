// specs/church-events.ts — high politics of the faith.
//
// The engine has faiths (dynasty.faithId) and a religious layer of miracles,
// saints, temples. This file adds the top-down politics of the faith itself
// — antipopes, schisms, councils, and the two most feared church weapons:
// excommunication and interdict. Fires only in zealous_faith cultures where
// the faith actually has institutional weight.

import type { EventSpec } from "../event-spec.js";
import type { Character } from "../types.js";
import type { World } from "../world.js";

function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown prelate";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the see";
}
function cultureHasTrait(w: World, c: Character, trait: string): boolean {
  const dyn = w.dynasty(c.dynastyId);
  if (!dyn?.cultureId) return false;
  const state = w.cultureState(dyn.cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(dyn.cultureId)?.startingTraits ?? []).includes(trait);
}
function anyRecent(w: World, type: string, window: number): boolean {
  return w.events.some((e) => e.type === type && w.year - e.year < window);
}

// Highest-piety zealous_faith character alive — approximates "the highest
// prelate" without needing a formal church hierarchy.
function highPrelate(w: World): Character | null {
  let best: Character | null = null;
  let bestScore = -1;
  for (const c of w.living()) {
    if (w.age(c) < 30) continue;
    if (!cultureHasTrait(w, c, "zealous_faith")) continue;
    const score = c.drives.piety + (c.level ?? 0) * 0.02;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// ANTIPOPE_ELECTED — rival claimant to the highest prelate's seat.
// ---------------------------------------------------------------------------
const ANTIPOPE_ELECTED: EventSpec = {
  type: "ANTIPOPE_ELECTED",
  base: 10,
  render: (ev, w) => `A rival to the high seat was elected — an antipope crowned in ${provName(w, ev.provinceId)}, and the faith no longer had one voice.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (w.age(c) < 30) return false;
      if (c.drives.piety < 0.55) return false;
      if (c.drives.ambition < 0.65) return false;
      if (!cultureHasTrait(w, c, "zealous_faith")) return false;
      // Requires an existing highest prelate to be a rival to.
      const prelate = highPrelate(w);
      if (!prelate || prelate.id === c.id) return false;
      if (prelate.dynastyId === c.dynastyId) return false;
      return !anyRecent(w, "ANTIPOPE_ELECTED", 40);
    },
    prob: () => 0.003,
    fire: (w, item) => {
      const c = item as Character;
      w.log("ANTIPOPE_ELECTED", {
        actorId: c.id, targetId: highPrelate(w)?.id ?? null, provinceId: c.provinceId,
      });
    },
    once: "world",
  },
};

// ---------------------------------------------------------------------------
// PAPAL_SCHISM — formal split of the faith's leadership after an antipope.
// ---------------------------------------------------------------------------
const PAPAL_SCHISM: EventSpec = {
  type: "PAPAL_SCHISM",
  base: 10,
  render: (ev, w) => `The rival seats hardened — a schism was declared, and half the faithful looked to ${provName(w, ev.provinceId)} while the other half prayed elsewhere.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "ANTIPOPE_ELECTED",
    prob: () => 0.4,
    fire: (w, e) => {
      w.log("PAPAL_SCHISM", { actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId });
    },
  },
};

// ---------------------------------------------------------------------------
// COUNCIL_OF_BISHOPS — a great council to settle doctrine or a schism.
// ---------------------------------------------------------------------------
const COUNCIL_OF_BISHOPS: EventSpec = {
  type: "COUNCIL_OF_BISHOPS",
  base: 9,
  render: (ev, w) => `A great council of bishops was convened at ${provName(w, ev.provinceId)} — canons debated, doctrine set, and the faith's face reshaped.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (w.age(c) < 40) return false;
      if (c.drives.piety < 0.6) return false;
      if (!cultureHasTrait(w, c, "zealous_faith")) return false;
      // A council follows heresy or schism, or is once-a-century otherwise.
      const trigger = anyRecent(w, "PAPAL_SCHISM", 40)
                   || anyRecent(w, "HERESY_TRIAL", 20)
                   || anyRecent(w, "EXCOMMUNICATION_ISSUED", 15);
      if (!trigger) return false;
      return !anyRecent(w, "COUNCIL_OF_BISHOPS", 50);
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const c = item as Character;
      w.log("COUNCIL_OF_BISHOPS", { actorId: c.id, provinceId: c.provinceId });
    },
    once: "world",
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// EXCOMMUNICATION_ISSUED — the highest prelate formally casts a ruler out.
// ---------------------------------------------------------------------------
const EXCOMMUNICATION_ISSUED: EventSpec = {
  type: "EXCOMMUNICATION_ISSUED",
  base: 9,
  render: (ev, w) => `${charName(w, ev.targetId)} was formally excommunicated — the sacraments were withheld and the crown's authority questioned in every parish.`,
  arc: (ev) => ev.targetId ? { key: `P:${ev.targetId}`, kind: "figure" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const target = item as Character;
      if (w.titlesHeldBy(target.id).length === 0) return false;
      // Target must be low-piety or have angered the faith recently.
      if (target.drives.piety > 0.35) return false;
      // Requires a high prelate exists to issue it.
      const prelate = highPrelate(w);
      if (!prelate || prelate.dynastyId === target.dynastyId) return false;
      // Only once per target.
      return !w.events.some(
        (e) => e.type === "EXCOMMUNICATION_ISSUED" && e.targetId === target.id,
      );
    },
    prob: () => 0.008,
    fire: (w, item) => {
      const target = item as Character;
      const prelate = highPrelate(w);
      w.log("EXCOMMUNICATION_ISSUED", {
        actorId: prelate?.id ?? null, targetId: target.id, provinceId: target.provinceId,
      });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// INTERDICT_LAID — an entire region cut off from sacraments. The nuclear
// option, aimed at the whole province not just the ruler.
// ---------------------------------------------------------------------------
const INTERDICT_LAID: EventSpec = {
  type: "INTERDICT_LAID",
  base: 9,
  render: (ev, w) => `An interdict was laid over ${provName(w, ev.provinceId)} — no marriages, no burials, no bells until the crown submitted.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  onEvent: {
    source: "EXCOMMUNICATION_ISSUED",
    prob: (w, e) => {
      // Only if the ruler doubles down (fails to submit). Approximate: if
      // ruler still holds a title 3+ years later — but this is reactive same-
      // year. Simpler: 25% chance the excommunication escalates.
      const c = w.char(e.targetId);
      if (!c) return 0;
      return c.drives.ambition > 0.6 ? 0.35 : 0.15;
    },
    fire: (w, e) => {
      w.log("INTERDICT_LAID", {
        actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
export const CHURCH_SPECS: EventSpec[] = [
  ANTIPOPE_ELECTED,
  PAPAL_SCHISM,
  COUNCIL_OF_BISHOPS,
  EXCOMMUNICATION_ISSUED,
  INTERDICT_LAID,
];
