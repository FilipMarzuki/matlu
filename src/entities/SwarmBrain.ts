/**
 * SwarmBrain — stateless boids steering calculator.
 *
 * All logic lives in static methods so any number of entities can call steer()
 * each frame without allocating a per-instance brain object.
 *
 * Three forces (Craig Reynolds, 1986):
 *   Separation — repel neighbours closer than SEPARATION_RADIUS
 *   Alignment  — match the average neighbour heading
 *   Cohesion   — steer toward the group centre of mass
 *
 * Weights tune the swarm personality. Insect swarms want high separation,
 * medium cohesion, low alignment — they group loosely and scatter fast.
 *
 * Usage in CombatEntity.tickSwarm():
 *   const steer = SwarmBrain.steer(selfX, selfY, selfVx, selfVy, neighbours, weights);
 *   physBody.setVelocity(physBody.velocity.x + steer.vx, ...);
 */

// ── Weights ───────────────────────────────────────────────────────────────────

/** Per-entity boids weights — determines swarm personality. */
export interface SwarmWeights {
  /** How strongly to push away from close neighbours. High = scatter. */
  separation: number;
  /** How strongly to match average neighbour velocity. Low for insects. */
  alignment: number;
  /** How strongly to steer toward the group centre of mass. */
  cohesion: number;
}

/** Default weights for idle/engaging swarm behaviour — loose insect grouping. */
export const BASE_WEIGHTS: SwarmWeights = {
  separation: 1.2,
  alignment:  0.3,
  cohesion:   0.5,
};

/**
 * Panic weights — triggered by a nearby death or loud sound event.
 * Separation spikes so enemies burst outward; cohesion drops so the
 * group disintegrates. Weights lerp back to BASE over ~3 seconds.
 */
export const PANIC_WEIGHTS: SwarmWeights = {
  separation: 3.0,
  alignment:  0.0,
  cohesion:   0.1,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/** Distance in px below which the separation force activates. */
const SEPARATION_RADIUS = 40;

/**
 * Max contribution (px/s) any single force component can add per tick.
 * Prevents runaway acceleration when many neighbours overlap.
 */
const MAX_STEER = 80;

// ── Neighbour data ────────────────────────────────────────────────────────────

/** Minimal snapshot of a neighbour — avoids direct CombatEntity dependency. */
export interface NeighbourData {
  x:  number;
  y:  number;
  vx: number;
  vy: number;
}

// ── SwarmBrain ────────────────────────────────────────────────────────────────

export class SwarmBrain {
  /**
   * Compute a boids steering velocity adjustment for one entity.
   *
   * @param selfX      Entity world X
   * @param selfY      Entity world Y
   * @param selfVx     Entity current velocity X (px/s)
   * @param selfVy     Entity current velocity Y (px/s)
   * @param neighbours Pre-filtered alive neighbours within query radius (≤7)
   * @param weights    Current swarm personality weights
   * @returns { vx, vy } — velocity delta to blend into the entity's body
   */
  static steer(
    selfX: number,
    selfY: number,
    selfVx: number,
    selfVy: number,
    neighbours: ReadonlyArray<NeighbourData>,
    weights: SwarmWeights,
  ): { vx: number; vy: number } {
    if (neighbours.length === 0) return { vx: 0, vy: 0 };

    // ── Separation ───────────────────────────────────────────────────────────
    // For each neighbour inside SEPARATION_RADIUS, push away with a force that
    // grows stronger as they get closer — prevents clustering and overlap.
    let sepX = 0;
    let sepY = 0;
    let sepCount = 0;
    for (const n of neighbours) {
      const dx = selfX - n.x;
      const dy = selfY - n.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < SEPARATION_RADIUS * SEPARATION_RADIUS && d2 > 0.01) {
        const d = Math.sqrt(d2);
        // Force proportional to (radius - distance): strongest at d=0, zero at d=radius.
        sepX += (dx / d) * (SEPARATION_RADIUS - d);
        sepY += (dy / d) * (SEPARATION_RADIUS - d);
        sepCount++;
      }
    }
    if (sepCount > 0) { sepX /= sepCount; sepY /= sepCount; }

    // ── Alignment ────────────────────────────────────────────────────────────
    // Steer toward the average neighbour velocity — a gentle heading match.
    // Scale factor 0.05 keeps it a nudge rather than a hard redirect.
    let avgVx = 0;
    let avgVy = 0;
    for (const n of neighbours) { avgVx += n.vx; avgVy += n.vy; }
    avgVx /= neighbours.length;
    avgVy /= neighbours.length;
    const alignX = (avgVx - selfVx) * 0.05;
    const alignY = (avgVy - selfVy) * 0.05;

    // ── Cohesion ─────────────────────────────────────────────────────────────
    // Steer toward the centre of mass of the group.
    // Scale factor 0.01 keeps the pull subtle — insects group loosely.
    let cmX = 0;
    let cmY = 0;
    for (const n of neighbours) { cmX += n.x; cmY += n.y; }
    cmX /= neighbours.length;
    cmY /= neighbours.length;
    const cohX = (cmX - selfX) * 0.01;
    const cohY = (cmY - selfY) * 0.01;

    // ── Combine and clamp ────────────────────────────────────────────────────
    return {
      vx: clamp(
        sepX * weights.separation + alignX * weights.alignment + cohX * weights.cohesion,
        -MAX_STEER,
        MAX_STEER,
      ),
      vy: clamp(
        sepY * weights.separation + alignY * weights.alignment + cohY * weights.cohesion,
        -MAX_STEER,
        MAX_STEER,
      ),
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
