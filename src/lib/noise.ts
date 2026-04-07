import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';

/**
 * FbmNoise — seeded 2D fractional Brownian motion noise.
 *
 * Backed by simplex-noise v4 (createNoise2D) instead of the old value-noise
 * grid. Simplex noise avoids the axis-aligned grid artifacts that value noise
 * produces at low frequencies, giving smoother and more organic terrain.
 *
 * The public API is identical to the old ValueNoise2D:
 *   - sample(x, y)                 → single-octave value in [0, 1]
 *   - fbm(x, y, octaves, persist)  → multi-octave sum in [0, 1]
 *
 * `simplex-noise` v4 takes a PRNG (() => number) instead of a seed integer,
 * so we thread our mulberry32 generator in directly — the result stays fully
 * deterministic for a given runSeed.
 */
export class FbmNoise {
  private readonly noise2D: (x: number, y: number) => number;

  constructor(seed: number) {
    // mulberry32 returns a () => number closure — exactly what createNoise2D expects.
    this.noise2D = createNoise2D(mulberry32(seed));
  }

  /**
   * Single-octave simplex sample at (x, y).
   * Simplex noise returns [-1, 1]; we remap to [0, 1] to match the old API
   * and keep terrain-color thresholds valid.
   */
  sample(x: number, y: number): number {
    return (this.noise2D(x, y) + 1) * 0.5;
  }

  /**
   * Fractional Brownian Motion — sums octaves for richer terrain detail.
   * @param octaves      Number of noise layers (4–6 works well for terrain)
   * @param persistence  Amplitude multiplier per octave (0.5 = halves each layer)
   */
  fbm(x: number, y: number, octaves = 4, persistence = 0.5): number {
    let value     = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue  = 0;

    for (let i = 0; i < octaves; i++) {
      value    += this.sample(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude  *= persistence;
      frequency  *= 2;
    }

    return value / maxValue;
  }
}

/**
 * @deprecated Use FbmNoise. This alias exists only to ease migration of any
 * code that still imports ValueNoise2D by name.
 */
export const ValueNoise2D = FbmNoise;
