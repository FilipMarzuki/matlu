import * as Phaser from 'phaser';

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
 * Extends `Phaser.GameObjects.Arc` so it renders as a filled circle with no
 * Container overhead. Movement is manual (position update each tick) rather
 * than arcade physics, which avoids the complexity of registering physics
 * overlaps between Container-based entities.
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
export class Projectile extends Phaser.GameObjects.Arc {
  private readonly originX: number;
  private readonly originY: number;
  private readonly dirX: number;
  private readonly dirY: number;
  private readonly speed: number;
  private readonly damage: number;
  private readonly hitRadius: number;
  private readonly maxRange: number;
  private readonly arcHeight: number;
  private readonly targets: Damageable[];
  private distanceTravelled = 0;
  private expired = false;

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
   * @param arcHeight - Optional lateral arc amplitude in px (default 0 = straight)
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
    arcHeight: number = 0,
  ) {
    // Arc(scene, x, y, radius, startAngle, endAngle, anticlockwise, fillColor)
    super(scene, x, y, 5, 0, 360, false, color);

    // Register in the scene display list so it renders automatically.
    // Depth 1 = above the arena floor (0) but below HP bars (2) and ability FX (3).
    scene.add.existing(this);
    this.setDepth(1);

    this.originX   = x;
    this.originY   = y;
    this.dirX      = Math.cos(angle);
    this.dirY      = Math.sin(angle);
    this.speed     = speed;
    this.damage    = damage;
    this.hitRadius = hitRadius;
    this.maxRange  = maxRange;
    this.arcHeight = arcHeight;
    this.targets   = targets;
  }

  /**
   * Advance the projectile by one frame. Called manually by CombatArenaScene
   * because Arc is not in Phaser's built-in update list.
   */
  tick(delta: number): void {
    if (this.expired) return;

    const stepDistance = this.speed * (delta / 1000);
    this.distanceTravelled += stepDistance;
    const travelled = Math.min(this.distanceTravelled, this.maxRange);

    // Base linear trajectory.
    const baseX = this.originX + this.dirX * travelled;
    const baseY = this.originY + this.dirY * travelled;

    if (this.arcHeight !== 0) {
      // Arc in the perpendicular axis: 0 at spawn/end, peak at midpoint.
      const progress = travelled / this.maxRange;
      const curveOffset = Math.sin(progress * Math.PI) * this.arcHeight;
      const perpX = -this.dirY;
      const perpY = this.dirX;
      this.x = baseX + perpX * curveOffset;
      this.y = baseY + perpY * curveOffset;
    } else {
      this.x = baseX;
      this.y = baseY;
    }

    // Self-destruct when range is exceeded.
    if (this.distanceTravelled >= this.maxRange) {
      this.selfDestroy();
      return;
    }

    // Hit detection — distance check against each living target.
    for (const target of this.targets) {
      if (!target.isAlive) continue;
      const dist = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y);
      if (dist < this.hitRadius) {
        target.takeDamage(this.damage);
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
