import * as Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';

// ── Orbit constants ───────────────────────────────────────────────────────────
/** Distance at which the bird enters its circling orbit rather than chasing. */
const ORBIT_MIN = 100;
const ORBIT_MAX = 360;
/** Blend factor: how strongly the bird is pulled inward to maintain orbit range. */
const ORBIT_INWARD = 0.18;

/**
 * FarggladKordororn ("Vivid Condor Eagle") — submission by Loke Marzuki (age 9).
 *
 * Apex soarer in the earth world. Circles high above the player before stooping
 * in a fast dive attack. Patient — it waits for the right moment rather than
 * charging immediately.
 *
 * Behaviour tree:
 *   1. Talon strike when within melee range (80px) — wide-range contact attack
 *   2. Stoop dive (gap-closer dash) from 120–360px, on a 3.5s cooldown
 *   3. Orbit fallback: when 100–360px away and dive is on cooldown, circles
 *      perpendicular to the player
 *   4. Chase — close distance from outside orbit range
 *   5. Wander — pre-aggro patrol
 */
export class FarggladKordororn extends CombatEntity {
  /** Current circle direction: +1 = CCW, -1 = CW. Flips randomly while orbiting. */
  private circleDir    = Math.random() < 0.5 ? 1 : -1;
  /** Timer until next direction flip (ms). */
  private circleDirMs  = Phaser.Math.Between(2000, 5000);
  /** True while the BT chose orbit this frame (set in buildTree, read in updateBehaviour). */
  private isOrbiting   = false;
  /** The opponent position captured by the BT, used by the orbit post-step. */
  private orbitTargetX = 0;
  private orbitTargetY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:               60,
      speed:               85,
      aggroRadius:         450,
      attackDamage:        10,
      color:               0x8b6914,   // ochre-brown fallback
      meleeRange:          80,
      attackCooldownMs:    1400,
      dashSpeedMultiplier: 6.0,        // fast stoop dive
      dashDurationMs:      200,
      sightMemoryMs:       2000,
      hearingRadius:       220,
      spriteKey:           'fargglad-kordororn',
    });
  }

  /**
   * After the BT runs, layer on the orbit movement when flagged.
   * Dashing is handled by CombatEntity (setVelocity lock); we skip override
   * velocity when frozen.
   */
  override updateBehaviour(delta: number): void {
    this.isOrbiting = false;    // reset before BT tick
    super.updateBehaviour(delta);

    if (!this.isOrbiting || this.frozen) return;

    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!physBody) return;

    // Flip circle direction occasionally for unpredictability
    this.circleDirMs -= delta;
    if (this.circleDirMs <= 0) {
      if (Math.random() < 0.35) this.circleDir *= -1;
      this.circleDirMs = Phaser.Math.Between(1500, 4500);
    }

    const dx  = this.orbitTargetX - this.x;
    const dy  = this.orbitTargetY - this.y;
    const len = Math.hypot(dx, dy) || 1;

    // Perpendicular unit vector (CCW or CW based on circleDir)
    const perpX = (-dy / len) * this.circleDir;
    const perpY = ( dx / len) * this.circleDir;

    // Blend: orbit tangent + weak radial pull to maintain range
    const vx = (perpX + (dx / len) * ORBIT_INWARD) * this.speed;
    const vy = (perpY + (dy / len) * ORBIT_INWARD) * this.speed;
    physBody.setVelocity(vx, vy);
  }

  protected buildTree(): BtNode {
    const MELEE_R  = this.meleeRange;   // 80
    const DIVE_MIN = 120;
    const DIVE_MAX = ORBIT_MAX;         // 360

    return new BtSelector([

      // ── 1. Talon strike on contact ─────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
            < MELEE_R,
        ),
        new BtAction(ctx => {
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // ── 2. Stoop dive — fast dash when at optimal range, on cooldown ───────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= DIVE_MIN && d <= DIVE_MAX;
          }),
          new BtAction(ctx => {
            ctx.dash(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        3500,   // 3.5s between stoops
      ),

      // ── 3. Orbit — circle when within range but dive is on cooldown ────────
      // Sets isOrbiting flag; actual velocity is applied in updateBehaviour
      // after super() so it runs outside the BT context closure.
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
          return d >= ORBIT_MIN && d <= ORBIT_MAX;
        }),
        new BtAction(ctx => {
          this.isOrbiting   = true;
          this.orbitTargetX = ctx.opponent!.x;
          this.orbitTargetY = ctx.opponent!.y;
          // Stop base movement; orbit velocity is applied in updateBehaviour
          ctx.stop();
          return 'running';
        }),
      ]),

      // ── 4. Chase — close distance from outside orbit range ─────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 5. Wander (pre-aggro patrol) ──────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
