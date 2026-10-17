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
 * - **at the work, done all at once** (water, a hunt's kill): nothing until the work is done, all of it after;
 * - **at the work, a bit at a time** (wood, forage, stone, fish): a share in proportion to the work done, rounded down;
 * - **exploring** (scout, survey, track, look out, explore): what you'd seen by then, in proportion;
 * - **walking back**: you have it all already; the walk simply finishes;
 * - **at camp** (a craft, a build, rest, study…): the hours are spent, nothing is made, nothing used up.
 * Vigor, Clarity and hours are spent as far as you got. No new random draws: the cut action keeps
 * its own seeded roll (the same hour, the same luck) and scales what it brings by the part done.
 *
 * Pure: the rules for where a stop lands. region1.ts applies them.
 */

import { featureOn } from './features';

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
 * until it's done, `see` what was seen in proportion, `camp` nothing done at all.
 */
export type StopKind = 'bit' | 'all' | 'see' | 'camp';

/** Each land action's kind; everything else is work at camp. */
const KIND: Readonly<Record<string, StopKind>> = {
  gather: 'bit', wood: 'bit', quarry: 'bit', fish: 'bit',
  water: 'all', hunt: 'all',
  scout: 'see', survey: 'see', track: 'see', lookout: 'see', explore: 'see',
};

export const stopKindOf = (id: string): StopKind => KIND[id] ?? 'camp';

/** The action ids of each kind of land work, for the rules text (observe.ts). */
export const STOP_KINDS: Readonly<Record<Exclude<StopKind, 'camp'>, readonly string[]>> = {
  bit: Object.keys(KIND).filter(k => KIND[k] === 'bit'),
  all: Object.keys(KIND).filter(k => KIND[k] === 'all'),
  see: Object.keys(KIND).filter(k => KIND[k] === 'see'),
};

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
 */
export function cutTrips(trips: readonly { travel: number; work: number }[], hours: number, kind: StopKind): Cut | null {
  let h = Math.max(0, hours);
  let work = 0, travel = 0, kept = 0;
  for (let i = 0; i < trips.length; i++) {
    const t = trips[i];
    const out = t.travel / 2;
    if (h < out) return { work, travel: travel + 2 * h, kept, trips: i + 1, phase: 'out' };
    if (h < out + t.work) {
      const done = h - out;
      return { work: work + done, travel: travel + t.travel, kept: kept + (kind === 'all' ? 0 : done), trips: i + 1, phase: 'work' };
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
