/**
 * Character stats (#1256, epic #1255): six base stats in the Drakar och
 * Demoner style, under the skills. Skills say what you've practised; stats say
 * what you're built for.
 *
 * Scores run 3–18 (10 is average) and are chosen by point-buy at creation.
 * Every effect works off d = score − 10, a few percent per point.
 *
 * Like traits, stats act only on drains, recovery, costs and bonuses — never
 * on Vigor/Clarity caps, which drift back to the baseline each night and which
 * winter readiness checks (see the note in traits.ts).
 *
 * Unlike skills (#1241), stats are shown exactly: you know your own body and
 * mind. Pure: Region 1 and the road read `statEffects` and `statDrain`.
 */

import type { ActionId } from './region1';
import type { SkillId } from './skills';

export type StatId = 'str' | 'con' | 'agi' | 'int' | 'wil' | 'cha';
export type Stats = Record<StatId, number>;

export const STATS: Readonly<Record<StatId, { name: string; short: string; blurb: string }>> = {
  str: { name: 'Strength', short: 'STR', blurb: 'heavy work — wood, stone, building — tires the body less' },
  con: { name: 'Constitution', short: 'CON', blurb: 'hunger and thirst cost less Condition; you heal faster' },
  agi: { name: 'Agility', short: 'AGI', blurb: 'hunting, tracking, scouting, handcraft and walking cost less' },
  int: { name: 'Intelligence', short: 'INT', blurb: 'more insight from study; finer crafts' },
  wil: { name: 'Willpower', short: 'WIL', blurb: 'work wears the mind less; focus holds at lower Clarity' },
  cha: { name: 'Charisma', short: 'CHA', blurb: 'people trust you sooner and deal fairer (on the caravan road)' },
};
export const STAT_IDS = Object.keys(STATS) as StatId[];

/** Average in everything — old saves, quick starts, and the AI's default. */
export const DEFAULT_STATS: Readonly<Stats> = { str: 10, con: 10, agi: 10, int: 10, wil: 10, cha: 10 };

/** Point-buy (#1256): 6 points; raising costs 1 per step to 13 and 2 per step for 14–15; lowering (to 7) refunds 1 per step. */
export const POINT_BUDGET = 6;
export const CREATION_MIN = 7;
export const CREATION_MAX = 15;
/** The highest score where a step still costs 1 point. */
const CHEAP_UP_TO = 13;

/** Points a score costs at creation (negative: a refund for lowering). */
export function scoreCost(score: number): number {
  if (score <= 10) return score - 10;
  const cheap = Math.min(score, CHEAP_UP_TO) - 10;
  return cheap + 2 * Math.max(0, score - CHEAP_UP_TO);
}

/** Total points a spread costs. */
export const pointCost = (s: Stats): number => STAT_IDS.reduce((n, id) => n + scoreCost(s[id]), 0);

/** A legal creation spread: all six stats, whole numbers within 7–15, at most {@link POINT_BUDGET} points. */
export function validStats(x: unknown): x is Stats {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  const scoresOk = STAT_IDS.every(id => Number.isInteger(s[id]) && (s[id] as number) >= CREATION_MIN && (s[id] as number) <= CREATION_MAX);
  return scoresOk && pointCost(s as Stats) <= POINT_BUDGET;
}

/** Points left to spend on a spread. */
export const pointsLeft = (s: Stats): number => POINT_BUDGET - pointCost(s);

// ── Effects ─────────────────────────────────────────────────────────────────

/** Work that leans on Strength. */
export const HEAVY_ACTIONS: readonly ActionId[] = ['wood', 'quarry', 'build'];
/** Work that leans on Agility (plus any handcraft craft). */
export const AGILE_ACTIONS: readonly ActionId[] = ['hunt', 'track', 'scout', 'survey', 'lookout'];

/** What a spread does, as multipliers (1 = no change) and additions. */
export interface StatEffects {
  /** STR: Vigor drain on heavy work. */
  heavyVigor: number;
  /** AGI: drain (Vigor and Clarity) on nimble work. */
  agileDrain: number;
  /** AGI: drain of walking out to the rings. */
  travel: number;
  /** CON: Condition lost to hunger and thirst. */
  deprivationCondition: number;
  /** CON: Condition healed overnight. */
  heal: number;
  /** INT: insight from study. */
  insight: number;
  /** INT: added to the craft-grade score (+1 at 13, −1 at 7). */
  craftGrade: number;
  /** WIL: Clarity drain on all work. */
  clarityDrain: number;
  /** WIL: Clarity lost to hunger and thirst. */
  deprivationClarity: number;
  /** WIL: Clarity below which focus turns unreliable (30 at WIL 10). */
  unreliableBelow: number;
  /** CHA: added to people's starting trust on the road (#1246). */
  trust: number;
  /** CHA: multiplies what you pay (and divides what you're paid) on the road (#1247). */
  priceFactor: number;
}

export function statEffects(s: Stats): StatEffects {
  const d = (id: StatId): number => s[id] - 10;
  return {
    heavyVigor: 1 - 0.03 * d('str'),
    agileDrain: 1 - 0.03 * d('agi'),
    travel: 1 - 0.03 * d('agi'),
    deprivationCondition: 1 - 0.03 * d('con'),
    heal: 1 + 0.03 * d('con'),
    insight: 1 + 0.05 * d('int'),
    // Truncate toward zero, so only a real lean (±3) moves the grade (+ 0 turns −0 into 0).
    craftGrade: Math.trunc(d('int') / 3) + 0,
    clarityDrain: 1 - 0.02 * d('wil'),
    deprivationClarity: 1 - 0.03 * d('wil'),
    unreliableBelow: 30 - 2 * d('wil'),
    trust: d('cha'),
    priceFactor: 1 - 0.02 * d('cha'),
  };
}

/** Drain multipliers from stats for one piece of work (`skill`: the skill it trains, for handcraft crafts). */
export function statDrain(s: Stats, action: ActionId, skill: SkillId | null): { vigor: number; clarity: number } {
  const e = statEffects(s);
  const agile = AGILE_ACTIONS.includes(action) || skill === 'handcraft' ? e.agileDrain : 1;
  return {
    vigor: (HEAVY_ACTIONS.includes(action) ? e.heavyVigor : 1) * agile,
    clarity: e.clarityDrain * agile,
  };
}
