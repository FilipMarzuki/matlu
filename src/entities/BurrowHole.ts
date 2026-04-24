import * as Phaser from 'phaser';
import { LivingEntity } from './LivingEntity';
import { CombatEntity } from './CombatEntity';
import { emitDigBurst } from './Velcrid';

const HOLE_RADIUS = 20;
const CRACK_COUNT = 5;

/** Constructor type for any CombatEntity subclass that takes (scene, x, y). */
type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number) => CombatEntity;

/** How long before each spawn the pre-spawn glow is shown (ms). */
const PRE_SPAWN_WARN_MS = 800;

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
  private spawnTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp = 3) {
    super(scene, x, y, { maxHp });
    this.gfx = scene.add.graphics();
    this.add(this.gfx);
    this.updateVisuals(1);
    this.startIdlePulse();
  }

  // Entity requires this — BurrowHole is stationary so nothing to do each frame.
  override update(_delta: number): void { /* stationary */ }

  // ── Spawning ──────────────────────────────────────────────────────────────

  /**
   * Begin periodically spawning enemies of the given type.
   * The first spawn fires after `intervalMs`; subsequent spawns repeat at the
   * same interval.  Calling again replaces any existing timer.
   *
   * The hole emits `'hole-spawned'` carrying the new `CombatEntity` instance
   * each time a spawn occurs.  The listener (typically `CombatArenaScene`) is
   * responsible for adding the enemy to physics and the `aliveEnemies` array.
   */
  startSpawning(enemyCtor: EnemyCtor, intervalMs: number): void {
    this.stopSpawning();
    this.spawnTimer = this.scene.time.addEvent({
      delay:         intervalMs,
      callback:      () => this.doSpawnCycle(enemyCtor),
      callbackScope: this,
      loop:          true,
    });
  }

  /**
   * Stop the recurring spawn timer.  Safe to call even if not spawning.
   * Called automatically in `onDeath()` so ghost timers can't fire after the
   * hole is destroyed.
   */
  stopSpawning(): void {
    if (this.spawnTimer) {
      this.spawnTimer.remove();
      this.spawnTimer = null;
    }
  }

  /**
   * One full spawn cycle: show the pre-spawn glow, wait, then create the
   * enemy with a crawl-out animation.
   *
   * The `PRE_SPAWN_WARN_MS` delay gives the player visual warning so the spawn
   * doesn't feel completely random — the hole briefly brightens before anything
   * crawls out.
   */
  private doSpawnCycle(enemyCtor: EnemyCtor): void {
    if (!this.isAlive || !this.scene?.sys.isActive()) return;

    this.startPreSpawnGlow();

    this.scene.time.delayedCall(PRE_SPAWN_WARN_MS, () => {
      if (!this.isAlive || !this.scene?.sys.isActive()) return;
      this.endPreSpawnGlow();

      // Use stored world coords for enemy spawn (this.x/y may be iso-projected).
      const wx = (this.getData('worldX') as number) ?? this.x;
      const wy = (this.getData('worldY') as number) ?? this.y;
      const enemy = new enemyCtor(this.scene, wx, wy);
      enemy.setScale(0);

      this.scene.tweens.add({
        targets:  enemy,
        scaleX:   1,
        scaleY:   1,
        duration: 300,
        ease:     'Back.easeOut',
      });

      emitDigBurst(this.scene, this.x, this.y);

      // Notify the scene.  The listener is responsible for addPhysics(),
      // setOpponent(), and pushing into aliveEnemies — keeping physics wiring
      // out of this entity.
      this.emit('hole-spawned', enemy);
    });
  }

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
    // Stop the spawn timer immediately so no ghost spawns fire during the
    // death animation or after the Container is destroyed.
    this.stopSpawning();
    this.emit('hole-destroyed');

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
