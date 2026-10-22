// specs/ether-events.ts — how the Ether's events read and score.
//
// The Ether's simulation lives in ether.ts (it needs per-character spirit
// state, which the EventSpec triggers can't carry). These specs have no
// trigger of their own: they only give the sifter a score, the renderer its
// prose, and the arc builder a thread to hang them on. A haunting is one
// thread per spirit (`S:<charId>`), from the death that anchored it to the
// year it moves on.
//
// Tone (docs/ETHER_REALM.md §9): start from mourning, not horror. Rest is
// the reward.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "someone now forgotten";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}
function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "an unnamed place";
}

const ETHER_CONVERGENCE: EventSpec = {
  type: "ETHER_CONVERGENCE",
  base: 9,
  render: (ev, w) =>
    `Something gave way between Mistheim and the Ether. It was felt first in ${provName(w, ev.provinceId)}, where the most had died: graves that hummed, and dreams that everyone shared.`,
  arc: () => null,
};

const THIN_PLACE_RECOGNIZED: EventSpec = {
  type: "THIN_PLACE_RECOGNIZED",
  base: 5,
  render: (ev, w) =>
    `In ${provName(w, ev.provinceId)} the veil wore thin. People there left a chair empty at the table, and stopped speaking ill of the dead.`,
  arc: (ev) => (ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null),
};

const SPIRIT_LINGERS: EventSpec = {
  type: "SPIRIT_LINGERS",
  base: 5,
  // A murder that won't stay buried, or a fallen house, is a bigger story
  // than an old grudge.
  scoreBoost: (ev) => (ev.data.anchor === "unavenged_murder" ? 2 : ev.data.anchor === "last_of_house" ? 1 : 0),
  render: (ev, w) => {
    const dead = charName(w, ev.actorId);
    const where = provName(w, ev.provinceId);
    switch (ev.data.anchor) {
      case "unavenged_murder":
        return `${dead} did not move on. Their killer, ${charName(w, ev.targetId)}, still lived, and something cold stayed in ${where}.`;
      case "grudge":
        return `${dead} died hating ${charName(w, ev.targetId)}, and did not move on.`;
      case "last_of_house":
        return `${dead} was the last of House ${ev.data.house}, and did not move on. The halls of ${where} were never quite empty again.`;
      default:
        return `${dead} fell in ${where}, where the veil was thin, and did not move on.`;
    }
  },
  arc: (ev) => (ev.actorId ? { key: `S:${ev.actorId}`, kind: "figure" } : null),
};

const SPIRIT_MOVES_ON: EventSpec = {
  type: "SPIRIT_MOVES_ON",
  base: 6,
  render: (ev, w) => {
    const dead = charName(w, ev.actorId);
    const years = Number(ev.data.years);
    const after = years >= 2 ? ` after ${years} years` : "";
    switch (ev.data.anchor) {
      case "unavenged_murder":
        return `${charName(w, ev.targetId)} was dead. The spirit of ${dead} moved on${after}, and was not seen again.`;
      case "grudge":
        return `${charName(w, ev.targetId)} was dead, and the spirit of ${dead} let go${after}.`;
      case "battlefield":
        return `Peace held in ${provName(w, ev.provinceId)}, and the spirit of ${dead} moved on${after}.`;
      default:
        return `The spirit of ${dead} moved on${after}.`;
    }
  },
  arc: (ev) => (ev.actorId ? { key: `S:${ev.actorId}`, kind: "figure" } : null),
};

export const ETHER_SPECS: EventSpec[] = [ETHER_CONVERGENCE, THIN_PLACE_RECOGNIZED, SPIRIT_LINGERS, SPIRIT_MOVES_ON];
