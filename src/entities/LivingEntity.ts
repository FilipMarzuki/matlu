import * as Phaser from 'phaser';
import { Entity } from './Entity';

export interface LivingEntityConfig {
  maxHp: number;
}

/**
 * LivingEntity — anything that has HP and can die.
 *
 * Player, animals and enemies all inherit from here. The class handles
 * HP tracking, damage logic and the death lifecycle via hooks.
 */
export abstract class LivingEntity extends Entity {
  readonly maxHp: number;
  protected hp: number;
  protected dead = false;
  /** True while a stun effect is active — callers should skip movement/actions. */
  isStunned = false;

  /**
   * Multiplier applied to incoming damage before damageMultiplier.
   * Values < 1 reduce damage (0.15 = 85% reduction); 1 = no effect.
   */
  public damageReduction: number = 1;

  /**
   * Multiplier applied after damageReduction.
   * Values > 1 amplify damage (3 = triple damage); 1 = no effect.
   */
  public damageMultiplier: number = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, config: LivingEntityConfig) {
    super(scene, x, y);
    this.maxHp = config.maxHp;
    this.hp = config.maxHp;
  }

  /** Current HP as a 0–1 fraction, useful for HP bar rendering. */
  get hpFraction(): number {
    return this.hp / this.maxHp;
  }

  get isAlive(): boolean {
    return !this.dead;
  }

  /**
   * Apply damage. Clamps HP to 0 and triggers onDeath once.
   * Returns the actual damage dealt.
   */
  takeDamage(amount: number): number {
    if (this.dead) return 0;
    // Apply damageReduction first, then damageMultiplier — order matters for
    // entities like Bonehulk where both can be active simultaneously.
    const scaled = amount * this.damageReduction * this.damageMultiplier;
    const actual = Math.min(scaled, this.hp);
    this.hp -= actual;
    this.onDamaged(actual);
    if (this.hp <= 0) {
      this.dead = true;
      this.onDeath();
    }
    return actual;
  }

  /** Hook called every time damage is applied (even non-lethal). */
  protected onDamaged(_amount: number): void {
    // override in subclasses
  }

  /** Hook called once when HP reaches 0. Override to play death animation, emit events, etc. */
  protected onDeath(): void {
    this.destroy();
  }

  /**
   * Apply a timed stun. Sets isStunned = true for durationMs, then clears it.
   * Stacking calls do NOT extend the duration — the last call wins the clear timer.
   */
  stun(durationMs: number): void {
    this.isStunned = true;
    this.scene.time.delayedCall(durationMs, () => {
      if (this.active) this.isStunned = false;
    });
  }
}
