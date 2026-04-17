/**
 * Venomantis — fast mantis that periodically vanishes and teleports behind
 * its target for a flanking ambush.
 *
 * ## Vanish cycle
 * Two timers drive the cycle:
 *   `vanishCooldown` — counts down each frame. Starts at 0 so the first
 *     vanish can fire as soon as an opponent is available. Resets to
 *     VANISH_CD_MS after the reappear flash completes.
 *   `vanishDuration` — counts down while invisible. When it reaches 0,
 *     the Venomantis reappears and the cooldown resets.
 *
 * ## Teleport position
 * "Behind the target" = 30–60 px past the target in the same direction the
 * Venomantis was approaching (i.e. the angle from Venomantis → target,
 * extended beyond the target). Clamped to the physics world bounds so the
 * entity never lands inside a wall.
 *
 * ## Physics during vanish
 * The arcade body is disabled (`body.enable = false`) so the invisible entity
 * can't be pushed by colliders and can't trigger overlaps. It is re-enabled
 * on reappear. The entity's position is still valid during the window; the
 * behaviour tree is skipped (velocity stays at zero).
 *
 * ## Appearance
 * Mantis-green rectangle with a small darker head accent.
 */

import * as Phaser from 'phaser';
import { CombatEntity, CombatEntityConfig } from './CombatEntity';
import { BtNode, BtSelector, BtSequence, BtCondition, BtAction } from '../ai/BehaviorTree';

// ── Config ──────────────────────────────────────────────────────────────────

const SPEED            = 90;   // px/s — faster than most enemies
const MELEE_R          = 30;   // px — melee reach
const ATTACK_DAMAGE    = 18;
const ATTACK_CD_MS     = 800;

const VANISH_CD_MS     = 5000; // ms between vanishes (reset on reappear)
const VANISH_DUR_MS    = 2000; // ms invisible
const TELEPORT_MIN     = 30;   // px past the target
const TELEPORT_MAX     = 60;

const COLOR_BODY   = 0x3a7d44;  // mantis green
const COLOR_HEAD   = 0x245c2e;  // darker green accent

// ── Venomantis ────────────────────────────────────────────────────────────────

export class Venomantis extends CombatEntity {
  private vanishCooldown  = 0;    // starts at 0 — first vanish fires immediately
  private vanishDuration  = 0;    // > 0 while invisible
  private isVanished      = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const config: CombatEntityConfig = {
      maxHp:            45,
      speed:            SPEED,
      aggroRadius:      160,
      attackDamage:     ATTACK_DAMAGE,
      color:            COLOR_BODY,
      meleeRange:       MELEE_R,
      attackCooldownMs: ATTACK_CD_MS,
    };
    super(scene, x, y, config);

    // Small head accent to suggest the mantis shape.
    const head = scene.add.rectangle(0, -10, 8, 6, COLOR_HEAD);
    this.add(head);
  }

  // ── Vanish cycle ───────────────────────────────────────────────────────────

  /**
   * Main vanish/reappear logic. Called at the top of `updateBehaviour` each
   * frame so the timers tick even while invisible. Returns `true` while
   * vanished so callers can skip normal behaviour tree execution.
   */
  private tickVanish(delta: number): boolean {
    if (this.isVanished) {
      // Count down the invisible window.
      this.vanishDuration -= delta;
      if (this.vanishDuration <= 0) this.reappear();
      return true;  // still vanished (or just reappeared — skip BT this frame)
    }

    // Count down the cooldown.
    this.vanishCooldown -= delta;
    if (this.vanishCooldown <= 0) {
      const opp = this.findNearestLivingOpponent();
      if (opp) {
        this.vanish(opp.x, opp.y);
        return true;
      }
      // No opponent yet — don't trigger vanish, but don't reset timer either
      // so it fires on the very next frame an opponent appears.
      this.vanishCooldown = 0;
    }

    return false;
  }

  private vanish(targetX: number, targetY: number): void {
    this.isVanished      = true;
    this.vanishDuration  = VANISH_DUR_MS;
    this.isTargetable    = false;
    this.setAlpha(0);

    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (physBody) {
      physBody.setVelocity(0, 0);
      physBody.enable = false;
    }

    // Teleport: 30–60 px past the target in the Venomantis→target direction.
    const angle    = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
    const distance = TELEPORT_MIN + Math.random() * (TELEPORT_MAX - TELEPORT_MIN);
    const rawX     = targetX + Math.cos(angle) * distance;
    const rawY     = targetY + Math.sin(angle) * distance;

    // Clamp to physics world bounds so the mantis never lands in a wall.
    const bounds = (this.scene as Phaser.Scene & { physics: Phaser.Physics.Arcade.ArcadePhysics }).physics.world.bounds;
    const cx = Phaser.Math.Clamp(rawX, bounds.x, bounds.right);
    const cy = Phaser.Math.Clamp(rawY, bounds.y, bounds.bottom);
    this.setPosition(cx, cy);
  }

  private reappear(): void {
    this.isVanished    = false;
    this.isTargetable  = true;

    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (physBody) physBody.enable = true;

    // Flash tween: alpha spike (0 → 1.5 → 1) over ~300 ms.
    this.scene.tweens.chain({
      targets: this,
      tweens: [
        { alpha: 1.5, duration: 150, ease: 'Cubic.easeOut' },
        { alpha: 1,   duration: 150, ease: 'Cubic.easeIn'  },
      ],
      onComplete: () => {
        // Reset cooldown only after the flash finishes — prevents chain-vanishing.
        this.vanishCooldown = VANISH_CD_MS;
      },
    });
  }

  // ── Behaviour tree ─────────────────────────────────────────────────────────

  override updateBehaviour(delta: number): void {
    if (this.tickVanish(delta)) return;
    super.updateBehaviour(delta);
  }

  protected override buildTree(): BtNode {
    return new BtSelector([

      // 1. Melee attack when in range.
      new BtSequence([
        new BtCondition(_ctx => {
          if (this.attackTimer > 0) return false;
          const opp = this.findNearestLivingOpponent();
          if (!opp) return false;
          return Phaser.Math.Distance.Between(this.x, this.y, opp.x, opp.y) < MELEE_R;
        }),
        new BtAction(ctx => {
          const opp = this.findNearestLivingOpponent();
          if (!opp) return 'failure';
          opp.takeDamage(this.attackDamage);
          opp.onHitBy(this.x, this.y);
          this.attackTimer = this.attackCooldownMs;
          ctx.stop();
          return 'success';
        }),
      ]),

      // 2. Chase the nearest opponent.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 3. Wander when no opponent.
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
