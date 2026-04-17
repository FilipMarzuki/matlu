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
} from '../ai/BehaviorTree';

// ── SignalJammer ──────────────────────────────────────────────────────────────

/**
 * SignalJammer — stationary corrupted broadcast tower.
 *
 * Does not move or attack. Projects a 200 px radius that sets
 * `signatureDisabled = true` on any hero inside it each tick; clears the flag
 * when the hero moves out. Fully damageable and targetable despite being
 * immobile — its behavior tree always returns the idle action.
 */
export class SignalJammer extends CombatEntity {
  private static readonly SUPPRESS_RADIUS = 200;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            200,
      speed:            0,
      aggroRadius:      0,
      attackDamage:     0,
      color:            0xcc4422,
      meleeRange:       1,
      attackCooldownMs: 99_999,
    });
  }

  override updateBehaviour(delta: number): void {
    // Run the base class (idle BT + HP bar) before applying suppression so
    // the physics body is zeroed by ctx.stop() before we do our own work.
    super.updateBehaviour(delta);

    const r2 = SignalJammer.SUPPRESS_RADIUS ** 2;
    for (const opp of this.opponents) {
      if (!opp.isAlive) continue;
      const dx = opp.x - this.x;
      const dy = opp.y - this.y;
      opp.signatureDisabled = dx * dx + dy * dy <= r2;
    }
  }

  protected override onDeath(): void {
    // Clear suppression on all opponents when the jammer is destroyed.
    for (const opp of this.opponents) {
      if (opp.isAlive) opp.signatureDisabled = false;
    }
    super.onDeath();
  }

  protected buildTree(): BtNode {
    // SignalJammer never moves — the BT only stops the physics body every tick.
    return new BtAction(ctx => {
      ctx.stop();
import { CombatEntity, CombatEntityConfig } from './CombatEntity';
import { BtNode, BtAction } from '../ai/BehaviorTree';

// ── Shared constants ──────────────────────────────────────────────────────────

const TITAN_BASE_SPEED = 55;
const TITAN_MAX_HP     = 500;

// ── TitanPrototype ────────────────────────────────────────────────────────────

/**
 * TitanPrototype — corrupted super-mech final boss. Three distinct combat
 * phases driven by HP thresholds:
 *
 *   Phase 1 (100% → 50% HP): Artillery. Maintains ~350 px from the hero and
 *     fires projectile shells every 2 s. Backs away if hero comes within 300 px.
 *
 *   Phase 2 (50% → 25% HP): Berserk. Charges at the hero at 2.5× base speed.
 *     No ranged attacks. Melee cooldown: 400 ms.
 *
 *   Phase 3 (< 25% HP): Split. Sets dead=true, emits 'titan-split' on the
 *     scene so CombatArenaScene can spawn two TitanHalf entities in its place,
 *     then plays the standard death effects.
 *
 * The `phase` field guards each transition so it can only fire once:
 *   1 → 2 check runs only when phase === 1
 *   2 → 3 check runs only when phase === 2
 * Two separate `if` blocks (not else-if) allow a single massive hit that
 * crosses both thresholds to cascade all the way to phase 3 in one call.
 */
export class TitanPrototype extends CombatEntity {
  private phase: 1 | 2 | 3 = 1;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const config: CombatEntityConfig = {
      maxHp:            TITAN_MAX_HP,
      speed:            TITAN_BASE_SPEED,
      aggroRadius:      600,
      attackDamage:     30,
      color:            0xcc3300,
      meleeRange:       40,
      // Used in phase 2 — phase 1 manages its own projectile timer
      attackCooldownMs: 400,
      // Phase 1 artillery shells
      projectileDamage: 20,
      projectileSpeed:  300,
      projectileColor:  0xff8800,
      sightMemoryMs:    5000,
    };
    super(scene, x, y, config);
  }

  /**
   * Override takeDamage to inject phase-transition logic after each hit.
   *
   * Two separate `if` blocks let a single crushing blow cascade from phase 1
   * all the way to the split (phase 3) without an intermediate hit requirement.
   * The early `return` after enterPhase3() prevents the normal `onDeath()`
   * path from running a second time.
   */
  override takeDamage(amount: number): number {
    if (this.dead) return 0;
    const actual = Math.min(amount, this.hp);
    this.hp -= actual;

    // Phase 1 → 2: at or below half HP
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2;
      this.enterPhase2();
    }

    // Phase 2 → 3: at or below quarter HP — TITAN splits instead of dying
    if (this.phase === 2 && this.hp <= this.maxHp * 0.25) {
      this.phase = 3;
      this.enterPhase3();
      return actual; // enterPhase3 sets dead=true and calls onDeath(); skip below
    }

    if (this.hp <= 0) {
      this.dead = true;
      this.onDeath();
    }
    return actual;
  }

  protected buildTree(): BtNode {
    let projTimer = 0;
    const PROJ_CD   = 2000; // ms between artillery shots
    const MIN_DIST  = 300;  // back away when hero is closer than this
    const KEEP_DIST = 350;  // preferred engagement distance in phase 1

    // Single BtAction owns all three phases so closure variables like projTimer
    // are shared across frames — the same pattern used by BruteCarapace.
    return new BtAction((ctx, delta) => {
      if (!ctx.opponent) { ctx.wander(delta); return 'running'; }

      const dist     = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
      const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;

      if (this.phase === 1) {
        // ── Artillery: stay at range, back off if hero closes in ─────────────
        projTimer = Math.max(0, projTimer - delta);

        if (dist < MIN_DIST) {
          // Hero too close — retreat to artillery distance
          ctx.steerAway(ctx.opponent.x, ctx.opponent.y);
        } else {
          // Move into range if too far, otherwise hold position
          if (dist > KEEP_DIST) {
            ctx.moveToward(ctx.opponent.x, ctx.opponent.y);
          } else {
            ctx.stop();
          }
          // Fire when timer allows; ctx.shootAt handles LOS check internally
          if (projTimer <= 0) {
            ctx.shootAt(ctx.opponent.x, ctx.opponent.y);
            projTimer = PROJ_CD;
          }
        }
      } else if (this.phase === 2) {
        // ── Berserk: charge at 2.5× speed, heavy melee ───────────────────────
        if (dist <= this.meleeRange) {
          ctx.attack();
          ctx.stop();
        } else if (physBody) {
          // Set velocity directly at 2.5× speed — ctx.moveToward is capped to
          // the readonly base speed field, so we bypass it for the multiplier.
          const dx  = ctx.opponent.x - ctx.x;
          const dy  = ctx.opponent.y - ctx.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          physBody.setVelocity((dx / len) * this.speed * 2.5, (dy / len) * this.speed * 2.5);
        }
      }
      // Phase 3: entity is already dead — BT should not be reached

      return 'running';
    });
  }

  // ── Phase transition helpers ──────────────────────────────────────────────

  private enterPhase2(): void {
    // Rapid strobe signals to the player that the boss has gone berserk
    this.scene.tweens.add({
      targets:  this,
      alpha:    { from: 1.0, to: 0.15 },
      duration: 100,
      yoyo:     true,
      repeat:   3,
    });
  }

  private enterPhase3(): void {
    // Mark dead first so isAlive() returns false and the prune loop removes
    // this entity from aliveEnemies on the same frame.
    this.dead = true;
    // Emit before death effects so the scene has the correct world position.
    this.scene.events.emit('titan-split', this.x, this.y);
    // Play standard CombatEntity death effects (alpha fade + burst particles).
    // onDeath() deliberately does NOT call super.onDeath() / this.destroy() —
    // the scene's prune loop schedules destruction via delayedCall.
    this.onDeath();
  }
}

// ── TitanHalf ─────────────────────────────────────────────────────────────────

/**
 * TitanHalf — one of the two fragments spawned when TITAN Prototype splits at
 * Phase 3. Behaves as a pure berserker (same style as TITAN Phase 2): charges
 * at the hero at normal + 20% speed with heavy melee. No ranged attack; no
 * further phase transitions.
 */
export class TitanHalf extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    const config: CombatEntityConfig = {
      maxHp:            125,
      speed:            Math.round(TITAN_BASE_SPEED * 1.2), // 66 px/s ± jitter
      aggroRadius:      600,
      attackDamage:     18,
      color:            0xff4411,
      meleeRange:       35,
      attackCooldownMs: 500,
      sightMemoryMs:    4000,
    };
    super(scene, x, y, config);
  }

  protected buildTree(): BtNode {
    return new BtAction((ctx, delta) => {
      if (!ctx.opponent) { ctx.wander(delta); return 'running'; }

      const dist     = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
      const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;

      if (dist <= this.meleeRange) {
        ctx.attack();
        ctx.stop();
      } else if (physBody) {
        // Charge at 1.2× speed — set velocity directly for the same reason
        // as TitanPrototype phase 2 (this.speed is readonly).
        const dx  = ctx.opponent.x - ctx.x;
        const dy  = ctx.opponent.y - ctx.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        physBody.setVelocity((dx / len) * this.speed, (dy / len) * this.speed);
      }

      return 'running';
    });
  }
}

// ── InfectedAPC ───────────────────────────────────────────────────────────────

/**
 * InfectedAPC — corrupted armoured vehicle that drives in straight lines and rams.
 *
 * Mechanic: positional weak point.
 *   - Rear arc  (> 90° from facing direction): 3× damage multiplier.
 *   - Front arc (≤ 90° from facing direction): 0.1× damage multiplier.
 *
 * The APC drives in its current `_facingAngle` direction and gradually
 * corrects that angle toward the hero at TURN_RATE rad/s — creating the
 * "drives in straight lines, turns slowly" feel described in the spec.
 *
 * Arc detection uses Phaser.Math.Angle.Between + Phaser.Math.Angle.Wrap so
 * the difference is always normalised to [−π, π].
 */
export class InfectedAPC extends CombatEntity {
  /** Direction the APC is currently travelling, in radians. */
  private _facingAngle: number;
  /** Amount of the most-recent takeDamage call — used for arc compensation. */
  private _lastDamageAmount = 0;

  private static readonly TURN_RATE = 1.2; // radians per second

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            180,
      speed:            90,
      aggroRadius:      500,
      attackDamage:     25,
      color:            0x556644,
      meleeRange:       30,
      attackCooldownMs: 1200,
    });
    // Random initial heading so a group of APCs don't all face the same way.
    this._facingAngle = Math.random() * Math.PI * 2;
  }

  /**
   * Store the raw damage amount so onHitBy can use it for arc-based
   * compensation. We call super (→ LivingEntity.takeDamage) with the
   * unmodified amount; the correction happens in onHitBy.
   */
  override takeDamage(amount: number): number {
    this._lastDamageAmount = amount;
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
   * After the attacker deals damage, apply the directional multiplier:
   *   - Front arc (|diff| ≤ π/2): restore 90% of the damage dealt (net 0.1×).
   *   - Rear  arc (|diff|  > π/2): deal 2× extra damage           (net 3×).
   *
   * Compensation is skipped if the entity died from the base hit, which means
   * very-high-damage attacks can still penetrate the front armour at low HP —
   * this is intentional ("near-impenetrable", not invulnerable).
   */
  override onHitBy(fromX: number, fromY: number): void {
    if (this.isAlive && this._lastDamageAmount > 0) {
      const attackerAngle = Phaser.Math.Angle.Between(this.x, this.y, fromX, fromY);
      // Normalise to [−π, π] so the absolute value gives the angular deviation.
      const diff = Phaser.Math.Angle.Wrap(attackerAngle - this._facingAngle);

      if (Math.abs(diff) <= Math.PI / 2) {
        // Front arc — restore 90% of the already-applied damage (→ net 0.1×).
        const restore = this._lastDamageAmount * 0.9;
        // hp is protected on LivingEntity; subclasses may read/write it.
        this.hp = Math.min(this.maxHp, this.hp + restore);
      } else {
        // Rear arc — apply 2× additional damage to reach 3× total.
        // Call super.takeDamage to bypass InfectedAPC.takeDamage (which would
        // overwrite _lastDamageAmount) and go directly to LivingEntity.
        super.takeDamage(this._lastDamageAmount * 2);
      }
    }
    super.onHitBy(fromX, fromY);
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
      // ── Ram when in contact range ─────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < R,
        ),
        new BtAction(ctx => {
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // ── Drive forward, gradually steering toward the hero ─────────────────
      //
      // Each tick the APC nudges its facing angle by at most TURN_RATE×delta
      // toward the hero's angle — this is what creates the "straight lines,
      // turns slowly" feel. ctx.moveToward a point 100 px ahead in the facing
      // direction so the velocity always matches the current heading.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction((ctx, delta) => {
          const targetAngle = Phaser.Math.Angle.Between(ctx.x, ctx.y, ctx.opponent!.x, ctx.opponent!.y);
          const diff        = Phaser.Math.Angle.Wrap(targetAngle - this._facingAngle);
          const maxTurn     = InfectedAPC.TURN_RATE * (delta / 1000);
          this._facingAngle += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
          ctx.moveToward(
            ctx.x + Math.cos(this._facingAngle) * 100,
            ctx.y + Math.sin(this._facingAngle) * 100,
          );
          return 'running';
        }),
      ]),

      // ── Wander when no opponent ───────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}

// ── ScrapGolem ────────────────────────────────────────────────────────────────

/**
 * ScrapGolem — self-assembling corrupted construct.
 *
 * Mechanic: environmental regeneration. Every 1 000 ms the golem checks for
 * debris objects (StaticGroup members — arena pillars and corner zones) within
 * 150 px. If any are found it heals 10 HP and grows by 0.1 scale (max 1.5×).
 * Scale resets on death. Without nearby debris the golem cannot regenerate.
 *
 * Call `setObstacles(group)` after spawning (done by CombatArenaScene.addPhysics)
 * to wire up the debris source. Until then the golem simply can't regen.
 */
export class ScrapGolem extends CombatEntity {
  private static readonly DEBRIS_RADIUS    = 150;
  private static readonly REGEN_INTERVAL   = 1_000; // ms
  private static readonly REGEN_HP         = 10;
  private static readonly SCALE_STEP       = 0.1;
  private static readonly MAX_SCALE        = 1.5;

  private _regenTimer    = 0;
  private _currentScale  = 1.0;
  private _obstacles: Phaser.Physics.Arcade.StaticGroup | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            200,
      speed:            45,
      aggroRadius:      400,
      attackDamage:     18,
      color:            0x887755,
      meleeRange:       32,
      attackCooldownMs: 1400,
    });
  }

  /**
   * Wire up the arena's StaticGroup so the golem can detect nearby obstacles
   * as proxy debris. Called by CombatArenaScene.addPhysics after spawning.
   */
  setObstacles(group: Phaser.Physics.Arcade.StaticGroup): void {
    this._obstacles = group;
  }

  override updateBehaviour(delta: number): void {
    this._regenTimer += delta;
    if (this._regenTimer >= ScrapGolem.REGEN_INTERVAL) {
      this._regenTimer = 0;
      this._checkDebrisRegen();
    }
    super.updateBehaviour(delta);
  }

  /**
   * Check whether any obstacle (Zone) is within DEBRIS_RADIUS. If so, heal
   * and grow. The arena's StaticGroup contains stone pillar bodies and corner
   * zones — these serve as the "debris" the golem feeds on.
   */
  private _checkDebrisRegen(): void {
    if (!this._obstacles) return;
    const r2      = ScrapGolem.DEBRIS_RADIUS ** 2;
    const members = this._obstacles.getChildren() as Phaser.GameObjects.Zone[];
    let debrisNearby = false;
    for (const zone of members) {
      const dx = zone.x - this.x;
      const dy = zone.y - this.y;
      if (dx * dx + dy * dy <= r2) {
        debrisNearby = true;
        break;
      }
    }
    if (!debrisNearby) return;

    // Heal — hp is protected on LivingEntity, accessible from subclasses.
    this.hp = Math.min(this.maxHp, this.hp + ScrapGolem.REGEN_HP);

    // Grow — capped at MAX_SCALE.
    if (this._currentScale < ScrapGolem.MAX_SCALE) {
      this._currentScale = Math.min(ScrapGolem.MAX_SCALE, this._currentScale + ScrapGolem.SCALE_STEP);
      this.setScale(this._currentScale);
    }
  }

  protected override onDeath(): void {
    // Reset scale so the corpse fades at normal size.
    this._currentScale = 1.0;
    this.setScale(1.0);
    super.onDeath();
  }

  protected buildTree(): BtNode {
    const R = this.meleeRange;

    return new BtSelector([

      // ── Melee when adjacent ───────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < R,
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
      // ── Slow chase ────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 4. Wander (fallback) ──────────────────────────────────────────────
      // ── Wander (fallback) ─────────────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
