/**
 * Which parts of the living world are switched on (#1279, epic #1272).
 *
 * The game always plays the full world: darkness, seeded weather, accidents.
 * Tests can use the flat world — always light, clear weather, no accidents —
 * to check one mechanic at a time. That's a test convenience, never a game path.
 */

/** A day's weather (#1282). */
export type WeatherId = 'clear' | 'overcast' | 'rain' | 'fog' | 'wind' | 'storm' | 'snow';

export interface WorldConfig {
  /** Daylight matters (#1281). */
  darkness: boolean;
  /** Seeded daily weather, or one fixed weather every day (#1282). */
  weather: 'seeded' | WeatherId;
  /** Accidents can happen (#1285). */
  accidents: boolean;
}

export const FULL_WORLD: Readonly<WorldConfig> = { darkness: true, weather: 'seeded', accidents: true };
export const FLAT_WORLD: Readonly<WorldConfig> = { darkness: false, weather: 'clear', accidents: false };

const WEATHERS: readonly string[] = ['clear', 'overcast', 'rain', 'fog', 'wind', 'storm', 'snow'];

/** A well-formed world config from a save. */
export function validWorld(x: unknown): x is WorldConfig {
  if (typeof x !== 'object' || x === null) return false;
  const w = x as Record<string, unknown>;
  return typeof w.darkness === 'boolean' && typeof w.accidents === 'boolean' && (w.weather === 'seeded' || WEATHERS.includes(w.weather as string));
}
