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
import { isoTileFrame, ISO_RIVER_FRAME } from '../world/IsoTileMap';

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── Scene ─────────────────────────────────────────────────────────────────────

export class BiomeInspectorScene extends Phaser.Scene {
  /** Currently inspected biome index (0–11). Default: Meadow. */
  private selectedBiome = 6;

  // Rebuilt on each biome change ---
  private terrainRt?:   Phaser.GameObjects.RenderTexture;
  private blendGfx?:    Phaser.GameObjects.Graphics;
  private gridGfx?:     Phaser.GameObjects.Graphics;
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
    // Isometric tileset — 116 tiles, 32×32 px each, 11 columns × 11 rows.
    // Used for both the BiomeInspector preview and (later) the GameScene terrain bake.
    this.load.spritesheet('iso-tiles',
      'assets/packs/isometric tileset/spritesheet.png',
      { frameWidth: 32, frameHeight: 32 });
  }

  // ── create ───────────────────────────────────────────────────────────────────

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');

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
    this.gridGfx?.destroy();
    this.gridGfx = undefined;
    for (const s of this.decorSprites) s.destroy();
    this.decorSprites = [];
    for (const t of this.bandLabels) t.destroy();
    this.bandLabels = [];

    this.buildDisplay();
    this.updatePalette();
  }

  // ── Terrain + blend + decorations ────────────────────────────────────────────

  /**
   * Draws the 3-band terrain layout as an isometric diamond grid using real
   * tile sprites from the isometric tileset pack.
   *
   * Grid: 30×30 tiles. Each tile is a 32×32 sprite from 'iso-tiles', scaled to
   * ISO_SCALE (0.75×) so the diamond face is 24×12 px on screen. Tiles are baked
   * into a RenderTexture in painter order (ty=0 first = furthest back), so the
   * front face of each row correctly overlaps the diamond of the row in front.
   *
   * Tile selection: `isoTileFrame(biomeIdx, elev)` from IsoTileMap. The `elev`
   * value is derived from (tx, ty) via a deterministic formula so adjacent tiles
   * vary without requiring a noise generator.
   *
   * Isometric formula:
   *   screenX = originX + (tx − ty) × (ISO_W / 2)
   *   screenY = originY + (tx + ty) × (ISO_H / 2)
   */
  private buildDisplay(): void {
    const W     = this.scale.width;
    const H     = this.scale.height;
    const GRID  = 30;

    // Tile dimensions after scaling.
    // The raw iso-tiles sprites are 32×32 px. At ISO_SCALE = 0.75:
    //   - on-screen size: 24×24 px
    //   - diamond face (top half): 24×12 px  → ISO_W=24, ISO_H=12
    //   - front face (bottom half): 24×12 px
    const ISO_SCALE = 0.75;
    const ISO_W     = 24; // diamond width on screen
    const ISO_H     = 12; // diamond height on screen

    // 3-band split: top 25% = prev, centre 50% = selected, bottom 25% = next
    const topRows    = Math.max(2, Math.floor(GRID * 0.25));
    const bottomRows = Math.max(2, Math.floor(GRID * 0.25));
    const centerRows = GRID - topRows - bottomRows;

    const prevBiome = (this.selectedBiome + 11) % 12;
    const nextBiome = (this.selectedBiome + 1)  % 12;

    const showRiver     = this.selectedBiome !== 0;
    const riverMidRow   = topRows + Math.floor(centerRows / 2);
    const riverStartRow = riverMidRow - 1;
    const riverEndRow   = riverMidRow + 1;

    // Centre the diamond in the area above the palette bar (≈68 px).
    const paletteArea = 68;
    const usableH     = H - paletteArea;
    const originX     = W / 2;
    // Diamond tip at top: offset so the full diamond (GRID × ISO_H) + front-face
    // overhang (ISO_H) is centred vertically in the usable area.
    const diamondH = GRID * ISO_H + ISO_H; // includes the bottommost front face
    const originY  = Math.round((usableH - diamondH) / 2 + ISO_H / 2);

    // Tile centre in screen space.
    const isoPos = (tx: number, ty: number) => ({
      x: originX + (tx - ty) * (ISO_W / 2),
      y: originY + (tx + ty) * (ISO_H / 2),
    });

    // ── Terrain tiles baked into a RenderTexture ──────────────────────────────
    // The RT covers the full usable viewport. Tiles are positioned by their
    // screen (x, y) directly — no RT-relative offset needed since the RT starts
    // at (0, 0) and fills the screen.
    this.terrainRt = this.add.renderTexture(0, 0, W, H - paletteArea).setDepth(0);

    // Single off-screen Image, reused for every tile draw (avoids 900 allocations).
    const tileImg = this.add.image(-9999, -9999, 'iso-tiles', 0)
      .setScale(ISO_SCALE)
      .setOrigin(0.5, 0)  // anchor at north apex of the diamond
      .setVisible(false);

    // Draw ty=0 first (furthest back), ty=GRID-1 last (closest to camera).
    // This is the correct painter order — the front face of each tile will be
    // covered by the diamond face of the row directly in front.
    for (let ty = 0; ty < GRID; ty++) {
      const biomeIdx = ty < topRows
        ? prevBiome
        : ty < topRows + centerRows
          ? this.selectedBiome
          : nextBiome;

      const isRiver = showRiver && ty >= riverStartRow && ty < riverEndRow;

      for (let tx = 0; tx < GRID; tx++) {
        // Deterministic elev variation — avoids a noise dependency in the inspector.
        // Different (tx, ty) positions get different frames within the biome range.
        const elev  = ((tx * 3 + ty * 7) % 10) / 10;
        const frame = isRiver ? ISO_RIVER_FRAME : isoTileFrame(biomeIdx, elev);

        const { x, y } = isoPos(tx, ty);
        // y is the diamond centre; origin is (0.5, 0) = north apex, so place at
        // y - ISO_H/2 (the top of the diamond face = north tip of the sprite).
        tileImg.setTexture('iso-tiles', frame).setPosition(x, y - ISO_H / 2);
        this.terrainRt.draw(tileImg);
      }
    }

    tileImg.destroy();

    // ── Grid outline overlay ──────────────────────────────────────────────────
    // Thin diamond outlines on top of the tiles so the grid structure is visible.
    this.gridGfx = this.add.graphics().setDepth(2);
    this.gridGfx.lineStyle(1, 0x000000, 0.20);

    const hw = ISO_W / 2;
    const hh = ISO_H / 2;

    for (let ty = 0; ty < GRID; ty++) {
      for (let tx = 0; tx < GRID; tx++) {
        const { x: cx, y: cy } = isoPos(tx, ty);
        this.gridGfx.beginPath();
        this.gridGfx.moveTo(cx,      cy - hh);
        this.gridGfx.lineTo(cx + hw, cy);
        this.gridGfx.lineTo(cx,      cy + hh);
        this.gridGfx.lineTo(cx - hw, cy);
        this.gridGfx.closePath();
        this.gridGfx.strokePath();
      }
    }

    // Band labels — right-aligned, positioned at the mid-row of each band on
    // the right edge of the diamond (tx = GRID − 1).
    const labelRx     = W - 8;
    const topMidTy    = Math.floor(topRows / 2);
    const centerMidTy = topRows + Math.floor(centerRows / 2);
    const bottomMidTy = topRows + centerRows + Math.floor(bottomRows / 2);

    const { y: topLabelY    } = isoPos(GRID - 1, topMidTy);
    const { y: centerLabelY } = isoPos(GRID - 1, centerMidTy);
    const { y: bottomLabelY } = isoPos(GRID - 1, bottomMidTy);

    this.bandLabels.push(
      this.add.text(labelRx, topLabelY,
        `[${prevBiome}] ${BIOME_NAMES[prevBiome]}`, {
          fontSize: '13px', color: '#ffffff',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(1, 0.5).setDepth(11),

      this.add.text(labelRx, centerLabelY,
        `[${this.selectedBiome}] ${BIOME_NAMES[this.selectedBiome]} — selected`, {
          fontSize: '15px', color: '#ffe84d',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(1, 0.5).setDepth(11),

      this.add.text(labelRx, bottomLabelY,
        `[${nextBiome}] ${BIOME_NAMES[nextBiome]}`, {
          fontSize: '13px', color: '#ffffff',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(1, 0.5).setDepth(11),
    );

    if (showRiver) {
      const { y: riverLabelY } = isoPos(0, riverMidRow);
      this.bandLabels.push(
        this.add.text(8, riverLabelY, '~ river ~', {
          fontSize: '11px', color: '#88ccff',
          stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0, 0.5).setDepth(11),
      );
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
