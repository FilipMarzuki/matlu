/**
 * DeployableManager — lifecycle manager for Deployable instances.
 *
 * One instance per scene, exposed as `scene.deployables`.
 *
 * ## Usage
 *
 * ```ts
 * // scene.create()
 * this.deployables = new DeployableManager(this);
 *
 * // scene.update()
 * this.deployables.update(delta);
 *
 * // SHUTDOWN event handler
 * this.deployables.destroyAll();
 * ```
 *
 * ## Two registration paths
 *
 * **Legacy path** (`add`) — hero creates a concrete instance and registers it:
 * ```ts
 * const t = new SentryTurret(this.scene, x, y, this, getTargets);
 * this.deployMgr.add(t);
 * ```
 *
 * **Placement path** (`place`) — manager validates, creates a PlaceholderDeployable,
 * and emits HUD events. Useful from the dev console:
 * ```ts
 * scene.deployables.place({
 *   kind: 'turret', hp: 40, lifetimeMs: 10_000,
 *   team: 'hero', owner: scene.hero, cap: 1,
 * });
 * ```
 *
 * ## HUD events (emitted on scene.events)
 *
 * | Event                 | Payload                             |
 * | --------------------- | ----------------------------------- |
 * | `deployable:placed`   | `{ kind, count, cap }`              |
 * | `deployable:removed`  | `{ kind, count, cap }`              |
 * | `deployable:cap-hit`  | `{ kind, count, cap }`              |
 *
 * Child D (HUD) subscribes to these without importing the manager directly.
 */

import * as Phaser from 'phaser';
import { Deployable, PlaceholderDeployable } from '../entities/Deployable';
import type { DeployableConfig } from '../entities/Deployable';

export type { DeployableConfig };

export interface PlacementResult {
  placed: boolean;
  /** Human-readable reason when placed is false. Surfaced by the HUD as a flash. */
  reason?: string;
}

/** Minimum pixel gap between two same-team deployables (overlap check). */
const MIN_DEPLOYABLE_SPACING = 24;

export class DeployableManager {
  private readonly active: Set<Deployable> = new Set();

  /**
   * Per-owner index so `getActive()` and `getCount()` are O(k) where k is the
   * number of deployables for that owner, not O(N) over all active deployables.
   */
  private readonly byOwner = new Map<Phaser.GameObjects.GameObject, Set<Deployable>>();

  /** @param scene — when provided, HUD events are emitted on scene.events. */
  constructor(private readonly scene?: Phaser.Scene) {}

  // ── Registration ─────────────────────────────────────────────────────────────

  /**
   * Register a pre-created Deployable. The manager takes ownership — do NOT call
   * `destroy()` manually after adding; use `remove()` instead.
   *
   * Used by CombatEngineer and any hero that constructs its own concrete deployable.
   */
  add(d: Deployable): void {
    this.active.add(d);
    this.ownerSet(d.owner).add(d);
  }

  /**
   * Validate placement rules and register a PlaceholderDeployable at worldPos.
   *
   * Returns `{ placed: false, reason }` without registering anything if any
   * validation step fails. On success emits `deployable:placed`.
   *
   * worldPos defaults to the owner's current position when omitted.
   * Requires the manager to have been constructed with a scene reference.
   */
  place(config: DeployableConfig, worldPos?: { x: number; y: number }): PlacementResult {
    if (!this.scene) {
      return { placed: false, reason: 'no scene context — pass scene to DeployableManager constructor' };
    }

    const ownerX = (config.owner as { x?: number }).x ?? 0;
    const ownerY = (config.owner as { y?: number }).y ?? 0;
    const pos = worldPos ?? { x: ownerX, y: ownerY };

    // ── Cap check ─────────────────────────────────────────────────────────────
    if (config.cap !== undefined) {
      const current = this.getCount(config.owner, config.kind);
      if (current >= config.cap) {
        this.emit('deployable:cap-hit', { kind: config.kind, count: current, cap: config.cap });
        return { placed: false, reason: 'cap reached' };
      }
    }

    // ── Placement rules ───────────────────────────────────────────────────────
    if (config.placementRules) {
      const { minDistanceFromOwner, maxDistanceFromOwner, blockedByOtherDeployables } = config.placementRules;

      const distFromOwner = Phaser.Math.Distance.Between(ownerX, ownerY, pos.x, pos.y);
      if (distFromOwner < minDistanceFromOwner) {
        return { placed: false, reason: 'too close to owner' };
      }
      if (distFromOwner > maxDistanceFromOwner) {
        return { placed: false, reason: 'too far from owner' };
      }

      if (blockedByOtherDeployables) {
        for (const existing of this.active) {
          if (existing.team !== config.team) continue;
          const gap = Phaser.Math.Distance.Between(existing.x, existing.y, pos.x, pos.y);
          if (gap < MIN_DEPLOYABLE_SPACING) {
            return { placed: false, reason: 'overlaps an existing deployable' };
          }
        }
      }

      // Wall-overlap check: only possible if a wallChecker has been injected.
      // blockedByWalls=true with no checker is silently skipped — caller is
      // responsible for wiring up the checker if they need wall rejection.
      if (config.placementRules.blockedByWalls && this.wallChecker) {
        if (this.wallChecker(pos.x, pos.y)) {
          return { placed: false, reason: 'overlaps a wall' };
        }
      }
    }

    // ── Create and register ───────────────────────────────────────────────────
    const dep = new PlaceholderDeployable(this.scene, pos.x, pos.y, config);
    this.add(dep);
    this.emit('deployable:placed', {
      kind:  config.kind,
      count: this.getCount(config.owner, config.kind),
      cap:   config.cap ?? -1,
    });
    return { placed: true };
  }

  /**
   * Optional wall-collision predicate injected by the scene.
   * Signature: (worldX, worldY) → true if the point is inside a wall.
   * Not required — wall checks are skipped when this is null.
   */
  wallChecker: ((x: number, y: number) => boolean) | null = null;

  /**
   * Manually remove a deployable before its natural expiry.
   * Calls cleanup() and emits `deployable:removed`.
   */
  remove(d: Deployable): void {
    if (!this.active.has(d)) return;
    d.cleanup();
    this.unregister(d);
    this.emit('deployable:removed', {
      kind:  d.kind,
      count: this.getCount(d.owner, d.kind),
      cap:   -1,
    });
  }

  /**
   * Remove and clean up all deployables owned by `owner`.
   * Call this when a hero dies to prevent orphaned deployables from persisting.
   */
  removeAllFor(owner: Phaser.GameObjects.GameObject): void {
    const owned = this.byOwner.get(owner);
    if (!owned) return;
    for (const d of owned) {
      d.cleanup();
      this.active.delete(d);
    }
    this.byOwner.delete(owner);
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  /** All deployables currently registered to `owner`. */
  getActive(owner: Phaser.GameObjects.GameObject): readonly Deployable[] {
    const s = this.byOwner.get(owner);
    return s ? [...s] : [];
  }

  /** Count of active deployables of the given `kind` registered to `owner`. */
  getCount(owner: Phaser.GameObjects.GameObject, kind: string): number {
    const s = this.byOwner.get(owner);
    if (!s) return 0;
    let n = 0;
    for (const d of s) { if (d.kind === kind) n++; }
    return n;
  }

  /**
   * Returns all hero-team deployables — valid targets for enemy AI.
   *
   * Enemies call this to extend their target list beyond just the player hero.
   * Whether a specific kind (mine, shield) should actually be targeted is a
   * per-enemy designer decision; this method returns all hero-team deployables
   * so callers can filter by `kind` if needed.
   */
  getHostileTargets(): readonly Deployable[] {
    return [...this.active].filter(d => d.team === 'hero');
  }

  /** Total number of active deployables across all owners. */
  get count(): number {
    return this.active.size;
  }

  // ── Tick ──────────────────────────────────────────────────────────────────────

  /**
   * Tick all active deployables. Any that return `false` from `tick()` are
   * cleaned up and removed.
   *
   * Call from `scene.update(time, delta)` every frame.
   */
  update(delta: number): void {
    const expired: Deployable[] = [];
    for (const d of this.active) {
      if (!d.tick(delta)) expired.push(d);
    }
    for (const d of expired) {
      d.cleanup();
      this.unregister(d);
      this.emit('deployable:removed', {
        kind:  d.kind,
        count: this.getCount(d.owner, d.kind),
        cap:   -1,
      });
    }
  }

  /** Alias for `update()` — matches the method name used in the issue spec. */
  updateAll(delta: number): void { this.update(delta); }

  /**
   * Tear down all active deployables.
   * Call this in the scene's SHUTDOWN handler to prevent dangling game objects.
   */
  destroyAll(): void {
    for (const d of this.active) d.cleanup();
    this.active.clear();
    this.byOwner.clear();
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private ownerSet(owner: Phaser.GameObjects.GameObject): Set<Deployable> {
    let s = this.byOwner.get(owner);
    if (!s) { s = new Set(); this.byOwner.set(owner, s); }
    return s;
  }

  private unregister(d: Deployable): void {
    this.active.delete(d);
    this.byOwner.get(d.owner)?.delete(d);
  }

  private emit(key: string, payload: { kind: string; count: number; cap: number }): void {
    this.scene?.events.emit(key, payload);
  }
}
