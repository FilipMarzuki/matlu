import * as Phaser from 'phaser';
import { LivingEntity } from '../entities/LivingEntity';
import { Projectile, Damageable } from '../entities/Projectile';

const WATER_JET_SPEED  = 280;
const WATER_JET_DAMAGE = 18;
const WATER_JET_COLOR  = 0x44aaff; // light blue water bolt
const SHIELD_COOLDOWN_MS = 30_000;

/**
 * Bao — Tier 1 Panda Acolyte hero. Student robes, carved staff.
 *
 * Abilities:
 *   Water Jet    — ranged projectile toward a target position
 *   Water Shield — absorbs the next incoming hit entirely (30 s cooldown)
 */
export class Bao extends LivingEntity {
  readonly speed = 75;

  // Public so the arena scene / UI can read shield state without a getter.
  isShieldActive = false;

  private shieldOnCooldown = false;

  /** Living opponents that Bao's Water Jet projectiles can hit. */
  private jetTargets: Damageable[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, { maxHp: 110 });

    // Placeholder colour rect — no panda spritesheet exists yet.
    // TODO: replace with panda atlas
    const body = scene.add.rectangle(0, 0, 20, 20, 0x44aaee);
    this.add(body);
  }

  /**
   * Called every frame by Phaser. Per-frame behaviour (movement, input) is
   * driven externally by the scene — nothing to do here by default.
   */
  update(_delta: number): void {}

  /**
   * Fire a Water Jet projectile toward (targetX, targetY).
   * The scene should listen for 'projectile-spawned' to tick the projectile
   * each frame (same convention as CombatEntity.shootAt).
   */
  castWaterJet(targetX: number, targetY: number): void {
    const angle = Math.atan2(targetY - this.y, targetX - this.x);
    const p = new Projectile(
      this.scene, this.x, this.y, angle,
      WATER_JET_SPEED, WATER_JET_DAMAGE,
      WATER_JET_COLOR,
      this.jetTargets,
    );
    this.scene.events.emit('projectile-spawned', p);
  }

  /**
   * Activate Water Shield. The next takeDamage() call is fully absorbed and
   * the flag resets. No-op if the shield is already active or on cooldown.
   *
   * Cooldown runs from cast time — if the shield is consumed early, the timer
   * still counts down from when it was activated.
   */
  castWaterShield(): void {
    // Guard against double-absorb: do nothing if the shield is already up
    // or the 30 s cooldown from the last cast hasn't expired.
    if (this.isShieldActive || this.shieldOnCooldown) return;
    this.isShieldActive   = true;
    this.shieldOnCooldown = true;
    this.scene.time.delayedCall(SHIELD_COOLDOWN_MS, () => {
      this.shieldOnCooldown = false;
    });
  }

  /**
   * Override to intercept damage when Water Shield is active.
   * A shielded hit is absorbed entirely (returns 0); the flag resets so only
   * one hit per cast is blocked.
   */
  override takeDamage(amount: number): number {
    if (this.isShieldActive) {
      this.isShieldActive = false;
      return 0;
    }
    return super.takeDamage(amount);
  }

  /**
   * Register the entities Water Jet should be able to hit.
   * Call this from the arena scene whenever the enemy list changes.
   */
  setJetTargets(targets: Damageable[]): void {
    this.jetTargets = targets;
  }
}
