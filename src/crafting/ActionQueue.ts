import type { Inventory } from './Inventory';
import type { ResourceNodeYield, ActionOutcome } from './actions';

export interface HarvestSource { id: string; label: string; yields: ResourceNodeYield[]; durationTicks: number }
export interface Recipe {
  id: string; name: string;
  inputs: { item: string; qty: number }[];
  output: { item: string; qty: number };
  timeBase: number;
}
export type ActionKind = 'harvest' | 'craft';
export interface QueuedAction { kind: ActionKind; target: string; label: string; durationTicks: number; elapsed: number }
export interface ActionQueueDeps { inventory: Inventory; rng: () => number; sources: HarvestSource[]; recipes: Recipe[] }

export class ActionQueue {
  constructor(_deps: ActionQueueDeps) {}
  get entries(): readonly QueuedAction[] { throw new Error('not implemented'); }
  enqueueHarvest(_sourceId: string): boolean { throw new Error('not implemented'); }
  enqueueCraft(_recipeId: string): boolean { throw new Error('not implemented'); }
  tick(_n = 1): ActionOutcome[] { throw new Error('not implemented'); }
  skipToNextCompletion(): ActionOutcome[] { throw new Error('not implemented'); }
}
