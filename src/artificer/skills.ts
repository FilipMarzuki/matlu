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
 *
 * The range is long (#1241): "10,000 hours to mastery" lands at Professional,
 * there are levels above it, and the top three go past human into the
 * supernatural. And you never see your true level — only a self-assessment
 * bent by the Dunning–Kruger effect (perceivedLevel); the true level drives
 * every effect, so improvement is *felt* (the journal) rather than read.
 */

import type { ActionId } from './region1';

export type SkillId = 'woodcraft' | 'foraging' | 'hunting' | 'stonework' | 'fieldcraft' | 'scouting' | 'handcraft' | 'memory' | 'firstaid';

/** `felt`: how a true improvement shows itself in the journal — no numbers, just the work going better. */
export const SKILLS: Readonly<Record<SkillId, { name: string; blurb: string; felt: string }>> = {
  woodcraft: { name: 'Woodcraft', blurb: 'felling, splitting and building in timber', felt: 'The axe finds the grain more easily now' },
  foraging: { name: 'Foraging', blurb: 'finding what grows to eat', felt: 'Your eye catches food where you used to see only green' },
  hunting: { name: 'Hunting', blurb: 'tracking, trapping and taking game', felt: 'You move quieter now, and the tracks make more sense' },
  stonework: { name: 'Stonework', blurb: 'quarrying and shaping stone', felt: 'The stone splits where you mean it to' },
  fieldcraft: { name: 'Fieldcraft', blurb: 'water, preserving and living off the land', felt: 'Camp chores take less out of you than they did' },
  scouting: { name: 'Scouting', blurb: 'reading the land and finding the way', felt: 'The land reads more clearly — you notice what you used to miss' },
  handcraft: { name: 'Handcraft', blurb: 'weaving, sewing and fine handwork', felt: 'Your fingers work faster and truer' },
  // Memory (#1378): holding places in mind. Practised by remembering them, not by any one kind of work.
  memory: { name: 'Memory', blurb: 'holding places in mind, and finding them again', felt: 'Places stay with you more easily now' },
  // First aid (#1398): a scout's training. Practised by treating injuries (#1393).
  firstaid: { name: 'First aid', blurb: 'binding, splinting and looking after the hurt', felt: 'Your hands know what to do with a wound now' },
};
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** Level names (index = level). From Paragon (11) on, skill goes past what a human can do. */
export const LEVELS = [
  'Untrained', 'Novice', 'Apprentice', 'Adept', 'Journeyman', 'Skilled', 'Expert', 'Veteran',
  'Professional', 'Master', 'Grandmaster', 'Paragon', 'Mythic', 'Transcendent',
] as const;
export const MAX_LEVEL = LEVELS.length - 1;
/** Cumulative practice hours for each level: quick at first, 10,000 at Professional, a million at the top. */
export const LEVEL_HOURS: readonly number[] = [0, 5, 20, 60, 150, 400, 1_000, 3_000, 10_000, 25_000, 60_000, 150_000, 400_000, 1_000_000];
/** The first level beyond human. */
export const SUPERNATURAL_FROM = 11;
export const isSupernatural = (level: number): boolean => level >= SUPERNATURAL_FROM;

/** Practice hours per skill. Absent = none. */
export type SkillPractice = Partial<Record<SkillId, number>>;

/** The level a number of practice hours amounts to. */
export function levelFromPractice(hours: number): number {
  let lvl = 0;
  while (lvl < MAX_LEVEL && hours >= LEVEL_HOURS[lvl + 1]) lvl++;
  return lvl;
}

export const skillLevel = (p: SkillPractice, id: SkillId): number => levelFromPractice(p[id] ?? 0);

/** Hours still to go to the next true level (0 at the top). Not shown to the player. */
export function toNextLevel(p: SkillPractice, id: SkillId): number {
  const lvl = skillLevel(p, id);
  return lvl >= MAX_LEVEL ? 0 : LEVEL_HOURS[lvl + 1] - (p[id] ?? 0);
}

// Which skill a piece of work trains. Plain actions map by id; crafts and builds by recipe.
const ACTION_SKILL: Partial<Record<ActionId, SkillId>> = {
  wood: 'woodcraft', gather: 'foraging', hunt: 'hunting', track: 'hunting', quarry: 'stonework',
  water: 'fieldcraft', preserve: 'fieldcraft', scout: 'scouting', survey: 'scouting', lookout: 'scouting',
  tinker: 'handcraft', fish: 'fieldcraft', treat: 'firstaid',
};
const RECIPE_SKILL: Readonly<Record<string, SkillId>> = {
  'shelter-leanto': 'woodcraft', 'shelter-hut': 'woodcraft', 'shelter-timber': 'woodcraft', 'crude-shovel': 'woodcraft',
  'shelter-stone': 'stonework', 'stone-knife': 'stonework', 'cold-pit': 'stonework',
  'trap-snare': 'hunting',
  'cold-gear': 'handcraft', 'hide-parka': 'handcraft', waterskin: 'handcraft', bedroll: 'handcraft',
  basket: 'handcraft', backpack: 'handcraft', harness: 'handcraft', sled: 'woodcraft',
};

/** The skill this work trains and draws on, or null (rest, study). A recipe, when there is one, decides. */
export function skillFor(action: ActionId, recipeId?: string): SkillId | null {
  if (recipeId && RECIPE_SKILL[recipeId]) return RECIPE_SKILL[recipeId];
  return ACTION_SKILL[action] ?? null;
}

// ── What a level is worth in its field ──────────────────────────────────────
// Smooth curves rather than per-level tables, so the long range can't break the maths:
// drain never reaches zero, and every level still adds something.

/** Vigor/Clarity drain multiplier: 0.74 at Skilled, 0.59 at Grandmaster, 0.52 at Transcendent. */
export const drainMult = (level: number): number => 1 / (1 + 0.07 * level);
/** Extra yield on a gathering trip: +1 for every two levels. */
export const yieldBonus = (level: number): number => Math.floor(level / 2);
/** Your tools work better in skilled hands: their yield bonus × this. */
export const toolMult = (level: number): number => 1 + 0.15 * level;
/** Added to the craft-grade score (the same score bench, tools and concepts add to). */
export const craftBonus = (level: number): number => Math.floor(level / 2);

// ── Self-assessment: the Dunning–Kruger effect ──────────────────────────────

/** Level as a continuous number (e.g. 2.5 = halfway from Apprentice to Adept). */
export function levelProgress(hours: number): number {
  const lvl = levelFromPractice(hours);
  if (lvl >= MAX_LEVEL) return MAX_LEVEL;
  return lvl + (hours - LEVEL_HOURS[lvl]) / (LEVEL_HOURS[lvl + 1] - LEVEL_HOURS[lvl]);
}

/**
 * How far off your own estimate is, by true (continuous) level: a beginner
 * overrates themselves ("Mount Stupid"), someone getting good discovers how much
 * they don't know ("the valley"), and experts stay a little modest for good.
 */
const BIAS: readonly [number, number][] = [[0, 0], [0.8, 1.5], [1.5, 1.9], [2.5, 0.4], [3.5, -0.8], [4.5, -1], [6, -0.6], [9, -0.3], [MAX_LEVEL, -0.2]];
function bias(c: number): number {
  for (let i = 1; i < BIAS.length; i++) {
    const [x0, y0] = BIAS[i - 1], [x1, y1] = BIAS[i];
    if (c <= x1) return y0 + (y1 - y0) * (c - x0) / (x1 - x0);
  }
  return BIAS[BIAS.length - 1][1];
}

/** The level you *think* you're at (continuous). The game shows this; effects use the true level. */
export const perceivedProgress = (hours: number): number => {
  const c = levelProgress(hours);
  return Math.max(0, Math.min(MAX_LEVEL, c + bias(c)));
};
export const perceivedLevel = (p: SkillPractice, id: SkillId): number => Math.floor(perceivedProgress(p[id] ?? 0));

/**
 * Add practice. Returns the new practice, the true level reached if it went up
 * (felt, not announced), and the self-assessed level if it fell (the humbling).
 */
export function practise(p: SkillPractice, id: SkillId, hours: number): { practice: SkillPractice; levelUp: number | null; humbled: number | null } {
  const before = skillLevel(p, id), seemedBefore = perceivedLevel(p, id);
  const practice = { ...p, [id]: (p[id] ?? 0) + hours };
  const after = skillLevel(practice, id), seemsNow = perceivedLevel(practice, id);
  return { practice, levelUp: after > before ? after : null, humbled: seemsNow < seemedBefore ? seemsNow : null };
}

/** What carries into a new run: all of it. The climb to mastery spans many runs (#1241). */
export function carriedSkills(p: SkillPractice): SkillPractice {
  const out: SkillPractice = {};
  for (const id of SKILL_IDS) if ((p[id] ?? 0) > 0) out[id] = p[id];
  return out;
}
