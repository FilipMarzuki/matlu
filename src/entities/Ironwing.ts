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

// ── Signature: Boost Dash + Stomp ─────────────────────────────────────────────

const STOMP_R          = 60;     // px — AoE radius for the landing stomp
const STOMP_DAMAGE     = 35;     // HP removed from each enemy in blast
const BOOST_CD_MS      = 8000;   // signature cooldown
const BOOST_MULTIPLIER = 6.0;    // speed multiplier for the dash burst
const BOOST_DURATION_MS = 250;   // ms — how long the dash lasts

// ── Ironwing ──────────────────────────────────────────────────────────────────

/**
 * Ironwing — Tier 3 Earth hero. Pilot Ingrid "Ironwing" Dahlin.
 *
 * Mounted light mech — roughly twice human height, exposed cockpit.
 * Higher HP than Tier 1–2, lower speed; autocannon fires slower but
 * hits harder. Swedish military markings (placeholder: steel-blue rect).
 *
 * Abilities:
 *   Melee  — mech stomp / arm slam (short range, high damage)
 *   Ranged — mounted autocannon (slower than rifle, heavier per shot)
 *   Signature: Boost Dash + Stomp — dashes toward the nearest enemy at
 *              BOOST_MULTIPLIER × speed, then on landing deals STOMP_DAMAGE
 *              AoE to all opponents within STOMP_R px. 8 s cooldown.
 *
 * The stomp fires via scene.time.delayedCall(BOOST_DURATION_MS) so it
 * lands exactly when the dash physics expire, matching the CombatEntity
 * dash timer duration.
 */
export class Ironwing extends EarthHero {
  readonly name = 'Ironwing';
  readonly signatureCooldownMs = BOOST_CD_MS;

  private sigCooldown = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            200,  // mech armour — tankiest Earth hero
      speed:            60,   // heavy frame — slowest Earth hero
      aggroRadius:      440,
      attackDamage:     30,   // mech stomp hits hard
      color:            0x4e88c4, // steel-blue placeholder
      meleeRange:       42,
      attackCooldownMs: 1200, // slow swing cadence for a heavy arm
      projectileDamage: 32,   // autocannon — heaviest per-shot damage
      projectileSpeed:  340,  // slightly slower than Torsten's rifle
      projectileColor:  0xffdd44,
      // Dash config — BOOST_MULTIPLIER and BOOST_DURATION_MS must match the
      // constants above so the stomp delayedCall fires at the right moment.
      dashSpeedMultiplier: BOOST_MULTIPLIER,
      dashDurationMs:      BOOST_DURATION_MS,
      // spriteScale 2.0 — wired in for when the real mech sprite is available.
      // The body rectangle uses the default ENTITY_SIZE until then.
      spriteScale: 2.0,
    });
  }

  override updateBehaviour(delta: number): void {
    if (this.sigCooldown > 0) this.sigCooldown = Math.max(0, this.sigCooldown - delta);
    super.updateBehaviour(delta);
  }

  /**
   * Boost Dash + Stomp — Ironwing rockets toward the nearest enemy, then
   * slams down dealing AoE damage when the boost expires.
   *
   * Implementation notes:
   *   - tryDash() uses the dashSpeedMultiplier / dashDurationMs from the config.
   *   - The stomp delayedCall fires after BOOST_DURATION_MS, matching when
   *     CombatEntity's internal dashTimer reaches zero.
   *   - onHitBy() flashes each struck enemy white (built-in hit feedback).
   */
  useSignature(): void {
    if (this.sigCooldown > 0 || !this.isAlive) return;
    this.sigCooldown = BOOST_CD_MS;

    const target = this.findNearestLivingOpponent();
    const dx = target ? target.x - this.x : 0;
    const dy = target ? target.y - this.y : 1; // dash south if no target
    this.tryDash(dx, dy);

    // Stomp fires when the boost expires — BOOST_DURATION_MS matches dashDurationMs.
    this.scene.time.delayedCall(BOOST_DURATION_MS, () => {
      if (!this.isAlive) return;
      for (const e of this.opponents) {
        if (!e.isAlive) continue;
        if (Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y) <= STOMP_R) {
          e.takeDamage(STOMP_DAMAGE);
          e.onHitBy(this.x, this.y); // white-flash hit feedback
        }
      }
      // Shockwave ring: bright circle that expands and fades to sell the impact.
      const ring = this.scene.add.arc(this.x, this.y, 5, 0, 360, false, 0xffffff, 0.8);
      ring.setDepth(this.y + 2);
      this.scene.tweens.add({
        targets:  ring,
        scaleX:   STOMP_R / 5,
        scaleY:   STOMP_R / 5,
        alpha:    0,
        duration: 250,
        ease:     'Quad.easeOut',
        onComplete: () => { if (ring.active) ring.destroy(); },
      });
    });
  }

  // ── Behavior tree ─────────────────────────────────────────────────────────────

  /**
   * Ironwing's AI: hold at autocannon range and fire; melee only when target
   * is already inside stomp range. Heavy frame → stays further back than Torsten.
   */
  protected buildTree(): BtNode {
    const MELEE_R    = this.meleeRange;
    const RANGED_MIN = 90;   // mech keeps its distance
    const RANGED_MAX = 300;  // long autocannon range
    const KITE_IN    = 55;   // step back if an enemy presses too close

    return new BtSelector([

      // 1. Stomp when already in melee range.
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

      // 2. Back up if an enemy closes to KITE_IN but isn't yet in melee range.
      new BtSequence([
        new BtCondition(_ctx => {
          const t = this.findNearestLivingOpponent();
          if (!t) return false;
          return Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y) < KITE_IN;
        }),
        new BtAction(ctx => {
          const t = this.findNearestLivingOpponent();
          if (t) ctx.steerAway(t.x, t.y);
          return 'running';
        }),
      ]),

      // 3. Autocannon when at optimal range.
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
        this.attackCooldownMs * 0.8, // autocannon fires slightly faster than stomp cooldown
      ),

      // 4. Advance toward target.
      new BtAction(ctx => {
        if (ctx.opponent) ctx.moveToward(ctx.opponent.x, ctx.opponent.y);
        else ctx.wander(0);
        return 'running';
      }),
    ]);
  }
}
