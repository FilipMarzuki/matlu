/**
 * TreeScatter — biome-aware tree placement using Poisson disk sampling.
 *
 * Reads `trees.json` (the tree registry) and the per-tile biome grid to decide
 * which tree species grow where. Each placed tree is a SolidObject with a
 * narrow trunk collider so the player walks behind the canopy.
 *
 * ## How it works
 * 1. Poisson disk generates candidate positions with minimum spacing (no grid ghosts).
 * 2. Each candidate is looked up in the biome grid → biome index.
 * 3. The registry is filtered to species that list that biome. Density weights
 *    control the probability of each species appearing.
 * 4. Candidates inside avoid-rects (spawn, portals, settlements) are skipped.
 * 5. A detail noise layer creates natural clearings — not every valid spot gets a tree.
 * 6. A random growth stage is picked from the species' stages array.
 *
 * The output is a list of tree placements that GameScene turns into SolidObjects.
 */

import { FbmNoise } from '../lib/noise';
import { mulberry32, poissonDisk } from '../lib/rng';

// ── Types matching trees.json schema ─────────────────────────────────────────

export interface TreeHarvest {
  resource: string;
  yield: [number, number];
  tool: string | null;
  hits: number;
  respawnSeconds: number;
  bonus?: {
    resource: string;
    chance: number;
    yield: [number, number];
  };
}

export interface TreeStage {
  stage: 'sapling' | 'young' | 'mature';
  sprite: string;
  scale: [number, number];
  collider: { width: number; height: number; offsetY: number };
  harvest: TreeHarvest;
}

export interface TreeDef {
  id: string;
  name: string;
  biomes: number[];
  density: 'high' | 'medium' | 'low' | 'rare';
  stages: TreeStage[];
}

export interface TreeRegistry {
  trees: TreeDef[];
}

export interface PlacedTree {
  /** World-space x (pixels, pre-iso). */
  x: number;
  /** World-space y (pixels, pre-iso). */
  y: number;
  /** Tree species definition from the registry. */
  def: TreeDef;
  /** The selected growth stage. */
  stage: TreeStage;
  /** Chosen scale within the stage's [min, max] range. */
  scale: number;
}

// ── Density → weight mapping ─────────────────────────────────────────────────

const DENSITY_WEIGHT: Record<TreeDef['density'], number> = {
  high:   1.0,
  medium: 0.6,
  low:    0.25,
  rare:   0.08,
};

/** Minimum distance between trees (px). ~3 tiles — wider than groundcover. */
const MIN_DIST = 80;
/** Detail noise frequency — creates clearings in forests. */
const DETAIL_FREQ = 0.12;

/**
 * Generate tree placements for the world.
 *
 * @param registry   Parsed trees.json
 * @param biomeGrid  Uint8Array of biome indices, one per tile (from tileDevBiome)
 * @param gridW      Tile grid width
 * @param gridH      Tile grid height
 * @param tileSize   Tile size in pixels
 * @param seed       World seed (must match GameScene.runSeed)
 * @param avoidRects Areas to keep clear (spawn, portals, settlements)
 * @param maxTrees   Hard cap — default 600
 */
export function generateTreePlacements(
  registry: TreeRegistry,
  biomeGrid: Uint8Array,
  gridW: number,
  gridH: number,
  tileSize: number,
  seed: number,
  avoidRects: Array<{ x: number; y: number; w: number; h: number }>,
  maxTrees = 600,
): PlacedTree[] {
  const worldW = gridW * tileSize;
  const worldH = gridH * tileSize;

  const detailNoise = new FbmNoise(seed ^ 0xa3b2c1d0);
  const rng = mulberry32(seed ^ 0x54524545); // "TREE" in hex-ish

  // Pre-build per-biome candidate lists with cumulative weights for fast sampling.
  const biomeSpecies = new Map<number, { defs: TreeDef[]; cumWeights: number[] }>();
  for (const def of registry.trees) {
    for (const biome of def.biomes) {
      let entry = biomeSpecies.get(biome);
      if (!entry) {
        entry = { defs: [], cumWeights: [] };
        biomeSpecies.set(biome, entry);
      }
      entry.defs.push(def);
      const prev = entry.cumWeights.length > 0 ? entry.cumWeights[entry.cumWeights.length - 1] : 0;
      entry.cumWeights.push(prev + DENSITY_WEIGHT[def.density]);
    }
  }

  const candidates = poissonDisk(rng, worldW, worldH, MIN_DIST, maxTrees * 3);
  const result: PlacedTree[] = [];

  outer:
  for (const { x: wx, y: wy } of candidates) {
    if (result.length >= maxTrees) break;

    // Tile coordinates
    const tx = Math.floor(wx / tileSize);
    const ty = Math.floor(wy / tileSize);
    if (tx < 0 || tx >= gridW || ty < 0 || ty >= gridH) continue;

    const biomeIdx = biomeGrid[ty * gridW + tx];
    const species = biomeSpecies.get(biomeIdx);
    if (!species) continue; // no trees defined for this biome

    // Detail noise creates clearings — skip ~40% of candidates
    const detail = detailNoise.fbm(
      (wx / tileSize) * DETAIL_FREQ,
      (wy / tileSize) * DETAIL_FREQ,
      2, 0.6,
    );
    if (detail < 0.45) continue;

    // Avoid-rect check
    for (const rect of avoidRects) {
      if (wx >= rect.x && wx <= rect.x + rect.w &&
          wy >= rect.y && wy <= rect.y + rect.h) continue outer;
    }

    // Weighted random species selection
    const totalWeight = species.cumWeights[species.cumWeights.length - 1];
    const roll = rng() * totalWeight;
    let picked = species.defs[0];
    for (let i = 0; i < species.cumWeights.length; i++) {
      if (roll <= species.cumWeights[i]) {
        picked = species.defs[i];
        break;
      }
    }

    // Pick a random growth stage
    const stage = picked.stages[Math.floor(rng() * picked.stages.length)];

    // Random scale within the stage's range
    const scale = stage.scale[0] + rng() * (stage.scale[1] - stage.scale[0]);

    result.push({ x: wx, y: wy, def: picked, stage, scale });
  }

  return result;
}
