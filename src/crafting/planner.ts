import type { Inventory } from './Inventory';
import type { HarvestSource, Recipe } from './ActionQueue';

export interface Automation {
  mayHarvest: boolean;
  mayCraftSubgoals: boolean;
  maxDepth: number;
}

export const AUTOMATION_NONE: Automation = { mayHarvest: false, mayCraftSubgoals: false, maxDepth: 0 };
export const AUTOMATION_HARVEST: Automation = { mayHarvest: true, mayCraftSubgoals: false, maxDepth: 0 };
export const AUTOMATION_WORKSHOP: Automation = { mayHarvest: true, mayCraftSubgoals: true, maxDepth: 1 };
export const AUTOMATION_FULL: Automation = { mayHarvest: true, mayCraftSubgoals: true, maxDepth: Infinity };

export type PlanStep =
  | { kind: 'craft' }
  | { kind: 'harvest'; sourceId: string; itemId: string }
  | { kind: 'subgoal'; recipeId: string; itemId: string }
  | { kind: 'blocked'; itemId: string; reason: 'no-source' | 'automation' | 'depth' | 'cycle' };

export function nextStep(
  _goal: { recipeId: string; depth: number },
  _inventory: Pick<Inventory, 'has' | 'getQty'>,
  _recipes: Recipe[],
  _sources: HarvestSource[],
  _automation: Automation,
  _ancestry: string[] = [],
): PlanStep {
  throw new Error('not implemented');
}
