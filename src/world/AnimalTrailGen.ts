/**
 * AnimalTrailGen — procedural animal trail generation between map POIs (FIL-88).
 *
 * ## Why generate trails instead of hand-authoring them?
 * The three settlements plus zone-boundary markers and secret locations are
 * spread across a 4500×3000 world. Hand-authoring every connecting trail in
 * Level1Paths.ts would require many segments and make it hard to adjust the
 * topology. Generating them from a seed produces natural meanders and stays
 * consistent across runs (same seed → same trail layout).
 *
 * ## How it works
 * For each edge in the trail graph we walk from node A to node B in 80 px steps.
 * At each step we accumulate a "perpendicular jitter" that drifts slowly left/
 * right of the straight line — the same low-frequency wander effect you'd get
 * from a simple 1D noise walk. The result is a sequence of small overlapping
 * 54×54 rectangles that approximate a gently curved dirt path.
 *
 * ## Integration with PathSystem
 * The returned PathSegment[] is spread into the array passed to the PathSystem
 * constructor in GameScene.ts. No changes to PathSystem itself are needed.
 *
 * ## Animal routing
 * Segments are type 'animal' (animalAffinity = 1.0). Ground animals already
 * sample nearby affinity scores when choosing a roam direction, so they
 * automatically prefer these trails without any extra code.
 */

import { mulberry32 } from '../lib/rng';
import type { PathSegment } from './PathSystem';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Distance between segment centres along the path. Smaller = denser coverage. */
const STEP = 80;

/** Width and height of each generated segment (square). Slightly larger than STEP
 *  so consecutive segments overlap and leave no gap in the affinity map. */
const SEG_SIZE = 54;

/** How strongly the perpendicular jitter is damped each step (0–1).
 *  Higher = smoother meanders; lower = more jagged paths. */
const DAMPING = 0.85;

/** Amplitude of the random perpendicular kick added each step (pixels).
 *  At DAMPING=0.85 the maximum steady-state deviation is ≈ NOISE / (1-DAMPING) = 333 px,
 *  but the damped walk will rarely exceed ±50 px in practice over short paths. */
const NOISE = 50;

// ── Trail topology ────────────────────────────────────────────────────────────

/**
 * Fixed map positions used as trail nodes.
 * These match the hand-placed POIs in Level1.ts so generated trails lead
 * naturally between known landmarks.
 */
const NODES = {
  strandviken:  { x:  450, y: 2820 },   // SW coastal hamlet (player spawn)
  zb1:          { x: 1400, y: 1800 },   // zone boundary: shore → forest
  skogsglanten: { x: 2300, y: 1400 },   // central forest village
  secret1:      { x:  750, y: 1600 },   // forest secret location (Vittnesstenen)
  zb2:          { x: 3100, y: 1000 },   // zone boundary: forest → plateau
  klippbyn:     { x: 3900, y:  620 },   // NE plateau hamlet
} as const;

/** Edges in the spanning trail graph. Only plausible routes — not a full mesh. */
const EDGES: ReadonlyArray<[keyof typeof NODES, keyof typeof NODES]> = [
  ['strandviken',  'zb1'],           // SW hamlet up to forest edge
  ['zb1',          'skogsglanten'],  // forest edge into central village
  ['skogsglanten', 'zb2'],           // village out to plateau edge
  ['zb2',          'klippbyn'],      // plateau edge up to NE hamlet
  ['strandviken',  'secret1'],       // branch trail to the forest secret
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate all animal trail segments for the given run seed.
 *
 * The sub-seed `0xaaa71388` is distinct from the rabbit spawn seed (`0xf00d1234`)
 * and the enemy spawn seed (`0xdead1106`) so adjusting one population doesn't
 * shift the trail layout.
 *
 * @param seed  The scene's `runSeed` — same value used for other seeded systems.
 */
export function generateAnimalTrails(seed: number): PathSegment[] {
  const rng = mulberry32(seed ^ 0xaaa71388);
  const out: PathSegment[] = [];

  for (const [aKey, bKey] of EDGES) {
    const a = NODES[aKey];
    const b = NODES[bKey];
    tracePath(a.x, a.y, b.x, b.y, rng, out, `gen-${aKey}-${bKey}`);
  }

  return out;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Walk from (x1,y1) to (x2,y2) in STEP-sized increments, adding a slow
 * perpendicular jitter at each step, and push one PathSegment per step.
 *
 * The jitter is a damped 1D random walk in the direction perpendicular to the
 * line. Starting at 0 (on the straight line) and accumulating:
 *   jitter = jitter * DAMPING + (rng() - 0.5) * NOISE
 * produces a smooth meander rather than white noise.
 */
function tracePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rng: () => number,
  out: PathSegment[],
  idPrefix: string,
): void {
  const dx   = x2 - x1;
  const dy   = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;   // degenerate edge — skip

  const steps = Math.ceil(dist / STEP);
  // Unit perpendicular vector (90° CCW rotation of the direction vector)
  const nx   = -dy / dist;
  const ny   =  dx / dist;
  const half = SEG_SIZE / 2;

  let jitter = 0;
  for (let i = 0; i <= steps; i++) {
    const t  = i / steps;
    jitter   = jitter * DAMPING + (rng() - 0.5) * NOISE;
    const cx = x1 + dx * t + nx * jitter;
    const cy = y1 + dy * t + ny * jitter;

    out.push({
      id:        `${idPrefix}-${i}`,
      type:      'animal',
      x:         Math.round(cx - half),
      y:         Math.round(cy - half),
      w:         SEG_SIZE,
      h:         SEG_SIZE,
      // Slight condition variance makes some stretches look more worn than others
      condition: 80 + Math.floor(rng() * 15),
    });
  }
}
