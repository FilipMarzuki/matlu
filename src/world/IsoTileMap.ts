/**
 * IsoTileMap — maps biome indices and elevation to isometric tileset frames.
 *
 * ## Tileset: `public/assets/packs/isometric tileset/spritesheet.png`
 *
 *   Size: 352 × 352 px, 11 columns × 11 rows, frameWidth/Height: 32 px.
 *   116 tiles total (frames 0–115; frames 116–120 are empty padding).
 *   Phaser loads it as:
 *     this.load.spritesheet('iso-tiles',
 *       'assets/packs/isometric tileset/spritesheet.png',
 *       { frameWidth: 32, frameHeight: 32 });
 *
 * ## Observed tile catalogue (visually verified)
 *
 *   Frames  0– 9   Dark brown/earth cube variants (rocky soil, dense dirt).
 *                  Front face = dark; top face = brown. Good for rocky/barren terrain.
 *
 *   Frames 10–19   Lighter brown earth cubes with slightly varied texture.
 *                  More sandy/silty than 0–9.
 *
 *   Frames 20–29   Dark earth cubes with tiny sprouts/seedlings on top.
 *                  Good for marsh, bog — wet ground with sparse growth.
 *
 *   Frames 30–39   Dense green bush cubes (vegetation-heavy, dark soil base).
 *                  Good for forest floor, spruce understory.
 *
 *   Frames 40–44   Dark cube with bright grass-green top.
 *                  These are flat ground tiles — the cleanest "grass" look.
 *
 *   Frames 44–49   Green shrub objects (3D bush decorations, not flat ground).
 *                  Not used for terrain — reserved for decoration scatter.
 *
 *   Frames 50–59   Earth cubes with rocks/pebbles on the surface.
 *                  Good for dry heath, coastal heath (stony ground).
 *
 *   Frames 60–69   3D boulder/rock objects sitting on the surface.
 *                  Not flat ground tiles — reserved for decoration scatter.
 *
 *   Frames 70–79   Dark navy water tiles with small rock objects on top.
 *                  Coastal/ocean tiles with surface rocks.
 *
 *   Frames 80–84   Tall rocky mountain peak formations (objects).
 *                  Reserved for landmark placement, not flat terrain.
 *
 *   Frames 85–89   Near-empty/snow particle tiles (very sparse, almost transparent).
 *                  Good for high-altitude snow field ground.
 *
 *   Frames 90–99   Dark navy blue flat diamond tiles — deep ocean water.
 *
 *   Frames 100–104 Navy blue flat diamond tiles — mid-depth water / open sea.
 *
 *   Frames 105–109 Light sky-blue flat diamond tiles — shallow/shore water.
 *
 *   Frames 110–115 Pale sky-blue flat diamond tiles — very shallow / ice surface.
 *
 * ## Biome index mapping (matches GameScene.tileBiomeIdx / BiomeInspectorScene)
 *
 *   0  Sea            → deep water (90–104)
 *   1  Rocky shore    → dark rocky earth + coastal water (0–9)
 *   2  Sandy shore    → lighter sandy earth (10–19)
 *   3  Marsh / bog    → wet earth with sprouts (20–29)
 *   4  Dry heath      → earth with surface rocks (50–59)
 *   5  Coastal heath  → stony earth variants (50–59, lighter)
 *   6  Meadow         → bright grass top (40–43)
 *   7  Forest         → dense green bush cube (30–39)
 *   8  Spruce         → dense dark bush cube (30–34, darker end)
 *   9  Cold granite   → dark rocky earth (0–9, with elev bias)
 *   10 Bare summit    → earth + rocks at high elev (50–56)
 *   11 Snow field     → pale ice/snow surface (110–115)
 */

// ── Biome tile ranges ─────────────────────────────────────────────────────────

/**
 * Per-biome frame ranges [first, last] (inclusive) within the iso spritesheet.
 * Within a range the exact frame is selected by `elevVariant()` so adjacent tiles
 * vary subtly without repeating a single tile everywhere.
 */
const BIOME_RANGES: ReadonlyArray<[number, number]> = [
  [90, 104],   // 0  Sea            — deep water diamonds
  [ 0,   7],   // 1  Rocky shore    — dark rocky earth
  [10,  17],   // 2  Sandy shore    — lighter sandy earth
  [20,  27],   // 3  Marsh / bog    — wet earth with sprouts
  [50,  57],   // 4  Dry heath      — rocky/stony earth
  [50,  55],   // 5  Coastal heath  — slightly less stony earth
  [40,  43],   // 6  Meadow         — bright grass top
  [30,  38],   // 7  Forest         — dense green bush cube
  [30,  34],   // 8  Spruce         — darker bush end
  [ 0,   6],   // 9  Cold granite   — dark rocky earth (same base as rocky shore)
  [50,  56],   // 10 Bare summit    — rocky surface at high elev
  [110, 115],  // 11 Snow field     — pale ice/snow diamonds
];

// ── River / lake override ─────────────────────────────────────────────────────

/** Frame used for river and lake tiles (light-blue shallow water). */
export const ISO_RIVER_FRAME = 105;
/** Frame used for deep ocean tiles (darkest water, used for Sea biome base). */
export const ISO_DEEP_WATER_FRAME = 100;

// ── Frame selection ───────────────────────────────────────────────────────────

/**
 * Map a biome index + elevation value to an isometric spritesheet frame number.
 *
 * @param biomeIdx  0–11, matches the biome index from `tileBiomeIdx()` / `BiomeParams`.
 * @param elev      Elevation in 0..1 (from noise). Used as a cheap variation
 *                  source so tiles in a biome don't all look identical.
 * @returns         Frame number for `this.add.image(x, y, 'iso-tiles', frame)`.
 */
export function isoTileFrame(biomeIdx: number, elev: number): number {
  const [first, last] = BIOME_RANGES[biomeIdx] ?? [0, 0];
  const count = last - first + 1;
  // Use elev to select a frame within the range. Math.floor keeps it discrete
  // so neighbouring tiles with similar elevations don't flicker.
  const offset = Math.floor(elev * count) % count;
  return first + offset;
}

/**
 * Returns true if this biome should be rendered as flat water (no cube face).
 * Water tiles use flat diamond sprites; cube tiles have a visible front face.
 */
export function isWaterBiome(biomeIdx: number): boolean {
  return biomeIdx === 0; // Sea
}
