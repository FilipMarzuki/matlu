/**
 * CorruptionField — 2D noise-driven local corruption intensity.
 *
 * ## Why a field instead of a scalar?
 * A single corruption value per zone makes the whole zone darken uniformly —
 * no safe pockets, no interesting navigation. A 2D noise field means corruption
 * has geography: dark tendrils, relatively safe clearings, organic spread.
 * Players learn to read the landscape and route through lighter patches.
 *
 * ## Domain warping
 * Before sampling the base noise we warp the coordinates using a second noise
 * layer. This folds and twists the corruption patches into irregular, organic
 * shapes rather than smooth blobs. The warp offset (120 px) controls how
 * dramatically the field is distorted — 0 = smooth blobs, 200+ = fractal chaos.
 *
 * ## Usage
 *   const field = new CorruptionField(runSeed);
 *   // In update loop, get local intensity at player position:
 *   const local = field.sample(player.x, player.y, globalCorruption01);
 *
 * `globalCorruption` is a 0–1 scalar (e.g. 1 − cleansePercent/100). When it
 * is 0 the whole field returns 0 regardless of noise, so the world starts clean.
 */

import { FbmNoise } from '../lib/noise';

/** Spatial frequency of the corruption patches. Lower = larger blobs. */
const SCALE = 0.04;
/** How strongly coordinates are warped before the final sample. */
const WARP_STRENGTH = 120;

export class CorruptionField {
  private readonly noise: FbmNoise;

  constructor(seed: number) {
    // XOR with a constant so the corruption field is independent of terrain noise
    // (both use FbmNoise but with different seeds — different internal PRNG state).
    this.noise = new FbmNoise(seed ^ 0xdeadbeef);
  }

  /**
   * Local corruption intensity at world position (wx, wy).
   *
   * @param globalCorruption  0–1 scalar from WorldState (0 = fully cleansed, 1 = max corruption)
   * @returns                 0–~0.9 — multiply by 100 for a percentage, or use directly as tint alpha
   *
   * Returns 0 whenever globalCorruption is 0, so the world starts clean.
   * Peak is capped at ~0.9 because the domain warp can amplify noise slightly
   * beyond its nominal [0,1] range — Math.min ensures no caller gets > 0.9.
   */
  sample(wx: number, wy: number, globalCorruption: number): number {
    if (globalCorruption <= 0) return 0;

    // Domain warp: offset the sample coordinates by a low-frequency noise layer.
    // This gives corruption patches an irregular, tendril-like shape instead of
    // smooth circular blobs. The two warp components use offset constants (0, 5.2)
    // to keep them uncorrelated — a standard trick from Inigo Quilez's domain warping.
    const halfScale = SCALE * 0.5;
    const warpX = this.noise.fbm(wx * halfScale,       wy * halfScale)       * WARP_STRENGTH;
    const warpY = this.noise.fbm(wx * halfScale + 5.2, wy * halfScale + 3.7) * WARP_STRENGTH;

    const raw = this.noise.fbm((wx + warpX) * SCALE, (wy + warpY) * SCALE, 3);

    // Scale by global corruption — when the world is 50% cleansed, local intensity
    // is at most 0.5 even in the darkest patches.
    return Math.min(0.9, raw * globalCorruption);
  }
}
