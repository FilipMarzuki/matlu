/**
 * What darkness does to work (#1281, epic #1272).
 *
 * Light comes from the clock (#1280): 1 by day, 0.5 in twilight, 0 in the
 * dark, averaged over a piece of work (walk included). These pure rules turn
 * that light into consequences:
 *
 * - foraging in the dark is poor (you can't see what you're picking),
 * - wood and stone come in a little lower and the work is heavier,
 * - scouting, surveying and looking out learn nothing below half light,
 * - the walk out to the rings is harder in the dark,
 * - crafting and study at night need firelight — firewood — or go worse.
 *
 * Region 1 reads these; with the flat world (tests) light is always 1.
 */

import type { ActionId } from './region1';

/** Below this light you can't see to scout, and close work needs a fire. */
export const SEE_BELOW = 0.5;

/** How much of a trip's haul you bring back in this light. */
export function darkYieldMult(action: ActionId, light: number): number {
  if (action === 'gather') return 0.5 + 0.5 * light;
  if (action === 'wood' || action === 'quarry') return 0.75 + 0.25 * light;
  return 1;
}

/** Extra Vigor the work itself costs in this light (felling and breaking stone in the dark). */
export const darkWorkDrain = (action: ActionId, light: number): number =>
  action === 'wood' || action === 'quarry' ? 1 + 0.2 * (1 - light) : 1;

/** Extra cost of walking out to the rings and back in this light. */
export const darkTravelDrain = (light: number): number => 1 + 0.3 * (1 - light);

/** Too dark to learn anything from looking at the land. */
export const tooDarkToSee = (action: ActionId, light: number): boolean =>
  (action === 'scout' || action === 'survey' || action === 'lookout') && light < SEE_BELOW;

/** Firewood a fire for close work burns: one per started four hours. */
export const firelightCost = (hours: number): number => Math.ceil(hours / 4);

/**
 * Close work (crafting, study) at night: by firelight it costs a little more
 * of the mind; without a fire, much more, and crafts come out a grade worse.
 */
export function nightWork(light: number, firewood: number, hours: number): { fire: number; clarity: number; grade: number } {
  if (light >= SEE_BELOW) return { fire: 0, clarity: 1, grade: 0 };
  const fire = firelightCost(hours);
  return firewood >= fire ? { fire, clarity: 1.2, grade: 0 } : { fire: 0, clarity: 1.5, grade: -1 };
}

/** Scale a haul for the light, never below zero. */
export const scaleHaul = (n: number, mult: number): number => Math.max(0, Math.floor(n * mult));
