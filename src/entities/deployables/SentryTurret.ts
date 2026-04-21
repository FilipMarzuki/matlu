/**
 * SentryTurret — stationary auto-fire turret placed by the CombatEngineer.
 *
 * Spec (#519):
 *   HP 40, lifetime 25 s. Scans for the nearest enemy within 180 px every 400 ms.
 *   Fires once per 600 ms for 8 damage. Visually rotates toward its current target.
 *
 * Placeholder visual: olive-drab filled rectangle (16×8) with a barrel line (4×3).
 * Real sprite: "Tripod-mounted autocannon, blinking green scanner LED, 16×16
 * top-down pixel art, milspec olive-drab." — sprite-credit-burn agent.
 */

import * as Phaser from 'phaser';
import { Deployable } from '../Deployable';
import { Projectile, Damageable } from '../Projectile';
import { TURRET } from '../../data/deployableConfigs';

/** Minimal interface the turret needs from potential targets. */
interface Target extends Damageable {
  isAlive: boolean;
}

export class SentryTurret extends Deployable {
  private readonly getTargets: () => readonly Target[];
  /** Accumulated ms since last target scan. */
  private scanTimer    = 0;
  /** Accumulated ms since last shot. */
  private fireTimer    = 0;
  /** Currently locked target. Re-acquired on scanTimer expiry. */
  private lockedTarget: Target | null = null;
  /** Visual body rectangle (placeholder). Named baseRect to avoid shadowing Phaser's .body. */
  private readonly baseRect: Phaser.GameObjects.Rectangle;
  /** Visual barrel (placeholder). */
  private readonly barrel: Phaser.GameObjects.Rectangle;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    owner: Phaser.GameObjects.GameObject,
    getTargets: () => readonly Target[],
  ) {
    // '__DEFAULT' = Phaser's built-in 1×1 white texture; we render via child graphics.
    super(scene, x, y, '__DEFAULT', owner, TURRET.lifetimeMs, TURRET.maxHp);
    this.setVisible(false); // hide the Sprite; visuals are child objects below

    this.getTargets = getTargets;

    // Placeholder visuals — olive-drab 16×8 block + 4×3 barrel indicator.
    this.baseRect = scene.add.rectangle(x, y, 16, 8,  0x556b2f).setDepth(1);
    this.barrel   = scene.add.rectangle(x, y - 6, 4, 3, 0x444444).setDepth(1);
  }

  override tick(delta: number): boolean {
    if (this.hp <= 0) return false;

    this.lifetimeMs -= delta;
    if (this.lifetimeMs <= 0) return false;

    // ── Target acquisition ──────────────────────────────────────────────────
    this.scanTimer += delta;
    if (this.scanTimer >= TURRET.scanIntervalMs) {
      this.scanTimer = 0;
      this.lockedTarget = this.acquireTarget();
    }

    // ── Rotation & fire ─────────────────────────────────────────────────────
    if (this.lockedTarget && this.lockedTarget.isAlive) {
      const angle = Math.atan2(
        this.lockedTarget.y - this.y,
        this.lockedTarget.x - this.x,
      );
      // Rotate barrel visuals toward target.
      this.barrel.x = this.x + Math.cos(angle) * 8;
      this.barrel.y = this.y + Math.sin(angle) * 8;

      this.fireTimer += delta;
      if (this.fireTimer >= TURRET.fireIntervalMs) {
        this.fireTimer = 0;
        this.fire(angle);
      }
    } else {
      this.fireTimer = 0;
    }

    // Sync visual position.
    this.baseRect.x = this.x;
    this.baseRect.y = this.y;

    return true;
  }

  private acquireTarget(): Target | null {
    let nearest: Target | null = null;
    let minDist = TURRET.scanRadius;
    for (const t of this.getTargets()) {
      if (!t.isAlive) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y);
      if (d < minDist) { minDist = d; nearest = t; }
    }
    return nearest;
  }

  private fire(angle: number): void {
    const p = new Projectile(
      this.scene,
      this.x,
      this.y,
      angle,
      TURRET.shotSpeed,
      TURRET.shotDamage,
      TURRET.shotColor,
      this.getTargets() as Damageable[],
    );
    // The arena scene listens for 'projectile-spawned' and adds projectiles to
    // its tick loop. See CombatArenaScene line ~391.
    this.scene.events.emit('projectile-spawned', p);
  }

  override cleanup(): void {
    this.baseRect.destroy();
    this.barrel.destroy();
    super.cleanup();
  }
}
