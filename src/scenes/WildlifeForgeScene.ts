/**
 * WildlifeForgeScene — dev scene for testing wildlife behavior on procedurally
 * generated terrain with elevation, rivers, lakes, ocean, and varied biomes.
 *
 * Uses the same terrain generation pipeline as MapForgeScene / GameScene:
 * FbmNoise → biome classification → river tracing → cliff rendering.
 *
 * WildlifeForge v0.2
 *
 * Access: /wildlife or /wildlifeforge
 *
 * ## Controls
 *   WASD / Arrows   Pan camera
 *   Q / E           Cycle highlighted species
 *   R               Re-roll terrain (new seed)
 *   P               Re-populate wildlife
 *   Click           Emit noise at cursor
 *   1–5             Toggle debug overlays
 *   Space           Pause / resume
 *   [ / ]           Decrease / increase simulation speed
 *   O               Cycle day phase
 *   Scroll          Zoom in/out
 *   Right-drag      Pan camera
 */

import * as Phaser from 'phaser';
import { FbmNoise } from '../lib/noise';
import { ISO_TILE_W, ISO_TILE_H, WORLD_TILE_SIZE } from '../lib/IsoTransform';
import { isoTileFrame, ISO_RIVER_FRAME, ISO_TILE_NATIVE_SIZE } from '../world/IsoTileMap';
import { BIOMES, tileBiomeIdx } from '../world/biomes';
import { CUSTOM_TILE_PACKS, preloadTilePacks } from '../world/TilePacks';
import { WildlifeSystem, type WildlifeEnvContext } from '../systems/WildlifeSystem';
import type { FaunaRegistryData } from '../world/FaunaRegistry';

// ── Constants — match GameScene / MapForgeScene ─────────────────────────────

const TILE_SIZE = WORLD_TILE_SIZE; // 32
const GRID_W = 141;               // square: use the larger GameScene dimension
const GRID_H = 141;
const WORLD_W = GRID_W * TILE_SIZE;
const WORLD_H = GRID_H * TILE_SIZE;

// Noise scales (same as MapForgeScene / GameScene)
const BASE_SCALE   = 0.07;
const DETAIL_SCALE = 0.18;
const TEMP_SCALE   = 0.04;
const MOIST_SCALE  = 0.06;

// ── Iso helpers (local origin for the square grid) ──────────────────────────

/** X offset so the NW corner of the diamond sits at iso-x ≈ 0. */
const WF_ISO_ORIGIN_X = GRID_H * (ISO_TILE_W / 2);

function worldToIso(wx: number, wy: number): { x: number; y: number } {
  const tx = wx / TILE_SIZE;
  const ty = wy / TILE_SIZE;
  return {
    x: WF_ISO_ORIGIN_X + (tx - ty) * (ISO_TILE_W / 2),
    y: (tx + ty) * (ISO_TILE_H / 2),
  };
}

function isoToWorld(ix: number, iy: number): { x: number; y: number } {
  const sum  = iy / (ISO_TILE_H / 2);
  const diff = (ix - WF_ISO_ORIGIN_X) / (ISO_TILE_W / 2);
  const txF = (sum + diff) / 2;
  const tyF = (sum - diff) / 2;
  return { x: txF * TILE_SIZE, y: tyF * TILE_SIZE };
}

function isoDepth(wx: number, wy: number): number {
  return (wx + wy) / TILE_SIZE;
}

// ── Day phases ──────────────────────────────────────────────────────────────

type DayPhase = 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'night';
const DAY_PHASES: DayPhase[] = ['dawn', 'morning', 'afternoon', 'dusk', 'night'];

// ── Wildlife species specs ──────────────────────────────────────────────────

const WILDLIFE_SPECS: { species: string; anims: string[]; size: number }[] = [
  { species: 'wolf',         anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 48 },
  { species: 'lynx',         anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 48 },
  { species: 'bear',         anims: ['idle', 'run', 'walk', 'alert'],           size: 68 },
  { species: 'squirrel',     anims: ['idle', 'run', 'walk', 'alert'],           size: 24 },
  { species: 'hedgehog',     anims: ['idle', 'run', 'walk', 'alert'],           size: 24 },
  { species: 'elk',          anims: ['idle', 'run', 'alert'],                   size: 68 },
  { species: 'bison',        anims: ['idle', 'run', 'alert'],                   size: 68 },
  { species: 'roe-deer',     anims: ['idle', 'run', 'alert'],                   size: 48 },
  { species: 'wolverine',    anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 48 },
  { species: 'rabbit',       anims: ['idle', 'run', 'walk', 'alert'],           size: 24 },
  { species: 'pine-marten',  anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 36 },
  { species: 'polecat',      anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 36 },
  { species: 'stoat',        anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 24 },
  { species: 'beaver',       anims: ['idle', 'run', 'walk', 'alert'],           size: 48 },
  { species: 'wild-boar',    anims: ['idle', 'run', 'walk', 'alert'],           size: 68 },
  { species: 'badger',       anims: ['idle', 'run', 'walk', 'alert'],           size: 48 },
  { species: 'beech-marten', anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 36 },
  { species: 'weasel',       anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 24 },
  { species: 'wildcat',      anims: ['idle', 'run', 'walk', 'alert', 'sneak'],  size: 48 },
  { species: 'raccoon',      anims: ['idle', 'run', 'walk', 'alert'],           size: 36 },
  { species: 'grass-snake',  anims: ['idle', 'run', 'alert'],                   size: 36 },
  { species: 'arctic-fox',   anims: ['idle', 'run', 'alert', 'sneak'],          size: 36 },
  { species: 'fallow-deer',  anims: ['idle', 'run', 'alert'],                   size: 48 },
  { species: 'red-deer',     anims: ['idle', 'run', 'alert'],                   size: 68 },
  { species: 'moose',        anims: ['idle', 'run'],                            size: 68 },
];

const ALL_SPECIES = WILDLIFE_SPECS.map(s => s.species);

// ── Cliff key helper (same as MapForgeScene) ────────────────────────────────

function cliffKey(biomeIdx: number): string {
  if (biomeIdx === 1)  return 'cliff-stone';
  if (biomeIdx === 3)  return 'cliff-peat';
  if (biomeIdx >= 9 && biomeIdx <= 10) return 'cliff-stone';
  if (biomeIdx === 11) return 'cliff-snow';
  return 'cliff-earthy';
}

/** Quantize elevation to 0–3 discrete levels (same as MapForgeScene). */
function getElev(val: number): number {
  if (val < 0.45) return 0;
  if (val < 0.62) return 1;
  if (val < 0.78) return 2;
  return 3;
}

// ── Scene ───────────────────────────────────────────────────────────────────

export class WildlifeForgeScene extends Phaser.Scene {
  static readonly KEY = 'WildlifeForgeScene';

  // Terrain seed (re-rollable with R)
  private seed = Math.floor(Math.random() * 0xffffffff);

  // Terrain data
  private tileSprites: Phaser.GameObjects.Image[] = [];
  private biomeGrid = new Uint8Array(GRID_W * GRID_H);
  private walkGrid  = new Uint8Array(GRID_W * GRID_H);
  private isRiverGrid = new Uint8Array(GRID_W * GRID_H);

  // Frustum culling — per-tile sprite pool
  private tileSpriteMap = new Map<number, Phaser.GameObjects.Image[]>();
  private visibleTiles = new Set<number>();
  private detNoise: FbmNoise | null = null;  // retained for tile rendering

  // Wildlife
  private wildlife: WildlifeSystem | null = null;
  private faunaReg: FaunaRegistryData | null = null;

  // Spawn selection
  private selectedSpeciesIdx = 0;

  // Time
  private dayPhaseIdx = 1; // morning
  private simSpeed = 1;
  private paused = false;

  // Camera pan
  private dragStartX = 0;
  private dragStartY = 0;
  private camStartX = 0;
  private camStartY = 0;
  private isDragging = false;

  // Zoom
  private zoomLevel = 0.8;

  // Debug overlays
  private overlayFlags = [false, false, false, false, false];
  private debugGfx: Phaser.GameObjects.Graphics | null = null;
  private showElevation = false;         // V: elevation numbers on tiles
  private elevContainer: Phaser.GameObjects.Container | null = null;
  private elevGrid = new Uint8Array(GRID_W * GRID_H);

  // Blend layer toggle — T toggles biome blending on/off
  private blendEnabled = false;

  private transitionSprites: Phaser.GameObjects.Image[] = [];

  // HUD
  private hudText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private animalCountText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: WildlifeForgeScene.KEY });
  }

  // ── Preload ─────────────────────────────────────────────────────────────

  preload(): void {
    // Iso tile spritesheet (fallback for biomes without a custom pack)
    this.load.spritesheet('iso-tiles',
      'assets/packs/isometric tileset/spritesheet.png',
      { frameWidth: ISO_TILE_NATIVE_SIZE, frameHeight: ISO_TILE_NATIVE_SIZE });

    // Custom tile packs — the actual biome floor tiles
    preloadTilePacks(this);

    // Cliff + waterfall tiles (same as WorldForgeScene)
    for (let i = 0; i < 5; i++) {
      this.load.image(`waterfall-${i}`, `/assets/packs/waterfall-tiles/${i}.png`);
    }
    this.load.image('cliff-earthy', '/assets/packs/cliff-iso-gen/earthy_0.png');
    this.load.image('cliff-snow',   '/assets/packs/cliff-iso-gen/snow_0.png');
    this.load.image('cliff-peat',   '/assets/packs/cliff-iso-gen/peat_0.png');
    this.load.image('cliff-stone',  '/assets/packs/cliff-iso-gen/stone_iso_0.png');

    // Wildlife spritesheets — 8 directions per animation
    const DIRS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
    for (const { species, anims, size } of WILDLIFE_SPECS) {
      const base = `/assets/sprites/wildlife/${species}`;
      for (const anim of anims) {
        for (const d of DIRS) {
          this.load.spritesheet(
            `${species}-${anim}-${d}`,
            `${base}/${anim}_${d}.png`,
            { frameWidth: size, frameHeight: size },
          );
        }
      }
    }

    // Fauna registry
    this.load.json('fauna-registry', '/macro-world/fauna-registry.json');
  }

  // ── Create ──────────────────────────────────────────────────────────────

  create(): void {
    this.cameras.main.setBackgroundColor('#1a3a1a');
    this.cameras.main.setZoom(this.zoomLevel);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    // Register wildlife animations
    this.createWildlifeAnims();

    // Load fauna registry
    this.faunaReg = this.cache.json.get('fauna-registry') as FaunaRegistryData | undefined ?? null;

    // Debug graphics layer
    this.debugGfx = this.add.graphics().setDepth(9000);

    // Build terrain + spawn wildlife
    this.buildTerrain();
    this.drawTileGrid();
    this.spawnWildlife();

    // HUD — repositioned every frame in update() to stay fixed on screen
    this.hudText = this.add.text(10, 10, '', {
      fontSize: '14px', fontFamily: 'monospace',
      color: '#ffffff', backgroundColor: '#00000088',
      padding: { x: 6, y: 4 },
    }).setDepth(10000);

    this.animalCountText = this.add.text(10, 60, '', {
      fontSize: '12px', fontFamily: 'monospace',
      color: '#ccffcc', backgroundColor: '#00000088',
      padding: { x: 6, y: 3 },
    }).setDepth(10000);

    this.hintText = this.add.text(10, 0, '', {
      fontSize: '11px', fontFamily: 'monospace',
      color: '#aaaaaa', backgroundColor: '#00000066',
      padding: { x: 6, y: 4 },
    }).setDepth(10000);

    this.updateHUD();
    this.setupInput();

    // Centre camera on the map
    const centre = worldToIso(WORLD_W / 2, WORLD_H / 2);
    this.cameras.main.scrollX = centre.x - this.scale.width / 2;
    this.cameras.main.scrollY = centre.y - this.scale.height / 2;
  }

  // ── Update ──────────────────────────────────────────────────────────────

  update(time: number, delta: number): void {
    // WASD / Arrow key panning
    const kb = this.input.keyboard!;
    const panSpeed = 400 * (delta / 1000) / this.zoomLevel;
    if (kb.addKey('LEFT').isDown  || kb.addKey('A').isDown) this.cameras.main.scrollX -= panSpeed;
    if (kb.addKey('RIGHT').isDown || kb.addKey('D').isDown) this.cameras.main.scrollX += panSpeed;
    if (kb.addKey('UP').isDown    || kb.addKey('W').isDown) this.cameras.main.scrollY -= panSpeed;
    if (kb.addKey('DOWN').isDown  || kb.addKey('S').isDown) this.cameras.main.scrollY += panSpeed;

    if (!this.paused && this.wildlife) {
      const cam = this.cameras.main;
      const centreIso = { x: cam.scrollX + cam.width / 2, y: cam.scrollY + cam.height / 2 };
      const centreWorld = isoToWorld(centreIso.x, centreIso.y);
      this.wildlife.update(time, delta * this.simSpeed, centreWorld.x, centreWorld.y);
    }

    // Frustum culling — create/destroy tile sprites as camera moves
    this.updateVisibleTiles();

    // Keep HUD fixed to screen regardless of zoom/scroll.
    // worldView gives the actual visible rectangle in world coordinates.
    const cam = this.cameras.main;
    const vx = cam.worldView.x;
    const vy = cam.worldView.y;
    const vh = cam.worldView.height;
    const iz = 1 / cam.zoom;
    const pad = 10 * iz;
    this.hudText.setScale(iz).setPosition(vx + pad, vy + pad);
    this.animalCountText.setScale(iz).setPosition(vx + pad, vy + 60 * iz);
    this.hintText.setScale(iz).setPosition(vx + pad, vy + vh - 30 * iz);

    this.updateHUD();
    this.updateDebugOverlays();
    this.updateAnimalCount();
  }

  // ── Terrain generation (same pipeline as MapForgeScene) ────────────────

  private buildTerrain(): void {
    // Destroy old tiles
    for (const spr of this.tileSprites) spr.destroy();
    this.tileSprites = [];
    this.transitionSprites = [];

    // Initialize 4 noise layers (same seeds as MapForgeScene)
    const baseNoise  = new FbmNoise(this.seed);
    const detNoise   = new FbmNoise(this.seed ^ 0xb5ad4ecb);
    const tempNoise  = new FbmNoise(this.seed ^ 0x74656d70);
    const moistNoise = new FbmNoise(this.seed ^ 0x6d6f6973);

    // ── Pass 1: natural elevation + biome classification ──────────────────
    const naturalElev = new Float32Array(GRID_W * GRID_H);

    for (let ty = 0; ty < GRID_H; ty++) {
      for (let tx = 0; tx < GRID_W; tx++) {
        const base   = baseNoise.warped(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
        const detail = detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE, 2, 0.6);
        const temp   = tempNoise.fbm(tx * TEMP_SCALE, ty * TEMP_SCALE, 3, 0.5);
        const moist  = moistNoise.fbm(tx * MOIST_SCALE, ty * MOIST_SCALE, 3, 0.5);

        // Geographic biases (same as MapForgeScene)
        const perpDiag     = (tx / GRID_W - (1 - ty / GRID_H)) / 2;
        const mountainBias = Math.pow(Math.max(0, -perpDiag - 0.15), 1.8) * 5.0;
        const rightEdge    = Math.pow(Math.max(0, tx / GRID_W - 0.75), 1.5) * 2.0;
        const bottomEdge   = Math.pow(Math.max(0, ty / GRID_H - 0.80), 1.5) * 2.5;
        const oceanBias    = Math.pow(Math.max(0, perpDiag - 0.12), 1.2) * 3.5
                           + rightEdge + bottomEdge;

        const baseVal = base * 0.65 + mountainBias - oceanBias;
        const val = Math.max(0, Math.min(1.2, baseVal + detail * 0.25));

        const idx = ty * GRID_W + tx;
        naturalElev[idx] = val;
        this.biomeGrid[idx] = tileBiomeIdx(val, temp, moist);
      }
    }

    // ── Pass 2: visual elevation (flatten corridor, mountains rise) ───────
    const elevGrid = this.elevGrid = new Uint8Array(GRID_W * GRID_H);
    const valGrid  = new Float32Array(GRID_W * GRID_H);
    for (let i = 0; i < naturalElev.length; i++) {
      const nat = naturalElev[i];
      let visual: number;
      if (nat < 0.25) {
        visual = nat;
      } else if (nat < 0.68) {
        visual = 0.35;  // corridor → flat
      } else {
        visual = 0.50 + (nat - 0.68) * (0.70 / 0.52);
      }
      valGrid[i]  = visual;
      elevGrid[i] = getElev(visual);
    }

    // ── Pass 3: rivers (meandering gradient descent) ──────────────────────
    this.isRiverGrid.fill(0);
    const RIVER_HALF_W = 1;

    const traceRiverTo = (
      startTx: number, startTy: number,
      goalTx: number, goalTy: number,
      noiseSeed: number,
    ): void => {
      const rNoise = new FbmNoise(this.seed ^ noiseSeed);
      let cx = startTx, cy = startTy;
      const visited = new Set<number>();
      for (let step = 0; step < 800; step++) {
        const ci = cy * GRID_W + cx;
        if (visited.has(ci)) break;
        visited.add(ci);
        // Mark river band
        for (let dx = -RIVER_HALF_W; dx <= RIVER_HALF_W; dx++) {
          for (let dy = -RIVER_HALF_W; dy <= RIVER_HALF_W; dy++) {
            const rx = cx + dx, ry = cy + dy;
            if (rx >= 0 && rx < GRID_W && ry >= 0 && ry < GRID_H) {
              this.isRiverGrid[ry * GRID_W + rx] = 1;
            }
          }
        }
        if (Math.abs(cx - goalTx) <= 2 && Math.abs(cy - goalTy) <= 2) break;
        if (valGrid[ci] < 0.25) break;

        const ddx = goalTx - cx;
        const ddy = goalTy - cy;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist < 1) break;
        const dirX = ddx / dist;
        const dirY = ddy / dist;

        const meander = (rNoise.fbm(step * 0.07, cy * 0.04) - 0.5) * 4;
        const perpX = -dirY;
        const perpY = dirX;

        let bestX = Math.round(cx + dirX * 1.2 + perpX * meander);
        let bestY = Math.round(cy + dirY * 1.2 + perpY * meander);
        bestX = Math.max(0, Math.min(GRID_W - 1, bestX));
        bestY = Math.max(0, Math.min(GRID_H - 1, bestY));

        if (visited.has(bestY * GRID_W + bestX)) {
          bestX = Math.max(0, Math.min(GRID_W - 1, Math.round(cx + dirX)));
          bestY = Math.max(0, Math.min(GRID_H - 1, Math.round(cy + dirY)));
        }
        cx = bestX; cy = bestY;
      }
    };

    // Confluence in the middle
    const conflTx = Math.floor(GRID_W * 0.5);
    const conflTy = Math.floor(GRID_H * 0.5);

    // River from north, river from west, merged river to ocean
    traceRiverTo(Math.floor(GRID_W * 0.35), 0, conflTx, conflTy, 0xaabb);
    traceRiverTo(0, Math.floor(GRID_H * 0.2), conflTx, conflTy, 0xccdd);
    traceRiverTo(conflTx, conflTy, GRID_W - 1, GRID_H - 1, 0xeeff);

    // River tiles → water biome for rendering
    for (let i = 0; i < this.isRiverGrid.length; i++) {
      if (this.isRiverGrid[i]) {
        this.biomeGrid[i] = 0;
      }
    }

    // ── Build walkGrid ────────────────────────────────────────────────────
    for (let ty = 0; ty < GRID_H; ty++) {
      for (let tx = 0; tx < GRID_W; tx++) {
        const idx = ty * GRID_W + tx;
        const biome = this.biomeGrid[idx];
        // Water (sea, river) and cliff edges are unwalkable
        const isWater = biome === 0 || this.isRiverGrid[idx] === 1;
        const southDrop = elevGrid[idx] - (ty + 1 < GRID_H ? elevGrid[(ty + 1) * GRID_W + tx] : 0);
        const eastDrop  = elevGrid[idx] - (tx + 1 < GRID_W ? elevGrid[ty * GRID_W + tx + 1] : 0);
        this.walkGrid[idx] = (isWater || southDrop > 0 || eastDrop > 0) ? 1 : 0;
      }
    }

    // Store detail noise for per-tile rendering
    this.detNoise = detNoise;

    // Clear all existing tile sprites
    for (const sprites of this.tileSpriteMap.values()) {
      for (const s of sprites) s.destroy();
    }
    this.tileSpriteMap.clear();
    this.visibleTiles.clear();
    this.tileSprites = [];
    this.transitionSprites = [];

    // Force immediate viewport population
    this.updateVisibleTiles();

    // Draw elevation labels if enabled
    this.drawElevLabels();
  }

  // ── Frustum culling — render/destroy tiles as camera moves ──────────

  /** Padding in tile units around the camera viewport to avoid pop-in. */
  private static readonly CULL_PAD = 4;

  /**
   * Convert camera viewport bounds to a tile-coordinate rectangle.
   * Returns [minTx, minTy, maxTx, maxTy] clamped to the grid.
   */
  private getVisibleTileRange(): [number, number, number, number] {
    const cam = this.cameras.main;
    const pad = WildlifeForgeScene.CULL_PAD;

    // Use worldView for accurate viewport bounds regardless of zoom
    const left   = cam.worldView.x;
    const top    = cam.worldView.y;
    const right  = cam.worldView.right;
    const bottom = cam.worldView.bottom;

    // Convert iso corners to world-space tile coords.
    // Check all 4 viewport corners and take the bounding box.
    const c1 = isoToWorld(left, top);
    const c2 = isoToWorld(right, top);
    const c3 = isoToWorld(left, bottom);
    const c4 = isoToWorld(right, bottom);

    const minWx = Math.min(c1.x, c2.x, c3.x, c4.x);
    const maxWx = Math.max(c1.x, c2.x, c3.x, c4.x);
    const minWy = Math.min(c1.y, c2.y, c3.y, c4.y);
    const maxWy = Math.max(c1.y, c2.y, c3.y, c4.y);

    const minTx = Math.max(0, Math.floor(minWx / TILE_SIZE) - pad);
    const minTy = Math.max(0, Math.floor(minWy / TILE_SIZE) - pad);
    const maxTx = Math.min(GRID_W - 1, Math.ceil(maxWx / TILE_SIZE) + pad);
    const maxTy = Math.min(GRID_H - 1, Math.ceil(maxWy / TILE_SIZE) + pad);

    return [minTx, minTy, maxTx, maxTy];
  }

  /**
   * Create/destroy tile sprites based on camera position.
   * Called every frame in update().
   */
  private updateVisibleTiles(): void {
    const [minTx, minTy, maxTx, maxTy] = this.getVisibleTileRange();

    // Build set of tiles that should be visible
    const shouldBeVisible = new Set<number>();
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        shouldBeVisible.add(ty * GRID_W + tx);
      }
    }

    // Destroy tiles that left the viewport
    for (const idx of this.visibleTiles) {
      if (!shouldBeVisible.has(idx)) {
        const sprites = this.tileSpriteMap.get(idx);
        if (sprites) {
          for (const s of sprites) s.destroy();
          this.tileSpriteMap.delete(idx);
        }
      }
    }

    // Create tiles that entered the viewport
    for (const idx of shouldBeVisible) {
      if (!this.visibleTiles.has(idx)) {
        const tx = idx % GRID_W;
        const ty = (idx - tx) / GRID_W;
        this.renderTile(tx, ty);
      }
    }

    this.visibleTiles = shouldBeVisible;
  }

  /**
   * Create all sprites (floor + blend + cliffs) for a single tile.
   */
  private renderTile(tx: number, ty: number): void {
    const idx = ty * GRID_W + tx;
    const biomeIdx = this.biomeGrid[idx];
    const tileElev = this.elevGrid[idx];
    const sprites: Phaser.GameObjects.Image[] = [];

    const wx = tx * TILE_SIZE;
    const wy = ty * TILE_SIZE;
    const { x: isoX, y: isoY } = worldToIso(wx, wy);
    const CLIFF_H = ISO_TILE_H;
    const posY = isoY - tileElev * CLIFF_H;
    const depth = ty * 10 + 5;

    // Floor tile
    let texKey: string;
    let frame: number | undefined;

    if (this.isRiverGrid[idx]) {
      texKey = 'iso-tiles';
      frame = ISO_RIVER_FRAME;
    } else if (biomeIdx in CUSTOM_TILE_PACKS) {
      const packName = CUSTOM_TILE_PACKS[biomeIdx];
      const px = Math.floor(tx / 6), py = Math.floor(ty / 6);
      const qx = Math.floor((tx + 3) / 6), qy = Math.floor((ty + 2) / 6);
      const coarse  = ((px * 3571 ^ py * 2297 ^ px * py * 53) >>> 0) % 3;
      const coarse2 = ((qx * 4733 ^ qy * 1867 ^ qx * qy * 97) >>> 0) % 3;
      const fine    = ((tx * 1597 ^ ty * 2833 ^ (tx + ty) * 743) >>> 0) % 7;
      const tileHash = fine === 0 ? 3 : (fine <= 2 ? coarse2 : coarse);
      texKey = `${packName}-${tileHash}`;
    } else {
      texKey = 'iso-tiles';
      if (this.detNoise) {
        const detail = this.detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE, 2, 0.6);
        frame = isoTileFrame(biomeIdx, detail);
      }
    }

    const img = frame != null
      ? this.add.image(isoX, posY, texKey, frame)
      : this.add.image(isoX, posY, texKey);
    img.setOrigin(0.5, 0).setDepth(depth);
    sprites.push(img);

    // Blend overlays
    if (this.blendEnabled && !this.isRiverGrid[idx] && biomeIdx in CUSTOM_TILE_PACKS) {
      // Temporarily collect into transitionSprites, then move to our local array
      const before = this.transitionSprites.length;
      this.renderBlendOverlays(tx, ty, biomeIdx, isoX, posY, depth);
      // Move newly added transition sprites into this tile's sprite list
      for (let i = before; i < this.transitionSprites.length; i++) {
        sprites.push(this.transitionSprites[i]);
      }
    }

    // Cliff edges
    const getE = (etx: number, ety: number) =>
      etx >= 0 && etx < GRID_W && ety >= 0 && ety < GRID_H
        ? this.elevGrid[ety * GRID_W + etx] : 0;
    const southDrop = tileElev - getE(tx, ty + 1);
    const eastDrop  = tileElev - getE(tx + 1, ty);
    if (southDrop > 0 || eastDrop > 0) {
      const maxDrop = Math.max(southDrop, eastDrop);
      const isWaterfall = this.isRiverGrid[idx] === 1 && southDrop > 0;
      const wallTex = isWaterfall
        ? `waterfall-${((tx * 3 + ty * 7) >>> 0) % 5}`
        : cliffKey(biomeIdx);
      for (let step = maxDrop * 2; step >= 1; step--) {
        const cliff = this.add.image(isoX, posY + step * (CLIFF_H / 2), wallTex)
          .setOrigin(0.5, 0).setDepth(depth - 1);
        sprites.push(cliff);
      }
    }

    this.tileSpriteMap.set(idx, sprites);
    // Also keep in tileSprites for legacy cleanup on full rebuild
    this.tileSprites.push(...sprites);
  }

  // ── Blend overlays ─────────────────────────────────────────────────

  /**
   * Render alpha-blend overlays for a boundary tile using one of 3 modes.
   * All modes use the existing biome tile packs — no extra art required.
   */
  private renderBlendOverlays(
    tx: number, ty: number, biomeIdx: number,
    isoX: number, posY: number, depth: number,
  ): void {
    const TILE_PX = 32;

    // Determine the grid subdivision: 1×1, 2×2, or 4×4
    const divisions = 2;
    const cellSize = TILE_PX / divisions;

    // Sample all 8 neighbours to find the dominant other biome + per-direction presence
    const dirBiome = new Map<string, number>(); // "dx,dy" → biome index
    for (const [dx, dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
      const nb = this.biomeGrid[ny * GRID_W + nx];
      if (nb !== biomeIdx && nb in CUSTOM_TILE_PACKS) {
        dirBiome.set(`${dx},${dy}`, nb);
      }
    }
    if (dirBiome.size === 0) return;

    // Find dominant other biome
    const counts = new Map<number, number>();
    for (const b of dirBiome.values()) counts.set(b, (counts.get(b) ?? 0) + 1);
    let otherBiome = biomeIdx, bestCount = 0;
    for (const [b, c] of counts) {
      if (c > bestCount) { otherBiome = b; bestCount = c; }
    }
    const otherPack = CUSTOM_TILE_PACKS[otherBiome];

    // For each sub-cell, compute a blend strength based on proximity to
    // neighbours that belong to otherBiome.
    for (let cy = 0; cy < divisions; cy++) {
      for (let cx = 0; cx < divisions; cx++) {
        // Sub-cell centre in normalized [-1, 1] space
        const sx = (cx + 0.5) / divisions * 2 - 1; // -1=left, +1=right
        const sy = (cy + 0.5) / divisions * 2 - 1; // -1=top,  +1=bottom

        // Accumulate influence from each neighbour direction
        let influence = 0;
        for (const [key, nb] of dirBiome) {
          if (nb !== otherBiome) continue;
          const [dxs, dys] = key.split(',').map(Number);
          // How aligned is this sub-cell with this neighbour direction?
          // dot product of sub-cell position and neighbour direction
          const dot = sx * dxs + sy * dys;
          if (dot > 0) influence += dot * 0.25;
        }

        if (influence < 0.05) continue;
        const alpha = Math.min(0.55, influence);

        const variant = ((tx * 1597 ^ ty * 2833 ^ cx * 431 ^ cy * 719) >>> 0) % 4;
        const otherKey = `${otherPack}-${variant}`;
        const cropX = cx * cellSize;
        const cropY = cy * cellSize;

        const overlay = this.add.image(isoX, posY, otherKey)
          .setOrigin(0.5, 0).setDepth(depth + 0.1)
          .setAlpha(alpha)
          .setCrop(cropX, cropY, cellSize, cellSize);
        this.tileSprites.push(overlay);
        this.transitionSprites.push(overlay);
      }
    }
  }

  // ── Elevation labels ──────────────────────────────────────────────────

  private ensureElevTextures(): void {
    // Generate tiny 8x8 textures with digits 0-3 (one-time)
    const ELEV_COLORS = [0x4488ff, 0x44cc44, 0xcccc44, 0xff4444]; // blue, green, yellow, red
    for (let d = 0; d < 4; d++) {
      const key = `elev-${d}`;
      if (this.textures.exists(key)) continue;
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.6);
      g.fillCircle(5, 5, 5);
      g.fillStyle(ELEV_COLORS[d], 1);
      g.fillCircle(5, 5, 3);
      g.generateTexture(key, 10, 10);
      g.destroy();
    }
  }

  private drawElevLabels(): void {
    if (this.elevContainer) { this.elevContainer.destroy(); this.elevContainer = null; }
    if (!this.showElevation) return;

    this.ensureElevTextures();

    // Only label tiles at elevation boundaries (where neighbours differ)
    const labels: Phaser.GameObjects.Image[] = [];
    for (let ty = 0; ty < GRID_H; ty++) {
      for (let tx = 0; tx < GRID_W; tx++) {
        const idx = ty * GRID_W + tx;
        const elev = this.elevGrid[idx];

        // Check if any neighbour has a different elevation
        let boundary = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + dx, ny = ty + dy;
          if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
            if (this.elevGrid[ny * GRID_W + nx] !== elev) { boundary = true; break; }
          }
        }
        if (!boundary) continue;

        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const { x: isoX, y: isoY } = worldToIso(wx, wy);
        const posY = isoY - elev * ISO_TILE_H + 8;

        const img = this.add.image(isoX, posY, `elev-${elev}`)
          .setOrigin(0.5, 0.5).setDepth(ty * 10 + 6);
        labels.push(img);
      }
    }

    this.elevContainer = this.add.container(0, 0, labels).setDepth(9500);
  }

  // ── Tile grid overlay (static, drawn once) ─────────────────────────────

  private gridGfx: Phaser.GameObjects.Graphics | null = null;

  private drawTileGrid(): void {
    if (this.gridGfx) this.gridGfx.destroy();
    this.gridGfx = this.add.graphics().setDepth(8500);
    this.gridGfx.lineStyle(1, 0xffffff, 0.06);

    // Draw iso grid lines along the tx axis (NW→SE diagonals)
    for (let tx = 0; tx <= GRID_W; tx += 1) {
      const a = worldToIso(tx * TILE_SIZE, 0);
      const b = worldToIso(tx * TILE_SIZE, WORLD_H);
      this.gridGfx.lineBetween(a.x, a.y, b.x, b.y);
    }
    // Draw iso grid lines along the ty axis (NE→SW diagonals)
    for (let ty = 0; ty <= GRID_H; ty += 1) {
      const a = worldToIso(0, ty * TILE_SIZE);
      const b = worldToIso(WORLD_W, ty * TILE_SIZE);
      this.gridGfx.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  // ── Wildlife ────────────────────────────────────────────────────────────

  private createWildlifeAnims(): void {
    const DIRS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
    const ANIM_RATES: Record<string, number> = {
      idle: 6, walk: 8, run: 12, alert: 6, sneak: 6,
    };

    for (const { species, anims } of WILDLIFE_SPECS) {
      for (const anim of anims) {
        const rate = ANIM_RATES[anim] ?? 6;
        for (const d of DIRS) {
          const texKey = `${species}-${anim}-${d}`;
          const animKey = `${species}-${anim}-${d}-anim`;
          if (this.textures.exists(texKey) && !this.anims.exists(animKey)) {
            const frameCount = this.textures.get(texKey).getFrameNames(false).length;
            const frames = Array.from({ length: Math.max(1, frameCount) }, (_, i) => i);
            this.anims.create({
              key: animKey,
              frames: this.anims.generateFrameNumbers(texKey, { frames }),
              frameRate: rate,
              repeat: -1,
            });
          }
        }
      }
      // Fallback idle anim (SE direction)
      const fallbackTex = `${species}-idle-se`;
      const fallbackKey = `${species}-idle-anim`;
      if (this.textures.exists(fallbackTex) && !this.anims.exists(fallbackKey)) {
        const frameCount = this.textures.get(fallbackTex).getFrameNames(false).length;
        const frames = Array.from({ length: Math.max(1, frameCount) }, (_, i) => i);
        this.anims.create({
          key: fallbackKey,
          frames: this.anims.generateFrameNumbers(fallbackTex, { frames }),
          frameRate: 6,
          repeat: -1,
        });
      }
    }
  }

  private spawnWildlife(): void {
    if (this.wildlife) {
      this.wildlife.destroy();
      this.wildlife = null;
    }

    if (!this.faunaReg) return;

    this.wildlife = new WildlifeSystem({
      scene: this,
      faunaRegistry: this.faunaReg,
      worldW: WORLD_W,
      worldH: WORLD_H,
      tileSize: TILE_SIZE,
      worldToIso,
      isoToWorld,
      isoDepth,
      speciesFilter: ALL_SPECIES,
      seed: this.seed,
      // Land animals → reject water; aquatic animals → require water.
      // Current species are all land-based. When fish/whales are added to
      // fauna-registry with archetype 'aquatic', they'll spawn in water only.
      spawnBias: (wx: number, wy: number, type: string) => {
        const tx = Math.floor(wx / TILE_SIZE);
        const ty = Math.floor(wy / TILE_SIZE);
        if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) return 0;
        const isWater = this.walkGrid[ty * GRID_W + tx] === 1
          && (this.biomeGrid[ty * GRID_W + tx] === 0 || this.isRiverGrid[ty * GRID_W + tx] === 1);
        const isBlocked = this.walkGrid[ty * GRID_W + tx] === 1;
        // Future: check fauna registry archetype for 'aquatic'
        const aquaticSpecies: string[] = []; // e.g. ['salmon', 'whale']
        if (aquaticSpecies.includes(type)) return isWater ? 1 : 0;
        return isBlocked ? 0 : 1;
      },
      walkGrid: this.walkGrid,
      gridW: GRID_W,
      gridH: GRID_H,
      getBiomeAtTile: (tx: number, ty: number) => {
        if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) return 6;
        return this.biomeGrid[ty * GRID_W + tx];
      },
      hasAdjacentWater: (tx: number, ty: number) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = tx + dx, ny = ty + dy;
            if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
              if (this.biomeGrid[ny * GRID_W + nx] === 0 || this.isRiverGrid[ny * GRID_W + nx] === 1) return true;
            }
          }
        }
        return false;
      },
      scaleOverride: 0.55,
      getEnvContext: (): WildlifeEnvContext => ({
        isRaining: false,
        season: 'summer',
        phase: DAY_PHASES[this.dayPhaseIdx],
      }),
    });
    this.wildlife.init();
    this.wildlife.spawnGroundAnimals();
  }

  // ── Input ───────────────────────────────────────────────────────────────

  private setupInput(): void {
    const kb = this.input.keyboard!;

    // Re-roll terrain
    kb.on('keydown-R', () => this.reroll());

    // Species cycling (Q/E — WASD used for camera panning)
    kb.on('keydown-Q', () => this.cycleSpecies(-1));
    kb.on('keydown-E', () => this.cycleSpecies(1));

    // Re-populate wildlife
    kb.on('keydown-P', () => { this.spawnWildlife(); this.updateHUD(); });

    // Pause / speed
    kb.on('keydown-SPACE', () => { this.paused = !this.paused; this.updateHUD(); });
    kb.on('keydown-OPEN_BRACKET', () => {
      this.simSpeed = Math.max(0.25, this.simSpeed / 2);
      this.updateHUD();
    });
    kb.on('keydown-CLOSE_BRACKET', () => {
      this.simSpeed = Math.min(8, this.simSpeed * 2);
      this.updateHUD();
    });

    // Day phase cycle
    kb.on('keydown-O', () => {
      this.dayPhaseIdx = (this.dayPhaseIdx + 1) % DAY_PHASES.length;
      this.updateHUD();
    });

    // Debug overlays 1-5
    for (let i = 0; i < 5; i++) {
      kb.on(`keydown-${i + 1}`, () => {
        this.overlayFlags[i] = !this.overlayFlags[i];
      });
    }

    // Blend layer toggle (T = cycle blend modes)
    kb.on('keydown-T', () => {
      this.blendEnabled = !this.blendEnabled;
      this.buildTerrain();
      this.drawTileGrid();
      this.updateHUD();
    });

    // Elevation labels toggle (V)
    kb.on('keydown-V', () => {
      this.showElevation = !this.showElevation;
      this.drawElevLabels();
      this.updateHUD();
    });

    // Click to emit noise (spawn placeholder)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.camStartX = this.cameras.main.scrollX;
        this.camStartY = this.cameras.main.scrollY;
        return;
      }
      if (pointer.leftButtonDown() && this.wildlife) {
        const worldPos = isoToWorld(pointer.worldX, pointer.worldY);
        this.wildlife.emitNoise(worldPos.x, worldPos.y, 120);
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        this.cameras.main.scrollX = this.camStartX - (pointer.x - this.dragStartX);
        this.cameras.main.scrollY = this.camStartY - (pointer.y - this.dragStartY);
      }
    });

    this.input.on('pointerup', () => { this.isDragging = false; });

    // Zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gos: unknown[], _dx: number, dy: number) => {
      this.zoomLevel = Phaser.Math.Clamp(this.zoomLevel - dy * 0.001, 0.2, 3.0);
      this.cameras.main.setZoom(this.zoomLevel);
    });
  }

  private reroll(): void {
    this.seed = Math.floor(Math.random() * 0xffffffff);
    this.buildTerrain();
    this.drawTileGrid();
    this.spawnWildlife();
    this.updateHUD();
  }

  private cycleSpecies(delta: number): void {
    this.selectedSpeciesIdx = (this.selectedSpeciesIdx + delta + ALL_SPECIES.length) % ALL_SPECIES.length;
    this.updateHUD();
  }

  // ── Debug overlays ────────────────────────────────────────────────────

  private updateDebugOverlays(): void {
    if (!this.debugGfx) return;
    this.debugGfx.clear();

    if (!this.wildlife) return;

    const bodies = this.wildlife.groundAnimals.getChildren() as Phaser.GameObjects.Sprite[];

    for (const body of bodies) {
      if (!body.active) continue;
      const state = body.getData('animalState') as string | undefined;
      const type = body.getData('animalType') as string | undefined;
      if (!type) continue;

      const iso = worldToIso(body.x, body.y);

      // Overlay 1: State dots
      if (this.overlayFlags[0] && state) {
        const stateColor = this.stateColor(state);
        this.debugGfx.fillStyle(stateColor, 0.8);
        this.debugGfx.fillCircle(iso.x, iso.y - 20, 3);
      }

      // Overlay 2: Radii
      if (this.overlayFlags[1]) {
        this.debugGfx.lineStyle(1, 0xff4444, 0.3);
        this.debugGfx.strokeCircle(iso.x, iso.y, 40);
        this.debugGfx.lineStyle(1, 0xffff44, 0.2);
        this.debugGfx.strokeCircle(iso.x, iso.y, 60);
      }

      // Overlay 4: Predator/prey lines
      if (this.overlayFlags[3]) {
        const target = body.getData('chaseTarget') as Phaser.GameObjects.Sprite | undefined;
        if (target && target.active) {
          const tIso = worldToIso(target.x, target.y);
          this.debugGfx.lineStyle(1, 0xff4444, 0.5);
          this.debugGfx.lineBetween(iso.x, iso.y, tIso.x, tIso.y);
        }
      }
    }

    // Overlay 3: Walk grid (sample every 2 tiles for performance)
    if (this.overlayFlags[2]) {
      this.debugGfx.lineStyle(0, 0);
      for (let ty = 0; ty < GRID_H; ty += 2) {
        for (let tx = 0; tx < GRID_W; tx += 2) {
          if (this.walkGrid[ty * GRID_W + tx] === 1) {
            const iso = worldToIso(tx * TILE_SIZE, ty * TILE_SIZE);
            this.debugGfx.fillStyle(0xff0000, 0.25);
            this.debugGfx.fillCircle(iso.x, iso.y, 3);
          }
        }
      }
    }

    // Overlay 5: Biome grid (sample every 4 tiles)
    if (this.overlayFlags[4]) {
      for (let ty = 0; ty < GRID_H; ty += 4) {
        for (let tx = 0; tx < GRID_W; tx += 4) {
          const biome = this.biomeGrid[ty * GRID_W + tx];
          const color = BIOMES[biome]?.overlayColor ?? 0x888888;
          const iso = worldToIso(tx * TILE_SIZE, ty * TILE_SIZE);
          this.debugGfx.fillStyle(color, 0.4);
          this.debugGfx.fillCircle(iso.x, iso.y, 4);
        }
      }
    }
  }

  private stateColor(state: string): number {
    switch (state) {
      case 'roaming':   return 0x44ff44;
      case 'fleeing':   return 0xff4444;
      case 'chasing':   return 0xff8800;
      case 'stalking':  return 0xff6600;
      case 'alert':     return 0xffff00;
      case 'grazing':   return 0x88ff88;
      case 'foraging':  return 0x88ddff;
      case 'resting':   return 0x8888ff;
      case 'sleeping':  return 0x6666aa;
      case 'dying':     return 0x880000;
      case 'injured':   return 0xff0088;
      default:          return 0xffffff;
    }
  }

  // ── HUD ─────────────────────────────────────────────────────────────────

  private updateHUD(): void {
    const species = ALL_SPECIES[this.selectedSpeciesIdx];
    const phase = DAY_PHASES[this.dayPhaseIdx];
    const pauseStr = this.paused ? ' [PAUSED]' : '';

    this.hudText.setText([
      `WildlifeForge v0.2 — seed ${this.seed.toString(16)}`,
      `Species: ${species}  |  Phase: ${phase}  |  Speed: ${this.simSpeed}x${pauseStr}`,
      `Blend: T [${this.blendEnabled ? 'ON' : 'OFF'}]  Tiles: ${this.visibleTiles.size}/${GRID_W * GRID_H}  Sprites: ${this.tileSpriteMap.size}  Elevation: V [${this.showElevation ? 'ON' : 'OFF'}]`,
    ].join('\n'));

    const h = this.scale.height;
    this.hintText.setText(
      'WASD/Arrows: pan  Q/E: species  R: re-roll  P: populate  Space: pause  [/]: speed  T: transitions  V: elevation'
    );
    this.hintText.setPosition(10, h - 30);
  }

  private updateAnimalCount(): void {
    if (!this.wildlife) return;
    const count = this.wildlife.groundAnimals.getLength();
    const birdCount = this.wildlife.birds.length;
    this.animalCountText.setText(`Animals: ${count}  Birds: ${birdCount}`);
  }
}
