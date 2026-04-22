/**
 * ScoutDrone — orbiting drone that harasses nearby enemies.
 *
 * Spec (#519):
 *   HP 20, lifetime 20 s. Orbits the owner at 120 px radius at 1.2 rad/s.
 *   Fires at the nearest enemy within 100 px every 1.2 s for 3 damage.
 *   Vision extension (fog-of-war reveal) is a no-op placeholder — no vision
 *   system is in place yet; the comment marks where it should hook in.
 *
 * Placeholder visual: small blue filled circle (12 px diameter).
 * Real sprite: "Small quadcopter, blue running lights, camera eye, 12×12 top-down
 * with subtle shadow." — sprite-credit-burn agent.
 */

import * as Phaser from 'phaser';
import { Deployable } from '../Deployable';
import { Projectile, Damageable } from '../Projectile';
import { DRONE } from '../../data/deployableConfigs';

interface Target extends Damageable {
  isAlive: boolean;
}

export class ScoutDrone extends Deployable {
  private readonly getTargets: () => readonly Target[];
  /** Current orbit angle in radians. */
  private orbitAngle  = 0;
  /** Accumulated ms since last shot. */
  private fireTimer   = 0;
  /** Placeholder visual. */
  private readonly disc: Phaser.GameObjects.Arc;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    owner: Phaser.GameObjects.GameObject,
    getTargets: () => readonly Target[],
  ) {
    super(scene, x, y, '__DEFAULT', owner, DRONE.lifetimeMs, DRONE.maxHp);
    this.setVisible(false);

    this.getTargets = getTargets;

    // Start the drone just above the owner.
    this.orbitAngle = -Math.PI / 2;

    // Placeholder: blue circle.
    this.disc = scene.add.circle(x, y, 6, DRONE.shotColor, 0.85).setDepth(2);
  }

  override tick(delta: number): boolean {
    if (this.hp <= 0) return false;

    this.lifetimeMs -= delta;
    if (this.lifetimeMs <= 0) return false;

    // ── Orbit ─────────────────────────────────────────────────────────────────
    const ownerObj = this.owner as unknown as { x: number; y: number };
    const ownerX = ownerObj.x;
    const ownerY = ownerObj.y;

    this.orbitAngle += DRONE.orbitSpeedRad * (delta / 1000);
    const nx = ownerX + Math.cos(this.orbitAngle) * DRONE.orbitRadius;
    const ny = ownerY + Math.sin(this.orbitAngle) * DRONE.orbitRadius;

    // Teleport the sprite position (base class x/y) to follow orbit path.
    this.x = nx;
    this.y = ny;
    this.disc.x = nx;
    this.disc.y = ny;

    // ── Vision extend (no-op placeholder) ────────────────────────────────────
    // Future: call vision system to reveal a 150 px circle at (nx, ny).

    // ── Harass fire ──────────────────────────────────────────────────────────
    this.fireTimer += delta;
    if (this.fireTimer >= DRONE.fireIntervalMs) {
      this.fireTimer = 0;
      const target = this.nearestTarget(nx, ny);
      if (target) {
        const angle = Math.atan2(target.y - ny, target.x - nx);
        const p = new Projectile(
          this.scene, nx, ny, angle,
          DRONE.shotSpeed, DRONE.shotDamage, DRONE.shotColor,
          this.getTargets() as Damageable[],
          undefined,
          undefined,
          undefined,
          this,
        );
        this.scene.events.emit('projectile-spawned', p);
      }
    }

    return true;
  }

  private nearestTarget(fromX: number, fromY: number): Target | null {
    let nearest: Target | null = null;
    let minDist = DRONE.fireRadius;
    for (const t of this.getTargets()) {
      if (!t.isAlive) continue;
      const d = Phaser.Math.Distance.Between(fromX, fromY, t.x, t.y);
      if (d < minDist) { minDist = d; nearest = t; }
    }
    return nearest;
  }

  override cleanup(): void {
    this.disc.destroy();
    super.cleanup();
  }
}
