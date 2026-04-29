import * as Phaser from 'phaser';

const REGISTRY_CARRIED = 'essence-carried';
const REGISTRY_VAULTED = 'essence-vaulted';
const LS_KEY = 'matlu-essence';

/** Emitted on the scene event bus whenever the essence pool changes. */
export const ESSENCE_CHANGED_EVENT = 'essence-changed';

interface EssenceSave {
  carried: number;
  vaulted: number;
}

/**
 * EssenceSystem — owns the player's Essence pool (Leaf 1 of the Essence epic).
 *
 * Two pools:
 *  - carried: Essence on the player, subject to loss on death.
 *  - vaulted:  Essence stored externally (Leaf 3 wires the vault interface).
 *
 * State is persisted in two layers:
 *  1. `game.registry` — survives scene transitions within the same session.
 *  2. localStorage — survives full page reloads.
 *
 * Broadcast: emits ESSENCE_CHANGED_EVENT on the scene event bus whenever
 * either pool changes, so the HUD (and future subscribers) can react.
 */
export class EssenceSystem {
  private readonly reg: Phaser.Data.DataManager;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.reg = scene.game.registry;
    this._restoreFromStorage();
    // Clean up the localStorage backup when the game is destroyed.
    scene.game.events.once(Phaser.Core.Events.DESTROY, () => this._persist());
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Adds `amount` to the carried pool. `source` is recorded for future telemetry. */
  earn(amount: number, source: string): void {
    void source; // reserved for telemetry
    const next = this.getCarried() + amount;
    this.reg.set(REGISTRY_CARRIED, next);
    this._persist();
    this._emit();
  }

  /**
   * Attempts to spend `amount` from the carried pool.
   * Returns `false` without side-effects if funds are insufficient.
   * `sink` is recorded for future telemetry.
   */
  spend(amount: number, sink: string): boolean {
    void sink; // reserved for telemetry
    const carried = this.getCarried();
    if (carried < amount) return false;
    this.reg.set(REGISTRY_CARRIED, carried - amount);
    this._persist();
    this._emit();
    return true;
  }

  /** Essence currently on the player (subject to death loss). */
  getCarried(): number {
    return (this.reg.get(REGISTRY_CARRIED) as number | undefined) ?? 0;
  }

  /** Essence in external storage. Leaf 3 will wire the deposit/withdraw interface. */
  getVaulted(): number {
    return (this.reg.get(REGISTRY_VAULTED) as number | undefined) ?? 0;
  }

  /** Total Essence across both pools. */
  getTotal(): number {
    return this.getCarried() + this.getVaulted();
  }

  /**
   * How much carried Essence to deduct on death.
   * Returns the full carried amount by default.
   * Difficulty modes will eventually parameterise this (deferred per issue spec).
   */
  essenceLossOnDeath(carried: number): number {
    return carried;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private _emit(): void {
    this.scene.events.emit(ESSENCE_CHANGED_EVENT, this.getCarried(), this.getVaulted());
  }

  private _persist(): void {
    try {
      const save: EssenceSave = { carried: this.getCarried(), vaulted: this.getVaulted() };
      localStorage.setItem(LS_KEY, JSON.stringify(save));
    } catch {
      // localStorage may be unavailable in some contexts — fail silently.
    }
  }

  private _restoreFromStorage(): void {
    // Registry values survive scene transitions; only restore from localStorage
    // if the registry hasn't been populated yet (i.e. fresh page load).
    if (this.reg.has(REGISTRY_CARRIED)) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const save = JSON.parse(raw) as Partial<EssenceSave>;
      this.reg.set(REGISTRY_CARRIED, save.carried ?? 0);
      this.reg.set(REGISTRY_VAULTED, save.vaulted ?? 0);
    } catch {
      // Corrupt save data — start fresh.
    }
  }
}
