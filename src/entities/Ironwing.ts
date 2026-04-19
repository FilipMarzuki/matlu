import * as Phaser from 'phaser';
import { EarthHero } from './EarthHero';
import { CombatEntity } from './CombatEntity';
import { Projectile, Damageable } from './Projectile';
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
const BOOST_CD_MS      = 5500;   // shorter cooldown = mobility-focused cyber feel
const BOOST_MULTIPLIER = 6.0;    // speed multiplier for the dash burst
const BOOST_DURATION_MS = 250;   // ms — how long the dash lasts

// ── Tier 3 companions: orbit drones ────────────────────────────────────────────

const DRONE_COUNT = 3;
const DRONE_ORBIT_RADIUS = 48;
const DRONE_ORBIT_RADIUS_STEP = 8;
const DRONE_ORBIT_SPEED = 0.0038; // radians per ms
const DRONE_FIRE_RANGE = 280;
const DRONE_FIRE_COOLDOWN_MS = 700;
const DRONE_PROJECTILE_DAMAGE = 14;
const DRONE_PROJECTILE_SPEED = 430;
const DRONE_PROJECTILE_COLOR = 0x66e6ff;

// ── Tier 3 movement augment ────────────────────────────────────────────────────

const CYBER_MOVE_MULTIPLIER = 1.25;

/**
 * Small orbiting drone companion for Ironwing.
 *
 * Drones stay visible around the hero at all times, pick targets independently,
 * and fire their own projectiles on independent cooldown timers.
 */
class CyberDroneCompanion {
  private readonly sprite: Phaser.GameObjects.Arc;
  private readonly orbitRadius: number;
  private orbitAngle: number;
  private fireTimer: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly slot: number,
    totalSlots: number,
  ) {
    this.orbitRadius = DRONE_ORBIT_RADIUS + slot * DRONE_ORBIT_RADIUS_STEP;
    this.orbitAngle = (Math.PI * 2 * slot) / totalSlots;
    // Stagger initial shot timings so drones don't all fire on the same frame.
    this.fireTimer = (DRONE_FIRE_COOLDOWN_MS / totalSlots) * slot;
    this.sprite = scene.add.arc(0, 0, 5, 0, 360, false, 0x22bbff, 0.95);
    this.sprite.setStrokeStyle(1.5, 0xb7f1ff, 0.95);
    this.sprite.setDepth(20);
  }

  update(delta: number, ownerX: number, ownerY: number, opponents: CombatEntity[]): void {
    const direction = this.slot % 2 === 0 ? 1 : -1;
    this.orbitAngle += DRONE_ORBIT_SPEED * delta * direction;
    this.sprite.x = ownerX + Math.cos(this.orbitAngle) * this.orbitRadius;
    this.sprite.y = ownerY + Math.sin(this.orbitAngle) * this.orbitRadius;

    this.fireTimer = Math.max(0, this.fireTimer - delta);
    if (this.fireTimer > 0) return;

    const target = this.pickTarget(opponents);
    if (!target) return;

    this.fireAt(target, opponents);
    this.fireTimer = DRONE_FIRE_COOLDOWN_MS + Phaser.Math.Between(-120, 120);
  }

  dispose(): void {
    if (this.sprite.active) this.sprite.destroy();
  }

  private pickTarget(opponents: CombatEntity[]): CombatEntity | null {
    const candidates = opponents.filter(
      (enemy) =>
        enemy.isAlive &&
        Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, enemy.x, enemy.y) <= DRONE_FIRE_RANGE,
    );
    if (candidates.length === 0) return null;

    // Different slots pick different ranked distances to spread crossfire lanes.
    const sorted = [...candidates].sort(
      (a, b) =>
        Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, a.x, a.y) -
        Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, b.x, b.y),
    );
    return sorted[this.slot % sorted.length] ?? sorted[0];
  }

  private fireAt(target: CombatEntity, opponents: CombatEntity[]): void {
    const angle = Math.atan2(target.y - this.sprite.y, target.x - this.sprite.x);
    const damageables = opponents.filter((enemy) => enemy.isAlive) as Damageable[];
    const projectile = new Projectile(
      this.scene,
      this.sprite.x,
      this.sprite.y,
      angle,
      DRONE_PROJECTILE_SPEED,
      DRONE_PROJECTILE_DAMAGE,
      DRONE_PROJECTILE_COLOR,
      damageables,
      16,
      420,
    );
    this.scene.events.emit('projectile-spawned', projectile);

    const flash = this.scene.add.arc(this.sprite.x, this.sprite.y, 3, 0, 360, false, 0xffffff, 0.85);
    flash.setDepth(22);
    this.scene.tweens.add({
      targets: flash,
      scaleX: 2.1,
      scaleY: 2.1,
      alpha: 0,
      duration: 90,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (flash.active) flash.destroy();
      },
    });
  }
}

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
  private drones: CyberDroneCompanion[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            200,  // mech armour — tankiest Earth hero
      speed:            95,   // cyber augment: faster repositioning than Tier 2
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

    for (let i = 0; i < DRONE_COUNT; i++) {
      this.drones.push(new CyberDroneCompanion(scene, i, DRONE_COUNT));
    }
  }

  override updateBehaviour(delta: number): void {
    if (this.sigCooldown > 0) this.sigCooldown = Math.max(0, this.sigCooldown - delta);
    for (const drone of this.drones) drone.update(delta, this.x, this.y, this.opponents);
    super.updateBehaviour(delta);
  }

  /**
   * Tier-3 movement augment: cyber actuators amplify player-driven movement.
   * AI movement already benefits from the higher base speed set in constructor.
   */
  override setMoveVelocity(vx: number, vy: number): void {
    super.setMoveVelocity(vx * CYBER_MOVE_MULTIPLIER, vy * CYBER_MOVE_MULTIPLIER);
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

  protected override onDeath(): void {
    this.destroyDrones();
    super.onDeath();
  }

  override destroy(fromScene?: boolean): void {
    this.destroyDrones();
    super.destroy(fromScene);
  }

  private destroyDrones(): void {
    for (const drone of this.drones) drone.dispose();
    this.drones = [];
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
