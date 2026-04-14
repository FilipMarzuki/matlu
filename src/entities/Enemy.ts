import * as Phaser from 'phaser';
import { LivingEntity, LivingEntityConfig } from './LivingEntity';

export interface EnemyConfig extends LivingEntityConfig {
  aggroRadius: number;
  attackDamage: number;
  speed: number;
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
  readonly speed: number;

  constructor(scene: Phaser.Scene, x: number, y: number, config: EnemyConfig) {
    super(scene, x, y, config);
    this.aggroRadius = config.aggroRadius;
    this.attackDamage = config.attackDamage;
    this.speed = config.speed;
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
