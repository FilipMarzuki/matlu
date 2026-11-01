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

// ── One exploring action that grows (#2018, switch `explore-grows`) ─────────

/**
 * The rule switch (features.ts). With it on, Scout and Survey aren't separate actions: Explore is
 * the one exploring action, and what it's called and what it can do grow with the Scouting skill.
 * Scout did what Explore's first trip into a distance did, so it was never worth a card of its own.
 */
export const EXPLORE_GROWS = 'explore-grows';

/**
 * How far along the one exploring action is:
 * - `look` (Look around): close by only, no heading out;
 * - `explore` (Explore): the farther distances, and heading out one of the eight ways;
 * - `scout` (Scout): as Explore, and a look round a distance makes it observed in one trip (Survey's work).
 */
export type ExploreTier = 'look' | 'explore' | 'scout';

/** The actions the one exploring action takes the place of. */
export const FOLDED_INTO_EXPLORE: readonly string[] = ['scout', 'survey'];

/** The Scouting levels the tiers open at: Apprentice (20h) and Adept (60h), as Scout and Survey did. */
export const TIER_LEVELS = { explore: 2, scout: 3 } as const;

/**
 * The tier a Warden is at: their Scouting level, one higher with Keen Eye ("a born scout"), which
 * opened Scout and Survey from day one before. Pure: the skills and talents the run keeps.
 */
export function exploreTier(w: Learner): ExploreTier {
  const keen = w.character.talents.some(t => t.known && t.id === 'keenEye') ? 1 : 0;
  const lvl = skillLevel(w.skills, 'scouting') + keen;
  return lvl >= TIER_LEVELS.scout ? 'scout' : lvl >= TIER_LEVELS.explore ? 'explore' : 'look';
}

/** What a tier is called, in English (the app says it in the viewer's language: `act.explore.look`…). */
export const TIER_NAME: Readonly<Record<ExploreTier, string>> = { look: 'Look around', explore: 'Explore', scout: 'Scout' };

/** The journal's line when the one exploring action steps up. */
export const TIER_LINE: Readonly<Record<'explore' | 'scout', string>> = {
  explore: 'You\'ve looked around enough to know how to go further: you can explore now, out to the farther land and off in any direction.',
  scout: 'You read the land well now: when you scout a stretch of it, one trip shows you everything that\'s there.',
};

/** The tier `after` has stepped up to from `before`'s, or null. */
export function tierRaised(before: Learner, after: Learner): 'explore' | 'scout' | null {
  const a = exploreTier(before), b = exploreTier(after);
  return a === b || b === 'look' ? null : b;
}

/** Why Look around can't go out that far or head out yet (it comes with practice). */
export const LOOK_LOCK = 'you look around close by for now — going further, and heading out, come as you get better at it (Scouting)';

// ── Gather stones first, quarry later (#1816, switch `stone-gathering`) ─────

/** The rule switch (features.ts). */
export const STONE_GATHERING = 'stone-gathering';
/** The stonework technique that opens quarrying (techniques.ts "Finding the cleave"). */
export const QUARRY_TECHNIQUE = 'cleave';
/** Quarrying's "hide" reason, in the words `reason.unlock` reads back (i18n/en/journal.ts derives them). */
export const QUARRY_UNLOCK = { verb: 'quarry stone', how: 'gather stones, and you\'ll find the cleave' } as const;
/** The find note a flint seam has while gathering is the only stone work you know (exploration.ts FINDS has quarrying's). */
export const STONE_GATHER_FIND_NOTE = 'gathering stones brings +1 stone';
