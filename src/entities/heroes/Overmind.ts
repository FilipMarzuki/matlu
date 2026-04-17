import * as Phaser from 'phaser';
import { LivingEntity } from '../LivingEntity';
import {
  SwarmBrain,
  BASE_WEIGHTS,
  PANIC_WEIGHTS,
  SwarmWeights,
  BoidsNeighbour,
} from '../SwarmBrain';

// ── Constants ─────────────────────────────────────────────────────────────────

const BOID_COUNT           = 200;
const BOID_RADIUS          = 3;     // visual size (px) of each boid arc
const BOID_SPEED           = 90;    // base speed in px/s
const MAX_NEIGHBOURS       = 7;     // mirrors the cap in SwarmBrain.ts line 54
const SPAWN_SCATTER_RADIUS = 60;    // initial cluster radius around spawn point
const REDISTRIBUTE_RADIUS  = 300;   // swarm teleports within this distance of current centre
const REDISTRIBUTE_HP_FRAC = 0.30;  // HP fraction restored after first death
const PANIC_DURATION_MS    = 2000;  // ms of PANIC_WEIGHTS during redistribute burst

// ── Internal types ─────────────────────────────────────────────────────────────

interface BoidData {
  sprite: Phaser.GameObjects.Arc;
  vx:     number;
  vy:     number;
}

// ── Overmind ──────────────────────────────────────────────────────────────────

/**
 * Overmind — Tier 5 distributed-swarm hero.
 *
 * Unlike single-body entities, the Overmind is rendered as 200 small boid
 * sprites moving in coordination via SwarmBrain.steer() (Reynolds boids).
 * Collective HP is tracked on this container; individual boids fade out
 * visually as HP drops, but are kept in the array so neighbour counts remain
 * stable and the swarm doesn't fragment prematurely.
 *
 * Redistribute mechanic:
 *   - First onDeath(): reset to 30% HP, teleport swarm ≤300 px, enter panic.
 *   - Second onDeath(): all boids fade out and the entity is destroyed.
 *
 * Physics: boids are moved manually (x/y integration) rather than via Arcade
 * physics to keep the physics body count low. The container's (x, y) tracks the
 * swarm's centre of mass each frame for external collision/targeting use.
 */
export class Overmind extends LivingEntity {
  private readonly boids:  BoidData[];
  private readonly group:  Phaser.GameObjects.Group;
  private currentWeights:  SwarmWeights;
  private panicTimer = 0;
  /** true after the first onDeath — second onDeath is the permanent kill. */
  private redistribute = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, { maxHp: 500 });

    this.currentWeights = { ...BASE_WEIGHTS };
    this.boids = [];
    this.group = scene.add.group();

    // Spawn boids clustered around the starting position with random jitter.
    // Small random initial velocities ensure boids don't start in perfect lock-step.
    for (let i = 0; i < BOID_COUNT; i++) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = Math.random() * SPAWN_SCATTER_RADIUS;
      const bx = x + Math.cos(angle) * radius;
      const by = y + Math.sin(angle) * radius;
      const arc = scene.add.arc(bx, by, BOID_RADIUS, 0, 360, false, 0x88ffaa);
      arc.setDepth(5);
      this.group.add(arc);
      this.boids.push({
        sprite: arc,
        vx: (Math.random() - 0.5) * BOID_SPEED,
        vy: (Math.random() - 0.5) * BOID_SPEED,
      });
    }
  }

  // ── Entity hook ────────────────────────────────────────────────────────────

  override update(delta: number): void {
    if (!this.isAlive) return;

    const dt = delta / 1000; // convert ms → seconds for position integration

    // Lerp swarm weights from PANIC back to BASE as the panic timer drains.
    // At t=1 weights equal PANIC_WEIGHTS; at t=0 they equal BASE_WEIGHTS.
    if (this.panicTimer > 0) {
      this.panicTimer = Math.max(0, this.panicTimer - delta);
      const t = this.panicTimer / PANIC_DURATION_MS;
      this.currentWeights.separation = PANIC_WEIGHTS.separation * t + BASE_WEIGHTS.separation * (1 - t);
      this.currentWeights.alignment  = PANIC_WEIGHTS.alignment  * t + BASE_WEIGHTS.alignment  * (1 - t);
      this.currentWeights.cohesion   = PANIC_WEIGHTS.cohesion   * t + BASE_WEIGHTS.cohesion   * (1 - t);
    }

    // O(n × MAX_NEIGHBOURS) neighbour sampling — stride evenly through the boid
    // array instead of scanning all 200 per boid, which would be O(n²).
    // Each boid sees MAX_NEIGHBOURS peers spread across the swarm, giving enough
    // alignment and cohesion signal without a full distance sort.
    const step = Math.max(1, Math.floor(this.boids.length / MAX_NEIGHBOURS));

    for (let i = 0; i < this.boids.length; i++) {
      const boid = this.boids[i];

      const neighbours: BoidsNeighbour[] = [];
      for (let k = 1; k <= MAX_NEIGHBOURS; k++) {
        const j = (i + k * step) % this.boids.length;
        if (j === i) continue;
        const nb = this.boids[j];
        neighbours.push({ x: nb.sprite.x, y: nb.sprite.y, vx: nb.vx, vy: nb.vy });
      }

      const impulse = SwarmBrain.steer(
        boid.sprite.x, boid.sprite.y, BOID_SPEED, neighbours, this.currentWeights,
      );

      // Add steering impulse to current velocity and clamp to 2× base speed
      boid.vx += impulse.vx * dt;
      boid.vy += impulse.vy * dt;
      const spd = Math.sqrt(boid.vx * boid.vx + boid.vy * boid.vy);
      if (spd > BOID_SPEED * 2) {
        const s = (BOID_SPEED * 2) / spd;
        boid.vx *= s;
        boid.vy *= s;
      }

      // Euler integration — simple and sufficient at 60 fps
      boid.sprite.x += boid.vx * dt;
      boid.sprite.y += boid.vy * dt;
    }

    // Keep the Container position at the swarm's centre of mass.
    // External systems (collision, targeting) use this container's x/y.
    let cx = 0, cy = 0;
    for (const b of this.boids) { cx += b.sprite.x; cy += b.sprite.y; }
    this.setPosition(cx / this.boids.length, cy / this.boids.length);

    this.updateBoidVisuals();
  }

  // ── LivingEntity hook ──────────────────────────────────────────────────────

  /**
   * Redistribute mechanic — overrides the default destroy-on-death behaviour.
   *
   * First call: restore HP, teleport, spike to PANIC_WEIGHTS.
   * Second call: fade all boids and destroy the entity.
   *
   * Note: LivingEntity.takeDamage() sets this.dead = true before calling here.
   * We reset it to false on the first call so subsequent hits are processed.
   */
  protected override onDeath(): void {
    if (!this.redistribute) {
      // ── First death: redistribute ───────────────────────────────────────────
      this.redistribute = true;
      this.dead = false;                                      // allow future damage
      this.hp   = Math.ceil(this.maxHp * REDISTRIBUTE_HP_FRAC);

      // Teleport the swarm centre to a random point 150–300 px away
      const angle   = Math.random() * Math.PI * 2;
      const dist    = REDISTRIBUTE_RADIUS * (0.5 + Math.random() * 0.5);
      const newCx   = this.x + Math.cos(angle) * dist;
      const newCy   = this.y + Math.sin(angle) * dist;
      const offsetX = newCx - this.x;
      const offsetY = newCy - this.y;

      for (const b of this.boids) {
        b.sprite.x += offsetX;
        b.sprite.y += offsetY;
        // Restore alpha — boids that were cosmetically dimmed come back alive.
        // The HP fraction is now 30%, so updateBoidVisuals will dim ~70% again,
        // but a brief flash of "full swarm" before that reinforces the teleport.
        b.sprite.setAlpha(1);
      }
      this.setPosition(newCx, newCy);

      // Spike weights — boids scatter chaotically during the burst phase
      this.panicTimer     = PANIC_DURATION_MS;
      this.currentWeights = { ...PANIC_WEIGHTS };

      // Visual burst at the new centre to telegraph the teleport
      this.emitBurst(newCx, newCy, 0x88ffaa, 12, 55);
    } else {
      // ── Second death: truly die ─────────────────────────────────────────────
      for (const b of this.boids) {
        this.scene.tweens.add({
          targets:  b.sprite,
          alpha:    0,
          duration: 600,
          ease:     'Cubic.easeIn',
          onComplete: () => b.sprite.destroy(),
        });
      }
      // Clear group references (does not destroy children — tweens handle that)
      this.group.clear();
      this.destroy();
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Adjust boid alpha proportional to current HP fraction.
   * Boids are never removed from the array — only their alpha changes — so
   * the neighbour pool stays at 200 and the swarm doesn't fragment unnaturally.
   */
  private updateBoidVisuals(): void {
    const visibleCount = Math.ceil(this.hpFraction * this.boids.length);
    for (let i = 0; i < this.boids.length; i++) {
      const boid    = this.boids[i];
      const visible = i < visibleCount;
      if (visible && boid.sprite.alpha < 0.5) {
        boid.sprite.setAlpha(1);
      } else if (!visible && boid.sprite.alpha > 0.1) {
        // Dim rather than hide — preserves rendering while signalling "death"
        boid.sprite.setAlpha(0.05);
      }
    }
  }

  /**
   * Radial burst effect — `count` arcs fan outward from (x, y) and fade.
   * Used to signal the redistribute teleport visually.
   */
  private emitBurst(x: number, y: number, color: number, count: number, radius: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dot = this.scene.add.arc(x, y, 4, 0, 360, false, color);
      dot.setDepth(10);
      this.scene.tweens.add({
        targets:  dot,
        x:        x + Math.cos(angle) * radius,
        y:        y + Math.sin(angle) * radius,
        alpha:    { from: 1, to: 0 },
        duration: 400,
        ease:     'Cubic.easeOut',
        onComplete: () => dot.destroy(),
      });
    }
  }
}
