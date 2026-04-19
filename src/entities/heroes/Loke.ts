import * as Phaser from 'phaser';
import { LivingEntity } from '../LivingEntity';

/**
 * Loke — Tier 0 Mistheim Scout.
 *
 * The youngest of the heroes: a 10-year-old boy with a wooden slingshot, a
 * green knit hat, and an inexhaustible curiosity about how things work.
 *
 * Stats reflect his age — lower HP than any other hero, medium movement speed.
 * His slingshot fires pebbles at moderate range with a short cooldown, making
 * him a hit-and-run skirmisher who relies on positioning rather than raw power.
 *
 * Signature ability: shootSlingshot(angle, onProjectile) — fires a pebble
 * projectile in the given world-space direction.
 * Cooldown: SLINGSHOT_COOLDOWN_MS (1 200 ms).
 *
 * Movement and input are handled externally by the scene — Loke owns stats
 * and the ability timer only.
 */
export class Loke extends LivingEntity {
  /** px/s — brisk scout pace; not the fastest hero but quick for his size. */
  readonly speed = 105;

  // ── Slingshot constants ───────────────────────────────────────────────────

  /** ms between slingshot shots. Short enough to feel responsive. */
  static readonly SLINGSHOT_COOLDOWN_MS = 1_200;

  /** Flat damage per pebble before any resistances. */
  static readonly SLINGSHOT_DAMAGE = 18;

  /** Pebble travel speed in px/s. */
  static readonly SLINGSHOT_PROJECTILE_SPEED = 320;

  /** Maximum pebble flight distance in px before the projectile despawns. */
  static readonly SLINGSHOT_RANGE_PX = 350;

  private slingshotCooldown = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    // 70 HP — least durable hero; rewards careful play and good positioning.
    super(scene, x, y, { maxHp: 70 });
  }

  /**
   * Called every frame by the scene. Ticks the slingshot cooldown.
   * @param delta frame delta in ms (Phaser passes ms by default in update loops)
   */
  override update(delta: number): void {
    if (!this.isAlive) return;
    this.slingshotCooldown = Math.max(0, this.slingshotCooldown - delta);
  }

  /**
   * Fire the slingshot toward a world-space angle (radians).
   *
   * The scene is responsible for physically spawning the projectile — Loke
   * provides velocity components and damage via the `onProjectile` callback.
   * This keeps Loke decoupled from the scene's projectile group implementation.
   *
   * @param angle   World-space angle in radians (Phaser.Math.Angle conventions).
   * @param onProjectile  Called with (vx, vy, damage) if the shot fires.
   * @returns true if the shot fired; false if still on cooldown.
   *
   * @example
   * loke.shootSlingshot(angle, (vx, vy, dmg) => {
   *   projectileGroup.fire(loke.x, loke.y, vx, vy, dmg);
   * });
   */
  shootSlingshot(
    angle: number,
    onProjectile: (vx: number, vy: number, damage: number) => void,
  ): boolean {
    if (this.slingshotCooldown > 0) return false;

    this.slingshotCooldown = Loke.SLINGSHOT_COOLDOWN_MS;

    const speed = Loke.SLINGSHOT_PROJECTILE_SPEED;
    onProjectile(
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      Loke.SLINGSHOT_DAMAGE,
    );

    return true;
  }

  /**
   * 0–1 fraction of the cooldown remaining.
   * Drive a cooldown arc or opacity fade on the HUD shot indicator.
   */
  get slingshotCooldownFraction(): number {
    return this.slingshotCooldown / Loke.SLINGSHOT_COOLDOWN_MS;
  }

  /** true while the slingshot is ready to fire. */
  get canShoot(): boolean {
    return this.slingshotCooldown === 0;
  }
}
