/**
 * Winter — the season clock and how a Region 1 run ends (#1206, #1302).
 * Part of the artificer sim core: pure, deterministic, no Phaser.
 * See docs/region-1-design.md §3–§5 and §7.
 *
 * Surviving the winter is the goal (epic #1310). Autumn is for preparing; the
 * snow falls on day 31 and the days go on under winter rules; the run ends at
 * the thaw (day 61), graded by how the Warden came through — or earlier, if
 * the body gives out. There are no exits: the caravan comes in spring (#1307).
 */

import type { Vitals } from './vitality';

export interface Calendar {
  /** The snow arrives: winter begins. */
  winterDay: number;
  /** The thaw: winter is over, and so is Region 1 (#1301). */
  thawDay: number;
}

/** The 60-day year (#1301, epic #1310): autumn on days 1–30, snow on day 31, the thaw on day 61. */
export const DEFAULT_CALENDAR: Calendar = { winterDay: 31, thawDay: 61 };

// ── Seasons (#1301) ─────────────────────────────────────────────────────────

export type Season = 'autumn' | 'winter' | 'thaw';

/** Which season a day falls in. */
export function seasonOf(day: number, cal: Calendar = DEFAULT_CALENDAR): Season {
  if (day < cal.winterDay) return 'autumn';
  return day < cal.thawDay ? 'winter' : 'thaw';
}

/** Midwinter — the shortest, coldest days — comes this many days after the first snow. */
export const MIDWINTER_AFTER = 14;

/**
 * A value that follows the year: given its level on day 1, the last day of
 * autumn, midwinter and the last day of winter, it runs in straight lines
 * between them (and carries on the last slope past the thaw). Daylight and
 * temperature are both shaped this way, so they stretch with the calendar.
 */
export function seasonCurve(day: number, cal: Calendar, levels: readonly [number, number, number, number]): number {
  const days = [1, cal.winterDay - 1, cal.winterDay + MIDWINTER_AFTER, cal.thawDay - 1];
  let seg = 0;
  while (seg < days.length - 2 && day > days[seg + 1]) seg++;
  const [d0, d1] = [days[seg], days[seg + 1]];
  return levels[seg] + (levels[seg + 1] - levels[seg]) * (day - d0) / (d1 - d0);
}

/**
 * The old autumn exits (#1206). Region 1 no longer offers them (#1302); the
 * names stay for run records from before, and for the caravan road until it
 * starts from the thaw (#1307).
 */
export type Choice = 'caravan' | 'solo' | 'winter';

/** How a Warden came through the winter (#1302). */
export type Grade = 'hale' | 'worn' | 'broken';

/**
 * How a run ended. `survived` is the goal (graded); `died` and `collapsed`
 * are the body giving out. The rest are the old exits' outcomes, kept so old
 * run records still load.
 */
export type OutcomeKind = 'survived' | 'thrive' | 'ragged' | 'crossed' | 'turnedBack' | 'wintered' | 'grim' | 'collapsed' | 'died';
/** What ended it: the thaw, a collapse when Condition gave out (#1234), or an old exit. */
export type EndChoice = 'thaw' | 'collapse' | Choice;
export type Injury = 'frostbite';

export interface Outcome {
  choice: EndChoice;
  kind: OutcomeKind;
  /** How well the Warden came through, for `survived`. */
  grade?: Grade;
  /** The Warden as they come out the other side (persists in the save). */
  vitals: Vitals;
  /** A permanent injury picked up on the way, if any. */
  injury?: Injury;
}

/** Condition at the thaw for each grade. */
export const GRADE_AT = { hale: 70, worn: 40 };

/** The grade at the thaw: hale at Condition 70+ with no lasting injury, worn at 40–69, broken below 40 or with a lasting injury. */
export function gradeOf(condition: number, injured = false): Grade {
  if (injured || condition < GRADE_AT.worn) return 'broken';
  return condition >= GRADE_AT.hale ? 'hale' : 'worn';
}
