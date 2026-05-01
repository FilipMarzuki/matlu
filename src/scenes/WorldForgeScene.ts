/**
 * WorldForgeScene — interactive tool for designing and previewing biome tile sets,
 * highland elevation, cliff faces, river/waterfall layout, and decoration scatter.
 *
 * Access: navigate to /biome in the URL.
 *
 * ## Layout
 *   top 25% = prev biome / feather / centre 50% = selected / feather / bottom 25% = next
 *
 * ## Controls
 *   LEFT / RIGHT or A / D   Cycle through all 12 biomes
 *   R                        Cycle road type (dirt / paved / forest / animal)
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
import { isoTileFrame, ISO_RIVER_FRAME, ISO_TILE_NATIVE_SIZE } from '../world/IsoTileMap';
import { BIOMES } from '../world/biomes';
import { CUSTOM_TILE_PACKS, preloadTilePacks } from '../world/TilePacks';

const BIOME_NAMES          = BIOMES.map(b => b.name);
const BIOME_OVERLAY_COLORS = BIOMES.map(b => b.overlayColor);

/**
 * Maps biome index → isometric cliff block tile key.
 * Elevation zones take priority (snow/stone highlands), lowlands fall back to earthy.
 */
const CLIFF_MAT: Record<number, string> = {
  1:  'cliff-stone',   // rocky shore
  3:  'cliff-peat',    // marsh
  9:  'cliff-stone',   // cold granite
  10: 'cliff-stone',   // bare summit
  11: 'cliff-snow',    // snow field
};
const cliffKeyForBiome = (biomeIdx: number): string =>
  CLIFF_MAT[biomeIdx] ?? 'cliff-earthy';

const ENTITY_TYPES = [
  { key: 'tinkerer',            color: 0x44aaff, label: 'Tinkerer',   atlasKey: 'tinkerer'            as string | null },
  { key: 'skald',               color: 0x7799ee, label: 'Skald',      atlasKey: 'skald'               as string | null },
  { key: 'loke',                color: 0xaa55ff, label: 'Loke',       atlasKey: 'loke'                as string | null },
  { key: 'fargglad-kordororn',  color: 0x8b6914, label: 'Kordorörn',  atlasKey: 'fargglad-kordororn'  as string | null },
  { key: 'Enemy',               color: 0xff4444, label: 'Enemy',      atlasKey: null },
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

/** Runtime wander state for AI-driven NPC / Animal entities. */
interface WanderState {
  x: number; y: number;          // current screen-space foot position
  vx: number; vy: number;        // velocity px/s
  timer: number;                 // ms until next direction change
  labelOffsetY: number;          // label y offset relative to foot y (negative = above)
  speed: number;                 // walk speed in px/s
}

export class WorldForgeScene extends Phaser.Scene {
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
  private static readonly ROAD_TYPES = [
    'dirt', 'forest', 'animal',
    'stones-03', 'stones-05', 'stones-06', 'stones-10',
    'stones-19', 'stones-20', 'stones-24', 'stones-32',
    'rocky-29', 'rocky-33',
    'ice-15', 'ice-17', 'ice-28',
    'elements-34',
    'dry-02', 'dry-24', 'dry-32',
  ] as const;
  private roadTypeIdx = 0;

  private zoomFactor = 1.0;
  private get ISO_SCALE() { return 0.75 * this.zoomFactor; }
  private get ISO_W()     { return 24   * this.zoomFactor; }
  private get ISO_H()     { return 12   * this.zoomFactor; }

  // Computed in buildDisplay(), referenced by screenToTile() + isoPos().
  private originX = 0;
  private originY = 0;

  // Terrain layers (rebuilt on biome change).
  private tileImages:   Phaser.GameObjects.Image[]    = [];
  // Waterfall animation: 5-frame loop at 6 FPS, matching the chunky pixel art feel.
  private static readonly WF_FRAMES = 5;
  private static readonly WF_FRAME_MS = 1000 / 6;  // ~167ms per frame
  private wfTimer = 0;
  private wfFrame = 0;
  private wfSprites: Phaser.GameObjects.Image[] = [];
  private splashEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private _splashCounter = 0;
  private _foamCounter = 0;
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

  // Walkability grid — 0 = walkable, 1 = blocked (water or cliff edge).
  // Allocated in buildDisplay(); row-major index: ty * GRID + tx.
  // Matches the layout AStarGrid expects so entity AI can pass it directly.
  walkabilityGrid: Uint8Array = new Uint8Array(0);

  // AI wander toggle — when on, placed NPC/Animal entities wander around the scene.
  private aiEnabled = false;
  private aiToggleGfx?:  Phaser.GameObjects.Graphics;
  private aiToggleText?: Phaser.GameObjects.Text;
  private liveWander: WanderState | null = null;

  constructor() { super({ key: 'WorldForgeScene' }); }

  preload(): void {
    this.load.spritesheet('iso-tiles',
      '/assets/packs/isometric tileset/spritesheet.png',
      { frameWidth: 32, frameHeight: 32 });
    // Cliff tiles — PixelLab isometric block tiles per material.
    // Waterfall: 5-frame lineless block tiles (32x32) — stacked to fill cliff height.
    for (let i = 0; i < 5; i++) {
      this.load.image(`waterfall-${i}`, `/assets/packs/waterfall-tiles/${i}.png`);
    }
    // PixelLab-generated isometric cliff block tiles (32×32, tile_shape:"block").
    // Each shows the full 3D cube: top face + south/east side faces.
    this.load.image('cliff-earthy', '/assets/packs/cliff-iso-gen/earthy_0.png');
    this.load.image('cliff-snow',   '/assets/packs/cliff-iso-gen/snow_0.png');
    this.load.image('cliff-peat',   '/assets/packs/cliff-iso-gen/peat_0.png');
    this.load.image('cliff-stone',  '/assets/packs/cliff-iso-gen/stone_iso_0.png');

    // Custom floor tiles — 4 variants per biome replacing the cluttered stock spritesheet.
    preloadTilePacks(this);

    // SBS Isometric Pathways Pack — one spritesheet per road type (32×16 frames).
    // Pre-converted from 128×64 magenta-keyed by convert-road-tiles.mjs.
    const roadTilesDir = '/assets/sprites/tilesets/roads';
    for (const rtype of WorldForgeScene.ROAD_TYPES) {
      this.load.spritesheet(`road-${rtype}`, `${roadTilesDir}/road-${rtype}.png`,
        { frameWidth: 32, frameHeight: 16 });
    }

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
    this.load.atlas('fargglad-kordororn',
      '/assets/sprites/characters/earth/enemies/fargglad-kordororn/fargglad-kordororn.png',
      '/assets/sprites/characters/earth/enemies/fargglad-kordororn/fargglad-kordororn.json');
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

    // Tiny 2x2 white pixel for splash particles (generated once).
    if (!this.textures.exists('splash-dot')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture('splash-dot', 2, 2);
      g.destroy();
    }

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
    this.input.keyboard!.on('keydown-R',     () => this.cycleRoadType());
    this.input.keyboard!.on('keydown-C',     () => { this.clearObjects(); this.clearDecors(); });

    // Zoom — scroll wheel or +/- keys. Clamp to [0.25, 6]. On zoom, entity/object
    // graphics stay at old screen coords so we clear them to avoid misalignment.
    const applyZoom = (factor: number) => {
      this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor * factor, 0.25, 6.0);
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

    // Camera pan — right-click drag or middle-mouse drag.
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!ptr.isDown) return;
      if (ptr.button === 2 || ptr.button === 1) {
        const cam = this.cameras.main;
        cam.scrollX -= (ptr.x - ptr.prevPosition.x) / cam.zoom;
        cam.scrollY -= (ptr.y - ptr.prevPosition.y) / cam.zoom;
      }
    });
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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

  private cycleRoadType(): void {
    this.roadTypeIdx = (this.roadTypeIdx + 1) % WorldForgeScene.ROAD_TYPES.length;
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
    for (const s of this.wfSprites) s.destroy();
    this.wfSprites = [];
    for (const e of this.splashEmitters) e.destroy();
    this.splashEmitters = [];
    this._splashCounter = 0;
    this._foamCounter = 0;
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
    // CLIFF_H: vertical screen offset per elevation level. Tied to the drawn
    // tile height (native frame × ISO_SCALE) so one storey matches one iso cube
    // in the spritesheet / custom packs — avoids gaps vs arbitrary ISO_H multiples.
    // getElev: returns 1 (highland) or 0 (lowland) for any tile — reuses the
    //   same curveDepth perturbation as the main tile loop so the cliff edge
    //   exactly matches the visual boundary.
    const CLIFF_H = Math.round(ISO_TILE_NATIVE_SIZE * this.ISO_SCALE);
    // LEFT_CUT: tiles where tx−ty > LEFT_CUT are on the right half of the highland,
    // which gets two-stage (stepped) elevation. Left/centre stays at full level-2 height.
    const LEFT_CUT = Math.floor((this.GRID - 1) * 0.25);  // ~7 at GRID=30
    const getElev  = (tx: number, ty: number): 0 | 1 | 2 => {
      const h       = tx - ty;
      const effDist = ELEV_CUT + curveDepth(h) - (tx + ty);
      if (effDist <= 0) return 0;                        // lowland
      if (h > LEFT_CUT) return effDist > 3 ? 2 : 1;     // right side: stepped (inner=2, outer=1)
      return 2;                                           // left/centre: always double-height
    };

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
    // Allocate walkability grid fresh every time the display is rebuilt (biome change, zoom).
    this.walkabilityGrid = new Uint8Array(G * G);
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

        // River channel: flows N→S from the highlands all the way to the ocean.
        // No diagonal restriction — river is visible in highlands too (shows as water tiles).
        const onRiver = showRiver && Math.abs(tx - riverCenter(diag)) <= 1;

        // Splash pool: lowland tiles at the foot of the waterfall cliff.
        // Check 4 orthogonal neighbours — if any is elevated and on the river,
        // this tile borders the waterfall and should be water.
        const myElev = getElev(tx, ty);
        const atWfBase = showRiver && myElev === 0 && (() => {
          const neighbours = [[0,-1],[0,1],[-1,0],[1,0]];
          for (const [dx, dy] of neighbours) {
            const nx = tx + dx, ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
            if (getElev(nx, ny) > 0 && Math.abs(nx - riverCenter(nx + ny)) <= 1) return true;
          }
          return false;
        })();

        let frame: number = 0;
        // Pack name from CUSTOM_TILE_PACKS when this tile should use a custom floor texture.
        // Set in every branch that maps to a biome with a generated tile set.
        let customPack: string | undefined;

        // Shoreline biome depends on the adjacent land — warm/soft biomes get sandy,
        // cold/rocky biomes get rocky shore, marsh stays marshy.
        const SHORE_FOR_BIOME: Record<number, number> = {
          1: 1, 2: 2, 3: 3,   // rocky/sandy/marsh stay themselves
          4: 2, 5: 1, 6: 2,   // dry heath→sandy, coastal heath→rocky, meadow→sandy
          7: 2, 8: 1, 9: 1,   // forest→sandy, spruce→rocky, cold granite→rocky
          10: 1, 11: 1,       // bare summit→rocky, snow→rocky
        };
        const shoreBiome = SHORE_FOR_BIOME[landBiome] ?? 2;

        if (oceanDist > 1) {
          frame = isoTileFrame(0, elev);           // deep ocean — no custom tiles
        } else if (oceanDist > 0) {
          frame = ISO_RIVER_FRAME;                 // shallow ocean / river mouth
        } else if (oceanDist === 0) {
          // Shoreline — 1 tile wide, biome-dependent
          if (onRiver) { frame = ISO_RIVER_FRAME; }
          else { frame = isoTileFrame(shoreBiome, elev); customPack = CUSTOM_TILE_PACKS[shoreBiome]; }
        } else if (elevDist > 1) {
          // Snow field highlands — river shows as water
          if (onRiver || atWfBase) { frame = ISO_RIVER_FRAME; }
          else { frame = isoTileFrame(11, elev); customPack = CUSTOM_TILE_PACKS[11]; }
        } else if (elevDist === 1) {
          if (onRiver || atWfBase) { frame = ISO_RIVER_FRAME; }
          else { frame = isoTileFrame(10, elev); customPack = CUSTOM_TILE_PACKS[10]; }
        } else if (elevDist === 0) {
          if (onRiver || atWfBase) { frame = ISO_RIVER_FRAME; }
          else { frame = isoTileFrame(landBiome, elev); customPack = CUSTOM_TILE_PACKS[landBiome]; }
        } else if (elevDist === -1) {
          if (onRiver || atWfBase) { frame = ISO_RIVER_FRAME; }
          else { frame = isoTileFrame(landBiome, elev); customPack = CUSTOM_TILE_PACKS[landBiome]; }
        } else if (onRiver || atWfBase) {
          frame = ISO_RIVER_FRAME;                 // N→S river body
        } else {
          frame = isoTileFrame(landBiome, elev);
          customPack = CUSTOM_TILE_PACKS[landBiome];
        }

        // Raise highland tiles according to their elevation level (0 = flat, 1 = mid-step, 2 = peak).
        const tileElev = getElev(tx, ty);   // 0 | 1 | 2
        const { x, y } = this.isoPos(tx, ty);
        const posY = y - this.ISO_H / 2 - tileElev * CLIFF_H;
        // Dual-grid tile variant hash — two ~6×6 patch grids offset by (3, 2) tiles
        // so their edges never align. Fine noise blends between them at boundaries for
        // fuzzy natural transitions. All 4 variants per biome share the same base material.
        const px = Math.floor(tx / 6),       py = Math.floor(ty / 6);
        const qx = Math.floor((tx + 3) / 6), qy = Math.floor((ty + 2) / 6);
        const coarse  = ((px * 3571 ^ py * 2297 ^ px * py * 53) >>> 0) % 3;
        const coarse2 = ((qx * 4733 ^ qy * 1867 ^ qx * qy * 97) >>> 0) % 3;
        const fine    = ((tx * 1597 ^ ty * 2833 ^ (tx + ty) * 743) >>> 0) % 7;
        const tileHash = fine === 0 ? 3 : (fine <= 2 ? coarse2 : coarse);

        // Detect cliff edges — any direction where this tile drops to a lower neighbour.
        const southDrop = tileElev > 0 && ty + 1 < G ? tileElev - getElev(tx, ty + 1) : 0;
        const eastDrop  = tileElev > 0 && tx + 1 < G ? tileElev - getElev(tx + 1, ty) : 0;
        const westDrop  = tileElev > 0 && tx > 0     ? tileElev - getElev(tx - 1, ty) : 0;
        const isWF      = showRiver && Math.abs(tx - riverCenter(diag)) <= 1;
        const hasCliff  = southDrop > 0 || eastDrop > 0 || westDrop > 0;

        // Walkability: sea/river water and cliff-edge tiles are impassable.
        // oceanDist > 0 covers deep ocean and the river-mouth shoreline row.
        const isWater = oceanDist > 0 || onRiver || atWfBase;
        this.walkabilityGrid[ty * G + tx] = isWater || hasCliff ? 1 : 0;

        if (hasCliff) {
          // Biome resolution mirrors the floor-tile logic: elevation zones take priority
          // over landBiome so the cliff material matches the floor material exactly.
          const cliffBiomeIdx = elevDist > 1   ? 11
                              : elevDist === 1  ? 10
                              : elevDist === 0  ? 9
                              : oceanDist === 0 ? 2   // sandy shore → earthy fallback
                              : oceanDist < 0   ? 1   // rocky shore
                              : landBiome;
          const cliffKey = cliffKeyForBiome(cliffBiomeIdx);

          const maxDrop = Math.max(southDrop, eastDrop, westDrop);
          const useWF   = southDrop > 0 && isWF;

          // Stack cliff wall tiles. Waterfall tiles replace rock where the river crosses.
          const wallKey = useWF ? `waterfall-${this.wfFrame}` : cliffKey;
          for (let step = maxDrop * 2; step >= 1; step--) {
            const tileImg = this.add.image(x, posY + step * (CLIFF_H / 2), wallKey)
              .setScale(this.ISO_SCALE).setOrigin(0.5, 0).setDepth(0);
            this.tileImages.push(tileImg);
            if (useWF) this.wfSprites.push(tileImg);
          }
          // Foam at the top of waterfall columns — same config as bottom splash
          // but positioned at the cliff lip where water flows over the edge.
          if (useWF) {
            const foamBaseY = posY + this.ISO_H * 0.5 + CLIFF_H / 2;
            const hw = this.ISO_W / 2;
            const hh = this.ISO_H / 2;
            const foamCfg = {
              speed: { min: 10, max: 22 },
              angle: { min: 80, max: 100 },
              accelerationY: 15,
              scale: { start: 0.6 * this.zoomFactor, end: 0.1 * this.zoomFactor },
              alpha: { start: 0.7, end: 0 },
              lifespan: { min: 1500, max: 3000 },
              frequency: 100,
              quantity: 2,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              emitZone: {
                type: 'random',
                source: new Phaser.Geom.Rectangle(
                  -this.ISO_W * 0.15, -this.ISO_H * 0.1,
                  this.ISO_W * 0.3, this.ISO_H * 0.2,
                ),
              } as any,
            };
            const foamPositions = [
              { ex: x - hw,        ey: foamBaseY },              // SW corner
              { ex: x - hw * 0.5,  ey: foamBaseY + hh * 0.5 },  // SW mid
              { ex: x,             ey: foamBaseY + hh },         // S centre
              { ex: x + hw * 0.5,  ey: foamBaseY + hh * 0.5 },  // SE mid
              { ex: x + hw,        ey: foamBaseY },              // SE corner
            ];
            for (let fi = 0; fi < foamPositions.length; fi++) {
              this._foamCounter = (this._foamCounter ?? 0) + 1;
              if (this._foamCounter === 1 || this._foamCounter === 4 || this._foamCounter === 5 || this._foamCounter === 10) continue;
              const { ex, ey } = foamPositions[fi];
              this.splashEmitters.push(
                this.add.particles(ex, ey, 'splash-dot', foamCfg).setDepth(0.2),
              );
            }
          }
          // Splash particles along the bottom edge of waterfall columns —
          // the line where falling water hits the pool surface.
          if (useWF) {
            // Bottom of cliff stack in screen space: the lowest block's south rim.
            const baseY = posY + maxDrop * CLIFF_H + this.ISO_H * 0.5 + CLIFF_H / 2;
            const hw = this.ISO_W / 2;
            const hh = this.ISO_H / 2;
            const splashCfg = {
              speed: { min: 8, max: 20 },
              angle: { min: 240, max: 300 },
              scale: { start: 1.2 * this.zoomFactor, end: 0.2 * this.zoomFactor },
              alpha: { start: 0.9, end: 0 },
              lifespan: { min: 500, max: 1200 },
              frequency: 100,
              quantity: 2,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              emitZone: {
                type: 'random',
                source: new Phaser.Geom.Rectangle(
                  -this.ISO_W * 0.1, -this.ISO_H * 0.05,
                  this.ISO_W * 0.2, this.ISO_H * 0.1,
                ),
              } as any,
            };
            // South-facing edge: SW corner, SW mid, S centre, SE mid, SE corner.
            // No emitters on the north side — that's behind the waterfall.
            const emitterPositions = [
              { ex: x - hw,        ey: baseY },              // SW corner
              { ex: x - hw * 0.5,  ey: baseY + hh * 0.5 },  // SW mid
              { ex: x,             ey: baseY + hh },         // S centre
              { ex: x + hw * 0.5,  ey: baseY + hh * 0.5 },  // SE mid
              { ex: x + hw,        ey: baseY },              // SE corner
            ];
            for (let ei = 0; ei < emitterPositions.length; ei++) {
              this._splashCounter = (this._splashCounter ?? 0) + 1;
              if (this._splashCounter === 4 || this._splashCounter === 5) continue;
              const { ex, ey } = emitterPositions[ei];
              this.splashEmitters.push(
                this.add.particles(ex, ey, 'splash-dot', splashCfg).setDepth(2),
              );
            }
          }
          // Floor tile drawn last — renders on top of wall tiles at the cliff rim.
          // All cliff floor tiles at depth 0.1 so they render above wall tiles
          // from this column and neighbouring waterfall columns.
          const floorDepth = 0.1;
          const floorImg = customPack
            ? this.add.image(x, posY, `${customPack}-${tileHash}`)
                .setScale(this.ISO_SCALE).setOrigin(0.5, 0).setDepth(floorDepth)
            : this.add.image(x, posY, 'iso-tiles', frame)
                .setScale(this.ISO_SCALE).setOrigin(0.5, 0).setDepth(floorDepth);
          this.tileImages.push(floorImg);
        } else {
          // No cliff — draw regular floor tile.
          const tileDepth = frame === ISO_RIVER_FRAME ? 0.1 : 0;
          const img = customPack
            ? this.add.image(x, posY, `${customPack}-${tileHash}`)
                .setScale(this.ISO_SCALE).setOrigin(0.5, 0).setDepth(tileDepth)
            : this.add.image(x, posY, 'iso-tiles', frame)
                .setScale(this.ISO_SCALE).setOrigin(0.5, 0).setDepth(tileDepth);
          this.tileImages.push(img);
        }
      }
    }

    // #812: Test road — a dirt road zigzagging left-to-right across the screen.
    // Uses SBS Isometric Pathways tiles with 4-directional auto-tiling.
    {
      const roadSet = new Set<string>();
      // Gentle sine-wave road snaking left-to-right across the full grid.
      // Low amplitude + low frequency = smooth, gradual curves.
      const amplitude = G * 0.12;    // gentle vertical swing (~3-4 tiles)
      const midY = Math.floor(G / 2);
      const freq = 1.5;              // 1.5 half-waves = one S-curve across grid
      let prevClamped = -1;
      for (let tx = 0; tx < G; tx++) {
        const t = (tx - 1) / (G - 3);
        const ty = midY + Math.round(amplitude * Math.sin(t * Math.PI * freq));
        const clamped = Math.max(1, Math.min(G - 2, ty));
        if (getElev(tx, clamped) === 0) roadSet.add(`${tx},${clamped}`);
        // Bridge to previous column: first add a tile at the same row as prev
        // so the two columns are 4-connected horizontally, then fill vertically.
        if (prevClamped >= 0 && clamped !== prevClamped) {
          // Horizontal bridge: same row as previous column at current tx
          if (getElev(tx, prevClamped) === 0) roadSet.add(`${tx},${prevClamped}`);
          // Vertical fill between bridge and destination
          const step = clamped > prevClamped ? 1 : -1;
          for (let fy = prevClamped + step; fy !== clamped; fy += step) {
            if (getElev(tx, fy) === 0) roadSet.add(`${tx},${fy}`);
          }
        }
        prevClamped = clamped;
      }

      // Bitmask → frame lookup (same as GameScene.BITMASK_TO_FRAME)
      //   0=cross  1=straight NE-SW  2=straight NW-SE  4-7=T-junctions
      //   8=corner E  9=corner W  10=corner S  11=corner N
      const B2F = [0,9,8,11, 8,2,8,6, 9,9,1,7, 10,5,4,0];

      // Scale pre-converted 32×16 tiles to match WF's dynamic iso diamond size
      const scaleX = this.ISO_W / 32;
      const scaleY = this.ISO_H / 16;

      for (const key of roadSet) {
        const [tx, ty] = key.split(',').map(Number);

        // 4-directional neighbor bitmask.
        // Edge tiles pretend they have a neighbor off-screen so they render
        // as straights connecting to the frame edge.
        let mask = 0;
        if (tx === 0   || roadSet.has(`${tx - 1},${ty}`)) mask |= 1;  // NW
        if (roadSet.has(`${tx},${ty - 1}`))                mask |= 2;  // NE
        if (tx === G-1 || roadSet.has(`${tx + 1},${ty}`))  mask |= 4;  // SE
        if (roadSet.has(`${tx},${ty + 1}`))                mask |= 8;  // SW
        const frame = B2F[mask];

        const { x, y } = this.isoPos(tx, ty);
        // isoPos returns north apex; diamond centre is at (x, y + ISO_H/2)
        const rtype = WorldForgeScene.ROAD_TYPES[this.roadTypeIdx];
        const roadImg = this.add.image(x, y + this.ISO_H / 2, `road-${rtype}`, frame)
          .setScale(scaleX, scaleY)
          .setOrigin(0.5, 0.5)
          .setDepth(0.05);
        this.tileImages.push(roadImg);
      }
    }

    // Grid — top surface only where it makes sense: full diamond when level with
    // neighbours; otherwise open edges so strokes don’t project onto vertical cliffs
    // or crawl up/down a height discontinuity (which looked like a broken mirror).
    this.gridGfx = this.add.graphics().setDepth(2);
    const gGrid = this.gridGfx;
    gGrid.lineStyle(1, 0x000000, 0.20);
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;
    const strokeSeg = (x0: number, y0: number, x1: number, y1: number, skip: boolean) => {
      if (skip) return;
      gGrid.beginPath();
      gGrid.moveTo(x0, y0);
      gGrid.lineTo(x1, y1);
      gGrid.strokePath();
    };
    for (let ty = 0; ty < this.GRID; ty++) {
      for (let tx = 0; tx < this.GRID; tx++) {
        const { x: cx, y: cy } = this.isoPos(tx, ty);
        const gElev = getElev(tx, ty);
        const dy    = gElev * CLIFF_H;
        const eN    = ty > 0 ? getElev(tx, ty - 1) : gElev;
        const eS    = ty + 1 < this.GRID ? getElev(tx, ty + 1) : gElev;
        const eE    = tx + 1 < this.GRID ? getElev(tx + 1, ty) : gElev;
        const eW    = tx > 0 ? getElev(tx - 1, ty) : gElev;
        const Nx = cx,          Ny = cy - dy;
        const Ex = cx + hw,     Ey = cy + hh - dy;
        const Sx = cx,          Sy = cy + hh * 2 - dy;
        const Wx = cx - hw,     Wy = cy + hh - dy;
        // N–E: hide when north is taller (grid would climb the cliff) or east drops.
        strokeSeg(Nx, Ny, Ex, Ey, eN > gElev || eE < gElev);
        // E–S: hide along south or east cliff.
        strokeSeg(Ex, Ey, Sx, Sy, eS < gElev || eE < gElev);
        // S–W: hide along south or west cliff.
        strokeSeg(Sx, Sy, Wx, Wy, eS < gElev || eW < gElev);
        // W–N: hide along west cliff or when north is taller.
        strokeSeg(Wx, Wy, Nx, Ny, eW < gElev || eN > gElev);
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


    // Cardinal direction labels at the 4 tips of the iso diamond.
    const compassStyle = { fontSize: '12px', color: '#aaaaaa', stroke: '#000000', strokeThickness: 3 };
    const { x: nx, y: ny } = this.isoPos(0, 0);
    const { x: ex, y: ey } = this.isoPos(G - 1, 0);
    const { x: sx, y: sy } = this.isoPos(G - 1, G - 1);
    const { x: wx, y: wy } = this.isoPos(0, G - 1);
    this.bandLabels.push(
      this.add.text(nx, ny - 14, 'N', compassStyle).setOrigin(0.5, 1).setDepth(11),
      this.add.text(ex + 16, ey, 'E', compassStyle).setOrigin(0, 0.5).setDepth(11),
      this.add.text(sx, sy + this.ISO_H + 6, 'S', compassStyle).setOrigin(0.5, 0).setDepth(11),
      this.add.text(wx - 16, wy, 'W', compassStyle).setOrigin(1, 0.5).setDepth(11),
    );
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
      'A/D: main biome   W/S: secondary   R: road type   scroll/+−: zoom   E: clear entity   C: clear objects',
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

    const roadName = WorldForgeScene.ROAD_TYPES[this.roadTypeIdx];
    this.biomeLabel!.setText(
      `WorldForge v0.8 \u2014 [${this.selectedBiome}] ${BIOME_NAMES[this.selectedBiome]}` +
      `  \u2194  [${this.selectedSecBiome}] ${BIOME_NAMES[this.selectedSecBiome]}` +
      `  |  road: ${roadName} (R)`
    );
  }

  /** Updates the top-right status line with the currently active tool. */
  private updateToolStatus(): void {
    if (!this.toolStatusText) return;
    let msg = '';
    if      (this.selectedEntityKey) msg = `\u25b6 ${this.selectedEntityKey} — click tile to place  (E = remove)`;
    else if (this.selectedObjectKey) msg = `\u25b6 ${this.selectedObjectKey} — click tile to toggle  (C = clear all)`;
    else if (this.selectedDecorKey)  msg = `\u25b6 ${this.selectedDecorKey} — click tile to toggle  (C = clear all)`;
    const aiTag = this.aiEnabled ? '  \u2665 AI wander on' : '';
    this.toolStatusText.setText(msg + aiTag);
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

    // AI toggle button — right of entity buttons. Green when on, dim when off.
    // Only affects NPC and Animal placements.
    const AI_X = PAD + ENTITY_TYPES.length * (BTN_W + BTN_G) + 10;
    this.add.text(AI_X, TOOL_Y - 13, 'AI:', {
      fontSize: '10px', color: '#ffccff', stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);
    const aiGfx = this.add.graphics({ x: AI_X, y: TOOL_Y }).setDepth(10);
    aiGfx.fillStyle(0x223344, 0.7);
    aiGfx.fillRect(0, 0, BTN_W, BTN_H);
    this.aiToggleGfx = aiGfx;
    this.aiToggleText = this.add.text(AI_X + BTN_W / 2, TOOL_Y + BTN_H / 2, 'off', {
      fontSize: '10px', color: '#888888', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(13);
    this.add.zone(AI_X + BTN_W / 2, TOOL_Y + BTN_H / 2, BTN_W, BTN_H)
      .setDepth(15).setInteractive()
      .on('pointerdown', () => this.toggleAI());

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
      // Drawn in local coords (Graphics origin = foot position) so the whole
      // shape can be repositioned via setPosition() when AI wander is active.
      const hw    = this.ISO_W * 0.5;
      const fh    = this.ISO_H * 0.5;
      const bodyH = this.ISO_H * 2.5;
      const bodyW = hw * 0.6;

      const gfx = this.add.graphics({ x: cx, y: footY }).setDepth(5);

      // Footprint diamond in local coords — (0,0) = foot tip
      gfx.fillStyle(et.color as number, 0.35);
      gfx.beginPath();
      gfx.moveTo(0,   -fh);
      gfx.lineTo(hw,   0);
      gfx.lineTo(0,    fh);
      gfx.lineTo(-hw,  0);
      gfx.closePath();
      gfx.fillPath();

      // Body rectangle grows upward from foot
      gfx.fillStyle(et.color as number, 0.92);
      gfx.fillRect(-bodyW / 2, -fh - bodyH, bodyW, bodyH);
      gfx.lineStyle(2, 0xffffff, 0.85);
      gfx.strokeRect(-bodyW / 2, -fh - bodyH, bodyW, bodyH);

      const labelOffsetY = -fh - bodyH - 4;
      const label = this.add.text(cx, footY + labelOffsetY, et.label, {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(6);

      this.placedEntity      = gfx;
      this.placedEntityLabel = label;

      // Initialise wander AI for NPC / Animal when the toggle is on.
      // Animals are skittish and faster; NPCs stroll slowly.
      if (this.aiEnabled && (et.key === 'NPC' || et.key === 'Animal')) {
        const speed = et.key === 'Animal' ? 55 : 32;
        this.liveWander = { x: cx, y: footY, vx: 0, vy: 0, timer: 0, labelOffsetY, speed };
      }
    }
  }

  private clearEntity(): void {
    this.placedEntity?.destroy();
    this.placedEntity = undefined;
    this.placedEntitySprite?.destroy();
    this.placedEntitySprite = undefined;
    this.placedEntityLabel?.destroy();
    this.placedEntityLabel = undefined;
    this.liveWander = null;
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

  // ── AI wander toggle ──────────────────────────────────────────────────────────

  /**
   * Flip the AI wander toggle on/off.
   * When turned on, the next NPC/Animal placed will walk around autonomously.
   * When turned off, any active wander is frozen in place (entity stays where it is).
   */
  private toggleAI(): void {
    const BTN_W = 54;
    const BTN_H = 24;
    this.aiEnabled = !this.aiEnabled;

    this.aiToggleGfx?.clear();
    this.aiToggleGfx?.fillStyle(this.aiEnabled ? 0x336633 : 0x223344, this.aiEnabled ? 0.9 : 0.7);
    this.aiToggleGfx?.fillRect(0, 0, BTN_W, BTN_H);
    this.aiToggleText?.setText(this.aiEnabled ? 'on' : 'off');
    this.aiToggleText?.setColor(this.aiEnabled ? '#aaffaa' : '#888888');

    // Freeze any live entity in place when disabling
    if (!this.aiEnabled) this.liveWander = null;

    this.updateToolStatus();
  }

  // ── Per-frame AI wander ───────────────────────────────────────────────────────

  /**
   * Called by Phaser every frame. Advances the wander FSM for any live AI entity.
   *
   * The entity placeholder (Graphics + label) is repositioned each frame by
   * updating the Graphics object's x/y — works because it was drawn in local
   * coords with origin at the foot position (see placeEntity()).
   */
  override update(_time: number, delta: number): void {
    // Waterfall animation — cycle block tiles through 5 frames at 6 FPS.
    if (this.wfSprites.length > 0) {
      this.wfTimer += delta;
      if (this.wfTimer >= WorldForgeScene.WF_FRAME_MS) {
        this.wfTimer -= WorldForgeScene.WF_FRAME_MS;
        this.wfFrame = (this.wfFrame + 1) % WorldForgeScene.WF_FRAMES;
        const wfKey = `waterfall-${this.wfFrame}`;
        for (const s of this.wfSprites) s.setTexture(wfKey);
      }
    }

    if (!this.liveWander || !this.placedEntity) return;
    const lw = this.liveWander;

    // Wander FSM: tick direction timer and pick a new heading when it expires.
    lw.timer -= delta;
    if (lw.timer <= 0) {
      // 25% chance to pause briefly (idle); otherwise walk in a random direction.
      if (Math.random() < 0.25) {
        lw.vx = 0;
        lw.vy = 0;
        lw.timer = Phaser.Math.Between(800, 2000);
      } else {
        const angle = Math.random() * Math.PI * 2;
        lw.vx = Math.cos(angle) * lw.speed;
        lw.vy = Math.sin(angle) * lw.speed;
        lw.timer = Phaser.Math.Between(1500, 4000);
      }
    }

    lw.x += lw.vx * (delta / 1000);
    lw.y += lw.vy * (delta / 1000);

    // Soft boundary: bounce off the usable world area edges so the entity
    // never wanders into the palette or off screen.
    const margin = 50;
    const maxY   = this.scale.height - this.PAL_AREA - margin;
    if (lw.x < margin)                    { lw.vx =  Math.abs(lw.vx); lw.x = margin; }
    if (lw.x > this.scale.width - margin) { lw.vx = -Math.abs(lw.vx); lw.x = this.scale.width - margin; }
    if (lw.y < margin)                    { lw.vy =  Math.abs(lw.vy); lw.y = margin; }
    if (lw.y > maxY)                      { lw.vy = -Math.abs(lw.vy); lw.y = maxY; }

    // Reposition the placeholder — Graphics was drawn at local (0,0), so
    // moving its x/y translates the entire shape + footprint diamond.
    this.placedEntity.setPosition(lw.x, lw.y);
    this.placedEntityLabel?.setPosition(lw.x, lw.y + lw.labelOffsetY);
  }

}
