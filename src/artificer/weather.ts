/**
 * Daily weather (#1282, epic #1272).
 *
 * Each day has one weather, rolled from the Warden's seed and the day — a fixed
 * schedule per character, so a run replays exactly but can't be predicted in
 * play. The odds follow the season (#1301): early autumn is mild; late autumn
 * (from day 16) brings more wind and storms, and early snow from day 20; in
 * winter snow is the commonest weather and a storm is a blizzard. A look-out shows tomorrow; the Weather sense
 * technique (#1243) gives tomorrow and the day after, every morning.
 *
 * This module only says *what* the weather is. Its effects on temperature
 * (#1283) and on work and travel (#1284) come next.
 */

import { streamFor } from './rng';
import type { WeatherId, WorldConfig } from './world';
import type { ActionId } from './region1';
import { DEFAULT_CALENDAR, seasonCurve, seasonOf, type Calendar } from './winter';

export type { WeatherId } from './world';

/**
 * Each weather's odds (percent) in the three weather seasons, and its name in
 * winter when that differs: snow is no longer early, and a storm is a blizzard.
 */
export const WEATHER: Readonly<Record<WeatherId, { name: string; winterName?: string; early: number; late: number; winter: number }>> = {
  clear: { name: 'Clear', early: 30, late: 20, winter: 20 },
  overcast: { name: 'Overcast', early: 30, late: 25, winter: 20 },
  rain: { name: 'Rain', early: 20, late: 20, winter: 0 },
  fog: { name: 'Fog', early: 10, late: 10, winter: 5 },
  wind: { name: 'Wind', early: 7, late: 10, winter: 12 },
  storm: { name: 'Storm', winterName: 'Blizzard', early: 3, late: 5, winter: 8 },
  snow: { name: 'Early snow', winterName: 'Snow', early: 0, late: 10, winter: 35 },
};
export const WEATHER_IDS = Object.keys(WEATHER) as WeatherId[];

/** The first day of late autumn: halfway to the snow (day 16). */
export const lateFrom = (cal: Calendar): number => Math.ceil(cal.winterDay / 2);
/** The first day early snow can fall: 11 days before winter (day 20), never before late autumn. */
export const snowFrom = (cal: Calendar): number => Math.max(lateFrom(cal), cal.winterDay - 11);

/**
 * The odds (in percent, summing to 100) of each weather on a given day. In
 * late autumn before snow can fall, its share goes to cloud and rain.
 */
export function oddsFor(day: number, cal: Calendar = DEFAULT_CALENDAR): Record<WeatherId, number> {
  if (seasonOf(day, cal) !== 'autumn') return Object.fromEntries(WEATHER_IDS.map(id => [id, WEATHER[id].winter])) as Record<WeatherId, number>;
  if (day < lateFrom(cal)) return Object.fromEntries(WEATHER_IDS.map(id => [id, WEATHER[id].early])) as Record<WeatherId, number>;
  const odds = Object.fromEntries(WEATHER_IDS.map(id => [id, WEATHER[id].late])) as Record<WeatherId, number>;
  if (day < snowFrom(cal)) {
    odds.overcast += odds.snow / 2;
    odds.rain += odds.snow / 2;
    odds.snow = 0;
  }
  return odds;
}

/** What the weather is called on a day: snow and storms take their winter names once winter comes. */
export const weatherName = (w: WeatherId, day: number, cal: Calendar = DEFAULT_CALENDAR): string =>
  (seasonOf(day, cal) === 'autumn' ? WEATHER[w].name : WEATHER[w].winterName ?? WEATHER[w].name);

/** The weather on a day for a Warden's seed. In the flat world (tests) it's always the world's fixed weather. */
export function weatherFor(seed: number, day: number, world: Pick<WorldConfig, 'weather'>, cal: Calendar = DEFAULT_CALENDAR): WeatherId {
  if (world.weather !== 'seeded') return world.weather;
  const u = streamFor(seed, day, 'weather')() * 100;
  const odds = oddsFor(day, cal);
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

/** The mean temperature (°C) on day 1, the last day of autumn, midwinter and the last day of winter. */
export const MEAN_TEMP: readonly [number, number, number, number] = [10, -2, -12, -4];

/** The day's mean temperature: 10 °C on day 1, −2 °C as autumn ends, −12 °C at midwinter, −4 °C before the thaw. */
export const dayMean = (day: number, cal: Calendar = DEFAULT_CALENDAR): number => seasonCurve(day, cal, MEAN_TEMP);

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
export const tempAt = (day: number, hour: number, w: WeatherId, cal: Calendar = DEFAULT_CALENDAR): number =>
  dayMean(day, cal) + swing(hour) + weatherShift(w, isNight(hour));

/** The night's temperature (what sleep has to beat). */
export const nightTemp = (day: number, w: WeatherId, cal: Calendar = DEFAULT_CALENDAR): number => tempAt(day, 23, w, cal);

/** Work below freezing is heavier. */
export const FREEZING_WORK = 1.1;

/** Extra hours a water trip takes once the streams ice over. */
export const ICE_EXTRA_HOURS = 1;
/** Streams ice over from the first day whose mean is below freezing. */
export const iceOn = (day: number, cal: Calendar = DEFAULT_CALENDAR): boolean => dayMean(day, cal) < 0;

/**
 * A cold, broken night: shelter warmth below 0.3, plus 0.03 for every degree
 * of frost — freezing nights need a warmer shelter. `coldNightNeeds` is that line.
 */
export const coldNightNeeds = (nightTempC: number): number => 0.3 + 0.03 * Math.max(0, -nightTempC);
export const isColdNight = (warmth: number, nightTempC: number): boolean => warmth < coldNightNeeds(nightTempC);

// ── Winter nights (#1303) ───────────────────────────────────────────────────

/** How much less firewood a warm shelter burns: a 90%-warm hut burns about a third less. */
export const FIRE_SAVING = 0.37;

/**
 * Firewood a night's fire burns (#1303): none on a night above freezing;
 * otherwise 1, plus 1 for every full 5 °C of frost — less in a warm shelter,
 * but never under 1.
 */
export function fireNeed(nightTempC: number, warmth: number): number {
  if (nightTempC >= 0) return 0;
  const base = 1 + Math.floor(-nightTempC / 5);
  return Math.max(1, Math.round(base * (1 - FIRE_SAVING * warmth)));
}

/**
 * Condition a freezing night without enough fire costs (#1303): about 8 at
 * −5 °C and 20 at −15 °C with no shelter and no fire, eased by shelter warmth
 * and sound cold gear, and scaled by how much of the fire was missing (0–1).
 * Several such nights kill.
 */
export function freezeLoss(nightTempC: number, warmth: number, coldGear: boolean, missing: number): number {
  if (nightTempC >= 0 || missing <= 0) return 0;
  return (2 + 1.2 * -nightTempC) * (1 - 0.6 * warmth) * (coldGear ? 0.7 : 1) * Math.min(1, missing);
}

/** Once the cold is this deep (day mean, °C), the streams are frozen hard and water means melting snow. */
export const MELT_BELOW = -5;
/** Streams frozen hard: water is melted snow, which costs firewood (#1303). */
export const meltsSnow = (day: number, cal: Calendar = DEFAULT_CALENDAR): boolean => dayMean(day, cal) < MELT_BELOW;
/** Firewood a water trip burns melting snow. */
export const MELT_FIREWOOD = 1;

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


/** Wind strips warmth from a night's shelter. */
export const windChill = (w: WeatherId): number => (w === 'wind' ? 0.1 : 0);
/** Wind feeds a fire: one more firewood. */
export const windFire = (w: WeatherId): number => (w === 'wind' ? 1 : 0);

/** Hours outside in the rain before you're wet through, and what it costs the mind at dusk. */
export const WET_HOURS = 4;
export const WET_CLARITY = 3;
