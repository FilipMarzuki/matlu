import * as Phaser from 'phaser';
import { LivingEntity } from '../LivingEntity';

/**
 * Lund — Tier 1 Naturalist Scout.
 *
 * Lowest HP of any hero, compensated by the highest movement speed. Lund's
 * role is pure support: she stays at range and uses Pacify frequently to buy
 * time for heavier allies (isSupportUnit = true is the AI hint for this).
 *
 * Signature ability: usePacify(target) — stuns the target for 3 s.
 * Cooldown: 10 s.
 *
 * Physics body is added externally by the scene after construction — Lund
 * herself only owns stats and the ability timer. The scene drives movement
 * by reading this.speed and writing to (this.body as ArcadeBody).setVelocity.
 */
export class Lund extends LivingEntity {
  /** Tells AI behaviour trees that this hero should keep distance and spam Pacify. */
  readonly isSupportUnit = true;

  /** px/s — highest among all heroes; compensates for the fragile HP pool. */
  readonly speed = 120;

  private cooldownRemaining = 0;
  private static readonly PACIFY_COOLDOWN_MS = 10_000;
  private static readonly PACIFY_DURATION_MS = 3_000;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    // maxHp 60 — lowest of any hero (Skald and Tinkerer are both 100).
    super(scene, x, y, { maxHp: 60 });
  }

  /**
   * Called every frame by the scene. Ticks the ability cooldown.
   * Skips all logic when dead so the scene doesn't need to guard externally.
   */
  override update(delta: number): void {
    if (!this.isAlive) return;
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - delta);
  }

  /**
   * Stun one target enemy for 3 s. No-op while the cooldown is active.
   *
   * @returns true if the ability fired, false if it was on cooldown.
   */
  usePacify(target: LivingEntity): boolean {
    if (this.cooldownRemaining > 0) return false;
    target.stun(Lund.PACIFY_DURATION_MS);
    this.cooldownRemaining = Lund.PACIFY_COOLDOWN_MS;
    return true;
  }

  /** 0–1 fraction — useful for rendering a cooldown indicator. */
  get pacifyCooldownFraction(): number {
    return this.cooldownRemaining / Lund.PACIFY_COOLDOWN_MS;
  }
}
