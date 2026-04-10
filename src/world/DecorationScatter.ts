/**
 * DecorationScatter — decoration placement via Poisson disk sampling.
 *
 * Scatters small visual details (flowers, mushrooms, rocks, grass tufts)
 * across the map. The result is deterministic per seed and avoids avoid-zones
 * and open water automatically.
 *
 * ## Algorithm
 * 1. Generate candidate positions via Bridson's Poisson disk algorithm — no two
 *    points are closer than MIN_DIST, eliminating the grid-aligned clustering that
 *    the old stride-walk produced.
 * 2. At each candidate, sample two noise layers:
 *    - `biomeNoise` (same seed as terrain rendering) to reject water (< 0.28)
 *      and to pick terrain-appropriate decoration types.
 *    - `detailNoise` (high-frequency, XOR seed) as the "does something grow here?"
 *      threshold — creates natural clearings within the Poisson distribution.
 * 3. Skip if the point falls inside any avoid-rect (chunk centres, spawn, portal).
 * 4. Assign decoration type based on biome value ranges so the right things
 *    grow in the right places — flowers in meadows, mushrooms in forest shade.
 *
 * ## Why Poisson disk instead of stride walk?
 * The old STRIDE=2 tile walk sampled on a regular grid, which created subtle
 * grid-aligned rows and columns of decorations visible at certain zoom levels.
 * Poisson disk guarantees minimum spacing while remaining random — like how
 * mushrooms in a real forest maintain distance without forming a grid.
 */

import { FbmNoise } from '../lib/noise';
import { mulberry32, poissonDisk } from '../lib/rng';

export type DecorationType = 'flower' | 'mushroom' | 'stone' | 'tuft' | 'bush' | 'stump' | 'flower2' | 'flower3' | 'stick';

export interface ScatteredDecor {
  x: number;
  y: number;
  type: DecorationType;
  /** 0–3: maps to texture variant (colour / size). */
  variant: number;
  /** Uniform display scale */
  scale: number;
}

/** Noise frequency for detail scatter — higher = finer, more varied patches. */
const DETAIL_FREQ  = 0.18;
/**
 * Detail noise threshold — only candidates above this get a decoration.
 * Creates natural clearings within the Poisson distribution (lower than the old
 * stride-walk value of 0.72 because Poisson already provides good spacing, so
 * we need fewer rejections to reach the target decoration count).
 */
const DETAIL_THRESHOLD = 0.60;
/**
 * Minimum distance between any two decorations in pixels.
 * 48px ≈ 1.5 tiles — tighter than the old stride-2 grid (64px) but with no
 * grid ghost, so density feels similar while distribution looks more natural.
 */
const MIN_DIST = 48;
/** Base noise scale, matching GameScene's BASE_SCALE. */
const BASE_SCALE = 0.07;
/** Temperature noise frequency — matches GameScene's TEMP_SCALE. */
const TEMP_SCALE  = 0.04;
/** Moisture noise frequency — matches GameScene's MOIST_SCALE. */
const MOIST_SCALE = 0.06;

/**
 * Generate decoration positions for a world of `worldW × worldH` pixels.
 *
 * @param seed         Must match GameScene's runSeed so biome values are identical.
 * @param worldW       World width in pixels
 * @param worldH       World height in pixels
 * @param tileSize     Tile size in pixels (e.g. 32)
 * @param avoidRects   Areas to leave clear (chunk centres, spawn clearing, portal)
 * @param maxDecorations Hard cap — defaults to 800
 * @param tempSeed       Seed for temperature noise — defaults to same XOR as GameScene
 * @param moistSeed      Seed for moisture noise — defaults to same XOR as GameScene
 */
export function generateDecorations(
  seed: number,
  worldW: number,
  worldH: number,
  tileSize: number,
  avoidRects: Array<{ x: number; y: number; w: number; h: number }>,
  maxDecorations = 800,
  tempSeed  = seed ^ 0x74656d70,
  moistSeed = seed ^ 0x6d6f6973,
): ScatteredDecor[] {
  // Same seed as GameScene.baseNoise → biome values are identical to terrain colours
  const biomeNoise  = new FbmNoise(seed);
  // High-frequency layer for scatter pattern — XOR keeps it independent of biome
  const detailNoise = new FbmNoise(seed ^ 0xf4c3b2a1);
  // Temperature and moisture noise — XOR seeds match GameScene's tempNoise / moistNoise
  const tempNoise   = new FbmNoise(tempSeed);
  const moistNoise  = new FbmNoise(moistSeed);
  // PRNG for variant/scale jitter — deterministic per seed
  const rng = mulberry32(seed ^ 0x1a2b3c4d);

  const result: ScatteredDecor[] = [];

  // Generate candidate positions. We request maxDecorations * 4 so that biome
  // and detail filtering have enough candidates to fill the cap — Poisson disk
  // will stop early if it runs out of space for new points.
  const candidates = poissonDisk(rng, worldW, worldH, MIN_DIST, maxDecorations * 4);

  outer:
  for (const { x: wx, y: wy } of candidates) {
    if (result.length >= maxDecorations) break outer;

    // Convert world coords to fractional tile coords for noise sampling.
    // This matches the scale used in GameScene's terrain rendering loop exactly.
    const tx = wx / tileSize;
    const ty = wy / tileSize;

    // Detail threshold: creates natural clearings within the Poisson distribution.
    // Not every candidate location gets a decoration — same patchy effect as before.
    const detail = detailNoise.fbm(tx * DETAIL_FREQ, ty * DETAIL_FREQ, 2, 0.6);
    if (detail <= DETAIL_THRESHOLD) continue;

    // Biome: exclude open water and determine species
    const biome = biomeNoise.fbm(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
    if (biome < 0.28) continue; // open water — nothing grows here

    // Temperature [0–1] and moisture [0–1] at this point — same scale as GameScene.
    // 2 octaves (not 4) keeps them smoother, producing broad regional variation rather
    // than fine-grained noise that would fight the Poisson distribution.
    const temp  = tempNoise.fbm(tx  * TEMP_SCALE,  ty * TEMP_SCALE,  2, 0.5);
    const moist = moistNoise.fbm(tx * MOIST_SCALE, ty * MOIST_SCALE, 2, 0.5);

    // Avoid-rect check — skip points inside any excluded zone
    for (const rect of avoidRects) {
      if (wx >= rect.x && wx <= rect.x + rect.w &&
          wy >= rect.y && wy <= rect.y + rect.h) continue outer;
    }

    // Assign type using a 2-D biome × (temp, moisture) matrix so that the same biome
    // band produces regional variation — e.g. a cold wet meadow grows mushrooms while
    // a warm dry one stays flowery, rather than a single flat rule per biome.
    let type: DecorationType;
    if (biome < 0.37) {
      // Shore/wet — moisture-split: tall reed tufts in wetter spots, stones/sticks on drier shore
      if (moist > 0.55) type = 'tuft';
      else if (rng() < 0.18) type = 'stick';  // loose debris on bare shore
      else type = 'stone';
    } else if (biome < 0.65) {
      // Meadow — cold+wet patches grow mushrooms; warm/dry mixes all three flower types
      if (temp < 0.38 && moist > 0.62) {
        type = 'mushroom';
      } else {
        const r2 = rng();
        if (r2 < 0.45) type = 'flower';
        else if (r2 < 0.65) type = 'flower2';  // taller meadow flowers
        else if (r2 < 0.80) type = 'flower3';  // small daisy-like flowers
        else type = 'bush';
      }
    } else if (biome < 0.73) {
      // Tall-grass transition — wetter side tilts toward flowers/tufts; drier toward mushrooms/stone
      if (moist > 0.58) type = rng() < 0.55 ? 'flower' : 'tuft';
      else              type = rng() < 0.45 ? 'mushroom' : rng() < 0.75 ? 'bush' : 'stone';
    } else if (biome < 0.81) {
      // Forest edge — wet = mossy mushrooms + stumps; dry = stones + bush + stumps
      type = moist > 0.50
        ? (rng() < 0.45 ? 'mushroom' : rng() < 0.30 ? 'stump' : 'bush')
        : (rng() < 0.40 ? 'stone'    : rng() < 0.25 ? 'stump' : 'bush');
    } else {
      // Dense forest — temperature drives ratio: cold = more mushrooms, warm = more stones; stumps throughout
      type = temp < 0.45
        ? (rng() < 0.50 ? 'mushroom' : rng() < 0.30 ? 'stump' : 'stone')
        : (rng() < 0.40 ? 'stone'    : rng() < 0.30 ? 'stump' : rng() < 0.70 ? 'bush' : 'mushroom');
    }

    // Variant 0–3 for texture/colour selection; slight scale jitter for variety.
    // No position jitter needed — Poisson disk positions are already non-grid-aligned.
    let variant = Math.floor(rng() * 4);
    // Shore reeds: pin to grass-tuft-5 (the tallest, most reed-like sprite) when
    // wet-shore tuft is selected — makes the waterline feel distinctly different.
    if (type === 'tuft' && biome < 0.37 && moist > 0.55) variant = 4;
    const scale   = 1.2 + rng() * 0.6; // 1.2–1.8×

    result.push({ x: wx, y: wy, type, variant, scale });
  }

  return result;
}

/**
 * Texture key lookup for a given type + variant.
 * Variants cycle through available textures for that category.
 */
export function decorTexture(type: DecorationType, variant: number): string {
  switch (type) {
    case 'flower':   return (['flower-1-yellow', 'flower-1-red', 'flower-1-blue', 'flower-1-purple'] as const)[variant % 4];
    case 'flower2':  return (['flowers-2-yellow', 'flowers-2-red', 'flowers-2-blue', 'flowers-2-purple'] as const)[variant % 4];
    case 'flower3':  return (['flowers-3-yellow', 'flowers-3-red', 'flowers-3-blue', 'flowers-3-purple'] as const)[variant % 4];
    case 'mushroom': return (['mushroom', 'mushrooms-yellow', 'mushrooms-red', 'mushroom'] as const)[variant % 4];
    case 'stone':    return 'rock-grass';
    case 'tuft':     return `grass-tuft-${(variant % 5) + 1}`;
    case 'bush':     return variant % 2 === 0 ? 'bush-1' : 'bush-2';
    case 'stump':    return variant % 2 === 0 ? 'stump-1' : 'stump-2';
    case 'stick':    return 'stick';
  }
}
