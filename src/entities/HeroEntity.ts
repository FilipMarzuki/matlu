import * as Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import { BtNode } from '../ai/BehaviorTree';

/**
 * Simplified config interface for hero entities.
 *
 * Heroes share the same AI infrastructure as enemies (behavior tree, sight,
 * hearing) but expose friendlier defaults (higher sightMemoryMs, no speed
 * jitter intent, blue debug rect) and an explicit player/AI toggle.
 */
export interface HeroConfig {
  maxHp: number;
  speed: number;

  /**
   * Radius (px) within which this hero notices enemies and engages.
   * Equivalent to an enemy's aggroRadius — used by the sight system to bound
   * how far the hero looks for targets when in AI mode. Default: 350.
   */
  aggroRadius?: number;

  /** Base melee damage per hit. Default: 12. */
  attackDamage?: number;

  /** Distance (px) to trigger a melee attack. Default: 38. */
  meleeRange?: number;

  /** Minimum ms between successive melee attacks. Default: 900. */
  attackCooldownMs?: number;

  /** Projectile damage — set for ranged heroes (e.g. Loke). */
  projectileDamage?: number;

  /** Projectile travel speed px/s. Default: 300. */
  projectileSpeed?: number;

  /** Debug rectangle fill colour (hex). Default: 0x4488ff. */
  color?: number;

  /** Aseprite spritesheet key (must be preloaded by the scene). */
  spriteKey?: string;
  spriteScale?: number;

  /**
   * How long (ms) the hero remembers an enemy's last known position after
   * losing line of sight. Heroes remember longer than most enemies. Default: 4000.
   */
  sightMemoryMs?: number;

  /**
   * Max distance (px) to hear blackboard sound events (gunshots, deaths).
   * Default: 280.
   */
  hearingRadius?: number;
}

/**
 * HeroEntity — base class for all player-controllable heroes.
 *
 * Extends CombatEntity to inherit the full AI infrastructure:
 *   - Behavior tree execution (buildTree() implemented per hero)
 *   - Opponent tracking with sight/hearing/memory
 *   - All 8 CombatContext action closures (moveToward, shootAt, dash, etc.)
 *   - setPlayerControlled() toggle
 *
 * Control modes:
 *   - Player mode (default): BT is paused; the scene drives velocity and
 *     calls hero-specific ability methods (shootSlingshot, useBlurDash, etc.)
 *   - Auto-play mode: BT ticks every frame and executes the hero's AI persona.
 *     Toggle with setAutoPlay(true).
 *
 * Lifecycle:
 *   1. Construct hero → defaults to player mode (setPlayerControlled(true))
 *   2. Scene calls setEnemies(roster) and optionally setAllies(allies)
 *   3. Scene calls setAutoPlay(true) to hand control to the BT
 *   4. Scene calls setAutoPlay(false) to resume player input
 */
export abstract class HeroEntity extends CombatEntity {
  /**
   * Other heroes in the scene — useful for support AI that guards or heals
   * allies (e.g. Lund choosing the most wounded ally to stay near).
   * Set by the scene via setAllies() and readable inside buildTree() closures.
   */
  protected allies: HeroEntity[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number, config: HeroConfig) {
    super(scene, x, y, {
      maxHp:            config.maxHp,
      speed:            config.speed,
      aggroRadius:      config.aggroRadius      ?? 350,
      attackDamage:     config.attackDamage     ?? 12,
      meleeRange:       config.meleeRange       ?? 38,
      attackCooldownMs: config.attackCooldownMs ?? 900,
      projectileDamage: config.projectileDamage,
      projectileSpeed:  config.projectileSpeed  ?? 300,
      color:            config.color            ?? 0x4488ff,
      spriteKey:        config.spriteKey,
      spriteScale:      config.spriteScale,
      sightMemoryMs:    config.sightMemoryMs    ?? 4_000,
      hearingRadius:    config.hearingRadius    ?? 280,
    });

    // Heroes start in player-controlled mode so that spawning a hero doesn't
    // immediately engage AI. Call setAutoPlay(true) to hand control to the BT.
    this.setPlayerControlled(true);
  }

  // ── Control mode ────────────────────────────────────────────────────────────

  /**
   * Switch between AI-driven and player-driven control.
   *
   * on=true  → BT ticks each frame; hero pursues enemies autonomously.
   * on=false → BT pauses; scene is responsible for velocity and abilities.
   *
   * Can be toggled mid-game (e.g. for a "companion assist" HUD button).
   */
  setAutoPlay(on: boolean): void {
    this.setPlayerControlled(!on);
  }

  // ── Roster management ────────────────────────────────────────────────────────

  /**
   * Register the enemy roster this hero should fight when in auto-play mode.
   *
   * The hero's BT uses this list to find its nearest target each tick,
   * applying the same sight/hearing/memory logic as enemy AI.
   */
  setEnemies(enemies: CombatEntity[]): void {
    // opponents is protected in CombatEntity — accessible from subclasses.
    this.opponents = enemies;
  }

  /**
   * Register the allied hero roster for support AI.
   *
   * Support heroes (Lund) use this list to locate wounded allies and position
   * near them. Each hero should exclude itself from its own allies list, which
   * this method enforces automatically.
   */
  setAllies(allies: HeroEntity[]): void {
    this.allies = allies.filter(a => a !== this);
  }

  // ── AI behaviour (implemented per hero) ─────────────────────────────────────

  /**
   * Build and return this hero's behavior tree.
   *
   * Called once during construction (from CombatEntity's constructor) and the
   * resulting tree is stored in `this.behaviorTree`. The tree ticks every frame
   * while isAutoPlay is true via CombatEntity.updateBehaviour().
   *
   * Closures inside BtCondition and BtAction may safely reference `this`
   * (the hero) to call ability methods (useBlurDash, usePacify, etc.) or read
   * hero state (speed, hpFraction, allies). They are evaluated lazily on each
   * tick, after the hero is fully constructed.
   *
   * Use `ctx.opponent` for the nearest enemy snapshot, `ctx.moveToward` /
   * `ctx.shootAt` / `ctx.steerAway` / `ctx.orbitAround` for movement and
   * combat actions. For hero-specific abilities that aren't in CombatContext
   * (e.g. useBlurDash, usePrimalRoar), call `this.method()` directly.
   */
  protected abstract buildTree(): BtNode;
}
