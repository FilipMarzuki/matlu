import * as Phaser from 'phaser';
import { CombatEntity, AcidLancer, ParasiteFlyer } from './CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';
import { EarthHero } from './EarthHero';

/**
 * Tinkerer — post-apocalyptic mechanic hero. Melee bash + pistol shot + dash.
 *
 * Upgraded from a priority waterfall to utility-weighted decision making:
 *   - Counts nearby enemies (swarm pressure) to gate and score each action.
 *   - Escape dash fires toward arena center when overwhelmed AND low HP.
 *   - Ranged attack targets the highest-threat enemy (AcidLancer > others),
 *     not just the nearest one.
 *   - Melee is suppressed when surrounded to avoid diving into a cluster.
 *
 * Extends EarthHero (which extends CombatEntity) rather than CombatEntity
 * directly so the arena scene can type the hero field as EarthHero and swap
 * in any of the five Earth heroes without changing call sites.
 */
export class Tinkerer extends EarthHero {
  /** Display name used in HUD labels and log output. */
  readonly name = 'Tinkerer';

  /**
   * Signature ability cooldown — 8 s is intentionally long so Overload Dash
   * feels like a meaningful emergency button rather than a rotational tool.
   */
  readonly signatureCooldownMs = 8000;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:              100,
      speed:              80,
      aggroRadius:        400,
      attackDamage:       15,
      color:              0x996633,
      meleeRange:         36,
      attackCooldownMs:   700,
      projectileDamage:   18,
      projectileSpeed:    420,   // faster than other projectiles — feels like a bullet
      projectileColor:    0xfff8b0, // bright yellow-white muzzle colour
      dashSpeedMultiplier: 4.5,
      dashDurationMs:     180,
      spriteKey:          'tinkerer',
    });
  }

  /**
   * Overload Dash — Tinkerer's signature ability.
   *
   * Dashes toward the nearest living opponent regardless of distance,
   * bypassing the behavior tree's cooldown guard. Useful when the player
   * wants an aggressive gap-close that the AI dash branch wouldn't trigger
   * (e.g. target is outside DASH_MAX or the BT dash is still cooling down).
   *
   * The caller is responsible for enforcing signatureCooldownMs — this
   * method fires the dash unconditionally if a target exists.
   */
  useSignature(): void {
    const target = this.findNearestLivingOpponent();
    if (!target) return;
    this.tryDash(target.x - this.x, target.y - this.y);
  }

  /**
   * Target selection: prefer ranged threats (AcidLancer, ParasiteFlyer) over
   * melee rushers at the same distance. Suppressing their projectile spam is
   * more valuable than hitting the nearest enemy.
   */
  protected override findTargetOpponent(): CombatEntity | null {
    const rangedThreats = this.opponents.filter(
      o => o.isAlive && (o instanceof AcidLancer || o instanceof ParasiteFlyer),
    );
    if (rangedThreats.length > 0) {
      return rangedThreats.reduce((best, o) =>
        Phaser.Math.Distance.Between(this.x, this.y, o.x, o.y) <
        Phaser.Math.Distance.Between(this.x, this.y, best.x, best.y) ? o : best,
      );
    }
    return this.findNearestLivingOpponent();
  }

  protected buildTree(): BtNode {
    const MELEE_R    = this.meleeRange;   // 36px
    const DASH_MIN   = MELEE_R;
    const DASH_MAX   = 300;
    const RANGED_MIN = 60;
    const RANGED_MAX = 230;
    const SWARM_R    = 130;   // radius for swarm pressure check
    const SWARM_CAP  = 4;     // enemies within SWARM_R that triggers escape mode

    /** Count living enemies within SWARM_R of the Tinkerer's current position. */
    const swarmPressure = (cx: number, cy: number): number =>
      this.opponents.filter(
        o => o.isAlive && Phaser.Math.Distance.Between(cx, cy, o.x, o.y) < SWARM_R,
      ).length;

    return new BtSelector([

      // ── 1. Escape dash — fires when overwhelmed AND low HP ────────────────────
      // Dashes away from the enemy swarm centroid, not toward a target.
      // A last-resort survival move before the hero goes down.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            const near = swarmPressure(ctx.x, ctx.y);
            return near >= SWARM_CAP && ctx.hp < ctx.maxHp * 0.75;
          }),
          new BtAction(ctx => {
            // Compute the average position of nearby enemies and dash opposite.
            const near = this.opponents.filter(
              o => o.isAlive && Phaser.Math.Distance.Between(ctx.x, ctx.y, o.x, o.y) < SWARM_R,
            );
            const avgX = near.reduce((s, o) => s + o.x, 0) / near.length;
            const avgY = near.reduce((s, o) => s + o.y, 0) / near.length;
            const escX = ctx.x + (ctx.x - avgX) * 3;
            const escY = ctx.y + (ctx.y - avgY) * 3;
            ctx.dash(escX, escY);
            return 'success';
          }),
        ]),
        4000,
      ),

      // ── 2. Melee bash — suppressed when 3+ enemies are nearby ────────────────
      // Melee into a swarm is suicidal; prefer ranged or dash instead.
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          const d    = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
          const near = swarmPressure(ctx.x, ctx.y);
          return d < MELEE_R && near < 3;
        }),
        new BtAction(ctx => {
          this.attackAnimId = 'attack_melee';
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // ── 3. Pistol — prioritises ranged threats (via findTargetOpponent) ──────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= RANGED_MIN && d <= RANGED_MAX;
          }),
          new BtAction(ctx => {
            this.attackAnimId = 'attack_ranged';
            const shotAngle = Math.atan2(ctx.opponent!.y - ctx.y, ctx.opponent!.x - ctx.x);
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            // No stop() — shoot while walking so the walk animation stays visible
            // between bursts and the Tinkerer feels dynamic rather than static.
            this.scene.events.emit('hero-shot', ctx.x, ctx.y, shotAngle);
            return 'success';
          }),
        ]),
        750,
      ),

      // ── 4. Gap-close dash ─────────────────────────────────────────────────────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d > DASH_MIN && d < DASH_MAX;
          }),
          new BtAction(ctx => {
            ctx.dash(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        3000,
      ),

      // ── 5. Chase priority target ──────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 6. Wander (fallback) ──────────────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
