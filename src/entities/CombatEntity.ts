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
import { ArenaBlackboard } from '../ai/ArenaBlackboard';

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
  spriteTint?: number;
  spriteScale?: number;
}

// ── Animation direction map ───────────────────────────────────────────────────
// Module-level constant so it isn't recreated on every updateSpriteAnimation()
// call (which runs every frame per entity).
type CanonDir = 'south' | 'south-east' | 'east' | 'north-east' | 'north';
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
  /** When true the BT is bypassed — the scene drives velocity and attacks directly. */
  protected playerControlled = false;

  private attackTimer = 0;
  private wanderAngle = Math.random() * Math.PI * 2;
  private wanderTimer = 0;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  /** Coloured rectangle at Container origin — used for hit-flash. */
  private readonly bodyRect:  Phaser.GameObjects.Rectangle;
  /** Original fill colour — restored after a white-flash on hit. */
  private readonly bodyColor: number;

  /** Subclasses set this true to skip applySeparationForce (e.g. while burrowing). */
  protected suppressSeparation = false;

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
  /**
   * The animation state name to use while attackAnimTimer > 0.
   * Defaults to 'attack' (single-attack entities: Skald, Spider, Crow, Skag).
   * Override in buildTree() actions to use different states per attack type
   * (e.g. Tinkerer sets 'attack_melee' or 'attack_ranged' before calling ctx.attack/shootAt).
   */
  protected attackAnimId = 'attack';

  // ── Ally coordination (separation steering + blackboard) ──────────────────
  /**
   * Other combatants on the same team — set by the arena scene each frame.
   * Used only for separation steering: each entity pushes away from nearby
   * allies so groups spread naturally instead of piling up on one point.
   */
  private allyEntities: CombatEntity[] = [];
  /** Shared arena state — set by the scene, read by individual enemy BTs. */
  protected blackboard: ArenaBlackboard | null = null;

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
      if (config.spriteTint  !== undefined) spr.setTint(config.spriteTint);
      if (config.spriteScale !== undefined) spr.setScale(config.spriteScale);
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

  /** Register allies for separation steering. Called by the arena on each spawn/death. */
  setAllies(allies: CombatEntity[]): void {
    this.allyEntities = allies;
  }

  /** Wire up the shared arena blackboard so BT nodes can coordinate. */
  setBlackboard(bb: ArenaBlackboard): void {
    this.blackboard = bb;
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

    // When player-controlled, skip the behavior tree — the arena scene drives
    // movement and attacks directly via setMoveVelocity / tryMelee / tryDash.
    if (!this.playerControlled) {
    // Pick the target opponent for this frame's BT tick.
    const target = this.findTargetOpponent();

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
        // Hold the ranged-attack animation for the same duration as a melee hit.
        this.attackAnimTimer = this.attackAnimDuration;
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

      steerAway: (fromX, fromY) => {
        if (!physBody || this.isDashing) return;
        const dx = this.x - fromX;
        const dy = this.y - fromY;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        physBody.setVelocity((dx / len) * this.speed, (dy / len) * this.speed);
      },

      orbitAround: (cx, cy, radius, cw) => {
        if (!physBody || this.isDashing) return;
        // Advance the orbit angle so the entity moves along the arc at this.speed.
        // arc speed = radius × angular_speed  →  angular_speed = speed / radius
        const curAngle  = Math.atan2(this.y - cy, this.x - cx);
        const angSpeed  = this.speed / Math.max(radius, 1);
        const nextAngle = curAngle + (cw ? 1 : -1) * angSpeed * (delta / 1000);
        const tx = cx + Math.cos(nextAngle) * radius;
        const ty = cy + Math.sin(nextAngle) * radius;
        const dx = tx - this.x;
        const dy = ty - this.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        physBody.setVelocity((dx / len) * this.speed, (dy / len) * this.speed);
      },
    };

    this.behaviorTree.tick(ctx, delta);
    this.applySeparationForce();
    } // end !playerControlled

    this.refreshHpBar();
    this.updateSpriteAnimation(delta);
  }

  // ── Player-control API ────────────────────────────────────────────────────

  /** Switch between AI control (false) and direct player control (true). */
  setPlayerControlled(v: boolean): void { this.playerControlled = v; }

  /**
   * Set velocity directly for player-driven movement.
   * No-op while a dash is in progress so the burst isn't cancelled.
   */
  setMoveVelocity(vx: number, vy: number): void {
    if (this.isDashing) return;
    (this.body as Phaser.Physics.Arcade.Body | undefined)?.setVelocity(vx, vy);
  }

  /**
   * Attempt a melee attack on the nearest living opponent.
   * Uses the same cooldown and damage as the AI behavior tree.
   */
  tryMelee(): void {
    if (this.attackTimer > 0) return;
    const target = this.findNearestLivingOpponent();
    if (!target) return;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y);
    // 2.5× meleeRange gives a generous but fair player reach.
    if (dist > this.meleeRange * 2.5) return;
    target.takeDamage(this.attackDamage);
    target.onHitBy(this.x, this.y);
    this.attackTimer    = this.attackCooldownMs;
    this.attackAnimTimer = this.attackAnimDuration;
  }

  /**
   * Fire a ranged shot at the nearest living opponent.
   * No-op if projectile damage isn't configured or the attack is on cooldown.
   * Sets attack_ranged animation and emits 'hero-shot' so the scene can play
   * sound + muzzle flash — same effect as the AI behavior tree path.
   */
  tryRanged(): void {
    if (this.attackTimer > 0 || !this.projectileDamage) return;
    const target = this.findNearestLivingOpponent();
    if (!target) return;
    const angle = Math.atan2(target.y - this.y, target.x - this.x);
    const p = new Projectile(
      this.scene, this.x, this.y, angle,
      this.projectileSpeed, this.projectileDamage,
      this.projectileColor,
      this.opponents as unknown as Damageable[],
    );
    this.scene.events.emit('projectile-spawned', p);
    this.attackAnimId    = 'attack_ranged';
    this.attackAnimTimer = this.attackAnimDuration;
    this.attackTimer     = this.attackCooldownMs;
    this.scene.events.emit('hero-shot', this.x, this.y, angle);
  }

  /**
   * Start a dash in the direction (dx, dy). No-op if already dashing.
   * Uses the same speed multiplier and duration as the AI behavior tree.
   */
  tryDash(dx: number, dy: number): void {
    if (this.isDashing) return;
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!physBody) return;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const spd = this.speed * this.dashSpeedMultiplier;
    this.dashVx    = (dx / len) * spd;
    this.dashVy    = (dy / len) * spd;
    this.dashTimer = this.dashDurationMs;
    this.isDashing = true;
    physBody.setVelocity(this.dashVx, this.dashVy);
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
      // Sector:  0=E  1=SE  2=S  3=SW  4/-4=W  -3=NW  -2=N  -1=NE
      const sector = Math.round(angle / (Math.PI / 4)); // −4 to 4
      // DIR_MAP is a module-level const — not recreated every frame.
      const [dir, flip] = DIR_MAP[sector] ?? ['south', false];
      this.lastDir   = dir;
      this.lastFlipX = flip;
    }

    // Apply flip — must be set every frame, not just on direction change.
    this.spriteObj.setFlipX(this.lastFlipX);

    const state  = this.attackAnimTimer > 0 ? this.attackAnimId
                 : this.isDashing           ? 'dash'
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
  protected findNearestLivingOpponent(): CombatEntity | null {
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

  /**
   * Which opponent to target this frame. Defaults to the nearest living one.
   * Override in subclasses to apply threat-priority logic (e.g. Tinkerer prefers
   * ranged enemies over melee ones at the same distance).
   */
  protected findTargetOpponent(): CombatEntity | null {
    return this.findNearestLivingOpponent();
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

  /**
   * Steering separation — pushes this entity away from nearby allies.
   *
   * Applied as a velocity addend after the behavior tree runs, so the BT's
   * intended movement direction is preserved while piling/stacking is prevented.
   *
   * Works like Reynolds' separation rule: sum unit vectors pointing away from
   * each nearby ally, weighted linearly by how much the separation radius is
   * violated. Closer = stronger push.
   */
  private applySeparationForce(): void {
    if (this.allyEntities.length === 0 || this.isDashing || this.suppressSeparation) return;
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!physBody) return;

    const SEP_RADIUS   = 52;             // px — personal space bubble
    const SEP_STRENGTH = this.speed * 0.8; // max separation impulse (px/s)

    let fx = 0, fy = 0, count = 0;
    for (const ally of this.allyEntities) {
      // Skip self-reference and dead allies.
      if ((ally as unknown) === (this as unknown) || !ally.isAlive) continue;
      const dx   = this.x - ally.x;
      const dy   = this.y - ally.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < SEP_RADIUS && dist > 0) {
        // Linear falloff: 1.0 at overlap, 0.0 at SEP_RADIUS edge.
        const t = 1 - dist / SEP_RADIUS;
        fx += (dx / dist) * t;
        fy += (dy / dist) * t;
        count++;
      }
    }

    if (count === 0) return;

    const len    = Math.sqrt(fx * fx + fy * fy) || 1;
    const cv     = physBody.velocity;
    const newVx  = cv.x + (fx / len) * SEP_STRENGTH;
    const newVy  = cv.y + (fy / len) * SEP_STRENGTH;

    // Clamp so separation never accelerates beyond 1.5× normal speed.
    const finalSpd = Math.sqrt(newVx * newVx + newVy * newVy);
    const maxSpd   = this.speed * 1.5;
    if (finalSpd > maxSpd) {
      const s = maxSpd / finalSpd;
      physBody.setVelocity(newVx * s, newVy * s);
    } else {
      physBody.setVelocity(newVx, newVy);
    }
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

/**
 * Tinkerer — post-apocalyptic mechanic hero. Melee bash + pistol shot + dash.
 *
 * Upgraded from a priority waterfall to utility-weighted decision making:
 *   - Counts nearby enemies (swarm pressure) to gate and score each action.
 *   - Escape dash fires toward arena center when overwhelmed AND low HP.
 *   - Ranged attack targets the highest-threat enemy (AcidLancer > others),
 *     not just the nearest one.
 *   - Melee is suppressed when surrounded to avoid diving into a cluster.
 */
export class Tinkerer extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:              100,
      speed:              80,
      aggroRadius:        400,
      attackDamage:       15,
      color:              0x996633,
      meleeRange:         36,
      attackCooldownMs:   700,
      projectileDamage:   18,
      projectileSpeed:    420,   // faster than other projectiles — feels like a bullet
      projectileColor:    0xfff8b0, // bright yellow-white muzzle colour
      dashSpeedMultiplier: 4.5,
      dashDurationMs:     180,
      spriteKey:          'tinkerer',
    });
  }

  /**
   * Target selection: prefer ranged threats (AcidLancer, ParasiteFlyer) over
   * melee rushers at the same distance. Suppressing their projectile spam is
   * more valuable than hitting the nearest enemy.
   */
  protected override findTargetOpponent(): CombatEntity | null {
    const rangedThreats = this.opponents.filter(
      o => o.isAlive && (o instanceof AcidLancer || o instanceof ParasiteFlyer),
    );
    if (rangedThreats.length > 0) {
      return rangedThreats.reduce((best, o) =>
        Phaser.Math.Distance.Between(this.x, this.y, o.x, o.y) <
        Phaser.Math.Distance.Between(this.x, this.y, best.x, best.y) ? o : best,
      );
    }
    return this.findNearestLivingOpponent();
  }

  protected buildTree(): BtNode {
    const MELEE_R    = this.meleeRange;   // 36px
    const DASH_MIN   = MELEE_R;
    const DASH_MAX   = 300;
    const RANGED_MIN = 60;
    const RANGED_MAX = 230;
    const SWARM_R    = 130;   // radius for swarm pressure check
    const SWARM_CAP  = 4;     // enemies within SWARM_R that triggers escape mode

    /** Count living enemies within SWARM_R of the Tinkerer's current position. */
    const swarmPressure = (cx: number, cy: number): number =>
      this.opponents.filter(
        o => o.isAlive && Phaser.Math.Distance.Between(cx, cy, o.x, o.y) < SWARM_R,
      ).length;

    return new BtSelector([

      // ── 1. Escape dash — fires when overwhelmed AND low HP ────────────────────
      // Dashes away from the enemy swarm centroid, not toward a target.
      // A last-resort survival move before the hero goes down.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            const near = swarmPressure(ctx.x, ctx.y);
            return near >= SWARM_CAP && ctx.hp < ctx.maxHp * 0.40;
          }),
          new BtAction(ctx => {
            // Compute the average position of nearby enemies and dash opposite.
            const near = this.opponents.filter(
              o => o.isAlive && Phaser.Math.Distance.Between(ctx.x, ctx.y, o.x, o.y) < SWARM_R,
            );
            const avgX = near.reduce((s, o) => s + o.x, 0) / near.length;
            const avgY = near.reduce((s, o) => s + o.y, 0) / near.length;
            const escX = ctx.x + (ctx.x - avgX) * 3;
            const escY = ctx.y + (ctx.y - avgY) * 3;
            ctx.dash(escX, escY);
            return 'success';
          }),
        ]),
        4000,
      ),

      // ── 2. Melee bash — suppressed when 3+ enemies are nearby ────────────────
      // Melee into a swarm is suicidal; prefer ranged or dash instead.
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          const d    = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
          const near = swarmPressure(ctx.x, ctx.y);
          return d < MELEE_R && near < 3;
        }),
        new BtAction(ctx => {
          this.attackAnimId = 'attack_melee';
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // ── 3. Pistol — prioritises ranged threats (via findTargetOpponent) ──────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= RANGED_MIN && d <= RANGED_MAX;
          }),
          new BtAction(ctx => {
            this.attackAnimId = 'attack_ranged';
            const shotAngle = Math.atan2(ctx.opponent!.y - ctx.y, ctx.opponent!.x - ctx.x);
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            // No stop() — shoot while walking so the walk animation stays visible
            // between bursts and the Tinkerer feels dynamic rather than static.
            this.scene.events.emit('hero-shot', ctx.x, ctx.y, shotAngle);
            return 'success';
          }),
        ]),
        750,
      ),

      // ── 4. Gap-close dash ─────────────────────────────────────────────────────
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
        3000,
      ),

      // ── 5. Chase priority target ──────────────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 6. Wander (fallback) ──────────────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}

// ── Spinolandet (bio / evolution) enemies ─────────────────────────────────────

/**
 * SporeHusk — bloated fungal rusher. Slow but hits hard on contact.
 * Approaches from a slightly offset angle (jitter) so multiple husks
 * don't file in single-column. Separation steering (base class) handles
 * the piling. Death triggers a spore-burst ring.
 */
export class SporeHusk extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 45, speed: 62, aggroRadius: 400, attackDamage: 10,
      color: 0x664466, meleeRange: 30, attackCooldownMs: 950,
      spriteKey: 'spider', spriteTint: 0xaa66dd,
    });
  }

  protected override onDeath(): void {
    super.onDeath();
    // Spore burst: expanding teal ring on death
    const gfx = this.scene.add.graphics();
    gfx.lineStyle(2, 0x44ddaa, 0.9);
    gfx.strokeCircle(0, 0, 1);
    gfx.setPosition(this.x, this.y).setDepth(this.depth + 2);
    this.scene.tweens.add({
      targets: gfx, scaleX: 40, scaleY: 40,
      alpha: { from: 0.8, to: 0 }, duration: 350, ease: 'Cubic.easeOut',
      onComplete: () => gfx.destroy(),
    });
  }

  protected buildTree(): BtNode {
    const R = this.meleeRange;
    // Bake a per-instance lateral offset so groups approach from slightly
    // different angles — looks more organic than a perfect beeline.
    const lateralOffset = (Math.random() - 0.5) * 44;

    return new BtSelector([
      // Melee when adjacent
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),
      // Chase with a lateral jitter so swarms fan out naturally
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          // Offset the target point perpendicularly to the approach vector.
          const ox = ctx.opponent!.x, oy = ctx.opponent!.y;
          const dx = ox - ctx.x, dy = oy - ctx.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          // Perpendicular unit vector (rotated 90°)
          const px = -dy / len, py = dx / len;
          ctx.moveToward(ox + px * lateralOffset, oy + py * lateralOffset);
          return 'running';
        }),
      ]),
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}

/**
 * AcidLancer — insectoid kiter. Circle-strafes at medium range and fires
 * acid globs. Retreats if the hero closes in. Reverses orbit direction
 * after each shot to stay unpredictable.
 */
export class AcidLancer extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 35, speed: 72, aggroRadius: 420, attackDamage: 6,
      color: 0x88aa22, meleeRange: 28, attackCooldownMs: 900,
      projectileDamage: 10, projectileSpeed: 190, projectileColor: 0x99dd00,
      spriteKey: 'skag', spriteTint: 0x88ee22,
    });
  }

  protected buildTree(): BtNode {
    const TOO_CLOSE  = 70;    // flee threshold
    const ORBIT_R    = 160;   // preferred orbit radius
    const SHOOT_MIN  = 80;
    const SHOOT_MAX  = 250;

    // Randomly assigned orbit direction — reversed after each shot.
    let orbitCw = Math.random() < 0.5;

    return new BtSelector([

      // 1. Flee if the hero is inside the danger radius
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < TOO_CLOSE,
        ),
        new BtAction(ctx => {
          ctx.steerAway(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 2. Shoot while orbiting at preferred range
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= SHOOT_MIN && d <= SHOOT_MAX;
          }),
          new BtAction(ctx => {
            // Keep strafing while firing — don't plant feet
            ctx.orbitAround(ctx.opponent!.x, ctx.opponent!.y, ORBIT_R, orbitCw);
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            // Reverse orbit so each burst comes from a different angle
            orbitCw = !orbitCw;
            return 'success';
          }),
        ]),
        900,
      ),

      // 3. Orbit without shooting when in range but cooldown not ready
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
          return d >= TOO_CLOSE && d <= SHOOT_MAX;
        }),
        new BtAction(ctx => {
          ctx.orbitAround(ctx.opponent!.x, ctx.opponent!.y, ORBIT_R, orbitCw);
          return 'running';
        }),
      ]),

      // 4. Close in when too far away
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}

/**
 * BruteCarapace — massive beetle tank. Instead of dashing instantly, the
 * Brute telegraphs its charge with a 0.8s windup (slow lurch + alpha pulse)
 * so a skilled player can dodge. After the charge it's briefly stunned.
 *
 * State machine (managed via closure variables inside the BT action):
 *   idle    → wander/melee normally; enters windup when charge is ready
 *   windup  → slow shuffle toward target + visual pulse (0.8s)
 *   charge  → ctx.dash() fires; recovery timer starts
 *   recovery → stopped, stunned (0.5s)
 */
export class BruteCarapace extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 180, speed: 42, aggroRadius: 400, attackDamage: 25,
      color: 0x221133, meleeRange: 38, attackCooldownMs: 1200,
      dashSpeedMultiplier: 6.0, dashDurationMs: 240,
    });
  }

  protected buildTree(): BtNode {
    const R    = this.meleeRange;
    const CMAX = 380;

    type Phase = 'idle' | 'windup' | 'recovery';
    let phase: Phase = 'idle';
    let phaseTimer   = 0;
    let chargeCd     = 0;        // independent cooldown for the telegraph cycle
    const WINDUP_MS   = 800;
    const RECOVERY_MS = 500;
    const CHARGE_CD   = 5000;

    // Single BtAction owns the whole state machine — simpler than nesting
    // multiple BtSequences for a multi-phase behaviour with cross-phase state.
    return new BtAction((ctx, delta) => {
      phaseTimer = Math.max(0, phaseTimer - delta);
      chargeCd   = Math.max(0, chargeCd   - delta);

      const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;

      // ── Recovery: briefly stunned after the charge ────────────────────────
      if (phase === 'recovery') {
        ctx.stop();
        if (phaseTimer <= 0) phase = 'idle';
        return 'running';
      }

      // ── Windup: slow menacing lurch + visual pulse ────────────────────────
      if (phase === 'windup') {
        if (ctx.opponent && physBody) {
          const dx  = ctx.opponent.x - ctx.x;
          const dy  = ctx.opponent.y - ctx.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          // 30% speed during windup — slow lurch toward the target
          physBody.setVelocity((dx / len) * this.speed * 0.3, (dy / len) * this.speed * 0.3);
        }
        if (phaseTimer <= 0) {
          // Fire the charge
          if (ctx.opponent) ctx.dash(ctx.opponent.x, ctx.opponent.y);
          phase     = 'recovery';
          phaseTimer = RECOVERY_MS;
          chargeCd  = CHARGE_CD;
        }
        return 'running';
      }

      // ── Idle: normal behaviour ─────────────────────────────────────────────
      if (!ctx.opponent) { ctx.wander(delta); return 'running'; }

      const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);

      // Melee strike if adjacent
      if (d < R) { ctx.attack(); ctx.stop(); return 'success'; }

      // Start windup if charge is cooled down and target is in range
      if (d <= CMAX && chargeCd <= 0) {
        phase      = 'windup';
        phaseTimer = WINDUP_MS;
        // Visual tell: rapid alpha flicker so the player sees the telegraph
        this.scene.tweens.add({
          targets:  this,
          alpha:    { from: 1.0, to: 0.35 },
          duration: 160,
          yoyo:     true,
          repeat:   2,
        });
        return 'running';
      }

      ctx.moveToward(ctx.opponent.x, ctx.opponent.y);
      return 'running';
    });
  }
}

/**
 * ParasiteFlyer — winged dive-bomber. Uses a hawk attack pattern:
 *   orbit  → circle at 220px, waiting for a dive window
 *   dive   → dash at the hero (staggered via blackboard — no simultaneous swarms)
 *   retreat → flee to safe distance for 700ms before orbiting again
 *
 * Orbit direction reverses after each dive so approach angle varies.
 */
export class ParasiteFlyer extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 45, speed: 88, aggroRadius: 450, attackDamage: 16,
      color: 0x3399aa, meleeRange: 28, attackCooldownMs: 900,
      dashSpeedMultiplier: 5.5, dashDurationMs: 160,
      spriteKey: 'crow', spriteTint: 0x22ddcc,
    });
  }

  protected buildTree(): BtNode {
    const R          = this.meleeRange;
    const ORBIT_R    = 220;
    const RETREAT_MS = 700;
    const DIVE_STAGGER_MS = 1800; // written to blackboard after each dive

    type Phase = 'orbit' | 'retreating';
    let phase:       Phase  = 'orbit';
    let retreatTimer        = 0;
    let orbitCw             = Math.random() < 0.5;

    return new BtSelector([

      // Strike if the dive landed close enough
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),

      // Hawk state machine
      new BtAction((ctx, delta) => {
        if (!ctx.opponent) { ctx.wander(delta); return 'running'; }
        retreatTimer = Math.max(0, retreatTimer - delta);

        // ── Retreat after a dive ─────────────────────────────────────────────
        if (phase === 'retreating') {
          ctx.steerAway(ctx.opponent.x, ctx.opponent.y);
          if (retreatTimer <= 0) phase = 'orbit';
          return 'running';
        }

        // ── Orbit: circle while waiting for dive window ─────────────────────
        ctx.orbitAround(ctx.opponent.x, ctx.opponent.y, ORBIT_R, orbitCw);

        // Only dive when the global flyer cooldown allows it.
        // This prevents multiple flyers diving simultaneously (feels overwhelming
        // and unreadable). The blackboard serialises the dives.
        const bb = this.blackboard;
        if (bb && bb.flyerDiveCooldown <= 0) {
          bb.flyerDiveCooldown = DIVE_STAGGER_MS;
          ctx.dash(ctx.opponent.x, ctx.opponent.y);
          phase        = 'retreating';
          retreatTimer = RETREAT_MS;
          orbitCw      = !orbitCw;  // approach from opposite side next time
        }

        return 'running';
      }),
    ]);
  }
}

/**
 * WarriorBug — tiny arachnid swarmer. Individually trivial (8 HP), deadly
 * in numbers. Boids-style separation (base class) keeps them spread so they
 * look like a scuttling swarm rather than a blob. Fast direct rush.
 */
export class WarriorBug extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp: 8, speed: 132, aggroRadius: 500, attackDamage: 4,
      color: 0x1a2a0a, meleeRange: 22, attackCooldownMs: 600,
      spriteKey: 'spider', spriteTint: 0x44ee22, spriteScale: 0.55,
    });
  }

  protected buildTree(): BtNode {
    const R = this.meleeRange;
    return new BtSelector([
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => { ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y); return 'running'; }),
      ]),
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
