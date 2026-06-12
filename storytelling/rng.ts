// rng.ts — a small, seeded, reproducible pseudo-random number generator.
//
// Why a custom RNG instead of Math.random()? The whole point of this prototype
// is REPRODUCIBILITY: `--seed 42` must always produce the exact same 200-year
// chronicle. Math.random() is non-deterministic and unseedable, so we roll our
// own. The algorithm below is "mulberry32" — a tiny, fast, well-distributed
// PRNG. It holds a single 32-bit integer of state and mangles it on each call.

export class RNG {
  // The internal state. Kept as an unsigned 32-bit integer via `| 0` / `>>> 0`.
  private state: number;

  constructor(seed: number) {
    // Force the seed into a 32-bit integer so behaviour is identical across runs.
    this.state = seed >>> 0;
  }

  // Core generator: returns a float in [0, 1). Every other method builds on this.
  next(): number {
    // mulberry32 — see https://stackoverflow.com/a/47593316
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Integer in [min, max] inclusive.
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  // Float in [min, max).
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Returns true with probability p (0..1). The bread-and-butter of the sim:
  // "does the harvest fail?", "does she conceive this year?", etc.
  chance(p: number): boolean {
    return this.next() < p;
  }

  // Pick one element uniformly at random.
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  // Weighted pick: each item has an associated weight; higher = more likely.
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  // Fisher–Yates shuffle, in place, returning the same array for convenience.
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Approximate a normal distribution (mean, stddev) via the central limit
  // theorem: summing several uniforms tends toward a bell curve. Used for
  // harvest variance so most years are "normal" and extremes are rare.
  gaussian(mean: number, stddev: number): number {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += this.next();
    // sum of 6 uniforms has mean 3, stddev sqrt(6/12)=0.707; normalise it.
    return mean + ((sum - 3) / 0.707) * stddev;
  }
}
