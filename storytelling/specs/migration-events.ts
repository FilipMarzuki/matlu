// specs/migration-events.ts — render specs for the migration layer.
//
// Events are FIRED by migration.ts. This file provides base score + prose +
// arc grouping. Waves get a shared arc so a chronicle can weave the origin
// → arrival → diaspora thread as one narrative unit.

import type { EventSpec } from "../event-spec.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "an unnamed land";
}

const KIND_LABEL: Record<string, string> = {
  climate_refugees:    "climate refugees",
  barbarian_invasion:  "war-band",
  religious_expulsion: "the expelled",
  famine_flight:       "hungry migrants",
  war_displaced:       "displaced survivors",
};

const MIGRATION_WAVE_RISES: EventSpec = {
  type: "MIGRATION_WAVE_RISES",
  base: 8,
  render: (ev, w) => {
    const kind = String(ev.data["kind"] ?? "climate_refugees");
    const label = KIND_LABEL[kind] ?? "migrants";
    const size = Number(ev.data["size"] ?? 0);
    const reason = String(ev.data["reason"] ?? "the old life had run out");
    const from = provName(w, ev.provinceId);
    return `A wave of ${label} — some ${size.toLocaleString("en")} souls — left ${from} because ${reason}. They took the road east and did not look back.`;
  },
  arc: (ev) => ev.data["waveId"] ? { key: `M:${ev.data["waveId"]}`, kind: "calamity" } : null,
};

const REFUGEES_ARRIVE: EventSpec = {
  type: "REFUGEES_ARRIVE",
  base: 8,
  render: (ev, w) => {
    const size = Number(ev.data["size"] ?? 0);
    const kind = String(ev.data["kind"] ?? "refugees");
    const label = KIND_LABEL[kind] ?? "refugees";
    const to = provName(w, ev.provinceId);
    const from = provName(w, String(ev.data["from"] ?? ""));
    return `Some ${size.toLocaleString("en")} ${label} from ${from} reached ${to}. Bread was baked, blankets found, and a plainer speech was learned in the market by winter.`;
  },
  arc: (ev) => ev.data["waveId"] ? { key: `M:${ev.data["waveId"]}`, kind: "calamity" } : null,
};

const BARBARIAN_INVASION: EventSpec = {
  type: "BARBARIAN_INVASION",
  base: 11,
  render: (ev, w) => {
    const size = Number(ev.data["size"] ?? 0);
    const to = provName(w, ev.provinceId);
    const from = provName(w, String(ev.data["from"] ?? ""));
    return `A war-band of ${size.toLocaleString("en")} riders crashed into ${to} out of ${from}. The gates broke, the granaries emptied; those who lived called them cousins by the next generation.`;
  },
  arc: (ev) => ev.data["waveId"] ? { key: `M:${ev.data["waveId"]}`, kind: "calamity" } : null,
};

const RELIGIOUS_EXPULSION: EventSpec = {
  type: "RELIGIOUS_EXPULSION",
  base: 10,
  render: (ev, w) => {
    const size = Number(ev.data["size"] ?? 0);
    const from = provName(w, ev.provinceId);
    return `Some ${size.toLocaleString("en")} of the schism's losing side were driven from ${from}, their houses marked, their names read from the register. The road took them south by winter.`;
  },
  arc: (ev) => ev.data["waveId"] ? { key: `M:${ev.data["waveId"]}`, kind: "calamity" } : null,
};

const SETTLED_NEW_HOMELAND: EventSpec = {
  type: "SETTLED_NEW_HOMELAND",
  base: 9,
  render: (ev, w) => {
    const size = Number(ev.data["size"] ?? 0);
    const to = provName(w, ev.provinceId);
    return `The wave of ${size.toLocaleString("en")} settled into the fields of ${to}. Within a generation their granddaughters spoke the local tongue with only a distant lilt.`;
  },
  arc: (ev) => ev.data["waveId"] ? { key: `M:${ev.data["waveId"]}`, kind: "calamity" } : null,
};

const WAVE_DISPERSED: EventSpec = {
  type: "WAVE_DISPERSED",
  base: 7,
  render: (ev, w) => {
    const size = Number(ev.data["size"] ?? 0);
    const where = provName(w, ev.provinceId);
    const repelled = ev.data["repelled"] === true;
    return repelled
      ? `${size.toLocaleString("en")} were turned back at ${where} — the militia had drilled all winter and the gates were held.`
      : `${size.toLocaleString("en")} of the wave lost the road between ${where} and the next horizon; small bands drifted into hillside farms and were absorbed one household at a time.`;
  },
  arc: (ev) => ev.data["waveId"] ? { key: `M:${ev.data["waveId"]}`, kind: "calamity" } : null,
};

const DIASPORA_FORMED: EventSpec = {
  type: "DIASPORA_FORMED",
  base: 10,
  render: (ev, w) => {
    const size = Number(ev.data["size"] ?? 0);
    const where = provName(w, ev.provinceId);
    return `A district in ${where} became known as the ${size >= 5000 ? "outland quarter" : "resettlers' lane"} — a stubborn diaspora, keeping their old holidays, marrying mostly among themselves, remembered by the older tongue.`;
  },
  arc: (ev) => ev.data["waveId"] ? { key: `M:${ev.data["waveId"]}`, kind: "calamity" } : null,
};

// ---------------------------------------------------------------------------
export const MIGRATION_SPECS: EventSpec[] = [
  MIGRATION_WAVE_RISES,
  REFUGEES_ARRIVE,
  BARBARIAN_INVASION,
  RELIGIOUS_EXPULSION,
  SETTLED_NEW_HOMELAND,
  WAVE_DISPERSED,
  DIASPORA_FORMED,
];
