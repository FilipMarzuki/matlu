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
import type { ActionId } from './region1';

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

// ── Temperature (#1283) ─────────────────────────────────────────────────────

/** The day's mean temperature: 10 °C on day 1, falling 1.2 °C a day (below freezing from day 10). */
export const dayMean = (day: number): number => 10 - 1.2 * (day - 1);

/** Clock hours of the coldest (dawn) and warmest (midday) points; night stays at the dawn level. */
const DAWN = 6, MIDDAY = 13, DUSK = 20;
const DAWN_DIP = -4, MIDDAY_RISE = 3;

/** The daily swing: −4 at dawn, rising to +3 at midday, back to −4 by 20:00 and through the night. */
function swing(hour: number): number {
  if (hour >= DAWN && hour <= MIDDAY) return DAWN_DIP + (MIDDAY_RISE - DAWN_DIP) * (hour - DAWN) / (MIDDAY - DAWN);
  if (hour > MIDDAY && hour <= DUSK) return MIDDAY_RISE + (DAWN_DIP - MIDDAY_RISE) * (hour - MIDDAY) / (DUSK - MIDDAY);
  return DAWN_DIP;
}

/** How the weather shifts the temperature: clear nights are colder, cloudy ones milder, snow cold all day. */
function weatherShift(w: WeatherId, night: boolean): number {
  if (w === 'snow') return -5;
  if (night && w === 'clear') return -3;
  if (night && w === 'overcast') return 2;
  return 0;
}

const isNight = (hour: number): boolean => hour < DAWN || hour >= DUSK;

/** The temperature (°C) at a clock hour on a day in this weather. */
export const tempAt = (day: number, hour: number, w: WeatherId): number => dayMean(day) + swing(hour) + weatherShift(w, isNight(hour));

/** The night's temperature (what sleep has to beat). */
export const nightTemp = (day: number, w: WeatherId): number => tempAt(day, 23, w);

/** Work below freezing is heavier. */
export const FREEZING_WORK = 1.1;

/** Extra hours a water trip takes once the streams ice over. */
export const ICE_EXTRA_HOURS = 1;
/** Streams ice over from the first day whose mean is below freezing. */
export const iceOn = (day: number): boolean => dayMean(day) < 0;

/**
 * A cold, broken night: shelter warmth below 0.3, plus 0.03 for every degree
 * of frost — freezing nights need a warmer shelter.
 */
export const isColdNight = (warmth: number, nightTempC: number): boolean => warmth < 0.3 + 0.03 * Math.max(0, -nightTempC);

// ── Weather on the work (#1284) ─────────────────────────────────────────────

/** Rain makes these slower: wet wood, slick stone, sodden forage. */
const RAIN_SLOW: readonly ActionId[] = ['gather', 'wood', 'quarry'];
/** How much longer work takes in this weather. */
export const weatherHours = (w: WeatherId, action: ActionId): number => (w === 'rain' && RAIN_SLOW.includes(action) ? 1.25 : 1);

/** Fog hides the land: scouting and surveying learn nothing. */
export const blindInFog = (w: WeatherId, action: ActionId): boolean => w === 'fog' && (action === 'scout' || action === 'survey');

/** A storm keeps you out of the far rings. */
export const stormBars = (w: WeatherId, ring: number): boolean => w === 'storm' && ring >= 2;

/** Drain on outdoor work in this weather: a storm batters near work; snow shows the tracks. */
export function weatherDrain(w: WeatherId, action: ActionId, ringed: boolean, ring: number): number {
  if (w === 'storm' && ringed && ring === 1) return 1.3;
  if (w === 'snow' && action === 'track') return 0.8;
  return 1;
}

/** How much of a haul the weather leaves you: snow buries forage. */
export const weatherYield = (w: WeatherId, action: ActionId): number => (w === 'snow' && action === 'gather' ? 0.5 : 1);

/** Wind strips warmth from a night's shelter. */
export const windChill = (w: WeatherId): number => (w === 'wind' ? 0.1 : 0);
/** Wind feeds a fire: one more firewood. */
export const windFire = (w: WeatherId): number => (w === 'wind' ? 1 : 0);

/** Hours outside in the rain before you're wet through, and what it costs the mind at dusk. */
export const WET_HOURS = 4;
export const WET_CLARITY = 3;
