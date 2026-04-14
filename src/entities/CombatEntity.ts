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
import { SwarmBrain, SwarmWeights, BASE_WEIGHTS, PANIC_WEIGHTS } from './SwarmBrain';

// ── Visual constants ──────────────────────────────────────────────────────────

/** Size of the entity rectangle in pixels (centered in the Container). */
const ENTITY_SIZE = 20;

/** HP bar dimensions and vertical offset above the entity center. */
const BAR_W  = 36;
const BAR_H  = 5;
const BAR_Y  = -20; // px above Container center

// ── Detection FSM timing ───────────────────────────────────────────────────────

/**
 * Grace period (ms) before an engaging enemy transitions to searching when
 * it loses sight of the target. Prevents instant give-up on brief occlusions.
 */
const LOS_GRACE_MS = 1500;

/**
 * How long (ms) a searching enemy investigates the last-known position before
 * giving up and returning to idle.
 */
const SEARCH_DURATION_MS = 5000;

// ── Detection FSM ─────────────────────────────────────────────────────────────

/**
 * Four-state detection model gating enemy awareness:
 *
 *   idle      → alerted   (target enters alertRadius AND has LOS, or alertTo() called)
 *   alerted   → engaging  (target stays within alertRadius for 1 frame — immediate)
 *   engaging  → searching (target leaves loseSightRadius OR LOS lost for > 1.5 s)
 *   searching → idle      (searchTimer expires after 5 s with no re-acquire)
 *   searching → alerted   (target re-enters alertRadius with LOS)
 *   (any)     → alerted   (alertTo() called — sound event forces awareness)
 */
export type DetectionState = 'idle' | 'alerted' | 'engaging' | 'searching';

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

  // ── Swarm (boids) state ───────────────────────────────────────────────────
  /**
   * Current boids weights — mutated when panic is triggered, then lerped
   * back toward BASE_WEIGHTS as the panicTimer expires.
   * Each entity gets its own copy so weights don't bleed between entities.
   */
  swarmWeights: SwarmWeights = { ...BASE_WEIGHTS };

  /** Remaining panic duration in ms (0 = calm; 3000 = freshly panicked). */
  panicTimer = 0;

  /**
   * Last computed boids steering vector — cached between frame-skip ticks.
   * tickSwarm() recalculates every 3 frames and applies the cache in between;
   * boids precision at 20 fps is imperceptible vs. 60 fps.
   */
  private cachedSteer = { vx: 0, vy: 0 };

  // ── Detection FSM state ───────────────────────────────────────────────────────
  /**
   * Current awareness state. Guards BT execution: enemies only chase/attack
   * while engaging; otherwise they wander or steer toward a last-known position.
   */
  detectionState: DetectionState = 'idle';

  /**
   * World position of the last confirmed target sighting.
   * Set when engaging; retained as an investigation point when searching.
   */
  lastKnownTargetPos: { x: number; y: number } | null = null;

  /**
   * Accumulated time (ms) since LOS was lost while engaging.
   * If this exceeds LOS_GRACE_MS the enemy transitions to searching.
   */
  private losTimer = 0;

  /**
   * Remaining search duration (ms).
   * Counts down from SEARCH_DURATION_MS; idle transition fires when it hits 0.
   */
  private searchTimer = 0;

  // ── Sprite animation state ────────────────────────────────────────────────────
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

    // Per-entity speed variance — ±15 px/s randomised at spawn time.
    // This creates uneven swarm texture: some insects rush, some lag behind.
    // Enemy.speed is no longer readonly specifically to allow this mutation.
    this.speed += Phaser.Math.FloatBetween(-15, 15);

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

    // ── Detection FSM ─────────────────────────────────────────────────────────
    //
    // Always find the raw nearest living opponent (pure distance lookup),
    // then let the FSM decide whether we're aware of them. The BT only
    // receives a non-null opponent when the state is 'engaging'.
    const rawTarget = this.findNearestLivingOpponent();
    this.updateDetectionFSM(delta, rawTarget);

    // Gate target visibility: idle/searching enemies don't know where to attack.
    const target = this.detectionState === 'engaging' ? rawTarget : null;

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

    // ── Searching override ─────────────────────────────────────────────────────
    //
    // When searching, the BT sees no opponent and wanders randomly.
    // Override that with purposeful movement toward the last confirmed sighting
    // so the enemy investigates the area rather than wandering aimlessly.
    if (this.detectionState === 'searching' && this.lastKnownTargetPos && physBody && !this.isDashing) {
      const { x: tx, y: ty } = this.lastKnownTargetPos;
      const dx  = tx - this.x;
      const dy  = ty - this.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      if (len > 8) {
        physBody.setVelocity((dx / len) * this.speed * 0.7, (dy / len) * this.speed * 0.7);
      } else {
        // Arrived at investigation point — stop moving and wait for searchTimer.
        physBody.setVelocity(0, 0);
      }
    }

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

  // ── Detection FSM API ─────────────────────────────────────────────────────

  /**
   * Force this enemy into the alerted state from any current state.
   *
   * Called by SoundEventSystem when a loud event (gunshot, death, explosion)
   * occurs within hearing range. Sound bypasses LOS requirements — an enemy
   * hears a noise even around corners or behind walls.
   *
   * @param originX  World X of the sound — used as the initial investigation point.
   * @param originY  World Y of the sound.
   */
  alertTo(originX: number, originY: number): void {
    if (!this.isAlive) return;
    this.detectionState = 'alerted';
    this.lastKnownTargetPos = { x: originX, y: originY };
  }

  /**
   * Returns true if this enemy has an unobstructed line of sight to the
   * given world position.
   *
   * Currently always returns true — the combat arena has no solid obstacles,
   * so LOS is never blocked. When walls are introduced, replace this with a
   * ray-cast against the tilemap or physics world (FIL-190 future work).
   */
  hasLOS(_targetX: number, _targetY: number): boolean {
    return true;
  }

  /**
   * Advance the detection FSM by one frame.
   *
   * State transitions:
   *   idle      → alerted   target enters alertRadius AND hasLOS
   *   alerted   → engaging  immediate (one-frame gate for alertTo() distinction)
   *   engaging  → searching target leaves loseSightRadius OR LOS lost > LOS_GRACE_MS
   *   searching → idle      searchTimer expires (SEARCH_DURATION_MS)
   *   searching → alerted   target re-enters alertRadius with LOS (re-acquire)
   *
   * alertTo() short-circuits all of the above by directly setting 'alerted'.
   */
  private updateDetectionFSM(delta: number, rawTarget: CombatEntity | null): void {
    switch (this.detectionState) {

      case 'idle': {
        if (!rawTarget) break;
        const d = Phaser.Math.Distance.Between(this.x, this.y, rawTarget.x, rawTarget.y);
        if (d <= this.alertRadius && this.hasLOS(rawTarget.x, rawTarget.y)) {
          this.detectionState = 'alerted';
          this.lastKnownTargetPos = { x: rawTarget.x, y: rawTarget.y };
        }
        break;
      }

      case 'alerted': {
        // One-frame pause between hearing/seeing and fully engaging — gives
        // alertTo() a distinct state from normal sight so it can be extended
        // in future (e.g. play an alert bark animation or emit a sound).
        this.detectionState = 'engaging';
        this.losTimer = 0;
        break;
      }

      case 'engaging': {
        if (!rawTarget) {
          // Target died or was removed — start searching the last known spot.
          this.detectionState = 'searching';
          this.searchTimer = SEARCH_DURATION_MS;
          break;
        }
        const d = Phaser.Math.Distance.Between(this.x, this.y, rawTarget.x, rawTarget.y);
        const visible = d <= this.loseSightRadius && this.hasLOS(rawTarget.x, rawTarget.y);
        if (visible) {
          // Still has sight — refresh last-known position and reset grace period.
          this.lastKnownTargetPos = { x: rawTarget.x, y: rawTarget.y };
          this.losTimer = 0;
        } else {
          // Target out of range or obscured — accumulate grace time.
          this.losTimer += delta;
          if (this.losTimer >= LOS_GRACE_MS) {
            this.detectionState = 'searching';
            this.searchTimer = SEARCH_DURATION_MS;
            this.losTimer = 0;
          }
        }
        break;
      }

      case 'searching': {
        this.searchTimer -= delta;
        if (this.searchTimer <= 0) {
          // Gave up — return to idle and forget the last known position.
          this.detectionState = 'idle';
          this.lastKnownTargetPos = null;
          break;
        }
        // Re-acquire if target wanders back into detection range with LOS.
        if (rawTarget) {
          const d = Phaser.Math.Distance.Between(this.x, this.y, rawTarget.x, rawTarget.y);
          if (d <= this.alertRadius && this.hasLOS(rawTarget.x, rawTarget.y)) {
            this.detectionState = 'alerted';
            this.lastKnownTargetPos = { x: rawTarget.x, y: rawTarget.y };
          }
        }
        break;
      }
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

  // ── LivingEntity hook — damage ────────────────────────────────────────────

  /**
   * Override: spawn a floating damage number at this entity's world position.
   *
   * The text is added directly to the SCENE (not this Container) so it stays
   * fixed in world space as the entity moves and is not destroyed with it.
   * It floats upward and fades out over 600 ms, then self-destructs.
   *
   * Also emits `combatant-damaged` on the scene event bus so the arena can
   * react (e.g. camera shake when the hero is hit).
   */
  protected override onDamaged(amount: number): void {
    const txt = this.scene.add
      .text(this.x, this.y - 10, String(Math.ceil(amount)), {
        fontSize: '12px',
        color:    '#ffffff',
        stroke:   '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(20);

    this.scene.tweens.add({
      targets:  txt,
      y:        txt.y - 30,
      alpha:    { from: 1, to: 0 },
      duration: 600,
      ease:     'Cubic.easeOut',
      onComplete: () => txt.destroy(),
    });

    this.scene.events.emit('combatant-damaged', this, amount);
  }

  // ── Swarm (boids) API ─────────────────────────────────────────────────────

  /**
   * Trigger a panic scatter burst on this entity.
   *
   * Spikes the swarm weights toward PANIC_WEIGHTS so the entity scatters
   * away from nearby threats; the weights then lerp back to BASE over 3 s.
   * An immediate velocity burst away from the event origin is also applied
   * so the visual scatter starts this frame rather than waiting for boids.
   *
   * Called by CombatArenaScene when a nearby combatant dies (FIL-190 will
   * centralise this into a full SoundEventSystem when merged).
   */
  enterPanic(originX: number, originY: number): void {
    this.panicTimer = 3000;
    // Burst velocity directly away from the panic source — the "fly darting" feel.
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (physBody) {
      const dx = this.x - originX;
      const dy = this.y - originY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      physBody.setVelocity(
        physBody.velocity.x + (dx / len) * 120,
        physBody.velocity.y + (dy / len) * 120,
      );
    }
  }

  /**
   * Apply one boids tick for this entity.
   *
   * Called by CombatArenaScene.update() AFTER the BT tick so boids forces
   * layer on top of the behaviour-tree velocity — the BT steers, boids perturbs.
   *
   * Recalculates the steering vector every 3 frames (cached in between) for
   * performance. The full calculation at 20 fps is imperceptible vs. 60 fps.
   *
   * @param neighbours Alive entities from the spatial cell grid query (≤7).
   * @param delta      Frame delta in ms.
   */
  tickSwarm(neighbours: ReadonlyArray<CombatEntity>, delta: number): void {
    if (!this.isAlive) return;

    // ── Panic weight recovery ──────────────────────────────────────────────
    // t runs from 1 (full panic) to 0 (recovered); weights lerp accordingly.
    if (this.panicTimer > 0) {
      this.panicTimer = Math.max(0, this.panicTimer - delta);
      const t = this.panicTimer / 3000;
      this.swarmWeights.separation =
        BASE_WEIGHTS.separation + (PANIC_WEIGHTS.separation - BASE_WEIGHTS.separation) * t;
      this.swarmWeights.alignment =
        BASE_WEIGHTS.alignment + (PANIC_WEIGHTS.alignment - BASE_WEIGHTS.alignment) * t;
      this.swarmWeights.cohesion =
        BASE_WEIGHTS.cohesion + (PANIC_WEIGHTS.cohesion - BASE_WEIGHTS.cohesion) * t;
    }

    // ── Frame-skipped recalculation ────────────────────────────────────────
    // Boids don't need per-frame precision; recomputing every 3 frames halves
    // CPU cost at 60 fps with zero visible difference.
    if (this.scene.game.getFrame() % 3 === 0) {
      const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
      if (!physBody) return;

      const nData = neighbours.map(n => {
        const nb = n.body as Phaser.Physics.Arcade.Body | undefined;
        return { x: n.x, y: n.y, vx: nb?.velocity.x ?? 0, vy: nb?.velocity.y ?? 0 };
      });

      this.cachedSteer = SwarmBrain.steer(
        this.x, this.y,
        physBody.velocity.x, physBody.velocity.y,
        nData,
        this.swarmWeights,
      );

      // Per-frame jitter — small random velocity noise for insect-like twitching.
      // Applied once at recalc time so the jitter doesn't fire every frame.
      // TODO FIL-179: modulate cohesion weight by manaField.sample(this.x, this.y)
      this.cachedSteer.vx += (Math.random() - 0.5) * 12;
      this.cachedSteer.vy += (Math.random() - 0.5) * 12;
    }

    // ── Apply cached steer ─────────────────────────────────────────────────
    // Applied every frame (not just recalc frames) so movement is smooth.
    // Skipped during dash — boids shouldn't cancel the burst velocity.
    if (!this.isDashing) {
      const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
      if (physBody) {
        physBody.setVelocity(
          physBody.velocity.x + this.cachedSteer.vx,
          physBody.velocity.y + this.cachedSteer.vy,
        );
      }
    }
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
        // Play directional death animation; dissolve once it completes.
        this.spriteObj.play(deathKey, true);
        this.spriteObj.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (this.active) {
            this.scene.tweens.add({ targets: this, alpha: 0, duration: 180 });
          }
        });
      } else {
        // No death animation for this sprite — dissolve immediately.
        this.scene.tweens.add({ targets: this, alpha: { from: 1, to: 0 }, duration: 180 });
      }
    } else {
      // Rectangle entity — dissolve immediately.
      this.scene.tweens.add({ targets: this, alpha: { from: 1, to: 0 }, duration: 180 });
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
