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
 * 3. `tick()` returns `false` (or `this.lifetimeMs` / `this.hp` runs out) →
 *    manager calls `cleanup()` and removes the instance from the active set.
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

  /** Current hit points. Enemies can damage deployables; reaches 0 → tick returns false. */
  hp: number;
  /** Maximum hit points. */
  readonly maxHp: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    owner: Phaser.GameObjects.GameObject,
    lifetimeMs: number,
    maxHp: number,
  ) {
    super(scene, x, y, texture);
    // Register with the scene's display list so the sprite is rendered.
    scene.add.existing(this);
    this.owner      = owner;
    this.lifetimeMs = lifetimeMs;
    this.maxHp      = maxHp;
    this.hp         = maxHp;
  }

  /**
   * Apply incoming damage to this deployable. Returns remaining HP.
   * Callers (e.g. arena overlap handlers) should check `hp <= 0` after calling.
   */
  takeDamage(amount: number): number {
    this.hp = Math.max(0, this.hp - amount);
    return this.hp;
  }

  /**
   * Returns true when this deployable can still be targeted and damaged.
   * Mirrors the Damageable shape used by Projectile.
   */
  get isAlive(): boolean {
    return this.active && this.hp > 0;
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
