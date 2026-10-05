/**
 * Daily weather (#1282, epic #1272).
 *
 * Each day has one weather, rolled from the Warden's seed and the day — a fixed
 * schedule per character, so a run replays exactly but can't be predicted in
 * play. The odds shift with the season: from day 9 storms and wind are likelier
 * and early snow can fall. A look-out shows tomorrow; the Weather sense
 * technique (#1243) gives tomorrow and the day after, every morning.
 *
 * This module only says *what* the weather is. Its effects on temperature
 * (#1283) and on work and travel (#1284) come next.
 */

import { streamFor } from './rng';
import type { WeatherId, WorldConfig } from './world';

export type { WeatherId } from './world';

export const WEATHER: Readonly<Record<WeatherId, { name: string; early: number; late: number }>> = {
  clear: { name: 'Clear', early: 30, late: 20 },
  overcast: { name: 'Overcast', early: 30, late: 25 },
  rain: { name: 'Rain', early: 20, late: 20 },
  fog: { name: 'Fog', early: 10, late: 10 },
  wind: { name: 'Wind', early: 7, late: 10 },
  storm: { name: 'Storm', early: 3, late: 5 },
  snow: { name: 'Early snow', early: 0, late: 10 },
};
export const WEATHER_IDS = Object.keys(WEATHER) as WeatherId[];

/** The first day the late-autumn odds apply (and snow can fall). */
export const LATE_SEASON_FROM = 9;

/** The odds (in percent, summing to 100) of each weather on a given day. */
export function oddsFor(day: number): Record<WeatherId, number> {
  const late = day >= LATE_SEASON_FROM;
  return Object.fromEntries(WEATHER_IDS.map(id => [id, late ? WEATHER[id].late : WEATHER[id].early])) as Record<WeatherId, number>;
}

/** The weather on a day for a Warden's seed. In the flat world (tests) it's always the world's fixed weather. */
export function weatherFor(seed: number, day: number, world: Pick<WorldConfig, 'weather'>): WeatherId {
  if (world.weather !== 'seeded') return world.weather;
  const u = streamFor(seed, day, 'weather')() * 100;
  const odds = oddsFor(day);
  let acc = 0;
  for (const id of WEATHER_IDS) {
    acc += odds[id];
    if (u < acc) return id;
  }
  return 'clear';
}

/** Known future weather, by day. */
export type Forecast = Partial<Record<number, WeatherId>>;

/** What the Warden knows of the coming days, soonest first (only days still to come). */
export function knownForecast(s: { day: number; forecast: Forecast }): { day: number; weather: WeatherId }[] {
  return Object.entries(s.forecast)
    .map(([d, w]) => ({ day: Number(d), weather: w as WeatherId }))
    .filter(f => f.day > s.day)
    .sort((a, b) => a.day - b.day);
}
