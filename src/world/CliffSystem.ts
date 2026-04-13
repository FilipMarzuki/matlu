/**
 * CliffSystem — elevation quantization and cliff-face detection for the top-down world.
 *
 * ## How cliffs work in a top-down game
 * In the diagonal SW→NE corridor the camera looks straight down, so only
 * south-facing and east-facing cliff walls are ever visible:
 *
 *   South-facing: tile (tx, ty) is higher elevation than (tx, ty+1).
 *                 The viewer sees a horizontal wall strip at the top of the lower tile.
 *   East-facing:  tile (tx, ty) is higher elevation than (tx+1, ty).
 *                 The viewer sees a narrow vertical shadow strip on the left of the lower tile.
 *
 * ## Elevation quantization
 * The continuous elevation float [0, 1.2] is quantized into 5 discrete levels
 * before the cliff detection pass so that "height difference" is a meaningful
 * integer step count rather than a raw noise gradient.
 *
 *   Level 0  (< 0.25)          — sea / water    (never a cliff source)
 *   Level 1  (0.25 – 0.45)     — coastal / shore
 *   Level 2  (0.45 – 0.62)     — lowland / heath
 *   Level 3  (0.62 – 0.78)     — highland / forest
 *   Level 4  (≥ 0.78)          — mountain / summit
 *
 * ## Depth sorting
 * Each south-facing cliff face is assigned depth = (ty + 1) * TILE_SIZE, matching
 * the raw-Y depth convention used for trees and entities.  Highland entities
 * (Y < ty * TILE_SIZE) appear behind the cliff; lowland entities
 * (Y > (ty + 1) * TILE_SIZE) appear in front.
 *
 * ## Upper biome owns the cliff face
 * The biome index of the UPPER tile determines cliff face colours, since the
 * viewer sees the underside/edge of the upper surface material
 * (grass roots, granite, ice, etc.) rather than the lower surface.
 *
 * ## Concave inner corners
 * When the same upper tile produces both a south drop and an east drop the
 * CliffFace.isInnerCorner flag is set.  Renderers can use this to fill the
 * corner notch that would otherwise appear where the two cliff faces meet.
 */

/** Elevation level boundaries. Index 0 is the sea/land boundary. */
export const ELEV_THRESHOLDS = [0.25, 0.45, 0.62, 0.78] as const;

/**
 * Quantize a continuous elevation value into a discrete integer level (0–4).
 *
 * Level 0 = sea/water, Level 4 = mountain summit.
 */
export function quantizeElevation(val: number): number {
  if (val < ELEV_THRESHOLDS[0]) return 0;
  if (val < ELEV_THRESHOLDS[1]) return 1;
  if (val < ELEV_THRESHOLDS[2]) return 2;
  if (val < ELEV_THRESHOLDS[3]) return 3;
  return 4;
}

/** A single cliff-face descriptor — one entry per visible cliff edge tile. */
export interface CliffFace {
  /** Grid column of the upper (higher-elevation) tile. */
  tx: number;
  /** Grid row of the upper (higher-elevation) tile. */
  ty: number;
  /**
   * Number of discrete elevation levels dropped.
   * 1 = single-step cliff, 2 = two-step drop requiring stacked wall segments, etc.
   */
  steps: number;
  /** Raw elevation of the upper tile — used to pick biome-appropriate colours. */
  upperElev: number;
  /** Biome index (0–10) of the upper tile — governs cliff face colour family. */
  biomeIdx: number;
  /** True when this is a south-facing cliff (viewer sees a horizontal wall strip). */
  isSouth: boolean;
  /**
   * True when both a south drop AND an east drop originate at this tile — the
   * two cliff faces meet at a 90° inner corner.  Renderers should fill the
   * resulting notch with a corner piece.
   */
  isInnerCorner: boolean;
}

/**
 * Run the cliff-detection pass over a pre-built elevation grid.
 *
 * Called once per terrain bake after drawProceduralTerrain() has filled both
 * biomeGrid (raw elevation floats) and biomeIdxGrid (biome indices 0–10).
 *
 * @param biomeGrid     Flat row-major elevation values [0,1.2], one per tile.
 * @param biomeIdxGrid  Flat row-major biome indices (0–10), one per tile.
 * @param tilesX        World width in tiles.
 * @param tilesY        World height in tiles.
 * @returns Array of CliffFace descriptors — one entry per visible cliff tile.
 */
export function detectCliffs(
  biomeGrid: Float32Array,
  biomeIdxGrid: Uint8Array,
  tilesX: number,
  tilesY: number,
): CliffFace[] {
  const faces: CliffFace[] = [];

  const levelAt = (tx: number, ty: number): number =>
    quantizeElevation(biomeGrid[ty * tilesX + tx]);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const level = levelAt(tx, ty);
      // Water tiles are never a cliff source — there are no cliff faces into/out of water.
      if (level === 0) continue;

      const hasSouth = ty + 1 < tilesY;
      const hasEast  = tx + 1 < tilesX;

      const southDrop = hasSouth ? level - levelAt(tx,     ty + 1) : 0;
      const eastDrop  = hasEast  ? level - levelAt(tx + 1, ty    ) : 0;

      if (southDrop <= 0 && eastDrop <= 0) continue;

      const upperElev  = biomeGrid[ty * tilesX + tx];
      const biomeIdx   = biomeIdxGrid[ty * tilesX + tx];
      // Inner corner: this tile produces cliff faces in BOTH south and east directions.
      // The corner renders as a combined piece covering the notch between the two walls.
      const innerCorner = southDrop > 0 && eastDrop > 0;

      if (southDrop > 0) {
        faces.push({
          tx,
          ty,
          steps: southDrop,
          upperElev,
          biomeIdx,
          isSouth: true,
          isInnerCorner: innerCorner,
        });
      }

      if (eastDrop > 0) {
        faces.push({
          tx,
          ty,
          steps: eastDrop,
          upperElev,
          biomeIdx,
          isSouth: false,
          isInnerCorner: innerCorner,
        });
      }
    }
  }

  return faces;
}

/**
 * Biome-specific cliff face colour palette.
 *
 * Each entry is a [darkBase, midHighlight] pair.  The dark base covers the bulk
 * of the cliff face; the mid-highlight is a brighter band through the centre
 * that breaks up the uniform darkness and suggests rock texture.
 *
 * The upper biome owns the cliff appearance — these colours represent the
 * cross-section of the upper surface material:
 *
 *   Index  Biome            Cliff material
 *   ─────  ───────────────  ────────────────────────────────
 *     0    Sea              (unused — water never sources cliffs)
 *     1    Rocky shore      Warm earthy stone / shingle
 *     2    Sandy shore      Layered sandy sediment
 *     3    Marsh / bog      Dark peat / mud
 *     4    Dry heath        Sandy gravel / dusty earth
 *     5    Coastal heath    Brown loam / topsoil
 *     6    Mixed forest     Dark soil with root traces
 *     7    Dense spruce     Very dark forest-floor humus
 *     8    Cold granite     Exposed grey stone face
 *     9    Bare summit      Grey-brown fractured rock
 *    10    Snow field       Compacted ice / blue-white
 */
export const CLIFF_COLORS: readonly [number, number][] = [
  [0x1a2a3a, 0x2a3a4a], // 0  Sea           — (unused placeholder)
  [0x4a3020, 0x6a5040], // 1  Rocky shore   — warm earthy stone
  [0x9a7a40, 0xb89a60], // 2  Sandy shore   — sandy layered sediment
  [0x2a1a08, 0x3a2814], // 3  Marsh / bog   — dark peat
  [0x5a4020, 0x7a5a38], // 4  Dry heath     — sandy gravel
  [0x4a3818, 0x6a5230], // 5  Coastal heath — brown loam
  [0x281408, 0x3e2210], // 6  Mixed forest  — dark soil
  [0x1e1006, 0x301a0c], // 7  Dense spruce  — very dark forest floor
  [0x404040, 0x606060], // 8  Cold granite  — grey stone
  [0x504e48, 0x706e68], // 9  Bare summit   — grey-brown rock
  [0x8a8ea0, 0xb0b4c8], // 10 Snow field    — compacted ice
] as const;

/**
 * Height in pixels of a single cliff-face step drawn on the lower tile.
 * One step represents one elevation level of vertical drop at TILE_SIZE = 32 px.
 * Multi-step cliffs stack these strips vertically.
 */
export const CLIFF_STEP_PX = 14;

/**
 * Lip height in pixels — bright top edge drawn at the bottom of the upper tile.
 * This 2-pixel highlight simulates the lit ledge top and visually anchors the cliff.
 */
export const CLIFF_LIP_PX = 2;

/**
 * Drop shadow configuration for the base of the cliff face.
 * Three bands of decreasing opacity feather the cliff into the lower terrain.
 */
export const CLIFF_SHADOW_BANDS: readonly [number, number][] = [
  [3, 0.28], // [height px, alpha]
  [2, 0.16],
  [2, 0.07],
] as const;

/**
 * Corruption overlay colour blended on top of cliff faces when the zone is corrupted.
 * Dark purple matches the visual language of CorruptionPostFX and the corruption shader.
 */
export const CLIFF_CORRUPT_COLOR = 0x3a0a52;
