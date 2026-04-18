/**
 * AccuracyMath — pure spread-calculation functions with no Phaser dependency.
 *
 * Kept separate from Accuracy.ts so the unit tests can import these without
 * pulling in Phaser (which needs a browser / window).
 *
 * Three factors contribute to the angular spread applied to each shot:
 *
 *   1. RANGE     — farther targets are harder to hit; linear up to RANGE_REFERENCE_PX.
 *   2. MOVEMENT  — a moving shooter is less accurate; normalised to entity top speed.
 *   3. COVER     — target near a wall gets extra spread (see isPartialCover in Accuracy.ts).
 *
 * Typical spread values (rad → rough hit zone at 200 px range vs ~20 px wide target):
 *   Point-blank, still, no cover → ~0.01 rad — nearly certain hit
 *   400 px, still, no cover      → ~0.09 rad — miss chance increases noticeably
 *   400 px, full speed           → ~0.17 rad — poor accuracy
 *   400 px, moving + cover       → ~0.25 rad — very poor
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum spread (rad) at point-blank range while standing still. */
export const SPREAD_MIN_RAD = 0.01;

/** Extra spread (rad) added at maximum normalised range (dist ≥ RANGE_REFERENCE_PX). */
export const SPREAD_RANGE_RAD = 0.08;

/** Distance (px) at which the range factor saturates at 1.0. */
export const RANGE_REFERENCE_PX = 450;

/** Extra spread (rad) added when the shooter is moving at full speed. */
export const SPREAD_MOVE_RAD = 0.08;

/** Extra spread (rad) added when the target has partial cover. */
export const SPREAD_COVER_RAD = 0.08;

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Compute the angular half-width of the spread cone (radians).
 *
 * @param distPx        World-space distance from shooter to target (px).
 * @param speedFraction Shooter speed as fraction of top speed (0 = still, 1 = full).
 * @param inCover       True when target has partial cover (see isPartialCover).
 */
export function calcSpread(
  distPx: number,
  speedFraction: number,
  inCover: boolean,
): number {
  const rangeFactor = Math.min(distPx / RANGE_REFERENCE_PX, 1);
  return (
    SPREAD_MIN_RAD
    + SPREAD_RANGE_RAD * rangeFactor
    + SPREAD_MOVE_RAD  * Math.min(speedFraction, 1)
    + (inCover ? SPREAD_COVER_RAD : 0)
  );
}

/**
 * Apply a uniform random angular perturbation sampled from [−spread, +spread].
 *
 * @param baseAngle Ideal aim direction (atan2 from shooter to target, radians).
 * @param spread    Half-width from `calcSpread`.
 * @returns         Perturbed angle in radians.
 */
export function applySpread(baseAngle: number, spread: number): number {
  const offset = (Math.random() * 2 - 1) * spread;
  return baseAngle + offset;
}
