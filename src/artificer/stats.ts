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
 * winter readiness checks (caps drift back to the baseline each night).
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

// ── Creation helpers (#1258) ────────────────────────────────────────────────

/** Can this stat go up one step at creation (under the max, and affordable)? */
export const canRaise = (s: Stats, id: StatId): boolean =>
  s[id] < CREATION_MAX && scoreCost(s[id] + 1) - scoreCost(s[id]) <= pointsLeft(s);
/** Can this stat go down one step at creation (above the minimum)? */
export const canLower = (s: Stats, id: StatId): boolean => s[id] > CREATION_MIN;
/** Points the next step up would cost (1, or 2 above 13). */
export const raiseCost = (score: number): number => scoreCost(score + 1) - scoreCost(score);

/** A signed whole number: "+3", "−9" (a real minus sign), "±0". */
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/** What a score does, in a few words, for the creation screen and the WARDEN tab. */
export function statNote(id: StatId, score: number): string {
  const d = score - 10;
  const e = statEffects({ ...DEFAULT_STATS, [id]: score });
  if (d === 0) return 'average';
  switch (id) {
    case 'str': return `heavy work ${signed(-3 * d)}% Vigor`;
    case 'con': return `hunger & thirst ${signed(-3 * d)}% Condition · healing ${signed(3 * d)}%`;
    case 'agi': return `nimble work & walking ${signed(-3 * d)}% effort`;
    case 'int': return `study ${signed(5 * d)}% insight${e.craftGrade ? ` · craft grade ${signed(e.craftGrade)}` : ''}`;
    case 'wil': return `mind strain ${signed(-2 * d)}% · focus holds to ${e.unreliableBelow} Clarity`;
    case 'cha': return `trust ${signed(d)} · prices ${signed(-2 * d)}% (on the road)`;
  }
}

// ── Growth by use, and wear (#1257) ─────────────────────────────────────────
// Stats change slowly over a character's life: the work you do exercises its stat, hour for hour,
// and enough of it raises the stat a point; hardship wears Constitution down. What's been gained
// and lost is kept apart from the chosen (adult) stats and the age (#1399), so growing up never
// undoes training and training never moves the potential you chose.

/** The human peak and the floor: no stat rises past 18 or falls below 3. */
export const STAT_PEAK = 18, STAT_LOW = 3;

/** Exercise hours for the next point: 30 × (score − 8)², at least 30 — 10→11 takes 120h, 14→15 takes 1,080h. */
export const EXERCISE_TO_NEXT = (score: number): number => Math.max(30, 30 * (score - 8) ** 2);

/** Which work exercises which stat. A craft exercises INT, a handcraft AGI too; a build is heavy work (STR). */
const EXERCISED_BY: Readonly<Record<string, readonly StatId[]>> = {
  wood: ['str'], quarry: ['str'], build: ['str', 'int'],
  hunt: ['agi'], track: ['agi'], scout: ['agi'], survey: ['agi'], lookout: ['agi'],
  study: ['int'],
};
/** The stats a piece of work exercises, hour for hour. `craft`: a recipe (INT), `handcraft`: and a handcraft one (AGI). */
export function exerciseFor(action: string, craft: { recipe: boolean; handcraft: boolean } = { recipe: false, handcraft: false }): StatId[] {
  const out = new Set<StatId>(EXERCISED_BY[action] ?? []);
  if (craft.recipe) out.add('int');
  if (craft.handcraft) out.add('agi');
  return [...out];
}

/** WIL is exercised by work done with a tired mind (Clarity under this at the start) — or locked to survival. */
export const WIL_EXERCISE_BELOW = 40;
/** CON: each night survived hungry or thirsty counts this much, plus every hour worked beyond this in a day. */
export const HARD_NIGHT_EXERCISE = 4, LONG_DAY_HOURS = 10;
/** Wear: a night at this many nights hungry (or thirsty) adds 1; at WEAR_LIMIT, CON drops a point and wear resets. */
export const WEAR_HUNGRY = 3, WEAR_THIRSTY = 2, WEAR_LIMIT = 3;

/** What the character carries of it: points gained or lost by use and wear, exercise towards the next point, and wear. */
export interface Growth { trained?: Partial<Stats>; exercise?: Partial<Stats>; wear?: number }

/** The stats now: the chosen ones as grown at this age (#1399), plus what's been gained or lost (#1257), within 3–18. */
export function withTraining(grown: Readonly<Stats>, trained: Partial<Stats> | undefined): Stats {
  const out = { ...grown };
  for (const id of STAT_IDS) out[id] = Math.max(STAT_LOW, Math.min(STAT_PEAK, grown[id] + (trained?.[id] ?? 0)));
  return out;
}

/**
 * Exercise a stat (pure): add the hours, and while they reach the next point (and the stat is under
 * the peak), raise it. Returns the new stats and growth, and the scores reached (for the journal).
 */
export function exercise(stats: Readonly<Stats>, growth: Growth, id: StatId, hours: number): { stats: Stats; growth: Growth; reached: number[] } {
  if (hours <= 0) return { stats: { ...stats }, growth, reached: [] };
  const s = { ...stats };
  const trained = { ...(growth.trained ?? {}) };
  let ex = (growth.exercise?.[id] ?? 0) + hours;
  const reached: number[] = [];
  while (s[id] < STAT_PEAK && ex >= EXERCISE_TO_NEXT(s[id])) {
    ex -= EXERCISE_TO_NEXT(s[id]);
    s[id] += 1;
    trained[id] = (trained[id] ?? 0) + 1;
    reached.push(s[id]);
  }
  // At the peak, there's nothing more to work towards.
  if (s[id] >= STAT_PEAK) ex = 0;
  return { stats: s, growth: { ...growth, ...(reached.length ? { trained } : {}), exercise: { ...(growth.exercise ?? {}), [id]: Math.round(ex * 100) / 100 } }, reached };
}

/** Lose a point of a stat to hardship (pure), never below the floor. */
export function wearDown(stats: Readonly<Stats>, growth: Growth, id: StatId): { stats: Stats; growth: Growth; lost: boolean } {
  if (stats[id] <= STAT_LOW) return { stats: { ...stats }, growth, lost: false };
  return { stats: { ...stats, [id]: stats[id] - 1 }, growth: { ...growth, trained: { ...(growth.trained ?? {}), [id]: (growth.trained?.[id] ?? 0) - 1 } }, lost: true };
}

/** What the journal says when a stat rises — felt, not hidden. */
const GAIN_WORDS: Readonly<Record<StatId, string>> = {
  str: 'The heavy work has hardened your arms', agi: 'You move quicker and surer than you did', int: 'Using your head has sharpened it',
  wil: 'Pushing on when you were spent has steeled you', con: 'Hardship has toughened you', cha: 'Talking to people has come easier',
};
export const gainLine = (id: StatId, score: number): string => `${GAIN_WORDS[id]} — ${STATS[id].name} ${score}.`;
export const wearLine = (thirst: boolean, score: number): string => `${thirst ? 'Thirst' : 'Hunger'} has left its mark — Constitution ${score}.`;
