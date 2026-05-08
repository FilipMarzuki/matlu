/**
 * BaseManager — player base placement system.
 *
 * Tracks the player's placed structures (campfire, workbench, storage chest,
 * palisade walls, etc.). Structures are persistent (localStorage) and consume
 * items from inventory when placed.
 *
 * The base starts when the player places their first campfire, which establishes
 * an anchor point. All structures must be within a radius of the anchor.
 * Upgrading the main shelter increases the tier, radius, and max structure count.
 *
 * ## Tier progression
 * | Tier | Shelter      | Radius | Max |
 * |------|-------------|--------|-----|
 * | 0    | campfire     | 4      | 3   |
 * | 1    | lean-to      | 6      | 6   |
 * | 2    | tent         | 8      | 10  |
 * | 3    | cottage/yurt | 12     | 16  |
 * | 4    | longhouse    | 16     | 24  |
 * | 5    | mech-dock    | 20     | 32  |
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface PlacedStructure {
  itemId: string;
  tx: number;
  ty: number;
  placedAt: number;
}

export interface BaseState {
  anchorX: number;
  anchorY: number;
  tier: number;
  mainShelter: string;
  structures: PlacedStructure[];
}

export type PlacementResult =
  | { ok: true }
  | { ok: false; reason: 'no-anchor' | 'out-of-range' | 'overlap' | 'full' | 'no-item' };

// ── Tier config ─────────────────────────────────────────────────────────────

interface TierConfig {
  radius: number;
  maxStructures: number;
}

/**
 * Shelter items that define each tier. The player upgrades by placing a higher
 * tier shelter — it replaces the previous one (old shelter returned to inventory).
 */
const TIER_SHELTERS: Record<number, string[]> = {
  0: ['campfire'],
  1: ['lean-to'],
  2: ['tent'],
  3: ['cottage'],
  4: ['longhouse'],
  5: ['struct-mech-dock'],
};

const TIER_CONFIG: TierConfig[] = [
  { radius: 4,  maxStructures: 3 },
  { radius: 6,  maxStructures: 6 },
  { radius: 8,  maxStructures: 10 },
  { radius: 12, maxStructures: 16 },
  { radius: 16, maxStructures: 24 },
  { radius: 20, maxStructures: 32 },
];

// ── Persistence ─────────────────────────────────────────────────────────────

const LS_KEY = 'matlu_base';
const REG_KEY = 'base_state';

// ── Events ──────────────────────────────────────────────────────────────────

export const BASE_EVENTS = {
  ESTABLISHED:          'base:established',
  STRUCTURE_PLACED:     'base:structure-placed',
  STRUCTURE_DISMANTLED: 'base:structure-dismantled',
  TIER_CHANGED:         'base:tier-changed',
  FULL:                 'base:full',
} as const;

// ── Manager ─────────────────────────────────────────────────────────────────

export class BaseManager {
  private state: BaseState | null = null;
  private emitter: Phaser.Events.EventEmitter | null = null;

  constructor(private game: Phaser.Game) {
    this._restore();
  }

  /** Attach to a scene's event bus for emitting placement events. */
  setEmitter(emitter: Phaser.Events.EventEmitter): void {
    this.emitter = emitter;
  }

  // ── Queries ───────────────────────────────────────────────────────────

  isEstablished(): boolean { return this.state !== null; }

  getState(): Readonly<BaseState> | null { return this.state; }

  getStructures(): readonly PlacedStructure[] { return this.state?.structures ?? []; }

  getTier(): number { return this.state?.tier ?? 0; }

  getRadius(): number {
    const tier = this.getTier();
    return TIER_CONFIG[Math.min(tier, TIER_CONFIG.length - 1)].radius;
  }

  getMaxStructures(): number {
    const tier = this.getTier();
    return TIER_CONFIG[Math.min(tier, TIER_CONFIG.length - 1)].maxStructures;
  }

  getAnchor(): { x: number; y: number } | null {
    return this.state ? { x: this.state.anchorX, y: this.state.anchorY } : null;
  }

  // ── Establish ─────────────────────────────────────────────────────────

  /** Place the first campfire to establish the base anchor. */
  establish(worldX: number, worldY: number): void {
    this.state = {
      anchorX: worldX,
      anchorY: worldY,
      tier: 0,
      mainShelter: 'campfire',
      structures: [{ itemId: 'campfire', tx: 0, ty: 0, placedAt: Date.now() }],
    };
    this._persist();
    this.emitter?.emit(BASE_EVENTS.ESTABLISHED, { x: worldX, y: worldY });
  }

  // ── Placement validation ──────────────────────────────────────────────

  canPlace(_itemId: string, tx: number, ty: number): PlacementResult {
    if (!this.state) return { ok: false, reason: 'no-anchor' };

    // Range check (Chebyshev distance for tile grid)
    const r = this.getRadius();
    if (Math.abs(tx) > r || Math.abs(ty) > r) return { ok: false, reason: 'out-of-range' };

    // Overlap check (simple: same tile)
    if (this.state.structures.some(s => s.tx === tx && s.ty === ty)) {
      return { ok: false, reason: 'overlap' };
    }

    // Cap check
    if (this.state.structures.length >= this.getMaxStructures()) {
      return { ok: false, reason: 'full' };
    }

    return { ok: true };
  }

  /**
   * Place a structure at the given tile offset from the anchor.
   * Does NOT consume from inventory — the caller (forge scene or game scene)
   * handles item consumption so it can be tested without a live inventory.
   */
  place(itemId: string, tx: number, ty: number): PlacementResult {
    const check = this.canPlace(itemId, tx, ty);
    if (!check.ok) {
      if (check.reason === 'full') this.emitter?.emit(BASE_EVENTS.FULL);
      return check;
    }

    const struct: PlacedStructure = { itemId, tx, ty, placedAt: Date.now() };
    this.state!.structures.push(struct);

    // Check if this is a shelter upgrade
    const shelterTier = this._shelterTier(itemId);
    if (shelterTier > this.state!.tier) {
      this.state!.tier = shelterTier;
      this.state!.mainShelter = itemId;
      this.emitter?.emit(BASE_EVENTS.TIER_CHANGED, { tier: shelterTier, shelter: itemId });
    }

    this._persist();
    this.emitter?.emit(BASE_EVENTS.STRUCTURE_PLACED, { itemId, tx, ty });
    return { ok: true };
  }

  // ── Dismantle ─────────────────────────────────────────────────────────

  /**
   * Remove the structure at (tx, ty). Returns the item id so the caller
   * can return it to inventory, or null if no structure was there.
   */
  dismantle(tx: number, ty: number): string | null {
    if (!this.state) return null;
    const idx = this.state.structures.findIndex(s => s.tx === tx && s.ty === ty);
    if (idx < 0) return null;

    const [removed] = this.state.structures.splice(idx, 1);

    // If dismantling the main shelter, downgrade tier
    if (removed.itemId === this.state.mainShelter) {
      this._recalcTier();
    }

    // If last structure removed, destroy the base entirely
    if (this.state.structures.length === 0) {
      this.state = null;
      this._persist();
      return removed.itemId;
    }

    this._persist();
    this.emitter?.emit(BASE_EVENTS.STRUCTURE_DISMANTLED, { itemId: removed.itemId, tx, ty });
    return removed.itemId;
  }

  // ── Reset ─────────────────────────────────────────────────────────────

  /** Completely wipe the base (for testing / new game). */
  reset(): void {
    this.state = null;
    this._persist();
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private _shelterTier(itemId: string): number {
    for (const [tier, ids] of Object.entries(TIER_SHELTERS)) {
      if (ids.includes(itemId)) return parseInt(tier, 10);
    }
    return -1; // not a shelter
  }

  private _recalcTier(): void {
    if (!this.state) return;
    let maxTier = 0;
    let shelter = 'campfire';
    for (const s of this.state.structures) {
      const t = this._shelterTier(s.itemId);
      if (t > maxTier) { maxTier = t; shelter = s.itemId; }
    }
    if (maxTier !== this.state.tier) {
      this.state.tier = maxTier;
      this.state.mainShelter = shelter;
      this.emitter?.emit(BASE_EVENTS.TIER_CHANGED, { tier: maxTier, shelter });
    }
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private _persist(): void {
    const data = this.state ? JSON.stringify(this.state) : '';
    try {
      this.game.registry.set(REG_KEY, data);
      localStorage.setItem(LS_KEY, data);
    } catch { /* fail silently */ }
  }

  private _restore(): void {
    try {
      // Try game registry first (survives scene transitions)
      const reg = this.game.registry.get(REG_KEY) as string | undefined;
      if (reg) { this.state = JSON.parse(reg); return; }

      // Fall back to localStorage (survives page reloads)
      const ls = localStorage.getItem(LS_KEY);
      if (ls) {
        this.state = JSON.parse(ls);
        this.game.registry.set(REG_KEY, ls);
      }
    } catch {
      this.state = null;
    }
  }
}
