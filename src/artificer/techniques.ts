/**
 * Techniques (#1243): the concrete things a skill level *looks like* — reading
 * the grain, still hunting, smoke curing. Each is typical of a level but not
 * locked to it, so a Warden can be lopsided like real people: a middling
 * woodcutter who happens to know master joinery because someone taught them.
 *
 * Some techniques you work out alone (easy ones quickly, hard ones slowly);
 * some only a teacher or a manual can give you. And past Adept, practising
 * alone gets steadily less efficient — guidance matters more the higher you go.
 *
 * Pure: Region 1 calls these when work is done and practice is credited.
 */

import { LEVEL_HOURS, type SkillId } from './skills';
import type { ActionId } from './region1';

/** easy / hard: can be worked out alone (after 0.8× / 2.5× the level's hours); teacher: only taught. */
export type Difficulty = 'easy' | 'hard' | 'teacher';

/** What a technique does: on these actions or recipes, extra yield, lighter work, better grades. */
export interface TechniqueEffect {
  actions?: readonly ActionId[];
  recipes?: readonly string[];
  /** Added to a gathering trip's yield. */
  yield?: number;
  /** Multiplies Vigor and Clarity drain on the work. */
  drain?: number;
  /** Added to the craft-grade score. */
  grade?: number;
  /** Multiplies the drain of walking out to the rings (any land action). */
  travelDrain?: number;
}

export interface Technique { id: string; skill: SkillId; name: string; level: number; difficulty: Difficulty; how: string; effect: TechniqueEffect }

const WOODEN = ['shelter-leanto', 'shelter-hut', 'shelter-timber', 'crude-shovel'] as const;
const HANDCRAFT = ['cold-gear', 'hide-parka', 'waterskin', 'bedroll'] as const;

export const TECHNIQUES: readonly Technique[] = [
  // Woodcraft
  { id: 'grain', skill: 'woodcraft', name: 'Reading the grain', level: 1, difficulty: 'easy', how: 'the wood splits clean when you follow the grain', effect: { actions: ['wood'], yield: 1 } },
  { id: 'notching', skill: 'woodcraft', name: 'Notching & lashing', level: 3, difficulty: 'hard', how: 'a notch and a lashing hold where a pile of sticks falls', effect: { recipes: WOODEN, grade: 1, drain: 0.9 } },
  { id: 'seasoning', skill: 'woodcraft', name: 'Seasoning firewood', level: 5, difficulty: 'teacher', how: 'wood cut and stacked right burns twice as long', effect: { actions: ['wood'], yield: 2 } },
  // Foraging
  { id: 'greens', skill: 'foraging', name: 'Edible greens', level: 1, difficulty: 'easy', how: 'half of what grows here can be eaten, once you know which half', effect: { actions: ['gather'], yield: 1 } },
  { id: 'roots', skill: 'foraging', name: 'Roots & tubers', level: 3, difficulty: 'hard', how: 'the best food is under the ground', effect: { actions: ['gather'], yield: 1, drain: 0.9 } },
  { id: 'fungi', skill: 'foraging', name: 'Mushroom lore', level: 5, difficulty: 'teacher', how: 'which caps feed you and which kill you is not something to guess', effect: { actions: ['gather'], yield: 2 } },
  // Hunting
  { id: 'sign', skill: 'hunting', name: 'Reading sign', level: 1, difficulty: 'easy', how: 'droppings, scrapes and trails tell you who passed and when', effect: { actions: ['track'], drain: 0.8 } },
  { id: 'stalking', skill: 'hunting', name: 'Still hunting', level: 3, difficulty: 'hard', how: 'wait, downwind, and let the game come to you', effect: { actions: ['hunt'], yield: 2 } },
  { id: 'dressing', skill: 'hunting', name: 'Field dressing', level: 5, difficulty: 'teacher', how: 'clean, quick butchering wastes nothing', effect: { actions: ['hunt'], yield: 1 } },
  // Stonework
  { id: 'cleave', skill: 'stonework', name: 'Finding the cleave', level: 1, difficulty: 'easy', how: 'stone has seams; strike along them', effect: { actions: ['quarry'], yield: 1 } },
  { id: 'knapping', skill: 'stonework', name: 'Knapping', level: 3, difficulty: 'hard', how: 'flake by flake, an edge comes out of a cobble', effect: { recipes: ['stone-knife'], grade: 1 } },
  { id: 'drystone', skill: 'stonework', name: 'Dry-stone walling', level: 5, difficulty: 'teacher', how: 'a wall with no mortar that stands for a century', effect: { recipes: ['shelter-stone'], grade: 1, drain: 0.8 } },
  // Fieldcraft
  { id: 'springs', skill: 'fieldcraft', name: 'Finding clean water', level: 1, difficulty: 'easy', how: 'moving water, green banks, the lowest ground', effect: { actions: ['water'], yield: 1 } },
  { id: 'curing', skill: 'fieldcraft', name: 'Smoke curing', level: 3, difficulty: 'hard', how: 'low smoke and patience turn meat into winter food', effect: { actions: ['preserve'], drain: 0.8 } },
  { id: 'banking', skill: 'fieldcraft', name: 'Banking a fire', level: 5, difficulty: 'teacher', how: 'a fire banked right is still alive at dawn', effect: { actions: ['water', 'preserve'], drain: 0.8 } },
  // Scouting
  { id: 'landmarks', skill: 'scouting', name: 'Landmarks', level: 1, difficulty: 'easy', how: 'pick three high points and you are never lost', effect: { actions: ['scout', 'survey'], drain: 0.85 } },
  { id: 'pathfinding', skill: 'scouting', name: 'Pathfinding', level: 3, difficulty: 'hard', how: 'the easy way across is rarely the straight one', effect: { travelDrain: 0.75 } },
  { id: 'weather', skill: 'scouting', name: 'Weather sense', level: 5, difficulty: 'teacher', how: 'the sky tells you tomorrow, if you were taught to read it', effect: { actions: ['survey', 'lookout'], drain: 0.7 } },
  // Handcraft
  { id: 'weave', skill: 'handcraft', name: 'Tight weave', level: 1, difficulty: 'easy', how: 'pack the weft and the cold stays out', effect: { recipes: ['cold-gear', 'bedroll'], grade: 1 } },
  { id: 'sewing', skill: 'handcraft', name: 'Sewing hide', level: 3, difficulty: 'hard', how: 'an awl, sinew and a running stitch that holds water', effect: { recipes: ['hide-parka', 'waterskin'], grade: 1 } },
  { id: 'patterns', skill: 'handcraft', name: 'Pattern cutting', level: 6, difficulty: 'teacher', how: 'cut once, from a pattern, and nothing is wasted', effect: { recipes: HANDCRAFT, grade: 1, drain: 0.85 } },
];
export const techniqueById = (id: string): Technique | undefined => TECHNIQUES.find(t => t.id === id);

/** Practice hours in the skill after which a technique is worked out alone (Infinity: never). */
export function selfLearnHours(t: Technique): number {
  if (t.difficulty === 'teacher') return Infinity;
  return LEVEL_HOURS[t.level] * (t.difficulty === 'easy' ? 0.8 : 2.5);
}

/** A teacher or manual can teach a technique up to this many levels above your true level. */
export const TEACH_REACH = 2;
export const canBeTaught = (t: Technique, trueLevel: number): boolean => t.level <= trueLevel + TEACH_REACH;

/** How efficiently practising *alone* credits hours, by true level: full to Adept, then ever less. */
export const SOLO_RATE: readonly number[] = [1, 1, 1, 1, 0.8, 0.6, 0.45, 0.35, 0.25, 0.2, 0.15, 0.1, 0.08, 0.05];
export type Guidance = 'none' | 'manual' | 'teacher';
/** Practice efficiency at a level with this guidance: a manual gets you halfway back to full; a teacher all the way. */
export function guidanceRate(level: number, guidance: Guidance): number {
  const solo = SOLO_RATE[Math.min(level, SOLO_RATE.length - 1)];
  return guidance === 'teacher' ? 1 : guidance === 'manual' ? (1 + solo) / 2 : solo;
}

/**
 * Knowing what's typical of the levels you've reached speeds the climb: 0.7 knowing none
 * of it, 1 knowing all. (Only levels already reached, so a beginner learns at full speed;
 * the plateau comes where it should — e.g. an Adept who never got the notching right.)
 */
export function techniqueFactor(known: readonly string[], skill: SkillId, level: number): number {
  const typical = TECHNIQUES.filter(t => t.skill === skill && t.level <= level);
  if (!typical.length) return 1;
  return 0.7 + 0.3 * typical.filter(t => known.includes(t.id)).length / typical.length;
}

/** The combined effect of known techniques on one piece of work. */
export function techniqueEffects(known: readonly string[], action: ActionId, recipeId?: string, ringed = false): { yield: number; drain: number; grade: number; travelDrain: number } {
  const out = { yield: 0, drain: 1, grade: 0, travelDrain: 1 };
  for (const id of known) {
    const e = techniqueById(id)?.effect;
    if (!e) continue;
    if (e.travelDrain && ringed) out.travelDrain *= e.travelDrain;
    const applies = (e.actions?.includes(action) ?? false) || (recipeId !== undefined && (e.recipes?.includes(recipeId) ?? false));
    if (!applies) continue;
    out.yield += e.yield ?? 0;
    out.drain *= e.drain ?? 1;
    out.grade += e.grade ?? 0;
  }
  return out;
}

// ── Manuals ─────────────────────────────────────────────────────────────────

/** A manual guides practice in its skill and teaches its techniques once they're within your reach. */
export interface Manual { id: string; name: string; skill: SkillId; teaches: readonly string[]; found: string }
export const MANUALS: readonly Manual[] = [
  { id: 'tally-book', name: "A trapper's tally-book", skill: 'hunting', teaches: ['stalking'], found: 'Under a fallen hide-hut in the far ring: a trapper\'s tally-book, pages of tracks and patient notes' },
  { id: 'forester-notes', name: "A forester's notes", skill: 'woodcraft', teaches: ['notching'], found: 'In a dry cleft in the distant hills: a forester\'s notes, sketches of notches and lashings' },
];
export const manualById = (id: string): Manual | undefined => MANUALS.find(m => m.id === id);
/** The manual found by first scouting a ring, if any. */
export const MANUAL_BY_RING: Readonly<Partial<Record<1 | 2 | 3, string>>> = { 2: 'tally-book', 3: 'forester-notes' };
