import * as Phaser from 'phaser';
import { LivingEntity } from './LivingEntity';
import { emitDigBurst } from './Velcrid';

const HOLE_RADIUS = 20;
const CRACK_COUNT = 5;

/**
 * BurrowHole — a procedurally-drawn underground entry point that Velcrids
 * spawn from. All visuals are Phaser Graphics (no sprite needed).
 *
 * Four visual states driven by HP and spawn timing:
 *   idle       — dark circle, alpha pulse tween
 *   pre-spawn  — inner glow brightens ~800 ms before a spawn event
 *   damaged    — crack arcs grow proportional to missing HP
 *   destroyed  — scale-to-zero tween + dig-burst particles
 */
export class BurrowHole extends LivingEntity {
  private gfx: Phaser.GameObjects.Graphics;
  private idleTween: Phaser.Tweens.Tween | null = null;
  private preSpawnActive = false;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp = 3) {
    super(scene, x, y, { maxHp });
    this.gfx = scene.add.graphics();
    this.add(this.gfx);
    this.updateVisuals(1);
    this.startIdlePulse();
  }

  // Entity requires this — BurrowHole is stationary so nothing to do each frame.
  override update(_delta: number): void { /* stationary */ }

  /** Begin the pre-spawn glow ~800 ms before the 'hole-spawned' event fires. */
  startPreSpawnGlow(): void {
    this.preSpawnActive = true;
    this.updateVisuals(this.hpFraction);
  }

  /** Revert to normal visuals after the spawn event fires. */
  endPreSpawnGlow(): void {
    this.preSpawnActive = false;
    this.updateVisuals(this.hpFraction);
  }

  protected override onDamaged(_amount: number): void {
    this.updateVisuals(this.hpFraction);
  }

  protected override onDeath(): void {
    // Guard against scene already shutting down before the tween can play.
    if (!this.scene?.sys.isActive()) {
      super.onDeath();
      return;
    }
    this.idleTween?.stop();
    // Scale the whole Container to zero so the gfx child collapses with it.
    this.scene.tweens.add({
      targets: this,
      scaleX: 0.1,
      scaleY: 0.1,
      duration: 400,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        emitDigBurst(this.scene, this.x, this.y);
        // Call super.onDeath() only now so destroy() doesn't cancel the tween.
        super.onDeath();
      },
    });
  }

  private startIdlePulse(): void {
    this.idleTween = this.scene.tweens.add({
      targets: this,
      alpha: { from: 0.7, to: 1.0 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Redraws all visuals from scratch. Called only on state transitions
   * (damage, pre-spawn start/end) — not every frame — to avoid per-frame
   * Graphics buffer clears.
   */
  private updateVisuals(hpFraction: number): void {
    this.gfx.clear();

    // Base hole — dark grey normally, warm off-white when a spawn is imminent.
    const baseColor = this.preSpawnActive ? 0xddddcc : 0x333333;
    this.gfx.fillStyle(baseColor, 1);
    this.gfx.fillCircle(0, 0, HOLE_RADIUS);

    // Inner glow visible only during pre-spawn.
    if (this.preSpawnActive) {
      this.gfx.fillStyle(0xffffff, 0.8);
      this.gfx.fillCircle(0, 0, 10);
    }

    // Crack lines — none at full HP, max CRACK_COUNT at 1 HP.
    const crackCount = Math.round((1 - hpFraction) * CRACK_COUNT);
    if (crackCount > 0) {
      this.gfx.lineStyle(1.5, 0x111111, 1);
      // Cracks extend further as HP drops.
      const maxLen = HOLE_RADIUS * (1 - hpFraction + 0.3);
      for (let i = 0; i < crackCount; i++) {
        const angle = (i / CRACK_COUNT) * Math.PI * 2;
        this.gfx.strokeLineShape(new Phaser.Geom.Line(
          0, 0,
          Math.cos(angle) * maxLen,
          Math.sin(angle) * maxLen,
        ));
      }
    }
  }
}
