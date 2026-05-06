import * as Phaser from 'phaser';

const REGISTRY_KEY = 'projectSystem';
const LS_KEY = 'matlu_projects';

/** Emitted on game.events when pinned projects change. */
export const PROJECTS_CHANGED = 'projects-changed';

export interface PinnedProject {
  recipeId: string;
  recipeName: string;
  /** Total raw materials needed (aggregated across dependency chain). */
  totalNeeded: { item: string; qty: number }[];
  /** Number of crafting steps remaining. */
  stepsRemaining: number;
  /** Next station required (null if field-craftable). */
  nextStation: string | null;
}

interface ProjectSave {
  pinned: string[]; // recipe IDs
}

interface ProjectRecipe {
  id: string;
  name: string;
  output: { item: string; qty: number };
  inputs: { item: string; qty: number }[];
  station: string | null;
}

/**
 * ProjectSystem — tracks pinned recipe goals ("Working Toward").
 *
 * Max 3 pinned projects. First one is "primary" (shown on HUD).
 * Computes dependency chain and aggregates raw material needs.
 *
 * Access from any scene:
 *   const proj = this.game.registry.get('projectSystem') as ProjectSystem;
 */
export class ProjectSystem {
  private readonly game: Phaser.Game;
  /** Pinned recipe IDs (max 3, index 0 = primary). */
  private pinnedIds: string[] = [];
  /** Full recipe list for dependency resolution. */
  private recipes: ProjectRecipe[] = [];

  constructor(scene: Phaser.Scene) {
    this.game = scene.game;
    this._restoreFromStorage();
    this.game.registry.set(REGISTRY_KEY, this);
    this.game.events.once(Phaser.Core.Events.DESTROY, () => this._persist());
  }

  loadRecipes(recipes: ProjectRecipe[]): void {
    this.recipes = recipes;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Pin a recipe as a project goal. Returns false if already at max or duplicate. */
  pin(recipeId: string): boolean {
    if (this.pinnedIds.length >= 3) return false;
    if (this.pinnedIds.includes(recipeId)) return false;
    this.pinnedIds.push(recipeId);
    this._persist();
    this.game.events.emit(PROJECTS_CHANGED);
    return true;
  }

  /** Unpin a project. */
  unpin(recipeId: string): void {
    this.pinnedIds = this.pinnedIds.filter(id => id !== recipeId);
    this._persist();
    this.game.events.emit(PROJECTS_CHANGED);
  }

  /** Check if a recipe is pinned. */
  isPinned(recipeId: string): boolean {
    return this.pinnedIds.includes(recipeId);
  }

  /** Get all pinned recipe IDs. */
  getPinnedIds(): string[] {
    return [...this.pinnedIds];
  }

  /** Get the primary (first) pinned project with computed details. */
  getPrimary(inventoryQty: (id: string) => number): PinnedProject | null {
    if (this.pinnedIds.length === 0) return null;
    return this.getProjectDetails(this.pinnedIds[0], inventoryQty);
  }

  /** Compute full project details for a pinned recipe. */
  getProjectDetails(recipeId: string, inventoryQty: (id: string) => number): PinnedProject | null {
    const recipe = this.recipes.find(r => r.id === recipeId);
    if (!recipe) return null;

    // Walk dependency tree to compute total raw materials needed
    const totalNeeded = new Map<string, number>();
    let steps = 0;
    let nextStation: string | null = null;

    const walk = (itemId: string, qty: number) => {
      const r = this.recipes.find(rr => rr.id === itemId || rr.output.item === itemId);

      if (!r) {
        // Raw material — no recipe to craft it
        totalNeeded.set(itemId, (totalNeeded.get(itemId) ?? 0) + qty);
        return;
      }

      const have = inventoryQty(itemId);
      if (have >= qty) return; // Already have enough

      steps++;
      if (!nextStation && r.station) nextStation = r.station;

      const needToCraft = qty - have;
      const outputQty = r.output.qty;
      const batches = Math.ceil(needToCraft / outputQty);

      for (const input of r.inputs) {
        walk(input.item, input.qty * batches);
      }
    };

    for (const input of recipe.inputs) {
      walk(input.item, input.qty);
    }

    // Check if we need the final craft step itself
    const haveOutput = inventoryQty(recipe.id);
    if (haveOutput === 0) {
      steps++;
      if (!nextStation && recipe.station) nextStation = recipe.station;
    }

    return {
      recipeId,
      recipeName: recipe.name,
      totalNeeded: [...totalNeeded.entries()].map(([item, qty]) => ({ item, qty })),
      stepsRemaining: steps,
      nextStation,
    };
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private _persist(): void {
    try {
      const save: ProjectSave = { pinned: this.pinnedIds };
      localStorage.setItem(LS_KEY, JSON.stringify(save));
    } catch { /* */ }
  }

  private _restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const save = JSON.parse(raw) as Partial<ProjectSave>;
      if (save.pinned) this.pinnedIds = save.pinned;
    } catch { /* */ }
  }
}
