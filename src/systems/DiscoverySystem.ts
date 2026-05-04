import * as Phaser from 'phaser';

const REGISTRY_KEY = 'discoverySystem';
const LS_KEY = 'matlu_discovery';

/** Emitted on game.events when a recipe is discovered. Payload: recipeId, method. */
export const RECIPE_DISCOVERED = 'recipe-discovered';

// ── Types ────────────────────────────────────────────────────────────────────

export type DiscoveryMethod =
  | 'innate'
  | 'memory'
  | 'observation'
  | 'taught'
  | 'reverse-engineer'
  | 'experiment';

/** Per-recipe visibility state. */
export type RecipeState = 'undiscovered' | 'hint-visible' | 'discovered';

export interface RecipeDiscoveryDef {
  method: DiscoveryMethod;
  /** For memory: "gather:herb-green:5", "craft:any:10", "hunt:any:5", etc. */
  trigger?: string;
  /** For taught: "npc:village-smith", etc. */
  source?: string;
}

interface DiscoverySave {
  /** Recipe IDs the player has discovered. */
  discovered: string[];
  /** Action counters: "gather:herb-green" → 7, "craft:any" → 12, etc. */
  counters: Record<string, number>;
  /** Observation/interaction flags: "inspect:animal-trail" → true. */
  flags: Record<string, boolean>;
}

/**
 * DiscoverySystem — gates which recipes the player can see and craft.
 *
 * Tracks:
 *  - Per-recipe state: undiscovered / hint-visible / discovered
 *  - Action counters for memory triggers (gather, craft, hunt, status, weather)
 *  - Interaction flags for observation triggers (inspect:<object>)
 *  - NPC taught flags
 *
 * Innate recipes are auto-discovered on load. Other methods unlock when
 * their trigger conditions are met — call recordAction() / recordFlag()
 * from game systems as they come online.
 *
 * Access from any scene:
 *   const disc = this.game.registry.get('discoverySystem') as DiscoverySystem;
 */
export class DiscoverySystem {
  private readonly game: Phaser.Game;

  /** Set of discovered recipe IDs. */
  private discovered: Set<string> = new Set();
  /** Action counters: key → count. Key format: "gather:herb-green", "craft:any". */
  private counters: Map<string, number> = new Map();
  /** Boolean flags: key → true. Key format: "inspect:animal-trail", "npc:village-smith". */
  private flags: Set<string> = new Set();

  /** Recipe definitions loaded from recipes.json — maps recipeId → discovery def. */
  private recipeDefs: Map<string, RecipeDiscoveryDef> = new Map();

  constructor(scene: Phaser.Scene) {
    this.game = scene.game;
    this._restoreFromStorage();
    this.game.registry.set(REGISTRY_KEY, this);
    this.game.events.once(Phaser.Core.Events.DESTROY, () => this._persist());
  }

  // ── Recipe definitions ──────────────────────────────────────────────────────

  /**
   * Load recipe discovery definitions. Call after fetching recipes.json.
   * Automatically discovers all innate recipes.
   */
  loadRecipeDefs(recipes: { id: string; discovery?: RecipeDiscoveryDef }[]): void {
    for (const r of recipes) {
      if (r.discovery) {
        this.recipeDefs.set(r.id, r.discovery);
        // Auto-discover innate recipes
        if (r.discovery.method === 'innate') {
          this.discovered.add(r.id);
        }
      }
    }
    this._persist();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Get the visibility state of a recipe. */
  getState(recipeId: string): RecipeState {
    if (this.discovered.has(recipeId)) return 'discovered';

    // Check if the player has enough context for a hint (related concept
    // known, or visited the right station). For now, all non-discovered
    // non-innate recipes show as hint-visible so the player knows something
    // exists but can't use it yet.
    if (this.recipeDefs.has(recipeId)) return 'hint-visible';

    return 'undiscovered';
  }

  /** Check if a recipe is fully discovered (can be crafted). */
  isDiscovered(recipeId: string): boolean {
    return this.discovered.has(recipeId);
  }

  /** Directly discover a recipe (e.g. from experiment mode or cheat). */
  discover(recipeId: string, method: DiscoveryMethod = 'experiment'): void {
    if (this.discovered.has(recipeId)) return;
    this.discovered.add(recipeId);
    this._persist();
    this.game.events.emit(RECIPE_DISCOVERED, recipeId, method);
  }

  /**
   * Record a player action and check if any memory-based recipes unlock.
   *
   * @param action Action key, e.g. "gather:herb-green", "craft:rope", "hunt:wolf"
   * @returns Array of newly discovered recipe IDs (may be empty).
   */
  recordAction(action: string): string[] {
    const current = this.counters.get(action) ?? 0;
    this.counters.set(action, current + 1);

    // Also increment "any" variant: "gather:herb-green" → also count "gather:any"
    const parts = action.split(':');
    if (parts.length >= 2 && parts[1] !== 'any') {
      const anyKey = `${parts[0]}:any`;
      const anyCurrent = this.counters.get(anyKey) ?? 0;
      this.counters.set(anyKey, anyCurrent + 1);
    }

    this._persist();
    return this._checkMemoryTriggers();
  }

  /**
   * Record an interaction flag (observation, NPC, disassemble).
   *
   * @param flag Flag key, e.g. "inspect:animal-trail", "npc:village-smith",
   *             "disassemble:goblin-smoke-pot"
   * @returns Array of newly discovered recipe IDs.
   */
  recordFlag(flag: string): string[] {
    this.flags.add(flag);
    this._persist();
    return this._checkFlagTriggers(flag);
  }

  /**
   * Experiment mode: try a combination of items at a station.
   * If it matches an undiscovered experiment-type recipe, discover it.
   * Returns the recipe ID if found, null otherwise.
   * Does NOT consume materials on failure.
   */
  tryExperiment(itemIds: string[], allRecipes: { id: string; inputs: { item: string; qty: number }[] }[]): string | null {
    const inputSet = new Set(itemIds);

    for (const recipe of allRecipes) {
      // Skip already discovered
      if (this.discovered.has(recipe.id)) continue;

      // Must be an experiment-type recipe
      const def = this.recipeDefs.get(recipe.id);
      if (!def || def.method !== 'experiment') continue;

      // Check if the input items match
      const recipeInputIds = new Set(recipe.inputs.map(i => i.item));
      if (recipeInputIds.size !== inputSet.size) continue;

      let match = true;
      for (const id of recipeInputIds) {
        if (!inputSet.has(id)) { match = false; break; }
      }
      if (match) {
        this.discover(recipe.id, 'experiment');
        return recipe.id;
      }
    }
    return null;
  }

  /** Get the current count for an action key. */
  getCounter(action: string): number {
    return this.counters.get(action) ?? 0;
  }

  /** Check if a flag has been recorded. */
  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  // ── Trigger checking ────────────────────────────────────────────────────────

  /** Check all memory-triggered recipes against current counters. */
  private _checkMemoryTriggers(): string[] {
    const newlyDiscovered: string[] = [];

    for (const [recipeId, def] of this.recipeDefs) {
      if (def.method !== 'memory' || !def.trigger) continue;
      if (this.discovered.has(recipeId)) continue;

      // Parse trigger: "gather:herb-green:5" → key="gather:herb-green", threshold=5
      const parts = def.trigger.split(':');
      if (parts.length < 3) continue;
      const threshold = parseInt(parts[parts.length - 1], 10);
      const key = parts.slice(0, -1).join(':');

      const current = this.counters.get(key) ?? 0;
      if (current >= threshold) {
        this.discovered.add(recipeId);
        newlyDiscovered.push(recipeId);
        this.game.events.emit(RECIPE_DISCOVERED, recipeId, 'memory');
      }
    }

    if (newlyDiscovered.length > 0) this._persist();
    return newlyDiscovered;
  }

  /** Check flag-triggered recipes (observation, taught, reverse-engineer). */
  private _checkFlagTriggers(flag: string): string[] {
    const newlyDiscovered: string[] = [];

    for (const [recipeId, def] of this.recipeDefs) {
      if (this.discovered.has(recipeId)) continue;

      // Observation: trigger matches flag
      if (def.method === 'observation' && def.trigger === flag) {
        this.discovered.add(recipeId);
        newlyDiscovered.push(recipeId);
        this.game.events.emit(RECIPE_DISCOVERED, recipeId, 'observation');
      }

      // Taught: source matches flag
      if (def.method === 'taught' && def.source === flag) {
        this.discovered.add(recipeId);
        newlyDiscovered.push(recipeId);
        this.game.events.emit(RECIPE_DISCOVERED, recipeId, 'taught');
      }

      // Reverse-engineer: trigger matches flag
      if (def.method === 'reverse-engineer' && def.trigger === flag) {
        this.discovered.add(recipeId);
        newlyDiscovered.push(recipeId);
        this.game.events.emit(RECIPE_DISCOVERED, recipeId, 'reverse-engineer');
      }
    }

    if (newlyDiscovered.length > 0) this._persist();
    return newlyDiscovered;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private _persist(): void {
    try {
      const save: DiscoverySave = {
        discovered: [...this.discovered],
        counters: Object.fromEntries(this.counters),
        flags: Object.fromEntries([...this.flags].map(f => [f, true])),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(save));
    } catch {
      // localStorage unavailable.
    }
  }

  private _restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const save = JSON.parse(raw) as Partial<DiscoverySave>;
      if (save.discovered) this.discovered = new Set(save.discovered);
      if (save.counters) {
        for (const [k, v] of Object.entries(save.counters)) {
          if (typeof v === 'number') this.counters.set(k, v);
        }
      }
      if (save.flags) {
        for (const k of Object.keys(save.flags)) {
          this.flags.add(k);
        }
      }
    } catch {
      // Corrupt save — start fresh.
    }
  }
}
