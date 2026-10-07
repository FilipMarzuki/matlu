/**
 * The scout start (#1397): the Warden is an 11–14-year-old Swedish scout, out on a weekend hike
 * with the patrol when the weekend turns into something else. This part (#1398) is the training a
 * scout brings: first aid, camp chores, map and compass.
 *
 * Pure: createRegion1 applies the training when the character has the scout background.
 */

import type { SkillPractice } from './skills';

/** Who the character was before the Reach. Only scouts so far; absent means no background (tests, old saves). */
export type Background = 'scout';
export const BACKGROUNDS: readonly Background[] = ['scout'];

/**
 * A scout's training, in practice hours: First aid at Apprentice (20h — the badge course and a
 * few scraped knees), Fieldcraft and Scouting at Novice (5h — camps, map and compass).
 */
export const SCOUT_TRAINING: Readonly<SkillPractice> = { firstaid: 20, fieldcraft: 5, scouting: 5 };

/** The practice a background brings. */
export const trainingOf = (background: Background | undefined): SkillPractice =>
  background === 'scout' ? { ...SCOUT_TRAINING } : {};
