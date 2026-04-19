import * as Phaser from 'phaser';
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

// ── Drone swarm constants ─────────────────────────────────────────────────────

/** Number of projectiles in each drone salvo. */
const DRONE_COUNT = 5;

/** Total angular spread of the cone in radians (60°). */
const DRONE_SPREAD = Math.PI / 3;

// ── Orbital strike constants ──────────────────────────────────────────────────

/** Radius of the orbital strike AoE in px. */
const ORBITAL_RADIUS = 70;

/** Flat damage dealt to each enemy inside the AoE. */
const ORBITAL_DAMAGE = 50;

/** Delay between the marker appearing and the strike landing (ms). */
const ORBITAL_DELAY_MS = 1500;

/** ms between consecutive orbital strike deployments. */
const ORBITAL_COOLDOWN_MS = 8000;

// ── Pattern Adaptation constants ──────────────────────────────────────────────

/**
 * Maximum cumulative dodge angle magnitude in radians (±60°).
 * Prevents KRONOS from orbiting indefinitely in a single direction.
 */
const DODGE_CAP = Math.PI / 3;

/**
 * Per-hit adjustment added to the dodge offset each time onHitBy() fires.
 * Small enough that a single hit only nudges the AI but repeated attacks
 * from the same angle cause a pronounced sidestep.
 */
const DODGE_STEP = Math.PI / 12; // 15° per hit

/**
 * KRONOS — Tier 5 Earth hero. Autonomous war AI — no cockpit, no face.
 *
 * ## Drone Swarm
 * Every ranged attack fires DRONE_COUNT projectiles in a 60° cone, making
 * it nearly impossible to dodge at close range.
 *
 * ## Orbital Strike
 * Drops a visible red marker at the target's position, waits ORBITAL_DELAY_MS,
 * then damages all opponents within ORBITAL_RADIUS. The telegraphed delay
 * rewards alert enemies with a dodge window.
 *
 * ## Pattern Adaptation (passive)
 * Overrides `onHitBy()` to record every attacker's angle. Each hit adjusts
 * a `dodgeAngle` field, which the BT movement step adds to the approach vector,
 * gradually biasing KRONOS to circle around its target rather than charge head-on.
 * The offset is clamped to ±DODGE_CAP (±60°) so it can't spiral infinitely.
 *
 * ## Visual
 * 2.5× the base ENTITY_SIZE rectangle (50 px) in deep navy.
 * Real sprite to be swapped in when the KRONOS Aseprite sheet is ready.
 */
export class Kronos extends EarthHero {
  readonly name = 'KRONOS';

  /**
   * Pattern Adaptation is a passive — it has no active trigger.
   * A non-zero cooldown is required by the interface; 0 signals "no active signature".
   */
  readonly signatureCooldownMs = 0;

  /**
   * Cumulative dodge bias accumulated through Pattern Adaptation.
   * Added to the movement angle each frame, clamped to ±DODGE_CAP.
   */
  private dodgeAngle = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:               150,
      speed:               90,
      aggroRadius:         500,
      attackDamage:        20,
      color:               0x003366,   // deep navy — cold autonomous machine
      spriteKey:           'tinkerer', // TODO: replace with 'kronos' once PixelLab sprite is assembled
      meleeRange:          30,
      attackCooldownMs:    600,
      projectileDamage:    16,
      projectileSpeed:     320,
      projectileColor:     0x00eeff,   // cyan drone projectiles
      dashSpeedMultiplier: 3.5,
      dashDurationMs:      280,
    });

    // Scale the Container so the placeholder rectangle reads as larger than standard.
    // ENTITY_SIZE is 20 px; 2.5× = 50 px visible body.
    this.setScale(2.5);
  }

  // ── Signature (passive — no active use) ──────────────────────────────────────

  /**
   * Pattern Adaptation is passive; this method is a no-op.
   * The arena HUD can still call it safely (returns immediately).
   */
  useSignature(): void {
    // Passive ability — activated automatically via onHitBy() overrides.
  }

  // ── Pattern Adaptation ────────────────────────────────────────────────────────

  /**
   * Records the attacker's angle and adjusts `dodgeAngle` accordingly.
   *
   * Called by the attacker immediately after dealing damage (via CombatEntity's
   * attack() and melee closures). Each hit nudges the dodge bias by DODGE_STEP
   * in the direction away from the attacker. The value is clamped to ±DODGE_CAP
   * so KRONOS circles the target at most ±60° from the direct approach line.
   */
  override onHitBy(fromX: number, fromY: number): void {
    super.onHitBy(fromX, fromY);

    // Angle from KRONOS toward the attacker — nudge dodgeAngle away from it.
    const incomingAngle = Math.atan2(fromY - this.y, fromX - this.x);
    // Perpendicular step: rotate 90° to bias sideways movement.
    const step = incomingAngle + Math.PI / 2;
    this.dodgeAngle = Phaser.Math.Clamp(
      this.dodgeAngle + Math.cos(step) * DODGE_STEP,
      -DODGE_CAP,
      DODGE_CAP,
    );
  }

  // ── Drone helpers ─────────────────────────────────────────────────────────────

  /**
   * Fire a DRONE_COUNT-projectile cone spread centred on the target.
   *
   * The spread covers DRONE_SPREAD radians (60°), evenly divided between shots.
   * All projectiles use the same damage and speed as a single shot would.
   */
  private fireDroneSalvo(tx: number, ty: number): void {
    if (!this.projectileDamage) return;

    const centreAngle = Math.atan2(ty - this.y, tx - this.x);
    const step = DRONE_COUNT > 1 ? DRONE_SPREAD / (DRONE_COUNT - 1) : 0;
    const startAngle = centreAngle - DRONE_SPREAD / 2;

    for (let i = 0; i < DRONE_COUNT; i++) {
      const angle = startAngle + step * i;
      const p = new Projectile(
        this.scene, this.x, this.y, angle,
        this.projectileSpeed, this.projectileDamage,
        this.projectileColor,
        (this.opponents as unknown as Damageable[]).concat(this.extraDamageables),
      );
      this.scene.events.emit('projectile-spawned', p);
    }

    this.scene.events.emit('hero-shot', this.x, this.y, centreAngle);
  }

  // ── Orbital strike ────────────────────────────────────────────────────────────

  /**
   * Drop an orbital strike marker at (tx, ty).
   *
   * Shows a red circle for ORBITAL_DELAY_MS, then detonates, dealing
   * ORBITAL_DAMAGE to all living opponents within ORBITAL_RADIUS.
   * Uses scene.time.delayedCall so the AoE lands exactly ORBITAL_DELAY_MS
   * after the marker appears, giving alert targets a short window to dodge.
   */
  private launchOrbitalStrike(tx: number, ty: number): void {
    // Marker: expanding red ring telegraphs the impact zone.
    const marker = this.scene.add.circle(tx, ty, ORBITAL_RADIUS, 0xff2200, 0.15);
    marker.setDepth(6).setStrokeStyle(2, 0xff4400);

    // Pulse inward to count down the delay visually.
    this.scene.tweens.add({
      targets:  marker,
      scaleX:   0.6,
      scaleY:   0.6,
      alpha:    0.35,
      duration: ORBITAL_DELAY_MS,
      ease:     'Sine.easeIn',
    });

    this.scene.time.delayedCall(ORBITAL_DELAY_MS, () => {
      if (!this.active) { marker.destroy(); return; }

      // Damage all living opponents inside the radius at the moment of impact.
      for (const opp of this.opponents) {
        if (opp.isAlive && Phaser.Math.Distance.Between(tx, ty, opp.x, opp.y) < ORBITAL_RADIUS) {
          opp.takeDamage(ORBITAL_DAMAGE);
        }
      }

      // Flash: expanding white ring fades quickly.
      const flash = this.scene.add.circle(tx, ty, 10, 0xffffff, 0.9);
      flash.setDepth(10);
      this.scene.tweens.add({
        targets:  flash,
        scaleX:   ORBITAL_RADIUS / 5,
        scaleY:   ORBITAL_RADIUS / 5,
        alpha:    0,
        duration: 220,
        ease:     'Cubic.easeOut',
        onComplete: () => { if (flash.active) flash.destroy(); },
      });

      if (marker.active) marker.destroy();
    });
  }

  // ── Behavior tree ─────────────────────────────────────────────────────────────

  protected buildTree(): BtNode {
    const MELEE_R     = this.meleeRange;
    const DRONE_MIN   = 60;
    const DRONE_MAX   = 280;
    const ORBITAL_MIN = 120;

    return new BtSelector([

      // 1. Drone salvo — fires DRONE_COUNT projectiles in a cone.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= DRONE_MIN && d <= DRONE_MAX;
          }),
          new BtAction(ctx => {
            this.fireDroneSalvo(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        // Mirror attackCooldownMs so the BT re-arms at the same rhythm as tryRanged.
        600,
      ),

      // 2. Orbital strike — telegraphed AoE at range.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= ORBITAL_MIN;
          }),
          new BtAction(ctx => {
            this.launchOrbitalStrike(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        ORBITAL_COOLDOWN_MS,
      ),

      // 3. Melee fallback when adjacent.
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
          return d < MELEE_R;
        }),
        new BtAction(ctx => {
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // 4. Pattern Adaptation movement — approach target at a biased angle.
      // dodgeAngle accumulates each time KRONOS takes a hit, causing it to
      // gradually circle rather than charge straight at the attacker.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          const dx = ctx.opponent!.x - ctx.x;
          const dy = ctx.opponent!.y - ctx.y;
          const baseAngle = Math.atan2(dy, dx);
          const biasedAngle = baseAngle + this.dodgeAngle;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          // Move in the biased direction at full speed — the offset rotates the
          // approach vector rather than slowing it.
          ctx.moveToward(
            ctx.x + Math.cos(biasedAngle) * dist,
            ctx.y + Math.sin(biasedAngle) * dist,
          );
          return 'running';
        }),
      ]),

      // 5. Wander fallback.
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
