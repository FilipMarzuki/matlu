/**
 * Which parts of the living world are switched on (#1279, epic #1272).
 *
 * The game always plays the full world: darkness, seeded weather, accidents,
 * trip luck. Tests can use the flat world — always light, clear weather, no
 * accidents, every trip ordinary —
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
  /** Gathering trips roll their luck (#1314). Absent counts as on (saves from before it). */
  luck?: boolean;
  /** What a trip can carry home is limited (#1291). Absent counts as on (saves from before it). */
  carrying?: boolean;
  /**
   * Encounters can pause the day (#1343). Off in the full world until the encounter screen
   * (#1347) and the AI harness (#1348) can answer one; tests and later issues switch it on.
   */
  encounters?: boolean;
}

export const FULL_WORLD: Readonly<WorldConfig> = { darkness: true, weather: 'seeded', accidents: true, luck: true, carrying: true, encounters: false };
export const FLAT_WORLD: Readonly<WorldConfig> = { darkness: false, weather: 'clear', accidents: false, luck: false, carrying: false, encounters: false };

const WEATHERS: readonly string[] = ['clear', 'overcast', 'rain', 'fog', 'wind', 'storm', 'snow'];

/** A well-formed world config from a save. */
export function validWorld(x: unknown): x is WorldConfig {
  if (typeof x !== 'object' || x === null) return false;
  const w = x as Record<string, unknown>;
  return typeof w.darkness === 'boolean' && typeof w.accidents === 'boolean' && (w.luck === undefined || typeof w.luck === 'boolean') && (w.carrying === undefined || typeof w.carrying === 'boolean') && (w.encounters === undefined || typeof w.encounters === 'boolean') && (w.weather === 'seeded' || WEATHERS.includes(w.weather as string));
}
