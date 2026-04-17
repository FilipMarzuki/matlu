import * as Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
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

      // ── Slow chase ────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── Wander (fallback) ─────────────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
