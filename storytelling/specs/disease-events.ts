// specs/disease-events.ts — render specs for the disease-strain layer.
//
// Events are FIRED by disease.ts. This file supplies base score + render
// prose + arc grouping. Diseases become "calamity" arcs anchored on their
// origin province, so a Black Death arc tracks across strikes and mutations.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the land";
}

const FAMILY_LABEL: Record<string, string> = {
  bubonic:      "bubonic plague",
  hemorrhagic:  "hemorrhagic fever",
  respiratory:  "wasting cough",
  pox:          "poxen",
  mana_fever:   "mana-fever",
  rot_plague:   "necrotic rot",
  unraveling:   "unraveling curse",
  choking_mist: "choking mist",
};

const DISEASE_EMERGES: EventSpec = {
  type: "DISEASE_EMERGES",
  base: 11,
  render: (ev, w) => {
    const name = String(ev.data["disease"] ?? "a nameless plague");
    const family = FAMILY_LABEL[String(ev.data["family"] ?? "")] ?? "a new sickness";
    const origin = String(ev.data["origin"] ?? provName(w, ev.provinceId));
    return `${name} — a ${family} — struck ${origin}. Physicians had no name for it at first; by the second month it had claimed its own.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DISEASE_RETURNS: EventSpec = {
  type: "DISEASE_RETURNS",
  base: 9,
  render: (ev) => {
    const name = String(ev.data["disease"] ?? "the sickness");
    const strike = Number(ev.data["strike"] ?? 0);
    return `${name} returned — the ${ordinal(strike)} strike. Older survivors recognised the signs; the young thought it new.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DISEASE_MUTATES: EventSpec = {
  type: "DISEASE_MUTATES",
  base: 10,
  render: (ev) => {
    const parent = String(ev.data["parentDisease"] ?? "the parent strain");
    const child = String(ev.data["childDisease"] ?? "a variant");
    const lethality = Number(ev.data["childLethality"] ?? 0);
    return `${parent} had turned in the marrow — a new strain, ${child}, presented with unfamiliar signs and a lethality of ${Math.round(lethality * 100)}% among the unimmunised.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DISEASE_JUMPS_ROUTE: EventSpec = {
  type: "DISEASE_JUMPS_ROUTE",
  base: 9,
  render: (ev, w) => {
    const name = String(ev.data["disease"] ?? "the sickness");
    const from = provName(w, String(ev.data["fromProvinceId"] ?? ""));
    const to = provName(w, String(ev.data["toProvinceId"] ?? ""));
    const conduit = String(ev.data["conduit"] ?? "the road");
    return `${name} rode a ${conduit} merchant train from ${from} to ${to} — the sailors who first sickened had left port a fortnight before; the quarantine came too late.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const DISEASE_BURNS_OUT: EventSpec = {
  type: "DISEASE_BURNS_OUT",
  base: 11,
  render: (ev) => {
    const name = String(ev.data["disease"] ?? "the sickness");
    const aged = Number(ev.data["agedYears"] ?? 0);
    const deaths = Number(ev.data["totalDeaths"] ?? 0);
    const strikes = Number(ev.data["strikes"] ?? 0);
    return `${name} burned itself out. ${aged} years, ${strikes} strikes, ${deaths.toLocaleString("en")} named and un-named dead. The children of the survivors carried the memory but not the sickness.`;
  },
  arc: () => null,
};

const MAGICAL_PLAGUE_ERUPTS: EventSpec = {
  type: "MAGICAL_PLAGUE_ERUPTS",
  base: 12,
  render: (ev, w) => {
    const name = String(ev.data["disease"] ?? "an unnatural sickness");
    const family = String(ev.data["family"] ?? "");
    const flavour = magicalFlavour(family);
    return `${name} was not a natural sickness — ${flavour} at ${provName(w, ev.provinceId)}. Priests, mages, and physicians argued over the cause; not one of them could stop it.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

function magicalFlavour(family: string): string {
  switch (family) {
    case "mana_fever":
      return "the sufferers spoke in tongues, saw the walls breathe, and half of them never returned to themselves";
    case "rot_plague":
      return "the dead did not stay dead; those they had loved rose within a day and walked out into the streets";
    case "unraveling":
      return "survivors woke with holes in their memory — names of children forgotten, languages half-lost, deeds untethered from the doer";
    case "choking_mist":
      return "a grey mist rolled through the streets and every priest of the offended god fell where they stood";
    default:
      return "no rite of medicine touched it";
  }
}

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

// ---------------------------------------------------------------------------
export const DISEASE_SPECS: EventSpec[] = [
  DISEASE_EMERGES,
  DISEASE_RETURNS,
  DISEASE_MUTATES,
  DISEASE_JUMPS_ROUTE,
  DISEASE_BURNS_OUT,
  MAGICAL_PLAGUE_ERUPTS,
];
