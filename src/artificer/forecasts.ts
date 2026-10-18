/**
 * Forecasts from INT and experience (#1827, rules feature `forecasts`).
 *
 * What a task or a craft will bring isn't printed on it from the first morning any more: the Warden
 * learns it by doing. This module is the sim's half, pure and with no randomness of its own:
 *
 * - **Familiarity**: how many times each task was done at each distance (`wood@2`), and each recipe
 *   tried (`craft:stone-knife`, failures too). The sim counts it as actions run (region1.ts), with
 *   no dice: counting must never move a seeded stream, so a run plays the same with the switch on.
 * - **The threshold N**: how many times before the numbers show. Quicker with more INT.
 * - **Misjudging**: a rough word or verdict can be one step off. The chance falls with INT and
 *   practice and grows with the days ahead. It's drawn from a generator of its own, seeded by a
 *   string (the run, the day, the queue, what's being judged), never from the sim's streams, so a
 *   forecast doesn't flicker as the page redraws and a replay reads the same.
 *
 * The words themselves are the app's (artificer-app/forecast-words.ts).
 */

import { featureOn, type FeatureSwitches } from './features';
import { generator, seedOf } from './rng';

export const FORECASTS = 'forecasts';

/** The little of a run the forecasts read: its switches, who it is, the day, INT, and the counts. */
export interface Knower {
  day: number;
  config: { world: { features?: FeatureSwitches } };
  character: { id: string; stats: { int: number } };
  familiar?: Readonly<Record<string, number>>;
}

/** Whether a run plays with forecasts: as it saved its switches (absent: off). */
export const forecastsOn = (s: Pick<Knower, 'config'>): boolean => featureOn(s.config.world.features, FORECASTS);

/** A task's familiarity key: the action and its distance, learned separately (wood close by ≠ half a day out). */
export const taskKey = (id: string, ring: number): string => `${id}@${ring}`;
/** A recipe's familiarity key: every try counts, failures too. */
export const craftKey = (recipeId: string): string => `craft:${recipeId}`;

/** How many times it's been done (or tried). */
export const familiarity = (s: Pick<Knower, 'familiar'>, key: string): number => s.familiar?.[key] ?? 0;

/**
 * Count one more (on an already-cloned state). A fresh object each time, so a state that shared the
 * old map (a preview, the hidden-talent comparison) never sees it change.
 */
export function noteFamiliar(next: { familiar?: Record<string, number> }, key: string): void {
  next.familiar = { ...(next.familiar ?? {}), [key]: (next.familiar?.[key] ?? 0) + 1 };
}

/** N, the times done before the numbers show: INT ≤ 8 four, 9–12 three, 13+ two. */
export const knowThreshold = (int: number): number => (int <= 8 ? 4 : int <= 12 ? 3 : 2);

/** How well the Warden knows something: never done, a rough idea, or the numbers. */
export type Knowing = 'unknown' | 'rough' | 'exact';

export function knowing(s: Knower, key: string): Knowing {
  const n = familiarity(s, key);
  return n === 0 ? 'unknown' : n < knowThreshold(s.character.stats.int) ? 'rough' : 'exact';
}

/** INT high enough to see a whole day coming (#1827): 9 or more. */
export const DAY_FORECAST_INT = 9;
/** Seeing past today: INT 13+ with a week played, or three weeks played at any INT. */
export const FAR_INT = 13, FAR_DAYS_SHARP = 7, FAR_DAYS_ANY = 21;

/** Days played: the first morning is day 1, with none behind it. */
export const daysPlayed = (s: Pick<Knower, 'day'>): number => Math.max(0, s.day - 1);

export const dayForecastOpen = (s: Knower): boolean => s.character.stats.int >= DAY_FORECAST_INT;

export function farForecastOpen(s: Knower): boolean {
  const played = daysPlayed(s);
  return (s.character.stats.int >= FAR_INT && played >= FAR_DAYS_SHARP) || played >= FAR_DAYS_ANY;
}

/**
 * The chance a rough word or verdict is a step off. A sharp mind misjudges less (about 0.31 at INT 8,
 * 0.13 at INT 14), practice halves it by N tries and keeps shrinking it after, and each day further
 * ahead adds half again. Capped, so even a far guess is right more often than not.
 */
export function misjudgeChance(int: number, fam: number, n: number, daysAhead = 0): number {
  const sharp = Math.min(0.4, Math.max(0.02, 0.55 - 0.03 * int));
  const practice = Math.max(0.1, 1 - fam / (2 * Math.max(1, n)));
  return Math.min(0.6, sharp * practice * (1 + 0.5 * Math.max(0, daysAhead)));
}

/**
 * A level on a scale of `levels` words (0 the least), as the Warden judges it: right, or with
 * `chance` one step off (up or down; at an end, the only way there is). Never more than one step.
 */
export function judged(level: number, levels: number, chance: number, rand: () => number): number {
  if (levels < 2 || rand() >= chance) return level;
  const up = rand() < 0.5;
  const step = level + (up ? 1 : -1);
  return step < 0 || step >= levels ? level + (up ? -1 : 1) : step;
}

/**
 * The generator for one of the queue's verdicts (the day and the days after): seeded by the run, the
 * day, the queue's contents and what is being judged (`slot`), a stream of its own (rng.ts
 * `generator`), since those verdicts describe the queue as a whole. Nothing the sim draws is touched.
 */
export const forecastRand = (s: Pick<Knower, 'day' | 'character'>, queueKey: string, slot: string): (() => number) =>
  generator(seedOf(`${s.character.id}|forecast|${s.day}|${queueKey}|${slot}`));

/**
 * The generator for a card's rough words (a task at its distance, `taskKey`; a recipe, `craftKey`):
 * seeded by the run, the day and the card only, never the queue. A card's word stays fixed for the
 * day: the same task at the same distance reads the same on its card, in the chooser and on its
 * queue row, however the queue is edited (owner's decision, #1827).
 */
export const cardRand = (s: Pick<Knower, 'day' | 'character'>, key: string): (() => number) =>
  generator(seedOf(`${s.character.id}|forecast|${s.day}|card|${key}`));

/** A queue's contents as a seed string: the same queue, the same forecast. */
export const queueKeyOf = (queue: readonly unknown[]): string => JSON.stringify(queue);

/** How much a trip brings, as one of three rough words: a little (under 3), some (3–6), plenty (7+). */
export const roughAmount = (n: number): number => (n < 3 ? 0 : n < 7 ? 1 : 2);
/** An input's amount, roughly: a little (1), some (2–3), a lot (4+). */
export const roughQty = (q: number): number => (q <= 1 ? 0 : q <= 3 ? 1 : 2);

/** A craft's odds as a band of its quality score: beyond you (it fails), either way (near the line), likely. */
export type CraftBand = 'beyond' | 'either' | 'likely';
export const CRAFT_BANDS: readonly CraftBand[] = ['beyond', 'either', 'likely'];
export const craftBand = (score: number): CraftBand => (score <= 0 ? 'beyond' : score < 2 ? 'either' : 'likely');

/** A grade as a rough word: rough (crude), decent (sound), good work (fine, masterwork). */
export const roughGrade = (grade: string): number => (grade === 'crude' ? 0 : grade === 'sound' ? 1 : 2);
