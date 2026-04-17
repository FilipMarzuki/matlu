import * as Phaser from 'phaser';
import { LivingEntity } from '../LivingEntity';

/**
 * SymbiontKarin — Tier 2 Bonded Huntress.
 *
 * Mid-tier hero balanced for aggressive flanking. Her signature ability,
 * Blur Dash, bursts her forward at high speed and leaves a short-lived
 * afterimage at the launch point. The afterimage deals splash damage to
 * enemies near the origin — handled by the scene via the 'afterimage-spawned'
 * event (same pattern as 'projectile-spawned' in CombatEntity).
 *
 * Physics body is added externally by the scene after construction, so all
 * velocity work guards with an `| undefined` cast.
 */
export class SymbiontKarin extends LivingEntity {
  /** px/s — above average but below Lund. */
  readonly speed = 95;

  /** Damage dealt by the afterimage splash at the dash origin. */
  readonly afterimageDamage = 18;

  private cooldownRemaining = 0;
  private static readonly DASH_COOLDOWN_MS = 8_000;
  private static readonly DASH_DURATION_MS = 200;
  private static readonly DASH_SPEED_MULT  = 5.0;
  private static readonly AFTERIMAGE_FADE_MS = 200;

  private isDashing  = false;
  private dashTimer  = 0;
  private dashVx     = 0;
  private dashVy     = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, { maxHp: 90 });
  }

  /**
   * Called every frame by the scene.
   * Ticks the ability cooldown and re-applies dash velocity so the BT or
   * player input cannot cancel the burst mid-flight.
   */
  override update(delta: number): void {
    if (!this.isAlive) return;
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - delta);

    if (this.isDashing) {
      this.dashTimer -= delta;
      const body = this.body as Phaser.Physics.Arcade.Body | undefined;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
        body?.setVelocity(0, 0);
      } else {
        // Re-apply every frame so no external setVelocity call can cancel the burst.
        body?.setVelocity(this.dashVx, this.dashVy);
      }
    }
  }

  /**
   * Blur Dash: burst in direction (dx, dy) and leave a damaging afterimage
   * at the launch point.
   *
   * The afterimage is a translucent rectangle that alpha-fades to 0 over
   * ~200 ms and then destroys itself. The scene receives an 'afterimage-spawned'
   * event carrying the world position and damage value so it can resolve damage
   * against nearby enemies (same pattern as 'projectile-spawned').
   *
   * @returns true if the ability fired, false if on cooldown or already dashing.
   */
  useBlurDash(dx: number, dy: number): boolean {
    if (this.cooldownRemaining > 0 || this.isDashing) return false;

    const body = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) return false;

    const originX = this.x;
    const originY = this.y;

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const spd = this.speed * SymbiontKarin.DASH_SPEED_MULT;
    this.dashVx    = (dx / len) * spd;
    this.dashVy    = (dy / len) * spd;
    this.dashTimer = SymbiontKarin.DASH_DURATION_MS;
    this.isDashing = true;
    body.setVelocity(this.dashVx, this.dashVy);

    this.spawnAfterimage(originX, originY);
    this.cooldownRemaining = SymbiontKarin.DASH_COOLDOWN_MS;
    return true;
  }

  /** True while the dash burst is active. Scenes can read this to suppress other input. */
  get isDashActive(): boolean {
    return this.isDashing;
  }

  /** 0–1 fraction — useful for rendering a cooldown indicator. */
  get dashCooldownFraction(): number {
    return this.cooldownRemaining / SymbiontKarin.DASH_COOLDOWN_MS;
  }

  private spawnAfterimage(x: number, y: number): void {
    // Translucent teal rectangle at the launch position — acts as the ghost copy.
    // A real sprite-based ghost would need a texture key and frame snapshot,
    // which is unavailable without a render texture; the rectangle approximates it.
    const ghost = this.scene.add.rectangle(x, y, 16, 24, 0x55ddcc, 0.7);
    ghost.setDepth(this.depth);

    // Alpha-fade to 0 then auto-destroy — total lifetime ≈ AFTERIMAGE_FADE_MS.
    this.scene.tweens.add({
      targets:  ghost,
      alpha:    { from: 0.7, to: 0 },
      duration: SymbiontKarin.AFTERIMAGE_FADE_MS,
      ease:     'Linear',
      onComplete: () => ghost.destroy(),
    });

    // Notify the scene so it can apply splash damage to nearby enemies.
    // Payload: world position + damage value (scene resolves overlap).
    this.scene.events.emit('afterimage-spawned', x, y, this.afterimageDamage);
  }
}
