import * as Phaser from 'phaser';
import { Discovery, gatherActions, type DiscoveryMethod, type RecipeDiscoveryDef, type RecipeState } from '../crafting/Discovery';
import { RESOURCE_GATHERED } from '../entities/ResourceNode';
import recipesJson from '../../public/macro-world/recipes.json';

export type { DiscoveryMethod, RecipeDiscoveryDef, RecipeState };

const REGISTRY_KEY = 'discoverySystem';
const LS_KEY = 'matlu_discovery';

/** Emitted on game.events when a recipe is discovered. Payload: recipeId, method. */
export const RECIPE_DISCOVERED = 'recipe-discovered';

/**
 * DiscoverySystem — gates which recipes the player can see and craft.
 *
 * The rules live in the Phaser-free `Discovery` (src/crafting/Discovery.ts, #1515); this class
 * puts one in the game registry, saves it to localStorage, announces each discovery as
 * RECIPE_DISCOVERED, and counts gathering: every ResourceNode harvest (RESOURCE_GATHERED) records
 * `gather:<item>`, so memory recipes like healing salve ("gather:herb-green:5") unlock. The
 * recipe defs are loaded from the bundled recipes.json up front, so that happens mid-gather.
 *
 * Access from any scene:
 *   const disc = this.game.registry.get('discoverySystem') as DiscoverySystem;
 */
export class DiscoverySystem {
  private readonly game: Phaser.Game;
  private readonly state: Discovery;

  constructor(scene: Phaser.Scene) {
    this.game = scene.game;
    this.state = Discovery.fromSave(this.readSave());
    // The bundled recipe defs go in now (#1529), so a gather that meets a memory trigger
    // discovers its recipe (and DiscoveryToast announces it) when it happens, not the next time
    // the crafting menu opens. Anything the saved counts already unlock is found quietly here.
    this.state.loadRecipeDefs(recipesJson.recipes as unknown as readonly { id?: string; discovery?: RecipeDiscoveryDef }[]);
    this.state.onFound = (id, method) => this.game.events.emit(RECIPE_DISCOVERED, id, method);
    this.game.registry.set(REGISTRY_KEY, this);

    const onGathered = (yields: { itemId: string }[]) => {
      for (const action of gatherActions(yields)) this.state.recordAction(action);
      this.persist();
    };
    this.game.events.on(RESOURCE_GATHERED, onGathered);
    this.game.events.once(Phaser.Core.Events.DESTROY, () => {
      this.game.events.off(RESOURCE_GATHERED, onGathered);
      this.persist();
    });
  }

  /**
   * The one DiscoverySystem for this game, made on first use. Scenes that gather or craft call
   * this up front, so gathering counts before the crafting menu is ever opened.
   */
  static of(scene: Phaser.Scene): DiscoverySystem {
    return (scene.game.registry.get(REGISTRY_KEY) as DiscoverySystem | undefined) ?? new DiscoverySystem(scene);
  }

  /**
   * Load recipe discovery definitions. Call after fetching recipes.json. Innate recipes become
   * known, and counts recorded before now are checked against the memory triggers.
   */
  loadRecipeDefs(recipes: readonly { id?: string; discovery?: RecipeDiscoveryDef }[]): void {
    this.state.loadRecipeDefs(recipes);
    this.persist();
  }

  getState(recipeId: string): RecipeState {
    return this.state.getState(recipeId);
  }

  /** Check if a recipe is fully discovered (can be crafted). */
  isDiscovered(recipeId: string): boolean {
    return this.state.isDiscovered(recipeId);
  }

  /** Directly discover a recipe (e.g. from experiment mode or cheat). */
  discover(recipeId: string, method: DiscoveryMethod = 'experiment'): void {
    if (this.state.discover(recipeId, method)) this.persist();
  }

  /**
   * Record a player action and check if any memory-based recipes unlock.
   *
   * @param action Action key, e.g. "gather:herb-green", "craft:rope", "hunt:wolf"
   * @returns Newly discovered recipe IDs (may be empty).
   */
  recordAction(action: string): string[] {
    const found = this.state.recordAction(action);
    this.persist();
    return found;
  }

  /**
   * Record an interaction flag (observation, NPC, disassemble).
   *
   * @param flag e.g. "inspect:animal-trail", "npc:village-smith", "disassemble:goblin-smoke-pot"
   * @returns Newly discovered recipe IDs.
   */
  recordFlag(flag: string): string[] {
    const found = this.state.recordFlag(flag);
    this.persist();
    return found;
  }

  /**
   * Experiment: try a set of items together. If they're exactly the inputs of an undiscovered
   * experiment recipe, it's discovered and its id returned; otherwise null. Uses nothing up.
   */
  tryExperiment(itemIds: readonly string[], allRecipes: readonly { id?: string; inputs?: readonly { item: string }[] }[]): string | null {
    const recipes = allRecipes.filter((r): r is { id: string; inputs: readonly { item: string }[] } => typeof r.id === 'string' && Array.isArray(r.inputs));
    const found = this.state.tryExperiment(itemIds, recipes);
    if (found) this.persist();
    return found;
  }

  getCounter(action: string): number {
    return this.state.getCounter(action);
  }

  hasFlag(flag: string): boolean {
    return this.state.hasFlag(flag);
  }

  private persist(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.state.toSave()));
    } catch {
      // localStorage unavailable.
    }
  }

  private readSave(): unknown {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null; // Corrupt save: start fresh.
    }
  }
}
