import * as Phaser from 'phaser';
import { worldToArenaIso } from '../lib/IsoTransform';

/**
 * Minimal interface for projectile targets — avoids importing LivingEntity
 * and keeps Projectile decoupled from the entity hierarchy.
 */
export interface Damageable {
  x: number;
  y: number;
  isAlive: boolean;
  takeDamage(amount: number): number;
}

/**
 * Projectile — a short-lived visual that travels in a straight line and deals
 * damage on contact with a target.
 *
 * Extends `Phaser.GameObjects.Rectangle` and renders as a thin elongated
 * tracer round (~12×2 px) rotated to face the travel direction. This gives
 * a fast-bullet silhouette instead of the old filled-circle "blob".
 *
 * Movement is manual (position update each tick) rather than arcade physics,
 * which avoids the complexity of registering physics overlaps between
 * Container-based entities.
 *
 * Lifecycle:
 *   1. CombatEntity spawns a Projectile and emits 'projectile-spawned' on the
 *      scene event bus.
 *   2. CombatArenaScene adds it to `this.projectiles[]` and calls `tick(delta)`
 *      each frame.
 *   3. The projectile destroys itself when it hits a target, exceeds maxRange,
 *      or leaves the physics world bounds. `isExpired` goes true so the scene
 *      can prune its list.
 */
export class Projectile extends Phaser.GameObjects.Rectangle {
  private readonly vx: number;
  private readonly vy: number;
  private readonly damage: number;
  private readonly hitRadius: number;
  private readonly maxRange: number;
  private readonly targets: Damageable[];
  private readonly onHitCb: ((target: Damageable) => void) | undefined;
  private distanceTravelled = 0;
  private expired = false;
  /** World-space position — projectile logic runs here; display is iso-projected. */
  private _wx: number;
  private _wy: number;

  /** True once the projectile has hit a target, exceeded range, or gone off-bounds. */
  get isExpired(): boolean {
    return this.expired;
  }

  /**
   * @param scene     - Phaser scene (projectile adds itself to display list)
   * @param x         - World spawn X
   * @param y         - World spawn Y
   * @param angle     - Travel direction in radians
   * @param speed     - Travel speed in px/s
   * @param damage    - Damage dealt on hit
   * @param color     - Fill colour (0xRRGGBB)
   * @param targets   - Entities that can be hit; dead ones are skipped
   * @param hitRadius - Distance in px that counts as a hit (default 18)
   * @param maxRange  - Max travel distance before self-destruct (default 350)
   * @param onHit     - Optional callback fired on the first target hit, before
   *                    the projectile destroys itself. Use this to apply effects
   *                    (e.g. root, slow) from the spawning entity without
   *                    coupling Projectile to any specific entity type.
   */
  constructor(
    scene:     Phaser.Scene,
    x:         number,
    y:         number,
    angle:     number,
    speed:     number,
    damage:    number,
    color:     number,
    targets:   Damageable[],
    hitRadius: number = 18,
    maxRange:  number = 350,
    onHit?:    (target: Damageable) => void,
  ) {
    // Rectangle(scene, x, y, width, height, fillColor)
    // 12×2 px gives a tracer-round silhouette — narrow and elongated.
    super(scene, x, y, 12, 2, color);

    // Register in the scene display list so it renders automatically.
    // Depth 1 = above the arena floor (0) but below HP bars (2) and ability FX (3).
    scene.add.existing(this);
    this.setDepth(1);
    // Rotate the long axis to face the travel direction so it reads as a bullet.
    this.setRotation(angle);

    this.vx        = Math.cos(angle) * speed;
    this.vy        = Math.sin(angle) * speed;
    this.damage    = damage;
    this.hitRadius = hitRadius;
    this.maxRange  = maxRange;
    this.targets   = targets;
    this.onHitCb   = onHit;
    this._wx       = x;
    this._wy       = y;

    // Project initial position to iso for display.
    const iso = worldToArenaIso(x, y);
    this.setPosition(iso.x, iso.y);
  }

  /**
   * Advance the projectile by one frame. Called manually by CombatArenaScene
   * because Rectangle is not in Phaser's built-in update list.
   */
  tick(delta: number): void {
    if (this.expired) return;

    // Move in world space.
    const dx = this.vx * (delta / 1000);
    const dy = this.vy * (delta / 1000);
    this._wx += dx;
    this._wy += dy;
    this.distanceTravelled += Math.sqrt(dx * dx + dy * dy);

    // Project to iso for display.
    const iso = worldToArenaIso(this._wx, this._wy);
    this.setPosition(iso.x, iso.y);

    // Self-destruct when range is exceeded.
    if (this.distanceTravelled >= this.maxRange) {
      this.selfDestroy();
      return;
    }

    // Hit detection in world space — use _wx/_wy on targets (CombatEntity).
    for (const target of this.targets) {
      if (!target.isAlive) continue;
      const twx = (target as unknown as { _wx?: number })._wx ?? target.x;
      const twy = (target as unknown as { _wy?: number })._wy ?? target.y;
      const dist = Phaser.Math.Distance.Between(this._wx, this._wy, twx, twy);
      if (dist < this.hitRadius) {
        target.takeDamage(this.damage);
        this.onHitCb?.(target);
        this.selfDestroy();
        return;
      }
    }
  }

  private selfDestroy(): void {
    this.expired = true;
    this.destroy(); // removes from display list and frees memory
  }
}
