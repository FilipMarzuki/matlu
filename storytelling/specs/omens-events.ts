// specs/omens-events.ts — celestial signs and folk portents.
//
// Rare, low-mechanical, high-narrative events. A comet, an eclipse, a
// deformed calf. Chroniclers of every era wrote them down. They don't
// break state — they colour the years around a war, a death, a coronation.
// Chronicle prose treats them as omens even though the engine doesn't wire
// them into decisions (yet).

import type { EventSpec } from "../event-spec.js";
import type { Province } from "../types.js";
import type { World } from "../world.js";

function provName(w: World, id: string | null): string {
  return w.province(id ?? "")?.name ?? "the sky";
}

// Has an event of this type fired anywhere in the last `window` years?
function anyRecent(w: World, type: string, window: number): boolean {
  return w.events.some((e) => e.type === type && w.year - e.year < window);
}

// Pick one province deterministically each tick — the "greatest capital" is
// where a celestial sign is chronicled. Prefers largest-pop province with a
// titled holder; falls back to the largest province at all.
function chronicleProvince(w: World): Province | null {
  let best: Province | null = null;
  let bestPop = -1;
  for (const p of w.provinces.values()) {
    if (p.population > bestPop) {
      best = p;
      bestPop = p.population;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// SOLAR_ECLIPSE — once every ~70 years. Chronicled at the capital.
// ---------------------------------------------------------------------------
const SOLAR_ECLIPSE: EventSpec = {
  type: "SOLAR_ECLIPSE",
  base: 8,
  render: (ev, w) => `The sun went dark over ${provName(w, ev.provinceId)}, and the chroniclers wrote of dread and doom.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => !anyRecent(w, "SOLAR_ECLIPSE", 70),
    prob: () => 0.02,
    fire: (w) => {
      const p = chronicleProvince(w);
      if (!p) return;
      w.log("SOLAR_ECLIPSE", { provinceId: p.id });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// COMET_APPEARS — once every ~60 years. Universally read as omen.
// ---------------------------------------------------------------------------
const COMET_APPEARS: EventSpec = {
  type: "COMET_APPEARS",
  base: 7,
  render: (ev, w) => `A comet crossed the sky above ${provName(w, ev.provinceId)}, and even sober scholars called it a sign.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => !anyRecent(w, "COMET_APPEARS", 60),
    prob: () => 0.025,
    fire: (w) => {
      const p = chronicleProvince(w);
      if (!p) return;
      w.log("COMET_APPEARS", { provinceId: p.id });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// AURORA_SIGHTED — northern lights seen unnaturally far south. Once ~40y.
// ---------------------------------------------------------------------------
const AURORA_SIGHTED: EventSpec = {
  type: "AURORA_SIGHTED",
  base: 6,
  render: (ev, w) => `Strange lights danced in the northern sky above ${provName(w, ev.provinceId)} — an aurora sighted where none should be.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => !anyRecent(w, "AURORA_SIGHTED", 40),
    prob: () => 0.03,
    fire: (w) => {
      const p = chronicleProvince(w);
      if (!p) return;
      w.log("AURORA_SIGHTED", { provinceId: p.id });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// BLOOD_MOON — lunar eclipse, doom read into the reddened moon. ~30y.
// ---------------------------------------------------------------------------
const BLOOD_MOON: EventSpec = {
  type: "BLOOD_MOON",
  base: 6,
  render: (ev, w) => `The moon turned red above ${provName(w, ev.provinceId)}, and the pious spoke of the wrath to come.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => !anyRecent(w, "BLOOD_MOON", 30),
    prob: () => 0.04,
    fire: (w) => {
      const p = chronicleProvince(w);
      if (!p) return;
      w.log("BLOOD_MOON", { provinceId: p.id });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
// EARTHQUAKE_TREMORS — felt tremor without catastrophe damage. Per-province.
// ---------------------------------------------------------------------------
const EARTHQUAKE_TREMORS: EventSpec = {
  type: "EARTHQUAKE_TREMORS",
  base: 5,
  render: (ev, w) => `Tremors ran through the earth of ${provName(w, ev.provinceId)}, and old walls cracked without falling.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      // No repeat at the same province within 20y.
      return !w.events.some(
        (e) => e.type === "EARTHQUAKE_TREMORS" && e.provinceId === p.id && w.year - e.year < 20,
      );
    },
    prob: () => 0.005,
    fire: (w, item) => {
      const p = item as Province;
      w.log("EARTHQUAKE_TREMORS", { provinceId: p.id });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// MONSTROUS_BIRTH — deformed calf or child in a corrupted / high-inbreeding
// province. Folk omen; picks up the perceptual load of superstition.
// ---------------------------------------------------------------------------
const MONSTROUS_BIRTH: EventSpec = {
  type: "MONSTROUS_BIRTH",
  base: 6,
  render: (ev, w) => `A monstrous birth was reported in ${provName(w, ev.provinceId)} — a calf with two heads, a child with strange marks — and the midwives shuttered their doors.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w, item) => {
      const p = item as Province;
      // Blighted province or a high-inbreeding character present.
      if (p.blightLevel > 0.15) return true;
      const inbred = w.living().find((c) => c.provinceId === p.id && c.psyche.inbreedingCoeff > 0.15);
      return !!inbred;
    },
    prob: () => 0.006,
    fire: (w, item) => {
      const p = item as Province;
      w.log("MONSTROUS_BIRTH", { provinceId: p.id });
    },
    maxPerTick: 2,
  },
};

// ---------------------------------------------------------------------------
// TWIN_STARS — a supernova or paired bright stars. Once per ~150 years.
// The rarest sign; scholars try to date the crown to it forever after.
// ---------------------------------------------------------------------------
const TWIN_STARS: EventSpec = {
  type: "TWIN_STARS",
  base: 9,
  render: (ev, w) => `Two stars burned side-by-side in the night above ${provName(w, ev.provinceId)} — the astronomers wrote of a new heaven, the priests of a new age.`,
  arc: (ev) => ev.provinceId ? { key: `E:${ev.provinceId}`, kind: "calamity" } : null,
  ambient: {
    scan: "provinces",
    gate: (w) => !anyRecent(w, "TWIN_STARS", 150),
    prob: () => 0.01,
    fire: (w) => {
      const p = chronicleProvince(w);
      if (!p) return;
      w.log("TWIN_STARS", { provinceId: p.id });
    },
    maxPerTick: 1,
  },
};

// ---------------------------------------------------------------------------
export const OMENS_SPECS: EventSpec[] = [
  SOLAR_ECLIPSE,
  COMET_APPEARS,
  AURORA_SIGHTED,
  BLOOD_MOON,
  EARTHQUAKE_TREMORS,
  MONSTROUS_BIRTH,
  TWIN_STARS,
];
