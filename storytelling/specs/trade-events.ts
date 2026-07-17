// specs/trade-events.ts — render specs for persistent trade-route events.
//
// The events themselves are FIRED by trade.ts:runTradeRoutes / emergence
// hooks. This file only supplies base score + render prose + arc grouping.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the wharf";
}

const TRADE_ROUTE_FLOURISHES: EventSpec = {
  type: "TRADE_ROUTE_FLOURISHES",
  base: 8,
  render: (ev, w) => {
    const from = provName(w, String(ev.data["fromProvinceId"] ?? ""));
    const to = provName(w, String(ev.data["toProvinceId"] ?? ""));
    const conduit = String(ev.data["conduit"] ?? "land");
    return `The ${conduit}-route between ${from} and ${to} came to its peak — merchants of every house sent factors, and the ledgers grew thick.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const TRADE_ROUTE_ABANDONED: EventSpec = {
  type: "TRADE_ROUTE_ABANDONED",
  base: 8,
  render: (ev, w) => {
    const from = provName(w, String(ev.data["fromProvinceId"] ?? ""));
    const to = provName(w, String(ev.data["toProvinceId"] ?? ""));
    const years = Number(ev.data["totalYears"] ?? 0);
    return `The route between ${from} and ${to} was abandoned after ${years} year${years === 1 ? "" : "s"} — no fresh caravan or ship came, and the wharves rotted.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const TRADE_ROUTE_REVIVED: EventSpec = {
  type: "TRADE_ROUTE_REVIVED",
  base: 7,
  render: (ev, w) => {
    const from = provName(w, String(ev.data["fromProvinceId"] ?? ""));
    const to = provName(w, String(ev.data["toProvinceId"] ?? ""));
    const dormant = Number(ev.data["dormantYears"] ?? 0);
    return `The old route between ${from} and ${to} was revived — dormant for ${dormant} year${dormant === 1 ? "" : "s"}, its wharves were re-planked and its stalls reopened.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

const GREAT_MARKET_FAIR: EventSpec = {
  type: "GREAT_MARKET_FAIR",
  base: 6,
  render: (ev, w) => {
    const routes = Number(ev.data["routeCount"] ?? 0);
    return `A great market fair convened at ${provName(w, ev.provinceId)} — merchants of ${routes} route${routes === 1 ? "" : "s"} met under a single roof, and the wealth changed hands with the seasons.`;
  },
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
export const TRADE_SPECS: EventSpec[] = [
  TRADE_ROUTE_FLOURISHES,
  TRADE_ROUTE_ABANDONED,
  TRADE_ROUTE_REVIVED,
  GREAT_MARKET_FAIR,
];
