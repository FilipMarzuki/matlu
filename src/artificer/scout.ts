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

/**
 * Knows the cold (#1399): a scout's winters — winter camps, snow caves, the patrol's ski tours.
 * A cold night costs this much of what it would (it stacks with Cold-blooded), and blizzard
 * exposure is one step safer. It doesn't stand in for winter gear.
 */
export const COLD_WISE = 0.75;
export const knowsTheCold = (c: { background?: Background }): boolean => c.background === 'scout';
export const coldWise = (c: { background?: Background }): number => (knowsTheCold(c) ? COLD_WISE : 1);

/**
 * Scout's nerve (#1399): night hikes and dark woods are nothing new — +1 nerve. It offsets a
 * young Warden's lower Willpower (−2 at 12 drops a nerve step), so a child is no jumpier than an
 * adult out there; a grown scout is a little steadier than most.
 */
export const SCOUT_NERVE = 1;
export const scoutNerve = (c: { background?: Background }): number => (c.background === 'scout' ? SCOUT_NERVE : 0);
