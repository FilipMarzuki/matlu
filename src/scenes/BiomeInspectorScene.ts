/**
 * BiomeInspectorScene — dev tool for visually inspecting biome tile sets,
 * biome-boundary feathering, and decoration scatter.
 *
 * Access: navigate to /biome in the URL.
 *
 * ## Layout
 *   top 25% = prev biome / feather / centre 50% = selected / feather / bottom 25% = next
 *
 * ## Controls
 *   LEFT / RIGHT or A / D   Cycle through all 12 biomes
 *   Scroll wheel / +/-       Zoom in / out
 *   Click palette box        Jump directly to that biome
 *   E                        Remove the placed entity
 *   C                        Clear all placed objects
 *
 * ## Layout extras
 *   SE corner                Ocean with 2-tile shoreline (rocky → sandy)
 *   NW corner                Highland elevation strip (dry heath → cold granite → snow)
 *   River                    Snaking sine-wave meander through the center band
 */

import * as Phaser from 'phaser';
import { isoTileFrame, ISO_RIVER_FRAME } from '../world/IsoTileMap';
import { BIOMES } from '../world/biomes';

const BIOME_NAMES          = BIOMES.map(b => b.name);
const BIOME_OVERLAY_COLORS = BIOMES.map(b => b.overlayColor);

const ENTITY_TYPES = [
  { key: 'tinkerer', color: 0x44aaff, label: 'Tinkerer', atlasKey: 'tinkerer' as string | null },
  { key: 'skald',    color: 0x7799ee, label: 'Skald',    atlasKey: 'skald'    as string | null },
  { key: 'loke',     color: 0xaa55ff, label: 'Loke',     atlasKey: 'loke'     as string | null },
  { key: 'Enemy',    color: 0xff4444, label: 'Enemy',    atlasKey: null },
  { key: 'NPC',      color: 0x44dd44, label: 'NPC',      atlasKey: null },
  { key: 'Animal',   color: 0xffaa22, label: 'Animal',   atlasKey: null },
] as const;

type EntityKey = typeof ENTITY_TYPES[number]['key'];

// `height` drives how tall the placeholder box is (px) — taller objects grow upward.
const OBJECT_TYPES = [
  { key: 'Tree',    color: 0x226622, label: 'Tree',    height: 28 },
  { key: 'Stone',   color: 0x999999, label: 'Stone',   height: 12 },
  { key: 'Boulder', color: 0x777777, label: 'Boulder', height: 16 },
  { key: 'Shrub',   color: 0x55bb44, label: 'Shrub',   height: 10 },
] as const;

type ObjectKey = typeof OBJECT_TYPES[number]['key'];

export class BiomeInspectorScene extends Phaser.Scene {
  // Default to biome 6 (Meadow). The ?biome=<idx> URL param overrides this so
  // the wiki's per-card "View in World Forge" links land on the right biome.
  private selectedBiome = (() => {
    const p = parseInt(new URLSearchParams(window.location.search).get('biome') ?? '', 10);
    return (!isNaN(p) && p >= 0 && p < 12) ? p : 6;
  })();
  // Secondary biome shown on the left/right edges. Defaults to the one after the main biome.
  private selectedSecBiome = (this.selectedBiome + 1) % 12;

  // Layout constants lifted to class level so screenToTile() can access them.
  private readonly GRID        = 30;
  private readonly PAL_AREA    = 104;  // two palette rows (44 main + 28 secondary) + gaps
  private readonly SEC_BOX_H   = 28;   // height of secondary biome swatch row

  // Zoom multiplier — mouse wheel / +/- keys adjust this, then refreshDisplay().
  // ISO_W/H/SCALE are getters so all coordinate math automatically scales.
  // Set to 1.0 here; overwritten early in create() to auto-fit the canvas.
  private zoomFactor = 1.0;
  private get ISO_SCALE() { return 0.75 * this.zoomFactor; }
  private get ISO_W()     { return 24   * this.zoomFactor; }
  private get ISO_H()     { return 12   * this.zoomFactor; }

  // Computed in buildDisplay(), referenced by screenToTile() + isoPos().
  private originX = 0;
  private originY = 0;

  // Terrain layers (rebuilt on biome change).
  private tileImages:   Phaser.GameObjects.Image[]    = [];
  private cliffObjs:    Phaser.GameObjects.Graphics[] = [];  // cliff-face graphics
  private blendGfx?:    Phaser.GameObjects.Graphics;
  private gridGfx?:     Phaser.GameObjects.Graphics;
  private decorSprites: Phaser.GameObjects.Image[] = [];
  private bandLabels:   Phaser.GameObjects.Text[]  = [];

  // Palette UI (built once).
  private paletteBoxes:    Phaser.GameObjects.Graphics[] = [];
  private selectionBorder?:    Phaser.GameObjects.Graphics;
  private secSelectionBorder?: Phaser.GameObjects.Graphics;
  private biomeLabel?:         Phaser.GameObjects.Text;
  private toolStatusText?:     Phaser.GameObjects.Text;   // "MC selected — click tile to place"

  // Entity spawner state (FIL-463) — one entity at a time.
  private selectedEntityKey: EntityKey | null = null;
  private placedEntity?:      Phaser.GameObjects.Graphics;
  private placedEntitySprite?: Phaser.GameObjects.Sprite;
  private placedEntityLabel?:  Phaser.GameObjects.Text;
  private entitySelBorder?:   Phaser.GameObjects.Graphics;

  // Object placer state (FIL-464) — multiple objects across tiles.
  private selectedObjectKey: ObjectKey | null = null;
  private placedObjects = new Map<string, { gfx: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  private objectSelBorder?: Phaser.GameObjects.Graphics;

  // Decoration painter state (FIL-465) — per-biome scatter on tiles.
  private selectedDecorKey: string | null = null;
  private placedDecors = new Map<string, { gfx: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  // Decor toolbar buttons rebuilt on biome change (zone, gfx, text per type).
  private decorRowObjs: Phaser.GameObjects.GameObject[] = [];
  private decorSelBorder?: Phaser.GameObjects.Graphics;

  constructor() { super({ key: 'BiomeInspectorScene' }); }

  preload(): void {
    this.load.spritesheet('iso-tiles',
      '/assets/packs/isometric tileset/spritesheet.png',
      { frameWidth: 32, frameHeight: 32 });

    // Hero atlases — loaded so entity spawner can show actual sprites.
    this.load.atlas('tinkerer',
      '/assets/sprites/characters/earth/heroes/tinkerer/tinkerer.png',
      '/assets/sprites/characters/earth/heroes/tinkerer/tinkerer.json');
    this.load.atlas('skald',
      '/assets/sprites/characters/earth/heroes/skald/skald.png',
      '/assets/sprites/characters/earth/heroes/skald/skald.json');
    this.load.atlas('loke',
      '/assets/sprites/characters/mistheim/heroes/loke/loke.png',
      '/assets/sprites/characters/mistheim/heroes/loke/loke.json');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');

    // Auto-fit: find the zoom that makes the iso diamond fill ~95% of the
    // tighter screen dimension, leaving only a small margin on each side.
    //
    // Diamond extents at zoom z:
    //   width  = (GRID - 1) * 24 * z   (west tip to east tip)
    //   height = (GRID + 1) * 12 * z   (north apex to south apex + one tile)
    //
    // Solve for z so the diamond reaches 95% of each dimension, then take
    // the smaller value so it fits inside the screen in both axes.
    const usableH = this.scale.height - this.PAL_AREA;
    const fitW    = (this.scale.width * 0.95) / ((this.GRID - 1) * 24);
    const fitH    = (usableH          * 0.95) / ((this.GRID + 1) * 12);
    this.zoomFactor = Math.min(fitW, fitH);

    this.buildDisplay();
    this.buildPalette();
    this.buildSpawnerToolbar();

    this.input.keyboard!.on('keydown-LEFT',  () => this.cycleBiome(-1));
    this.input.keyboard!.on('keydown-RIGHT', () => this.cycleBiome(+1));
    this.input.keyboard!.on('keydown-A',     () => this.cycleBiome(-1));
    this.input.keyboard!.on('keydown-D',     () => this.cycleBiome(+1));
    this.input.keyboard!.on('keydown-W',     () => this.cycleSecBiome(-1));
    this.input.keyboard!.on('keydown-S',     () => this.cycleSecBiome(+1));
    this.input.keyboard!.on('keydown-E',     () => this.clearEntity());
    this.input.keyboard!.on('keydown-C',     () => { this.clearObjects(); this.clearDecors(); });

    // Zoom — scroll wheel or +/- keys. Clamp to [0.25, 3]. On zoom, entity/object
    // graphics stay at old screen coords so we clear them to avoid misalignment.
    const applyZoom = (factor: number) => {
      this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor * factor, 0.25, 3.0);
      this.clearEntity();
      this.clearObjects();
      this.clearDecors();
      this.refreshDisplay();
    };
    this.input.on('wheel',
      (_: Phaser.Input.Pointer, __: unknown, ___: unknown, deltaY: number) => {
        applyZoom(deltaY > 0 ? 0.88 : 1.0 / 0.88);
      });
    this.input.keyboard!.on('keydown-PLUS',        () => applyZoom(1.15));
    this.input.keyboard!.on('keydown-NUMPAD_ADD',  () => applyZoom(1.15));
    this.input.keyboard!.on('keydown-MINUS',       () => applyZoom(1 / 1.15));
    this.input.keyboard!.on('keydown-NUMPAD_MINUS',() => applyZoom(1 / 1.15));

    // Click a tile to place entity or object. Palette / toolbar clicks produce
    // out-of-bounds tile coords, so screenToTile() returns null and nothing fires.
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      const tile = this.screenToTile(ptr.x, ptr.y);
      if (!tile) return;
      if (this.selectedEntityKey !== null) {
        this.placeEntity(tile.tx, tile.ty);
      } else if (this.selectedObjectKey !== null) {
        this.toggleObject(tile.tx, tile.ty);
      } else if (this.selectedDecorKey !== null) {
        this.toggleDecor(tile.tx, tile.ty);
      }
    });
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────────

  /** Screen position of the north apex of tile (tx, ty). Centre = (x, y + ISO_H/2). */
  private isoPos(tx: number, ty: number): { x: number; y: number } {
    return {
      x: this.originX + (tx - ty) * (this.ISO_W / 2),
      y: this.originY + (tx + ty) * (this.ISO_H / 2),
    };
  }

  /**
   * Inverse of isoPos. Converts screen (px, py) to nearest tile coords.
   * Returns null when the result falls outside [0, GRID).
   *
   * From the iso equations:
   *   a = tx - ty = (px - originX) * 2 / ISO_W
   *   b = tx + ty = (py - originY) * 2 / ISO_H
   *   tx = round((a + b) / 2),  ty = round((b - a) / 2)
   */
  private screenToTile(px: number, py: number): { tx: number; ty: number } | null {
    const a = (px - this.originX) * 2 / this.ISO_W;
    const b = (py - this.originY) * 2 / this.ISO_H;
    const tx = Math.round((a + b) / 2);
    const ty = Math.round((b - a) / 2);
    if (tx < 0 || ty < 0 || tx >= this.GRID || ty >= this.GRID) return null;
    return { tx, ty };
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

  private cycleSecBiome(delta: number): void {
    this.selectedSecBiome = (this.selectedSecBiome + 12 + delta) % 12;
    this.refreshDisplay();
  }

  private selectSecBiome(idx: number): void {
    if (idx === this.selectedSecBiome) return;
    this.selectedSecBiome = idx;
    this.refreshDisplay();
  }

  /** Tears down terrain/blend/decor layers and rebuilds. Entity/object Graphics persist. */
  private refreshDisplay(): void {
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];
    for (const g of this.cliffObjs) g.destroy();
    this.cliffObjs = [];
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
    this.refreshDecorRow();
  }

  // ── Terrain ───────────────────────────────────────────────────────────────────

  private buildDisplay(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // Left/right secondary bands — both sides show selectedSecBiome so you see one clean
    // biome-pair transition (secondary ← main → secondary). Cycle with W/S or the second row.
    const SIDE_CUT = Math.floor((this.GRID - 1) * 0.55);  // ~16 at GRID=30 → ~55% centre
    const secBiome = this.selectedSecBiome;

    const showRiver = this.selectedBiome !== 0;
    // River flows N→S: parameterize by diagonal depth d = tx+ty (same axis as the ocean/highland strips).
    // riverCenter(d) returns the tx value of the river centre at depth d.
    // d/2 keeps the river threading down the middle of the diamond; the two sine terms add meander.
    const riverCenter = (d: number) =>
      Math.round(d / 2 + Math.sin(d * 0.35) * 3 + Math.cos(d * 0.65) * 1.5);

    // SE ocean: tiles where (tx + ty) > OCEAN_CUT_SE are sea; two tiles of shoreline inside.
    // NW elevation: tiles where (tx + ty) < ELEV_CUT are highlands; two tiles of transition outside.
    // Both use the same diagonal axis (tx+ty = iso "depth") so the strips are symmetric.
    const G_MAX    = 2 * (this.GRID - 1);                  // 58 for GRID=30
    const ELEV_CUT  = Math.floor(this.GRID * 0.35);        // ~10 — NW highland strip
    const OCEAN_CUT = G_MAX - ELEV_CUT;                    // ~48 — symmetric SE ocean strip

    // Diagonal midpoint used for the river label (declared after ELEV_CUT/OCEAN_CUT).
    const riverMidDiag = Math.floor((ELEV_CUT + OCEAN_CUT) / 2);

    // ── Elevation ─────────────────────────────────────────────────────────────
    // CLIFF_H: how many pixels a highland tile is raised on-screen.
    // getElev: returns 1 (highland) or 0 (lowland) for any tile — reuses the
    //   same curveDepth perturbation as the main tile loop so the cliff edge
    //   exactly matches the visual boundary.
    const CLIFF_H  = Math.round(this.ISO_H * 3.5);
    const getElev  = (tx: number, ty: number): 0 | 1 =>
      (ELEV_CUT + curveDepth(tx - ty) - (tx + ty)) > 0 ? 1 : 0;

    // ── Curved boundary helpers ───────────────────────────────────────────────
    // Each boundary is perturbed by two overlapping sine waves so it curves
    // naturally instead of being a straight diagonal line.
    //
    // curveSide(diag):  used for the left/right biome band edges.
    //   Parameter is tx+ty (the depth axis — runs *along* the left/right boundary).
    // curveDepth(horiz): used for the ocean shoreline and highland edge.
    //   Parameter is tx−ty (the horizontal axis — runs *along* those boundaries).
    const curveSide  = (d: number) =>
      Math.round(Math.sin(d * 0.27) * 3 + Math.cos(d * 0.61) * 1.5);   // ±~4.5 tiles
    const curveDepth = (h: number) =>
      Math.round(Math.sin(h * 0.29) * 2.5 + Math.cos(h * 0.53) * 1.5); // ±~4 tiles

    const usableH  = H - this.PAL_AREA;
    const diamondH = this.GRID * this.ISO_H + this.ISO_H;

    // Store for screenToTile() — layout is fixed for a given screen size.
    this.originX = W / 2;
    this.originY = Math.round((usableH - diamondH) / 2 + this.ISO_H / 2);

    // Painter's algorithm: iterate diagonals (constant tx+ty = back row) so
    // each tile is created after every tile it could visually occlude.
    // Same-depth objects in Phaser render in creation order, so this gives
    // correct front-to-back layering for cube-style iso tiles with visible
    // front faces — no per-tile depth values needed.
    const G = this.GRID;
    for (let sum = 0; sum < G * 2 - 1; sum++) {
      const txMin = Math.max(0, sum - (G - 1));
      const txMax = Math.min(sum, G - 1);
      for (let tx = txMin; tx <= txMax; tx++) {
        const ty = sum - tx;

        const elev  = ((tx * 3 + ty * 7) % 10) / 10;
        const diag  = tx + ty;
        const horiz = tx - ty;

        // Curved thresholds — each boundary wavers by a few tiles instead of being a
        // straight diagonal line. The curve parameter is the axis *parallel* to the edge.
        const effSideCut  = SIDE_CUT  + curveSide(diag);   // left/right biome band edges
        const effOceanCut = OCEAN_CUT + curveDepth(horiz);  // SE ocean shoreline
        const effElevCut  = ELEV_CUT  + curveDepth(horiz);  // NW highland edge

        // Left/right bands: tiles far from the centre diagonal show the secondary biome.
        const landBiome = Math.abs(horiz) > effSideCut ? secBiome : this.selectedBiome;

        const oceanDist = diag - effOceanCut;   // > 0 = inside SE ocean
        const elevDist  = effElevCut - diag;    // > 0 = inside NW highlands

        // River channel: starts just below the curved highland edge.
        const onRiver = showRiver && diag > effElevCut + 1 && Math.abs(tx - riverCenter(diag)) <= 1;
        let frame: number;

        if (oceanDist > 1) {
          frame = isoTileFrame(0, elev);           // deep ocean (river can't override this)
        } else if (oceanDist === 1) {
          frame = ISO_RIVER_FRAME;                 // shallow ocean — also river mouth colour
        } else if (oceanDist === 0) {
          // Sandy shore — river cuts through as a water channel
          frame = onRiver ? ISO_RIVER_FRAME : isoTileFrame(2, elev);
        } else if (oceanDist === -1) {
          // Rocky shore — river cuts through rather than leaving a rocky dam
          frame = onRiver ? ISO_RIVER_FRAME : isoTileFrame(1, elev);
        } else if (elevDist > 1) {
          frame = isoTileFrame(11, elev);          // snow / high summit
        } else if (elevDist === 1) {
          frame = isoTileFrame(10, elev);          // bare summit edge
        } else if (elevDist === 0) {
          frame = isoTileFrame(9, elev);           // cold granite
        } else if (elevDist === -1) {
          frame = isoTileFrame(4, elev);           // dry heath (highland foot)
        } else if (onRiver) {
          frame = ISO_RIVER_FRAME;                 // N→S river body
        } else {
          frame = isoTileFrame(landBiome, elev);   // land biome
        }

        // Raise highland tiles by CLIFF_H so the terrain steps up visually.
        const tileElev = elevDist > 0 ? 1 : 0;
        const { x, y } = this.isoPos(tx, ty);
        const img = this.add.image(x, y - this.ISO_H / 2 - tileElev * CLIFF_H, 'iso-tiles', frame)
          .setScale(this.ISO_SCALE)
          .setOrigin(0.5, 0)
          .setDepth(0);
        this.tileImages.push(img);
      }
    }

    // ── Cliff-face pass ───────────────────────────────────────────────────────
    // Created AFTER all tile images so they render on top (Phaser creation order
    // within the same depth layer). For each highland tile that has a lower
    // southern neighbour, fill the gap between the raised tile and ground level.
    // Where the river crosses the edge → waterfall face instead of rock.
    for (let cf = 0; cf < G * 2 - 1; cf++) {
      const txMinC = Math.max(0, cf - (G - 1));
      const txMaxC = Math.min(cf, G - 1);
      for (let txC = txMinC; txC <= txMaxC; txC++) {
        const tyC = cf - txC;
        if (getElev(txC, tyC)       !== 1) continue;  // must be highland
        if (tyC + 1 >= G)                  continue;
        if (getElev(txC, tyC + 1)   !== 0) continue;  // south neighbour must be lowland

        const { x: cx, y: cy } = this.isoPos(txC, tyC);
        const hw     = this.ISO_W / 2;
        // The bottom of the tile sprite at ground level is cy + ISO_H * 1.5.
        // When raised by CLIFF_H that same edge moves up by CLIFF_H, leaving a gap.
        const faceBottom = cy + this.ISO_H * 1.5;
        const faceTop    = faceBottom - CLIFF_H;

        const dC    = txC + tyC;
        const isWF  = showRiver && Math.abs(txC - riverCenter(dC)) <= 1;

        const gfx = this.add.graphics();  // depth 0 — created after tiles, renders on top

        if (isWF) {
          // Waterfall: deep-blue base + lighter vertical foam streaks
          gfx.fillStyle(0x1155aa, 0.93);
          gfx.fillRect(cx - hw, faceTop, hw * 2, CLIFF_H);
          gfx.fillStyle(0xbbeeff, 0.55);
          for (let s = 0; s < 3; s++) {
            const sx = cx - hw * 0.55 + s * (hw * 0.5);
            gfx.fillRect(sx, faceTop + 2, hw * 0.2, CLIFF_H - 4);
          }
        } else {
          // Rocky cliff: dark base + lighter rim where light hits the top edge
          gfx.fillStyle(0x2a1e10, 0.96);
          gfx.fillRect(cx - hw, faceTop, hw * 2, CLIFF_H);
          gfx.fillStyle(0x5c4a2e, 0.4);
          gfx.fillRect(cx - hw, faceTop, hw * 2, CLIFF_H * 0.18);
        }
        // Thin outline
        gfx.lineStyle(1, 0x000000, 0.35);
        gfx.strokeRect(cx - hw, faceTop, hw * 2, CLIFF_H);

        this.cliffObjs.push(gfx);
      }
    }

    // Waterfall label — floats above the cliff tile where the river exits the highlands.
    if (showRiver) {
      const wfDiag = ELEV_CUT;
      const wfTx   = Phaser.Math.Clamp(riverCenter(wfDiag), 0, G - 1);
      const wfTy   = Phaser.Math.Clamp(wfDiag - wfTx, 0, G - 1);
      const { x: wlx, y: wly } = this.isoPos(wfTx, wfTy);
      this.bandLabels.push(
        this.add.text(wlx, wly - CLIFF_H - 6, '\u2193 waterfall',
          { fontSize: '11px', color: '#88eeff', stroke: '#000000', strokeThickness: 2 },
        ).setOrigin(0.5, 1).setDepth(G * 2 + 10),
      );
    }

    // Grid outline
    this.gridGfx = this.add.graphics().setDepth(2);
    this.gridGfx.lineStyle(1, 0x000000, 0.20);
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;
    for (let ty = 0; ty < this.GRID; ty++) {
      for (let tx = 0; tx < this.GRID; tx++) {
        const { x: cx, y: cy } = this.isoPos(tx, ty);
        this.gridGfx.beginPath();
        this.gridGfx.moveTo(cx,      cy - hh);
        this.gridGfx.lineTo(cx + hw, cy);
        this.gridGfx.lineTo(cx,      cy + hh);
        this.gridGfx.lineTo(cx - hw, cy);
        this.gridGfx.closePath();
        this.gridGfx.strokePath();
      }
    }

    // Band labels — one for the right secondary strip (NE screen area),
    // one for the centre main biome, one for the left secondary strip (SW screen area).
    const labelRx   = W - 8;   // right-aligned labels
    const labelLx   = 8;       // left-aligned label for the left secondary band

    // Right secondary: visible in the top-right area of the diamond (high tx, low ty → high tx−ty).
    const { y: rightLabelY  } = this.isoPos(G - 1, Math.floor(G * 0.08));
    // Centre main: use the middle of the right screen edge for height alignment.
    const { y: centerLabelY } = this.isoPos(G - 1, Math.floor(G * 0.5));
    // Left secondary: visible in the bottom-left area (low tx, high ty → low tx−ty).
    const { y: leftLabelY   } = this.isoPos(Math.floor(G * 0.08), G - 1);

    this.bandLabels.push(
      this.add.text(labelRx, rightLabelY,
        `[${secBiome}] ${BIOME_NAMES[secBiome]}`,
        { fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 },
      ).setOrigin(1, 0.5).setDepth(11),

      this.add.text(labelRx, centerLabelY,
        `[${this.selectedBiome}] ${BIOME_NAMES[this.selectedBiome]} \u2014 selected`,
        { fontSize: '15px', color: '#ffe84d', stroke: '#000000', strokeThickness: 3 },
      ).setOrigin(1, 0.5).setDepth(11),

      this.add.text(labelLx, leftLabelY,
        `[${secBiome}] ${BIOME_NAMES[secBiome]}`,
        { fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 },
      ).setOrigin(0, 0.5).setDepth(11),
    );

    if (showRiver) {
      // Label at the river's meander midpoint along its N→S path.
      const rtx = Phaser.Math.Clamp(riverCenter(riverMidDiag), 0, this.GRID - 1);
      const rty = Phaser.Math.Clamp(riverMidDiag - rtx, 0, this.GRID - 1);
      const { x: riverLabelX, y: riverLabelY } = this.isoPos(rtx, rty);
      this.bandLabels.push(
        this.add.text(riverLabelX, riverLabelY, '~ river ~',
          { fontSize: '11px', color: '#88ccff', stroke: '#000000', strokeThickness: 2 },
        ).setOrigin(0.5, 0.5).setDepth(11),
      );
    }

    // Ocean label — centred inside the SE ocean strip.
    // Both tx and ty are large here so tx+ty > OCEAN_CUT.
    const oceanLabelTx = Math.min(this.GRID - 1, Math.floor(this.GRID * 0.87));
    const oceanLabelTy = Math.min(this.GRID - 1, Math.floor(this.GRID * 0.87));
    if (oceanLabelTx + oceanLabelTy > OCEAN_CUT) {
      const { x: olx, y: oly } = this.isoPos(oceanLabelTx, oceanLabelTy);
      this.bandLabels.push(
        this.add.text(olx, oly, '~ ocean ~',
          { fontSize: '11px', color: '#4488ff', stroke: '#000000', strokeThickness: 2 },
        ).setOrigin(0.5, 0.5).setDepth(11),
      );
    }

    // Highlands label — centred inside the NW elevation strip.
    // Both tx and ty are small here so tx+ty < ELEV_CUT.
    const elevLabelTx = Math.floor(this.GRID * 0.12);
    const elevLabelTy = Math.floor(this.GRID * 0.12);
    if (elevLabelTx + elevLabelTy < ELEV_CUT) {
      const { x: hlx, y: hly } = this.isoPos(elevLabelTx, elevLabelTy);
      this.bandLabels.push(
        this.add.text(hlx, hly, '~ highlands ~',
          { fontSize: '11px', color: '#ccddff', stroke: '#000000', strokeThickness: 2 },
        ).setOrigin(0.5, 0.5).setDepth(11),
      );
    }
  }

  // ── Palette UI ────────────────────────────────────────────────────────────────

  private buildPalette(): void {
    const W          = this.scale.width;
    const H          = this.scale.height;
    const PAD        = 4;
    const BOX_W      = Math.min(90, Math.floor((W - 13 * PAD) / 12));
    const BOX_H      = 44;
    const SEC_BOX_H  = this.SEC_BOX_H;
    const startY     = H - BOX_H - PAD;               // main biome row top-y
    const secStartY  = startY - SEC_BOX_H - PAD;      // secondary biome row top-y

    // ── Main biome row ───────────────────────────────────────────────────────
    for (let i = 0; i < 12; i++) {
      const bx  = PAD + i * (BOX_W + PAD);
      const gfx = this.add.graphics({ x: bx, y: startY }).setDepth(10);
      gfx.fillStyle(BIOME_OVERLAY_COLORS[i], 1);
      gfx.fillRect(0, 0, BOX_W, BOX_H);
      this.paletteBoxes.push(gfx);

      this.add.zone(bx + BOX_W / 2, startY + BOX_H / 2, BOX_W, BOX_H)
        .setDepth(12).setInteractive()
        .on('pointerdown', () => this.selectBiome(i));

      const abbrev = BIOME_NAMES[i].length > 9 ? BIOME_NAMES[i].slice(0, 8) + '.' : BIOME_NAMES[i];
      this.add.text(bx + 3, startY + 3,          `${i}`,  { fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setDepth(13);
      this.add.text(bx + 3, startY + BOX_H - 14, abbrev,  { fontSize: '9px',  color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setDepth(13);
    }

    // ── Secondary biome row (smaller, dimmer) ────────────────────────────────
    this.add.text(PAD, secStartY - 13, 'Secondary (W/S):', {
      fontSize: '9px', color: '#88aaff', stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);

    for (let i = 0; i < 12; i++) {
      const bx  = PAD + i * (BOX_W + PAD);
      const gfx = this.add.graphics({ x: bx, y: secStartY }).setDepth(10);
      gfx.fillStyle(BIOME_OVERLAY_COLORS[i], 0.65);  // slightly dimmer than main row
      gfx.fillRect(0, 0, BOX_W, SEC_BOX_H);

      this.add.zone(bx + BOX_W / 2, secStartY + SEC_BOX_H / 2, BOX_W, SEC_BOX_H)
        .setDepth(12).setInteractive()
        .on('pointerdown', () => this.selectSecBiome(i));

      const abbrev = BIOME_NAMES[i].length > 9 ? BIOME_NAMES[i].slice(0, 8) + '.' : BIOME_NAMES[i];
      this.add.text(bx + 3, secStartY + SEC_BOX_H / 2 - 5, abbrev, {
        fontSize: '8px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setDepth(13);
    }

    this.selectionBorder    = this.add.graphics().setDepth(14);
    this.secSelectionBorder = this.add.graphics().setDepth(14);
    this.biomeLabel = this.add.text(8, 8, '', {
      fontSize: '18px', color: '#ffe84d', stroke: '#000000', strokeThickness: 3,
    }).setDepth(11);
    this.toolStatusText = this.add.text(this.scale.width - 8, 8, '', {
      fontSize: '13px', color: '#aaffcc', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0).setDepth(11);

    this.add.text(PAD, secStartY - 30,
      'A/D: main biome   W/S: secondary   scroll/+−: zoom   E: clear entity   C: clear objects',
      { fontSize: '11px', color: '#aaaaaa', stroke: '#000000', strokeThickness: 2 },
    ).setDepth(11);

    this.updatePalette();
  }

  private updatePalette(): void {
    const H         = this.scale.height;
    const PAD       = 4;
    const BOX_W     = Math.min(90, Math.floor((this.scale.width - 13 * PAD) / 12));
    const BOX_H     = 44;
    const SEC_BOX_H = this.SEC_BOX_H;
    const mainY     = H - BOX_H - PAD;
    const secY      = mainY - SEC_BOX_H - PAD;

    // Main biome border (white)
    this.selectionBorder!.clear();
    this.selectionBorder!.lineStyle(3, 0xffffff, 1);
    const mbx = PAD + this.selectedBiome * (BOX_W + PAD);
    this.selectionBorder!.strokeRect(mbx - 2, mainY - 2, BOX_W + 4, BOX_H + 4);

    // Secondary biome border (cyan tint to distinguish)
    this.secSelectionBorder!.clear();
    this.secSelectionBorder!.lineStyle(2, 0x88ddff, 1);
    const sbx = PAD + this.selectedSecBiome * (BOX_W + PAD);
    this.secSelectionBorder!.strokeRect(sbx - 2, secY - 2, BOX_W + 4, SEC_BOX_H + 4);

    this.biomeLabel!.setText(
      `World Forge \u2014 [${this.selectedBiome}] ${BIOME_NAMES[this.selectedBiome]}` +
      `  \u2194  [${this.selectedSecBiome}] ${BIOME_NAMES[this.selectedSecBiome]}`
    );
  }

  /** Updates the top-right status line with the currently active tool. */
  private updateToolStatus(): void {
    if (!this.toolStatusText) return;
    let msg = '';
    if      (this.selectedEntityKey) msg = `\u25b6 ${this.selectedEntityKey} — click tile to place  (E = remove)`;
    else if (this.selectedObjectKey) msg = `\u25b6 ${this.selectedObjectKey} — click tile to toggle  (C = clear all)`;
    else if (this.selectedDecorKey)  msg = `\u25b6 ${this.selectedDecorKey} — click tile to toggle  (C = clear all)`;
    this.toolStatusText.setText(msg);
  }

  // ── Spawner toolbar ───────────────────────────────────────────────────────────

  /**
   * Two toolbars above the controls hint:
   *   Left  — entity types (MC / Enemy / NPC / Animal)
   *   Right — object types (Tree / Stone / Boulder / Shrub)
   * Only one tool active at a time; re-clicking the active button deselects it.
   */
  private buildSpawnerToolbar(): void {
    const W      = this.scale.width;
    const H      = this.scale.height;
    const PAD    = 4;
    const BOX_H  = 44;
    const startY = H - BOX_H - PAD;
    const TOOL_Y = startY - this.SEC_BOX_H - 4 - 58;  // clear secondary palette row + controls hint
    const BTN_W  = 54;
    const BTN_H  = 24;
    const BTN_G  = 3;

    this.add.text(PAD, TOOL_Y - 13, 'Entities:', {
      fontSize: '10px', color: '#88aaff', stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);

    for (let i = 0; i < ENTITY_TYPES.length; i++) {
      const et = ENTITY_TYPES[i];
      const bx = PAD + i * (BTN_W + BTN_G);
      const gfx = this.add.graphics({ x: bx, y: TOOL_Y }).setDepth(10);
      gfx.fillStyle(et.color, 0.7);
      gfx.fillRect(0, 0, BTN_W, BTN_H);
      this.add.text(bx + BTN_W / 2, TOOL_Y + BTN_H / 2, et.label, {
        fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(13);
      this.add.zone(bx + BTN_W / 2, TOOL_Y + BTN_H / 2, BTN_W, BTN_H)
        .setDepth(15).setInteractive()
        .on('pointerdown', () => this.selectEntityType(et.key));
    }

    const objStartX = W - OBJECT_TYPES.length * (BTN_W + BTN_G) - PAD + BTN_G;
    this.add.text(objStartX, TOOL_Y - 13, 'Objects:', {
      fontSize: '10px', color: '#aaffaa', stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);

    for (let i = 0; i < OBJECT_TYPES.length; i++) {
      const ot = OBJECT_TYPES[i];
      const bx = objStartX + i * (BTN_W + BTN_G);
      const gfx = this.add.graphics({ x: bx, y: TOOL_Y }).setDepth(10);
      gfx.fillStyle(ot.color, 0.7);
      gfx.fillRect(0, 0, BTN_W, BTN_H);
      this.add.text(bx + BTN_W / 2, TOOL_Y + BTN_H / 2, ot.label, {
        fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(13);
      this.add.zone(bx + BTN_W / 2, TOOL_Y + BTN_H / 2, BTN_W, BTN_H)
        .setDepth(15).setInteractive()
        .on('pointerdown', () => this.selectObjectType(ot.key));
    }

    this.entitySelBorder = this.add.graphics().setDepth(14);
    this.objectSelBorder = this.add.graphics().setDepth(14);
    this.decorSelBorder  = this.add.graphics().setDepth(14);

    this.buildDecorRow();
  }

  // ── Entity spawner (FIL-463) ──────────────────────────────────────────────────

  private selectEntityType(key: EntityKey): void {
    this.selectedEntityKey = this.selectedEntityKey === key ? null : key;
    if (this.selectedEntityKey !== null) { this.selectedObjectKey = null; this.selectedDecorKey = null; }
    this.updateToolbarBorders();
    this.updateToolStatus();
  }

  /**
   * Places (or moves) the entity placeholder onto tile (tx, ty).
   * Heroes: rendered as their actual idle sprite (setOrigin(0.5, 1) at tile south tip).
   * Others: coloured rectangle placeholder + footprint diamond.
   * Depth 5 — above terrain (0) and grid (2), below palette UI (10+).
   */
  private placeEntity(tx: number, ty: number): void {
    this.clearEntity();
    if (this.selectedEntityKey === null) return;
    const et = ENTITY_TYPES.find(e => e.key === this.selectedEntityKey)!;

    const { x: cx, y: cy } = this.isoPos(tx, ty);
    // South tip of the tile diamond = character's feet in top-down iso.
    const footY = cy + this.ISO_H;

    if (et.atlasKey) {
      // Hero — show real idle sprite. Scale matches the tile grid:
      // ISO_SCALE = 0.75 * zoomFactor, same multiplier used for tiles.
      const sprite = this.add.sprite(cx, footY, et.atlasKey, 'idle_south_0')
        .setScale(this.ISO_SCALE)
        .setOrigin(0.5, 1)
        .setDepth(5);

      const label = this.add.text(cx, footY - sprite.displayHeight - 4, et.label, {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(6);

      this.placedEntitySprite = sprite;
      this.placedEntityLabel  = label;
    } else {
      // Generic placeholder (Enemy / NPC / Animal) — footprint + upright rect.
      const hw    = this.ISO_W * 0.5;
      const fh    = this.ISO_H * 0.5;
      const bodyH = this.ISO_H * 2.5;
      const bodyW = hw * 0.6;

      const gfx = this.add.graphics().setDepth(5);

      // Footprint diamond (ground shadow)
      gfx.fillStyle(et.color as number, 0.35);
      gfx.beginPath();
      gfx.moveTo(cx,      footY - fh);
      gfx.lineTo(cx + hw, footY);
      gfx.lineTo(cx,      footY + fh);
      gfx.lineTo(cx - hw, footY);
      gfx.closePath();
      gfx.fillPath();

      // Body rectangle (upright above tile)
      gfx.fillStyle(et.color as number, 0.92);
      gfx.fillRect(cx - bodyW / 2, footY - fh - bodyH, bodyW, bodyH);
      gfx.lineStyle(2, 0xffffff, 0.85);
      gfx.strokeRect(cx - bodyW / 2, footY - fh - bodyH, bodyW, bodyH);

      const label = this.add.text(cx, footY - fh - bodyH - 4, et.label, {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(6);

      this.placedEntity      = gfx;
      this.placedEntityLabel = label;
    }
  }

  private clearEntity(): void {
    this.placedEntity?.destroy();
    this.placedEntity = undefined;
    this.placedEntitySprite?.destroy();
    this.placedEntitySprite = undefined;
    this.placedEntityLabel?.destroy();
    this.placedEntityLabel = undefined;
  }

  // ── Object placer (FIL-464) ───────────────────────────────────────────────────

  private selectObjectType(key: ObjectKey): void {
    this.selectedObjectKey = this.selectedObjectKey === key ? null : key;
    if (this.selectedObjectKey !== null) { this.selectedEntityKey = null; this.selectedDecorKey = null; }
    this.updateToolbarBorders();
    this.updateToolStatus();
  }

  /**
   * Toggle object at tile (tx, ty):
   *   Occupied tile → remove (regardless of selected type)
   *   Empty tile    → place selected object type
   *
   * Placeholder: rect anchored at tile south tip, growing upward.
   * Depth = 3 + ty*10 + tx*0.1 for painter-order depth sorting.
   */
  private toggleObject(tx: number, ty: number): void {
    const key = `${tx},${ty}`;
    const existing = this.placedObjects.get(key);
    if (existing) {
      existing.gfx.destroy();
      existing.label.destroy();
      this.placedObjects.delete(key);
      return;
    }
    if (this.selectedObjectKey === null) return;
    const ot = OBJECT_TYPES.find(o => o.key === this.selectedObjectKey)!;

    const { x: cx, y: cy } = this.isoPos(tx, ty);
    const bx    = cx;
    const by    = cy + this.ISO_H; // south tip of tile diamond
    const depth = 3 + ty * 10 + tx * 0.1;
    const rectW = 14;
    const rectH = ot.height;

    const gfx = this.add.graphics().setDepth(depth);
    gfx.fillStyle(ot.color, 0.88);
    gfx.fillRect(bx - rectW / 2, by - rectH, rectW, rectH);
    gfx.lineStyle(1, 0xffffff, 0.7);
    gfx.strokeRect(bx - rectW / 2, by - rectH, rectW, rectH);

    const label = this.add.text(bx, by - rectH - 2, ot.label, {
      fontSize: '8px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(depth + 0.1);

    this.placedObjects.set(key, { gfx, label });
  }

  private clearObjects(): void {
    for (const { gfx, label } of this.placedObjects.values()) {
      gfx.destroy();
      label.destroy();
    }
    this.placedObjects.clear();
  }

  // ── Toolbar selection highlight ───────────────────────────────────────────────

  private updateToolbarBorders(): void {
    const H      = this.scale.height;
    const W      = this.scale.width;
    const PAD    = 4;
    const BOX_H  = 44;
    const startY = H - BOX_H - PAD;
    const TOOL_Y = startY - this.SEC_BOX_H - 4 - 58;  // clear secondary palette row + controls hint
    const BTN_W  = 54;
    const BTN_H  = 24;
    const BTN_G  = 3;

    this.entitySelBorder!.clear();
    const eIdx = ENTITY_TYPES.findIndex(e => e.key === this.selectedEntityKey);
    if (eIdx >= 0) {
      const bx = PAD + eIdx * (BTN_W + BTN_G);
      this.entitySelBorder!.lineStyle(2, 0xffffff, 1);
      this.entitySelBorder!.strokeRect(bx - 2, TOOL_Y - 2, BTN_W + 4, BTN_H + 4);
    }

    this.objectSelBorder!.clear();
    const oIdx = OBJECT_TYPES.findIndex(o => o.key === this.selectedObjectKey);
    if (oIdx >= 0) {
      const objStartX = W - OBJECT_TYPES.length * (BTN_W + BTN_G) - PAD + BTN_G;
      const bx = objStartX + oIdx * (BTN_W + BTN_G);
      this.objectSelBorder!.lineStyle(2, 0xffffff, 1);
      this.objectSelBorder!.strokeRect(bx - 2, TOOL_Y - 2, BTN_W + 4, BTN_H + 4);
    }

    // Decor border — buttons are positioned by buildDecorRow() at DECOR_Y
    this.decorSelBorder!.clear();
    const DECOR_Y = TOOL_Y - BTN_H - BTN_G - 14;
    const decorTypes = BIOMES[this.selectedBiome].decorTypes ?? [];
    const dIdx = decorTypes.indexOf(this.selectedDecorKey ?? '');
    if (dIdx >= 0) {
      const bx = PAD + dIdx * (BTN_W + BTN_G);
      this.decorSelBorder!.lineStyle(2, 0xffffff, 1);
      this.decorSelBorder!.strokeRect(bx - 2, DECOR_Y - 2, BTN_W + 4, BTN_H + 4);
    }
  }

  // ── Decoration painter (FIL-465) ──────────────────────────────────────────────

  /**
   * Builds the decor toolbar row for the currently selected biome.
   * Called once by buildSpawnerToolbar() and on every biome change via refreshDecorRow().
   * Each decor type gets a button sized identically to entity/object buttons.
   */
  private buildDecorRow(): void {
    const H      = this.scale.height;
    const PAD    = 4;
    const BOX_H  = 44;
    const startY = H - BOX_H - PAD;
    const TOOL_Y = startY - this.SEC_BOX_H - 4 - 58;  // clear secondary palette row + controls hint
    const BTN_W  = 54;
    const BTN_H  = 24;
    const BTN_G  = 3;
    const DECOR_Y = TOOL_Y - BTN_H - BTN_G - 14;

    const decorTypes = BIOMES[this.selectedBiome].decorTypes ?? [];
    if (decorTypes.length === 0) return;

    const header = this.add.text(PAD, DECOR_Y - 13, 'Decor:', {
      fontSize: '10px', color: '#ffddaa', stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);
    this.decorRowObjs.push(header);

    // Use an earthy palette that shifts across button index
    const DECOR_COLORS = [0x8b6914, 0x6b8b14, 0x14698b, 0x8b1468, 0x8b4514, 0x148b45];

    for (let i = 0; i < decorTypes.length; i++) {
      const dKey = decorTypes[i];
      const bx   = PAD + i * (BTN_W + BTN_G);
      const col  = DECOR_COLORS[i % DECOR_COLORS.length];

      const gfx = this.add.graphics({ x: bx, y: DECOR_Y }).setDepth(10);
      gfx.fillStyle(col, 0.7);
      gfx.fillRect(0, 0, BTN_W, BTN_H);
      this.decorRowObjs.push(gfx);

      // Abbreviate long decor names to fit the button
      const abbrev = dKey.length > 9 ? dKey.slice(0, 8) + '.' : dKey;
      const lbl = this.add.text(bx + BTN_W / 2, DECOR_Y + BTN_H / 2, abbrev, {
        fontSize: '9px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(13);
      this.decorRowObjs.push(lbl);

      const zone = this.add.zone(bx + BTN_W / 2, DECOR_Y + BTN_H / 2, BTN_W, BTN_H)
        .setDepth(15).setInteractive()
        .on('pointerdown', () => this.selectDecorType(dKey));
      this.decorRowObjs.push(zone);
    }
  }

  /** Destroys the current decor row and rebuilds it for the new biome. */
  private refreshDecorRow(): void {
    for (const obj of this.decorRowObjs) {
      (obj as Phaser.GameObjects.GameObject).destroy();
    }
    this.decorRowObjs = [];
    this.selectedDecorKey = null;
    this.decorSelBorder?.clear();
    this.buildDecorRow();
  }

  private selectDecorType(key: string): void {
    this.selectedDecorKey = this.selectedDecorKey === key ? null : key;
    if (this.selectedDecorKey !== null) {
      this.selectedEntityKey = null;
      this.selectedObjectKey = null;
    }
    this.updateToolbarBorders();
    this.updateToolStatus();
  }

  /**
   * Toggles a decor placeholder on tile (tx, ty).
   * Decor is flat surface scatter — no painter-order depth sorting needed.
   * Placeholder: a small dot (4 px radius) in the decor type's button colour.
   */
  private toggleDecor(tx: number, ty: number): void {
    const key = `${tx},${ty}`;
    const existing = this.placedDecors.get(key);
    if (existing) {
      existing.gfx.destroy();
      existing.label.destroy();
      this.placedDecors.delete(key);
      return;
    }
    if (this.selectedDecorKey === null) return;

    const { x: cx, y: cy } = this.isoPos(tx, ty);
    const sx = cx;
    const sy = cy + this.ISO_H / 2; // tile surface centre

    const DECOR_COLORS = [0x8b6914, 0x6b8b14, 0x14698b, 0x8b1468, 0x8b4514, 0x148b45];
    const decorTypes = BIOMES[this.selectedBiome].decorTypes ?? [];
    const dIdx = decorTypes.indexOf(this.selectedDecorKey);
    const col  = DECOR_COLORS[dIdx >= 0 ? dIdx % DECOR_COLORS.length : 0];

    // Flat scatter — depth 4, between terrain (0) and entity (5)
    const gfx = this.add.graphics().setDepth(4);
    gfx.fillStyle(col, 0.9);
    gfx.fillCircle(sx, sy, 4);
    gfx.lineStyle(1, 0xffffff, 0.6);
    gfx.strokeCircle(sx, sy, 4);

    const label = this.add.text(sx, sy - 7, this.selectedDecorKey, {
      fontSize: '7px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(4.1);

    this.placedDecors.set(key, { gfx, label });
  }

  private clearDecors(): void {
    for (const { gfx, label } of this.placedDecors.values()) {
      gfx.destroy();
      label.destroy();
    }
    this.placedDecors.clear();
  }
}
