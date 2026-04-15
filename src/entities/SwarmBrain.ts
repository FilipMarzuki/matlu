/**
 * SwarmBrain — stateless boids steering calculator.
 *
 * Implements the three Reynolds boids rules:
 *   - Separation: push away from neighbours that are too close
 *   - Alignment:  match the heading of nearby neighbours
 *   - Cohesion:   steer toward the centre of mass of the group
 *
 * The three weight values control swarm personality. High separation +
 * low cohesion = scattered insects; equal weights = tight flock.
 *
 * Call `steer()` once per entity per frame (or every N frames and cache the
 * result). The output is a velocity addend in px/s — add it to the entity's
 * current velocity, then clamp to max speed.
 */

/** Weights for the three boids rules. Mutable so panic can spike separation. */
export interface SwarmWeights {
  separation: number;
  alignment:  number;
  cohesion:   number;
}

/** Default weights — insect swarm feel: strong separation, moderate cohesion. */
export const BASE_WEIGHTS: SwarmWeights = {
  separation: 1.4,
  alignment:  0.4,
  cohesion:   0.6,
};

/**
 * Panic weights — triggered by gunshots or nearby deaths.
 * Separation spikes so the swarm scatters; cohesion collapses.
 * Lerped back toward BASE_WEIGHTS as panicTimer expires.
 */
export const PANIC_WEIGHTS: SwarmWeights = {
  separation: 3.5,
  alignment:  0.0,
  cohesion:   0.05,
};

/** Snapshot of a neighbour's position and velocity — read-only from each entity's POV. */
export interface BoidsNeighbour {
  x:  number;
  y:  number;
  vx: number;
  vy: number;
}

/** Separation only activates within this radius (px). */
const SEPARATION_RADIUS = 40;

/** Maximum neighbours considered — caps CPU cost for large swarms. */
const MAX_NEIGHBOURS = 7;

export class SwarmBrain {
  /**
   * Compute a boids steering impulse for one entity.
   *
   * @param sx        Self position X (px)
   * @param sy        Self position Y (px)
   * @param speed     Entity base speed (px/s) — used to scale output forces
   * @param neighbours Pre-filtered nearby entities (at most MAX_NEIGHBOURS used)
   * @param weights   Current weight set (base or panic)
   * @returns         { vx, vy } velocity addend in px/s
   */
  static steer(
    sx:         number,
    sy:         number,
    speed:      number,
    neighbours: BoidsNeighbour[],
    weights:    SwarmWeights,
  ): { vx: number; vy: number } {
    const n = Math.min(neighbours.length, MAX_NEIGHBOURS);
    if (n === 0) return { vx: 0, vy: 0 };

    // Accumulate per-rule vectors
    let sepX = 0, sepY = 0, sepCount = 0;
    let aliX = 0, aliY = 0;
    let cohX = 0, cohY = 0;

    for (let i = 0; i < n; i++) {
      const nb = neighbours[i];

      // ── Separation ────────────────────────────────────────────────────────
      const dx   = sx - nb.x;
      const dy   = sy - nb.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < SEPARATION_RADIUS && dist > 0) {
        // Linear falloff: full push at overlap, zero at SEPARATION_RADIUS edge.
        const t = 1 - dist / SEPARATION_RADIUS;
        sepX += (dx / dist) * t;
        sepY += (dy / dist) * t;
        sepCount++;
      }

      // ── Alignment: accumulate neighbour velocities ─────────────────────
      aliX += nb.vx;
      aliY += nb.vy;

      // ── Cohesion: accumulate neighbour positions for centre-of-mass ───
      cohX += nb.x;
      cohY += nb.y;
    }

    let outVx = 0;
    let outVy = 0;

    // Apply separation force
    if (sepCount > 0 && weights.separation > 0) {
      const len = Math.sqrt(sepX * sepX + sepY * sepY) || 1;
      outVx += (sepX / len) * speed * weights.separation;
      outVy += (sepY / len) * speed * weights.separation;
    }

    // Apply alignment force (steer toward average neighbour heading)
    if (weights.alignment > 0) {
      const len = Math.sqrt(aliX * aliX + aliY * aliY) || 1;
      outVx += (aliX / len) * speed * weights.alignment;
      outVy += (aliY / len) * speed * weights.alignment;
    }

    // Apply cohesion force (steer toward centre of mass)
    if (weights.cohesion > 0) {
      const cmx = cohX / n - sx;
      const cmy = cohY / n - sy;
      const len = Math.sqrt(cmx * cmx + cmy * cmy) || 1;
      outVx += (cmx / len) * speed * weights.cohesion;
      outVy += (cmy / len) * speed * weights.cohesion;
    }

    return { vx: outVx, vy: outVy };
  }
}
