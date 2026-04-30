import * as Phaser from 'phaser';
import { LivingEntity } from '../entities/LivingEntity';
import { Projectile, Damageable } from '../entities/Projectile';
import { CombatEntity } from '../entities/CombatEntity';

// ── Ability constants ──────────────────────────────────────────────────────────

/** Ice Bolt — ranged projectile with slow. */
const ICE_BOLT_DAMAGE     = 30;
const ICE_BOLT_SPEED      = 320;   // px/s
const ICE_BOLT_RANGE      = 480;   // max travel distance
const ICE_BOLT_COLOR      = 0x88ddff;
const SLOW_MULTIPLIER     = 0.35;  // enemy max-velocity reduced to 35%
const SLOW_DURATION_MS    = 2000;

/** Water Push — knockback to nearest enemy near the cast point. */
const WATER_PUSH_RANGE    = 160;   // max distance from cast point to count
const WATER_PUSH_FORCE    = 550;   // px/s impulse

/** Healing Rain — AoE regen over 3 ticks across ~2 s. */
const RAIN_RADIUS         = 110;   // px from cast position
const RAIN_TICKS          = 3;
const RAIN_INTERVAL_MS    = 700;   // 700 × 3 = 2100 ms ≈ 2 s
const RAIN_HP_PER_TICK    = 25;

/** Torrent — outward burst; briefly interrupts all nearby enemies. */
const TORRENT_RADIUS      = 220;   // px from Master Fen's position
const TORRENT_FORCE       = 600;   // px/s impulse
const TORRENT_INTERRUPT_MS = 500;

// ── Internal types ─────────────────────────────────────────────────────────────

/** Tracks the maxVelocity cap saved before a slow was applied. */
interface SlowRecord {
  remaining:    number;
  savedMaxVelX: number;
  savedMaxVelY: number;
}

/**
 * MasterFen — Tier 2 River Mage hero.
 *
 * Extends LivingEntity directly rather than CombatEntity because his
 * behaviour is fully ability-driven — he has no autonomous behavior tree.
 * The scene or a player controller calls castX() methods and calls
 * update(delta) each frame to tick ongoing effects.
 *
 * Abilities:
 *   castIceBolt      — fire a frost bolt; hit enemy is slowed for 2 s
 *   castWaterPush    — knockback to nearest enemy at cast point
 *   castHealingRain  — AoE heal for allies over 3 ticks / ~2 s
 *   castTorrent      — radial blast; interrupts all nearby enemies for 500 ms
 */
export class MasterFen extends LivingEntity {
  /** Active enemies — updated by the scene each frame via setEnemies(). */
  private enemies: CombatEntity[] = [];
  /** Allies that Healing Rain can restore — includes self by default. */
  private allies: LivingEntity[] = [];

  /** Active slow effects keyed by enemy. Prevents stacking multiple slows. */
  private readonly slows = new Map<CombatEntity, SlowRecord>();
  /** Enemies currently interrupted by Torrent, mapped to ms remaining. */
  private readonly interrupts = new Map<CombatEntity, number>();

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, { maxHp: 200 });
    // Master Fen can receive his own Healing Rain.
    this.allies = [this];
  }

  override update(delta: number): void {
    this.tickSlows(delta);
    this.tickInterrupts(delta);
  }

  // ── Public setup ───────────────────────────────────────────────────────────

  /** Provide the current list of live enemies; call each frame. */
  setEnemies(enemies: CombatEntity[]): void {
    this.enemies = enemies;
  }

  /** Override the default allies list (used by Healing Rain). */
  setAllies(allies: LivingEntity[]): void {
    this.allies = allies;
  }

  /** True if the enemy was hit by Torrent and is still interrupted. */
  isInterrupted(enemy: CombatEntity): boolean {
    return this.interrupts.has(enemy);
  }

  // ── Abilities ──────────────────────────────────────────────────────────────

  /**
   * Fire an Ice Bolt toward (targetX, targetY).
   *
   * The Projectile uses wrapped Damageable targets so that when an enemy is
   * hit, applySlowTo() is called alongside takeDamage() — without needing to
   * modify Projectile or CombatEntity.
   */
  castIceBolt(targetX: number, targetY: number): void {
    const angle   = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
    const targets = this.enemies.map(e => this.makeSlowTarget(e));

    const bolt = new Projectile(
      this.scene, this.x, this.y,
      angle, ICE_BOLT_SPEED, ICE_BOLT_DAMAGE, ICE_BOLT_COLOR,
      targets, 18, ICE_BOLT_RANGE,
    );
    // DungeonForgeScene listens for this event and manages the projectile list.
    this.scene.events.emit('projectile-spawned', bolt);
  }

  /**
   * Push the nearest enemy within WATER_PUSH_RANGE of (targetX, targetY)
   * away from Master Fen's position using Arcade physics velocity.
   */
  castWaterPush(targetX: number, targetY: number): void {
    const target = this.nearestEnemyAt(targetX, targetY, WATER_PUSH_RANGE);
    if (!target) return;
    const body = this.arcadeBody(target);
    if (!body) return;
    const dx  = target.x - this.x;
    const dy  = target.y - this.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    body.setVelocity((dx / len) * WATER_PUSH_FORCE, (dy / len) * WATER_PUSH_FORCE);
  }

  /**
   * Create a healing rain at world position (x, y).
   *
   * Uses a Phaser TimerEvent with three ticks so the heal is positional —
   * allies must be in range at the time of each tick, not just at cast time.
   * This matches the spec: "targets position, not entities directly".
   */
  castHealingRain(x: number, y: number): void {
    // Snapshot the allies list at cast time so late setAllies() calls don't
    // affect an in-flight rain.
    const allies = [...this.allies];

    this.scene.time.addEvent({
      delay:    RAIN_INTERVAL_MS,
      repeat:   RAIN_TICKS - 1,   // fires RAIN_TICKS times total
      callback: () => {
        for (const ally of allies) {
          if (!ally.isAlive) continue;
          const dist = Phaser.Math.Distance.Between(x, y, ally.x, ally.y);
          if (dist <= RAIN_RADIUS) {
            ally.heal(RAIN_HP_PER_TICK);
          }
        }
      },
    });
  }

  /**
   * Torrent — push every living enemy within TORRENT_RADIUS outward and
   * mark them interrupted for TORRENT_INTERRUPT_MS.
   *
   * "Interrupted" is tracked in this.interrupts; external code (e.g. a
   * behavior tree action) can check isInterrupted(enemy) to skip attacks.
   */
  castTorrent(): void {
    for (const enemy of this.enemies) {
      if (!enemy.isAlive) continue;
      const dist = Phaser.Math.Distance.Between(this.x, this.y, enemy.x, enemy.y);
      if (dist > TORRENT_RADIUS) continue;

      const body = this.arcadeBody(enemy);
      if (body) {
        const dx  = enemy.x - this.x;
        const dy  = enemy.y - this.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        body.setVelocity((dx / len) * TORRENT_FORCE, (dy / len) * TORRENT_FORCE);
      }

      this.interrupts.set(enemy, TORRENT_INTERRUPT_MS);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Wrap an enemy as a Damageable that automatically applies a slow when
   * takeDamage is called and damage actually lands (returns > 0).
   *
   * Using getters keeps x/y live so the projectile distance check is accurate
   * as the enemy moves.
   */
  private makeSlowTarget(enemy: CombatEntity): Damageable {
    return {
      get x()       { return enemy.x; },
      get y()       { return enemy.y; },
      get isAlive() { return enemy.isAlive; },
      takeDamage: (amount: number) => {
        const dealt = enemy.takeDamage(amount);
        if (dealt > 0) this.applySlowTo(enemy);
        return dealt;
      },
    };
  }

  /**
   * Reduce enemy movement speed by capping its Arcade physics maxVelocity.
   *
   * The BT sets velocity each frame as `direction * this.speed`; capping
   * maxVelocity intercepts that without needing to touch the readonly speed
   * field or the behavior tree.
   *
   * If the enemy is already slowed, only the timer is reset — we never stack
   * multiple caps on the same enemy.
   */
  private applySlowTo(enemy: CombatEntity): void {
    if (this.slows.has(enemy)) {
      // Already slowed — refresh duration, don't re-cap maxVelocity.
      this.slows.get(enemy)!.remaining = SLOW_DURATION_MS;
      return;
    }
    const body = this.arcadeBody(enemy);
    if (!body) return;
    const savedMaxVelX = body.maxVelocity.x;
    const savedMaxVelY = body.maxVelocity.y;
    body.setMaxVelocity(savedMaxVelX * SLOW_MULTIPLIER, savedMaxVelY * SLOW_MULTIPLIER);
    this.slows.set(enemy, { remaining: SLOW_DURATION_MS, savedMaxVelX, savedMaxVelY });
  }

  /** Tick all active slows; restore maxVelocity when they expire. */
  private tickSlows(delta: number): void {
    for (const [enemy, rec] of this.slows) {
      rec.remaining -= delta;
      if (rec.remaining <= 0 || !enemy.isAlive) {
        const body = this.arcadeBody(enemy);
        if (body) body.setMaxVelocity(rec.savedMaxVelX, rec.savedMaxVelY);
        this.slows.delete(enemy);
      }
    }
  }

  /** Tick interrupt timers; remove entries when they expire or the enemy dies. */
  private tickInterrupts(delta: number): void {
    for (const [enemy, remaining] of this.interrupts) {
      if (remaining - delta <= 0 || !enemy.isAlive) {
        this.interrupts.delete(enemy);
      } else {
        this.interrupts.set(enemy, remaining - delta);
      }
    }
  }

  /** Return the Arcade physics body for an entity, or null if not present. */
  private arcadeBody(entity: CombatEntity): Phaser.Physics.Arcade.Body | null {
    const b = entity.body as Phaser.Physics.Arcade.Body | null | undefined;
    return b instanceof Phaser.Physics.Arcade.Body ? b : null;
  }

  /**
   * Find the nearest living enemy within `range` px of (x, y).
   * Returns null if no enemy qualifies.
   */
  private nearestEnemyAt(x: number, y: number, range: number): CombatEntity | null {
    let nearest: CombatEntity | null = null;
    let minDist = range;
    for (const e of this.enemies) {
      if (!e.isAlive) continue;
      const d = Phaser.Math.Distance.Between(x, y, e.x, e.y);
      if (d < minDist) {
        minDist  = d;
        nearest  = e;
      }
    }
    return nearest;
  }
}
