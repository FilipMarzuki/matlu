// climate.ts — multi-decade climate patterns.
//
// Historical: the Medieval Warm Period (~950-1250) allowed Norse expansion,
// vineyards in England, and grain in Greenland. The Little Ice Age (~1300-
// 1850) collapsed Norse Greenland, froze the Thames, and drove famines that
// weakened medieval polities. This module encodes that persistent multi-year
// drift with a simple phase system: cold / warm / neutral.
//
// A phase runs for 30-80 years, then rolls to a new phase. Cold phases dampen
// harvests (people freeze, crops fail) and slow plague spread (bacteria hate
// cold); warm phases boost harvests but accelerate plague. Neutral phases have
// no effect and are the default.
//
// Guarded on `catastrophesEnabled` for RNG symmetry with the base sim.

import type { ClimatePhase } from "./types.js";
import type { World } from "./world.js";

const PHASE_MIN_YEARS = 30;
const PHASE_MAX_YEARS = 80;

// Called from tick.ts once per year, before runCatastrophes. Handles phase
// aging and phase transitions. Fires CLIMATE_*_ONSET / _NEUTRAL_RESUMES /
// GREAT_FROST / LONG_SUMMER events as appropriate.
export function runClimate(w: World): void {
  if (!w.catastrophesEnabled) return;
  const c = w.climate;
  const inPhaseYears = w.year - c.phaseStartYear;

  // Phase transition check — after the current phase's duration, roll a new one.
  if (inPhaseYears >= c.phaseDurationYears) {
    rollNewPhase(w);
    return;
  }

  // Mid-phase extreme events — rare, only during non-neutral phases.
  if (c.phase === "cold" && inPhaseYears >= 5 && w.rng.chance(0.02)) {
    w.log("GREAT_FROST", {
      provinceId: null,
      data: { severity: c.severity, phaseYear: inPhaseYears },
    });
  } else if (c.phase === "warm" && inPhaseYears >= 5 && w.rng.chance(0.02)) {
    w.log("LONG_SUMMER", {
      provinceId: null,
      data: { severity: c.severity, phaseYear: inPhaseYears },
    });
  }
}

// Choose the next climate phase, biased away from the current one (climate
// oscillates, doesn't stay locked). Neutral is the most common transition
// destination — extreme phases are rarer than mid-line ones.
function rollNewPhase(w: World): void {
  const c = w.climate;
  const roll = w.rng.float(0, 1);
  let next: ClimatePhase;
  if (c.phase === "neutral") {
    // From neutral: 40% cold, 40% warm, 20% stay neutral (short reset)
    next = roll < 0.4 ? "cold" : roll < 0.8 ? "warm" : "neutral";
  } else {
    // From cold or warm: 60% neutral, 25% opposite, 15% same
    next = roll < 0.6 ? "neutral"
         : roll < 0.85 ? (c.phase === "cold" ? "warm" : "cold")
         : c.phase;
  }
  c.phase = next;
  c.phaseStartYear = w.year;
  c.phaseDurationYears = Math.round(w.rng.float(PHASE_MIN_YEARS, PHASE_MAX_YEARS));
  c.severity = next === "neutral" ? 0 : w.rng.float(0.4, 0.9);

  if (next === "cold") {
    w.log("CLIMATE_COLD_ONSET", {
      provinceId: null,
      data: { duration: c.phaseDurationYears, severity: c.severity },
    });
  } else if (next === "warm") {
    w.log("CLIMATE_WARM_ONSET", {
      provinceId: null,
      data: { duration: c.phaseDurationYears, severity: c.severity },
    });
  } else {
    w.log("CLIMATE_NEUTRAL_RESUMES", {
      provinceId: null,
      data: { duration: c.phaseDurationYears },
    });
  }
}

// ---------------------------------------------------------------------------
// Effect readers — used by phenomena.ts:runHarvest and runPlague.
// ---------------------------------------------------------------------------

// Multiplier applied to harvest yield. Cold phases reduce yield; warm phases
// increase it. Neutral phases return 1.0.
export function climateHarvestMultiplier(w: World): number {
  const c = w.climate;
  if (c.phase === "cold") return Math.max(0.5, 1 - c.severity * 0.4);
  if (c.phase === "warm") return Math.min(1.4, 1 + c.severity * 0.25);
  return 1.0;
}

// Multiplier applied to plague spread probability. Cold slows plague (fewer
// vectors, fleas dormant), warm accelerates (rats + fleas both surge).
export function climatePlagueMultiplier(w: World): number {
  const c = w.climate;
  if (c.phase === "cold") return Math.max(0.6, 1 - c.severity * 0.35);
  if (c.phase === "warm") return Math.min(1.4, 1 + c.severity * 0.3);
  return 1.0;
}
