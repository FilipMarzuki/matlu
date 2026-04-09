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

  /**
   * Domain-warped fBm — offsets the sample coordinate by another noise layer
   * before sampling, producing organic "fjord-like" irregularity at biome borders.
   *
   * Instead of sampling noise at (x, y), we sample at (x + ox, y + oy) where
   * ox and oy are themselves noise values. This causes the biome boundaries to
   * fold and warp in on themselves, eliminating the mathematically clean look of
   * unwarped fBm terrain.
   *
   * The +5.2 / +1.3 phase offsets ensure ox and oy are uncorrelated — without
   * them both would be derived from the same gradient field and the warp would
   * push points in a uniform direction rather than randomly.
   *
   * @param warpAmp   Warp amplitude — how far the sample point is displaced.
   *                  0.04 is subtle (gentle coast roughness); 0.10 is dramatic (fjords).
   * @param warpFreq  Frequency of the warp noise. Higher = finer warp detail.
   */
  warped(
    x: number, y: number,
    octaves = 4, persistence = 0.5,
    warpAmp = 0.04, warpFreq = 0.15,
  ): number {
    // Two low-octave noise samples give independent X and Y displacement.
    const ox = this.fbm(x * warpFreq,          y * warpFreq,          2, 0.5) * warpAmp;
    const oy = this.fbm((x + 5.2) * warpFreq,  (y + 1.3) * warpFreq,  2, 0.5) * warpAmp;
    return this.fbm(x + ox, y + oy, octaves, persistence);
  }
}

/**
 * @deprecated Use FbmNoise. This alias exists only to ease migration of any
 * code that still imports ValueNoise2D by name.
 */
export const ValueNoise2D = FbmNoise;
