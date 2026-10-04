/**
 * Planner — what does a crafting goal need next? (#1184)
 *
 * Sub-actions for the sim: the player says "make a plank" and the sim works
 * out "harvest wood first". We deliberately don't plan the whole tree up
 * front — a 1–2 wood roll landing on 1 would make any such plan stale. A
 * goal entry in the ActionQueue (#1185) asks this ONE question every time it
 * reaches the head: given the inventory right now, what's the next thing to
 * do? It answers with a single step and nothing else.
 *
 * `Automation` is the progression hook (#1183): how much the planner may do
 * on the player's behalf. It's a plain capability object — the planner has
 * no idea what a "level" is, and that's the point.
 *
 * Pure: no rng, no Phaser, no mutation of its inputs.
 */

import type { Inventory } from './Inventory';
import type { HarvestSource, Recipe } from './ActionQueue';

/**
 * The Workshop-Towns guild ranks (#1195). Artificer: Convergence names the
 * top one — the title is the goal, not the start.
 */
export type GuildRank = 'apprentice' | 'journeyman' | 'master' | 'artificer';

export interface Automation {
  /** Which guild rank grants this much automation. Compare ranks by this, not by object identity. */
  rank: GuildRank;
  /** Display name, e.g. "Journeyman". */
  label: string;
  /** May push a harvest for a missing direct input. */
  mayHarvest: boolean;
  /** May push a sub-goal (craft) for a missing craftable input. */
  mayCraftSubgoals: boolean;
  /** How many sub-goal levels deep it may go (0 = direct inputs only). */
  maxDepth: number;
}

/**
 * Ranks in ascending order. Frozen so a scene can't accidentally promote
 * the player by mutating a shared preset — copy one to tweak it.
 */
export const GUILD_RANKS: readonly Automation[] = Object.freeze([
  /** You do everything by hand — goals aren't offered. */
  Object.freeze({ rank: 'apprentice', label: 'Apprentice', mayHarvest: false, mayCraftSubgoals: false, maxDepth: 0 }),
  /** You know where the wood is: harvests happen for you, crafting doesn't. */
  Object.freeze({ rank: 'journeyman', label: 'Journeyman', mayHarvest: true, mayCraftSubgoals: false, maxDepth: 0 }),
  /** You can plan a two-step job: one level of sub-goals. */
  Object.freeze({ rank: 'master', label: 'Master', mayHarvest: true, mayCraftSubgoals: true, maxDepth: 1 }),
  /** You run a workshop: any depth. */
  Object.freeze({ rank: 'artificer', label: 'Artificer', mayHarvest: true, mayCraftSubgoals: true, maxDepth: Infinity }),
] as Automation[]);

/** The preset for a rank — the same object every call, so identity checks against the aliases below still hold. */
export function rankByName(rank: GuildRank): Automation {
  return GUILD_RANKS.find(r => r.rank === rank)!;
}

/** @deprecated Use `rankByName('apprentice')` / `GUILD_RANKS` (#1195). */
export const AUTOMATION_NONE: Automation = rankByName('apprentice');
/** @deprecated Use `rankByName('journeyman')` / `GUILD_RANKS` (#1195). */
export const AUTOMATION_HARVEST: Automation = rankByName('journeyman');
/** @deprecated Use `rankByName('master')` / `GUILD_RANKS` (#1195). */
export const AUTOMATION_WORKSHOP: Automation = rankByName('master');
/** @deprecated Use `rankByName('artificer')` / `GUILD_RANKS` (#1195). */
export const AUTOMATION_FULL: Automation = rankByName('artificer');

export type PlanStep =
  /** Every input is in the inventory: craft now. */
  | { kind: 'craft' }
  /** Harvest `sourceId` to get `itemId`. */
  | { kind: 'harvest'; sourceId: string; itemId: string }
  /** Push a goal for `recipeId`, which makes `itemId`. */
  | { kind: 'subgoal'; recipeId: string; itemId: string }
  /** Can't make progress on `itemId`, and why. */
  | { kind: 'blocked'; itemId: string; reason: 'no-source' | 'automation' | 'depth' | 'cycle' };

/** Only what the planner reads; a real Inventory satisfies this. */
export type InventoryView = Pick<Inventory, 'has' | 'getQty'>;

/** Expected quantity of `itemId` from one harvest of `source`, 0 if it doesn't yield it. */
function expectedYield(source: HarvestSource, itemId: string): number {
  return source.yields
    .filter(y => y.itemId === itemId)
    .reduce((sum, y) => sum + (y.min + y.max) / 2, 0);
}

export function nextStep(
  goal: { recipeId: string; depth: number },
  inventory: InventoryView,
  recipes: Recipe[],
  sources: HarvestSource[],
  automation: Automation,
  /** Recipe ids on the goal stack above this one — re-entering one is a cycle. */
  ancestry: string[] = [],
): PlanStep {
  const recipe = recipes.find(r => r.id === goal.recipeId);
  if (!recipe) return { kind: 'blocked', itemId: goal.recipeId, reason: 'no-source' };

  // Only the FIRST missing input matters: the goal re-asks after each
  // sub-action resolves, so the rest get their turn then.
  const missing = recipe.inputs.find(i => !inventory.has(i.item, i.qty));
  if (!missing) return { kind: 'craft' };
  const itemId = missing.item;

  // 1. Craft it. Prefer a recipe whose inputs are all present (one craft and
  //    done) over the first one that merely exists.
  const makers = recipes.filter(r => r.output.item === itemId);
  if (makers.length > 0) {
    const cyclic = makers.every(r => ancestry.includes(r.id));
    const allowed = automation.mayCraftSubgoals && goal.depth < automation.maxDepth;
    if (allowed && !cyclic) {
      const candidates = makers.filter(r => !ancestry.includes(r.id));
      const ready = candidates.find(r => r.inputs.every(i => inventory.has(i.item, i.qty)));
      const pick = ready ?? candidates[0];
      return { kind: 'subgoal', recipeId: pick.id, itemId };
    }
  }

  // 2. Harvest it. Highest expected yield per trip wins; ties keep map order.
  const yielders = sources.filter(s => expectedYield(s, itemId) > 0);
  if (yielders.length > 0 && automation.mayHarvest) {
    const best = yielders.reduce((a, b) => (expectedYield(b, itemId) > expectedYield(a, itemId) ? b : a));
    return { kind: 'harvest', sourceId: best.id, itemId };
  }

  // 3. Explain why not. Order matters: a maker that exists but can't be used
  //    is a more useful message than "no source" when both are true.
  if (makers.length > 0) {
    if (makers.every(r => ancestry.includes(r.id))) return { kind: 'blocked', itemId, reason: 'cycle' };
    if (!automation.mayCraftSubgoals) return { kind: 'blocked', itemId, reason: 'automation' };
    if (goal.depth >= automation.maxDepth) return { kind: 'blocked', itemId, reason: 'depth' };
  }
  if (yielders.length > 0) return { kind: 'blocked', itemId, reason: 'automation' };
  return { kind: 'blocked', itemId, reason: 'no-source' };
}
