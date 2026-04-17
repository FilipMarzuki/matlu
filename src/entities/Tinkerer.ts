import * as Phaser from 'phaser';
import { CombatEntity, AcidLancer, ParasiteFlyer } from './CombatEntity';
import { Projectile, Damageable } from './Projectile';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';
import { EarthHero } from './EarthHero';

// ── Magazine constants ─────────────────────────────────────────────────────────

/** Total shots per magazine. */
const MAG_SIZE = 12;

/**
 * First N shots in a magazine fire as a rapid burst.
 * Shots beyond this index switch to irregular semi-auto.
 */
const BURST_SIZE = 3;

/** Cooldown between shots inside the burst (ms). Halved when standing still. */
const BURST_CD = 130;

/** Semi-auto shot cooldown range (ms). Randomised per shot for irregular feel. */
const SLOW_CD_MIN = 480;
const SLOW_CD_MAX = 780;

/** Full reload duration after emptying the magazine (ms). */
const RELOAD_MS = 1400;

/**
 * Body speed (px/s) below which the hero is considered "planted".
 * While planted: fire rate doubled, damage +50%.
 */
const STILL_THRESHOLD   = 15;
const STILL_DAMAGE_MULT = 1.5;

/**
 * Tinkerer — post-apocalyptic mechanic hero. Melee bash + pistol + dash.
 *
 * ## Magazine system
 * Shots 1–3 are a rapid burst (130 ms apart); shots 4–12 are irregular
 * semi-auto (480–780 ms). Standing still doubles fire rate and adds +50%
 * damage. After the 12th shot a 1.4 s reload begins — melee and dash still
 * work during reload. The same magazine state applies in both player-controlled
 * and AI-controlled modes via the canShoot / onShotFired hooks on CombatEntity.
 *
 * ## Dash
 * Peak speed 5× with linear velocity decay over 350 ms (slide/roll feel).
 *
 * ## Melee
 * 120° arc swipe via CombatEntity.tryMelee() — hits all targets in the cone
 * and applies strong knockback (onHitByMelee).
 */
export class Tinkerer extends EarthHero {
  readonly name = 'Tinkerer';
  readonly signatureCooldownMs = 8000;

  // ── Magazine state ───────────────────────────────────────────────────────────
  private magShots    = MAG_SIZE;
  private isReloading = false;
  private reloadTimer = 0;
  private shotInBurst = 0; // shots fired this magazine

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:               100,
      speed:               80,
      aggroRadius:         400,
      attackDamage:        15,
      color:               0x996633,
      meleeRange:          36,
      attackCooldownMs:    700,
      projectileDamage:    18,
      projectileSpeed:     420,
      projectileColor:     0xfff8b0,
      dashSpeedMultiplier: 5,    // higher peak; linear ease-out averages ~2.5×
      dashDurationMs:      350,  // longer window = slide/roll feel
      spriteKey:           'tinkerer',
    });
  }

  // ── CombatEntity hooks ────────────────────────────────────────────────────────

  protected override canShoot(): boolean {
    return !this.isReloading && this.magShots > 0;
  }

  /** Advance magazine when the AI fires via ctx.shootAt. */
  protected override onShotFired(): void {
    this.advanceMag();
  }

  // ── Magazine helpers ──────────────────────────────────────────────────────────

  private advanceMag(): void {
    this.magShots--;
    this.shotInBurst++;
    if (this.magShots <= 0) {
      this.isReloading = true;
      this.reloadTimer = RELOAD_MS;
      this.shotInBurst = 0;
    }
  }

  /** Returns the cooldown (ms) for the next shot based on burst position + stance. */
  private nextCooldown(isStill: boolean): number {
    const base = this.shotInBurst < BURST_SIZE
      ? BURST_CD
      : SLOW_CD_MIN + Math.random() * (SLOW_CD_MAX - SLOW_CD_MIN);
    return isStill ? base * 0.5 : base;
  }

  // ── Frame tick ────────────────────────────────────────────────────────────────

  override updateBehaviour(delta: number): void {
    if (this.isReloading) {
      this.reloadTimer = Math.max(0, this.reloadTimer - delta);
      if (this.reloadTimer === 0) {
        this.isReloading = false;
        this.magShots    = MAG_SIZE;
        this.shotInBurst = 0;
      }
    }
    super.updateBehaviour(delta);
  }

  // ── Player ranged ─────────────────────────────────────────────────────────────

  /**
   * Magazine-aware ranged shot for player-controlled mode.
   *
   * Replaces the base attackCooldownMs with a per-shot delay that varies by
   * position in the burst. When planted (near-zero velocity) the cooldown is
   * halved and damage increases by 50%.
   */
  override tryRanged(): void {
    if (this.attackTimer > 0 || !this.projectileDamage || !this.canShoot()) return;

    const target = this.findNearestLivingOpponent();
    if (!target) return;

    const body    = this.body as Phaser.Physics.Arcade.Body | undefined;
    const isStill = body
      ? Math.hypot(body.velocity.x, body.velocity.y) < STILL_THRESHOLD
      : false;
    const damage  = isStill
      ? Math.round(this.projectileDamage * STILL_DAMAGE_MULT)
      : this.projectileDamage;

    const angle = Math.atan2(target.y - this.y, target.x - this.x);
    const p = new Projectile(
      this.scene, this.x, this.y, angle,
      this.projectileSpeed, damage,
      this.projectileColor,
      (this.opponents as unknown as Damageable[]).concat(this.extraDamageables),
    );
    this.scene.events.emit('projectile-spawned', p);
    this.attackAnimId    = 'attack_ranged';
    this.attackAnimTimer = this.attackAnimDuration;
    this.scene.events.emit('hero-shot', this.x, this.y, angle);

    this.attackTimer = this.nextCooldown(isStill);
    this.advanceMag();
  }

  // ── Signature ─────────────────────────────────────────────────────────────────

  useSignature(): void {
    const target = this.findNearestLivingOpponent();
    if (!target) return;
    this.tryDash(target.x - this.x, target.y - this.y);
  }

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

  // ── Behavior tree ─────────────────────────────────────────────────────────────

  protected buildTree(): BtNode {
    const MELEE_R    = this.meleeRange;
    const DASH_MIN   = MELEE_R;
    const DASH_MAX   = 300;
    const RANGED_MIN = 60;
    const RANGED_MAX = 230;
    const SWARM_R    = 130;
    const SWARM_CAP  = 4;

    const swarmPressure = (cx: number, cy: number): number =>
      this.opponents.filter(
        o => o.isAlive && Phaser.Math.Distance.Between(cx, cy, o.x, o.y) < SWARM_R,
      ).length;

    return new BtSelector([

      // 1. Escape dash when overwhelmed + low HP
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            return swarmPressure(ctx.x, ctx.y) >= SWARM_CAP && ctx.hp < ctx.maxHp * 0.75;
          }),
          new BtAction(ctx => {
            const near = this.opponents.filter(
              o => o.isAlive && Phaser.Math.Distance.Between(ctx.x, ctx.y, o.x, o.y) < SWARM_R,
            );
            const avgX = near.reduce((s, o) => s + o.x, 0) / near.length;
            const avgY = near.reduce((s, o) => s + o.y, 0) / near.length;
            ctx.dash(ctx.x + (ctx.x - avgX) * 3, ctx.y + (ctx.y - avgY) * 3);
            return 'success';
          }),
        ]),
        4000,
      ),

      // 2. Melee bash (suppressed when swarmed)
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
          return d < MELEE_R && swarmPressure(ctx.x, ctx.y) < 3;
        }),
        new BtAction(ctx => {
          this.attackAnimId = 'attack_melee';
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // 3. Pistol — magazine-aware via canShoot / onShotFired hooks
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
            this.scene.events.emit('hero-shot', ctx.x, ctx.y, shotAngle);
            return 'success';
          }),
        ]),
        750,
      ),

      // 4. Gap-close dash
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

      // 5. Chase
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 6. Wander
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
