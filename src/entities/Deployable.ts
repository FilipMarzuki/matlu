/**
 * Deployable — abstract base class for all placeable battlefield objects.
 *
 * ## What is a Deployable?
 *
 * A Deployable is any object that a hero (currently CombatEngineer) places on the
 * field during combat — SentryTurret, MineField, etc. Concrete deployable classes
 * extend this base and implement `tick()` with their per-frame logic.
 *
 * ## Lifecycle
 *
 * 1. Hero calls `DeployableManager.add(new SomeConcrete(...))`.
 * 2. `DeployableManager.update(delta)` calls `tick(delta)` each frame.
 * 3. `tick()` returns `false` (or `this.lifetimeMs` runs out) → manager calls
 *    `cleanup()` and removes the instance from the active set.
 *
 * ## What is NOT here yet
 *
 * - Concrete subclasses (SentryTurret, MineField) — CombatEngineer Children B/C
 * - Collision/overlap registration — Children B/C wire into CombatArenaScene
 * - Visual effects on deploy / destroy — Children C/D
 */

import * as Phaser from 'phaser';

export abstract class Deployable extends Phaser.GameObjects.Sprite {
  /** The entity that placed this deployable. Used for ownership checks and friendly-fire avoidance. */
  readonly owner: Phaser.GameObjects.GameObject;

  /**
   * Remaining lifetime in milliseconds.
   * Concrete classes should decrement this in `tick()` and return false when it hits 0.
   * Set to `Infinity` for permanent deployables (e.g. structures that only die when destroyed).
   */
  protected lifetimeMs: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    owner: Phaser.GameObjects.GameObject,
    lifetimeMs: number,
  ) {
    super(scene, x, y, texture);
    // Register with the scene's display list so the sprite is rendered.
    scene.add.existing(this);
    this.owner = owner;
    this.lifetimeMs = lifetimeMs;
  }

  /**
   * Per-frame update called by `DeployableManager`.
   *
   * @param delta - Time elapsed since the last frame in milliseconds.
   * @returns `true` to remain active, `false` to signal that the deployable
   *          should be torn down (manager will call `cleanup()` immediately after).
   */
  abstract tick(delta: number): boolean;

  /**
   * Tear-down hook — called by `DeployableManager` when `tick()` returns `false`
   * or `destroyAll()` is invoked on scene shutdown.
   *
   * Default: destroys the Phaser game object. Override to emit effects, drop
   * pickups, or trigger events before calling `super.cleanup()`.
   */
  cleanup(): void {
    this.destroy();
  }
}
