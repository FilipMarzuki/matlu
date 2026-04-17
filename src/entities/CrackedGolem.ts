import * as Phaser from 'phaser';
import { Enemy } from './Enemy';
import { Projectile } from './Projectile';
import type { Damageable } from './Projectile';

const BODY_SIZE  = 26;
const BAR_W      = 38;
const BAR_H      = 4;
const BAR_Y      = -22;
const BODY_COLOR = 0x7a5c3e;   // earthy stone-brown

// Re-randomise movement direction every ~1 s with ±250 ms variance so the
// pattern doesn't feel mechanical.
const JITTER_BASE_MS     = 1000;
const JITTER_VARIANCE_MS =  250;

const BURST_SPEED     = 180;   // px/s
const BURST_DAMAGE    =  10;
const BURST_COLOR     = 0xcc8844;
const BURST_HIT_R     =  20;   // px
const BURST_MAX_RANGE =  320;  // px

/**
 * CrackedGolem — mid-map enemy that wanders erratically and explodes into a
 * ring of 8 projectiles on death.
 *
 * Movement: `jitterTimer` counts down each frame (using delta in ms). When it
 * reaches 0 a new random velocity is applied and the timer resets.
 *
 * Death burst: `onDeath()` creates 8 `Projectile` instances at 45° intervals
 * and emits `'golem-death-burst'` on the scene event bus so the scene can
 * collect and tick them each frame.
 */
export class CrackedGolem extends Enemy {
  /** ms remaining until the next random direction change. */
  private jitterTimer = 0;

  /** Returns the player as a Damageable; set via setPlayerTarget(). */
  private getPlayer: () => Damageable | null = () => null;

  private readonly bodyRect:  Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:        3,
      speed:        55,
      aggroRadius:  380,
      attackDamage: 15,
    });

    this.bodyRect = scene.add.rectangle(0, 0, BODY_SIZE, BODY_SIZE, BODY_COLOR);
    this.add(this.bodyRect);

    const hpBarBg = scene.add.rectangle(0, BAR_Y, BAR_W, BAR_H, 0x1a0d00);
    this.add(hpBarBg);

    // Anchored at left edge so scaleX shrinks it rightward as HP drops.
    this.hpBarFill = scene.add.rectangle(-BAR_W / 2, BAR_Y, BAR_W, BAR_H, 0xcc8844);
    this.hpBarFill.setOrigin(0, 0.5);
    this.add(this.hpBarFill);
  }

  /**
   * Provide the player entity as a Damageable so death-burst projectiles can
   * target it. Called once after construction from GameScene.
   */
  setPlayerTarget(fn: () => Damageable | null): void {
    this.getPlayer = fn;
  }

  /**
   * White-flash feedback + brief knockback impulse. Call from GameScene after
   * `takeDamage()` — mirrors the CorruptedGuardian pattern.
   */
  onHitBy(fromX: number, fromY: number): void {
    if (!this.isAlive) return;
    this.bodyRect.setFillStyle(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.bodyRect.setFillStyle(BODY_COLOR);
    });
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (physBody) {
      const angle = Math.atan2(this.y - fromY, this.x - fromX);
      physBody.setVelocity(Math.cos(angle) * 60, Math.sin(angle) * 60);
      this.scene.time.delayedCall(120, () => {
        if (this.active && this.isAlive) physBody.setVelocity(0, 0);
      });
    }
  }

  // ── Enemy hook ──────────────────────────────────────────────────────────────

  protected override updateBehaviour(delta: number): void {
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;

    // Decrement jitter countdown each frame using delta (ms) so behaviour is
    // frame-rate independent. On expiry pick a fresh random heading.
    this.jitterTimer -= delta;
    if (this.jitterTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      physBody?.setVelocity(
        Math.cos(angle) * this.speed,
        Math.sin(angle) * this.speed,
      );
      this.jitterTimer = JITTER_BASE_MS + (Math.random() - 0.5) * 2 * JITTER_VARIANCE_MS;
    }

    this.hpBarFill.scaleX = Math.max(0, this.hpFraction);
  }

  // ── LivingEntity hook ───────────────────────────────────────────────────────

  protected override onDeath(): void {
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    physBody?.setVelocity(0, 0);

    const player  = this.getPlayer();
    const targets: Damageable[] = player ? [player] : [];

    // Fire 8 projectiles evenly spaced at 45° (π/4 rad) intervals.
    // Each Projectile registers itself in the scene's display list on construction
    // and self-destructs on hit, range exceeded, or going off-bounds.
    const projectiles: Projectile[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      projectiles.push(new Projectile(
        this.scene,
        this.x,
        this.y,
        angle,
        BURST_SPEED,
        BURST_DAMAGE,
        BURST_COLOR,
        targets,
        BURST_HIT_R,
        BURST_MAX_RANGE,
      ));
    }

    // Emit so GameScene can collect projectiles into its tick list.
    this.scene.events.emit('golem-death-burst', projectiles);

    // Crumble visual: partial fade + dust-particle ring.
    this.setAlpha(0.2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const dot = this.scene.add.arc(this.x, this.y, 4, 0, 360, false, 0x8b6543);
      dot.setDepth(this.depth + 1);
      this.scene.tweens.add({
        targets:  dot,
        x:        this.x + Math.cos(a) * 30,
        y:        this.y + Math.sin(a) * 30,
        alpha:    { from: 1, to: 0 },
        duration: 280,
        ease:     'Cubic.easeOut',
        onComplete: () => dot.destroy(),
      });
    }
  }
}
