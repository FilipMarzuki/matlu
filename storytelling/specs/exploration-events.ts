// specs/exploration-events.ts — render specs for the maritime layer.
//
// Events are FIRED by exploration.ts. This file supplies base score, prose,
// and arc grouping. Expeditions are their own "voyage" arc so a launch →
// discoveries → return (or lost) thread reads as a single narrative unit.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the coast";
}

const EXPEDITION_LAUNCHED: EventSpec = {
  type: "EXPEDITION_LAUNCHED",
  base: 8,
  render: (ev, w) => {
    const name = String(ev.data["expedition"] ?? "an expedition");
    const purpose = String(ev.data["purpose"] ?? "trade");
    const port = provName(w, ev.provinceId);
    const purposePhrase =
      purpose === "conquest" ? "with conquest in its charter"
      : purpose === "religious" ? "carrying priests and holy books"
      : purpose === "scientific" ? "with cartographers and naturalists aboard"
      : purpose === "raid" ? "with letters of marque tucked into the captain's chest"
      : "with holds full of trade goods";
    return `${name} sailed from ${port} ${purposePhrase}. The dockmasters wrote the manifest; nobody knew whether they would write the return.`;
  },
  arc: (ev) => ev.data["expeditionId"] ? { key: `V:${ev.data["expeditionId"]}`, kind: "calamity" } : null,
};

const EXPEDITION_RETURNED: EventSpec = {
  type: "EXPEDITION_RETURNED",
  base: 10,
  render: (ev, w) => {
    const name = String(ev.data["expedition"] ?? "the expedition");
    const years = Number(ev.data["yearsAtSea"] ?? 0);
    const port = provName(w, ev.provinceId);
    return years >= 5
      ? `${name} returned to ${port} after ${years} years at sea. Half those who had launched with her were absent; those who remained were older than their years.`
      : `${name} returned to ${port} after ${years} years at sea, holds heavier than they had left.`;
  },
  arc: (ev) => ev.data["expeditionId"] ? { key: `V:${ev.data["expeditionId"]}`, kind: "calamity" } : null,
};

const EXPEDITION_LOST: EventSpec = {
  type: "EXPEDITION_LOST",
  base: 9,
  render: (ev, w) => {
    const name = String(ev.data["expedition"] ?? "the expedition");
    const reason = String(ev.data["reason"] ?? "vanished beyond the horizon");
    const years = Number(ev.data["yearsAtSea"] ?? 0);
    const port = provName(w, ev.provinceId);
    return `${name}, ${years} years overdue at ${port}, was written into the lost-ships ledger — ${reason}. Widows lit candles for the men who had crewed her.`;
  },
  arc: (ev) => ev.data["expeditionId"] ? { key: `V:${ev.data["expeditionId"]}`, kind: "calamity" } : null,
};

const EXPEDITION_WRECKED: EventSpec = {
  type: "EXPEDITION_WRECKED",
  base: 9,
  render: (ev, w) => {
    const name = String(ev.data["expedition"] ?? "the expedition");
    const years = Number(ev.data["yearsAtSea"] ?? 0);
    const port = provName(w, ev.provinceId);
    return `${name} was wrecked on a shore no map named after ${years} years of sailing. Word crawled back to ${port} on the tongues of a handful of survivors who had walked home overland.`;
  },
  arc: (ev) => ev.data["expeditionId"] ? { key: `V:${ev.data["expeditionId"]}`, kind: "calamity" } : null,
};

const NEW_LANDS_CHARTED: EventSpec = {
  type: "NEW_LANDS_CHARTED",
  base: 11,
  render: (ev) => {
    const name = String(ev.data["expedition"] ?? "an expedition");
    const lands = String(ev.data["lands"] ?? "unnamed lands");
    return `${name} brought back a map — ${lands}, drawn in a fresh hand across the empty edge of the older charts. Cartographers began to argue at once about the coastline.`;
  },
  arc: (ev) => ev.data["expeditionId"] ? { key: `V:${ev.data["expeditionId"]}`, kind: "calamity" } : null,
};

const FIRST_CONTACT_ESTABLISHED: EventSpec = {
  type: "FIRST_CONTACT_ESTABLISHED",
  base: 12,
  render: (ev) => {
    const name = String(ev.data["expedition"] ?? "the expedition");
    const foreign = String(ev.data["foreignCulture"] ?? "a distant people");
    const peaceful = ev.data["peaceful"] === true;
    return peaceful
      ? `${name} spoke, through a struggling interpreter, with ${foreign}. Gifts were exchanged; a memorised list of loan-words was carried home.`
      : `${name} found ${foreign} — the meeting ended badly. Both sides lost men before the fleet withdrew, carrying grievance and rumour in equal measure.`;
  },
  arc: (ev) => ev.data["expeditionId"] ? { key: `V:${ev.data["expeditionId"]}`, kind: "calamity" } : null,
};

const GREAT_EXCHANGE: EventSpec = {
  type: "GREAT_EXCHANGE",
  base: 10,
  render: (ev) => {
    const name = String(ev.data["expedition"] ?? "the expedition");
    const disease = ev.data["broughtDisease"] === true;
    const species = ev.data["broughtSpecies"] === true;
    const crops = ev.data["broughtCrops"] === true;
    const parts: string[] = [];
    if (crops) parts.push("seed-samples of unfamiliar crops");
    if (species) parts.push("an animal none of the herdsmen recognised");
    if (disease) parts.push("a fever that would show itself only after landfall");
    const cargo = parts.length === 0 ? "curiosities of every kind" : parts.join(", ");
    return `${name} unloaded ${cargo}. The naturalists were delighted, the priests uneasy, and the physicians — later — very busy.`;
  },
  arc: (ev) => ev.data["expeditionId"] ? { key: `V:${ev.data["expeditionId"]}`, kind: "calamity" } : null,
};

const SEA_MONSTER_ENCOUNTERED: EventSpec = {
  type: "SEA_MONSTER_ENCOUNTERED",
  base: 11,
  render: (ev) => {
    const name = String(ev.data["expedition"] ?? "the expedition");
    const survived = ev.data["survived"] === true;
    return survived
      ? `${name} was seen by a leviathan of the deep and lived. The sailors who came home spoke of a jaw longer than the hull; the mages disagreed as to what it had truly been.`
      : `${name} was taken by something rising from the deep water. The last log page, recovered years later, read only: "it is beneath us".`;
  },
  arc: (ev) => ev.data["expeditionId"] ? { key: `V:${ev.data["expeditionId"]}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
export const EXPLORATION_SPECS: EventSpec[] = [
  EXPEDITION_LAUNCHED,
  EXPEDITION_RETURNED,
  EXPEDITION_LOST,
  EXPEDITION_WRECKED,
  NEW_LANDS_CHARTED,
  FIRST_CONTACT_ESTABLISHED,
  GREAT_EXCHANGE,
  SEA_MONSTER_ENCOUNTERED,
];
