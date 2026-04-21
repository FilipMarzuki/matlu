/**
 * ProximityMine — pressure-plate explosive placed by the CombatEngineer.
 *
 * Spec (#519):
 *   HP 1 (one-shot), lifetime 90 s (long — strategic placement).
 *   Arms after 800 ms (amber pulse while arming). Triggers when any enemy
 *   enters 32 px radius. Blast: 30 damage at epicentre, half-falloff at 40 px.
 *   Enemies do not path-find around mines — they run over them.
 *
 * Placeholder visual: amber disc (10 px) that pulses brighter once armed.
 * Real sprite: "Flat disc with arming LED, 10×10, blends with floor once armed
 * (subtle pulse)." — sprite-credit-burn agent.
 */

import * as Phaser from 'phaser';
import { Deployable } from '../Deployable';
import { Damageable } from '../Projectile';
import { MINE } from '../../data/deployableConfigs';

interface Target extends Damageable {
  isAlive: boolean;
  x: number;
  y: number;
}

export class ProximityMine extends Deployable {
  private readonly getTargets: () => readonly Target[];
  private armTimer  = 0;
  private armed     = false;
  private detonated = false;
  private readonly disc: Phaser.GameObjects.Arc;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    owner: Phaser.GameObjects.GameObject,
    getTargets: () => readonly Target[],
  ) {
    super(scene, x, y, '__DEFAULT', owner, MINE.lifetimeMs, MINE.maxHp);
    this.setVisible(false);
    this.getTargets = getTargets;

    // Amber disc — dims while unarmed, full brightness when armed.
    this.disc = scene.add.circle(x, y, 5, 0xffaa00, 0.45).setDepth(1);
  }

  override tick(delta: number): boolean {
    if (this.detonated || this.hp <= 0) return false;

    this.lifetimeMs -= delta;
    if (this.lifetimeMs <= 0) return false;

    // ── Arming delay ─────────────────────────────────────────────────────────
    if (!this.armed) {
      this.armTimer += delta;
      // Pulse the alpha between 0.3 and 0.7 while arming.
      const pulse = 0.3 + 0.4 * Math.abs(Math.sin(this.armTimer / 200));
      this.disc.setAlpha(pulse);
      if (this.armTimer >= MINE.armDelayMs) {
        this.armed = true;
        this.disc.setAlpha(0.9); // full brightness when armed
      }
      return true;
    }

    // ── Trigger check ─────────────────────────────────────────────────────────
    for (const t of this.getTargets()) {
      if (!t.isAlive) continue;
      if (Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y) <= MINE.triggerRadius) {
        this.detonate();
        return false;
      }
    }

    return true;
  }

  private detonate(): void {
    this.detonated = true;

    // Apply blast damage to all enemies in range with linear falloff.
    for (const t of this.getTargets()) {
      if (!t.isAlive) continue;
      const dist = Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y);
      if (dist > MINE.blastRadius) continue;
      // Linear falloff: full damage at 0, half at edge.
      const falloff = 1 - (dist / MINE.blastRadius) * 0.5;
      t.takeDamage(Math.round(MINE.blastDamage * falloff));
    }

    // Flash graphic and let the arena know for camera shake.
    this.scene.events.emit('mine-detonated', this.x, this.y);
  }

  override cleanup(): void {
    this.disc.destroy();
    super.cleanup();
  }
}
