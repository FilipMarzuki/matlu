import * as Phaser from 'phaser';
import { LivingEntity, LivingEntityConfig } from '../LivingEntity';

const MULTI_STRIKE_COOLDOWN_MS = 8_000;
/** Delay between successive arm strikes in ms — simulates rapid sequential blows. */
const STRIKE_DELAY_MS = 100;
const STRIKE_COUNT = 4;

/**
 * Chimera — Tier 3 large-creature hero.
 *
 * Bear-sized with four arms. Signature ability (useMultiStrike) fires up to
 * 4 sequential single-target attacks staggered ~100 ms apart, each targeting a
 * different nearest living enemy — one blow per limb.
 */
export class Chimera extends LivingEntity {
  /**
   * Physics collision radius in pixels.
   *
   * ~24 px vs. ~10 px for humanoids — the Chimera occupies roughly 2 tiles.
   * Pass to body.setCircle(this.bodyRadius) in the scene after
   * physics.add.existing(chimera): a circle body avoids the corner-snagging
   * that a same-sized rectangle would cause when brushing obstacles, and it
   * matches the creature's roughly round silhouette better than a box.
   */
  readonly bodyRadius = 24;

  /** Damage dealt per arm strike. */
  readonly attackDamage = 20;

  /** Living entities this hero can attack with useMultiStrike(). */
  private opponents: LivingEntity[] = [];

  /** Remaining cooldown in ms before useMultiStrike() may fire again. */
  private multiStrikeCooldown = 0;

  /**
   * Handles for in-flight delayedCall strike timers.
   *
   * Phaser does not automatically remove scene timer events when a game object
   * is destroyed. Storing handles here lets onDeath() cancel them explicitly so
   * dead-target callbacks never fire after the Chimera is gone.
   */
  private strikeHandles: Phaser.Time.TimerEvent[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number, config: LivingEntityConfig) {
    super(scene, x, y, config);
  }

  /** Register the living entities this Chimera may attack. */
  setOpponents(entities: LivingEntity[]): void {
    this.opponents = [...entities];
  }

  /**
   * Tick the multi-strike cooldown. Called every frame by Phaser's game loop.
   * @param delta - milliseconds since the last frame
   */
  override update(delta: number): void {
    this.multiStrikeCooldown = Math.max(0, this.multiStrikeCooldown - delta);
  }

  /**
   * Multi-Strike — fire up to 4 sequential single-target attacks.
   *
   * Targets the nearest distinct living enemies (up to STRIKE_COUNT), sorted by
   * ascending distance. Each hit is staggered ~100 ms from the previous via
   * scene.time.delayedCall so the four blows feel like rapid successive strikes
   * rather than an instant AOE burst.
   *
   * No-op while the 8 000 ms cooldown is active or while dead.
   */
  useMultiStrike(): void {
    if (!this.isAlive || this.multiStrikeCooldown > 0) return;

    // Sort living opponents by ascending distance — pick the nearest targets first.
    const targets = this.opponents
      .filter(e => e.isAlive)
      .sort((a, b) =>
        Phaser.Math.Distance.Between(this.x, this.y, a.x, a.y) -
        Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y),
      )
      .slice(0, STRIKE_COUNT);

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const handle = this.scene.time.delayedCall(i * STRIKE_DELAY_MS, () => {
        // Guard: target may have died between scheduling and firing.
        if (target.isAlive) {
          target.takeDamage(this.attackDamage);
        }
        // Drop the handle once it has fired to avoid unbounded array growth.
        const idx = this.strikeHandles.indexOf(handle);
        if (idx !== -1) this.strikeHandles.splice(idx, 1);
      });
      this.strikeHandles.push(handle);
    }

    this.multiStrikeCooldown = MULTI_STRIKE_COOLDOWN_MS;
  }

  /**
   * Cancel all pending strike timers before the entity is cleaned up.
   *
   * Without this, callbacks scheduled by delayedCall would still fire after the
   * Chimera is destroyed — potentially calling takeDamage on stale references.
   */
  protected override onDeath(): void {
    for (const h of this.strikeHandles) {
      this.scene.time.removeEvent(h);
    }
    this.strikeHandles = [];
    super.onDeath();
  }
}
