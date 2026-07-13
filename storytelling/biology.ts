// biology.ts — racial biology defaults and the getBiology() helper.
//
// All RaceBiology fields are optional; getBiology() fills in the human baseline
// so call-sites can always destructure a complete object without null-checking
// every field. The NEUTRAL_BIOLOGY constant matches the behaviour of an unmodified
// human — no bonus, no penalty — so a world with no biology-defined races is
// exactly byte-identical to before.

import type { RaceBiology, RaceSpec } from "./world-spec.js";

export const NEUTRAL_BIOLOGY: Required<RaceBiology> = {
  lifespan: 75,
  sunTolerance: 1.0,
  manaAffinity: 0.5,
  fertilityRate: 1.0,
  plagueResistance: 0.0,
  dietType: "omnivore",
  preferredTerrain: [],
};

// Return a complete biology for a race, filling in neutral defaults for any
// absent fields. When the race has no biology block at all, return the constant
// directly (zero allocation).
export function getBiology(race: RaceSpec | undefined): Required<RaceBiology> {
  if (!race?.biology) return NEUTRAL_BIOLOGY;
  const b = race.biology;
  return {
    lifespan: b.lifespan ?? NEUTRAL_BIOLOGY.lifespan,
    sunTolerance: b.sunTolerance ?? NEUTRAL_BIOLOGY.sunTolerance,
    manaAffinity: b.manaAffinity ?? NEUTRAL_BIOLOGY.manaAffinity,
    fertilityRate: b.fertilityRate ?? NEUTRAL_BIOLOGY.fertilityRate,
    plagueResistance: b.plagueResistance ?? NEUTRAL_BIOLOGY.plagueResistance,
    dietType: b.dietType ?? NEUTRAL_BIOLOGY.dietType,
    preferredTerrain: b.preferredTerrain ?? NEUTRAL_BIOLOGY.preferredTerrain,
  };
}
