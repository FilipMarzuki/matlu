// specs/company-events.ts — render specs for persistent-company events.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "an unnamed shore";
}
function charName(w: World, id: string | null): string {
  return w.char(id)?.name ?? "an unknown captain";
}

const COMPANY_FORMED: EventSpec = {
  type: "COMPANY_FORMED",
  base: 8,
  render: (ev, w) => {
    const co = String(ev.data["company"] ?? "an unnamed company");
    const kind = String(ev.data["kind"] ?? "mercenary");
    const captain = String(ev.data["captain"] ?? charName(w, ev.actorId));
    const count = Number(ev.data["memberCount"] ?? 0);
    if (kind === "pirate") {
      return `${captain} raised the sails of ${co} — ${count} rovers under one flag, and no coastal lord felt safe by the season's end.`;
    }
    return `${captain} raised the standard of ${co} at ${provName(w, ev.provinceId)} — ${count} spears for hire, and word went out to every court that could pay.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const COMPANY_HIRED: EventSpec = {
  type: "COMPANY_HIRED",
  base: 7,
  render: (ev) => {
    const co = String(ev.data["company"] ?? "the company");
    const patron = String(ev.data["patron"] ?? "an unknown patron");
    return `${co} took ${patron}'s coin — the contract was written, and the standard marched east.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const COMPANY_TURNS_CONDOTTIERE: EventSpec = {
  type: "COMPANY_TURNS_CONDOTTIERE",
  base: 12,
  render: (ev) => {
    const co = String(ev.data["company"] ?? "the company");
    const captain = String(ev.data["captain"] ?? "the captain");
    const title = String(ev.data["title"] ?? "the crown");
    const former = String(ev.data["formerHolder"] ?? "the sitting lord");
    return `${co} turned condottiere at ${title} — ${captain} seized what they had been paid to protect, and ${former}'s name went into the annals as one who trusted mercenary steel too far.`;
  },
  arc: (ev) => ev.titleId ? { key: `T:${ev.titleId}`, kind: "title" } : null,
};

const COMPANY_RAIDS: EventSpec = {
  type: "COMPANY_RAIDS",
  base: 8,
  render: (ev, w) => {
    const co = String(ev.data["company"] ?? "the fleet");
    const target = String(ev.data["target"] ?? provName(w, ev.provinceId));
    return `${co} raided ${target} — the coastal watch saw the sails at dawn and the smoke by noon. The town's ledgers were burned along with its granaries.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const COMPANY_BUSTED: EventSpec = {
  type: "COMPANY_BUSTED",
  base: 10,
  render: (ev) => {
    const co = String(ev.data["company"] ?? "the fleet");
    const raids = Number(ev.data["raidCount"] ?? 0);
    return `${co} was sunk — a navy at last caught up with them off a lee shore. ${raids} raids stood on their name, and the last of the crew were hanged where the tide reached highest.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const COMPANY_DISBANDED: EventSpec = {
  type: "COMPANY_DISBANDED",
  base: 7,
  render: (ev) => {
    const co = String(ev.data["company"] ?? "the company");
    const aged = Number(ev.data["agedYears"] ?? 0);
    return `${co} scattered — after ${aged} years under one standard, the last of the veterans took different roads.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
export const COMPANY_SPECS: EventSpec[] = [
  COMPANY_FORMED,
  COMPANY_HIRED,
  COMPANY_TURNS_CONDOTTIERE,
  COMPANY_RAIDS,
  COMPANY_BUSTED,
  COMPANY_DISBANDED,
];
