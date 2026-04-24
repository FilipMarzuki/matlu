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
 * SymbiontKarin — Tier 2 Bonded Huntress.
 *
 * Mid-tier hero balanced for aggressive flanking. Her signature ability,
 * Blur Dash, bursts her forward at high speed and leaves a short-lived
 * afterimage at the launch point. The afterimage deals splash damage to
 * enemies near the origin — handled by the scene via the 'afterimage-spawned'
 * event (same pattern as 'projectile-spawned' in CombatEntity).
 *
 * AI persona (auto-play):
 *   - Blur Dash toward the target when 80–180 px away and cooldown ready
 *   - Melee when adjacent (after closing distance with a dash)
 *   - Chase otherwise — relentless pressure
 *   - Wander when no enemy visible
 *
 * Physics body is added externally by the scene after construction.
 */
export class SymbiontKarin extends HeroEntity {
  /** Damage dealt by the afterimage splash at the dash origin. */
  readonly afterimageDamage = 18;

  private cooldownRemaining = 0;
  private static readonly DASH_COOLDOWN_MS  = 8_000;
  private static readonly DASH_DURATION_MS  = 200;
  private static readonly DASH_SPEED_MULT   = 5.0;
  private static readonly AFTERIMAGE_FADE_MS = 200;

  // Karin manages her own dash state rather than using CombatEntity's built-in
  // dash (ctx.dash) because her dash fires the afterimage side-effect. The two
  // dash systems are completely independent (CombatEntity's dash fields are private).
  private blurActive = false;
  private blurTimer  = 0;
  private blurVx     = 0;
  private blurVy     = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            90,
      speed:            95,  // above average but below Lund
      aggroRadius:      300,
      attackDamage:     16,  // strong melee — she's a brawler post-dash
      meleeRange:       42,
      attackCooldownMs: 650,
      color:            0x55ddcc, // teal — matches the afterimage ghost colour
      sightMemoryMs:    3_500,
      hearingRadius:    220,
    });
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  /**
   * Ticks the dash cooldown and re-applies dash velocity each frame so no
   * external setVelocity call can cancel the burst mid-flight.
   */
  override update(delta: number): void {
    super.update(delta);
    if (!this.isAlive) return;

    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - delta);

    if (this.blurActive) {
      this.blurTimer -= delta;
      const body = this.getPhysicsBody();
      if (this.blurTimer <= 0) {
        this.blurActive = false;
        body?.setVelocity(0, 0);
      } else {
        // Re-apply every frame — prevents BT movement actions from cancelling it.
        body?.setVelocity(this.blurVx, this.blurVy);
      }
    }
  }

  // ── Player-mode API ─────────────────────────────────────────────────────────

  /**
   * Blur Dash: burst toward (dx, dy) at 5× speed and spawn a damaging
   * afterimage at the launch point.
   *
   * Called by the scene in player mode. The AI BT calls this directly too
   * (inside a BtAction), so the afterimage fires in both modes.
   *
   * @returns true if the ability fired; false if on cooldown or already dashing.
   */
  useBlurDash(dx: number, dy: number): boolean {
    if (this.cooldownRemaining > 0 || this.blurActive) return false;

    const body = this.getPhysicsBody();
    if (!body) return false;

    const originX = this.x;
    const originY = this.y;

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const spd = this.speed * SymbiontKarin.DASH_SPEED_MULT;
    this.blurVx    = (dx / len) * spd;
    this.blurVy    = (dy / len) * spd;
    this.blurTimer = SymbiontKarin.DASH_DURATION_MS;
    this.blurActive = true;
    body.setVelocity(this.blurVx, this.blurVy);

    this.spawnAfterimage(originX, originY);
    this.cooldownRemaining = SymbiontKarin.DASH_COOLDOWN_MS;
    return true;
  }

  /** True while the Blur Dash burst is active. Scenes can read this to suppress other input. */
  get isDashActive(): boolean {
    return this.blurActive;
  }

  /** 0–1 fraction — useful for rendering a cooldown indicator. */
  get dashCooldownFraction(): number {
    return this.cooldownRemaining / SymbiontKarin.DASH_COOLDOWN_MS;
  }

  // ── AI behaviour ────────────────────────────────────────────────────────────

  /**
   * SymbiontKarin's AI tree — flanker / aggressive melee persona.
   *
   * Priority order:
   *   1. Blur Dash — gap-close when 80–180 px away and cooldown ready
   *   2. Melee — attack when adjacent
   *   3. Chase — relentless pursuit
   *   4. Wander
   */
  protected buildTree(): BtNode {
    const DASH_MIN_RANGE   = 80;  // don't dash if already inside this radius
    const DASH_MAX_RANGE   = 180; // outside this, just run
    const MELEE_RANGE      = 48;

    const dist = (ax: number, ay: number, bx: number, by: number) =>
      Phaser.Math.Distance.Between(ax, ay, bx, by);

    return new BtSelector([

      // 1. Blur Dash — teleport-close to the target, leaving a damaging ghost
      // BtCooldown mirrors the ability cooldown to prevent attempting it too often.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent || this.blurActive) return false;
            const d = dist(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= DASH_MIN_RANGE && d <= DASH_MAX_RANGE;
          }),
          new BtAction(ctx => {
            const dx = ctx.opponent!.x - ctx.x;
            const dy = ctx.opponent!.y - ctx.y;
            this.useBlurDash(dx, dy);
            return 'success';
          }),
        ]),
        SymbiontKarin.DASH_COOLDOWN_MS,
      ),

      // 2. Melee — strike when close enough
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx =>
            !!ctx.opponent && dist(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < MELEE_RANGE),
          new BtAction(ctx => {
            ctx.attack();
            return 'success';
          }),
        ]),
        650,
      ),

      // 3. Chase — relentlessly close the gap
      new BtSequence([
        new BtCondition(ctx => !!ctx.opponent),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 4. Wander
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),

    ]);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private spawnAfterimage(x: number, y: number): void {
    const ghost = this.scene.add.rectangle(x, y, 16, 24, 0x55ddcc, 0.7);
    ghost.setDepth(this.depth);

    this.scene.tweens.add({
      targets:  ghost,
      alpha:    { from: 0.7, to: 0 },
      duration: SymbiontKarin.AFTERIMAGE_FADE_MS,
      ease:     'Linear',
      onComplete: () => ghost.destroy(),
    });

    // Notify the scene so it can apply splash damage to nearby enemies.
    this.scene.events.emit('afterimage-spawned', x, y, this.afterimageDamage);
  }
}
