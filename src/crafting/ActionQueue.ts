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
import { resolveHarvest, type ActionContext, type ResourceNodeYield, type ActionOutcome } from './actions';
import { nextStep, rankByName, type Automation, type PlanStep } from './planner';

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

/**
 * `goal` is a sub-action (#1185): "make a plank", with the queue working out
 * the harvests and intermediate crafts itself. It never consumes ticks — when
 * it reaches the head it asks the planner for one step and either becomes a
 * craft or pushes a harvest / sub-goal in front of itself and waits.
 */
export type ActionKind = 'harvest' | 'craft' | 'goal';

export interface QueuedAction {
  kind: ActionKind;
  /** HarvestSource id or Recipe id. */
  target: string;
  /** Display label, e.g. "Harvest Pine" / "Craft Plank" / "Make Plank". */
  label: string;
  durationTicks: number;
  /** Ticks already spent on this action (only the head entry advances). */
  elapsed: number;
  // ── goal-only fields (#1185) ────────────────────────────────────────────
  /** Recipe the goal will eventually craft. */
  recipeId?: string;
  /** How many sub-goal levels above this one (0 = what the player queued). */
  depth?: number;
  /** Recipe ids of the goals this one is a sub-goal of (cycle detection). */
  ancestry?: string[];
  /** What the goal is waiting on right now, e.g. "harvesting Oak". */
  subStep?: string;
}

export interface ActionQueueDeps {
  inventory: Inventory;
  /** Float in [0, 1) — pass a seeded generator for reproducible runs. */
  rng: () => number;
  sources: HarvestSource[];
  recipes: Recipe[];
  /** Restore a previously saved queue (see `entries`). */
  initialEntries?: QueuedAction[];
  /**
   * How much the queue may do on the player's behalf when expanding goals
   * (#1185). Defaults to none, in which case goals can't be queued at all.
   */
  automation?: Automation;
  /**
   * Called when an action resolves, to supply the current world conditions
   * (yield multiplier, season, …). Keeps the queue ignorant of where they
   * come from — the sim passes a WorldFeed, tests pass a literal.
   */
  context?: () => Partial<ActionContext>;
}

export class ActionQueue {
  private readonly inventory: Inventory;
  private readonly rng: () => number;
  private readonly sources: Map<string, HarvestSource>;
  private readonly recipes: Map<string, Recipe>;
  private readonly context: () => Partial<ActionContext>;
  private readonly automation: Automation;
  private queue: QueuedAction[];

  constructor(deps: ActionQueueDeps) {
    this.inventory = deps.inventory;
    this.rng = deps.rng;
    this.sources = new Map(deps.sources.map(s => [s.id, s]));
    this.recipes = new Map(deps.recipes.map(r => [r.id, r]));
    this.context = deps.context ?? (() => ({}));
    this.automation = deps.automation ?? rankByName('apprentice');
    // Copy so a caller mutating its own array can't corrupt the queue.
    // `ancestry` is copied too — it's the one nested value a saved entry has.
    this.queue = (deps.initialEntries ?? []).map(e => ({ ...e, ...(e.ancestry ? { ancestry: [...e.ancestry] } : {}) }));
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
    const entry = this.reserveCraft(recipeId);
    if (!entry) return false;
    this.queue.push(entry);
    return true;
  }

  /**
   * Take the recipe's inputs out of the inventory and build the craft entry,
   * or return null (inventory untouched) if they aren't all there. Shared by
   * `enqueueCraft` and by goal expansion, so both reserve the same way.
   */
  private reserveCraft(recipeId: string): QueuedAction | null {
    const recipe = this.recipes.get(recipeId);
    if (!recipe || !this.canCraft(recipeId)) return null;
    for (const input of recipe.inputs) this.inventory.remove(input.item, input.qty);
    return {
      kind: 'craft',
      target: recipe.id,
      label: `Craft ${recipe.name}`,
      durationTicks: Math.max(1, recipe.timeBase),
      elapsed: 0,
    };
  }

  /**
   * Queue a goal: "make this recipe", with the harvests and intermediate
   * crafts worked out by the planner as the goal reaches the head (#1185).
   * Nothing is reserved yet — the goal reserves its own inputs the moment it
   * turns into a craft, so two queued goals can't double-spend. Returns false
   * for an unknown recipe, or when automation is off (the UI hides the
   * button in that case, since a goal with no automation can never expand).
   */
  enqueueGoal(recipeId: string): boolean {
    const recipe = this.recipes.get(recipeId);
    // By rank, not by identity (#1195): a copy of the Apprentice preset refuses goals too.
    if (!recipe || this.automation.rank === 'apprentice') return false;
    this.queue.push(this.goalEntry(recipe, 0, []));
    return true;
  }

  private goalEntry(recipe: Recipe, depth: number, ancestry: string[]): QueuedAction {
    return {
      kind: 'goal',
      target: recipe.id,
      label: `Make ${recipe.name}`,
      // A goal never spends ticks itself; 1 keeps `headProgress` finite.
      durationTicks: 1,
      elapsed: 0,
      recipeId: recipe.id,
      depth,
      ancestry,
    };
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
      // A goal at the head is expanded BEFORE any ticks are spent, so one
      // tick(1) on a fresh goal always lands on a real harvest or craft.
      this.expandHead(outcomes);
      if (this.queue.length === 0) break;
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
    const outcomes: ActionOutcome[] = [];
    this.expandHead(outcomes);
    if (this.queue.length > 0) outcomes.push(this.complete());
    return outcomes;
  }

  /**
   * While the head is a goal, ask the planner for its next step and act on
   * it. Loops because a sub-goal is itself a goal: "snare" pushes "rope",
   * which pushes "harvest meadow", all in the same call. Blocked goals are
   * dropped and reported as an outcome so the player sees why.
   */
  private expandHead(outcomes: ActionOutcome[]): void {
    while (this.queue.length > 0 && this.queue[0].kind === 'goal') {
      const goal = this.queue[0];
      const recipe = this.recipes.get(goal.recipeId ?? goal.target);
      const depth = goal.depth ?? 0;
      const ancestry = goal.ancestry ?? [];
      const step: PlanStep = recipe
        ? nextStep({ recipeId: recipe.id, depth }, this.inventory, [...this.recipes.values()], [...this.sources.values()], this.automation, ancestry)
        : { kind: 'blocked', itemId: goal.target, reason: 'no-source' };

      if (step.kind === 'craft') {
        // The planner only says craft when every input is present, so this
        // reservation succeeds; if the inventory changed under us, fall
        // through to a blocked outcome rather than loop forever.
        const entry = this.reserveCraft(recipe!.id);
        if (entry) {
          this.queue[0] = entry;
          return;
        }
        this.queue.shift();
        outcomes.push({ items: [], log: [`${goal.label}: blocked — inputs went missing`] });
        continue;
      }

      if (step.kind === 'harvest') {
        const src = this.sources.get(step.sourceId)!;
        goal.subStep = `harvesting ${src.label}`;
        this.queue.unshift({
          kind: 'harvest',
          target: src.id,
          label: `Harvest ${src.label}`,
          durationTicks: Math.max(1, src.durationTicks),
          elapsed: 0,
        });
        return;
      }

      if (step.kind === 'subgoal') {
        const sub = this.recipes.get(step.recipeId)!;
        goal.subStep = `making ${sub.name}`;
        // Keep looping: the sub-goal is now the head and expands in turn.
        this.queue.unshift(this.goalEntry(sub, depth + 1, [...ancestry, recipe!.id]));
        continue;
      }

      this.queue.shift();
      outcomes.push({ items: [], log: [`${recipe?.name ?? goal.target}: blocked — ${blockedReason(step)}`] });
    }
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
      // The rng is ours (seeded, for reproducible runs); everything else
      // about the world comes from the context callback.
      const outcome = resolveHarvest(src.yields, { ...this.context(), rng: this.rng });
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

/** Player-facing text for why a goal can't make progress. */
function blockedReason(step: Extract<PlanStep, { kind: 'blocked' }>): string {
  switch (step.reason) {
    case 'no-source': return `no source of ${step.itemId}`;
    case 'automation': return `${step.itemId} needs more automation than you have`;
    case 'depth': return `${step.itemId} is too many steps away`;
    case 'cycle': return `${step.itemId} would need itself to be made`;
  }
}
