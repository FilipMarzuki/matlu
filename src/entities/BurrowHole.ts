import * as Phaser from 'phaser';
import { LivingEntity } from './LivingEntity';
import { CombatEntity } from './CombatEntity';
import { emitDigBurst } from './Velcrid';


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
  private sprite: Phaser.GameObjects.Image;
  private idleTween: Phaser.Tweens.Tween | null = null;
  private spawnTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp = 3) {
    super(scene, x, y, { maxHp });
    // Use sprite if texture exists, fall back to placeholder if not loaded.
    const texKey = scene.textures.exists('burrow-idle') ? 'burrow-idle' : '__DEFAULT';
    this.sprite = scene.add.image(0, 0, texKey).setOrigin(0.5, 0.5);
    this.add(this.sprite);
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
    if (this.scene.textures.exists('burrow-active')) {
      this.sprite.setTexture('burrow-active');
    }
  }

  endPreSpawnGlow(): void {
    if (this.scene.textures.exists('burrow-idle')) {
      this.sprite.setTexture('burrow-idle');
    }
  }

  protected override onDamaged(_amount: number): void {
    // Flash red on hit.
    this.sprite.setTint(0xff4444);
    this.scene.time.delayedCall(100, () => this.sprite.clearTint());
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
    // Swap to destroyed sprite, then shrink and destroy.
    if (this.scene.textures.exists('burrow-destroyed')) {
      this.sprite.setTexture('burrow-destroyed');
    }
    this.scene.tweens.add({
      targets: this,
      scaleX: 0.1,
      scaleY: 0.1,
      duration: 400,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        emitDigBurst(this.scene, this.x, this.y);
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

}
