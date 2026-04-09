import Phaser from 'phaser';
import { Enemy, EnemyConfig } from './Enemy';
import { Projectile, Damageable } from './Projectile';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
  CombatContext,
} from '../ai/BehaviorTree';

// ── Visual constants ──────────────────────────────────────────────────────────

/** Size of the entity rectangle in pixels (centered in the Container). */
const ENTITY_SIZE = 20;

/** HP bar dimensions and vertical offset above the entity center. */
const BAR_W  = 36;
const BAR_H  = 5;
const BAR_Y  = -20; // px above Container center

// ── Config ────────────────────────────────────────────────────────────────────

export interface CombatEntityConfig extends EnemyConfig {
  /** Rectangle fill colour (hex, e.g. 0x4488ff). */
  color: number;
  /** Distance in px at which the melee attack branch triggers. */
  meleeRange: number;
  /** Minimum ms between consecutive melee attacks. */
  attackCooldownMs: number;

  // ── Ranged attack (optional) ──────────────────────────────────────────────
  /** Damage per projectile. If absent the entity has no ranged attack. */
  projectileDamage?: number;
  /** Projectile travel speed in px/s. Default: 260. */
  projectileSpeed?: number;
  /** Projectile fill colour. Default: 0xffffff. */
  projectileColor?: number;

  // ── Dash (optional) ───────────────────────────────────────────────────────
  /** Dash speed as a multiple of the entity's base speed. Default: 4.5. */
  dashSpeedMultiplier?: number;
  /** How long the dash lasts in ms. Default: 180. */
  dashDurationMs?: number;
}

// ── Base class ────────────────────────────────────────────────────────────────

/**
 * CombatEntity — base class for all arena fighters.
 *
 * Extends Enemy which provides: aggroRadius, attackDamage, speed, and the
 * updateBehaviour(delta) hook called every frame while alive.
 *
 * Adds:
 *   - Behavior tree execution (subclasses implement buildTree())
 *   - Multi-opponent support: BT always targets nearest living opponent
 *   - Melee attack cooldown tracking
 *   - Optional ranged attack: spawn Projectile via shootAt() closure
 *   - Optional directional dash: burst velocity via dash() closure
 *   - HP bar visuals (two stacked rectangles inside the Container)
 *
 * Visual: colored rectangle — sprites are swapped in a later pass.
 *
 * Physics body: added externally by CombatArenaScene after construction:
 *   scene.physics.add.existing(entity);
 *   (entity.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
 */
export abstract class CombatEntity extends Enemy {
  readonly meleeRange: number;
  readonly attackCooldownMs: number;

  protected readonly behaviorTree: BtNode;
  /** All combatants this entity should fight. Updated each wave by the arena. */
  protected opponents: CombatEntity[] = [];

  private attackTimer = 0;
  private wanderAngle = Math.random() * Math.PI * 2;
  private wanderTimer = 0;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;

  // ── Dash state ──────────────────────────────────────────────────────────────
  private isDashing  = false;
  private dashTimer  = 0;
  private dashVx     = 0;
  private dashVy     = 0;
  private readonly dashSpeedMultiplier: number;
  private readonly dashDurationMs:      number;

  // ── Ranged config ───────────────────────────────────────────────────────────
  protected readonly projectileDamage: number | undefined;
  private   readonly projectileSpeed:  number;
  private   readonly projectileColor:  number;

  constructor(scene: Phaser.Scene, x: number, y: number, config: CombatEntityConfig) {
    super(scene, x, y, config);
    this.meleeRange       = config.meleeRange;
    this.attackCooldownMs = config.attackCooldownMs;

    this.dashSpeedMultiplier = config.dashSpeedMultiplier ?? 4.5;
    this.dashDurationMs      = config.dashDurationMs      ?? 180;

    this.projectileDamage = config.projectileDamage;
    this.projectileSpeed  = config.projectileSpeed  ?? 260;
    this.projectileColor  = config.projectileColor  ?? 0xffffff;

    // ── Visuals (all children of this Container) ──────────────────────────
    //
    // scene.add.X() creates the object AND adds it to the scene display list.
    // this.add(obj) then moves it from the scene list into this Container —
    // Container children are rendered by the Container, not the scene directly.

    // Body rectangle — centered at Container origin (0, 0).
    const bodyRect = scene.add.rectangle(0, 0, ENTITY_SIZE, ENTITY_SIZE, config.color);
    this.add(bodyRect);

    // HP bar background (dark red, full width).
    const hpBarBg = scene.add.rectangle(0, BAR_Y, BAR_W, BAR_H, 0x661111);
    this.add(hpBarBg);

    // HP bar fill (green, shrinks left-to-right as HP drops).
    // Origin at (0, 0.5) so it anchors at the left edge while scaleX shrinks it.
    this.hpBarFill = scene.add.rectangle(-BAR_W / 2, BAR_Y, BAR_W, BAR_H, 0x44cc44);
    this.hpBarFill.setOrigin(0, 0.5);
    this.add(this.hpBarFill);

    // Build the behavior tree after all config is stored so subclass trees
    // can safely reference `this` fields.
    this.behaviorTree = this.buildTree();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Set a single opponent (convenience wrapper for 1v1). */
  setOpponent(e: CombatEntity): void {
    this.opponents = [e];
  }

  /** Set multiple opponents (hero vs. group). BT picks nearest living each frame. */
  setOpponents(es: CombatEntity[]): void {
    this.opponents = [...es];
  }

  // ── Abstract ───────────────────────────────────────────────────────────────

  /** Return this entity's behavior tree. Called once at end of constructor. */
  protected abstract buildTree(): BtNode;

  // ── Enemy hook ─────────────────────────────────────────────────────────────

  /**
   * Core AI tick — called every frame by Enemy.update() while isAlive.
   *
   * Order:
   *   1. Tick dash state machine (re-apply velocity so BT can't cancel it)
   *   2. Build CombatContext with all closures
   *   3. Run behavior tree
   *   4. Refresh HP bar visual
   */
  override updateBehaviour(delta: number): void {
    this.attackTimer = Math.max(0, this.attackTimer - delta);

    // Physics body — may be undefined if the scene hasn't added it yet.
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;

    // ── Dash state machine ────────────────────────────────────────────────────
    //
    // Re-apply dash velocity every frame while the dash is active.
    // This is necessary because BT branches that run on the same tick
    // (Chase, Wander) would otherwise call setVelocity and cancel the burst.
    // The moveToward and stop closures below also guard against this.
    if (this.isDashing) {
      this.dashTimer -= delta;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
        physBody?.setVelocity(0, 0);
      } else {
        physBody?.setVelocity(this.dashVx, this.dashVy);
      }
    }

    // Pick the nearest living opponent for this frame's BT tick.
    const target = this.findNearestLivingOpponent();

    const ctx: CombatContext = {
      x:     this.x,
      y:     this.y,
      hp:    this.hp,
      maxHp: this.maxHp,

      opponent: target ? { x: target.x, y: target.y } : null,

      moveToward: (tx, ty) => {
        // No-op during dash so the burst velocity isn't overwritten.
        if (!physBody || this.isDashing) return;
        const dx  = tx - this.x;
        const dy  = ty - this.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        physBody.setVelocity((dx / len) * this.speed, (dy / len) * this.speed);
      },

      stop: () => {
        // No-op during dash for the same reason.
        if (this.isDashing) return;
        physBody?.setVelocity(0, 0);
      },

      attack: () => {
        if (this.attackTimer > 0 || !target) return;
        target.takeDamage(this.attackDamage);
        this.attackTimer = this.attackCooldownMs;
      },

      wander: (_d) => {
        this.wanderTimer -= delta;
        if (this.wanderTimer <= 0) {
          this.wanderAngle += (Math.random() - 0.5) * Math.PI;
          this.wanderTimer = Phaser.Math.Between(800, 2500);
        }
        if (this.isDashing) return; // don't interrupt dash
        physBody?.setVelocity(
          Math.cos(this.wanderAngle) * this.speed * 0.3,
          Math.sin(this.wanderAngle) * this.speed * 0.3,
        );
      },

      // ── New: ranged attack ─────────────────────────────────────────────────
      shootAt: (tx, ty) => {
        if (!this.projectileDamage) return;
        const angle = Math.atan2(ty - this.y, tx - this.x);
        const p = new Projectile(
          this.scene, this.x, this.y, angle,
          this.projectileSpeed, this.projectileDamage,
          this.projectileColor,
          // opponents satisfies Damageable[] — same shape, different import path.
          this.opponents as unknown as Damageable[],
        );
        // Emit on the SCENE event bus (not this.emit) so CombatArenaScene can
        // listen with a single handler rather than per-entity listeners.
        this.scene.events.emit('projectile-spawned', p);
      },

      // ── New: directional dash ──────────────────────────────────────────────
      dash: (tx, ty) => {
        if (this.isDashing || !physBody) return;
        const dx  = tx - this.x;
        const dy  = ty - this.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const spd = this.speed * this.dashSpeedMultiplier;
        this.dashVx    = (dx / len) * spd;
        this.dashVy    = (dy / len) * spd;
        this.dashTimer = this.dashDurationMs;
        this.isDashing = true;
        physBody.setVelocity(this.dashVx, this.dashVy);
      },
    };

    this.behaviorTree.tick(ctx, delta);
    this.refreshHpBar();
  }

  /** Returns the closest living opponent, or null when none remain. */
  private findNearestLivingOpponent(): CombatEntity | null {
    let nearest: CombatEntity | null = null;
    let nearestDist = Infinity;
    for (const o of this.opponents) {
      if (!o.isAlive) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, o.x, o.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = o;
      }
    }
    return nearest;
  }

  // ── LivingEntity hook ──────────────────────────────────────────────────────

  /**
   * Override death to fade the entity rather than destroying it immediately.
   * CombatArenaScene detects death by polling isAlive and handles cleanup
   * after a short delay, so the dead entity stays visible briefly as feedback.
   */
  protected override onDeath(): void {
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    physBody?.setVelocity(0, 0);
    this.setAlpha(0.3);
    // Do NOT call super.onDeath() — that would call this.destroy() immediately.
    this.scene.events.emit('combatant-died', this);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private refreshHpBar(): void {
    this.hpBarFill.scaleX = Math.max(0, this.hpFraction);
  }
}

// ── Concrete fighters ─────────────────────────────────────────────────────────

/**
 * Skald — Earth hero, balanced melee + ranged fighter.
 *
 * Behavior tree (priority order):
 *   1. Rune Surge  — AOE slam (7s cooldown) when enemies cluster within 130px
 *   2. Melee       — attack + stop when within 34px
 *   3. Dash        — gap-close burst (4s cooldown) when at 34–350px
 *   4. Ranged      — shoot rune bolt (950ms cooldown) when at 60–220px
 *   5. Chase       — move toward nearest opponent
 *   6. Wander      — random drift (no opponent visible)
 */
export class Skald extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:              100,
      speed:              80,
      aggroRadius:        400,
      attackDamage:       12,
      color:              0x3366ee,   // blue
      meleeRange:         34,
      attackCooldownMs:   800,
      // Ranged
      projectileDamage:   14,
      projectileSpeed:    280,
      projectileColor:    0x44aaff,   // bright blue rune bolt
      // Dash
      dashSpeedMultiplier: 4.5,
      dashDurationMs:     180,
    });
  }

  protected buildTree(): BtNode {
    const MELEE_R      = this.meleeRange;   // 34px
    const DASH_MIN     = MELEE_R;
    const DASH_MAX     = 350;
    const RANGED_MIN   = 60;
    const RANGED_MAX   = 220;
    const SURGE_R      = 130;    // Rune Surge AOE radius
    const SURGE_DMG    = 25;
    const SURGE_COLOR  = 0x88ccff;

    return new BtSelector([

      // ── 1. Rune Surge (AOE ground slam) ────────────────────────────────────
      //
      // Stops the hero and deals heavy damage to every opponent within SURGE_R.
      // Visual: an expanding blue ring tween. Accessed via this.opponents and
      // this.scene directly because the BT action closure captures `this`.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx =>
            ctx.opponent !== null &&
            Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
              <= SURGE_R,
          ),
          new BtAction(ctx => {
            ctx.stop();

            // Damage all living opponents within radius — not just the nearest.
            for (const opp of this.opponents) {
              if (!opp.isAlive) continue;
              if (Phaser.Math.Distance.Between(ctx.x, ctx.y, opp.x, opp.y) <= SURGE_R) {
                opp.takeDamage(SURGE_DMG);
              }
            }

            // Expanding ring visual.
            // Draw at local (0,0), position at world coords, then scale-tween.
            // Tweening scaleX/Y pivots around the Graphics object's origin —
            // so the circle must be drawn at (0,0) local, not at world coords.
            const gfx = this.scene.add.graphics();
            gfx.lineStyle(3, SURGE_COLOR, 1.0);
            gfx.strokeCircle(0, 0, 1);    // radius=1 local; scale expands it
            gfx.setPosition(ctx.x, ctx.y);
            gfx.setDepth(3);
            this.scene.tweens.add({
              targets:  gfx,
              scaleX:   SURGE_R,
              scaleY:   SURGE_R,
              alpha:    { from: 1, to: 0 },
              duration: 420,
              ease:     'Cubic.easeOut',
              onComplete: () => gfx.destroy(),
            });

            return 'success';
          }),
        ]),
        7000,   // 7s cooldown between surges
      ),

      // ── 2. Melee ────────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
            < MELEE_R,
        ),
        new BtAction(ctx => {
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // ── 3. Dash (gap-closer) ─────────────────────────────────────────────────
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
        4000,   // 4s cooldown between dashes
      ),

      // ── 4. Ranged (rune bolt) ───────────────────────────────────────────────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= RANGED_MIN && d <= RANGED_MAX;
          }),
          new BtAction(ctx => {
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            ctx.stop();   // plant feet briefly while shooting
            return 'success';
          }),
        ]),
        950,    // 950ms cooldown between shots
      ),

      // ── 5. Chase ────────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 6. Wander (fallback) ────────────────────────────────────────────────
      new BtAction((ctx, d) => {
        ctx.wander(d);
        return 'running';
      }),
    ]);
  }
}

/**
 * Draugr — undead Earth enemy, slower but hits harder.
 *
 * Behavior tree (priority order):
 *   1. Melee      — attack + stop when within 34px
 *   2. Bone Shard — fire projectile (1.8s cooldown) when at 80–280px
 *   3. Chase      — move toward hero
 *   4. Wander     — random drift (fallback)
 */
export class Draugr extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            80,
      speed:            60,
      aggroRadius:      350,
      attackDamage:     18,
      color:            0xaa3311,   // dark red
      meleeRange:       34,
      attackCooldownMs: 1200,
      // Ranged
      projectileDamage: 10,
      projectileSpeed:  220,
      projectileColor:  0xccbb88,   // bone-white shard
    });
  }

  protected buildTree(): BtNode {
    const MELEE_R    = this.meleeRange;   // 34px
    const BONE_MIN   = 80;
    const BONE_MAX   = 280;

    return new BtSelector([

      // ── 1. Melee ──────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
            < MELEE_R,
        ),
        new BtAction(ctx => {
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // ── 2. Bone Shard (ranged) ────────────────────────────────────────────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= BONE_MIN && d <= BONE_MAX;
          }),
          new BtAction(ctx => {
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        1800,   // 1.8s cooldown between bone shards
      ),

      // ── 3. Chase ──────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 4. Wander (fallback) ──────────────────────────────────────────────
      new BtAction((ctx, d) => {
        ctx.wander(d);
        return 'running';
      }),
    ]);
  }
}
