import * as Phaser from 'phaser';
import { Enemy, EnemyConfig } from './Enemy';
import { Projectile, Damageable } from './Projectile';
import { SwarmBrain, SwarmWeights, BASE_WEIGHTS, PANIC_WEIGHTS, BoidsNeighbour } from './SwarmBrain';
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
import { hasLineOfSight, sampleIllumination, SIGHT_CHECK_INTERVAL_MS } from '../combat/SightLineSystem';
import { calcSpread, applySpread, isPartialCover } from '../combat/Accuracy';
import { worldToArenaIso, arenaIsoDepth } from '../lib/IsoTransform';

export { SIGHT_CHECK_INTERVAL_MS };

// ── Visual constants ──────────────────────────────────────────────────────────

/** Size of the entity rectangle in pixels (centered in the Container). */
const ENTITY_SIZE = 20;

/** HP bar dimensions and vertical offset above the entity center.
 *  Kept narrow (16 px) and thin (2 px) so bars don't dominate the screen
 *  when many enemies are alive simultaneously. */
const BAR_W  = 16;
const BAR_H  = 2;
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

  // ── Sight line (optional) ─────────────────────────────────────────────────
  /**
   * How long (ms) the enemy remembers the player's last known position after
   * losing line of sight. During this window the enemy moves toward the cached
   * position instead of idling. Default: 2000 ms.
   * Tune per enemy type: short for dumb swarm creatures, long for smart elites.
   */
  sightMemoryMs?: number;

  /**
   * Maximum distance (px) at which this entity can hear blackboard sound events
   * (melee hits, deaths, loud abilities). When a sound event occurs within this
   * radius the entity enters the alerted-investigate state and moves to the origin.
   * Default 0 (deaf — no hearing). Set per-enemy in their constructor config.
   */
  hearingRadius?: number;

  /**
   * Distance (px) within which a target is always detected regardless of walls
   * or aggroRadius. Prevents the absurd case of an enemy being oblivious at
   * 30 px. Default: 60 px. Rarely needs tuning.
   */
  proximityRadius?: number;

  /**
   * How much this entity's sight is preserved in darkness. Ranges 0–1.
   *
   *   0 (default) — fully affected: effectiveAggroRadius = aggroRadius × illumination.
   *   1 — true darkvision: aggroRadius is unchanged regardless of light level.
   *   0.5 — partial darkvision: interpolates between the two extremes.
   *
   * Illumination is sampled at the TARGET's world position using the same
   * quadratic attenuation formula the Light2D shader applies to the scene.
   * A hero hiding in a dark corner is genuinely harder to spot — not just
   * "the room is globally dark". Has no effect in scenes without point lights.
   */
  darkvision?: number;

  // ── Combat vocalisations (optional) ──────────────────────────────────────
  /**
   * One-shot sound effects for combat events. Each fired event emits
   * 'entity-combat-sound' so the arena scene can apply distance attenuation.
   * All keys must be preloaded by the scene; missing keys are skipped gracefully.
   */
  combatSounds?: {
    /** Played once when the entity first acquires a target (unaware → aware). */
    aggro?: string;
    /** Played when this entity lands a melee hit on a target. */
    attack?: string;
    /** Played when this entity takes damage. */
    hurt?: string;
    /** Played when this entity dies. */
    death?: string;
    /** Base playback volume at zero camera distance (default 0.7). */
    volume?: number;
    /** Minimum playback rate / pitch (default 0.9). */
    pitchMin?: number;
    /** Maximum playback rate / pitch (default 1.1). */
    pitchMax?: number;
  };

  // ── Ambient vocalisation (optional) ──────────────────────────────────────
  /**
   * Idle/ambient sound config. When set, the entity emits 'entity-ambient-sound'
   * scene events on a random timer so the arena scene can play spatially-
   * attenuated audio without the entity needing a direct sound manager reference.
   *
   * The interval is re-randomised after each chirp so the pattern feels organic
   * rather than mechanical. A random initial delay (up to intervalMaxMs) is baked
   * in at construction time so multiple entities of the same type don't all fire
   * on the same tick.
   */
  ambientSounds?: {
    /** Audio keys (must be preloaded by the scene). Randomly chosen each time. */
    keys: string[];
    /** Minimum ms between emissions. */
    intervalMinMs: number;
    /** Maximum ms between emissions. */
    intervalMaxMs: number;
    /** Base playback volume at zero distance from the camera. */
    volume: number;
    /** Minimum playback rate (pitch). 1.0 = normal, 1.3 = higher, faster. */
    pitchMin: number;
    /** Maximum playback rate (pitch). */
    pitchMax: number;
  };
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
  /** Additional static damageable targets (e.g. BurrowHoles) for melee and projectile checks. */
  protected extraDamageables: Damageable[] = [];
  /** When true the BT is bypassed — the scene drives velocity and attacks directly. */
  protected playerControlled = false;

  /**
   * Set to true by a SignalJammer while this entity is inside its suppression
   * radius. Game systems check this flag to disable signature abilities.
   */
  public signatureDisabled = false;

  protected attackTimer = 0;
  private wanderAngle = Math.random() * Math.PI * 2;
  private wanderTimer = 0;
  /** Timestamp (scene.time.now) until which this entity cannot move or act. */
  private rootUntil = 0;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  private readonly hpBarBg:   Phaser.GameObjects.Rectangle;
  /** Coloured rectangle at Container origin — used for hit-flash. */
  private readonly bodyRect:  Phaser.GameObjects.Rectangle;
  /** Original fill colour — restored after a white-flash on hit. */
  private readonly bodyColor: number;

  /** Subclasses set this true to skip applySeparationForce (e.g. while burrowing). */
  protected suppressSeparation = false;

  /**
   * When false, this entity is excluded from aggro target selection and its
   * HP bar is hidden. Use this for stealth states — e.g. a Mimic Crawler in
   * disguise. Set back to true BEFORE any reveal animation plays so there is
   * no frame where the entity is visible but still un-targetable.
   * AoE / direct-hit damage intentionally does NOT check this flag.
   */
  isTargetable = true;

  // ── Dash state ──────────────────────────────────────────────────────────────
  private isDashing  = false;
  private dashTimer  = 0;
  private dashVx     = 0;
  private dashVy     = 0;
  private readonly dashSpeedMultiplier: number;
  private readonly dashDurationMs:      number;

  // ── Ranged config ───────────────────────────────────────────────────────────
  protected readonly projectileDamage: number | undefined;
  protected   readonly projectileSpeed:  number;
  protected   readonly projectileColor:  number;

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
  protected attackAnimTimer = 0;
  /** How long to hold the attack animation = 40% of the attack cooldown. */
  protected readonly attackAnimDuration: number;
  /**
   * The animation state name to use while attackAnimTimer > 0.
   * Defaults to 'attack' (single-attack entities: Skald, Spider, Crow, Skag).
   * Override in buildTree() actions to use different states per attack type
   * (e.g. Tinkerer sets 'attack_melee' or 'attack_ranged' before calling ctx.attack/shootAt).
   */
  protected attackAnimId = 'attack';

  // ── Swarm / boids coordination ────────────────────────────────────────────
  /**
   * Same-team combatants used for boids steering (separation, alignment,
   * cohesion). Set by the arena scene via setSwarmNeighbours() after each
   * spawn/death event. Positions are read dynamically each tick so the
   * array reference can be reused without staling.
   */
  private swarmNeighbours: CombatEntity[] = [];
  /** Mutable boids weights — spiked during panic, lerped back to base. */
  private swarmWeights: SwarmWeights = { ...BASE_WEIGHTS };
  /** ms remaining in panic state. Weights lerp from PANIC back to BASE as it expires. */
  private panicTimer = 0;
  static readonly PANIC_DURATION_MS = 3000;

  /** Shared arena state — set by the scene, read by individual enemy BTs. */
  protected blackboard: ArenaBlackboard | null = null;

  // ── Status effects ─────────────────────────────────────────────────────────
  /** When true the entity cannot move (applied by StaticCrawler on melee hit). */
  frozen = false;
  private frozenTimer = 0;
  /**
   * When true the entity's signature ability is suppressed (applied by
   * StaticCrawler EMP on death). Checked by hero BT branches that gate
   * signature moves — currently a flag; the hero can read it before using
   * special abilities.
   */
  private signatureDisabledTimer = 0;
  /**
   * When true the entity's movement input axes are negated — left becomes
   * right, up becomes down. Applied by StaticGhost on contact. The arena
   * scene checks this flag before passing velocity to setMoveVelocity().
   */
  controlsInverted = false;
  private controlsInvertedTimer = 0;

  // ── Iso mode (CombatArena) ────────────────────────────────────────────────
  /** Arena world-space x in px. Physics proxy lives here; sprite display is iso-projected. */
  _wx = 0;
  /** Arena world-space y in px. Physics proxy lives here; sprite display is iso-projected. */
  _wy = 0;
  /** Invisible zone whose physics body stays in world space for collisions. */
  physicsProxy: Phaser.GameObjects.Zone | null = null;
  /**
   * When true, _isoSync() projects (_wx, _wy) to iso screen coords each tick.
   * Set by CombatArenaScene after spawning. False keeps non-arena usage unchanged.
   */
  isoMode = true;

  /**
   * Obstacle AABBs used for line-of-sight checks. Populated by the arena
   * scene via setWallRects() when physics are added to this entity.
   */
  private wallRects: readonly Phaser.Geom.Rectangle[] = [];

  // ── Sight line state ──────────────────────────────────────────────────────

  /** How long (ms) the enemy remembers the player after losing sight. */
  readonly sightMemoryMs: number;

  /**
   * Whether the last staggered sight check found an unobstructed ray to the
   * current target. Starts true so enemies are immediately active on spawn;
   * updateSightLine() corrects it on the first scheduled check.
   * Read by Velcrid buildTree() closures to gate special-attack branches.
   */
  protected canSeeTarget = true;

  /**
   * Last confirmed world position of the target while canSeeTarget was true.
   * The behavior tree moves toward this position during the memory window
   * instead of the target's real (potentially hidden) position.
   */

  /** Scene-time (ms) when the next scheduled sight check should fire. */
  private nextSightCheck = 0;

  // ── Hearing / alert state ─────────────────────────────────────────────────

  /** Max distance (px) to hear blackboard sound events. 0 = deaf (default). */
  readonly hearingRadius: number;
  /** Distance (px) for touch-range detection bypass — always detects regardless of walls. */
  readonly proximityRadius: number;
  /**
   * World position being investigated after hearing a sound event.
   * Treated as effectiveOpponent so the BT chases it. Cleared when a real
   * target enters vision range or the alert timer expires.
   */
  private alertOrigin: { x: number; y: number } | null = null;
  /** ms remaining to investigate the alertOrigin before returning to unaware. */
  private alertTimer = 0;

  // ── Ambient vocalisation state ────────────────────────────────────────────

  /** Ambient sound config, or undefined if this entity is silent. */
  private readonly ambientSoundCfg: CombatEntityConfig['ambientSounds'];
  /** Countdown (ms) until the next ambient sound fires. */
  private ambientTimer = 0;

  /** 0 = fully penalised by darkness, 1 = true darkvision (ignores light). */
  private readonly darkvision: number;

  // ── Combat sound state ────────────────────────────────────────────────────

  /** Combat sound config, or undefined if this entity has no combat vocalisations. */
  private readonly combatSndCfg: CombatEntityConfig['combatSounds'];
  /** Tracks whether entity had an effectiveOpponent last frame — detects aggro transition. */
  private hadTargetLastFrame = false;

  constructor(scene: Phaser.Scene, x: number, y: number, config: CombatEntityConfig) {
    // Bake a small random speed offset so swarm members move at slightly
    // different speeds — creates the uneven texture of a real insect swarm.
    // Scale speed down for iso view — world distances appear shorter in the
    // diamond projection so original speeds felt too fast.
    const isoSpeedScale = 0.55;
    super(scene, x, y, { ...config, speed: (config.speed * isoSpeedScale) + Phaser.Math.FloatBetween(-8, 8) });
    // Store world-space position for iso projection (_isoSync reads these).
    this._wx = x;
    this._wy = y;
    this.meleeRange       = config.meleeRange;
    this.attackCooldownMs = config.attackCooldownMs;

    this.dashSpeedMultiplier = config.dashSpeedMultiplier ?? 3.0;
    this.dashDurationMs      = config.dashDurationMs      ?? 120;

    this.projectileDamage = config.projectileDamage;
    this.projectileSpeed  = config.projectileSpeed  ?? 260;
    this.projectileColor  = config.projectileColor  ?? 0xffffff;

    this.sightMemoryMs  = config.sightMemoryMs  ?? 2000;
    this.hearingRadius  = config.hearingRadius  ?? 0;
    this.proximityRadius = config.proximityRadius ?? 60;
    this.darkvision      = config.darkvision      ?? 0;

    // Ambient sound — random initial delay so multiple entities of the same
    // type don't all chirp on the same first tick.
    this.ambientSoundCfg = config.ambientSounds;
    if (config.ambientSounds) {
      this.ambientTimer = Phaser.Math.FloatBetween(0, config.ambientSounds.intervalMaxMs);
    }

    this.combatSndCfg = config.combatSounds;

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
    this.hpBarBg = scene.add.rectangle(0, barY, BAR_W, BAR_H, 0x661111);
    this.add(this.hpBarBg);

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
      this.bringToTop(this.hpBarBg);
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

  /** Register static damageable targets (e.g. BurrowHoles) included in melee and projectile hits. */
  setExtraDamageables(d: Damageable[]): void {
    this.extraDamageables = [...d];
  }

  /**
   * Register same-team entities for boids steering.
   * Called by the arena after each spawn/death event.
   * Array reference is stored, not copied — positions are read live each tick.
   */
  setSwarmNeighbours(neighbours: CombatEntity[]): void {
    this.swarmNeighbours = neighbours;
  }

  /**
   * Trigger a panic scatter: spike swarm weights and add a burst velocity
   * away from the event origin (gunshot, nearby death, etc.).
   * Weights lerp back to base over PANIC_DURATION_MS.
   */
  enterPanic(ox: number, oy: number): void {
    this.panicTimer  = CombatEntity.PANIC_DURATION_MS;
    this.swarmWeights = { ...PANIC_WEIGHTS };

    // Immediate burst away from the scare source — feels like a startled insect.
    const physBody = this.getPhysicsBody();
    if (physBody && !this.isDashing) {
      const dx  = this.x - ox;
      const dy  = this.y - oy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      physBody.setVelocity((dx / len) * this.speed * 2.5, (dy / len) * this.speed * 2.5);
    }
  }

  /** Wire up the shared arena blackboard so BT nodes can coordinate. */
  setBlackboard(bb: ArenaBlackboard): void {
    this.blackboard = bb;
  }

  /**
   * Freeze this entity for `ms` milliseconds — velocity is zeroed and movement
   * input is ignored while frozen. Extends any existing freeze rather than
   * cutting it short.
   */
  applyFrozen(ms: number): void {
    this.frozen = true;
    this.frozenTimer = Math.max(this.frozenTimer, ms);
    (this.getPhysicsBody())?.setVelocity(0, 0);
  }

  /**
   * Suppress this entity's signature ability for `ms` milliseconds. Hero BT
   * branches that gate special moves should check `this.signatureDisabled`.
   * Extends any existing suppression rather than cutting it short.
   */
  applySignatureDisabled(ms: number): void {
    this.signatureDisabled = true;
    this.signatureDisabledTimer = Math.max(this.signatureDisabledTimer, ms);
  }

  /**
   * Invert this entity's movement controls for `ms` milliseconds — applied by
   * StaticGhost on contact. The arena scene negates dx/dy when this flag is set.
   * Extends any existing inversion rather than cutting it short.
   */
  applyControlsInverted(ms: number): void {
    this.controlsInverted = true;
    this.controlsInvertedTimer = Math.max(this.controlsInvertedTimer, ms);
  }

  /**
   * Register the obstacle rectangles for line-of-sight testing.
   * Called by CombatArenaScene after adding physics to this entity.
   */
  setWallRects(rects: readonly Phaser.Geom.Rectangle[]): void {
    this.wallRects = rects;
  }

  // ── Iso mode API (CombatArena) ────────────────────────────────────────────

  /**
   * Set the entity's arena world position and move the physics body to (wx, wy).
   *
   * Only the physics body origin is updated — the sprite's display position is
   * intentionally left unchanged. _isoSync() handles the visual side each tick.
   * Velocity and AI steering continue through Arcade physics as normal.
   *
   * @param wx  Arena world x in pixels (0..960)
   * @param wy  Arena world y in pixels (0..960)
   */
  setWorldPos(wx: number, wy: number): void {
    this._wx = wx;
    this._wy = wy;
    (this.getPhysicsBody())?.reset(wx, wy);
  }

  /**
   * Project the arena world position (_wx, _wy) to isometric screen coordinates
   * and move the sprite's display position and depth accordingly.
   *
   * Called at the end of every tick so the visual follows the physics body without
   * ever being placed at physics coordinates. No-op when isoMode is false, keeping
   * non-arena usage (top-down preview, unit tests) completely unchanged.
   */
  /** Get the physics body — uses proxy zone if available, else this.body. */
  getPhysicsBody(): Phaser.Physics.Arcade.Body | undefined {
    if (this.physicsProxy) {
      return this.physicsProxy.body as Phaser.Physics.Arcade.Body | undefined;
    }
    return this.body as Phaser.Physics.Arcade.Body | undefined;
  }

  _isoSync(): void {
    const body = this.getPhysicsBody();
    if (body) {
      this._wx = body.center.x;
      this._wy = body.center.y;
      // Keep the proxy zone's transform in sync so Phaser's internal
      // updateFromGameObject() doesn't reset the body to stale coords.
      if (this.physicsProxy) {
        this.physicsProxy.setPosition(this._wx, this._wy);
      }
    }
    const iso = worldToArenaIso(this._wx, this._wy);
    this.setPosition(iso.x, iso.y);
    this.setDepth(arenaIsoDepth(this._wx, this._wy));
  }

  /**
   * Returns true when a straight line from `from` to `to` is not blocked by
   * any registered obstacle rectangle.
   *
   * Uses Phaser's built-in segment-vs-AABB test so no navmesh is needed —
   * only the two stone pillars in the arena are registered as blockers.
   *
   * When no wall rects are registered (e.g. during unit tests or before the
   * scene calls setWallRects) the check always passes.
   */
  hasLineOfSight(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2): boolean {
    if (this.wallRects.length === 0) return true;
    const line = new Phaser.Geom.Line(from.x, from.y, to.x, to.y);
    for (const rect of this.wallRects) {
      if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
        return false; // blocked
      }
    }
    return true;
  }

  // ── Sight line ─────────────────────────────────────────────────────────────

  /**
   * Staggered line-of-sight check against arena obstacles. Call from the scene
   * update loop once per alive enemy, BEFORE entity.update(delta).
   *
   * The check only fires once every SIGHT_CHECK_INTERVAL_MS. Staggering by
   * roster index spreads raycasts evenly across frames:
   *   nextCheck = now + interval + (index / total) × interval
   *
   * With 20 enemies at 60 fps and a 150 ms interval that is ~5 raycasts/frame
   * instead of 20 — a ~4× reduction in AI raycast cost each frame.
   *
   * Side effects when the check fires:
   *   - canSeeTarget is updated.
   *   - If true, lastSeenTimestamp and lastKnownPosition are refreshed.
   *   - If false, the previous values are preserved for the memory window.
   *
   * @param obstacles - arena's static physics group (pillars, walls, corners)
   * @param index     - this enemy's position in the alive array (0-based)
   * @param total     - total number of alive enemies (for stagger calculation)
   */
  updateSightLine(
    obstacles: Phaser.Physics.Arcade.StaticGroup,
    index: number,
    total: number,
  ): void {
    const now = this.scene.time.now;
    if (now < this.nextSightCheck) return;

    // Spread next check time across the roster so all enemies don't ray-cast
    // simultaneously. The (index / total) fraction staggers each enemy by a
    // fraction of the full interval.
    const stagger = total > 1 ? (index / total) * SIGHT_CHECK_INTERVAL_MS : 0;
    this.nextSightCheck = now + SIGHT_CHECK_INTERVAL_MS + stagger;

    const target = this.findTargetOpponent();
    if (!target) {
      this.canSeeTarget = false;
      return;
    }

    // Use world coords for LOS — obstacles are in world space.
    const targetEntity = target as unknown as CombatEntity;
    const twx = targetEntity._wx ?? target.x;
    const twy = targetEntity._wy ?? target.y;
    this.canSeeTarget = hasLineOfSight(this._wx, this._wy, twx, twy, obstacles);

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
    this.updateAmbientSound(delta);

    // ── Status effect timers ─────────────────────────────────────────────────
    if (this.frozenTimer > 0) {
      this.frozenTimer = Math.max(0, this.frozenTimer - delta);
      if (this.frozenTimer === 0) this.frozen = false;
      // Keep velocity zeroed every frame while frozen so accumulated forces
      // (boids, knockback) don't gradually push the entity.
      (this.getPhysicsBody())?.setVelocity(0, 0);
      this.refreshHpBar();
      this.updateSpriteAnimation(delta);
      return;
    }
    if (this.signatureDisabledTimer > 0) {
      this.signatureDisabledTimer = Math.max(0, this.signatureDisabledTimer - delta);
      if (this.signatureDisabledTimer === 0) this.signatureDisabled = false;
    }
    if (this.controlsInvertedTimer > 0) {
      this.controlsInvertedTimer = Math.max(0, this.controlsInvertedTimer - delta);
      if (this.controlsInvertedTimer === 0) this.controlsInverted = false;
    }

    // Physics body — uses proxy zone in iso mode, else the entity's own body.
    const physBody = this.getPhysicsBody();

    // ── Root check — applied by applyRoot() (e.g. Blightfrog tongue) ─────────
    //
    // While rooted the entity cannot move or run its behavior tree. We zero
    // velocity each frame so knockback or physics drift cannot sneak through,
    // and return early to skip the BT entirely. Guard with this.active so a
    // destroyed entity cannot access its physics body mid-teardown.
    if (this.active && this.scene.time.now < this.rootUntil) {
      physBody?.setVelocity(0, 0);
      this.refreshHpBar();
      return;
    }

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
        // Ease-out: scale velocity by remaining-time fraction so the dash
        // decelerates smoothly to zero rather than cutting off abruptly.
        // Feels like a slide or roll instead of a hard burst.
        const t = this.dashTimer / this.dashDurationMs;
        physBody?.setVelocity(this.dashVx * t, this.dashVy * t);
      }
    }

    // When player-controlled, skip the behavior tree — the arena scene drives
    // movement and attacks directly via setMoveVelocity / tryMelee / tryDash.
    if (!this.playerControlled) {
    // Pick the target opponent for this frame's BT tick.
    const target = this.findTargetOpponent();

    // ── Sight-gated effective opponent ──────────────────────────────────────
    //
    // Three states drive enemy AI:
    //   1. canSeeTarget true  → real target position   (active aggro)
    // Two states: canSeeTarget → active aggro, else → no target (wander/explore).
    let effectiveOpponent: { x: number; y: number } | null = null;
    if (target) {
      if (this.canSeeTarget) {
        effectiveOpponent = { x: target._wx, y: target._wy };
      }
      // No memory-based chasing — in a walled dungeon, losing sight means
      // the target is behind a wall. Chasing lastKnownPosition causes
      // entities to walk into walls and get stuck.
    }

    // ── Hearing / alert state (FIL-374) ─────────────────────────────────────
    //
    // When unaware (no effective opponent from vision or memory), check the
    // blackboard for loud events within hearingRadius. If one is close enough,
    // record its origin and investigate for up to 3 s. The BT treats alertOrigin
    // as ctx.opponent — the entity moves toward it. If updateSightLine fires a
    // positive LOS check on arrival, the entity promotes to full tracking.
    if (!effectiveOpponent && this.hearingRadius > 0 && this.blackboard) {
      for (const ev of this.blackboard.soundEvents) {
        const d = Phaser.Math.Distance.Between(this._wx, this._wy, ev.x, ev.y);
        if (d <= Math.min(this.hearingRadius, ev.radius)) {
          this.alertOrigin = { x: ev.x, y: ev.y };
          this.alertTimer  = 3000;
          break;
        }
      }
    }

    // Tick alert investigation: promote alertOrigin to effectiveOpponent while active.
    // Cancel if a real sighted target appeared, or the timer ran out.
    if (this.alertOrigin) {
      if (effectiveOpponent) {
        // Found a real target — cancel the investigation (vision takes priority).
        this.alertOrigin = null;
      } else {
        this.alertTimer -= delta;
        if (this.alertTimer <= 0) {
          this.alertOrigin = null;   // gave up — return to unaware/wander
        } else {
          effectiveOpponent = this.alertOrigin;
        }
      }
    }

    // Aggro vocalisation — fire once when transitioning from no-target to having one.
    // Triggers for both vision-acquired and proximity-detected targets.
    const hasTarget = effectiveOpponent !== null;
    if (hasTarget && !this.hadTargetLastFrame) this.emitCombatSound('aggro');
    this.hadTargetLastFrame = hasTarget;

    const ctx: CombatContext = {
      x:     this._wx,
      y:     this._wy,
      hp:    this.hp,
      maxHp: this.maxHp,

      opponent: effectiveOpponent,

      moveToward: (tx, ty) => {
        if (!physBody || this.isDashing || this.frozen) return;
        const dx  = tx - this._wx;
        const dy  = ty - this._wy;
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
        target.onHitBy(this._wx, this._wy);
        this.attackTimer = this.attackCooldownMs;
        // Hold the attack animation for 40% of the cooldown duration.
        this.attackAnimTimer = this.attackAnimDuration;
        this.emitCombatSound('attack');
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
        if (!this.projectileDamage || !this.canShoot()) return;
        // Line-of-sight check — skip the shot if a pillar is in the way.
        // Prevents enemies from firing through solid obstacles.
        if (!this.hasLineOfSight(
          new Phaser.Math.Vector2(this._wx, this._wy),
          new Phaser.Math.Vector2(tx, ty),
        )) return;
        // Apply accuracy spread: range-based + movement penalty + partial-cover penalty.
        const eBody = this.getPhysicsBody();
        const eVel  = eBody?.velocity;
        const eSpd  = eVel ? Math.sqrt(eVel.x * eVel.x + eVel.y * eVel.y) : 0;
        const eSpeedFraction = this.speed > 0 ? Math.min(eSpd / this.speed, 1) : 0;
        const eDist     = Phaser.Math.Distance.Between(this._wx, this._wy, tx, ty);
        const eInCover  = isPartialCover(this._wx, this._wy, tx, ty, this.wallRects);
        const eSpread     = calcSpread(eDist, eSpeedFraction, eInCover);
        const eIsoOrigin  = worldToArenaIso(this._wx, this._wy);
        const eIsoTarget  = worldToArenaIso(tx, ty);
        const angle       = applySpread(
          Math.atan2(eIsoTarget.y - eIsoOrigin.y, eIsoTarget.x - eIsoOrigin.x),
          eSpread,
        );

        const p = new Projectile(
          this.scene, eIsoOrigin.x, eIsoOrigin.y, angle,
          this.projectileSpeed, this.projectileDamage,
          this.projectileColor,
          // Merge opponents and extra targets so projectiles can hit BurrowHoles too.
          (this.opponents as unknown as Damageable[]).concat(this.extraDamageables),
        );
        // Emit on the SCENE event bus (not this.emit) so CombatArenaScene can
        // listen with a single handler rather than per-entity listeners.
        this.scene.events.emit('projectile-spawned', p);
        // Hold the ranged-attack animation for the same duration as a melee hit.
        this.attackAnimTimer = this.attackAnimDuration;
        this.onShotFired();
      },

      // ── New: directional dash ──────────────────────────────────────────────
      dash: (tx, ty) => {
        if (this.isDashing || !physBody) return;
        // Use world coords for the LOS check — wallRects are in world space.
        if (!this.hasLineOfSight(
          new Phaser.Math.Vector2(this._wx, this._wy),
          new Phaser.Math.Vector2(tx, ty),
        )) return;
        const dx  = tx - this._wx;
        const dy  = ty - this._wy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        // Cap dash distance to prevent tunnelling through walls.
        // The dash travels at most dashDurationMs * dashSpeed pixels.
        // If that exceeds the LOS-clear distance, shorten the duration.
        const spd = this.speed * this.dashSpeedMultiplier;
        const maxDist = spd * (this.dashDurationMs / 1000);
        const clampedDuration = len < maxDist
          ? this.dashDurationMs * (len / maxDist)
          : this.dashDurationMs;
        this.dashVx    = (dx / len) * spd;
        this.dashVy    = (dy / len) * spd;
        this.dashTimer = clampedDuration;
        this.isDashing = true;
        physBody.setVelocity(this.dashVx, this.dashVy);
      },

      steerAway: (fromX, fromY) => {
        if (!physBody || this.isDashing) return;
        const dx = this._wx - fromX;
        const dy = this._wy - fromY;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        physBody.setVelocity((dx / len) * this.speed, (dy / len) * this.speed);
      },

      orbitAround: (cx, cy, radius, cw) => {
        if (!physBody || this.isDashing) return;
        const curAngle  = Math.atan2(this._wy - cy, this._wx - cx);
        const angSpeed  = this.speed / Math.max(radius, 1);
        const nextAngle = curAngle + (cw ? 1 : -1) * angSpeed * (delta / 1000);
        const tx = cx + Math.cos(nextAngle) * radius;
        const ty = cy + Math.sin(nextAngle) * radius;
        const dx = tx - this._wx;
        const dy = ty - this._wy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        physBody.setVelocity((dx / len) * this.speed, (dy / len) * this.speed);
      },
    };

    this.behaviorTree.tick(ctx, delta);

    // Tick panic — lerp swarm weights back to base as the panic timer drains.
    // At t=1 (full panic) weights equal PANIC_WEIGHTS; at t=0 they are BASE.
    if (this.panicTimer > 0) {
      this.panicTimer = Math.max(0, this.panicTimer - delta);
      const t = this.panicTimer / CombatEntity.PANIC_DURATION_MS;
      this.swarmWeights.separation = PANIC_WEIGHTS.separation * t + BASE_WEIGHTS.separation * (1 - t);
      this.swarmWeights.alignment  = PANIC_WEIGHTS.alignment  * t + BASE_WEIGHTS.alignment  * (1 - t);
      this.swarmWeights.cohesion   = PANIC_WEIGHTS.cohesion   * t + BASE_WEIGHTS.cohesion   * (1 - t);
    }

    this.applySwarmForce();
    } // end !playerControlled

    this.refreshHpBar();
    this.updateSpriteAnimation(delta);
    this._isoSync();
  }

  // ── Player-control API ────────────────────────────────────────────────────

  /** Switch between AI control (false) and direct player control (true). */
  setPlayerControlled(v: boolean): void { this.playerControlled = v; }

  /**
   * Set velocity directly for player-driven movement.
   * No-op while a dash is in progress so the burst isn't cancelled.
   */
  setMoveVelocity(vx: number, vy: number): void {
    if (this.isDashing || this.frozen) return;
    (this.getPhysicsBody())?.setVelocity(vx, vy);
  }

  /**
   * Attempt a melee attack in a forward arc, hitting all opponents in range.
   *
   * The swipe covers a 120° cone centred on the direction from the hero to the
   * nearest opponent (or the last known movement direction). All living opponents
   * within the arc receive full damage and a knockback impulse away from the hero.
   * ExtraDamageables (e.g. BurrowHoles) are hit with a plain distance check as
   * before, since they don't have a meaningful facing angle.
   *
   * Arc constants:
   *   - Reach: meleeRange × 2.5  (same generous reach as before)
   *   - Half-angle: 60° (total sweep = 120°)
   *   - Knockback: 240 px/s for 120 ms  (3× the old onHitBy default)
   */
  tryMelee(): void {
    if (this.attackTimer > 0) return;

    const meleeReach  = this.meleeRange * 2.5;
    const HALF_ARC    = Math.PI / 3; // 60° → 120° total sweep

    // Determine the facing direction: toward nearest opponent, or fall back to
    // current velocity direction so the arc always points where the hero is moving.
    let faceAngle = 0;
    const nearest = this.findNearestLivingOpponent();
    if (nearest) {
      faceAngle = Math.atan2(nearest.y - this.y, nearest.x - this.x);
    } else {
      const body = this.getPhysicsBody();
      if (body && (body.velocity.x !== 0 || body.velocity.y !== 0)) {
        faceAngle = Math.atan2(body.velocity.y, body.velocity.x);
      }
    }

    // Hit every living opponent inside the arc.
    let hitAny = false;
    for (const opp of this.opponents) {
      if (!opp.isAlive) continue;
      const dist = Phaser.Math.Distance.Between(this.x, this.y, opp.x, opp.y);
      if (dist > meleeReach) continue;
      const angle = Math.atan2(opp.y - this.y, opp.x - this.x);
      // Shortest angular difference — wraps correctly across the ±π boundary.
      const diff = Math.abs(Phaser.Math.Angle.Wrap(angle - faceAngle));
      if (diff > HALF_ARC) continue;

      opp.takeDamage(this.attackDamage);
      // Knockback impulse: 3× stronger than the old onHitBy default.
      opp.onHitByMelee(this._wx, this._wy);
      hitAny = true;
    }

    // ExtraDamageables (BurrowHoles etc.) — plain distance, no arc needed.
    for (const d of this.extraDamageables) {
      if (!d.isAlive) continue;
      const dist = Phaser.Math.Distance.Between(this.x, this.y, d.x, d.y);
      if (dist <= meleeReach) {
        d.takeDamage(this.attackDamage);
        hitAny = true;
      }
    }

    if (hitAny || nearest) {
      // Start cooldown whenever the swipe is attempted near a target, regardless
      // of whether anyone was actually inside the arc.
      this.attackTimer     = this.attackCooldownMs;
      this.attackAnimTimer = this.attackAnimDuration;
    }
  }

  /**
   * Fire a ranged shot at the nearest living opponent.
   * No-op if projectile damage isn't configured or the attack is on cooldown.
   * Sets attack_ranged animation and emits 'hero-shot' so the scene can play
   * sound + muzzle flash — same effect as the AI behavior tree path.
   */
  tryRanged(): void {
    if (this.attackTimer > 0 || !this.projectileDamage || !this.canShoot()) return;
    const target = this.findNearestLivingOpponent();
    if (!target) return;
    const physBody = this.getPhysicsBody();
    const vel = physBody?.velocity;
    const currentSpeed  = vel ? Math.sqrt(vel.x * vel.x + vel.y * vel.y) : 0;
    const speedFraction = this.speed > 0 ? Math.min(currentSpeed / this.speed, 1) : 0;

    const dist      = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y);
    const inCover   = isPartialCover(this._wx, this._wy, target._wx, target._wy, this.wallRects);
    const spread    = calcSpread(dist, speedFraction, inCover);
    const isoOrigin = worldToArenaIso(this._wx, this._wy);
    const isoTarget = worldToArenaIso(target._wx, target._wy);
    const angle     = applySpread(
      Math.atan2(isoTarget.y - isoOrigin.y, isoTarget.x - isoOrigin.x),
      spread,
    );

    const p = new Projectile(
      this.scene, isoOrigin.x, isoOrigin.y, angle,
      this.projectileSpeed, this.projectileDamage,
      this.projectileColor,
      (this.opponents as unknown as Damageable[]).concat(this.extraDamageables),
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
    const physBody = this.getPhysicsBody();
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

    const body = this.getPhysicsBody();
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
    const key = this.spriteObj.texture.key;
    const tag = `${key}_${state}_${this.lastDir}`;
    // Fall back to idle when the requested animation doesn't exist (e.g. sprites
    // that only have idle+walk but no attack/dash — like mini-velcrid enemies).
    const playKey = this.scene.anims.exists(tag) ? tag : `${key}_idle_${this.lastDir}`;

    // Only call play() when the tag changes to avoid restarting mid-loop.
    if (this.spriteObj.anims.currentAnim?.key !== playKey) {
      this.spriteObj.play(playKey, true);
    }
  }

  /**
   * Returns the closest living targetable opponent within detection range, or null.
   *
   * Detection gates (FIL-370 / FIL-375):
   *   - Proximity bypass: targets within proximityRadius are ALWAYS detected,
   *     regardless of aggroRadius or walls. Prevents the absurd case where an
   *     enemy is 30 px away but oblivious because LOS hasn't fired yet.
   *   - Aggro radius: targets beyond proximityRadius are only considered when
   *     within aggroRadius. LOS is then enforced by canSeeTarget / updateSightLine —
   *     enemies behind walls set canSeeTarget=false and fall through to wander.
   *
   * Heroes call this too (tryMelee / tryRanged). For heroes aggroRadius is
   * implicitly large (400 px default) so they can always target visible enemies.
   */
  protected findNearestLivingOpponent(): CombatEntity | null {
    let nearest: CombatEntity | null = null;
    let nearestDist = Infinity;
    for (const o of this.opponents) {
      // Skip dead or stealth/disguised enemies — not valid aggro targets.
      if (!o.isAlive || !o.isTargetable) continue;
      // Use world coords for distance — iso coords distort distances.
      const d = Phaser.Math.Distance.Between(this._wx, this._wy, o._wx, o._wy);

      // Light-adjusted aggro radius — illumination is sampled at the TARGET's
      // position, not the entity's: a player hiding in a dark corner is harder
      // to spot, not just "the room is globally dark".
      //
      //   effectiveAggro = aggroRadius × lerp(illumination, 1, darkvision)
      //     darkvision 0 → effectiveAggro = aggroRadius × illumination (full penalty)
      //     darkvision 1 → effectiveAggro = aggroRadius               (ignores light)
      //
      // Short-circuit when darkvision is maxed — avoids the light sample entirely.
      const effectiveAggro = this.darkvision >= 1
        ? this.aggroRadius
        : this.aggroRadius * (
            this.darkvision < 0.001
              ? sampleIllumination(this.scene, o.x, o.y)
              : (() => {
                  const illum = sampleIllumination(this.scene, o.x, o.y);
                  return illum + (1 - illum) * this.darkvision; // lerp toward 1
                })()
          );

      // Outside proximity AND outside light-adjusted aggroRadius → ignore.
      if (d > this.proximityRadius && d > effectiveAggro) continue;
      // Must have line-of-sight — don't acquire targets through walls.
      if (this.wallRects.length > 0 && !this.hasLineOfSight(
        new Phaser.Math.Vector2(this._wx, this._wy),
        new Phaser.Math.Vector2(o._wx, o._wy),
      )) continue;
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

    // A melee hit is a loud event — broadcast so nearby enemies can hear it.
    // Radius 280 px: audible in the same room but not across the whole arena.
    this.blackboard?.broadcastSound(this.x, this.y, 280);
    this.emitCombatSound('hurt');

    // Flash the body rect white; restore original fill colour after 80 ms.
    // Rectangle uses setFillStyle, not setTint (which is for Image/Sprite).
    this.bodyRect.setFillStyle(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.bodyRect.setFillStyle(this.bodyColor);
    });

    // Knockback: brief velocity burst away from attacker.
    const physBody = this.getPhysicsBody();
    if (physBody) {
      const angle = Math.atan2(this.y - fromY, this.x - fromX);
      physBody.setVelocity(Math.cos(angle) * 80, Math.sin(angle) * 80);
      this.scene.time.delayedCall(100, () => {
        if (this.active && this.isAlive) physBody.setVelocity(0, 0);
      });
    }
  }

  /**
   * Stronger knockback variant called by the player melee arc swipe.
   * 3× the impulse of onHitBy and held for longer, so the target visibly
   * slides away from the swipe direction.
   */
  onHitByMelee(fromX: number, fromY: number): void {
    if (!this.isAlive) return;

    // Player melee swipe is louder than an enemy jab — broader alert radius.
    this.blackboard?.broadcastSound(this.x, this.y, 380);
    this.emitCombatSound('hurt');

    this.bodyRect.setFillStyle(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.bodyRect.setFillStyle(this.bodyColor);
    });

    const physBody = this.getPhysicsBody();
    if (physBody) {
      const angle = Math.atan2(this.y - fromY, this.x - fromX);
      physBody.setVelocity(Math.cos(angle) * 240, Math.sin(angle) * 240);
      this.scene.time.delayedCall(150, () => {
        if (this.active && this.isAlive) physBody.setVelocity(0, 0);
      });
    }
  }

  // ── Subclass hooks ────────────────────────────────────────────────────────────

  /** Override to block ranged shots (e.g. during reload). Default: always true. */
  protected canShoot(): boolean { return true; }

  /**
   * Called by the BT shootAt closure after each projectile is fired.
   * Override in subclasses to track magazine state for AI shots. Default: no-op.
   */
  protected onShotFired(): void { /* no-op */ }

  /**
   * Root this entity for `durationMs` milliseconds — halts all movement and
   * bypasses the behavior tree. If the entity is already rooted, the timer is
   * reset (not extended) so repeated hits don't stack indefinitely.
   */
  applyRoot(durationMs: number): void {
    this.rootUntil = this.scene.time.now + durationMs;
  }

  // ── LivingEntity hook ──────────────────────────────────────────────────────

  /**
   * Override death to play the death animation, hold the corpse for a random
   * window (12–18 s), fade it out, then self-destroy.
   *
   * The scene's justDied delayedCall is a safety net only — under normal
   * conditions this method manages its own cleanup timeline.
   */
  protected override onDeath(): void {
    this.emitCombatSound('death');

    const physBody = this.getPhysicsBody();
    physBody?.setVelocity(0, 0);

    // Random linger before fade — multiple deaths don't all vanish in sync.
    const corpseMs = Phaser.Math.Between(12000, 18000);

    // Tween alpha to 0 over 1.5 s, then self-destroy.
    const startFade = (): void => {
      if (!this.active) return;
      this.scene.tweens.add({
        targets:  this,
        alpha:    0,
        duration: 1500,
        ease:     'Cubic.easeIn',
        onComplete: () => { if (this.active) this.destroy(); },
      });
    };

    if (this.spriteObj) {
      this.spriteObj.setFlipX(this.lastFlipX);
      const deathKey = `${this.spriteObj.texture.key}_death_${this.lastDir}`;
      if (this.scene.anims.exists(deathKey)) {
        // Play the death animation once, hold the last frame, then start fade.
        this.spriteObj.play(deathKey, true);
        this.spriteObj.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (!this.active) return;
          this.scene.time.delayedCall(corpseMs, startFade);
        });
      } else {
        // No death animation — hold static sprite then fade after corpseMs.
        this.scene.time.delayedCall(corpseMs, startFade);
      }
    } else {
      this.scene.time.delayedCall(corpseMs, startFade);
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

  /**
   * Counts down the ambient-sound timer and fires an 'entity-ambient-sound'
   * scene event when it expires. The event carries the audio key and world
   * position; the arena scene handles distance attenuation and playback.
   *
   * Interval is re-randomised after each emission so the pattern stays
   * irregular — a fixed tick would feel mechanical within seconds.
   */
  private updateAmbientSound(delta: number): void {
    if (!this.ambientSoundCfg || !this.isAlive) return;
    this.ambientTimer -= delta;
    if (this.ambientTimer > 0) return;

    const cfg = this.ambientSoundCfg;
    const key = cfg.keys[Math.floor(Math.random() * cfg.keys.length)];
    this.scene.events.emit('entity-ambient-sound', {
      key,
      x:        this.x,
      y:        this.y,
      volume:   cfg.volume,
      pitchMin: cfg.pitchMin,
      pitchMax: cfg.pitchMax,
    });

    // Re-schedule with a fresh random interval.
    this.ambientTimer = Phaser.Math.FloatBetween(cfg.intervalMinMs, cfg.intervalMaxMs);
  }

  /**
   * Emit an 'entity-combat-sound' scene event for one of the four combat moments.
   * The arena scene applies distance attenuation and handles actual playback.
   * Silently no-ops when combatSounds is not configured or the specific key is absent.
   */
  private emitCombatSound(type: 'aggro' | 'attack' | 'hurt' | 'death'): void {
    const cfg = this.combatSndCfg;
    if (!cfg) return;
    const key = cfg[type];
    if (!key) return;
    this.scene.events.emit('entity-combat-sound', {
      key,
      x:        this.x,
      y:        this.y,
      volume:   cfg.volume   ?? 0.7,
      pitchMin: cfg.pitchMin ?? 0.9,
      pitchMax: cfg.pitchMax ?? 1.1,
    });
  }

  private refreshHpBar(): void {
    this.hpBarFill.scaleX = Math.max(0, this.hpFraction);
    // Hide while untargetable (stealth) OR at full HP — reduces visual clutter
    // when many enemies are alive simultaneously.
    const visible = this.isTargetable && this.hpFraction < 1;
    this.hpBarBg.setVisible(visible);
    this.hpBarFill.setVisible(visible);
  }

  /**
   * Full Reynolds boids steering — separation, alignment, and cohesion.
   *
   * Replaces the old single-rule separation force. Reads swarmNeighbours (set
   * by the arena scene) and delegates to SwarmBrain.steer() which returns a
   * velocity addend. That addend is added to the current physics velocity and
   * clamped to 2× speed so boids forces never override BT movement entirely.
   *
   * Panic spikes the separation weight and collapses cohesion/alignment,
   * causing the swarm to scatter; weights are lerped back to BASE over 3 s.
   *
   * Suppressed while burrowing (suppressSeparation = true) so the slow
   * underground approach isn't deflected by ally-push.
   */
  private applySwarmForce(): void {
    if (this.swarmNeighbours.length === 0 || this.isDashing || this.suppressSeparation) return;
    const physBody = this.getPhysicsBody();
    if (!physBody) return;

    // Build neighbour snapshots — skip self and dead entities.
    const neighbours: BoidsNeighbour[] = [];
    for (const nb of this.swarmNeighbours) {
      if ((nb as unknown) === (this as unknown) || !nb.isAlive) continue;
      const nbBody = (nb as CombatEntity).getPhysicsBody();
      neighbours.push({
        x:  nb._wx,
        y:  nb._wy,
        vx: nbBody?.velocity.x ?? 0,
        vy: nbBody?.velocity.y ?? 0,
      });
    }

    if (neighbours.length === 0) return;

    const impulse = SwarmBrain.steer(this._wx, this._wy, this.speed, neighbours, this.swarmWeights);

    // Add a tiny per-frame jitter so perfectly-synchronised entities drift apart
    // naturally, even when all weights are zero (e.g. during full panic alignment=0).
    const jx = (Math.random() - 0.5) * 6;
    const jy = (Math.random() - 0.5) * 6;

    const cv    = physBody.velocity;
    const newVx = cv.x + impulse.vx + jx;
    const newVy = cv.y + impulse.vy + jy;

    // Clamp to 2× speed — boids never fully hijack BT movement.
    const finalSpd = Math.sqrt(newVx * newVx + newVy * newVy);
    const maxSpd   = this.speed * 2;
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

// ── Spinaria (bio / evolution) enemies ────────────────────────────────────────

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
      spriteKey: 'mini-velcrid', spriteTint: 0xcc88ff, spriteScale: 0.35,
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
      spriteKey: 'mini-velcrid', spriteTint: 0xaaee44, spriteScale: 0.35,
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
      spriteKey: 'mini-velcrid', spriteTint: 0xff4422, spriteScale: 0.55,
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

      const physBody = this.getPhysicsBody();

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
      spriteKey: 'mini-velcrid', spriteTint: 0x44ddcc, spriteScale: 0.38,
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
      spriteKey: 'mini-velcrid', spriteTint: 0x55ff33, spriteScale: 0.25,
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

// ── Spinolandet enemy types ───────────────────────────────────────────────────
//
// Three creature types native to Spinolandet (Level 3 delta zone invaders):
//   Spineling    — fast melee swarmer; dangerous in numbers
//   Blightfrog   — toxic spitter that keeps distance and slings acid
//   PackStalker  — coordinated trio hunter; defined in PackStalker.ts

/**
 * Spineling — fast chitinous swarmer from Spinolandet.
 *
 * Individually fragile but terrifying in the 20-unit swarms they come in.
 * Behavior: direct charge + melee bite. No special mechanics; pure aggression.
 */
export class Spineling extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            18,
      speed:            125,
      aggroRadius:      420,
      attackDamage:     6,
      color:            0x4a3a28, // earthy brown-orange (Spinolandet chitin)
      meleeRange:       22,
      attackCooldownMs: 550,
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

/**
 * Blightfrog — corruption-touched amphibian that spits acid from range.
 *
 * Behavior tree:
 *   1. Flee  — back away when the opponent closes to < 50 px (too close to spit)
 *   2. Spit  — launch an acid projectile (700 ms cooldown) at 60–200 px range
 *   3. Close — reposition into spit range when target is too far
 *   4. Wander (fallback)
 */
export class Blightfrog extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:             45,
      speed:             62,
      aggroRadius:       350,
      attackDamage:      8,
      color:             0x224a11, // dark Spinolandet green
      meleeRange:        26,
      attackCooldownMs:  700,
      projectileDamage:  10,
      projectileSpeed:   190,
      projectileColor:   0x55cc22, // acid green
    });
  }

  protected buildTree(): BtNode {
    const TOO_CLOSE = 50;
    const SPIT_MIN  = 60;
    const SPIT_MAX  = 200;

    return new BtSelector([

      // ── 1. Flee when the opponent is inside spitting distance ──────────────
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          return Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y)
            < TOO_CLOSE;
        }),
        new BtAction(ctx => {
          const fleeX = ctx.x + (ctx.x - ctx.opponent!.x);
          const fleeY = ctx.y + (ctx.y - ctx.opponent!.y);
          ctx.moveToward(fleeX, fleeY);
          return 'running';
        }),
      ]),

      // ── 2. Spit acid from preferred range ─────────────────────────────────
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= SPIT_MIN && d <= SPIT_MAX;
          }),
          new BtAction(ctx => {
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            ctx.stop();
            return 'success';
          }),
        ]),
        700,
      ),

      // ── 3. Reposition into spit range ──────────────────────────────────────
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // ── 4. Wander (fallback) ───────────────────────────────────────────────
      new BtAction((ctx, d) => { ctx.wander(d); return 'running'; }),
    ]);
  }
}
