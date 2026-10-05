/**
 * Skills (#1236) — practical know-how that improves by use, in the spirit of
 * Drakar och Demoner and D&D. See docs/character-skills-design.md §1.
 *
 * Pure and renderer-agnostic like the rest of the sim core. Region 1 decides
 * *when* practice happens (every hour of work in a skill's field); this module
 * says which skill a piece of work trains, what level that practice amounts to,
 * and what a level is worth.
 *
 * Deterministic on purpose: DoD improves a skill with a dice roll after use;
 * the sim has no dice, so improvement is a practice-hour threshold instead.
 */

import type { ActionId } from './region1';

export type SkillId = 'woodcraft' | 'foraging' | 'hunting' | 'stonework' | 'fieldcraft' | 'scouting' | 'handcraft';

export const SKILLS: Readonly<Record<SkillId, { name: string; blurb: string }>> = {
  woodcraft: { name: 'Woodcraft', blurb: 'felling, splitting and building in timber' },
  foraging: { name: 'Foraging', blurb: 'finding what grows to eat' },
  hunting: { name: 'Hunting', blurb: 'tracking, trapping and taking game' },
  stonework: { name: 'Stonework', blurb: 'quarrying and shaping stone' },
  fieldcraft: { name: 'Fieldcraft', blurb: 'water, preserving and living off the land' },
  scouting: { name: 'Scouting', blurb: 'reading the land and finding the way' },
  handcraft: { name: 'Handcraft', blurb: 'weaving, sewing and fine handwork' },
};
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** Level names, 0–5. */
export const LEVELS = ['Untrained', 'Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'] as const;
export const MAX_LEVEL = LEVELS.length - 1;
/** Cumulative practice hours to reach each level (index = level). */
export const LEVEL_HOURS: readonly number[] = [0, 6, 18, 36, 60, 90];

/** Practice hours per skill. Absent = none. */
export type SkillPractice = Partial<Record<SkillId, number>>;

/** The level a number of practice hours amounts to. */
export function levelFromPractice(hours: number): number {
  let lvl = 0;
  while (lvl < MAX_LEVEL && hours >= LEVEL_HOURS[lvl + 1]) lvl++;
  return lvl;
}

export const skillLevel = (p: SkillPractice, id: SkillId): number => levelFromPractice(p[id] ?? 0);

/** Hours still to go to the next level (0 at Master). */
export function toNextLevel(p: SkillPractice, id: SkillId): number {
  const lvl = skillLevel(p, id);
  return lvl >= MAX_LEVEL ? 0 : LEVEL_HOURS[lvl + 1] - (p[id] ?? 0);
}

// Which skill a piece of work trains. Plain actions map by id; crafts and builds by recipe.
const ACTION_SKILL: Partial<Record<ActionId, SkillId>> = {
  wood: 'woodcraft', gather: 'foraging', hunt: 'hunting', track: 'hunting', quarry: 'stonework',
  water: 'fieldcraft', preserve: 'fieldcraft', scout: 'scouting', survey: 'scouting', lookout: 'scouting',
  tinker: 'handcraft',
};
const RECIPE_SKILL: Readonly<Record<string, SkillId>> = {
  'shelter-leanto': 'woodcraft', 'shelter-hut': 'woodcraft', 'shelter-timber': 'woodcraft', 'crude-shovel': 'woodcraft',
  'shelter-stone': 'stonework', 'stone-knife': 'stonework',
  'trap-snare': 'hunting',
  'cold-gear': 'handcraft', 'hide-parka': 'handcraft', waterskin: 'handcraft', bedroll: 'handcraft',
};

/** The skill this work trains and draws on, or null (rest, study). A recipe, when there is one, decides. */
export function skillFor(action: ActionId, recipeId?: string): SkillId | null {
  if (recipeId && RECIPE_SKILL[recipeId]) return RECIPE_SKILL[recipeId];
  return ACTION_SKILL[action] ?? null;
}

// ── What a level is worth in its field ──────────────────────────────────────

/** Vigor/Clarity drain multiplier: 6% less per level (a Master spends 30% less). */
export const drainMult = (level: number): number => 1 - 0.06 * level;
/** Extra yield on a gathering trip. */
export const SKILL_YIELD: readonly number[] = [0, 0, 1, 1, 2, 3];
/** Your tools work better in skilled hands: their yield bonus × this. */
export const toolMult = (level: number): number => 1 + 0.2 * level;
/** Added to the craft-grade score (the same score bench, tools and concepts add to). */
export const SKILL_CRAFT: readonly number[] = [0, 0, 1, 1, 2, 3];

/** Add practice; returns the new practice and the level reached if it went up. */
export function practise(p: SkillPractice, id: SkillId, hours: number): { practice: SkillPractice; levelUp: number | null } {
  const before = skillLevel(p, id);
  const practice = { ...p, [id]: (p[id] ?? 0) + hours };
  const after = skillLevel(practice, id);
  return { practice, levelUp: after > before ? after : null };
}

/** What carries into a new run: each skill at its level's threshold (the hands remember; the extra is lost). */
export function carriedSkills(p: SkillPractice): SkillPractice {
  const out: SkillPractice = {};
  for (const id of SKILL_IDS) { const lvl = skillLevel(p, id); if (lvl > 0) out[id] = LEVEL_HOURS[lvl]; }
  return out;
}
