// specs/union-events.ts — render specs for dynastic union events.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function charName(w: World, id: string | null): string {
  return w.char(id)?.name ?? "an unknown figure";
}

const DYNASTIC_UNION_FORMED: EventSpec = {
  type: "DYNASTIC_UNION_FORMED",
  base: 8,
  render: (ev, w) => {
    const a = String(ev.data["dynastyA"] ?? "one house");
    const b = String(ev.data["dynastyB"] ?? "another house");
    return `A royal marriage bound House ${a} to House ${b} — ${charName(w, ev.actorId)} wed ${charName(w, ev.targetId)}, and the compact was written for both realms to honour.`;
  },
  arc: () => null,
};

const PERSONAL_UNION_ESTABLISHED: EventSpec = {
  type: "PERSONAL_UNION_ESTABLISHED",
  base: 12,
  render: (ev, w) => {
    const a = String(ev.data["dynastyA"] ?? "one house");
    const b = String(ev.data["dynastyB"] ?? "another house");
    const title = String(ev.data["title"] ?? "the crown");
    return `${charName(w, ev.actorId)} took ${title} — heir of both House ${a} and House ${b} through the old union, they wore two crowns and answered to neither council alone.`;
  },
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
};

const PERSONAL_UNION_DISSOLVED: EventSpec = {
  type: "PERSONAL_UNION_DISSOLVED",
  base: 10,
  render: (ev) => {
    const a = String(ev.data["dynastyA"] ?? "one house");
    const b = String(ev.data["dynastyB"] ?? "another house");
    return `The personal union of ${a} and ${b} ended — the heirs of the two houses divided the crowns and returned each to its own council.`;
  },
  arc: () => null,
};

const UNION_INHERITED: EventSpec = {
  type: "UNION_INHERITED",
  base: 7,
  render: (ev) => {
    const a = String(ev.data["dynastyA"] ?? "one house");
    const b = String(ev.data["dynastyB"] ?? "another house");
    return `The compact between ${a} and ${b} passed to a new generation — the strength of the old vow still held in the new signatures.`;
  },
  arc: () => null,
};

const CADET_BRANCH_ESTABLISHED: EventSpec = {
  type: "CADET_BRANCH_ESTABLISHED",
  base: 8,
  render: (ev, w) => {
    const parent = String(ev.data["parentDynasty"] ?? "the parent house");
    const cadet = String(ev.data["cadetName"] ?? "a cadet line");
    return `${charName(w, ev.actorId)} founded ${cadet}, a cadet branch of House ${parent} — a distinct line with claims that would matter in every succession that followed.`;
  },
  arc: () => null,
};

const UNION_BROKEN_BY_WAR: EventSpec = {
  type: "UNION_BROKEN_BY_WAR",
  base: 11,
  render: (ev) => {
    const a = String(ev.data["dynastyA"] ?? "one house");
    const b = String(ev.data["dynastyB"] ?? "another house");
    return `The old compact of ${a} and ${b} was torn apart — the two houses drew steel against each other, and the marriage-oaths were not enough to hold.`;
  },
  arc: () => null,
};

// ---------------------------------------------------------------------------
export const UNION_SPECS: EventSpec[] = [
  DYNASTIC_UNION_FORMED,
  PERSONAL_UNION_ESTABLISHED,
  PERSONAL_UNION_DISSOLVED,
  UNION_INHERITED,
  CADET_BRANCH_ESTABLISHED,
  UNION_BROKEN_BY_WAR,
];
