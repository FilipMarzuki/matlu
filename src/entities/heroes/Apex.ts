import * as Phaser from 'phaser';
import { LivingEntity, LivingEntityConfig } from '../LivingEntity';
import { CombatEntity } from '../CombatEntity';

/**
 * Apex — Tier 4 large-creature hero.
 *
 * Elephant-scaled (four-legged), oversized collision footprint.
 * Signature ability: Primal Roar — panics all nearby enemies for 5 000 ms,
 * sending each fleeing in a unique random direction. 12 000 ms cooldown.
 *
 * Extends LivingEntity directly (not CombatEntity) because the Apex is a
 * hero, not an enemy — it has no behavior tree and no aggro AI. Movement
 * and attacks are driven externally by the scene (player control or scripted).
 */
export class Apex extends LivingEntity {
  /**
   * Collision/camera radius in px.
   * ~40 px reflects the elephant scale relative to the standard 20 px entities.
   */
  readonly bodyRadius = 40;

  private cooldownRemaining = 0;
  /** Living enemies registered by the scene; queried on each Primal Roar. */
  private registeredEnemies: CombatEntity[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number, config: LivingEntityConfig) {
    super(scene, x, y, config);
  }

  /** Register the arena's enemy roster so Primal Roar can query distance. */
  setEnemies(enemies: CombatEntity[]): void {
    this.registeredEnemies = enemies;
  }

  override update(delta: number): void {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - delta);
  }

  /**
   * Primal Roar — panics all living enemies within `radius` px.
   *
   * Each affected enemy is taken out of AI control and given a unique random
   * flee velocity for 5 000 ms. `setPlayerControlled(true)` bypasses the
   * behavior tree so the flee velocity persists rather than being overwritten
   * by chase/wander logic on the next frame.
   *
   * No-op while the 12 000 ms cooldown is active.
   */
  usePrimalRoar(radius: number): void {
    if (this.cooldownRemaining > 0) return;
    this.cooldownRemaining = 12_000;

    for (const enemy of this.registeredEnemies) {
      if (!enemy.isAlive) continue;

      const dist = Phaser.Math.Distance.Between(this.x, this.y, enemy.x, enemy.y);
      if (dist > radius) continue;

      // Each enemy gets its own random angle so they scatter rather than
      // all fleeing in the same direction away from the Apex.
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const vx = Math.cos(angle) * enemy.speed;
      const vy = Math.sin(angle) * enemy.speed;

      // Suspend the behavior tree and apply the flee velocity.
      // Before overriding, AI state is implicitly "active BT" (playerControlled=false).
      // We restore that state after 5 000 ms via the delayed callback below.
      enemy.setPlayerControlled(true);
      enemy.setMoveVelocity(vx, vy);

      // Restore AI control after the panic window expires.
      // Guard with isAlive — no point restoring state on a dead entity.
      this.scene.time.delayedCall(5_000, () => {
        if (enemy.isAlive) {
          enemy.setPlayerControlled(false);
        }
      });
    }
  }
}
