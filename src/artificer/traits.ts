/**
 * Traits (#1237): who the Warden is, chosen at character creation — two of
 * them, each with an upside and a cost. See docs/character-skills-design.md §2.
 *
 * Traits work only through levers that already exist (drain, recovery,
 * deprivation costs, craft grade/salvage/time, practice, healing) rather than
 * shifting capacity caps: caps drift back to the baseline every night and the
 * winter-readiness check wants them at 100+, so a "−10 Vigor" trait would
 * quietly make a run unwinnable.
 */

import type { SkillId, SkillPractice } from './skills';

export type TraitId = 'hardy' | 'sharp' | 'lightEater' | 'carefulHands' | 'quickLearner' | 'coldBlooded' | 'tough' | 'keenEye';

/** Everything a trait can touch. Multipliers default to 1, additions to 0. */
export interface TraitEffects {
  vigorDrain?: number;
  clarityDrain?: number;
  vigorRecovery?: number;
  clarityRecovery?: number;
  hungerCost?: number;
  thirstCost?: number;
  /** Cold nights cost no Condition. */
  coldProof?: boolean;
  /** Condition healing per night. */
  healRate?: number;
  /** Skill practice per hour worked. */
  practice?: number;
  /** Added to the craft-grade score. */
  craftGrade?: number;
  /** Added to the salvage fraction of a failed craft. */
  salvage?: number;
  /** Craft hours. */
  craftTime?: number;
  /** Once per run, Condition 0 leaves you at 1 instead of ending the run. */
  lastStand?: boolean;
  /** Drain on work in one skill (multiplies), and on everything else (multiplies). */
  skillDrain?: { skill: SkillId; mult: number; otherClarity: number };
  /** Practice a new Warden starts with. */
  startSkills?: SkillPractice;
}

export interface TraitDef { name: string; upside: string; cost: string; effects: TraitEffects }

export const TRAITS: Readonly<Record<TraitId, TraitDef>> = {
  hardy: { name: 'Hardy', upside: 'work tires the body 10% less', cost: 'the mind recovers 10% less overnight', effects: { vigorDrain: 0.9, clarityRecovery: 0.9 } },
  sharp: { name: 'Sharp-minded', upside: 'work tires the mind 10% less', cost: 'the body recovers 10% less overnight', effects: { clarityDrain: 0.9, vigorRecovery: 0.9 } },
  lightEater: { name: 'Light Eater', upside: 'hunger costs half as much', cost: 'the body recovers 8% less overnight', effects: { hungerCost: 0.5, vigorRecovery: 0.92 } },
  carefulHands: { name: 'Careful Hands', upside: 'better craft grades and more salvaged from failures', cost: 'crafting takes 20% longer', effects: { craftGrade: 1, salvage: 0.15, craftTime: 1.2 } },
  quickLearner: { name: 'Quick Learner', upside: 'skills improve 50% faster', cost: 'Condition heals 30% slower', effects: { practice: 1.5, healRate: 0.7 } },
  coldBlooded: { name: 'Cold-blooded', upside: 'cold nights cost no Condition', cost: 'thirst costs 25% more', effects: { coldProof: true, thirstCost: 1.25 } },
  tough: { name: 'Tough', upside: 'once per run, you cling on at Condition 1 instead of collapsing', cost: 'Condition heals 20% slower', effects: { lastStand: true, healRate: 0.8 } },
  keenEye: { name: 'Keen Eye', upside: 'starts a Novice scout; scouting tires you 15% less', cost: 'all other work tires the mind 5% more', effects: { startSkills: { scouting: 5 }, skillDrain: { skill: 'scouting', mult: 0.85, otherClarity: 1.05 } } },
};
export const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];
/** How many traits a Warden has. */
export const TRAIT_COUNT = 2;

/** Combined effects of a set of traits (multipliers multiply, additions add, flags OR). */
export function traitEffects(traits: readonly TraitId[]): Required<Omit<TraitEffects, 'skillDrain' | 'startSkills'>> & Pick<TraitEffects, 'skillDrain' | 'startSkills'> {
  const out = {
    vigorDrain: 1, clarityDrain: 1, vigorRecovery: 1, clarityRecovery: 1, hungerCost: 1, thirstCost: 1,
    coldProof: false, healRate: 1, practice: 1, craftGrade: 0, salvage: 0, craftTime: 1, lastStand: false,
    skillDrain: undefined as TraitEffects['skillDrain'], startSkills: undefined as SkillPractice | undefined,
  };
  for (const id of traits) {
    const e = TRAITS[id]?.effects;
    if (!e) continue;
    for (const k of ['vigorDrain', 'clarityDrain', 'vigorRecovery', 'clarityRecovery', 'hungerCost', 'thirstCost', 'healRate', 'practice', 'craftTime'] as const) out[k] *= e[k] ?? 1;
    out.craftGrade += e.craftGrade ?? 0;
    out.salvage += e.salvage ?? 0;
    out.coldProof ||= e.coldProof ?? false;
    out.lastStand ||= e.lastStand ?? false;
    out.skillDrain ??= e.skillDrain;
    if (e.startSkills) out.startSkills = { ...out.startSkills, ...e.startSkills };
  }
  return out;
}

/** Drain multipliers for work in `skill` (null: no skill), from traits. */
export function traitDrain(traits: readonly TraitId[], skill: SkillId | null): { vigor: number; clarity: number } {
  const t = traitEffects(traits);
  let vigor = t.vigorDrain, clarity = t.clarityDrain;
  if (t.skillDrain) {
    if (skill === t.skillDrain.skill) { vigor *= t.skillDrain.mult; clarity *= t.skillDrain.mult; }
    else clarity *= t.skillDrain.otherClarity;
  }
  return { vigor, clarity };
}

/** Validate a trait pick: known ids, no repeats, exactly {@link TRAIT_COUNT} (or none, for a quick start). */
export function validTraits(ids: readonly string[]): ids is TraitId[] {
  return (ids.length === 0 || ids.length === TRAIT_COUNT) && new Set(ids).size === ids.length && ids.every(id => id in TRAITS);
}
