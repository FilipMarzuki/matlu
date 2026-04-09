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

  // ── Sprite (optional) ─────────────────────────────────────────────────────
  /**
   * Aseprite spritesheet key (must be preloaded and createFromAseprite'd by the scene).
   * Expected animation tags: idle_south, walk_south, attack_south, death_south … ×4 dirs.
   * When provided the placeholder rectangle is hidden and the sprite is shown instead.
   */
  spriteKey?: string;
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
  /** Coloured rectangle at Container origin — used for hit-flash. */
  private readonly bodyRect:  Phaser.GameObjects.Rectangle;
  /** Original fill colour — restored after a white-flash on hit. */
  private readonly bodyColor: number;

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

  // ── Sprite animation state ────────────────────────────────────────────────
  private spriteObj?: Phaser.GameObjects.Sprite;
  /**
   * Last resolved facing direction — persists when the entity stops moving.
   * Only right-side and cardinal directions are stored; the left-side directions
   * (south-west, west, north-west) are rendered by mirroring their right-side
   * counterparts via sprite.setFlipX(true).
   *
   * Stored value is always the ANIMATION key direction (never a mirrored one):
   *   south-west → 'south-east' + flipX
   *   west       → 'east'       + flipX
   *   north-west → 'north-east' + flipX
   */
  private lastDir: 'south'|'south-east'|'east'|'north-east'|'north' = 'south';
  /** Whether the current lastDir requires a horizontal flip. */
  private lastFlipX = false;
  /** Remaining ms to hold the attack animation before returning to idle/walk. */
  private attackAnimTimer = 0;
  /** How long to hold the attack animation = 40% of the attack cooldown. */
  private readonly attackAnimDuration: number;

  constructor(scene: Phaser.Scene, x: number, y: number, config: CombatEntityConfig) {
    super(scene, x, y, config);
    this.meleeRange       = config.meleeRange;
    this.attackCooldownMs = config.attackCooldownMs;

    this.dashSpeedMultiplier = config.dashSpeedMultiplier ?? 4.5;
    this.dashDurationMs      = config.dashDurationMs      ?? 180;

    this.projectileDamage = config.projectileDamage;
    this.projectileSpeed  = config.projectileSpeed  ?? 260;
    this.projectileColor  = config.projectileColor  ?? 0xffffff;

    this.attackAnimDuration = config.attackCooldownMs * 0.4;

    // ── Visuals (all children of this Container) ──────────────────────────
    //
    // scene.add.X() creates the object AND adds it to the scene display list.
    // this.add(obj) then moves it from the scene list into this Container —
    // Container children are rendered by the Container, not the scene directly.

    // Body rectangle — centered at Container origin (0, 0).
    // Stored as a field so onHitBy() can flash it white on hit, then restore.
    // Hidden when a spriteKey is provided (sprite is used instead).
    this.bodyColor = config.color;
    this.bodyRect  = scene.add.rectangle(0, 0, ENTITY_SIZE, ENTITY_SIZE, config.color);
    this.add(this.bodyRect);

    // HP bar sits above the entity. For sprites (canvas ~48px tall, origin at
    // center) the bar is pushed higher so it clears the top of the sprite.
    const barY = config.spriteKey ? -30 : BAR_Y;

    // HP bar background (dark red, full width).
    const hpBarBg = scene.add.rectangle(0, barY, BAR_W, BAR_H, 0x661111);
    this.add(hpBarBg);

    // HP bar fill (green, shrinks left-to-right as HP drops).
    // Origin at (0, 0.5) so it anchors at the left edge while scaleX shrinks it.
    this.hpBarFill = scene.add.rectangle(-BAR_W / 2, barY, BAR_W, BAR_H, 0x44cc44);
    this.hpBarFill.setOrigin(0, 0.5);
    this.add(this.hpBarFill);

    // ── Sprite (replaces placeholder rectangle when spriteKey provided) ────
    if (config.spriteKey) {
      this.bodyRect.setVisible(false);
      const spr = scene.add.sprite(0, 0, config.spriteKey);
      this.add(spr);
      this.spriteObj = spr;
      // HP bar renders on top of the sprite.
      this.bringToTop(hpBarBg);
      this.bringToTop(this.hpBarFill);
    }

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
        // Apply hit feedback (flash + knockback) from this entity's position.
        target.onHitBy(this.x, this.y);
        this.attackTimer = this.attackCooldownMs;
        // Hold the attack animation for 40% of the cooldown duration.
        this.attackAnimTimer = this.attackAnimDuration;
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
    this.updateSpriteAnimation(delta);
  }

  /**
   * Update the Aseprite sprite animation based on current velocity and state.
   * No-op when no spriteKey was provided (rectangle entity).
   *
   * Priority: attack > walk > idle.
   * Direction is derived from the dominant velocity axis and remembered when
   * the entity stops so the facing direction persists during idle.
   */
  private updateSpriteAnimation(delta: number): void {
    if (!this.spriteObj) return;

    this.attackAnimTimer = Math.max(0, this.attackAnimTimer - delta);

    const body = this.body as Phaser.Physics.Arcade.Body | undefined;
    const vx   = body?.velocity.x ?? 0;
    const vy   = body?.velocity.y ?? 0;
    const spd  = Math.sqrt(vx * vx + vy * vy);

    // Resolve the 8-direction facing from the velocity vector.
    // Left-side directions (SW, W, NW) are mirrored right-side directions — the
    // sprite is flipped horizontally and the right-side animation key is used.
    if (spd > 5) {
      const angle = Math.atan2(vy, vx); // −π to π, 0 = east
      // Divide the circle into 8 × 45° sectors, offset by 22.5°.
      const sector = Math.round(angle / (Math.PI / 4)); // −4 to 4
      // Map sector to a canonical right-side direction + flipX flag.
      // Sector:  0=E  1=SE  2=S  3=SW  4/-4=W  -3=NW  -2=N  -1=NE
      type CanonDir = 'south'|'south-east'|'east'|'north-east'|'north';
      const DIR_MAP: Record<number, [CanonDir, boolean]> = {
         0: ['east',       false],
         1: ['south-east', false],
         2: ['south',      false],
         3: ['south-east', true ],   // SW → mirror SE
         4: ['east',       true ],   // W  → mirror E
        '-4': ['east',       true ],
        '-3': ['north-east', true ],  // NW → mirror NE
        '-2': ['north',      false],
        '-1': ['north-east', false],
      };
      const [dir, flip] = DIR_MAP[sector] ?? ['south', false];
      this.lastDir   = dir;
      this.lastFlipX = flip;
    }

    // Apply flip — must be set every frame, not just on direction change.
    this.spriteObj.setFlipX(this.lastFlipX);

    const state  = this.attackAnimTimer > 0 ? 'attack'
                 : spd > 5                  ? 'walk'
                 :                            'idle';
    // Animation keys are namespaced as {textureKey}_{state}_{dir} to avoid
    // collisions between characters sharing the global AnimationManager.
    const tag = `${this.spriteObj.texture.key}_${state}_${this.lastDir}`;

    // Only call play() when the tag changes to avoid restarting mid-loop.
    if (this.spriteObj.anims.currentAnim?.key !== tag) {
      this.spriteObj.play(tag, true);
    }
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

  // ── Hit feedback API ──────────────────────────────────────────────────────

  /**
   * Called by the attacker immediately after dealing damage.
   *
   * Applies two feedback effects:
   *   - White-flash tint on the body rectangle for 80 ms
   *   - Knockback velocity impulse (~80 px) away from the attacker for 100 ms
   *
   * Both effects are skipped if the entity is already dead (e.g. killed by
   * the same hit that triggered this call).
   */
  onHitBy(fromX: number, fromY: number): void {
    if (!this.isAlive) return;

    // Flash the body rect white; restore original fill colour after 80 ms.
    // Rectangle uses setFillStyle, not setTint (which is for Image/Sprite).
    this.bodyRect.setFillStyle(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.bodyRect.setFillStyle(this.bodyColor);
    });

    // Knockback: brief velocity burst away from attacker.
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (physBody) {
      const angle = Math.atan2(this.y - fromY, this.x - fromX);
      physBody.setVelocity(Math.cos(angle) * 80, Math.sin(angle) * 80);
      this.scene.time.delayedCall(100, () => {
        // Guard: don't zero velocity if the entity has been destroyed by then.
        if (this.active && this.isAlive) physBody.setVelocity(0, 0);
      });
    }
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

    if (this.spriteObj) {
      this.spriteObj.setFlipX(this.lastFlipX);
      const deathKey = `${this.spriteObj.texture.key}_death_${this.lastDir}`;
      if (this.scene.anims.exists(deathKey)) {
        // Play directional death animation; fade out once it completes.
        this.spriteObj.play(deathKey, true);
        this.spriteObj.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (this.active) this.setAlpha(0.3);
        });
      } else {
        // No death animation for this sprite (e.g. quadruped) — fade immediately.
        this.setAlpha(0.3);
      }
    } else {
      this.setAlpha(0.3);
    }

    // Death burst: 6 small white arcs radiate outward and fade over 200 ms.
    // Using Arc objects + tweens avoids any dependency on a preloaded particle texture.
    const BURST_COUNT = 6;
    for (let i = 0; i < BURST_COUNT; i++) {
      const angle = (i / BURST_COUNT) * Math.PI * 2;
      const dot = this.scene.add.arc(this.x, this.y, 3, 0, 360, false, 0xffffff);
      dot.setDepth(this.depth + 1);
      this.scene.tweens.add({
        targets:  dot,
        x:        this.x + Math.cos(angle) * 30,
        y:        this.y + Math.sin(angle) * 30,
        alpha:    { from: 1, to: 0 },
        duration: 200,
        ease:     'Cubic.easeOut',
        onComplete: () => dot.destroy(),
      });
    }

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
      color:              0x3366ee,   // blue (fallback if sprite not loaded)
      meleeRange:         34,
      attackCooldownMs:   800,
      // Ranged
      projectileDamage:   14,
      projectileSpeed:    280,
      projectileColor:    0x44aaff,   // bright blue rune bolt
      // Dash
      dashSpeedMultiplier: 4.5,
      dashDurationMs:     180,
      // Sprite
      spriteKey:          'skald',
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
 * Spider — fast contaminated spider, swarms in groups.
 *
 * Behavior tree (priority order):
 *   1. Melee  — bite attack + stop when within 28px
 *   2. Chase  — rush toward nearest opponent
 *   3. Wander — random drift (fallback)
 *
 * Sprite: assembled from spider spritesheet once ready; currently a rectangle.
 */
export class Spider extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            30,
      speed:            110,    // fastest enemy — swarm rushers
      aggroRadius:      400,
      attackDamage:     8,
      color:            0x994422,   // rust-brown (fallback)
      meleeRange:       28,
      attackCooldownMs: 600,
      spriteKey:        'spider',
    });
  }

  protected buildTree(): BtNode {
    const MELEE_R = this.meleeRange;   // 28px

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

      // ── 2. Chase ──────────────────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 3. Wander (fallback) ──────────────────────────────────────────────
      new BtAction((ctx, d) => {
        ctx.wander(d);
        return 'running';
      }),
    ]);
  }
}

/**
 * Skag — feral ranged scavenger. Keeps distance and hurls debris.
 *
 * Behavior tree (priority order):
 *   1. Flee       — back away when opponent is too close (< 55px)
 *   2. Throw      — hurl debris (900ms cooldown) at 70–220px
 *   3. Move in    — close to preferred throwing range when too far
 *   4. Wander     — random drift (fallback)
 *
 * Sprite: assembled from skag spritesheet once ready; currently a rectangle.
 */
export class Skag extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            40,
      speed:            70,
      aggroRadius:      350,
      attackDamage:     5,      // low melee damage (discourages getting close)
      color:            0x776655,   // ragged grey-brown (fallback)
      meleeRange:       28,
      attackCooldownMs: 800,
      // Ranged — throws rust debris
      projectileDamage: 12,
      projectileSpeed:  200,
      projectileColor:  0xaa8866,   // rust-orange shard
      // Sprite
      spriteKey:        'skag',
    });
  }

  protected buildTree(): BtNode {
    const TOO_CLOSE   = 55;    // flee distance
    const THROW_MIN   = 70;
    const THROW_MAX   = 220;

    return new BtSelector([

      // ── 1. Flee when the opponent closes in ───────────────────────────────
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          return Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
            < TOO_CLOSE;
        }),
        new BtAction(ctx => {
          // Move directly away from the opponent.
          const fleeX = ctx.x + (ctx.x - ctx.opponent!.x);
          const fleeY = ctx.y + (ctx.y - ctx.opponent!.y);
          ctx.moveToward(fleeX, fleeY);
          return 'running';
        }),
      ]),

      // ── 2. Throw debris from preferred range ──────────────────────────────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= THROW_MIN && d <= THROW_MAX;
          }),
          new BtAction(ctx => {
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            ctx.stop();
            return 'success';
          }),
        ]),
        900,
      ),

      // ── 3. Reposition into throwing range ─────────────────────────────────
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

/**
 * Crow — large mutant crow, swoops in and dives to attack.
 *
 * Behavior tree (priority order):
 *   1. Melee       — talon strike + stop when within 30px
 *   2. Dive (dash) — burst toward target (2.5s cooldown) when at 40–300px
 *   3. Chase       — close to melee range
 *   4. Wander      — random drift (fallback)
 *
 * Sprite: assembled from crow spritesheet once ready; currently a rectangle.
 */
export class Crow extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:              50,
      speed:              95,
      aggroRadius:        400,
      attackDamage:       14,
      color:              0x222211,   // near-black (fallback)
      meleeRange:         30,
      attackCooldownMs:   1000,
      // Dive dash — fast, brief burst
      dashSpeedMultiplier: 5.5,
      dashDurationMs:      160,
      // Sprite
      spriteKey:          'crow',
    });
  }

  protected buildTree(): BtNode {
    const MELEE_R  = this.meleeRange;   // 30px
    const DIVE_MIN = 40;
    const DIVE_MAX = 300;

    return new BtSelector([

      // ── 1. Melee (talon strike) ───────────────────────────────────────────
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

      // ── 2. Dive (gap-closing dash) ─────────────────────────────────────────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= DIVE_MIN && d <= DIVE_MAX;
          }),
          new BtAction(ctx => {
            ctx.dash(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        2500,   // 2.5s between dives
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
