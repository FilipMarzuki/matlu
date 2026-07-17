// specs/academy-events.ts — render specs for scholar-academy lifecycle events.
//
// The events are FIRED by academies.ts. This file only supplies base score
// + render prose + arc grouping. No triggers here.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the college hall";
}

function charName(w: World, id: string | null): string {
  return w.char(id)?.name ?? "an unknown master";
}

const ACADEMY_FOUNDED: EventSpec = {
  type: "ACADEMY_FOUNDED",
  base: 8,
  render: (ev, w) => {
    const name = String(ev.data["academy"] ?? "an academy");
    const patron = String(ev.data["patronDynasty"] ?? "");
    const founders = Number(ev.data["founders"] ?? 3);
    return `${name} was founded — ${charName(w, ev.actorId)} led ${founders} scholars under the patronage of ${patron} into their first lecture-hall.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const ACADEMY_FLOURISHES: EventSpec = {
  type: "ACADEMY_FLOURISHES",
  base: 9,
  render: (ev, w) => {
    const name = String(ev.data["academy"] ?? "the academy");
    return `${name} reached the peak of its renown — scholars from across the world came seeking its lecture-halls, and the name of ${provName(w, ev.provinceId)} was spoken with reverence in every literate court.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const ACADEMY_MIGRATED: EventSpec = {
  type: "ACADEMY_MIGRATED",
  base: 9,
  render: (ev, w) => {
    const fromProv = provName(w, String(ev.data["fromProvinceId"] ?? ""));
    const toProv = provName(w, String(ev.data["toProvinceId"] ?? ""));
    const n = Number(ev.data["scholars"] ?? 0);
    return `${n} scholar${n === 1 ? "" : "s"} fled ${fromProv} for ${toProv} — the old lecture-halls sat empty, and the new city rose to prominence on their arrival.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const ACADEMY_DISSOLVED: EventSpec = {
  type: "ACADEMY_DISSOLVED",
  base: 7,
  render: (ev, w) => {
    const name = String(ev.data["academy"] ?? "the academy");
    const cause = String(ev.data["cause"] ?? "the last master died");
    return `${name} at ${provName(w, ev.provinceId)} dissolved — ${cause}, and the surviving lecture-halls fell to disuse.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
export const ACADEMY_SPECS: EventSpec[] = [
  ACADEMY_FOUNDED,
  ACADEMY_FLOURISHES,
  ACADEMY_MIGRATED,
  ACADEMY_DISSOLVED,
];
