/**
 * ActionQueue — the "queue an action, wait, get the result" loop of the
 * crafting sim (#1137).
 *
 * In Core Warden the player walks to a resource node and presses E; in the
 * sim they queue "Harvest pine" from a menu. Both resolve through the same
 * pure rules (`resolveHarvest`, the `Inventory`), so balance carries over.
 *
 * Time is driven by the caller in ticks — never by a real clock — so the sim
 * can run fast, pause, skip ahead, and tests stay deterministic. Randomness
 * comes in through `rng` for the same reason.
 *
 * No Phaser imports: this runs in unit tests and in the sim scene alike.
 */

import type { Inventory } from './Inventory';
import { resolveHarvest, type ResourceNodeYield, type ActionOutcome } from './actions';

/** Something the player can harvest from the menu (a resource node type). */
export interface HarvestSource {
  id: string;
  label: string;
  yields: ResourceNodeYield[];
  /** How many ticks the harvest takes. */
  durationTicks: number;
}

/** Subset of a macro-world/recipes.json entry the queue needs. */
export interface Recipe {
  id: string;
  name: string;
  inputs: { item: string; qty: number }[];
  output: { item: string; qty: number };
  /** Crafting time in ticks. */
  timeBase: number;
}

export type ActionKind = 'harvest' | 'craft';

export interface QueuedAction {
  kind: ActionKind;
  /** HarvestSource id or Recipe id. */
  target: string;
  /** Display label, e.g. "Harvest Pine" / "Craft Plank". */
  label: string;
  durationTicks: number;
  /** Ticks already spent on this action (only the head entry advances). */
  elapsed: number;
}

export interface ActionQueueDeps {
  inventory: Inventory;
  /** Float in [0, 1) — pass a seeded generator for reproducible runs. */
  rng: () => number;
  sources: HarvestSource[];
  recipes: Recipe[];
  /** Restore a previously saved queue (see `entries`). */
  initialEntries?: QueuedAction[];
}

export class ActionQueue {
  private readonly inventory: Inventory;
  private readonly rng: () => number;
  private readonly sources: Map<string, HarvestSource>;
  private readonly recipes: Map<string, Recipe>;
  private queue: QueuedAction[];

  constructor(deps: ActionQueueDeps) {
    this.inventory = deps.inventory;
    this.rng = deps.rng;
    this.sources = new Map(deps.sources.map(s => [s.id, s]));
    this.recipes = new Map(deps.recipes.map(r => [r.id, r]));
    // Copy so a caller mutating its own array can't corrupt the queue.
    this.queue = (deps.initialEntries ?? []).map(e => ({ ...e }));
  }

  /** Queued actions, head first. Read-only snapshot for rendering/saving. */
  get entries(): readonly QueuedAction[] {
    return this.queue;
  }

  /** Progress (0–1) of the head action, or 0 when the queue is empty. */
  get headProgress(): number {
    const head = this.queue[0];
    return head ? head.elapsed / head.durationTicks : 0;
  }

  /** Queue a harvest. Returns false if the source id is unknown. */
  enqueueHarvest(sourceId: string): boolean {
    const src = this.sources.get(sourceId);
    if (!src) return false;
    this.queue.push({
      kind: 'harvest',
      target: src.id,
      label: `Harvest ${src.label}`,
      durationTicks: Math.max(1, src.durationTicks),
      elapsed: 0,
    });
    return true;
  }

  /** Can this recipe be queued right now (inputs available)? */
  canCraft(recipeId: string): boolean {
    const recipe = this.recipes.get(recipeId);
    return !!recipe && recipe.inputs.every(i => this.inventory.has(i.item, i.qty));
  }

  /**
   * Queue a craft. Inputs are taken from the inventory *now* (reserved), so
   * two queued crafts can't both spend the same lumber. Returns false, with
   * the inventory untouched, if the inputs aren't available.
   */
  enqueueCraft(recipeId: string): boolean {
    const recipe = this.recipes.get(recipeId);
    if (!recipe || !this.canCraft(recipeId)) return false;
    for (const input of recipe.inputs) this.inventory.remove(input.item, input.qty);
    this.queue.push({
      kind: 'craft',
      target: recipe.id,
      label: `Craft ${recipe.name}`,
      durationTicks: Math.max(1, recipe.timeBase),
      elapsed: 0,
    });
    return true;
  }

  /**
   * Advance time by `n` ticks. Only the head action progresses; when it
   * completes, any leftover ticks carry into the next one, so `tick(10)` on
   * two 5-tick actions completes both. Returns the outcomes in order.
   */
  tick(n = 1): ActionOutcome[] {
    const outcomes: ActionOutcome[] = [];
    let remaining = n;
    while (remaining > 0 && this.queue.length > 0) {
      const head = this.queue[0];
      const needed = head.durationTicks - head.elapsed;
      if (remaining < needed) {
        head.elapsed += remaining;
        break;
      }
      remaining -= needed;
      outcomes.push(this.complete());
    }
    return outcomes;
  }

  /** Finish the head action immediately. The next action starts from 0. */
  skipToNextCompletion(): ActionOutcome[] {
    if (this.queue.length === 0) return [];
    return [this.complete()];
  }

  /** Pop the head, resolve it, apply the result to the inventory. */
  private complete(): ActionOutcome {
    const action = this.queue.shift()!;
    const outcome = this.resolve(action);
    for (const { itemId, qty } of outcome.items) {
      const added = this.inventory.add(itemId, qty);
      if (added < qty) outcome.log.push(`Pack full — lost ${qty - added} ${itemId}`);
    }
    return outcome;
  }

  private resolve(action: QueuedAction): ActionOutcome {
    if (action.kind === 'harvest') {
      const src = this.sources.get(action.target);
      // Source removed from the data since it was queued — nothing to give.
      if (!src) return { items: [], log: [`${action.label}: nothing found`] };
      const outcome = resolveHarvest(src.yields, { rng: this.rng });
      if (outcome.items.length === 0) outcome.log.push(`${action.label}: nothing found`);
      return outcome;
    }
    const recipe = this.recipes.get(action.target);
    if (!recipe) return { items: [], log: [`${action.label}: recipe unknown`] };
    // Inputs were already consumed at enqueue time.
    return {
      items: [{ itemId: recipe.output.item, qty: recipe.output.qty }],
      log: [`Crafted ${recipe.output.qty} ${recipe.name}`],
    };
  }
}
