/**
 * Accidents (#1285, epic #1276): a tired Warden working in the dark or in a storm can get hurt.
 *
 * Fortune is fixed in time: every hour of every day has one seeded value (`fortuneAt`, #1279),
 * the same whatever you plan. An action takes the *worst* hour it spans, and an accident happens
 * when that fortune falls under the action's risk — so a bad hour only matters if you do something
 * risky in it, and moving risky work out of a bad hour is a real, fair choice. Changing the plan
 * never shifts later rolls: there is no counter.
 *
 * How bad it is depends first on how dangerous the work was (its band), then on how deep the miss
 * was. This part has bruises, cuts and lost hauls; damaged tools and sprains come with #1286.
 *
 * Pure: region1.ts rolls after each piece of work and applies what comes back.
 */

import { fortuneAt } from './rng';
import { drainMult } from './skills';
import type { WeatherId } from './world';

/** Base risk per hour of outdoor work or walking. */
export const OUTDOOR_RISK = 0.01;
/** Base risk per hour at the bench; double for knapping or a blade. */
export const CRAFT_RISK = 0.005;
/** No single piece of work is worse than this. */
export const RISK_CAP = 0.35;
/** Below these at the start, you're exhausted or foggy: × EXHAUSTED_RISK / × FOGGY_RISK. */
export const EXHAUSTED_BELOW = 20, FOGGY_BELOW = 30, EXHAUSTED_RISK = 1.5, FOGGY_RISK = 1.5;

/** How the weather makes outdoor work riskier. Fog is worst for the walk out. */
export const WEATHER_RISK: Readonly<Record<WeatherId, number>> = { clear: 1, overcast: 1, wind: 1, rain: 1.5, fog: 1.5, snow: 1.5, storm: 2.5 };
export const FOG_WALK_RISK = 3;

/** What an outdoor piece of work is like, for its risk. */
export interface WorkRisk {
  /** Hours of work and walking. */
  hours: number;
  /** The light it has, 0–1 (#1280). */
  light: number;
  weather: WeatherId;
  /** It walks out to a far ring (fog is worse on the walk). */
  walking?: boolean;
  /** A blizzard counts as a storm. */
  blizzard?: boolean;
  /** Vigor and Clarity at the start. */
  vigor: number;
  clarity: number;
  /** True level of the skill the work uses. */
  skillLevel: number;
}

/**
 * The risk of an outdoor piece of work: 1% an hour, made worse by darkness (1 + 2·(1 − light)),
 * the weather, exhaustion and a foggy mind, made better by skill — and never above 35%.
 */
export function accidentRisk(c: WorkRisk): number {
  const weather = c.blizzard ? WEATHER_RISK.storm : c.weather === 'fog' && c.walking ? FOG_WALK_RISK : WEATHER_RISK[c.weather];
  const r = OUTDOOR_RISK * c.hours * (1 + 2 * (1 - c.light)) * weather
    * (c.vigor < EXHAUSTED_BELOW ? EXHAUSTED_RISK : 1) * (c.clarity < FOGGY_BELOW ? FOGGY_RISK : 1) * drainMult(c.skillLevel);
  return Math.min(RISK_CAP, r);
}

/** What a craft at camp is like, for its risk. */
export interface CraftRisk {
  hours: number;
  /** Knapping or a blade (a stone knife, cutting hide): double. */
  blade: boolean;
  /** A shelter is built outdoors: the outdoor rate. */
  building: boolean;
  light: number;
  /** In the dark, whether a fire lights the work. */
  firelight: boolean;
  vigor: number;
  clarity: number;
  skillLevel: number;
  /** Careful Hands' tier, 0 if you don't have it. */
  carefulTier: number;
}

/** In the dark (light under 0.5), crafting without a fire doubles the risk; by firelight, × 1.3. */
export const DARK_CRAFT_RISK = 2, FIRELIT_CRAFT_RISK = 1.3;

/** The risk of a craft: 0.5% an hour (double with a blade, the outdoor rate for building), the dark, tiredness, skill and Careful Hands. */
export function craftRisk(c: CraftRisk): number {
  const base = c.building ? OUTDOOR_RISK : CRAFT_RISK * (c.blade ? 2 : 1);
  const dark = c.light >= 0.5 ? 1 : c.firelight ? FIRELIT_CRAFT_RISK : DARK_CRAFT_RISK;
  const r = base * c.hours * dark * (c.vigor < EXHAUSTED_BELOW ? EXHAUSTED_RISK : 1) * (c.clarity < FOGGY_BELOW ? FOGGY_RISK : 1)
    * drainMult(c.skillLevel) * (1 - 0.1 * c.carefulTier);
  return Math.min(RISK_CAP, r);
}

/** The worst fortune among the hours a piece of work spans, starting at clock `hour` (fixed in time, #1279). */
export function worstFortune(seed: number, day: number, hour: number, hours: number): number {
  let u = 1;
  for (let i = 0; i < Math.max(1, Math.ceil(hours)); i++) u = Math.min(u, fortuneAt(seed, day, Math.floor(hour) + i));
  return u;
}

/** How dangerous a piece of work was, by its risk. */
export type Band = 'low' | 'medium' | 'high';
export const bandOf = (risk: number): Band => (risk <= 0.05 ? 'low' : risk <= 0.15 ? 'medium' : 'high');

/** What an accident does. Damaged tools and sprains come with #1286. */
export type AccidentKind = 'bruise' | 'cut' | 'lost-haul';
export interface Accident { kind: AccidentKind; band: Band; condition: number }

/** Condition each costs. */
export const ACCIDENT_CONDITION: Readonly<Record<AccidentKind, number>> = { bruise: 2, cut: 5, 'lost-haul': 0 };

/**
 * Roll a piece of work's accident. `u` is the worst hour's fortune over the `hours` it spans, so it
 * is held against the risk *per hour*: over n hours that comes to about the whole risk, as each
 * hour gets its chance. None if `u` is at or above it. Otherwise the work's band (by its whole
 * risk) decides what can happen, and how deep the miss was picks among them: a shallow miss the
 * lighter one. A craft has no haul to lose: its worse outcome is a cut.
 */
export function rollAccident(u: number, risk: number, hours: number, craft = false): Accident | null {
  const perHour = risk / Math.max(1, Math.ceil(hours));
  if (perHour <= 0 || u >= perHour) return null;
  const band = bandOf(risk);
  const depth = (perHour - u) / perHour;
  const kind: AccidentKind = band === 'low' ? 'bruise' : craft || depth >= 0.5 ? 'cut' : 'lost-haul';
  return { kind, band, condition: ACCIDENT_CONDITION[kind] };
}

/** What the journal says. */
export function accidentLine(a: Accident, weather: WeatherId, dark: boolean, craft: boolean): string {
  if (craft) return a.kind === 'bruise' ? 'The tool slips and nicks your hand.' : 'The tool slips — a bad cut across your hand.';
  const where = weather === 'rain' || weather === 'storm' || weather === 'snow' ? 'on wet stone' : dark ? 'in the dark' : 'on loose ground';
  if (a.kind === 'bruise') return `You stumble ${where} — a bruise, nothing worse.`;
  if (a.kind === 'cut') return `You slip ${where} — a bad cut.`;
  return `You go down hard ${where} on the way back, and lose the haul in a stream.`;
}
