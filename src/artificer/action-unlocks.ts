/**
 * Learning your actions as you go (#1689, #1690, switch `action-visibility`).
 *
 * A new Warden has one exploring action, Explore. The others (scout a ring, survey it, climb and
 * look out, track game) are what getting better at it looks like: each opens at a true level in its
 * skill, or from day one for a Warden whose starting talent covers it. Until then the action is
 * hidden: it isn't offered, and the sim refuses it as something you don't know how to do yet.
 *
 * Pure, and independent of region1.ts at runtime (it only reads skills and talents), so region1
 * can ask it while it decides whether an action is allowed. The level and talents come from what
 * the run already keeps, so nothing new is saved and nothing draws on a random stream.
 */

import { skillLevel, SKILLS, type SkillId, type SkillPractice } from './skills';
import type { Talent, TalentId } from './talents';

/** The rule switch these actions sit behind (features.ts). */
export const ACTION_VISIBILITY = 'action-visibility';

/** An exploring sub-action, and what opens it. */
export interface SubActionUnlock {
  action: 'scout' | 'survey' | 'lookout' | 'track';
  /** The skill whose true level opens it… */
  skill: SkillId;
  level: number;
  /** …or a starting talent that covers it, from day one. */
  talents: readonly TalentId[];
  /** The journal line when it opens through play. */
  line: string;
  /** The verb, for the refusal ("you don't know how to survey yet"). */
  verb: string;
  /** How it comes, for the refusal. */
  how: string;
}

/**
 * The levels sit above a scout's training (Scouting 5h = Novice, #1398), so a new Warden of the
 * game's own start has Explore alone: four or so trips out make Apprentice (20h), where scouting a
 * whole ring and climbing to look out come; surveying properly comes at Adept (60h). A focus on
 * the skill (×3 practice, focus.ts) gets there three times as fast. Keen Eye ("a born scout") opens
 * the scouting three; Hunter's Patience opens tracking.
 */
export const EXPLORE_UNLOCKS: readonly SubActionUnlock[] = [
  { action: 'scout', skill: 'scouting', level: 2, talents: ['keenEye'], verb: 'scout a whole ring', how: 'explore more, and it will come',
    line: 'You\'ve walked enough of this land to sweep a whole ring in one go. You can scout now.' },
  { action: 'lookout', skill: 'scouting', level: 2, talents: ['keenEye'], verb: 'pick a height and read the land from it', how: 'explore more, and it will come',
    line: 'You know now where to climb, and what to look for from up there. You can climb and look out.' },
  { action: 'survey', skill: 'scouting', level: 3, talents: ['keenEye'], verb: 'survey the land', how: 'explore more, and it will come',
    line: 'You\'ve learned to read the land well enough to survey it properly.' },
  { action: 'track', skill: 'hunting', level: 1, talents: ['hunter'], verb: 'follow game by its sign', how: 'hunt, and it will come',
    line: 'The tracks have started to make sense: you can follow game now.' },
];

export const unlockOf = (action: string): SubActionUnlock | undefined => EXPLORE_UNLOCKS.find(u => u.action === action);

/** What it takes: a starting talent the Warden knows they have (chosen at creation), or the level. */
export interface Learner { skills: SkillPractice; character: { talents: readonly Talent[] } }

/** Opened by a talent the Warden chose (known). A hidden talent works, but they don't know to try. */
export const byTalent = (u: SubActionUnlock, w: Learner): boolean => w.character.talents.some(t => t.known && u.talents.includes(t.id));

export const subActionOpen = (u: SubActionUnlock, w: Learner): boolean => byTalent(u, w) || skillLevel(w.skills, u.skill) >= u.level;

/**
 * Why a Warden doesn't know how to do this exploring action yet, or null: the "hide" reason. Only
 * the four sub-actions are ever locked here; anything else is null.
 */
export function subActionLock(action: string, w: Learner): string | null {
  const u = unlockOf(action);
  if (!u || subActionOpen(u, w)) return null;
  return `you don't know how to ${u.verb} yet — ${u.how} (${SKILLS[u.skill].name})`;
}

/** The sub-actions open now. */
export const openSubActions = (w: Learner): SubActionUnlock[] => EXPLORE_UNLOCKS.filter(u => subActionOpen(u, w));

/** The sub-actions `after` has open that `before` didn't: each gets its journal line once. */
export const newlyOpen = (before: Learner, after: Learner): SubActionUnlock[] =>
  EXPLORE_UNLOCKS.filter(u => !subActionOpen(u, before) && subActionOpen(u, after));
