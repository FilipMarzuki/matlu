import { Enemy } from './Enemy';

// ── Visual constants ──────────────────────────────────────────────────────────

const BODY_SIZE = 40;
const BAR_W     = 56;
const BAR_H     = 5;
const BAR_Y     = -34;
const BODY_COLOR = 0x6600aa;   // dark purple

// ── Phase thresholds ──────────────────────────────────────────────────────────

/** Below this HP the boss enters phase 2 (faster charges + rabbit spawns). */
const PHASE_2_HP = 3;
/** Below this HP the boss enters phase 3 (even faster, larger burst). */
const PHASE_3_HP = 1;

/**
 * CorruptedGuardian — Level 1 boss.
 *
 * A large corrupted creature that patrols the portal zone. The player must
 * defeat it before the portal fully activates.
 *
 * ## Phases
 *   1 (HP 5–4): slow drift + 3 s charge cycle toward player (280 px/s, 600 ms)
 *   2 (HP ≤ 3): faster charges (360 px/s, 500 ms) + emits 'boss-spawn-rabbits'
 *               on the scene event bus every 8 s
 *   3 (HP ≤ 1): same as phase 2 but charges every 1.5 s
 *
 * ## Hit feedback
 * `onHitBy(fromX, fromY)` — call this after `takeDamage()` to trigger the
 * white body flash and knockback impulse. Handled by GameScene's trySwipe().
 *
 * ## Events emitted on scene bus
 *   'boss-died'              — on death (no payload)
 *   'boss-spawn-rabbits' x y — phase 2+: spawn 2 rabbits near (x, y)
 *   'boss-phase-change'  n   — when phase transitions to 2 or 3
 */
export class CorruptedGuardian extends Enemy {
  /** Current combat phase. GameScene listens to 'boss-phase-change' for transitions. */
  phase: 1 | 2 | 3 = 1;

  /** Callback returning current player world position; set via setTarget(). */
  private getPlayerPos: () => { x: number; y: number } = () => ({ x: this.x, y: this.y });

  // ── Charge state machine ──────────────────────────────────────────────────

  /** ms until the next charge begins. */
  private chargeTimer = 3000;
  private isCharging  = false;
  /** Remaining ms in the current charge burst. */
  private chargeTimeLeft = 0;
  private chargeVx = 0;
  private chargeVy = 0;

  // ── Phase 2 spawn timer ───────────────────────────────────────────────────

  private spawnTimer = 8000;

  // ── Visuals ───────────────────────────────────────────────────────────────

  private readonly bodyRect:   Phaser.GameObjects.Rectangle;
  private readonly hpBarFill:  Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:        5,
      speed:        60,
      aggroRadius:  600,
      attackDamage: 25,
    });

    // Body rectangle — large square, dark purple.
    this.bodyRect = scene.add.rectangle(0, 0, BODY_SIZE, BODY_SIZE, BODY_COLOR);
    this.add(this.bodyRect);

    // HP bar background (full width, dark).
    const hpBarBg = scene.add.rectangle(0, BAR_Y, BAR_W, BAR_H, 0x220033);
    this.add(hpBarBg);

    // HP bar fill — anchored at left edge so scaleX shrinks it rightward.
    this.hpBarFill = scene.add.rectangle(-BAR_W / 2, BAR_Y, BAR_W, BAR_H, 0xaa44ff);
    this.hpBarFill.setOrigin(0, 0.5);
    this.add(this.hpBarFill);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Provide a getter for the player's world position.
   * Called each frame to aim charges — avoids importing GameScene directly.
   */
  setTarget(fn: () => { x: number; y: number }): void {
    this.getPlayerPos = fn;
  }

  /**
   * Apply hit feedback: white body flash for 80 ms + knockback impulse.
   * Call immediately after takeDamage() from GameScene's trySwipe hook.
   */
  onHitBy(fromX: number, fromY: number): void {
    if (!this.isAlive) return;

    // Flash body rect white, then restore purple.
    // Rectangle uses setFillStyle (not setTint which is for Sprite/Image).
    this.bodyRect.setFillStyle(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.bodyRect.setFillStyle(BODY_COLOR);
    });

    // Brief knockback impulse away from attacker (~60 px over 120 ms).
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (physBody) {
      const angle = Math.atan2(this.y - fromY, this.x - fromX);
      physBody.setVelocity(Math.cos(angle) * 60, Math.sin(angle) * 60);
      this.scene.time.delayedCall(120, () => {
        if (this.active && this.isAlive) physBody.setVelocity(0, 0);
      });
    }
  }

  // ── Enemy hook ─────────────────────────────────────────────────────────────

  protected override updateBehaviour(delta: number): void {
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    const target   = this.getPlayerPos();

    // ── Phase transitions (checked every frame, guarded to fire only once) ──
    if (this.hp <= PHASE_2_HP && this.phase < 2) {
      this.phase = 2;
      this.scene.events.emit('boss-phase-change', 2);
    }
    if (this.hp <= PHASE_3_HP && this.phase < 3) {
      this.phase = 3;
      this.scene.events.emit('boss-phase-change', 3);
    }

    // ── Charge state machine ─────────────────────────────────────────────────
    //
    // Re-apply charge velocity every frame while active so BT-style drift
    // logic below can't accidentally cancel the burst mid-charge.
    if (this.isCharging) {
      this.chargeTimeLeft -= delta;
      if (this.chargeTimeLeft <= 0) {
        this.isCharging = false;
        physBody?.setVelocity(0, 0);
        // Cooldown before next charge depends on phase.
        this.chargeTimer = this.phase >= 3 ? 1500 : this.phase >= 2 ? 2000 : 3000;
      } else {
        physBody?.setVelocity(this.chargeVx, this.chargeVy);
      }
      this.refreshHpBar();
      return;
    }

    // ── Wind-up countdown ────────────────────────────────────────────────────
    this.chargeTimer -= delta;
    if (this.chargeTimer <= 0) {
      // Aim toward player's CURRENT position and launch the burst.
      const dx  = target.x - this.x;
      const dy  = target.y - this.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // Phase 2+ charges are noticeably faster.
      const spd = this.phase >= 2 ? 360 : 280;
      this.chargeVx      = (dx / len) * spd;
      this.chargeVy      = (dy / len) * spd;
      this.chargeTimeLeft = this.phase >= 2 ? 500 : 600;
      this.isCharging    = true;
      physBody?.setVelocity(this.chargeVx, this.chargeVy);
      this.refreshHpBar();
      return;
    }

    // ── Between charges: slow drift toward player ────────────────────────────
    const dx  = target.x - this.x;
    const dy  = target.y - this.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    physBody?.setVelocity(
      (dx / len) * this.speed * 0.35,
      (dy / len) * this.speed * 0.35,
    );

    // ── Phase 2+: periodic rabbit spawns ────────────────────────────────────
    if (this.phase >= 2) {
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 8000;
        // Scene handles the actual spawn to stay decoupled from GameScene internals.
        this.scene.events.emit('boss-spawn-rabbits', this.x, this.y);
      }
    }

    this.refreshHpBar();
  }

  // ── LivingEntity hook ──────────────────────────────────────────────────────

  protected override onDeath(): void {
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    physBody?.setVelocity(0, 0);
    this.setAlpha(0.2);

    // Purple arc burst — 8 particles, larger radius than regular enemies.
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const dot = this.scene.add.arc(this.x, this.y, 5, 0, 360, false, 0xaa44ff);
      dot.setDepth(this.depth + 1);
      this.scene.tweens.add({
        targets:  dot,
        x:        this.x + Math.cos(angle) * 50,
        y:        this.y + Math.sin(angle) * 50,
        alpha:    { from: 1, to: 0 },
        duration: 350,
        ease:     'Cubic.easeOut',
        onComplete: () => dot.destroy(),
      });
    }

    this.scene.events.emit('boss-died');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private refreshHpBar(): void {
    this.hpBarFill.scaleX = Math.max(0, this.hpFraction);
  }
}
