import { Entity } from './Entity';

export interface LivingEntityConfig {
  maxHp: number;
}

/**
 * LivingEntity — allt som har HP och kan dö.
 *
 * Spelare, djur och fiender ärver alla härifrån. Klassen hanterar
 * HP-räkning, skadelogik och dödslivscykeln via hooks.
 */
export abstract class LivingEntity extends Entity {
  readonly maxHp: number;
  protected hp: number;
  protected dead = false;

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
    const actual = Math.min(amount, this.hp);
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
}
