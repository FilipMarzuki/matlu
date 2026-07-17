// specs/siege-events.ts — render specs for the six long-siege event types.
//
// The events themselves are FIRED by sieges.ts (SIEGE_LAID from trySpawnSiege
// in resolveWars; SIEGE_SALLY / STARVATION / WALLS_BREACHED / FALLEN / LIFTED
// from runSieges). This file only supplies base score + render prose + arc
// grouping. No triggers here — sieges.ts owns the state machine.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function charName(w: World, id: string | null): string {
  const c = w.char(id);
  if (!c) return "an unknown lord";
  const house = w.dynasty(c.dynastyId)?.name;
  return house ? `${c.name} of ${house}` : c.name;
}

function titleName(w: World, id: string | null): string {
  return w.title(id)?.name ?? "the seat";
}

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the walls";
}

const SIEGE_LAID: EventSpec = {
  type: "SIEGE_LAID",
  base: 9,
  render: (ev, w) =>
    `${charName(w, ev.actorId)} laid siege to ${titleName(w, ev.titleId)} at ${provName(w, ev.provinceId)} — hosts encamped, no assault yet, the long grind began.`,
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
};

const SIEGE_SALLY: EventSpec = {
  type: "SIEGE_SALLY",
  base: 6,
  render: (ev, w) =>
    `The defenders of ${provName(w, ev.provinceId)} sallied out — the encamped host was pushed back, morale bleeding on both sides.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const SIEGE_STARVATION: EventSpec = {
  type: "SIEGE_STARVATION",
  base: 8,
  render: (ev, w) =>
    `Provisions ran low behind the walls of ${provName(w, ev.provinceId)} — ${charName(w, ev.actorId)}'s people rationed grain, then leather, then nothing at all.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const SIEGE_WALLS_BREACHED: EventSpec = {
  type: "SIEGE_WALLS_BREACHED",
  base: 9,
  render: (ev, w) =>
    `A breach was hammered into the walls of ${provName(w, ev.provinceId)} — the outcome was no longer a question of if, but of when.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const SIEGE_FALLEN: EventSpec = {
  type: "SIEGE_FALLEN",
  base: 10,
  render: (ev, w) => {
    const years = Number(ev.data["years"] ?? 0);
    const cause = String(ev.data["cause"] ?? "the walls broke");
    return `${titleName(w, ev.titleId)} fell to ${charName(w, ev.actorId)} — after ${years} year${years === 1 ? "" : "s"}, ${cause}. ${charName(w, ev.targetId)} had lost the seat.`;
  },
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
};

const SIEGE_LIFTED: EventSpec = {
  type: "SIEGE_LIFTED",
  base: 8,
  render: (ev, w) => {
    const years = Number(ev.data["years"] ?? 0);
    return `${charName(w, ev.actorId)} lifted the siege of ${titleName(w, ev.titleId)} — ${years} year${years === 1 ? "" : "s"} in the cold, and nothing to show but a weak claim to press again in another generation.`;
  },
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
};

// ---------------------------------------------------------------------------
export const SIEGE_SPECS: EventSpec[] = [
  SIEGE_LAID,
  SIEGE_SALLY,
  SIEGE_STARVATION,
  SIEGE_WALLS_BREACHED,
  SIEGE_FALLEN,
  SIEGE_LIFTED,
];
