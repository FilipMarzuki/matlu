// specs/wildlife-events.ts — render specs for the wildlife layer.
//
// Events are FIRED by wildlife.ts (SPECIES_DISCOVERED, HUNT_TROPHY_TAKEN,
// SPECIES_THREATENED, SPECIES_EXTINCT, MANA_BEAST_MANIFESTS,
// WILDLIFE_RESURGENCE, ZOONOTIC_JUMP). This file provides base scores +
// prose + arc grouping only. Extinction arcs anchor to origin province so
// the wiki can weave a ‘last of the great aurochs’ thread across strikes.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the wild country";
}

const KIND_LABEL: Record<string, string> = {
  apex:       "apex predator",
  megafauna:  "great beast of the heartland",
  mana_beast: "creature of woven mana",
  flying:     "aerial hunter",
  amphibious: "beast of the tidewater",
  swarm:      "swarming plague of the wild",
};

const SPECIES_DISCOVERED: EventSpec = {
  type: "SPECIES_DISCOVERED",
  base: 6,
  render: (ev, w) => {
    const species = String(ev.data["species"] ?? "an unfamiliar beast");
    const kind = KIND_LABEL[String(ev.data["kind"] ?? "")] ?? "a wild creature";
    const range = Number(ev.data["rangeSize"] ?? 0);
    const where = provName(w, ev.provinceId);
    return range > 3
      ? `The ${species} — a ${kind} — was first written of near ${where}, its range already spanning many days' ride.`
      : `The ${species} — a ${kind} — first crossed the notice of scribes near ${where}.`;
  },
  arc: (ev) => ev.provinceId ? { key: `W:${ev.data["speciesId"] ?? ev.provinceId}`, kind: "calamity" } : null,
};

const HUNT_TROPHY_TAKEN: EventSpec = {
  type: "HUNT_TROPHY_TAKEN",
  base: 4,
  render: (ev, w) => {
    const species = String(ev.data["species"] ?? "a great beast");
    const trophies = Number(ev.data["trophyCount"] ?? 1);
    const where = provName(w, ev.provinceId);
    return trophies > 5
      ? `Another ${species} was taken near ${where} — the ${ordinal(trophies)} trophy of its kind. The old hunters muttered that the beasts were not what they had been.`
      : `A ${species} was brought down near ${where} — the trophy hung above the hearth of the hunter who had made the kill.`;
  },
  arc: (ev) => ev.data["speciesId"] ? { key: `W:${ev.data["speciesId"]}`, kind: "calamity" } : null,
};

const SPECIES_THREATENED: EventSpec = {
  type: "SPECIES_THREATENED",
  base: 7,
  render: (ev, w) => {
    const species = String(ev.data["species"] ?? "a rare beast");
    const health = Number(ev.data["populationHealth"] ?? 0);
    const where = provName(w, ev.provinceId);
    return `The ${species} was seen only rarely now, its numbers hollowed to ${Math.round(health * 100)}% of what they had been. Old hunters near ${where} began to speak of it as they had once spoken of the last aurochs.`;
  },
  arc: (ev) => ev.data["speciesId"] ? { key: `W:${ev.data["speciesId"]}`, kind: "calamity" } : null,
};

const SPECIES_EXTINCT: EventSpec = {
  type: "SPECIES_EXTINCT",
  base: 11,
  render: (ev, w) => {
    const species = String(ev.data["species"] ?? "a great beast");
    const reason = String(ev.data["reason"] ?? "unknown cause");
    const age = Number(ev.data["age"] ?? 0);
    const where = provName(w, ev.provinceId);
    const reasonPhrase =
      reason === "over-hunted"
        ? "the last of them had fallen to a hunter's spear"
        : reason === "habitat lost to blight"
          ? "the corrupted forests could no longer hold them"
          : "the changing climate had unhoused the last of them";
    return `The ${species} was gone. After ${age} years in the chronicles, ${reasonPhrase}; the memory would outlast the beast near ${where} by centuries.`;
  },
  arc: (ev) => ev.data["speciesId"] ? { key: `W:${ev.data["speciesId"]}`, kind: "calamity" } : null,
};

const MANA_BEAST_MANIFESTS: EventSpec = {
  type: "MANA_BEAST_MANIFESTS",
  base: 9,
  render: (ev, w) => {
    const species = String(ev.data["species"] ?? "a woven creature");
    const density = Number(ev.data["manaDensity"] ?? 0);
    const where = provName(w, ev.provinceId);
    return density > 0.8
      ? `The ${species} stepped out of the mana-thick air of ${where} — no birth, no dam, no sire; the folk said the land itself had dreamed it into being.`
      : `The ${species} was seen in ${where} — witnesses insisted the beast had shimmered into their sight from the very light itself.`;
  },
  arc: (ev) => ev.data["speciesId"] ? { key: `W:${ev.data["speciesId"]}`, kind: "calamity" } : null,
};

const WILDLIFE_RESURGENCE: EventSpec = {
  type: "WILDLIFE_RESURGENCE",
  base: 10,
  render: (ev, w) => {
    const species = String(ev.data["species"] ?? "a species long thought lost");
    const centuries = Number(ev.data["centuriesGone"] ?? 0);
    const where = provName(w, ev.provinceId);
    return centuries >= 2
      ? `The ${species} — believed extinct for ${centuries} centuries — was sighted in ${where}. Priests, scholars, and hunters all made their pilgrimage; none agreed what it meant.`
      : `The ${species} — believed lost within living memory — was sighted in ${where}. Older folk wept; younger folk quietly doubted it was the same kind at all.`;
  },
  arc: (ev) => ev.data["speciesId"] ? { key: `W:${ev.data["speciesId"]}`, kind: "calamity" } : null,
};

const ZOONOTIC_JUMP: EventSpec = {
  type: "ZOONOTIC_JUMP",
  base: 8,
  render: (ev, w) => {
    const species = String(ev.data["species"] ?? "a wild population");
    const kind = String(ev.data["hostKind"] ?? "");
    const where = provName(w, ev.provinceId);
    const vector =
      kind === "swarm"
        ? "swarming carriers"
        : kind === "megafauna"
          ? "livestock that had grazed too close"
          : "hunters who had skinned a fever-warm carcass";
    return `A sickness had crossed from the ${species} into humankind near ${where} — the first cases were tracked to ${vector}. The physicians noted the pattern for future generations.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

// ---------------------------------------------------------------------------
export const WILDLIFE_SPECS: EventSpec[] = [
  SPECIES_DISCOVERED,
  HUNT_TROPHY_TAKEN,
  SPECIES_THREATENED,
  SPECIES_EXTINCT,
  MANA_BEAST_MANIFESTS,
  WILDLIFE_RESURGENCE,
  ZOONOTIC_JUMP,
];
