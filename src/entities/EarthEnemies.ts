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

// ── Earth enemies — corrupted machines and soldiers ───────────────────────────
//
// Three enemy types themed around a decaying Earth faction:
//   GlitchDrone    — tiny survey drone, erratic flight, kamikaze contact dash
//   StaticCrawler  — decommissioned ground robot, freezes heroes on hit,
//                    EMP burst on death
//   RustBerserker  — armour-fused soldier, ignores weak hits (< 8 damage)

// ── Strength of random velocity jitter per tick ───────────────────────────────
const DRONE_JITTER   = 110;  // large — creates very erratic flight
const BERSERK_JITTER =  40;  // smaller — adds unpredictability without chaos

/**
 * GlitchDrone — tiny corrupted survey drone. Very low HP (10), fast speed.
 * Spawns in groups of 4 (two groups of 4 make the intended swarm of 8 while
 * staying under MAX_ALIVE). Randomised velocity jitter each tick makes the
 * drone hard to track. Kamikaze dashes straight at the hero on contact range.
 */
export class GlitchDrone extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            10,
      speed:            145,
      aggroRadius:      500,
      attackDamage:     5,
      color:            0x00ffcc,   // glitchy teal
      meleeRange:       22,
      attackCooldownMs: 500,
      // Fast dash for the kamikaze contact attack
      dashSpeedMultiplier: 5.5,
      dashDurationMs:      130,
      // Short sight memory — dumb swarm creature that loses the trail quickly
      sightMemoryMs: 800,
    });
  }

  /**
   * Add random velocity jitter on top of whatever the BT set this frame.
   * Called after super.updateBehaviour() so it runs after the BT resolves
   * movement — the perturbation is layered on top of the chase direction.
   */
  override updateBehaviour(delta: number): void {
    super.updateBehaviour(delta);
    // Skip jitter while frozen — velocity is already locked at zero
    if (this.frozen) return;
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!physBody) return;
    physBody.setVelocity(
      physBody.velocity.x + (Math.random() - 0.5) * DRONE_JITTER,
      physBody.velocity.y + (Math.random() - 0.5) * DRONE_JITTER,
    );
  }

  protected buildTree(): BtNode {
    const CONTACT_R = this.meleeRange * 2.5;   // kamikaze range — wider than plain melee

    return new BtSelector([

      // ── 1. Kamikaze dash + bite on contact ────────────────────────────────
      // Dash into the hero and immediately bite. The dash brings the drone in
      // faster than normal movement, compounding the erratic-flight effect.
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
            < CONTACT_R,
        ),
        new BtAction(ctx => {
          ctx.dash(ctx.opponent!.x, ctx.opponent!.y);
          ctx.attack();
          return 'success';
        }),
      ]),

      // ── 2. Chase ──────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 3. Wander (fallback) ──────────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}

/**
 * StaticCrawler — decommissioned ground robot. Medium HP (60), medium speed.
 *
 * Two special mechanics:
 *   - Melee hit applies the `frozen` flag to the target for 1.5 s (the hero
 *     cannot move while frozen).
 *   - On death: EMP burst that sets `signatureDisabled` on the nearest living
 *     hero for 3 000 ms.
 */
export class StaticCrawler extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            60,
      speed:            78,
      aggroRadius:      420,
      attackDamage:     10,
      color:            0x8888aa,   // cold steel
      meleeRange:       30,
      attackCooldownMs: 900,
    });
  }

  protected override onDeath(): void {
    super.onDeath();

    // EMP burst: disable the nearest living hero's signature ability for 3 s
    const nearest = this.findNearestLivingOpponent();
    if (nearest) nearest.applySignatureDisabled(3000);

    // Visual: expanding blue-white ring
    const gfx = this.scene.add.graphics();
    gfx.lineStyle(2, 0x88ccff, 0.9);
    gfx.strokeCircle(0, 0, 1);
    gfx.setPosition(this.x, this.y).setDepth(this.depth + 2);
    this.scene.tweens.add({
      targets:  gfx,
      scaleX:   55,
      scaleY:   55,
      alpha:    { from: 0.9, to: 0 },
      duration: 450,
      ease:     'Cubic.easeOut',
      onComplete: () => gfx.destroy(),
    });
  }

  protected buildTree(): BtNode {
    const R = this.meleeRange;

    return new BtSelector([

      // ── 1. Melee + freeze ────────────────────────────────────────────────
      // After dealing damage the crawler locks the target in place for 1.5 s.
      // The target's `frozen` flag suppresses its movement input until the
      // timer expires (handled in CombatEntity.updateBehaviour).
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
            < R,
        ),
        new BtAction(ctx => {
          ctx.attack();
          ctx.stop();
          const target = this.findNearestLivingOpponent();
          if (target) target.applyFrozen(1500);
          return 'success';
        }),
      ]),

      // ── 2. Chase ──────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 3. Wander (fallback) ──────────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}

/**
 * RustBerserker — corrupted soldier with armour fused to their body.
 * Medium HP (80), fast, erratic movement.
 *
 * Damage threshold: incoming hits below 8 damage are completely ignored
 * (no HP loss, no stagger). Must be countered with heavy attacks.
 */
export class RustBerserker extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            80,
      speed:            100,
      aggroRadius:      450,
      attackDamage:     14,
      color:            0xcc4400,   // corroded iron-red
      meleeRange:       32,
      attackCooldownMs: 750,
    });
  }

  /**
   * Armour threshold: ignore hits below 8 damage entirely — no HP loss, no
   * knockback call. The caller's `onHitBy` is skipped because `takeDamage`
   * returning 0 signals no damage was dealt, but CombatEntity's attack closure
   * unconditionally calls `onHitBy` after `takeDamage`. We return 0 here so
   * the HP bar doesn't change; the scene treats it as a non-event.
   */
  override takeDamage(amount: number): number {
    if (amount < 8) return 0;
    return super.takeDamage(amount);
  }

  /**
   * Layer random velocity jitter on top of BT movement each tick for erratic
   * movement. Less pronounced than GlitchDrone — the berserker should feel
   * unpredictable, not chaotic.
   */
  override updateBehaviour(delta: number): void {
    super.updateBehaviour(delta);
    if (this.frozen) return;
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!physBody) return;
    physBody.setVelocity(
      physBody.velocity.x + (Math.random() - 0.5) * BERSERK_JITTER,
      physBody.velocity.y + (Math.random() - 0.5) * BERSERK_JITTER,
    );
  }

  protected buildTree(): BtNode {
    const R = this.meleeRange;

    return new BtSelector([

      // ── 1. Melee ──────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
            < R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),

      // ── 2. Dash gap-close (3 s cooldown) ─────────────────────────────────
      // The berserker occasionally bursts forward — combined with jitter,
      // this produces the lunging, unpredictable charge pattern.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d > R && d < 280;
          }),
          new BtAction(ctx => {
            ctx.dash(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        3000,
      ),

      // ── 3. Chase ──────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 4. Wander (fallback) ──────────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
