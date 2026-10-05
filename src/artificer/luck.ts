/**
 * Trip luck (#1314, epic #1310): a gathering trip — foraging, hunting, wood,
 * water, stone — succeeds or fails on seeded luck, and the weather, the land's
 * supply, skill, technique and the light set the odds.
 *
 * Luck is a fortune value fixed for the trip's starting hour (seed, day, hour),
 * on its own stream apart from accidents: change the plan and your luck for
 * that hour stays what it was; runs replay exactly.
 *
 * The fortune `u` (0..1) is read against fixed cuts — 5% empty, 20% poor, 55%
 * ordinary, 20% good — after the odds shift it: each step better adds 0.1 to
 * `u` (ten points from the bad end to the good), each step worse takes 0.1 off.
 *
 * Pure: Region 1 asks for a band and multiplies the haul by it.
 */

import { streamFor } from './rng';
import { supplyWord, type Domain } from './exploration';
import type { WeatherId } from './world';
import type { ActionId } from './region1';

export type Band = 'empty' | 'poor' | 'ordinary' | 'good';
export const BANDS: readonly Band[] = ['empty', 'poor', 'ordinary', 'good'];

/** What a band does to the haul. */
export const BAND_MULT: Readonly<Record<Band, number>> = { empty: 0, poor: 0.5, ordinary: 1, good: 1.5 };

/** Where the bands start, on the shifted fortune: 5% empty, 20% poor, 55% ordinary, 20% good. */
const CUTS = [0.05, 0.25, 0.8] as const;
/** How far one step moves the fortune. */
export const STEP = 0.1;

/** The band a fortune lands in, after `steps` of odds (positive = better). */
export function bandFor(u: number, steps: number): Band {
  const x = Math.min(0.9999, Math.max(0, u + STEP * steps));
  return x < CUTS[0] ? 'empty' : x < CUTS[1] ? 'poor' : x < CUTS[2] ? 'ordinary' : 'good';
}

/** The chance of each band at `steps` (for the odds shown to players and the AI, and for tests). */
export function bandOdds(steps: number): Record<Band, number> {
  const at = (cut: number): number => Math.min(1, Math.max(0, cut - STEP * steps));
  const [a, b, c] = CUTS.map(at);
  return { empty: a, poor: b - a, ordinary: c - b, good: 1 - c };
}

/** The fortune for a trip starting at `hour` on `day`: fixed, and on its own stream apart from accidents. */
export const haulFortune = (seed: number, day: number, hour: number): number => streamFor(seed, day, `haul@${hour}`)();

/** The land a gathering action works. */
export const ACTION_DOMAIN: Readonly<Partial<Record<ActionId, Domain>>> = { gather: 'forage', hunt: 'game', water: 'water', wood: 'timber', quarry: 'stone' };

/** How the weather moves the odds, per domain, with what the journal says about it. */
export const WEATHER_STEPS: Readonly<Partial<Record<WeatherId, Partial<Record<Domain, [number, string]>>>>> = {
  rain: { forage: [-1, 'the rain had beaten down the forage'], game: [-1, 'the rain had driven the game to cover'] },
  fog: { forage: [-1, 'you could hardly see what grew in the fog'], game: [-1, 'the game was lost in the fog'] },
  wind: { game: [-1, 'the wind carried your scent ahead of you'], timber: [1, 'the wind had brought down dead wood'] },
  storm: {
    forage: [-2, 'the storm had stripped the bushes'], game: [-2, 'the storm had every animal holed up'],
    timber: [1, 'the storm had brought down dead wood'], water: [-1, 'the storm had churned the streams to mud'],
    stone: [-1, 'the storm made the rock treacherous'],
  },
  snow: { forage: [-2, 'snow had buried the forage'], game: [1, 'fresh snow showed every track'], stone: [-1, 'the ground was frozen hard'] },
};

/** What shifts a trip's odds. */
export interface LuckInput {
  domain: Domain;
  weather: WeatherId;
  /** The land's supply there (#1304), 0..1. */
  supply: number;
  /** The Warden's true skill level in the work (#1236). */
  skillLevel: number;
  /** A known technique applies to this work (#1243). */
  technique: boolean;
  /** The light the work has (#1280), 0..1. */
  light: number;
}

/** One reason the odds moved. */
export interface Shift { steps: number; why: string }

/** Skill levels that improve the odds: Adept (3) one step, Skilled (5) two. */
export const SKILL_STEPS_AT = { one: 3, two: 5 };

/**
 * Every shift on a trip's odds, with its reason. Supply only takes away —
 * full land is the ordinary case, and a picked-over ring is worse.
 */
export function luckShifts(i: LuckInput): Shift[] {
  const out: Shift[] = [];
  const w = WEATHER_STEPS[i.weather]?.[i.domain];
  if (w) out.push({ steps: w[0], why: w[1] });
  const word = supplyWord(i.supply);
  if (word === 'scarce') out.push({ steps: -1, why: 'the ground there is picked over' });
  if (word === 'bare') out.push({ steps: -2, why: 'there was almost nothing left there' });
  if (i.skillLevel >= SKILL_STEPS_AT.two) out.push({ steps: 2, why: 'you knew just where to look' });
  else if (i.skillLevel >= SKILL_STEPS_AT.one) out.push({ steps: 1, why: 'you knew where to look' });
  if (i.technique) out.push({ steps: 1, why: "what you've learned paid off" });
  if (i.light < 0.5) out.push({ steps: -1, why: 'the light was going' });
  return out;
}

/** The net steps on a trip's odds. */
export const luckSteps = (i: LuckInput): number => luckShifts(i).reduce((n, s) => n + s.steps, 0);

/** The odds in a word, for the player and the AI. */
export const oddsWord = (steps: number): 'good' | 'fair' | 'poor' | 'bad' => (steps >= 1 ? 'good' : steps === 0 ? 'fair' : steps === -1 ? 'poor' : 'bad');

/**
 * The journal line for a band, naming the reason that did most to land it
 * there (the worst for a bad trip, the best for a good one). Ordinary trips
 * say nothing.
 */
export function bandLine(band: Band, shifts: readonly Shift[]): string | null {
  if (band === 'ordinary') return null;
  const good = band === 'good';
  const pick = [...shifts].filter(s => (good ? s.steps > 0 : s.steps < 0)).sort((a, b) => (good ? b.steps - a.steps : a.steps - b.steps))[0];
  if (band === 'good') return pick ? `A good haul: ${pick.why}.` : 'A good haul — luck was with you.';
  if (band === 'poor') return pick ? `A poor trip — ${pick.why}.` : 'A poor trip — it just wasn\'t there today.';
  return pick ? `Came back with nothing — ${pick.why}.` : 'Came back with nothing. Some days are like that.';
}
