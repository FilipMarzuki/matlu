/**
 * Discovery — which recipes the player has worked out, and how they work out more (#1515).
 *
 * Phaser-free, so the rules can be unit-tested; `DiscoverySystem` wraps this for the scenes,
 * saving to localStorage and announcing each discovery as a game event.
 *
 * A recipe is discovered by one of the methods in its `discovery` def (recipes.json):
 *   - **innate**: known from the start.
 *   - **memory**: a counter reaches a threshold, e.g. `gather:herb-green:5`. Counters come from
 *     `recordAction('gather:herb-green')`, which also bumps `gather:any`.
 *   - **observation**, **taught**, **reverse-engineer**: a flag is recorded, e.g.
 *     `recordFlag('inspect:animal-trail')` or `recordFlag('npc:village-smith')`.
 *   - **experiment**: the player tries exactly the recipe's inputs together (`tryExperiment`).
 */

export type DiscoveryMethod = 'innate' | 'memory' | 'observation' | 'taught' | 'reverse-engineer' | 'experiment';

/** Per-recipe visibility: hidden, shown as a hint ("practice more…"), or known and craftable. */
export type RecipeState = 'undiscovered' | 'hint-visible' | 'discovered';

export interface RecipeDiscoveryDef {
  method: DiscoveryMethod;
  /** For memory: "gather:herb-green:5", "craft:any:10"; for observation/reverse-engineer: the flag. */
  trigger?: string;
  /** For taught: "npc:village-smith", etc. */
  source?: string;
}

/** What gets saved: plain JSON, so it survives localStorage. */
export interface DiscoverySave {
  discovered: string[];
  counters: Record<string, number>;
  flags: Record<string, boolean>;
}

/** A recipe as `tryExperiment` needs it. */
interface ExperimentRecipe { id: string; inputs: readonly { item: string }[] }

/**
 * The actions one harvest records: `gather:<item>` once per item it yields, however many came.
 * Memory triggers count how often you've done something, not how much you got.
 */
export const gatherActions = <Y extends { itemId: string }>(yields: readonly Y[]): string[] =>
  [...new Set(yields.map(y => `gather:${y.itemId}`))];

export class Discovery {
  private discovered = new Set<string>();
  private counters = new Map<string, number>();
  private flags = new Set<string>();
  private recipeDefs = new Map<string, RecipeDiscoveryDef>();

  /** Told about every discovery after the innate ones (DiscoverySystem emits it as a game event). */
  onFound: (recipeId: string, method: DiscoveryMethod) => void = () => {};

  /** Rebuild from a save; anything malformed starts that part fresh. */
  static fromSave(raw: unknown): Discovery {
    const d = new Discovery();
    if (typeof raw !== 'object' || raw === null) return d;
    const s = raw as Partial<Record<keyof DiscoverySave, unknown>>;
    if (Array.isArray(s.discovered)) for (const id of s.discovered) if (typeof id === 'string') d.discovered.add(id);
    if (typeof s.counters === 'object' && s.counters !== null) {
      for (const [k, v] of Object.entries(s.counters)) if (typeof v === 'number') d.counters.set(k, v);
    }
    if (typeof s.flags === 'object' && s.flags !== null) for (const k of Object.keys(s.flags)) d.flags.add(k);
    return d;
  }

  toSave(): DiscoverySave {
    return {
      discovered: [...this.discovered],
      counters: Object.fromEntries(this.counters),
      flags: Object.fromEntries([...this.flags].map(f => [f, true])),
    };
  }

  /**
   * Load the recipes' discovery defs (recipes.json, `_tier` headers and all: entries without a
   * def are skipped). Innate recipes become known quietly. Then counters and flags recorded
   * before the defs arrived are checked, so gathering before the crafting menu first opens still
   * counts. Returns what that check discovered.
   */
  loadRecipeDefs(recipes: readonly { id?: string; discovery?: RecipeDiscoveryDef }[]): string[] {
    for (const r of recipes) {
      if (typeof r.id !== 'string' || !r.discovery) continue;
      this.recipeDefs.set(r.id, r.discovery);
      if (r.discovery.method === 'innate') this.discovered.add(r.id);
    }
    return [...this.checkMemory(), ...[...this.flags].flatMap(f => this.checkFlag(f))];
  }

  getState(recipeId: string): RecipeState {
    if (this.discovered.has(recipeId)) return 'discovered';
    // Every recipe with a def shows as a hint until it's worked out, so the player knows it exists.
    return this.recipeDefs.has(recipeId) ? 'hint-visible' : 'undiscovered';
  }

  isDiscovered(recipeId: string): boolean {
    return this.discovered.has(recipeId);
  }

  /** Discover a recipe directly. False if it was already known. */
  discover(recipeId: string, method: DiscoveryMethod = 'experiment'): boolean {
    if (this.discovered.has(recipeId)) return false;
    this.discovered.add(recipeId);
    this.onFound(recipeId, method);
    return true;
  }

  /** Count an action ("gather:herb-green", "craft:rope") and return any memory recipes it unlocks. */
  recordAction(action: string): string[] {
    this.counters.set(action, (this.counters.get(action) ?? 0) + 1);
    // "gather:herb-green" also counts toward "gather:any".
    const [kind, what] = action.split(':');
    if (what !== undefined && what !== 'any') this.counters.set(`${kind}:any`, (this.counters.get(`${kind}:any`) ?? 0) + 1);
    return this.checkMemory();
  }

  /** Record a flag ("inspect:animal-trail", "npc:village-smith") and return what it unlocks. */
  recordFlag(flag: string): string[] {
    this.flags.add(flag);
    return this.checkFlag(flag);
  }

  /**
   * Try a set of items together. If they're exactly the inputs of an undiscovered experiment
   * recipe (any order, quantities aside), that recipe is discovered and returned; otherwise null.
   * Nothing is used up either way.
   */
  tryExperiment(itemIds: readonly string[], recipes: readonly ExperimentRecipe[]): string | null {
    const tried = new Set(itemIds);
    for (const r of recipes) {
      if (this.discovered.has(r.id) || this.recipeDefs.get(r.id)?.method !== 'experiment') continue;
      const needs = new Set(r.inputs.map(i => i.item));
      if (needs.size === tried.size && [...needs].every(i => tried.has(i))) {
        this.discover(r.id, 'experiment');
        return r.id;
      }
    }
    return null;
  }

  getCounter(action: string): number {
    return this.counters.get(action) ?? 0;
  }

  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  /** Memory recipes whose counter has reached its threshold ("gather:herb-green:5"). */
  private checkMemory(): string[] {
    const found: string[] = [];
    for (const [id, def] of this.recipeDefs) {
      if (def.method !== 'memory' || !def.trigger || this.discovered.has(id)) continue;
      const parts = def.trigger.split(':');
      if (parts.length < 3) continue;
      const threshold = Number(parts.at(-1));
      if ((this.counters.get(parts.slice(0, -1).join(':')) ?? 0) >= threshold && this.discover(id, 'memory')) found.push(id);
    }
    return found;
  }

  /** Observation and reverse-engineer recipes whose trigger is this flag; taught ones whose source is. */
  private checkFlag(flag: string): string[] {
    const found: string[] = [];
    for (const [id, def] of this.recipeDefs) {
      if (this.discovered.has(id)) continue;
      const hit = ((def.method === 'observation' || def.method === 'reverse-engineer') && def.trigger === flag)
        || (def.method === 'taught' && def.source === flag);
      if (hit && this.discover(id, def.method)) found.push(id);
    }
    return found;
  }
}
