import * as Phaser from 'phaser';
import { EarthHero } from './EarthHero';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';

// ── Signature: Patch Up ────────────────────────────────────────────────────────

/** HP restored per tick (3 ticks × PATCH_TICK_MS = 3 s total healing). */
const PATCH_HEAL_PER_TICK = 5;
const PATCH_TICKS         = 3;
const PATCH_TICK_MS       = 1000; // 1 s between ticks → 3 s duration
const PATCH_RADIUS        = 80;   // px — coverage around Maja
const PATCH_CD_MS         = 8000;

/**
 * MajaLind — Tier 1 Earth hero. Field Engineer.
 *
 * Fast and fragile: highest speed in the Earth roster, lowest HP.
 * Designed to dart in with the wrench and retreat before taking punishment.
 *
 * Abilities:
 *   Melee — heavy wrench swing (short range, high damage)
 *   Ranged — basic sidearm pistol (low damage, medium range)
 *   Signature: Patch Up — over 3 s Maja and nearby allies each regen
 *              PATCH_HEAL_PER_TICK HP per second. 8 s cooldown.
 *              The scene should listen for 'patch-up' to heal other heroes.
 */
export class MajaLind extends EarthHero {
  readonly name = 'MajaLind';
  readonly signatureCooldownMs = PATCH_CD_MS;

  private sigCooldown = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            65,   // fragile — must kite carefully
      speed:            120,  // fastest Earth hero
      aggroRadius:      380,
      attackDamage:     22,   // wrench hits hard when it connects
      color:            0xf5a623, // orange-yellow work coveralls placeholder
      meleeRange:       38,
      attackCooldownMs: 850,
      projectileDamage: 12,   // basic sidearm — low but fast
      projectileSpeed:  310,
      projectileColor:  0xffcc44,
    });
  }

  override updateBehaviour(delta: number): void {
    if (this.sigCooldown > 0) this.sigCooldown = Math.max(0, this.sigCooldown - delta);
    super.updateBehaviour(delta);
  }

  /**
   * Patch Up — emit a 3-tick HP-regen aura centred on Maja.
   *
   * Maja heals herself directly (3 × 5 = 15 HP over 3 s). The scene should
   * listen for 'patch-up' to apply the same regen to any nearby allied heroes:
   *
   *   scene.events.on('patch-up', (x, y, radius, hpPerTick, ticks, tickMs) => { ... })
   */
  useSignature(): void {
    if (this.sigCooldown > 0 || !this.isAlive) return;
    this.sigCooldown = PATCH_CD_MS;

    // Self-heal — one TimerEvent fires PATCH_TICKS times every PATCH_TICK_MS.
    // repeat: N-1 means the callback fires N times total (first fire + N-1 repeats).
    this.scene.time.addEvent({
      delay:    PATCH_TICK_MS,
      repeat:   PATCH_TICKS - 1,
      callback: () => { if (this.isAlive) this.heal(PATCH_HEAL_PER_TICK); },
    });

    // Notify the scene so multi-hero arenas can heal other nearby allies.
    this.scene.events.emit(
      'patch-up',
      this.x, this.y, PATCH_RADIUS,
      PATCH_HEAL_PER_TICK, PATCH_TICKS, PATCH_TICK_MS,
    );
  }

  // ── Behavior tree ─────────────────────────────────────────────────────────────

  /**
   * Maja's AI: close rapidly → wrench on contact → fall back to pistol
   * if the target steps out of melee range.
   *
   * She is fast enough to reach melee reliably, but she prioritises the ranged
   * slot when approaching avoids damage — kiting pattern.
   */
  protected buildTree(): BtNode {
    const MELEE_R    = this.meleeRange;
    const RANGED_MIN = 55;  // don't shoot while in swinging range
    const RANGED_MAX = 210;

    return new BtSelector([

      // 1. Melee when in reach.
      new BtCooldown(
        new BtSequence([
          new BtCondition(_ctx => {
            const t = this.findNearestLivingOpponent();
            if (!t) return false;
            return Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y) <= MELEE_R;
          }),
          new BtAction(ctx => {
            ctx.attack();
            return 'success';
          }),
        ]),
        this.attackCooldownMs,
      ),

      // 2. Pistol shot when at comfortable distance.
      new BtCooldown(
        new BtSequence([
          new BtCondition(_ctx => {
            const t = this.findNearestLivingOpponent();
            if (!t) return false;
            const d = Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y);
            return d >= RANGED_MIN && d <= RANGED_MAX;
          }),
          new BtAction(ctx => {
            const t = this.findNearestLivingOpponent();
            if (t) ctx.shootAt(t.x, t.y);
            return 'success';
          }),
        ]),
        this.attackCooldownMs * 0.7, // pistol fires faster than the wrench
      ),

      // 3. Chase — speed advantage makes this reliable.
      new BtAction(ctx => {
        if (ctx.opponent) ctx.moveToward(ctx.opponent.x, ctx.opponent.y);
        else ctx.wander(0);
        return 'running';
      }),
    ]);
  }
}
