// specs/betrayal-events.ts — the sacred bonds that break.
//
// The engine already fires MURDER, WAR, and treaty (alliance/truce) events.
// This file adds the SACRED bonds — kinship, fealty, guest-right, mentorship
// — and what happens when they break. Chronicles remember these differently
// from ordinary murders: kinslaying becomes a generational curse, oath-
// breaking a permanent mark, the Red Wedding a byword for horror.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown figure";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function anyTitleHolder(w: World, id: string | null): boolean {
  return id ? w.titlesHeldBy(id).length > 0 : false;
}

// ---------------------------------------------------------------------------
// KINSLAYING_NOTORIOUS — a MURDER within the SAME dynasty becomes remembered.
// ---------------------------------------------------------------------------
const KINSLAYING_NOTORIOUS: EventSpec = {
  type: "KINSLAYING_NOTORIOUS",
  base: 10,
  render: (ev, w) => `${charName(w, ev.actorId)} shed the blood of their own house — a kinslaying that the chroniclers would not let the dynasty forget.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "MURDER",
    prob: (w, e) => {
      const actor = w.char(e.actorId);
      const target = w.char(e.targetId);
      if (!actor || !target) return 0;
      if (actor.dynastyId !== target.dynastyId) return 0;
      return 1.0;
    },
    fire: (w, e) => {
      w.log("KINSLAYING_NOTORIOUS", {
        actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// FRATRICIDE_OPENS_WAR — kinslaying between two title-holders splits kingdom.
// ---------------------------------------------------------------------------
const FRATRICIDE_OPENS_WAR: EventSpec = {
  type: "FRATRICIDE_OPENS_WAR",
  base: 10,
  render: (ev, w) => `The kinslaying by ${charName(w, ev.actorId)} split their house in two — the surviving cadets took up arms, and the realm went to civil war.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "KINSLAYING_NOTORIOUS",
    prob: (w, e) => {
      // Both actor and target held titles → dynastic-scale civil war likely.
      if (!anyTitleHolder(w, e.actorId)) return 0;
      const target = w.char(e.targetId);
      if (!target) return 0;
      // Any living sibling of the target is a potential avenger.
      const siblings = [target.fatherId, target.motherId]
        .flatMap((pid) => (pid ? w.livingChildren(w.char(pid)!) : []))
        .filter((c) => c.id !== target.id && c.alive);
      return siblings.length > 0 ? 0.35 : 0;
    },
    fire: (w, e) => {
      w.log("FRATRICIDE_OPENS_WAR", {
        actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// OATH_OF_FEALTY_TAKEN — a formal loyalty pledge. Fires when a new title
// holder takes over and swears to their liege (approximated by SUCCESSION
// with a liegeId set).
// ---------------------------------------------------------------------------
const OATH_OF_FEALTY_TAKEN: EventSpec = {
  type: "OATH_OF_FEALTY_TAKEN",
  base: 5,
  render: (ev, w) => `${charName(w, ev.actorId)} knelt and swore fealty — the oath was sworn on iron and stone.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "SUCCESSION",
    prob: (w, e) => {
      const t = w.title(e.titleId);
      if (!t) return 0;
      // Only sub-tier titles under a liege trigger the ritual.
      return t.liegeId !== null ? 0.4 : 0;
    },
    fire: (w, e) => {
      w.log("OATH_OF_FEALTY_TAKEN", {
        actorId: e.actorId, titleId: e.titleId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// OATH_BROKEN_SACRED — sworn oath violated in aggravated way (fealty +
// then rebellion / raid on liege). Approximated: rebellion event within 15
// years of an OATH_OF_FEALTY_TAKEN by the same actor.
// ---------------------------------------------------------------------------
const OATH_BROKEN_SACRED: EventSpec = {
  type: "OATH_BROKEN_SACRED",
  base: 9,
  render: (ev, w) => `${charName(w, ev.actorId)} broke a sacred oath — the fealty they had knelt to swear was cast aside, and the chronicler wrote it in red.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "WAR",
    prob: (w, e) => {
      const actor = w.char(e.actorId);
      if (!actor) return 0;
      const sworn = w.events.some(
        (x) => x.type === "OATH_OF_FEALTY_TAKEN" && x.actorId === actor.id
             && w.year - x.year < 15,
      );
      const already = w.events.some(
        (x) => x.type === "OATH_BROKEN_SACRED" && x.actorId === actor.id,
      );
      return sworn && !already ? 1.0 : 0;
    },
    fire: (w, e) => {
      w.log("OATH_BROKEN_SACRED", {
        actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// HOSTAGE_KILLED_TERMS — a hostage murdered against terms. Approximated:
// a MURDER of a low-power character of a rival dynasty during a truce.
// ---------------------------------------------------------------------------
const HOSTAGE_KILLED_TERMS: EventSpec = {
  type: "HOSTAGE_KILLED_TERMS",
  base: 9,
  render: (ev, w) => `A hostage of ${charName(w, ev.targetId)} was killed against the terms of the truce — the courts of the wounded house swore vengeance.`,
  arc: (ev) => ev.targetId ? { key: `P:${ev.targetId}`, kind: "figure" } : null,
  onEvent: {
    source: "MURDER",
    prob: (w, e) => {
      const actor = w.char(e.actorId);
      const target = w.char(e.targetId);
      if (!actor || !target) return 0;
      if (actor.dynastyId === target.dynastyId) return 0;
      if (anyTitleHolder(w, target.id)) return 0; // hostages aren't title holders
      if (w.age(target) < 12 || w.age(target) > 25) return 0;
      // A truce or war between the two houses?
      const truce = w.events.some(
        (x) => x.type === "TRUCE"
             && (x.actorId === actor.id || x.targetId === actor.id)
             && (x.actorId === target.id || x.targetId === target.id)
             && w.year - x.year < 25,
      );
      return truce ? 0.4 : 0;
    },
    fire: (w, e) => {
      w.log("HOSTAGE_KILLED_TERMS", {
        actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// GUEST_RIGHT_BROKEN — the sacred host-guest bond violated. Red Wedding.
// A MURDER at a truce-signing or wedding-hosting host's province.
// ---------------------------------------------------------------------------
const GUEST_RIGHT_BROKEN: EventSpec = {
  type: "GUEST_RIGHT_BROKEN",
  base: 10,
  render: (ev, w) => `Guest-right was broken at ${charName(w, ev.actorId)}'s hall — bread and salt were shared, and then the swords were drawn. The chronicle would remember.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "MURDER",
    prob: (w, e) => {
      const actor = w.char(e.actorId);
      const target = w.char(e.targetId);
      if (!actor || !target) return 0;
      if (actor.dynastyId === target.dynastyId) return 0;
      // Target visited actor's province recently — proxied via TRUCE_SIGNED
      // or ALLIANCE_FORMED between the two in the last few years.
      const guested = w.events.some(
        (x) => (x.type === "TRUCE" || x.type === "ALLIANCE_FORMED" || x.type === "MARRIAGE")
             && ((x.actorId === actor.id && x.targetId === target.id)
              || (x.targetId === actor.id && x.actorId === target.id))
             && w.year - x.year < 3,
      );
      return guested ? 0.6 : 0;
    },
    fire: (w, e) => {
      w.log("GUEST_RIGHT_BROKEN", {
        actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// MENTOR_BETRAYED — a student turns on their master. Approximated: MURDER
// where actor is significantly younger AND at similar class/skill lineage.
// Rough proxy: actor level 5-15, target level 15+, same province long ago.
// ---------------------------------------------------------------------------
const MENTOR_BETRAYED: EventSpec = {
  type: "MENTOR_BETRAYED",
  base: 8,
  render: (ev, w) => `${charName(w, ev.actorId)} betrayed and slew ${charName(w, ev.targetId)}, the master who had raised them — the chronicler used no gentler word.`,
  arc: (ev) => ev.actorId ? { key: `P:${ev.actorId}`, kind: "figure" } : null,
  onEvent: {
    source: "MURDER",
    prob: (w, e) => {
      const actor = w.char(e.actorId);
      const target = w.char(e.targetId);
      if (!actor || !target) return 0;
      if (actor.dynastyId === target.dynastyId) return 0;
      if (actor.level < 5 || target.level < actor.level + 8) return 0;
      // Both same charClass — implies shared craft-lineage.
      if (actor.charClass !== target.charClass) return 0;
      return 0.5;
    },
    fire: (w, e) => {
      w.log("MENTOR_BETRAYED", {
        actorId: e.actorId, targetId: e.targetId, provinceId: e.provinceId,
      });
    },
  },
};

// ---------------------------------------------------------------------------
export const BETRAYAL_SPECS: EventSpec[] = [
  KINSLAYING_NOTORIOUS,
  FRATRICIDE_OPENS_WAR,
  OATH_OF_FEALTY_TAKEN,
  OATH_BROKEN_SACRED,
  HOSTAGE_KILLED_TERMS,
  GUEST_RIGHT_BROKEN,
  MENTOR_BETRAYED,
];
