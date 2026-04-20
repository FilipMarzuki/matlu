/**
 * Dustling — tiny dust-mote enemy that swarms in a coordinated boid flock.
 *
 * 20 instances are spawned together in Mistheim. Each one calls
 * SwarmBrain.steer() every frame, adds the result to its current velocity,
 * then clamps to max speed. A gentle player-chase force keeps the cloud
 * tethered to the action while boids rules (separation/alignment/cohesion)
 * prevent the swarm from collapsing into a single dot or flying apart.
 *
 * Swarm effects (dark overlay + 40% spell miss) are driven by GameScene
 * reading `Dustling.getLiveSwarm().length > 0`.
 *
 * AoE damage: `Dustling.aoeKill(cx, cy, radius)` kills all live members
 * within the given world radius in one pass — call it from the player's
 * melee/ranged AoE handlers.
 */

import * as Phaser from 'phaser';
import { Enemy } from './Enemy';
import { SwarmBrain, BASE_WEIGHTS, BoidsNeighbour } from './SwarmBrain';

const SPEED           = 75;
const BODY_COLOR      = 0x9966cc;
const BODY_RADIUS     = 5;
// Neighbours further than this are ignored (caps CPU cost for large swarms).
const NEIGHBOUR_RADIUS = 180;

// Module-level registry — every live Dustling registers here on construction
// and de-registers on death. Never exported; queried via static methods.
const _registry: Dustling[] = [];

// Shared player-position getter — set once by the spawning scene so all
// Dustlings drift toward the player without importing GameScene.
let _getPlayerPos: () => { x: number; y: number } = () => ({ x: 0, y: 0 });

export class Dustling extends Enemy {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:        1,
      speed:        SPEED,
      aggroRadius:  0,  // no individual aggro — swarm movement only
      attackDamage: 5,
    });

    // Small purple dust mote — visually distinct from rabbits (beige) and wisps (magenta).
    const dot = scene.add.arc(0, 0, BODY_RADIUS, 0, 360, false, BODY_COLOR);
    this.add(dot);

    _registry.push(this);
  }

  // ── Static swarm API ────────────────────────────────────────────────────────

  /**
   * Set the shared player-position getter for the whole swarm.
   * Call once from GameScene before spawning.
   */
  static setPlayerGetter(fn: () => { x: number; y: number }): void {
    _getPlayerPos = fn;
  }

  /** Read-only view of all live Dustlings. */
  static getLiveSwarm(): readonly Dustling[] {
    return _registry;
  }

  /**
   * Instantly kill every live Dustling within `radius` px of (cx, cy).
   * Snapshots the list first so registry mutations during iteration are safe.
   * Returns the number killed.
   */
  static aoeKill(cx: number, cy: number, radius: number): number {
    const toKill = _registry.filter(d => {
      const dx = d.x - cx;
      const dy = d.y - cy;
      return Math.sqrt(dx * dx + dy * dy) <= radius;
    });
    for (const d of toKill) d.takeDamage(d.maxHp);
    return toKill.length;
  }

  /**
   * Clear the registry — call from GameScene when the scene shuts down or
   * resets so stale references don't bleed into the next session.
   */
  static clearRegistry(): void {
    _registry.length = 0;
  }

  // ── Enemy behaviour ─────────────────────────────────────────────────────────

  protected override updateBehaviour(_delta: number): void {
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!physBody) return;

    const player = _getPlayerPos();

    // Gentle drift toward the player — keeps the cloud tethered to the action.
    // At 30 % of base speed it's slower than the player so skilled movement can
    // escape the swarm; the boids steering then adds the group-aware deviation.
    const pdx  = player.x - this.x;
    const pdy  = player.y - this.y;
    const pLen = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
    const driftVx = (pdx / pLen) * this.speed * 0.3;
    const driftVy = (pdy / pLen) * this.speed * 0.3;

    // Build neighbour snapshots from live registry (skip self).
    const neighbours: BoidsNeighbour[] = [];
    for (const other of _registry) {
      if ((other as unknown) === (this as unknown)) continue;
      const dx   = other.x - this.x;
      const dy   = other.y - this.y;
      if (Math.sqrt(dx * dx + dy * dy) > NEIGHBOUR_RADIUS) continue;
      const ob = other.body as Phaser.Physics.Arcade.Body | undefined;
      neighbours.push({ x: other.x, y: other.y, vx: ob?.velocity.x ?? 0, vy: ob?.velocity.y ?? 0 });
    }

    const impulse = SwarmBrain.steer(this.x, this.y, this.speed, neighbours, BASE_WEIGHTS);

    // Small per-frame jitter breaks symmetry when many Dustlings start
    // from the same position — same technique as CombatEntity.applySwarmForce().
    const jx = (Math.random() - 0.5) * 5;
    const jy = (Math.random() - 0.5) * 5;

    // Add drift + boids impulse to current velocity (impulse is in px/s units).
    const cv    = physBody.velocity;
    const rawVx = cv.x + driftVx + impulse.vx + jx;
    const rawVy = cv.y + driftVy + impulse.vy + jy;

    // Clamp to 1.5× speed — boids and drift combined should never overwhelm
    // the max speed entirely or the swarm feels physics-glitchy.
    const spd    = Math.sqrt(rawVx * rawVx + rawVy * rawVy);
    const maxSpd = this.speed * 1.5;
    if (spd > maxSpd) {
      physBody.setVelocity((rawVx / spd) * maxSpd, (rawVy / spd) * maxSpd);
    } else {
      physBody.setVelocity(rawVx, rawVy);
    }
  }

  // ── LivingEntity hook ───────────────────────────────────────────────────────

  protected override onDeath(): void {
    // De-register before destroy() so neighbour queries immediately see correct count.
    const idx = _registry.indexOf(this);
    if (idx !== -1) _registry.splice(idx, 1);

    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    physBody?.setVelocity(0, 0);

    // Small purple particle burst.
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const dot = this.scene.add.arc(this.x, this.y, 3, 0, 360, false, BODY_COLOR);
      dot.setDepth(this.depth + 1);
      this.scene.tweens.add({
        targets:    dot,
        x:          this.x + Math.cos(angle) * 18,
        y:          this.y + Math.sin(angle) * 18,
        alpha:      { from: 1, to: 0 },
        duration:   180,
        ease:       'Cubic.easeOut',
        onComplete: () => dot.destroy(),
      });
    }

    this.destroy();
  }
}
