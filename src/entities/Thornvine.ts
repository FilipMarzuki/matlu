/**
 * Thornvine — immobile plant that grabs and immobilises the nearest hero.
 *
 * ## Behaviour
 * Thornvine never moves (speed = 0). Each frame it checks whether its tracked
 * opponent is within GRAB_R px. On contact it:
 *   1. Sets `opponent.isStunned = true` so the hero's behaviour tree stops.
 *   2. Zeroes the hero's physics velocity (and keeps it zeroed while held).
 *   3. Shows a green vine-wrap arc centered on the hero.
 *
 * Only one grab is active at a time. If the hero escapes range (unlikely since
 * they're frozen) or the hero dies, the grab is automatically released.
 *
 * ## Release
 * `onDeath()` releases the grab **before** calling `super.onDeath()` so
 * `this.grabbedHero` is still valid when the cleanup runs.
 *
 * ## Why CombatEntity, not Enemy?
 * CombatEntity has `findNearestLivingOpponent()` and the `setOpponent()` API
 * used by the arena wave spawner — both needed for grab targeting. Thornvine
 * uses `buildTree()` only as the hook to run its grab check; the tree itself
 * is a single action that always returns 'running'.
 */

import * as Phaser from 'phaser';
import { CombatEntity, CombatEntityConfig } from './CombatEntity';
import { BtNode, BtAction } from '../ai/BehaviorTree';

// ── Config ──────────────────────────────────────────────────────────────────

/** px — must be within this radius to trigger a grab. */
const GRAB_R = 40;

/** Thornvine body — dark green bark. */
const COLOR_BODY   = 0x2d5a1b;
/** Vine-wrap overlay on the grabbed hero — bright poison green. */
const COLOR_VINE   = 0x4caf50;
/** Vine-wrap arc radius in pixels. */
const VINE_R       = 14;

// ── Thornvine ────────────────────────────────────────────────────────────────

export class Thornvine extends CombatEntity {
  /** The hero currently immobilised, or null if no active grab. */
  private grabbedHero: CombatEntity | null = null;
  /** World-space arc shown around the grabbed hero. */
  private vineGraphic: Phaser.GameObjects.Arc | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const config: CombatEntityConfig = {
      maxHp:            70,
      speed:            0,     // immobile — never moves
      aggroRadius:      GRAB_R,
      attackDamage:     0,     // no direct damage — grab only
      color:            COLOR_BODY,
      meleeRange:       GRAB_R,
      attackCooldownMs: 9999,  // BT melee attack is unused; grab is handled manually
    };
    super(scene, x, y, config);

    // Wider, squatter body to suggest a rooted plant form.
    // The default CombatEntity rect is already added; override its size.
    // (bodyRect is the protected placeholder created by CombatEntity.)
  }

  // ── Behavior tree ──────────────────────────────────────────────────────────

  /**
   * Thornvine's tree is a single always-running action. All grab logic lives
   * in `updateBehaviour` (called by the BT each frame). The tree structure is
   * minimal because Thornvine has no movement, attack, or wander states.
   */
  protected override buildTree(): BtNode {
    return new BtAction(_ctx => {
      this.tickGrab();
      return 'running';
    });
  }

  // ── Grab logic ─────────────────────────────────────────────────────────────

  /**
   * Called every frame from the BT action.
   * – If not grabbing: check distance to nearest living opponent.
   * – If grabbing: keep the hero frozen and sync the vine graphic.
   */
  private tickGrab(): void {
    if (this.grabbedHero !== null) {
      // Keep the grabbed hero frozen while Thornvine is alive.
      if (!this.grabbedHero.isAlive) {
        // Hero died while grabbed — release cleanly.
        this.releaseGrab();
        return;
      }
      const body = this.grabbedHero.body as Phaser.Physics.Arcade.Body | undefined;
      body?.setVelocity(0, 0);
      // Sync vine visual to hero's world position.
      if (this.vineGraphic) {
        this.vineGraphic.setPosition(this.grabbedHero.x, this.grabbedHero.y);
      }
      return;
    }

    // Not grabbing — check for a hero within grab range.
    const opp = this.findNearestLivingOpponent();
    if (!opp) return;
    const d = Phaser.Math.Distance.Between(this.x, this.y, opp.x, opp.y);
    if (d > GRAB_R) return;

    this.applyGrab(opp);
  }

  private applyGrab(hero: CombatEntity): void {
    this.grabbedHero   = hero;
    hero.isStunned     = true;

    // Zero hero velocity immediately so they stop on the same frame.
    const body = hero.body as Phaser.Physics.Arcade.Body | undefined;
    body?.setVelocity(0, 0);

    // Spawn vine-wrap circle in world space (depth above hero).
    this.vineGraphic = this.scene.add.arc(
      hero.x, hero.y,
      VINE_R, 0, 360, false, COLOR_VINE,
    );
    this.vineGraphic.setAlpha(0.65);
    this.vineGraphic.setDepth(hero.depth + 1);
    this.vineGraphic.setStrokeStyle(3, COLOR_VINE);
    this.vineGraphic.setFillStyle(0x000000, 0);  // outline only, transparent fill
  }

  private releaseGrab(): void {
    if (this.grabbedHero) {
      this.grabbedHero.isStunned = false;
      this.grabbedHero = null;
    }
    if (this.vineGraphic) {
      this.vineGraphic.destroy();
      this.vineGraphic = null;
    }
  }

  // ── Death ───────────────────────────────────────────────────────────────────

  /**
   * Release any active grab BEFORE calling super.onDeath(), which calls
   * destroy() and nullifies this entity — accessing fields after that is unsafe.
   */
  protected override onDeath(): void {
    this.releaseGrab();
    super.onDeath();
  }
}
