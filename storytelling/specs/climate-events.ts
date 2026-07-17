// specs/climate-events.ts — render specs for the five climate event types.
//
// The events themselves are FIRED by climate.ts:runClimate (phase transitions
// on their own schedule, mid-phase extremes at random). This file only supplies
// base score + render prose + arc grouping. No triggers here — climate.ts
// owns the phase state machine.

import type { EventSpec } from "../event-spec.js";

const CLIMATE_COLD_ONSET: EventSpec = {
  type: "CLIMATE_COLD_ONSET",
  base: 9,
  render: (ev) => {
    const dur = Number(ev.data["duration"] ?? 40);
    const sev = Number(ev.data["severity"] ?? 0.5);
    const flavor = sev > 0.7 ? "a bitter cold gripped the world" : "the winters grew longer, the summers shorter";
    return `${flavor} — a cold phase settled in, expected to last some ${dur} years.`;
  },
  arc: () => ({ key: "climate", kind: "calamity" }),
};

const CLIMATE_WARM_ONSET: EventSpec = {
  type: "CLIMATE_WARM_ONSET",
  base: 8,
  render: (ev) => {
    const dur = Number(ev.data["duration"] ?? 40);
    const sev = Number(ev.data["severity"] ?? 0.5);
    const flavor = sev > 0.7 ? "an unnatural warmth crept over the world" : "the summers warmed and the harvests grew fat";
    return `${flavor} — a warm phase began, expected to last some ${dur} years.`;
  },
  arc: () => ({ key: "climate", kind: "calamity" }),
};

const CLIMATE_NEUTRAL_RESUMES: EventSpec = {
  type: "CLIMATE_NEUTRAL_RESUMES",
  base: 6,
  render: () => `The weather settled — the great warmths and cold-strikes eased, and the seasons resumed their old cycle.`,
  arc: () => ({ key: "climate", kind: "calamity" }),
};

const GREAT_FROST: EventSpec = {
  type: "GREAT_FROST",
  base: 8,
  render: () => `A great frost struck — rivers froze from bank to bank, the northern seas locked shut, and the grain-stores were stripped bare.`,
  arc: () => ({ key: "climate", kind: "calamity" }),
};

const LONG_SUMMER: EventSpec = {
  type: "LONG_SUMMER",
  base: 7,
  render: () => `A long summer scorched the fields — the springs dried, the herds were driven far, and the crops came in early but light.`,
  arc: () => ({ key: "climate", kind: "calamity" }),
};

// ---------------------------------------------------------------------------
export const CLIMATE_SPECS: EventSpec[] = [
  CLIMATE_COLD_ONSET,
  CLIMATE_WARM_ONSET,
  CLIMATE_NEUTRAL_RESUMES,
  GREAT_FROST,
  LONG_SUMMER,
];
