/**
 * BiomeInspectorScene — dev tool for visually inspecting biome tile sets,
 * biome-boundary feathering, and decoration scatter.
 *
 * Access: navigate to /biome in the URL.
 *
 * ## Layout
 *   ┌────────────────────────────┐  ← prev biome (top 25%)
 *   ├────────────────────────────┤  ← BiomeBlend feather strip
 *   │                            │
 *   │      selected biome        │  ← center 50% — decorations here
 *   │                            │
 *   ├────────────────────────────┤  ← BiomeBlend feather strip
 *   └────────────────────────────┘  ← next biome (bottom 25%)
 *
 * ## Controls
 *   ← / → or A / D   Cycle through all 12 biomes
 *   Click palette box Jump directly to that biome
 *
 * ## Design notes
 * - Tile selection uses the same `terrainTileFrame()` logic as GameScene but
 *   with forced (elev, temp, moist) values instead of noise — so you see the
 *   canonical look of each biome without noise-driven variation in biome
 *   membership (only the tile-variant detail noise varies).
 * - BiomeBlend strips use the same algorithm as the world map — you see the
 *   exact same feathering that will appear in gameplay.
 * - Decorations are placed by `generateDecorations()` over the center band only.
 */

import * as Phaser from 'phaser';
import { FbmNoise } from '../lib/noise';
import { detectBoundaries, BLEND_COLORS } from '../world/BiomeBlend';
import { generateDecorations, decorTexture } from '../world/DecorationScatter';

// ── Constants ─────────────────────────────────────────────────────────────────

const TILE_SIZE    = 32;
const DETAIL_SCALE = 0.22;

const BIOME_NAMES: readonly string[] = [
  'Sea',          'Rocky Shore',   'Sandy Shore',  'Marsh / Bog',
  'Dry Heath',    'Coastal Heath', 'Meadow',        'Forest',
  'Spruce',       'Cold Granite',  'Bare Summit',   'Snow Field',
];

/** Matches BIOME_OVERLAY_COLORS in GameScene — used for palette swatches. */
const BIOME_OVERLAY_COLORS: readonly number[] = [
  0x1a4f7a, 0x8b6914, 0xe8c870, 0x4a7a3a,
  0xb8904a, 0x7a9a3a, 0x6abf45, 0x2a7a2a,
  0x1a5a1a, 0x7a7a7a, 0x9a9898, 0xd8e8f8,
];

/**
 * Fixed (elev, temp, moist) values that deterministically produce each biome
 * index via `tileBiomeIdx()` in GameScene. These are the canonical "centres"
 * of each biome region in parameter space.
 *
 * Verified against GameScene.tileBiomeIdx() — each entry maps to exactly one
 * biome index with no noise ambiguity.
 */
const BIOME_PARAMS: ReadonlyArray<{ elev: number; temp: number; moist: number }> = [
  { elev: 0.10, temp: 0.50, moist: 0.50 }, // 0  Sea
  { elev: 0.27, temp: 0.30, moist: 0.60 }, // 1  Rocky shore  (cold/wet shore)
  { elev: 0.27, temp: 0.60, moist: 0.30 }, // 2  Sandy shore  (warm/dry shore)
  { elev: 0.38, temp: 0.50, moist: 0.85 }, // 3  Marsh / bog
  { elev: 0.50, temp: 0.50, moist: 0.20 }, // 4  Dry heath
  { elev: 0.50, temp: 0.50, moist: 0.35 }, // 5  Coastal heath
  { elev: 0.50, temp: 0.50, moist: 0.50 }, // 6  Meadow
  { elev: 0.50, temp: 0.50, moist: 0.70 }, // 7  Forest
  { elev: 0.70, temp: 0.60, moist: 0.50 }, // 8  Spruce        (warm high)
  { elev: 0.70, temp: 0.40, moist: 0.50 }, // 9  Cold granite  (cold high)
  { elev: 0.85, temp: 0.50, moist: 0.50 }, // 10 Bare summit
  { elev: 0.85, temp: 0.30, moist: 0.50 }, // 11 Snow field    (cold summit)
];

// ── Tile frame selection ───────────────────────────────────────────────────────
// Mirrors GameScene.terrainTileFrame() without the river/lake flags — not
// needed here. Any change to GameScene's version must also be reflected here.

function terrainTileFrame(
  elev: number, temp: number, moist: number, detail: number,
): { key: string; frame: number } {
  const v6 = Math.floor(detail * 5.99); // tile variant 0–5

  if (elev < 0.25) {
    // Water — 3 ripple levels (ocean in inspector, no river/lake distinction)
    return { key: 'terrain-water', frame: detail > 0.65 ? 2 : detail > 0.35 ? 1 : 0 };
  }
  if (elev < 0.30) {
    // Shore — cold/wet: rocky shingle (row 0); warm/dry: sandy (row 1)
    return (temp < 0.45 || moist > 0.50)
      ? { key: 'mw-plains', frame:      v6 }
      : { key: 'mw-plains', frame:  6 + v6 };
  }
  if (elev < 0.45 && moist > 0.72) {
    return { key: 'mw-plains', frame: 18 + v6 }; // marsh / bog
  }
  if (elev < 0.62) {
    if (moist > 0.60) return { key: 'mw-plains',  frame:  6 + v6 }; // forest
    if (moist > 0.40) return { key: 'mw-plains',  frame: 12 + v6 }; // meadow
    if (moist > 0.30) return { key: 'mw-heather', frame:      v6 }; // coastal heath
    return                   { key: 'mw-grass',   frame: 0 };        // dry heath
  }
  if (elev < 0.78) {
    return temp > 0.50
      ? { key: 'mw-plains', frame: 42 + v6 }  // spruce
      : { key: 'mw-plains', frame:  6 + v6 }; // cold granite
  }
  // Summit
  return temp < 0.40
    ? { key: 'mw-snow',   frame: 12 }         // snow field
    : { key: 'mw-plains', frame: 54 + v6 };   // bare summit
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export class BiomeInspectorScene extends Phaser.Scene {
  /** Currently inspected biome index (0–11). Default: Meadow. */
  private selectedBiome = 6;

  /** Detail noise for tile variant selection — does not affect biome. */
  private detailNoise!: FbmNoise;

  // Rebuilt on each biome change ---
  private terrainRt?:   Phaser.GameObjects.RenderTexture;
  private blendGfx?:    Phaser.GameObjects.Graphics;
  private decorSprites: Phaser.GameObjects.Image[] = [];
  private bandLabels:   Phaser.GameObjects.Text[]  = [];

  // Persistent palette UI (built once in create()) ---
  private paletteBoxes:    Phaser.GameObjects.Graphics[] = [];
  private selectionBorder?: Phaser.GameObjects.Graphics;
  private biomeLabel?:      Phaser.GameObjects.Text;

  constructor() { super({ key: 'BiomeInspectorScene' }); }

  // ── preload ──────────────────────────────────────────────────────────────────
  // Loads only the assets needed for terrain tiles and decoration scatter —
  // the same set used by GameScene so URLs are guaranteed to be valid.

  preload(): void {
    const mwTiles = 'assets/packs/mystic_woods_2.2/sprites/tilesets';
    this.load.spritesheet('mw-plains',     `${mwTiles}/plains.png`,  { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('mw-grass',      `${mwTiles}/grass.png`,   { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('mw-snow',       `${mwTiles}/snow.png`,    { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('mw-heather',    `${mwTiles}/heather.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('terrain-water', 'assets/sprites/water_animated.png', { frameWidth: 16, frameHeight: 16 });

    const pa    = 'assets/packs/PostApocalypse_AssetPack_v1.1.2/Objects/Nature';
    const paGrn = `${pa}/Green`;
    const paFMO = `${pa}/Flowers_Mashrooms_Other-nature-stuff`;

    for (let i = 1; i <= 5; i++) {
      this.load.image(`grass-tuft-${i}`, `${paGrn}/Grass_${i}_Green.png`);
    }
    this.load.image('bush-1',           `${paGrn}/Bush_1_Green.png`);
    this.load.image('bush-2',           `${paGrn}/Bush_2_Green.png`);
    this.load.image('rock-grass',       `${paGrn}/Rocks/Rock-grass.png`);

    this.load.image('flower-1-yellow',  `${paFMO}/Flower_1_yellow.png`);
    this.load.image('flower-1-red',     `${paFMO}/Flower_1_red.png`);
    this.load.image('flower-1-blue',    `${paFMO}/Flower_1_blue.png`);
    this.load.image('flower-1-purple',  `${paFMO}/Flower_1_purple.png`);
    this.load.image('flowers-2-yellow', `${paFMO}/Flowers_2_yellow.png`);
    this.load.image('flowers-2-red',    `${paFMO}/Flowers_2_red.png`);
    this.load.image('flowers-2-blue',   `${paFMO}/Flowers_2_blue.png`);
    this.load.image('flowers-2-purple', `${paFMO}/Flowers_2_purple.png`);
    this.load.image('flowers-3-yellow', `${paFMO}/Flowers_3_yellow.png`);
    this.load.image('flowers-3-red',    `${paFMO}/Flowers_3_red.png`);
    this.load.image('flowers-3-blue',   `${paFMO}/Flowers_3_blue.png`);
    this.load.image('flowers-3-purple', `${paFMO}/Flowers_3_purple.png`);
    this.load.image('mushroom',         `${paFMO}/Mushroom.png`);
    this.load.image('mushrooms-yellow', `${paFMO}/Mushrooms_1_Yellow.png`);
    this.load.image('mushrooms-red',    `${paFMO}/Mushrooms_2_Red.png`);
    this.load.image('stump-1',          `${paFMO}/Stump_1.png`);
    this.load.image('stump-2',          `${paFMO}/Stump_2_Mushrooms.png`);
    this.load.image('stick',            `${paFMO}/Stick.png`);

    // Waterfall sprite (generated via PixelLab, FIL-171 placeholder)
    this.load.image('waterfall', 'assets/sprites/waterfall.png');
  }

  // ── create ───────────────────────────────────────────────────────────────────

  create(): void {
    // Fixed seed — the detail noise only drives tile variant selection, not biome
    // assignment, so any constant works fine for the inspector.
    this.detailNoise = new FbmNoise(0xdeadbeef);

    this.buildDisplay();
    this.buildPalette();

    // Keyboard navigation
    this.input.keyboard!.on('keydown-LEFT',  () => this.cycleBiome(-1));
    this.input.keyboard!.on('keydown-RIGHT', () => this.cycleBiome(+1));
    this.input.keyboard!.on('keydown-A',     () => this.cycleBiome(-1));
    this.input.keyboard!.on('keydown-D',     () => this.cycleBiome(+1));
  }

  // ── Biome selection ───────────────────────────────────────────────────────────

  private cycleBiome(delta: number): void {
    this.selectedBiome = (this.selectedBiome + 12 + delta) % 12;
    this.refreshDisplay();
  }

  private selectBiome(idx: number): void {
    if (idx === this.selectedBiome) return;
    this.selectedBiome = idx;
    this.refreshDisplay();
  }

  /** Tear down the current terrain/blend/decor layers and rebuild. */
  private refreshDisplay(): void {
    this.terrainRt?.destroy();
    this.terrainRt = undefined;
    this.blendGfx?.destroy();
    this.blendGfx = undefined;
    for (const s of this.decorSprites) s.destroy();
    this.decorSprites = [];
    for (const t of this.bandLabels) t.destroy();
    this.bandLabels = [];

    this.buildDisplay();
    this.updatePalette();
  }

  // ── Terrain + blend + decorations ────────────────────────────────────────────

  /**
   * Draws the 3-band terrain layout, BiomeBlend feathering at the two band
   * boundaries, a river strip across the center band, and decorations.
   */
  private buildDisplay(): void {
    const W      = this.scale.width;
    const H      = this.scale.height;
    const tilesX = Math.ceil(W / TILE_SIZE);
    const tilesY = Math.ceil(H / TILE_SIZE);

    // 3-band split: 25% prev / 50% selected / 25% next
    const topRows    = Math.max(2, Math.floor(tilesY * 0.25));
    const bottomRows = Math.max(2, Math.floor(tilesY * 0.25));
    const centerRows = tilesY - topRows - bottomRows;

    const prevBiome = (this.selectedBiome + 11) % 12;
    const nextBiome = (this.selectedBiome + 1)  % 12;

    // River strip: 2 tiles wide, centred in the center band.
    // Skipped for Sea (the entire band is already water).
    const showRiver     = this.selectedBiome !== 0;
    const riverMidRow   = topRows + Math.floor(centerRows / 2);
    const riverStartRow = riverMidRow - 1; // inclusive
    const riverEndRow   = riverMidRow + 1; // exclusive (2 tile rows total)

    // Build the biome index grid — needed by detectBoundaries()
    const biomeIdxGrid = new Uint8Array(tilesX * tilesY);

    // All tiles are stamped into a single RenderTexture for one GPU draw call
    this.terrainRt = this.add.renderTexture(0, 0, W, H).setDepth(0);
    // A single off-screen Image reused per tile (setTexture + draw avoids new
    // object allocation each iteration — same technique as GameScene)
    const tileImg = this.add.image(-9999, -9999, 'mw-plains', 0)
      .setScale(2)       // 16px frame → 32px tile
      .setVisible(false);

    for (let ty = 0; ty < tilesY; ty++) {
      // Determine which biome band this row belongs to
      const biomeIdx = ty < topRows
        ? prevBiome
        : ty < topRows + centerRows
          ? this.selectedBiome
          : nextBiome;

      const { elev, temp, moist } = BIOME_PARAMS[biomeIdx];

      for (let tx = 0; tx < tilesX; tx++) {
        // River tiles appear as Sea (priority 0) so BiomeBlend feathers the
        // surrounding biome's colour onto the river's edges — the same
        // river-bank blending behaviour seen in the world map.
        const isRiver = showRiver && ty >= riverStartRow && ty < riverEndRow;
        biomeIdxGrid[ty * tilesX + tx] = isRiver ? 0 : biomeIdx;

        const detail = this.detailNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE, 2, 0.6);

        let tileKey: string;
        let tileFrame: number;
        if (isRiver) {
          // River uses frames 1–3 (livelier than ocean) — mirrors GameScene
          tileKey   = 'terrain-water';
          tileFrame = 1 + (detail > 0.65 ? 2 : detail > 0.35 ? 1 : 0);
        } else {
          // Normal biome tile — detail noise only picks the variant frame
          ({ key: tileKey, frame: tileFrame } = terrainTileFrame(elev, temp, moist, detail));
        }

        tileImg.setTexture(tileKey, tileFrame).setPosition(tx * TILE_SIZE + 16, ty * TILE_SIZE + 16);
        this.terrainRt.draw(tileImg);
      }
    }

    tileImg.destroy();

    // Feathering at both band boundaries and at the river edges
    this.drawBlendStrips(biomeIdxGrid, tilesX, tilesY);

    // Waterfall sprite — centred horizontally on the river, sitting at the
    // top edge of the river strip so it reads as water dropping over the lip.
    // This is a FIL-171 preview: the same sprite will be used in GameScene
    // once waterfall detection (isWaterfallTile) is wired to rendering.
    if (showRiver) {
      const waterfallX = W / 2;
      const waterfallY = riverStartRow * TILE_SIZE; // top of river strip
      const wf = this.add.image(waterfallX, waterfallY, 'waterfall')
        .setOrigin(0.5, 1) // anchor bottom-centre to the top edge of the river
        .setDepth(1.5);
      this.decorSprites.push(wf);
    }

    // Decorations over the center band; river strip is excluded via avoid-rect
    if (showRiver) {
      this.scatterDecorations(W, topRows, centerRows, riverStartRow, riverEndRow);
    } else if (this.selectedBiome !== 0) {
      this.scatterDecorations(W, topRows, centerRows, -1, -1);
    }

    // Band + river labels (right-aligned, centred vertically in each region)
    const rx         = W - 8;
    const topMidY    = (topRows * TILE_SIZE) / 2;
    const centerMidY = topRows * TILE_SIZE + (centerRows * TILE_SIZE) / 2;
    const bottomMidY = (topRows + centerRows) * TILE_SIZE + (bottomRows * TILE_SIZE) / 2;
    const riverPxY   = riverMidRow * TILE_SIZE + TILE_SIZE / 2;

    this.bandLabels.push(
      this.add.text(rx, topMidY,
        `[${prevBiome}] ${BIOME_NAMES[prevBiome]}`, {
          fontSize: '13px', color: '#ffffff',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(1, 0.5).setDepth(11),

      this.add.text(rx, centerMidY,
        `[${this.selectedBiome}] ${BIOME_NAMES[this.selectedBiome]} — selected`, {
          fontSize: '15px', color: '#ffe84d',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(1, 0.5).setDepth(11),

      this.add.text(rx, bottomMidY,
        `[${nextBiome}] ${BIOME_NAMES[nextBiome]}`, {
          fontSize: '13px', color: '#ffffff',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(1, 0.5).setDepth(11),
    );

    if (showRiver) {
      this.bandLabels.push(
        this.add.text(8, riverPxY, '~ river ~', {
          fontSize: '11px', color: '#88ccff',
          stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0, 0.5).setDepth(11),
      );
    }
  }

  /**
   * Draws the 8px feathered strips at each biome boundary.
   * Mirrors GameScene.drawBiomeBlendStrips() exactly.
   */
  private drawBlendStrips(biomeIdxGrid: Uint8Array, tilesX: number, tilesY: number): void {
    const T       = TILE_SIZE;
    const STRIP_W = 8;
    const ALPHA   = 0.40;

    const boundaries = detectBoundaries(biomeIdxGrid, tilesX, tilesY);
    if (boundaries.length === 0) return;

    this.blendGfx = this.add.graphics().setDepth(0.46);
    for (const { tx, ty, side, higherBiome } of boundaries) {
      this.blendGfx.fillStyle(BLEND_COLORS[higherBiome], ALPHA);
      switch (side) {
        case 'north': this.blendGfx.fillRect(tx * T,                 ty * T,                 T,       STRIP_W); break;
        case 'south': this.blendGfx.fillRect(tx * T,                 (ty + 1) * T - STRIP_W, T,       STRIP_W); break;
        case 'west':  this.blendGfx.fillRect(tx * T,                 ty * T,                 STRIP_W, T);       break;
        case 'east':  this.blendGfx.fillRect((tx + 1) * T - STRIP_W, ty * T,                 STRIP_W, T);       break;
      }
    }
  }

  /**
   * Scatters decorations over the center band using `generateDecorations()`.
   * The band is treated as a virtual world of width W and height bandH so that
   * Poisson-disk spacing is correct for the actual pixel area being decorated.
   * A biome-specific seed ensures each biome shows its characteristic mix.
   *
   * @param riverStartRow  First river tile row (band-absolute). Pass -1 if no river.
   * @param riverEndRow    Exclusive end river tile row.
   */
  private scatterDecorations(
    W: number, topRows: number, centerRows: number,
    riverStartRow: number, riverEndRow: number,
  ): void {
    const startY = topRows    * TILE_SIZE;
    const bandH  = centerRows * TILE_SIZE;

    // River avoid-rect in band-relative virtual coordinates.
    // Decorations must not appear on water tiles.
    const avoidRects: Array<{ x: number; y: number; w: number; h: number }> = [];
    if (riverStartRow >= 0) {
      const riverBandY = (riverStartRow - topRows) * TILE_SIZE;
      const riverH     = (riverEndRow - riverStartRow) * TILE_SIZE;
      avoidRects.push({ x: 0, y: riverBandY, w: W, h: riverH });
    }

    const decors = generateDecorations(
      // Biome-specific seed — same biome always produces the same scatter
      0xbabe_cafe + this.selectedBiome,
      W, bandH,
      TILE_SIZE,
      avoidRects,
      300,  // decoration cap — enough for a clear impression without clutter
    );

    for (const d of decors) {
      const sprite = this.add.image(d.x, d.y + startY, decorTexture(d.type, d.variant));
      sprite.setScale(d.scale);
      // Painter's algorithm depth: decorations lower on screen draw in front
      sprite.setDepth(2 + (d.y + startY) / this.scale.height);
      this.decorSprites.push(sprite);
    }
  }

  // ── Palette UI ────────────────────────────────────────────────────────────────

  /**
   * Builds the 12-box palette strip at the bottom of the screen.
   * Created once; only the selection border and main label are updated on change.
   */
  private buildPalette(): void {
    const W      = this.scale.width;
    const H      = this.scale.height;
    const PAD    = 4;
    // Scale box width to fill the screen width regardless of viewport size
    const BOX_W  = Math.min(90, Math.floor((W - 13 * PAD) / 12));
    const BOX_H  = 44;
    const startY = H - BOX_H - PAD;

    for (let i = 0; i < 12; i++) {
      const bx = PAD + i * (BOX_W + PAD);

      // Graphics positioned at box origin so fillRect(0,0,w,h) lands correctly
      const gfx = this.add.graphics({ x: bx, y: startY }).setDepth(10);
      gfx.fillStyle(BIOME_OVERLAY_COLORS[i], 1);
      gfx.fillRect(0, 0, BOX_W, BOX_H);
      this.paletteBoxes.push(gfx);

      // Invisible Zone for click detection (Zone centre = box centre)
      this.add.zone(bx + BOX_W / 2, startY + BOX_H / 2, BOX_W, BOX_H)
        .setDepth(12)
        .setInteractive()
        .on('pointerdown', () => this.selectBiome(i));

      // Index number (top-left) and abbreviated name (bottom) inside box
      const abbrev = BIOME_NAMES[i].length > 9 ? BIOME_NAMES[i].slice(0, 8) + '.' : BIOME_NAMES[i];
      this.add.text(bx + 3, startY + 3,          `${i}`,   { fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setDepth(13);
      this.add.text(bx + 3, startY + BOX_H - 14, abbrev,   { fontSize: '9px',  color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setDepth(13);
    }

    // Selection highlight — redrawn by updatePalette()
    this.selectionBorder = this.add.graphics().setDepth(14);

    // Main biome name label (top-left corner)
    this.biomeLabel = this.add.text(8, 8, '', {
      fontSize: '18px', color: '#ffe84d',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(11);

    // Controls hint just above the palette
    this.add.text(PAD, startY - 20, '← → or A/D: cycle biomes     click swatch: jump to biome', {
      fontSize: '11px', color: '#aaaaaa',
      stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);

    this.updatePalette();
  }

  /** Updates the selection border and biome label to match `selectedBiome`. */
  private updatePalette(): void {
    const H      = this.scale.height;
    const PAD    = 4;
    const BOX_W  = Math.min(90, Math.floor((this.scale.width - 13 * PAD) / 12));
    const BOX_H  = 44;
    const bx     = PAD + this.selectedBiome * (BOX_W + PAD);
    const by     = H - BOX_H - PAD;

    this.selectionBorder!.clear();
    this.selectionBorder!.lineStyle(3, 0xffffff, 1);
    this.selectionBorder!.strokeRect(bx - 2, by - 2, BOX_W + 4, BOX_H + 4);

    this.biomeLabel!.setText(`[${this.selectedBiome}]  ${BIOME_NAMES[this.selectedBiome]}`);
  }
}
