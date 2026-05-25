/**
 * EnvironmentalContext — runtime environmental state for wildlife and gameplay systems.
 *
 * Computed once per frame from WeatherSystem, SeasonSystem, and WorldClock.
 * Provides global modifiers (season temp, weather wind) and position-aware
 * queries (temperature/moisture/wind at any world coordinate) that layer
 * global state + base terrain noise + local effects (fire, corruption, etc.).
 *
 * Local effects are point sources with radius and linear falloff — any gameplay
 * system can add/remove them to affect the environment dynamically.
 */

import type { WeatherCondition } from './WorldState';
import type { Season } from './SeasonSystem';
import type { DayPhase } from './WorldClock';
import type { FbmNoise } from '../lib/noise';

// ── Global context (computed once per frame) ────────────────────────────────────

export interface EnvironmentalContext {
  weather:        WeatherCondition;
  isRaining:      boolean;
  season:         Season;
  phase:          DayPhase;
  /** Season contribution to temperature (-0.15 winter to +0.10 summer). */
  seasonTempMod:  number;
  /** Time-of-day contribution to temperature (-0.05 night to +0.05 midday). */
  timeTempMod:    number;
  /** Weather contribution to temperature (rain = -0.05, clear = 0). */
  weatherTempMod: number;
  /** Quick global temperature feel (0-1), ignoring position. */
  globalTempHint: number;
  /** Global wind strength (0-1). */
  windStrength:   number;
  /** Season contribution to mana density. Myst flows stronger in spring/rainy. */
  seasonManaMod:  number;
  /** Time-of-day contribution to mana. Peaks at dawn/dusk (liminal hours). */
  timeManaMod:    number;
  /** Quick global mana hint (0-1), ignoring position. */
  globalManaHint: number;
}

const SEASON_TEMP: Record<Season, number> = {
  spring: 0.0, rainy: -0.05, summer: 0.10, autumn: -0.05, winter: -0.15,
};

const PHASE_TEMP: Record<DayPhase, number> = {
  dawn: -0.02, morning: 0.02, midday: 0.05, afternoon: 0.03, dusk: -0.02, night: -0.05,
};

const WEATHER_TEMP: Record<WeatherCondition, number> = {
  clear: 0, rain: -0.05, ash: -0.02,
};

const WEATHER_WIND: Record<WeatherCondition, number> = {
  clear: 0.3, rain: 0.7, ash: 0.2,
};

// Mana/Myst flows stronger in spring and rainy season (growth, water = conduit).
const SEASON_MANA: Record<Season, number> = {
  spring: 0.10, rainy: 0.08, summer: 0.0, autumn: -0.05, winter: -0.10,
};

// Liminal hours (dawn/dusk) carry stronger mana — the threshold between states.
const PHASE_MANA: Record<DayPhase, number> = {
  dawn: 0.08, morning: 0.0, midday: -0.03, afternoon: 0.0, dusk: 0.08, night: 0.03,
};

export function buildEnvironmentalContext(
  weather: WeatherCondition,
  season: Season,
  phase: DayPhase,
): EnvironmentalContext {
  const seasonTempMod  = SEASON_TEMP[season];
  const timeTempMod    = PHASE_TEMP[phase];
  const weatherTempMod = WEATHER_TEMP[weather];
  const seasonManaMod  = SEASON_MANA[season];
  const timeManaMod    = PHASE_MANA[phase];
  return {
    weather,
    isRaining:      weather === 'rain',
    season,
    phase,
    seasonTempMod,
    timeTempMod,
    weatherTempMod,
    globalTempHint: Math.max(0, Math.min(1, 0.5 + seasonTempMod + timeTempMod + weatherTempMod)),
    windStrength:   WEATHER_WIND[weather],
    seasonManaMod,
    timeManaMod,
    globalManaHint: Math.max(0, Math.min(1, 0.5 + seasonManaMod + timeManaMod)),
  };
}

// ── Local environment effects ───────────────────────────────────────────────────

/**
 * A point-source environmental modifier (fire, corruption, hot spring, etc.).
 * Affects temperature, moisture, and wind within a radius using linear falloff.
 */
export interface LocalEnvironmentEffect {
  id:         string;   // unique identifier for removal
  wx:         number;   // world-space X center
  wy:         number;   // world-space Y center
  radius:     number;   // effect radius in px
  tempDelta:  number;   // temperature change at center (+0.3 fire, -0.25 corruption)
  moistDelta: number;   // moisture change at center (-0.2 fire, +0.3 flooding)
  windDelta:  number;   // wind change at center (+0.5 explosion shockwave)
  manaDelta:  number;   // mana density change (+0.4 shrine/leyline, -0.3 corruption drain)
  expireTime: number;   // timestamp when effect ends (Infinity = permanent)
}

/**
 * Manages active local environment effects. Stored on the scene, mutated by
 * gameplay systems (fire, magic, corruption, placed objects).
 */
export class LocalEnvironmentEffects {
  private effects: LocalEnvironmentEffect[] = [];

  add(effect: LocalEnvironmentEffect): void {
    this.effects.push(effect);
  }

  remove(id: string): void {
    const idx = this.effects.findIndex(e => e.id === id);
    if (idx >= 0) this.effects.splice(idx, 1);
  }

  /** Remove expired effects. Call once per frame. */
  prune(now: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].expireTime <= now) this.effects.splice(i, 1);
    }
  }

  /** Sum all local deltas at a world position (linear falloff from center). */
  sample(wx: number, wy: number): { temp: number; moist: number; wind: number; mana: number } {
    let temp = 0, moist = 0, wind = 0, mana = 0;
    for (const e of this.effects) {
      const dx = wx - e.wx, dy = wy - e.wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= e.radius) continue;
      const falloff = 1 - d / e.radius;
      temp  += e.tempDelta  * falloff;
      moist += e.moistDelta * falloff;
      wind  += e.windDelta  * falloff;
      mana  += e.manaDelta  * falloff;
    }
    return { temp, moist, wind, mana };
  }

  get count(): number { return this.effects.length; }
}

// ── Position-aware queries ──────────────────────────────────────────────────────

/**
 * Get effective temperature at a world position (0 = freezing, 1 = hot).
 * Layers: base terrain noise + season + time of day + weather + local effects.
 */
export function getTemperatureAt(
  ctx: EnvironmentalContext,
  wx: number, wy: number,
  tempNoise: FbmNoise,
  tempScale: number,
  localEffects?: LocalEnvironmentEffects,
): number {
  const base = tempNoise.fbm(wx * tempScale, wy * tempScale, 3, 0.5);
  const local = localEffects?.sample(wx, wy).temp ?? 0;
  return Math.max(0, Math.min(1, base + ctx.seasonTempMod + ctx.timeTempMod + ctx.weatherTempMod + local));
}

/**
 * Get effective moisture at a world position (0 = arid, 1 = saturated).
 * Layers: base terrain noise + rain bonus + local effects.
 */
export function getMoistureAt(
  ctx: EnvironmentalContext,
  wx: number, wy: number,
  moistNoise: FbmNoise,
  moistScale: number,
  localEffects?: LocalEnvironmentEffects,
): number {
  const base = moistNoise.fbm(wx * moistScale, wy * moistScale, 3, 0.5);
  const rainMod = ctx.isRaining ? 0.15 : 0;
  const local = localEffects?.sample(wx, wy).moist ?? 0;
  return Math.max(0, Math.min(1, base + rainMod + local));
}

/**
 * Get effective wind strength at a world position (0 = calm, 1+ = gusty).
 * Layers: global weather wind + local effects.
 */
export function getWindAt(
  ctx: EnvironmentalContext,
  wx: number, wy: number,
  localEffects?: LocalEnvironmentEffects,
): number {
  const local = localEffects?.sample(wx, wy).wind ?? 0;
  return Math.max(0, Math.min(1, ctx.windStrength + local));
}

/**
 * Get effective mana density at a world position (0 = dead zone, 1 = saturated).
 * Layers: base terrain noise + season + time of day + local effects.
 *
 * Mana follows its own noise layer (independent of temperature/moisture).
 * If no mana noise is provided, falls back to the global hint.
 *
 * Lore context:
 * - Spinolandet: mana is metabolic, organisms have mana-organs
 * - Mistheim: Myst (mana) flows through the world like a current
 * - Earth: mana is thin/absent except at corruption boundaries
 */
export function getManaDensityAt(
  ctx: EnvironmentalContext,
  wx: number, wy: number,
  manaNoise?: FbmNoise,
  manaScale?: number,
  localEffects?: LocalEnvironmentEffects,
): number {
  const base = manaNoise && manaScale
    ? manaNoise.fbm(wx * manaScale, wy * manaScale, 3, 0.5)
    : 0.5; // default mid-range if no noise provided
  const local = localEffects?.sample(wx, wy).mana ?? 0;
  return Math.max(0, Math.min(1, base + ctx.seasonManaMod + ctx.timeManaMod + local));
}
