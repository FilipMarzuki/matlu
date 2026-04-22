/**
 * Deployable — abstract base class for all placeable battlefield objects.
 *
 * ## What is a Deployable?
 *
 * A Deployable is any object that a hero (currently CombatEngineer) places on the
 * field during combat — SentryTurret, ScoutDrone, ProximityMine, BarrierShield, etc.
 * Concrete deployable classes extend this base and implement `tick()` for per-frame
 * behaviour.
 *
 * ## Lifecycle
 *
 * 1. Hero calls `DeployableManager.add(new SomeConcrete(...))` or
 *    `scene.deployables.place(config, worldPos)`.
 * 2. `DeployableManager.update(delta)` calls `tick(delta)` each frame.
 * 3. `tick()` returns `false` (or HP reaches 0) →
 *    manager calls `cleanup()` → `onRemoved()` → destroys the sprite.
 *
 * ## DeployableConfig
 *
 * Describes a deployable for the `place()` validation path and for creating
 * placeholder deployables via the dev console:
 *
 * ```ts
 * scene.deployables.place({
 *   kind: 'turret', hp: 40, lifetimeMs: 10_000, team: 'hero',
 *   owner: scene.hero, cap: 1,
 *   placementRules: { minDistanceFromOwner: 0, maxDistanceFromOwner: 200,
 *                     blockedByWalls: false, blockedByOtherDeployables: false },
 * });
 * ```
 */

import * as Phaser from 'phaser';

export type DeployableTeam = 'hero' | 'enemy';

/** Spatial constraints checked by DeployableManager.place(). */
export interface PlacementRules {
  minDistanceFromOwner: number;
  maxDistanceFromOwner: number;
  /** Reject placement that overlaps a solid wall tile (requires scene physics). */
  blockedByWalls: boolean;
  /** Reject placement within MIN_SPACING px of an existing same-team deployable. */
  blockedByOtherDeployables: boolean;
}

/**
 * Config passed to DeployableManager.place() to describe a deployable to create
 * and validate. Also consumed by PlaceholderDeployable.
 */
export interface DeployableConfig {
  kind: string;
  hp: number;
  /** null = no time limit — deployable persists until HP reaches 0. */
  lifetimeMs: number | null;
  team: DeployableTeam;
  /** The hero (or entity) that owns this deployable. */
  owner: Phaser.GameObjects.GameObject;
  /** Max concurrent deployables of this kind per owner. Undefined = unlimited. */
  cap?: number;
  placementRules?: PlacementRules;
  /** Texture key or emoji used by the HUD slot panel (Child D). */
  icon?: string;
}

export abstract class Deployable extends Phaser.GameObjects.Sprite {
  /** The entity that placed this deployable. Used for ownership checks. */
  readonly owner: Phaser.GameObjects.GameObject;

  /** Deployable type identifier. Matches DeployableConfig.kind. */
  readonly kind: string;

  /**
   * Which side owns this deployable.
   * 'hero' = friendly (enemies target it); 'enemy' = hostile.
   */
  readonly team: DeployableTeam;

  /**
   * Remaining lifetime in milliseconds.
   * Concrete classes should decrement this in `tick()` and return false when ≤ 0.
   * Set to `Infinity` for permanent deployables (those that only die when destroyed).
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
    kind = '',
    team: DeployableTeam = 'hero',
  ) {
    super(scene, x, y, texture);
    // Register with the scene's display list so the sprite is rendered.
    scene.add.existing(this);
    this.owner      = owner;
    this.lifetimeMs = lifetimeMs;
    this.maxHp      = maxHp;
    this.hp         = maxHp;
    this.kind       = kind;
    this.team       = team;
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
   * Per-frame update called by `DeployableManager`.
   *
   * @param delta - Time elapsed since the last frame in milliseconds.
   * @returns `true` to remain active, `false` to signal that the deployable
   *          should be torn down (manager calls `cleanup()` immediately after).
   */
  abstract tick(delta: number): boolean;

  /**
   * Called by `cleanup()` just before the sprite is destroyed.
   * Override to emit despawn effects, drop pickups, fire events, etc.
   * Always call `super.cleanup()` at the end of an override.
   */
  onRemoved(): void {}

  /**
   * Tear-down hook — called by `DeployableManager` when `tick()` returns `false`
   * or `destroyAll()` is invoked on scene shutdown.
   *
   * Default: fires `onRemoved()` then destroys the Phaser game object.
   * Override to destroy child objects before calling `super.cleanup()`.
   */
  cleanup(): void {
    this.onRemoved();
    this.destroy();
  }
}

/**
 * PlaceholderDeployable — concrete stand-in used by DeployableManager.place().
 *
 * Renders as a coloured square (cyan for hero-team, red for enemy-team).
 * Has no special behaviour — just counts down its lifetime. Useful for:
 *   - Dev-console testing: `scene.deployables.place({...config})`
 *   - CI/unit-test fixtures when a real concrete class is not needed.
 */
export class PlaceholderDeployable extends Deployable {
  private readonly rect: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, config: DeployableConfig) {
    super(
      scene, x, y, '__DEFAULT',
      config.owner,
      config.lifetimeMs ?? Infinity,
      config.hp,
      config.kind,
      config.team,
    );
    // The actual visual is a Rectangle child; the Sprite itself is invisible.
    this.setVisible(false);
    const colour = config.team === 'hero' ? 0x00ccff : 0xff4444;
    this.rect = scene.add.rectangle(x, y, 12, 12, colour, 0.85).setDepth(5);
  }

  override tick(delta: number): boolean {
    if (this.hp <= 0) return false;
    this.lifetimeMs -= delta;
    if (this.lifetimeMs <= 0) return false;
    // Keep the visual rectangle in sync with any physics/tween movement.
    this.rect.setPosition(this.x, this.y);
    return true;
  }

  override cleanup(): void {
    this.rect.destroy();
    super.cleanup();
  }
}
