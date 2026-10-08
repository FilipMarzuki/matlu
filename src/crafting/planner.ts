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

/** The Workshop-Towns guild ranks (#1195), lowest first. Each one is an {@link Automation} level. */
export type GuildRank = 'apprentice' | 'journeyman' | 'master' | 'artificer';

export interface Automation {
  /** The guild rank this level of help belongs to (#1195). */
  rank: GuildRank;
  /** The rank's name as the UI shows it. */
  label: string;
  /** May push a harvest for a missing direct input. */
  mayHarvest: boolean;
  /** May push a sub-goal (craft) for a missing craftable input. */
  mayCraftSubgoals: boolean;
  /** How many sub-goal levels deep it may go (0 = direct inputs only). */
  maxDepth: number;
}

/**
 * The guild ranks (#1195), lowest first. The game is *Artificer: Convergence*, and its title
 * names the top rank. Each rank is how much the planner may do for you:
 * - Apprentice: you do everything by hand; goals aren't offered.
 * - Journeyman: you know where the wood is; harvests happen for you, crafting doesn't.
 * - Master: you can plan a two-step job (one level of sub-goals).
 * - Artificer: you run a workshop, any depth.
 */
// Frozen: rankByName and the AUTOMATION_* aliases hand out these very objects, so one caller
// changing one would change it for every queue and scene.
export const GUILD_RANKS: readonly Readonly<Automation>[] = [
  { rank: 'apprentice', label: 'Apprentice', mayHarvest: false, mayCraftSubgoals: false, maxDepth: 0 },
  { rank: 'journeyman', label: 'Journeyman', mayHarvest: true, mayCraftSubgoals: false, maxDepth: 0 },
  { rank: 'master', label: 'Master', mayHarvest: true, mayCraftSubgoals: true, maxDepth: 1 },
  { rank: 'artificer', label: 'Artificer', mayHarvest: true, mayCraftSubgoals: true, maxDepth: Infinity },
].map(r => Object.freeze(r as Automation));

/**
 * Whether goals are offered at all: only if the planner may do something on its own — harvest
 * or craft a sub-goal. Asked by what the level can do, not its name, so a copy (or a future
 * level that keeps a rank but loses a capability) behaves the same. The queue and the scene's
 * Make button both ask this, so they can't disagree.
 */
export const offersGoals = (a: Automation): boolean => a.mayHarvest || a.mayCraftSubgoals;

/** The {@link Automation} for a rank — the same object as its entry in {@link GUILD_RANKS}. */
export function rankByName(rank: GuildRank): Automation {
  const found = GUILD_RANKS.find(r => r.rank === rank);
  if (!found) throw new Error(`unknown guild rank: ${rank}`);
  return found;
}

/** @deprecated Use `rankByName('apprentice')` or {@link GUILD_RANKS} (#1195). */
export const AUTOMATION_NONE: Automation = GUILD_RANKS[0];
/** @deprecated Use `rankByName('journeyman')` or {@link GUILD_RANKS} (#1195). */
export const AUTOMATION_HARVEST: Automation = GUILD_RANKS[1];
/** @deprecated Use `rankByName('master')` or {@link GUILD_RANKS} (#1195). */
export const AUTOMATION_WORKSHOP: Automation = GUILD_RANKS[2];
/** @deprecated Use `rankByName('artificer')` or {@link GUILD_RANKS} (#1195). */
export const AUTOMATION_FULL: Automation = GUILD_RANKS[3];

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
