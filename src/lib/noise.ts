import { mulberry32 } from './rng';

const GRID = 64; // must be a power of 2

/**
 * 2D value noise with fractional Brownian motion (fBm) support.
 * Fully deterministic given the same seed.
 */
export class ValueNoise2D {
  private readonly table: Float32Array;

  constructor(seed: number) {
    const rng = mulberry32(seed);
    this.table = new Float32Array(GRID * GRID);
    for (let i = 0; i < this.table.length; i++) {
      this.table[i] = rng();
    }
  }

  private at(xi: number, yi: number): number {
    return this.table[((yi & (GRID - 1)) * GRID) + (xi & (GRID - 1))];
  }

  private static smooth(t: number): number {
    return t * t * (3 - 2 * t); // smoothstep
  }

  private static lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  /** Bilinear sample at (x, y). Returns value in [0, 1]. */
  sample(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const v00 = this.at(xi,     yi    );
    const v10 = this.at(xi + 1, yi    );
    const v01 = this.at(xi,     yi + 1);
    const v11 = this.at(xi + 1, yi + 1);

    const u = ValueNoise2D.smooth(xf);
    const v = ValueNoise2D.smooth(yf);

    return ValueNoise2D.lerp(
      ValueNoise2D.lerp(v00, v10, u),
      ValueNoise2D.lerp(v01, v11, u),
      v,
    );
  }

  /**
   * Fractional Brownian Motion — sums octaves for richer terrain detail.
   * @param octaves      Number of noise layers (4–6 works well for terrain)
   * @param persistence  Amplitude multiplier per octave (0.5 = halves each layer)
   */
  fbm(x: number, y: number, octaves = 4, persistence = 0.5): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value    += this.sample(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude  *= persistence;
      frequency  *= 2;
    }

    return value / maxValue;
  }
}
