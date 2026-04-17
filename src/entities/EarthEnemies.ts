import * as Phaser from 'phaser';
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
