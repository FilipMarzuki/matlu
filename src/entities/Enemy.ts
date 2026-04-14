import { LivingEntity, LivingEntityConfig } from './LivingEntity';

export interface EnemyConfig extends LivingEntityConfig {
  aggroRadius: number;
  attackDamage: number;
  speed: number;

  /**
   * Initial detection radius in px. Enemy must be within this distance AND
   * have line-of-sight to transition from Idle → Alerted. Defaults to
   * `aggroRadius` when not set (immediately aware at aggro range — legacy behaviour).
   */
  alertRadius?: number;

  /**
   * Give-up radius. Once Alerted/Engaging, enemy enters Searching state if
   * the target exceeds this range or LOS is lost. Should be larger than
   * `alertRadius` to create a hysteresis band. Defaults to `aggroRadius * 1.5`.
   */
  loseSightRadius?: number;
}

/**
 * Enemy — base class for all enemies.
 *
 * Unlike WildlifeAnimal, enemies actively hunt and attack the player.
 * Concrete enemies (e.g. ZombieRabbit) inherit from here and implement
 * their sprites and specific attack patterns.
 */
export abstract class Enemy extends LivingEntity {
  readonly aggroRadius: number;
  readonly attackDamage: number;
  /**
   * Movement speed in px/s. Not readonly so CombatEntity can apply a
   * per-instance speed variance at construction time (boids texture).
   */
  speed: number;

  /** Detection radius — player must be within this + have LOS to alert the enemy. */
  readonly alertRadius: number;
  /** Give-up radius — enemy enters Searching when target exceeds this distance. */
  readonly loseSightRadius: number;

  constructor(scene: Phaser.Scene, x: number, y: number, config: EnemyConfig) {
    super(scene, x, y, config);
    this.aggroRadius    = config.aggroRadius;
    this.attackDamage   = config.attackDamage;
    this.speed          = config.speed;
    this.alertRadius    = config.alertRadius    ?? config.aggroRadius;
    this.loseSightRadius = config.loseSightRadius ?? config.aggroRadius * 1.5;
  }

  override update(delta: number): void {
    if (!this.isAlive) return;
    this.updateBehaviour(delta);
  }

  /**
   * Core behaviour tick. Subclasses implement aggro, chase and attack logic.
   * Called every frame while alive.
   */
  protected abstract updateBehaviour(delta: number): void;

  /**
   * Called when the enemy should attack a target.
   * Subclasses can override to add animation, cooldown, etc.
   */
  protected attack(target: LivingEntity): void {
    target.takeDamage(this.attackDamage);
  }
}
