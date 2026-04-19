import * as Phaser from 'phaser';
import { HeroEntity } from '../HeroEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../../ai/BehaviorTree';

/**
 * Loke — Tier 0 Mistheim Scout.
 *
 * The youngest hero: a 10-year-old boy with a wooden slingshot and a green
 * knit hat. Low HP, medium speed. His strength is range — he kites enemies,
 * keeps distance, and pelts them with pebbles.
 *
 * AI persona (auto-play):
 *   - Flee if an enemy closes within 80 px — always kite, never let them touch
 *   - Shoot when the target is within 300 px and the cooldown allows
 *   - Orbit at ~200 px to maintain ideal slingshot distance
 *   - Wander when no enemy is visible
 *
 * Player-mode API:
 *   - shootSlingshot(angle, onProjectile) — fires a pebble; the scene spawns it
 *   - slingshotCooldownFraction, canShoot — drive HUD indicators
 */
export class Loke extends HeroEntity {
  // ── Slingshot constants (also read by HeroConfig for AI ranged attack) ────

  /** ms between slingshot shots. */
  static readonly SLINGSHOT_COOLDOWN_MS = 1_200;
  /** Flat damage per pebble. */
  static readonly SLINGSHOT_DAMAGE = 18;
  /** Pebble travel speed in px/s. */
  static readonly SLINGSHOT_PROJECTILE_SPEED = 320;
  /** Maximum pebble flight distance in px before despawning. */
  static readonly SLINGSHOT_RANGE_PX = 350;

  // ── Player-mode cooldown (separate from AI-mode BtCooldown) ─────────────

  /**
   * Cooldown timer used in player mode only. The BT governs timing via its
   * own BtCooldown node so the two paths don't share state.
   */
  private slingshotCooldown = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            70,  // most fragile hero — rewards positioning
      speed:            105,
      aggroRadius:      330, // spots enemies at medium range
      attackDamage:     5,   // weak melee (backup only)
      meleeRange:       35,
      attackCooldownMs: 800,
      // AI ranged attack uses CombatEntity's built-in projectile system:
      projectileDamage: Loke.SLINGSHOT_DAMAGE,
      projectileSpeed:  Loke.SLINGSHOT_PROJECTILE_SPEED,
      color:            0x44bb44, // scout green
      spriteKey:        'loke',
      sightMemoryMs:    3_000,
      hearingRadius:    200,
    });
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  /**
   * Ticks the player-mode slingshot cooldown in addition to the inherited
   * CombatEntity BT update (called via super.update → updateBehaviour).
   */
  override update(delta: number): void {
    super.update(delta); // runs BT when in auto-play mode
    if (!this.isAlive) return;
    this.slingshotCooldown = Math.max(0, this.slingshotCooldown - delta);
  }

  // ── Player-mode API ─────────────────────────────────────────────────────────

  /**
   * Fire the slingshot toward a world-space angle (radians).
   *
   * Intended for player-controlled mode. The scene calls this on input and
   * provides `onProjectile` to physically spawn the pebble in the scene's
   * projectile group.
   *
   * In auto-play mode the BT calls CombatEntity's built-in shootAt() instead,
   * which fires via the 'projectile-spawned' event — same net result, different
   * code path so the two modes stay independent.
   *
   * @returns true if the shot fired; false if on cooldown.
   */
  shootSlingshot(
    angle: number,
    onProjectile: (vx: number, vy: number, damage: number) => void,
  ): boolean {
    if (this.slingshotCooldown > 0) return false;
    this.slingshotCooldown = Loke.SLINGSHOT_COOLDOWN_MS;
    const spd = Loke.SLINGSHOT_PROJECTILE_SPEED;
    onProjectile(Math.cos(angle) * spd, Math.sin(angle) * spd, Loke.SLINGSHOT_DAMAGE);
    return true;
  }

  /** 0–1 fraction — drive a cooldown arc or opacity fade on the HUD indicator. */
  get slingshotCooldownFraction(): number {
    return this.slingshotCooldown / Loke.SLINGSHOT_COOLDOWN_MS;
  }

  /** true when the slingshot is ready to fire. */
  get isReadyToShoot(): boolean {
    return this.slingshotCooldown === 0;
  }

  // ── AI behaviour ────────────────────────────────────────────────────────────

  /**
   * Loke's AI tree — kiter persona.
   *
   * Priority order (Selector tries each branch until one succeeds):
   *   1. Flee — hard retreat if an enemy is within 80 px
   *   2. Shoot — pebble when target is within 300 px (BtCooldown gates it)
   *   3. Reposition — chase to close range, then orbit at ~200 px to kite
   *   4. Wander — lazy random drift when no enemy is visible
   */
  protected buildTree(): BtNode {
    const FLEE_RANGE  = 80;
    const SHOOT_RANGE = 300;
    const KITE_RADIUS = 200;

    const dist = (ctx: { x: number; y: number }, opp: { x: number; y: number }) =>
      Phaser.Math.Distance.Between(ctx.x, ctx.y, opp.x, opp.y);

    return new BtSelector([

      // 1. Flee — highest priority: never let an enemy touch Loke
      new BtSequence([
        new BtCondition(ctx => !!ctx.opponent && dist(ctx, ctx.opponent) < FLEE_RANGE),
        new BtAction(ctx => {
          ctx.steerAway(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 2. Shoot — only while in range; BtCooldown matches the slingshot timer
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => !!ctx.opponent && dist(ctx, ctx.opponent) < SHOOT_RANGE),
          new BtAction(ctx => {
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        Loke.SLINGSHOT_COOLDOWN_MS,
      ),

      // 3. Reposition — chase to enter range, then orbit to avoid getting hit
      new BtSequence([
        new BtCondition(ctx => !!ctx.opponent),
        new BtAction(ctx => {
          const d = dist(ctx, ctx.opponent!);
          if (d > SHOOT_RANGE * 0.85) {
            // Too far — sprint in to shooting range
            ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          } else {
            // In range — orbit at kite distance to avoid approaching enemies
            ctx.orbitAround(ctx.opponent!.x, ctx.opponent!.y, KITE_RADIUS, true);
          }
          return 'running';
        }),
      ]),

      // 4. Wander — no visible enemy
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),

    ]);
  }
}
