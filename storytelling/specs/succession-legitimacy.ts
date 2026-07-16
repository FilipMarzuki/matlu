// specs/succession-legitimacy.ts — the ambiguity of blood.
//
// Medieval politics runs on the messy question of who ELIGIBLE. Bastards
// acknowledged, pretenders appearing, regencies, child-kings, incapacitated
// rulers, abdications, favorites who become the actual power. Everything
// upstream of formal succession that shapes who gets to rule.

import type { EventSpec } from "../event-spec.js";
import type { Character, Title } from "../types.js";
import type { World } from "../world.js";

function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function titleName(w: World, id: string | null): string {
  return w.title(id)?.name ?? "a title";
}

// ---------------------------------------------------------------------------
// BASTARD_ACKNOWLEDGED — a titled ruler acknowledges a natural child
// ---------------------------------------------------------------------------
const BASTARD_ACKNOWLEDGED: EventSpec = {
  type: "BASTARD_ACKNOWLEDGED",
  base: 7,
  render: (ev, w) => `${charName(w, ev.actorId)} publicly acknowledged an unnamed natural child — the succession grew suddenly less simple.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom" && t.tier !== "duchy") return false;
      const h = w.char(t.holderId);
      if (!h) return false;
      if (w.age(h) < 30) return false;
      return h.drives.lust > 0.5;
    },
    prob: () => 0.008,
    fire: (w, item) => {
      const t = item as Title;
      w.log("BASTARD_ACKNOWLEDGED", {
        actorId: t.holderId, titleId: t.id, provinceId: t.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// BASTARD_LEGITIMIZED — a prior BASTARD_ACKNOWLEDGED gets formal recognition
// (William-the-Conqueror pattern)
// ---------------------------------------------------------------------------
const BASTARD_LEGITIMIZED: EventSpec = {
  type: "BASTARD_LEGITIMIZED",
  base: 9,
  render: (ev, w) => `${charName(w, ev.actorId)} was formally legitimized — a bastard now stood in the line of succession.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "BASTARD_ACKNOWLEDGED",
    prob: (w, e) => {
      // Ruler must still hold the title AND have no other living heir.
      const holder = w.char(e.actorId);
      const title = w.title(e.titleId);
      if (!holder || !title || title.holderId !== holder.id) return 0;
      const kids = w.livingChildren(holder).length;
      // Legitimize only when the ruler has no other legitimate kids to inherit.
      return kids === 0 ? 0.3 : 0;
    },
    fire: (w, e) => {
      w.log("BASTARD_LEGITIMIZED", {
        actorId: e.actorId, titleId: e.titleId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// SECRET_HEIR_DISCOVERED — a hidden royal child is revealed
// ---------------------------------------------------------------------------
const SECRET_HEIR_DISCOVERED: EventSpec = {
  type: "SECRET_HEIR_DISCOVERED",
  base: 9,
  render: (ev, w) => `A secret heir to ${titleName(w, ev.titleId)} was discovered — the succession would be contested by a claimant no one had counted.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  onEvent: {
    source: "DYNASTY_EXTINCT",
    prob: () => 0.15,
    fire: (w, e) => {
      // Pick a random title recently held by that dynasty.
      const house = String(e.data["house"] ?? "");
      const t = [...w.titles.values()].find((x) => {
        const holder = w.char(x.holderId);
        return holder && w.dynasty(holder.dynastyId)?.name === house;
      });
      w.log("SECRET_HEIR_DISCOVERED", {
        titleId: t?.id ?? null, provinceId: t?.provinceId ?? null,
        data: { house },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// PRETENDER_APPEARS — a false claimant to a vacant or contested title
// ---------------------------------------------------------------------------
const PRETENDER_APPEARS: EventSpec = {
  type: "PRETENDER_APPEARS",
  base: 8,
  render: (ev, w) => `A pretender claiming ${titleName(w, ev.titleId)} appeared out of the countryside — the truth of their blood was fiercely disputed.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom" && t.tier !== "duchy") return false;
      // Recent SUCCESSION_CRISIS at this title?
      return w.events.some(
        (e) => e.type === "SUCCESSION_CRISIS" && e.titleId === t.id && w.year - e.year < 20,
      );
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const t = item as Title;
      w.log("PRETENDER_APPEARS", { titleId: t.id, provinceId: t.provinceId });
    },
    once: "per-actor", // per-title in effect since actorId isn't set — but this is once per title-scan-key
  },
};

// ---------------------------------------------------------------------------
// PRETENDER_UNMASKED — a prior pretender is exposed
// ---------------------------------------------------------------------------
const PRETENDER_UNMASKED: EventSpec = {
  type: "PRETENDER_UNMASKED",
  base: 8,
  render: (ev, w) => `The pretender to ${titleName(w, ev.titleId)} was unmasked — evidence of forged birth, false claim, and a broken campaign.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      // Prior PRETENDER_APPEARS at this title, no follow-up yet.
      const appeared = w.events.some(
        (e) => e.type === "PRETENDER_APPEARS" && e.titleId === t.id && w.year - e.year >= 3,
      );
      const unmasked = w.events.some(
        (e) => e.type === "PRETENDER_UNMASKED" && e.titleId === t.id,
      );
      return appeared && !unmasked;
    },
    prob: () => 0.15,
    fire: (w, item) => {
      const t = item as Title;
      w.log("PRETENDER_UNMASKED", { titleId: t.id, provinceId: t.provinceId });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// CHILD_KING_CROWNED — SUCCESSION where heir_age < 12
// ---------------------------------------------------------------------------
const CHILD_KING_CROWNED: EventSpec = {
  type: "CHILD_KING_CROWNED",
  base: 8,
  render: (ev, w) => `A child of ${Number(ev.data["age"] ?? 0)} years was crowned to ${titleName(w, ev.titleId)} — the great houses circled at once.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  onEvent: {
    source: "SUCCESSION",
    prob: (_w, e) => {
      const age = Number(e.data["heir_age"] ?? 99);
      const isKing = e.titleId !== null; // any title, we'll gate on tier via title lookup in fire
      return age < 12 && isKing ? 1.0 : 0;
    },
    fire: (w, e) => {
      const t = w.title(e.titleId);
      if (t?.tier !== "kingdom" && t?.tier !== "duchy") return;
      w.log("CHILD_KING_CROWNED", {
        actorId: e.actorId, titleId: e.titleId, provinceId: e.provinceId,
        data: { age: e.data["heir_age"] },
      });
    },
  },
};

// ---------------------------------------------------------------------------
// REGENCY_ESTABLISHED — reactive to CHILD_KING_CROWNED
// ---------------------------------------------------------------------------
const REGENCY_ESTABLISHED: EventSpec = {
  type: "REGENCY_ESTABLISHED",
  base: 7,
  render: (ev, w) => `A regency was established over the young holder of ${titleName(w, ev.titleId)} — a steward would govern until the crown came of age.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  onEvent: {
    source: "CHILD_KING_CROWNED",
    prob: () => 0.9,
    fire: (w, e) => {
      w.log("REGENCY_ESTABLISHED", {
        titleId: e.titleId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// REGENT_USURPS — during regency, the regent seizes the crown
// ---------------------------------------------------------------------------
const REGENT_USURPS: EventSpec = {
  type: "REGENT_USURPS",
  base: 10,
  render: (ev, w) => `The regent of ${titleName(w, ev.titleId)} cast off the pretence of stewardship and seized the crown outright.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      const holder = w.char(t.holderId);
      if (!holder || w.age(holder) >= 12) return false;
      // Was a REGENCY_ESTABLISHED for this title?
      return w.events.some(
        (e) => e.type === "REGENCY_ESTABLISHED" && e.titleId === t.id,
      );
    },
    prob: () => 0.03,
    fire: (w, item) => {
      const t = item as Title;
      w.log("REGENT_USURPS", {
        titleId: t.id, provinceId: t.provinceId, targetId: t.holderId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// KING_INCAPACITATED — MADNESS_ONSET on a titled ruler
// ---------------------------------------------------------------------------
const KING_INCAPACITATED: EventSpec = {
  type: "KING_INCAPACITATED",
  base: 9,
  render: (ev, w) => `${charName(w, ev.actorId)}, holder of ${titleName(w, ev.titleId)}, was rendered incapable of rule — the court whispered of regencies and worse.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "MADNESS_ONSET",
    prob: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return 0;
      const titles = w.titlesHeldBy(c.id);
      return titles.length > 0 ? 0.8 : 0;
    },
    fire: (w, e) => {
      const c = w.char(e.actorId);
      if (!c) return;
      const t = w.titlesHeldBy(c.id)[0];
      w.log("KING_INCAPACITATED", {
        actorId: c.id, titleId: t?.id ?? null, provinceId: c.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// ABDICATION — ruler voluntarily steps down (rare — needs old age + low ambition)
// ---------------------------------------------------------------------------
const ABDICATION: EventSpec = {
  type: "ABDICATION",
  base: 9,
  render: (ev, w) => `${charName(w, ev.actorId)} abdicated the seat of ${titleName(w, ev.titleId)} — old, tired, or too pious for the crown.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom" && t.tier !== "duchy") return false;
      const h = w.char(t.holderId);
      if (!h || w.age(h) < 55) return false;
      // Abdication needs low ambition + high piety OR high grief.
      return (h.drives.ambition < 0.35 && h.drives.piety > 0.6)
          || h.psyche.biases.grief_locked > 0.5;
    },
    prob: () => 0.02,
    fire: (w, item) => {
      const t = item as Title;
      w.log("ABDICATION", {
        actorId: t.holderId, titleId: t.id, provinceId: t.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// FAVORITE_ASCENDS — a low-born close companion of a ruler becomes de facto power
// ---------------------------------------------------------------------------
const FAVORITE_ASCENDS: EventSpec = {
  type: "FAVORITE_ASCENDS",
  base: 8,
  render: (ev, w) => `A court favorite of ${charName(w, ev.targetId)} rose to command the seat of ${titleName(w, ev.titleId)} — Buckingham and Rasputin had cousins in Matlu.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  ambient: {
    scan: "titles",
    gate: (w, item) => {
      const t = item as Title;
      if (t.tier !== "kingdom" && t.tier !== "duchy") return false;
      const h = w.char(t.holderId);
      if (!h) return false;
      // Weak or old ruler with high wishful bias or high sunk_cost — susceptible.
      return (w.age(h) >= 45 && h.psyche.biases.wishful > 0.5)
          || h.drives.fear > 0.55;
    },
    prob: () => 0.015,
    fire: (w, item) => {
      const t = item as Title;
      // Find a lowborn character in the same province.
      const favorite = w.living().find(
        (c) => c.provinceId === t.provinceId && c.lowborn && w.age(c) >= 20 && w.age(c) <= 45,
      );
      if (!favorite) return;
      w.log("FAVORITE_ASCENDS", {
        actorId: favorite.id, targetId: t.holderId, titleId: t.id, provinceId: t.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
// COUP_D_ETAT — a military figure (soldier/knight) seizes power from within
// ---------------------------------------------------------------------------
const COUP_D_ETAT: EventSpec = {
  type: "COUP_D_ETAT",
  base: 10,
  render: (ev, w) => `${charName(w, ev.actorId)} led a coup — the army lifted them onto the seat of ${titleName(w, ev.titleId)} without a formal war.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
  ambient: {
    scan: "chars",
    gate: (w, item) => {
      const c = item as Character;
      if (c.charClass !== "soldier" && c.charClass !== "knight") return false;
      if (c.level < 10) return false;
      if (c.drives.ambition < 0.75) return false;
      if (w.titlesHeldBy(c.id).length > 0) return false;
      // Ruler at their province is weak (child, old, incapacitated).
      const t = [...w.titles.values()].find((x) => x.provinceId === c.provinceId);
      const holder = w.char(t?.holderId ?? null);
      if (!holder) return false;
      if (holder.dynastyId === c.dynastyId) return false;
      const weak = w.age(holder) < 12 || w.age(holder) > 60
                 || w.events.some((e) => e.type === "KING_INCAPACITATED" && e.actorId === holder.id);
      return weak;
    },
    prob: () => 0.008,
    fire: (w, item) => {
      const c = item as Character;
      const t = [...w.titles.values()].find((x) => x.provinceId === c.provinceId);
      if (!t) return;
      w.log("COUP_D_ETAT", {
        actorId: c.id, titleId: t.id, provinceId: c.provinceId,
      });
    },
    once: "per-actor",
  },
};

// ---------------------------------------------------------------------------
export const SUCCESSION_LEGITIMACY_SPECS: EventSpec[] = [
  BASTARD_ACKNOWLEDGED,
  BASTARD_LEGITIMIZED,
  SECRET_HEIR_DISCOVERED,
  PRETENDER_APPEARS,
  PRETENDER_UNMASKED,
  CHILD_KING_CROWNED,
  REGENCY_ESTABLISHED,
  REGENT_USURPS,
  KING_INCAPACITATED,
  ABDICATION,
  FAVORITE_ASCENDS,
  COUP_D_ETAT,
];
