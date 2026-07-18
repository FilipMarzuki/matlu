// specs/hero-events.ts — render specs for named-hero + artefact events.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function charName(w: World, id: string | null): string {
  return w.char(id)?.name ?? "an unknown figure";
}
function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "an unnamed land";
}

const NAMED_HERO_RISES: EventSpec = {
  type: "NAMED_HERO_RISES",
  base: 10,
  render: (ev) => {
    const name = String(ev.data["name"] ?? "an unknown figure");
    const epithet = String(ev.data["epithet"] ?? "the Nameless");
    const deed = String(ev.data["deed"] ?? "a great deed");
    const lvl = Number(ev.data["level"] ?? 0);
    return `${name} became known as "${name} ${epithet}" — the deed was ${deed}, and at level ${lvl} their name spread beyond their own realm.`;
  },
  arc: (ev) => ev.provinceId ? { key: `F:${ev.actorId}`, kind: "figure" } : null,
};

const NAMED_HERO_FALLS: EventSpec = {
  type: "NAMED_HERO_FALLS",
  base: 11,
  render: (ev) => {
    const name = String(ev.data["name"] ?? "an unknown figure");
    const epithet = String(ev.data["epithet"] ?? "");
    const age = Number(ev.data["diedAge"] ?? 0);
    return `${name} ${epithet} passed at ${age} years — the epithet outlived them, and children learned to say it before they knew the deed.`;
  },
  arc: (ev) => ev.actorId ? { key: `F:${ev.actorId}`, kind: "figure" } : null,
};

const ARTEFACT_FORGED: EventSpec = {
  type: "ARTEFACT_FORGED",
  base: 10,
  render: (ev, w) => {
    const art = String(ev.data["artefact"] ?? "an unnamed artefact");
    const cat = String(ev.data["category"] ?? "relic");
    const binding = String(ev.data["binding"] ?? "free");
    const creator = String(ev.data["creator"] ?? "an unknown master");
    const bearer = String(ev.data["bearer"] ?? "its first bearer");
    let boundClause = "";
    if (binding === "bloodline") boundClause = ", bound to the creator's bloodline";
    else if (binding === "class") boundClause = `, bound to the ${String(ev.data["bindingClass"] ?? "chosen")} class`;
    else if (binding === "worthy") boundClause = ", answering only to the worthy";
    return `${creator} forged ${art} at ${provName(w, ev.provinceId)} — a ${cat}${boundClause}, and placed it in ${bearer}'s hands.`;
  },
  arc: (ev) => ev.provinceId ? { key: `A:${ev.data["artefactId"]}`, kind: "figure" } : null,
};

const ARTEFACT_INHERITED: EventSpec = {
  type: "ARTEFACT_INHERITED",
  base: 8,
  render: (ev, w) => {
    const art = String(ev.data["artefact"] ?? "the artefact");
    return `${art} passed to ${charName(w, ev.actorId)} — the funeral rites were spoken, and the new bearer carried it out of the hall.`;
  },
  arc: (ev) => ev.data["artefactId"] ? { key: `A:${ev.data["artefactId"]}`, kind: "figure" } : null,
};

const ARTEFACT_STOLEN: EventSpec = {
  type: "ARTEFACT_STOLEN",
  base: 10,
  render: (ev) => {
    const art = String(ev.data["artefact"] ?? "the artefact");
    const thief = String(ev.data["thief"] ?? "an unknown taker");
    const from = String(ev.data["from"] ?? "its bearer");
    return `${art} was taken from ${from} — ${thief} left no witnesses, and the loss was not spoken of for a season, and then only in whispers.`;
  },
  arc: (ev) => ev.data["artefactId"] ? { key: `A:${ev.data["artefactId"]}`, kind: "figure" } : null,
};

const ARTEFACT_LOST: EventSpec = {
  type: "ARTEFACT_LOST",
  base: 9,
  render: (ev, w) => {
    const art = String(ev.data["artefact"] ?? "the artefact");
    const cat = String(ev.data["category"] ?? "relic");
    return `${art} was lost — the last bearer fell, no heir claimed it, and the ${cat} passed into rumour at ${provName(w, ev.provinceId)}.`;
  },
  arc: (ev) => ev.data["artefactId"] ? { key: `A:${ev.data["artefactId"]}`, kind: "figure" } : null,
};

const ARTEFACT_REDISCOVERED: EventSpec = {
  type: "ARTEFACT_REDISCOVERED",
  base: 11,
  render: (ev, w) => {
    const art = String(ev.data["artefact"] ?? "an old artefact");
    const finder = String(ev.data["finder"] ?? "a hero");
    const yearsLost = Number(ev.data["yearsLost"] ?? 0);
    return `${art} was found again — ${finder} raised it from the ${provName(w, ev.provinceId)} ruins after ${yearsLost} years unseen, and the older folk crossed themselves in the same instant.`;
  },
  arc: (ev) => ev.data["artefactId"] ? { key: `A:${ev.data["artefactId"]}`, kind: "figure" } : null,
};

// ---------------------------------------------------------------------------
export const HERO_SPECS: EventSpec[] = [
  NAMED_HERO_RISES,
  NAMED_HERO_FALLS,
  ARTEFACT_FORGED,
  ARTEFACT_INHERITED,
  ARTEFACT_STOLEN,
  ARTEFACT_LOST,
  ARTEFACT_REDISCOVERED,
];
