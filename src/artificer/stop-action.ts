/**
 * Stop an action while it plays out (#1815, the `stop-action` rules switch).
 *
 * The day still resolves at once (playback.ts only shows it slowly), so a stop is a move of its
 * own: "the queue's action N, stopped H hours in". The sim then plays that day again from the
 * morning with action N cut short (region1.ts `runDay`'s `stop`), and the day pauses after it: no
 * night, the rest of the queue still queued. Same seed, same moves, same run.
 *
 * What a cut-short action keeps depends on where it was stopped (the owner's rules):
 * - **walking out**: you turn back. Nothing gathered, and the walk back takes as long as you'd walked;
 * - **at the work, done all at once** (water): nothing until the work is done, all of it after;
 * - **at the work, a game of chance** (a hunt): each hunt has its moment of the kill, somewhere in
 *   its work hours (`killMoment`: sometimes straight away, sometimes at the very end). Stopped
 *   after it you have the whole catch (the food, and a deer's hide); before it, nothing. Whether
 *   there is a kill at all is the hunt's luck, as ever: an empty hunt has none, whenever you stop.
 *   A hunt not stopped takes its planned hours; with `hunting-gear` (#1821) it ends on its kill, hunting-gear.ts;
 * - **at the work, a bit at a time** (wood, forage, quarried or gathered stone, fish): a share in proportion to the work done, rounded down;
 * - **exploring** (scout, survey, track, look out, explore): what you'd seen by then, in proportion;
 * - **walking back**: you have it all already; the walk simply finishes;
 * - **at camp** (a craft, a build, rest, study…): the hours are spent, nothing is made, nothing used up.
 * Vigor, Clarity and hours are spent as far as you got. No new draws on the sim's dice: the cut
 * action keeps its own seeded roll (the same hour, the same luck) and scales what it brings by the
 * part done; a hunt's moment of the kill comes from a string-keyed stream of its own, read only
 * when a hunt is stopped, so a run with no stop is byte for byte the run it was.
 *
 * Pure: the rules for where a stop lands. region1.ts applies them.
 */

import { featureOn } from './features';
import { streamFor } from './rng';

/** The switch's id (features.ts). */
export const STOP_ACTION = 'stop-action';

/** Whether a run has the switch on: as it saved it, off for a run from before it. */
export const stopOn = (s: { config: { world: { features?: Readonly<Record<string, boolean>> } } }): boolean => featureOn(s.config.world.features, STOP_ACTION);

/** A stop in a day's plan: the plan's action `action` (0-based), cut `hours` into it. */
export interface DayStop {
  action: number;
  /** Hours into the action, by its plan: walks, work and trips as the queue planned them. */
  hours: number;
}

/**
 * How an action's work counts when it's cut short: `bit` a share in proportion, `all` nothing
 * until it's done, `kill` nothing before its moment of the kill and all of it after, `see` what
 * was seen in proportion, `camp` nothing done at all.
 */
export type StopKind = 'bit' | 'all' | 'kill' | 'see' | 'camp';

/** Each land action's kind; everything else is work at camp. */
const KIND: Readonly<Record<string, StopKind>> = {
  gather: 'bit', wood: 'bit', quarry: 'bit', gatherstone: 'bit', fish: 'bit',
  water: 'all', hunt: 'kill',
  // Traps (#1821, `hunting-gear`): a line not finished isn't set.
  traps: 'all',
  scout: 'see', survey: 'see', track: 'see', lookout: 'see', explore: 'see',
};

export const stopKindOf = (id: string): StopKind => KIND[id] ?? 'camp';

/** The action ids of each kind of land work, for the rules text (observe.ts). */
export const STOP_KINDS: Readonly<Record<Exclude<StopKind, 'camp'>, readonly string[]>> = {
  bit: Object.keys(KIND).filter(k => KIND[k] === 'bit'),
  all: Object.keys(KIND).filter(k => KIND[k] === 'all'),
  kill: Object.keys(KIND).filter(k => KIND[k] === 'kill'),
  see: Object.keys(KIND).filter(k => KIND[k] === 'see'),
};

/**
 * When a hunt's kill comes (#1815): a share of its work hours, in (0, 1]. A pure function of the
 * run's seed, the day and `key` (the hour of the day the hunt began, by `hoursToday`, which is the
 * same whenever that day is played again), from a stream of its own: it draws nothing from the
 * sim's dice, so a run with no stop is the run it always was. Uniform, so a quarter of hunts have
 * their kill in the first quarter of the work, and now and then it comes straight away.
 */
export const killMoment = (seed: number, day: number, key: number): number => 1 - streamFor(seed, day, `hunt-kill@${key}`)();

/** Where a stop cut an action: what it spent, and the work that still counts. */
export interface Cut {
  /** Hours of work done (spent). */
  work: number;
  /** Hours walking, out and back. */
  travel: number;
  /** Hours of work whose yield is kept. */
  kept: number;
  /** Trips begun. */
  trips: number;
  /** The leg it was stopped in. */
  phase: 'out' | 'work' | 'back';
}

/**
 * A stop `hours` into an action planned as `trips` (one for a usual action; a session of chosen
 * length has several, #1668), each a walk out of half its travel, its work, and the walk back.
 * Null when the stop changes nothing: it lands on the last walk home, or after the end.
 * `killAt` is a `kill` action's moment of the kill, as a share of each trip's work (`killMoment`).
 */
export function cutTrips(trips: readonly { travel: number; work: number }[], hours: number, kind: StopKind, killAt = 1): Cut | null {
  let h = Math.max(0, hours);
  let work = 0, travel = 0, kept = 0;
  for (let i = 0; i < trips.length; i++) {
    const t = trips[i];
    const out = t.travel / 2;
    if (h < out) return { work, travel: travel + 2 * h, kept, trips: i + 1, phase: 'out' };
    if (h < out + t.work) {
      const done = h - out;
      // All at once: nothing yet. A kill: nothing before its moment, the whole of the work's yield after it.
      const k = kind === 'all' ? 0 : kind === 'kill' ? (done >= killAt * t.work - 1e-9 ? t.work : 0) : done;
      return { work: work + done, travel: travel + t.travel, kept: kept + k, trips: i + 1, phase: 'work' };
    }
    // On the last walk home there's nothing to cut; on an earlier one the trip is done, and home is where the stop leaves you.
    if (i === trips.length - 1) return null;
    if (h < t.travel + t.work) return { work: work + t.work, travel: travel + t.travel, kept: kept + t.work, trips: i + 1, phase: 'back' };
    work += t.work; travel += t.travel; kept += t.work;
    h -= t.travel + t.work;
  }
  return null;
}

/** Why a stop isn't one for a plan of `planLength` actions, or null. */
export function stopProblem(x: unknown, planLength: number): string | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'stop is { "action": <index in the plan, from 0>, "hours": <hours into it> }.';
  const { action, hours } = x as Record<string, unknown>;
  if (typeof action !== 'number' || !Number.isInteger(action) || action < 0 || action >= planLength) return `stop.action is the index of an action in the plan, 0 to ${planLength - 1}.`;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 24) return 'stop.hours is the hours into that action, 0 or more.';
  return null;
}

/** Why a run can't take this stop: the switch off, or a stop that isn't one. Null when it can. */
export function stopRefusal(s: Parameters<typeof stopOn>[0], x: unknown, planLength: number): string | null {
  if (!stopOn(s)) return 'Stopping an action partway is off in this game (the stop-action feature).';
  return stopProblem(x, planLength);
}
