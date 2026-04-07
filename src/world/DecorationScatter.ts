/**
 * DecorationScatter — noise-driven detail decoration placement.
 *
 * Scatters small visual details (flowers, mushrooms, rocks, grass tufts)
 * across the map using high-frequency simplex noise. The result is deterministic
 * per seed and avoids avoid-zones and open water automatically.
 *
 * ## Algorithm
 * 1. Step every `stride` tiles across the world (stride 2 → ~15 000 candidates
 *    for an 8000×8000 world with 32px tiles — manageable without being sparse).
 * 2. At each candidate, sample two noise layers:
 *    - `biomeNoise` (same seed as terrain rendering) to reject water (< 0.28)
 *      and to pick terrain-appropriate decoration types.
 *    - `detailNoise` (high-frequency, XOR seed) as the "does something grow here?"
 *      threshold. Only tiles where detailNoise > THRESHOLD get a decoration.
 * 3. Skip if the tile falls inside any avoid-rect (chunk centres, spawn, portal).
 * 4. Assign decoration type based on biome value ranges so the right things
 *    grow in the right places — flowers in meadows, mushrooms in forest shade.
 *
 * ## Why separate biome and detail noise?
 * Using a single noise layer for both "where" and "what type" would mean
 * all flowers are at the same biome value — no variety. Two orthogonal layers
 * give independence: the detail layer decides placement, the biome layer
 * decides species.
 */

import { FbmNoise } from '../lib/noise';
import { mulberry32 } from '../lib/rng';

export type DecorationType = 'flower' | 'mushroom' | 'stone' | 'tuft';

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
/** Detail noise threshold — only tiles above this get a decoration. */
const DETAIL_THRESHOLD = 0.72;
/** Step size in tiles — stride 2 samples every other tile. */
const STRIDE = 2;
/** Base noise scale, matching GameScene's BASE_SCALE. */
const BASE_SCALE = 0.07;

/**
 * Generate decoration positions for a world of `worldW × worldH` pixels.
 *
 * @param seed         Must match GameScene's runSeed so biome values are identical.
 * @param worldW       World width in pixels
 * @param worldH       World height in pixels
 * @param tileSize     Tile size in pixels (e.g. 32)
 * @param avoidRects   Areas to leave clear (chunk centres, spawn clearing, portal)
 * @param maxDecorations Hard cap — defaults to 800
 */
export function generateDecorations(
  seed: number,
  worldW: number,
  worldH: number,
  tileSize: number,
  avoidRects: Array<{ x: number; y: number; w: number; h: number }>,
  maxDecorations = 800,
): ScatteredDecor[] {
  // Same seed as GameScene.baseNoise → biome values are identical to terrain colours
  const biomeNoise  = new FbmNoise(seed);
  // High-frequency layer for scatter pattern — XOR keeps it independent of biome
  const detailNoise = new FbmNoise(seed ^ 0xf4c3b2a1);
  // PRNG for variant/scale jitter — deterministic per seed
  const rng = mulberry32(seed ^ 0x1a2b3c4d);

  const tilesX = Math.ceil(worldW / tileSize);
  const tilesY = Math.ceil(worldH / tileSize);
  const result: ScatteredDecor[] = [];

  outer:
  for (let ty = 0; ty < tilesY; ty += STRIDE) {
    for (let tx = 0; tx < tilesX; tx += STRIDE) {
      if (result.length >= maxDecorations) break outer;

      // World-space centre of this tile
      const wx = tx * tileSize + tileSize * 0.5;
      const wy = ty * tileSize + tileSize * 0.5;

      // Detail threshold: only a fraction of tiles get a decoration
      const detail = detailNoise.fbm(tx * DETAIL_FREQ, ty * DETAIL_FREQ, 2, 0.6);
      if (detail <= DETAIL_THRESHOLD) continue;

      // Biome: exclude open water and determine species
      const biome = biomeNoise.fbm(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
      if (biome < 0.28) continue; // open water — nothing grows here

      // Avoid-rect check — skip tiles inside any excluded zone
      for (const rect of avoidRects) {
        if (wx >= rect.x && wx <= rect.x + rect.w &&
            wy >= rect.y && wy <= rect.y + rect.h) continue outer;
      }

      // Assign type based on biome so the right things grow in the right places:
      //   shore/wet  (0.28–0.37): grass tufts (reeds, sedge)
      //   meadow     (0.37–0.65): flowers (open sun → colourful)
      //   tall grass (0.65–0.73): flowers + tufts mix
      //   forest edge(0.73–0.81): mushrooms (shade-loving)
      //   dense forest(≥ 0.81) : mushrooms + stones (deep shade, mossy rocks)
      let type: DecorationType;
      if      (biome < 0.37) type = 'tuft';
      else if (biome < 0.65) type = 'flower';
      else if (biome < 0.73) type = rng() < 0.6 ? 'flower' : 'tuft';
      else if (biome < 0.81) type = 'mushroom';
      else                   type = rng() < 0.55 ? 'mushroom' : 'stone';

      // Variant 0–3 for texture/colour selection; slight scale jitter for variety
      const variant = Math.floor(rng() * 4);
      const scale   = 1.2 + rng() * 0.6; // 1.2–1.8×

      // Sub-tile jitter so decorations aren't grid-aligned
      const jx = (rng() - 0.5) * tileSize * STRIDE;
      const jy = (rng() - 0.5) * tileSize * STRIDE;

      result.push({ x: wx + jx, y: wy + jy, type, variant, scale });
    }
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
    case 'mushroom': return (['mushroom', 'mushrooms-yellow', 'mushrooms-red', 'mushroom'] as const)[variant % 4];
    case 'stone':    return 'rock-grass';
    case 'tuft':     return `grass-tuft-${(variant % 5) + 1}`;
  }
}
