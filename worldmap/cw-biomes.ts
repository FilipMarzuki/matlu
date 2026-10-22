/**
 * Core Warden's biome classifier (#1907): a copy of `tileBiomeIdx` from `src/world/biomes.ts`,
 * character for character.
 *
 * Why a copy and not an import: `worldmap/` is the world both games read, so it must not reach
 * into either game's code (`src/`), same reasoning as `rng.ts` (#1895). A copy can drift, so
 * `cw-biomes.test.ts` pins the two equal over a grid of (elev, temp, moist): change one, change
 * both.
 */

/** Resolve biome index from noise values (elevation, temperature, moisture). */
export function tileBiomeIdx(elev: number, temp: number, moist: number): number {
  if (elev < 0.25) return 0;
  if (elev < 0.30) return (temp < 0.45 || moist > 0.50) ? 1 : 2;
  if (elev < 0.45 && moist > 0.72) return 3;
  if (elev < 0.68) return moist > 0.55 ? 7 : 6;
  if (elev < 0.80) return temp > 0.50 ? 8 : 9;
  return temp < 0.40 ? 11 : 10;
}
