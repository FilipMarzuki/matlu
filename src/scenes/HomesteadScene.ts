/**
 * HomesteadScene — standalone base-building + crafting + gathering scene.
 *
 * Renders an isometric tiled meadow using the same 2:1 projection as the
 * main world (IsoTransform). Physics stays in flat world space; only the
 * visual rendering is projected to iso.
 *
 * Route: /homestead
 * Controls:
 *   WASD / Arrow keys — move (iso-corrected: "up" = northwest)
 *   E — interact with nearby resource node
 *   C — open crafting menu
 *   I — toggle inventory panel
 */

import * as Phaser from 'phaser';
import { InventorySystem } from '../systems/InventorySystem';
import { InventoryHUD } from '../ui/InventoryHUD';
import { ResourceNode, type ResourceNodeTypeDef } from '../entities/ResourceNode';
import { SimpleJoystick } from '../lib/SimpleJoystick';
import { HomesteadAuth } from '../lib/HomesteadAuth';
import { preloadTilePacks, CUSTOM_TILE_PACKS } from '../world/TilePacks';

// ── Grid constants ─────────────────────────────────────────────────────────
// 60×60 grid. Left half (tx 0-29) = homestead meadow, water body in the SW.
// Right half (tx 30-59) = WorldForge terrain (elevation, river, waterfall, ocean).
// Mountain range along NE border blends into WF highlands.

const TILE_SIZE = 32;
const GRID_W = 60;       // tiles wide (tx axis)
const GRID_H = 60;       // tiles tall (ty axis)
const WORLD_W = GRID_W * TILE_SIZE;
const WORLD_H = GRID_H * TILE_SIZE;
const PLAYER_SPEED = 120;
const INTERACT_RADIUS = 50;

// Offset to shift original 20×20 resource/node placements into the left half.
const HS_OFFSET = 5;

// ── Iso projection ────────────────────────────────────────────────────────
// 2:1 diamond for a non-square grid (GRID_W × GRID_H).

const ISO_TILE_W = 32;
const ISO_TILE_H = 16;
const ISO_ORIGIN_X = GRID_H * (ISO_TILE_W / 2);  // W apex → left edge
const ISO_W = (GRID_W + GRID_H) * (ISO_TILE_W / 2);
const ISO_H = (GRID_W + GRID_H) * (ISO_TILE_H / 2) + ISO_TILE_H;

// ── Cliff / elevation ─────────────────────────────────────────────────────
const CLIFF_H = 32;  // one elevation step = one 32×32 cliff block

// ── Zone system ───────────────────────────────────────────────────────────
// Left half (tx < 30): homestead meadow + NW forest + NE mountain strip.
// Right half (tx ≥ 30): full WorldForge terrain at native 30×30 size.

type ZoneType = 'homestead' | 'wf';

function getZone(tx: number, _ty: number): ZoneType {
  // Right half → WorldForge terrain (elevation, river, waterfall)
  if (tx >= 30) return 'wf';
  return 'homestead';
}

// ── WorldForge terrain (right half, local coords ltx=tx-30, lty=ty) ───────
// Ported from WorldForgeScene.buildDisplay() — full elevation, river, cliffs,
// waterfall, biome bands. Local diagonal ld = ltx+lty runs NW→SE within the
// 30×30 sub-grid.

const WF_GRID_W   = 30;   // WF sub-grid width (ltx range: 0-29)
const WF_ELEV_CUT = 10;   // ld < this → highlands
const WF_OCEAN_CUT = 48;  // ld > this → ocean

/** River centre at local diagonal ld — meanders via two sine terms. */
function wfRiverCenter(ld: number): number {
  return Math.round(ld / 2 + Math.sin(ld * 0.35) * 3 + Math.cos(ld * 0.65) * 1.5);
}

/** Curved boundary perturbation for biome edges. */
const wfCurveDepth = (h: number) =>
  Math.round(Math.sin(h * 0.29) * 2.5 + Math.cos(h * 0.53) * 1.5);

/** Elevation: 0 = lowland, 1 = mid, 2 = peak (WF right half). */
function wfGetElev(ltx: number, lty: number): 0 | 1 | 2 {
  const ld = ltx + lty;
  const horiz = ltx - lty;
  const effDist = WF_ELEV_CUT + wfCurveDepth(horiz) - ld;
  if (effDist <= 0) return 0;
  if (horiz > 7) return effDist > 3 ? 2 : 1;
  return 2;
}

/** Unified elevation for the full map — highland strip along NE edge. */
function getElev(tx: number, ty: number): 0 | 1 | 2 {
  if (tx >= 30) return wfGetElev(tx - 30, ty);
  const horiz = tx - ty;
  const effDist = WF_ELEV_CUT + wfCurveDepth(horiz) - ty;
  if (effDist <= 0) return 0;
  return effDist > 3 ? 2 : 1;
}

/** Cliff material for a biome index. */
const WF_CLIFF_MAT: Record<number, string> = {
  1: 'cliff-stone', 3: 'cliff-peat', 9: 'cliff-stone',
  10: 'cliff-stone', 11: 'cliff-snow',
};
function wfCliffKey(biomeIdx: number): string {
  return WF_CLIFF_MAT[biomeIdx] ?? 'cliff-earthy';
}

/** Shore biome for ocean edge. */
const WF_SHORE: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 2, 5: 1, 6: 2, 7: 2, 8: 1, 9: 1, 10: 1, 11: 1,
};

/** Dual-grid tile hash (natural texture variety within a biome). */
function wfTileHash(tx: number, ty: number): number {
  const px = Math.floor(tx / 6),       py = Math.floor(ty / 6);
  const qx = Math.floor((tx + 3) / 6), qy = Math.floor((ty + 2) / 6);
  const coarse  = ((px * 3571 ^ py * 2297 ^ px * py * 53) >>> 0) % 3;
  const coarse2 = ((qx * 4733 ^ qy * 1867 ^ qx * qy * 97) >>> 0) % 3;
  const fine    = ((tx * 1597 ^ ty * 2833 ^ (tx + ty) * 743) >>> 0) % 7;
  return fine === 0 ? 3 : (fine <= 2 ? coarse2 : coarse);
}

function hsWorldToIso(wx: number, wy: number): { x: number; y: number } {
  const tx = wx / TILE_SIZE;
  const ty = wy / TILE_SIZE;
  return {
    x: ISO_ORIGIN_X + (tx - ty) * (ISO_TILE_W / 2),
    y: (tx + ty) * (ISO_TILE_H / 2),
  };
}

function hsIsoDepth(wx: number, wy: number): number {
  return (wx + wy) / TILE_SIZE;
}

/**
 * Convert screen-space input direction to world-space direction.
 * In iso view, "screen up" = northwest in world space (rotated 45° CCW).
 */
function isoInputToWorld(svx: number, svy: number): { wx: number; wy: number } {
  // Rotate 45° CCW to map screen axes → world axes
  const cos45 = Math.SQRT1_2;
  return {
    wx:  svx * cos45 + svy * cos45,
    wy: -svx * cos45 + svy * cos45,
  };
}

// ── Placeable buildings ─────────────────────────────────────────────────────

interface BuildingDef {
  id: string;
  label: string;
  spriteKey: string;
  footW: number;
  footD: number;
}

const BUILDINGS: BuildingDef[] = [
  { id: 'campfire',     label: 'Campfire',     spriteKey: 'bld-campfire',     footW: 1, footD: 1 },
  { id: 'yurt-small',   label: 'Small Yurt',   spriteKey: 'bld-yurt-small',  footW: 2, footD: 2 },
  { id: 'yurt-large',   label: 'Large Yurt',   spriteKey: 'bld-yurt-large',  footW: 3, footD: 3 },
  { id: 'well',         label: 'Well',          spriteKey: 'bld-well',        footW: 1, footD: 1 },
  { id: 'farmstead',    label: 'Farmstead',     spriteKey: 'bld-farmstead',   footW: 3, footD: 3 },
  { id: 'smithy',       label: 'Smithy',        spriteKey: 'bld-smithy',      footW: 2, footD: 2 },
  { id: 'cottage',      label: 'Cottage',       spriteKey: 'bld-cottage',     footW: 2, footD: 2 },
  { id: 'shelter-hut',  label: 'Shelter',       spriteKey: 'bld-shelter-hut', footW: 2, footD: 1 },
];

// ── Available characters ────────────────────────────────────────────────────

interface CharacterDef {
  key: string;
  label: string;
  png: string;
  json: string;
}

const CHARACTERS: CharacterDef[] = [
  { key: 'loke',     label: 'Loke',     png: '/assets/sprites/characters/mistheim/heroes/loke/loke.png',         json: '/assets/sprites/characters/mistheim/heroes/loke/loke.json' },
  { key: 'skald',    label: 'Skald',    png: '/assets/sprites/characters/earth/heroes/skald/skald.png',          json: '/assets/sprites/characters/earth/heroes/skald/skald.json' },
  { key: 'tinkerer', label: 'Tinkerer', png: '/assets/sprites/characters/earth/heroes/tinkerer/tinkerer.png',    json: '/assets/sprites/characters/earth/heroes/tinkerer/tinkerer.json' },
];

// ── Direction helpers ──────────────────────────────────────────────────────
// Map world-space velocity to a canonical facing direction.
// West-side dirs are mirrored via flipX (same pattern as HumanoidNPC).

type FaceDir = 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'west';

function velocityToFacing(vx: number, vy: number): { dir: FaceDir; flip: boolean } | null {
  if (vx === 0 && vy === 0) return null;
  const angle = Math.atan2(vy, vx);
  const sector = Math.round(angle / (Math.PI / 4));
  const DIR_MAP: Record<number, { dir: FaceDir; flip: boolean }> = {
     0: { dir: 'east',       flip: false },
     1: { dir: 'south-east', flip: false },
     2: { dir: 'south',      flip: false },
     3: { dir: 'south-east', flip: true  },   // SW → flip SE
     4: { dir: 'west',       flip: false },
    '-4': { dir: 'west',     flip: false },
    '-3': { dir: 'north-east', flip: true  }, // NW → flip NE
    '-2': { dir: 'north',    flip: false },
    '-1': { dir: 'north-east', flip: false },
  };
  return DIR_MAP[sector] ?? { dir: 'south', flip: false };
}

// ── Scene ───────────────────────────────────────────────────────────────────

export class HomesteadScene extends Phaser.Scene {
  static readonly KEY = 'HomesteadScene';

  constructor() { super({ key: HomesteadScene.KEY }); }

  private player!: Phaser.Physics.Arcade.Image;
  private playerIso!: Phaser.GameObjects.Sprite;  // animated sprite in iso space
  private interactZone!: Phaser.GameObjects.Arc;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private joystick: SimpleJoystick | null = null;
  private actionBtn: Phaser.GameObjects.Arc | null = null;
  private actionLabel: Phaser.GameObjects.Text | null = null;
  private resourceNodes: ResourceNode[] = [];
  private nodesInRange = new Set<ResourceNode>();
  private actionTapped = false;
  private targetNode: ResourceNode | null = null;

  // Wolf wildlife preview
  private wolfSprite?: Phaser.GameObjects.Sprite;
  private wolfWx = 0; private wolfWy = 0;
  private wolfVx = 0; private wolfVy = 0;
  private wolfTimer = 0;
  private wolfDir = 'se';
  private characterKey = 'loke';
  private facingDir: 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'west' = 'south';
  private lastSafeX = 0;
  private lastSafeY = 0;

  // ── Building placement ─────────────────────────────────────────────────
  private selectedBuilding: BuildingDef | null = null;
  private occupied = new Uint8Array(GRID_W * GRID_H);
  private placedBuildings: Phaser.GameObjects.Image[] = [];
  private toolbarBtns: Phaser.GameObjects.Container[] = [];
  private ghostSprite: Phaser.GameObjects.Image | null = null;
  private footprintGfx: Phaser.GameObjects.Graphics | null = null;
  private lastHoverTx = -1;
  private lastHoverTy = -1;
  private uiLayer: Phaser.GameObjects.GameObject[] = [];
  private cancelBtn: Phaser.GameObjects.Container | null = null;

  // ── WF geography zone state ───────────────────────────────────────────
  private wfFrame = 0;  // current waterfall animation frame (0-4)
  private wfSprites: Phaser.GameObjects.Image[] = [];  // waterfall wall tiles

  // ── Walkability ───────────────────────────────────────────────────────
  // 0 = walkable, 1 = blocked (water, cliff). Row-major: ty * GRID_W + tx.
  private walkGrid = new Uint8Array(GRID_W * GRID_H);

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    this.load.json('resources', '/macro-world/resources.json');
    this.load.json('resource-nodes', '/macro-world/resource-nodes.json');

    // All biome tile packs (meadow, forest, cold-granite, bare-summit, etc.)
    preloadTilePacks(this);

    // Iso spritesheet — used for water tiles in the WF geography zone
    this.load.spritesheet('iso-tiles',
      '/assets/packs/isometric tileset/spritesheet.png',
      { frameWidth: 32, frameHeight: 32 });

    // Cliff block tiles (32×32 cubes) — stacked for elevation walls
    this.load.image('cliff-earthy', '/assets/packs/cliff-iso-gen/earthy_0.png');
    this.load.image('cliff-snow',   '/assets/packs/cliff-iso-gen/snow_0.png');
    this.load.image('cliff-peat',   '/assets/packs/cliff-iso-gen/peat_0.png');
    this.load.image('cliff-stone',  '/assets/packs/cliff-iso-gen/stone_iso_0.png');

    // Waterfall tiles — 5-frame animation replacing cliff blocks where river drops
    for (let i = 0; i < 5; i++) {
      this.load.image(`waterfall-${i}`, `/assets/packs/waterfall-tiles/${i}.png`);
    }
    // Water-topped waterfall blocks — 6-frame animation for the topmost block
    for (let i = 0; i < 6; i++) {
      this.load.image(`wf-top-${i}`, `/assets/packs/waterfall-tiles/t${i}.png`);
    }

    // Bridge sprites for road-over-river crossings
    this.load.image('bridge-mid',  '/assets/sprites/crossings/bridge/mid-0.png');
    this.load.image('bridge-ramp', '/assets/sprites/crossings/bridge/ramp.png');

    // Road tiles — dirt road for the WF geography zone
    this.load.spritesheet('road-dirt', '/assets/sprites/tilesets/roads/road-dirt.png',
      { frameWidth: 32, frameHeight: 16 });

    // Character spritesheets (Aseprite atlas format)
    for (const c of CHARACTERS) {
      this.load.aseprite(c.key, c.png, c.json);
    }
    // Building sprites (ikibeki culture)
    for (const b of BUILDINGS) {
      this.load.image(b.spriteKey, `/assets/packs/building-objects/ikibeki/${b.id}.png`);
    }

    // ── Tree sprites for the forest zone ──────────────────────────────────
    for (let i = 0; i < 6; i++)  this.load.image(`tree-oak-sapling-${i}`, `/assets/sprites/trees/oak/sapling/${i}.png`);
    for (let i = 0; i < 5; i++)  this.load.image(`tree-oak-young-${i}`,   `/assets/sprites/trees/oak/young/${i}.png`);
    for (let i = 0; i < 14; i++) this.load.image(`tree-oak-${i}`,         `/assets/sprites/trees/oak/mature/${i}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`tree-elm-sapling-${i}`, `/assets/sprites/trees/elm/sapling/${i}.png`);
    for (let i = 0; i < 3; i++) this.load.image(`tree-elm-young-${i}`,   `/assets/sprites/trees/elm/young/${i}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`tree-elm-${i}`,         `/assets/sprites/trees/elm/mature/${i}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`tree-birch-sapling-${i}`, `/assets/sprites/trees/birch/sapling/${i}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`tree-birch-young-${i}`,   `/assets/sprites/trees/birch/young/${i}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`tree-birch-${i}`,         `/assets/sprites/trees/birch/mature/${i}.png`);
    for (let i = 0; i < 3; i++) this.load.image(`tree-pine-sapling-${i}`, `/assets/sprites/trees/pine/sapling/${i}.png`);
    for (let i = 0; i < 2; i++) this.load.image(`tree-pine-young-${i}`,   `/assets/sprites/trees/pine/young/${i}.png`);
    for (let i = 0; i < 3; i++) this.load.image(`tree-pine-${i}`,         `/assets/sprites/trees/pine/mature/${i}.png`);
    for (let i = 0; i < 3; i++) this.load.image(`tree-spruce-sapling-${i}`, `/assets/sprites/trees/spruce/sapling/${i}.png`);
    for (let i = 0; i < 3; i++) this.load.image(`tree-spruce-young-${i}`,   `/assets/sprites/trees/spruce/young/${i}.png`);
    for (let i = 0; i < 3; i++) this.load.image(`tree-spruce-${i}`,         `/assets/sprites/trees/spruce/mature/${i}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`tree-ancient-${i}`, `/assets/sprites/trees/ancient/mature/${i}.png`);

    // Wolf spritesheets — 8 directions for template anims
    const wolfBase = '/assets/sprites/wildlife/wolf';
    for (const anim of ['idle', 'walk', 'run']) {
      for (const d of ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw']) {
        this.load.spritesheet(`wolf-${anim}-${d}`, `${wolfBase}/${anim}_${d}.png`, { frameWidth: 48, frameHeight: 48 });
      }
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a3a1a');

    // Physics world stays in flat grid space
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    // ── Inventory ─────────────────────────────────────────────────────────
    const inv = new InventorySystem(this);
    const resDefs = this.cache.json.get('resources') as { resources: { id: string; name: string; category: string; stackMax: number }[] } | undefined;
    if (resDefs?.resources) inv.loadResourceDefs(resDefs.resources as never[]);
    inv.add('flint', 4);
    inv.add('dry-grass', 6);

    // ── Iso terrain ──────────────────────────────────────────────────────
    // Painter's algorithm: iterate diagonals (tx + ty = constant) so
    // back tiles render first and front tiles overlap correctly.
    //
    // Non-geography zones get a simple flat tile per position.
    // The right half (tx ≥ 30) uses the full WorldForge terrain
    // system: elevation with cliff stacking, a meandering river with a
    // waterfall at the cliff edge, and biome bands (highland → midland → ocean).

    // Procedural particle textures
    if (!this.textures.exists('splash-dot')) {
      const g = this.add.graphics();
      g.fillStyle(0xb0d0ff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture('splash-dot', 2, 2);
      g.destroy();
    }
    if (!this.textures.exists('foam-dot')) {
      const g = this.add.graphics();
      g.fillStyle(0xe8f0ff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture('foam-dot', 2, 2);
      g.destroy();
    }

    // The main biome used for WF midlands (Meadow).
    const wfBiome = 6;

    for (let diag = 0; diag < GRID_W + GRID_H - 1; diag++) {
      const txMin = Math.max(0, diag - (GRID_H - 1));
      const txMax = Math.min(diag, GRID_W - 1);
      for (let tx = txMin; tx <= txMax; tx++) {
        const ty = diag - tx;
        const zone = getZone(tx, ty);
        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const { x: isoX, y: isoY } = hsWorldToIso(wx, wy);
        const baseDepth = hsIsoDepth(wx, wy);

        // ── Left half: meadow with elevation along NE edge ───────────
        if (zone !== 'wf') {
          const tileElev = getElev(tx, ty);
          const posY = isoY - tileElev * CLIFF_H;
          const th = wfTileHash(tx, ty);

          // Water body in the SW — wavy shoreline continuing from the WF ocean
          const shoreEdge = 42 + Math.round(Math.sin(tx * 0.3) * 3 + Math.cos(tx * 0.18) * 2);
          const hsIsWater = tileElev === 0 && ty > shoreEdge;

          let pack: string;
          if (hsIsWater) {
            // Water tile — rendered below, skip biome pack
            pack = '';
          } else if (ty <= 2 && tileElev === 2) {
            pack = CUSTOM_TILE_PACKS[11]!;
          } else if (tileElev === 2) {
            pack = CUSTOM_TILE_PACKS[10]!;
          } else if (tileElev === 1) {
            pack = CUSTOM_TILE_PACKS[9]!;
          } else if (ty > shoreEdge - 2) {
            // Sandy shore transition near water edge
            pack = CUSTOM_TILE_PACKS[2]!;
          } else {
            pack = 'meadow';
          }

          const sDrop = tileElev > 0 && ty + 1 < GRID_H ? tileElev - getElev(tx, ty + 1) : 0;
          const eDrop = tileElev > 0 && tx + 1 < GRID_W ? tileElev - getElev(tx + 1, ty) : 0;
          const wDrop = tileElev > 0 && tx > 0           ? tileElev - getElev(tx - 1, ty) : 0;
          const hasCliff = sDrop > 0 || eDrop > 0 || wDrop > 0;

          // Mark walkability — water, cliffs, and elevated terrain are impassable
          if (hsIsWater || hasCliff || tileElev > 0) this.walkGrid[ty * GRID_W + tx] = 1;

          if (hsIsWater) {
            this.add.image(isoX, posY, 'iso-tiles', 105)
              .setOrigin(0.5, 0).setDepth(baseDepth - 1000);
          } else if (hasCliff) {
            const cliffBiome = tileElev === 2 ? 11 : tileElev === 1 ? 10 : 9;
            const cliffKey = wfCliffKey(cliffBiome);
            const maxDrop = Math.max(sDrop, eDrop, wDrop);
            for (let step = maxDrop * 2; step >= 1; step--) {
              this.add.image(isoX, posY + step * (CLIFF_H / 2), cliffKey)
                .setOrigin(0.5, 0).setDepth(baseDepth - 1000);
            }
            this.add.image(isoX, posY, `${pack}-${th}`)
              .setOrigin(0.5, 0).setDepth(baseDepth - 999);
          } else {
            this.add.image(isoX, posY, `${pack}-${th}`)
              .setOrigin(0.5, 0).setDepth(baseDepth - 1000);
          }
          continue;
        }

        // ── Right half: WorldForge terrain (local coords) ─────────────
        const ltx = tx - 30;   // 0-29 within the WF sub-grid
        const lty = ty;        // 0-29
        const ld    = ltx + lty;
        const horiz = ltx - lty;
        const tileElev = wfGetElev(ltx, lty);

        // Curved boundary thresholds
        const effElevCut  = WF_ELEV_CUT + wfCurveDepth(horiz);
        const effOceanCut = WF_OCEAN_CUT + wfCurveDepth(horiz);
        const elevDist  = effElevCut - ld;
        const oceanDist = ld - effOceanCut;

        // All land tiles use meadow (same as homestead half)
        const landBiome = wfBiome;

        // River channel — 2 tiles wide
        const onRiver = Math.abs(ltx - wfRiverCenter(ld)) <= 1;

        // Splash pool at waterfall base
        const atWfBase = tileElev === 0 && (() => {
          for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
            const nx = ltx + dx, ny = lty + dy;
            if (nx < 0 || ny < 0 || nx >= WF_GRID_W || ny >= GRID_H) continue;
            if (wfGetElev(nx, ny) > 0 && Math.abs(nx - wfRiverCenter(nx + ny)) <= 1) return true;
          }
          return false;
        })();

        // Determine tile type (water vs land biome)
        let isWater = false;
        let customPack: string | undefined;
        const shoreBiome = WF_SHORE[landBiome] ?? 2;

        if (oceanDist > 1) {
          isWater = true;
        } else if (oceanDist > 0) {
          isWater = true;
        } else if (oceanDist === 0) {
          if (onRiver) { isWater = true; }
          else { customPack = CUSTOM_TILE_PACKS[shoreBiome]; }
        } else if (elevDist > 1) {
          if (onRiver || atWfBase) { isWater = true; }
          else { customPack = CUSTOM_TILE_PACKS[11]; }
        } else if (elevDist === 1) {
          if (onRiver || atWfBase) { isWater = true; }
          else { customPack = CUSTOM_TILE_PACKS[10]; }
        } else if (elevDist === 0 || elevDist === -1) {
          if (onRiver || atWfBase) { isWater = true; }
          else { customPack = CUSTOM_TILE_PACKS[landBiome]; }
        } else if (onRiver || atWfBase) {
          isWater = true;
        } else {
          customPack = CUSTOM_TILE_PACKS[landBiome];
        }

        // Cliff detection (neighbour drops)
        const southDrop = tileElev > 0 && lty + 1 < GRID_H ? tileElev - wfGetElev(ltx, lty + 1) : 0;
        const eastDrop  = tileElev > 0 && ltx + 1 < WF_GRID_W ? tileElev - wfGetElev(ltx + 1, lty) : 0;
        const westDrop  = tileElev > 0 && ltx > 0            ? tileElev - wfGetElev(ltx - 1, lty) : 0;
        const hasCliff  = southDrop > 0 || eastDrop > 0 || westDrop > 0;
        const isOnRiver = Math.abs(ltx - wfRiverCenter(ld)) <= 1;

        // Mark walkability — water, cliffs, and elevated terrain are impassable
        if (isWater || hasCliff || tileElev > 0) this.walkGrid[ty * GRID_W + tx] = 1;

        // Floor Y raised by elevation
        const posY = isoY - tileElev * CLIFF_H;
        const th = wfTileHash(ltx, lty);

        if (hasCliff) {
          const cliffBiome = elevDist > 1 ? 11 : elevDist === 1 ? 10
            : elevDist === 0 ? 9 : landBiome;
          const cliffKey = wfCliffKey(cliffBiome);
          const maxDrop = Math.max(southDrop, eastDrop, westDrop);
          const useWaterfall = southDrop > 0 && isOnRiver;
          const wallKey = useWaterfall ? `waterfall-${this.wfFrame}` : cliffKey;

          for (let step = maxDrop * 2; step >= 1; step--) {
            const key = useWaterfall && step === 1 ? `wf-top-${this.wfFrame}` : wallKey;
            const wallImg = this.add.image(isoX, posY + step * (CLIFF_H / 2), key)
              .setOrigin(0.5, 0).setDepth(baseDepth - 1000);
            if (useWaterfall) this.wfSprites.push(wallImg);
          }

          // Waterfall particles — foam at the top, splash at the bottom
          if (useWaterfall) {
            const hw = ISO_TILE_W / 2;  // 16
            const hh = ISO_TILE_H / 2;  //  8

            // Foam at cliff lip (top of waterfall)
            const foamY = posY + ISO_TILE_H * 0.5 + CLIFF_H / 2;
            const foamCfg = {
              speed: { min: 1, max: 3 },
              angle: { min: 85, max: 95 },
              accelerationY: 30,
              scale: { start: 0.6, end: 0.1 },
              alpha: { start: 0.7, end: 0 },
              lifespan: { min: 1500, max: 3000 },
              frequency: 100,
              quantity: 2,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-4, -2, 8, 4) } as any,
            };
            for (const { ex, ey } of [
              { ex: isoX - hw * 0.5, ey: foamY + hh * 0.5 },
              { ex: isoX,            ey: foamY + hh },
              { ex: isoX + hw * 0.5, ey: foamY + hh * 0.5 },
            ]) {
              this.add.particles(ex, ey, 'splash-dot', foamCfg).setDepth(baseDepth - 998);
            }

            // Splash at waterfall base (where water hits the pool)
            const splashY = posY + maxDrop * CLIFF_H + ISO_TILE_H * 0.5 + CLIFF_H / 2;
            const splashCfg = {
              speed: { min: 1, max: 3 },
              angle: { min: 260, max: 280 },
              scale: { start: 2.0, end: 0.8 },
              alpha: { start: 0.8, end: 0 },
              lifespan: { min: 800, max: 2000 },
              frequency: 100,
              quantity: 2,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-3, -2, 6, 4) } as any,
            };
            for (const { ex, ey } of [
              { ex: isoX - hw * 0.5, ey: splashY + hh * 0.5 },
              { ex: isoX,            ey: splashY + hh },
              { ex: isoX + hw * 0.5, ey: splashY + hh * 0.5 },
            ]) {
              this.add.particles(ex, ey, 'foam-dot', splashCfg).setDepth(baseDepth + 2);
            }
          }

          // Floor on top of cliff
          if (customPack) {
            this.add.image(isoX, posY, `${customPack}-${th}`)
              .setOrigin(0.5, 0).setDepth(baseDepth - 999);
          } else if (isWater) {
            this.add.image(isoX, posY, 'iso-tiles', 105)
              .setOrigin(0.5, 0).setDepth(baseDepth - 999);
          }
        } else {
          // Flat tile
          if (isWater) {
            this.add.image(isoX, posY, 'iso-tiles', 105)
              .setOrigin(0.5, 0).setDepth(baseDepth - 1000);
          } else if (customPack) {
            this.add.image(isoX, posY, `${customPack}-${th}`)
              .setOrigin(0.5, 0).setDepth(baseDepth - 1000);
          }
        }
      }
    }

    // ── Cliff base collision — block lowland tiles at the foot of cliffs ──
    // The elevated tiles are already blocked, but cliff wall sprites extend
    // down into adjacent lowland tiles. Mark any lowland tile that neighbours
    // a higher tile as blocked so the player can't walk through the cliff face.
    for (let ty = 0; ty < GRID_H; ty++) {
      for (let tx = 0; tx < GRID_W; tx++) {
        if (this.walkGrid[ty * GRID_W + tx] === 1) continue; // already blocked
        const e = getElev(tx, ty);
        // Check 4 neighbours — if any is higher, this tile is at a cliff base
        const nb: [number, number][] = [[0,-1],[0,1],[-1,0],[1,0]];
        for (const [dx, dy] of nb) {
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
          if (getElev(nx, ny) > e) {
            this.walkGrid[ty * GRID_W + tx] = 1;
            break;
          }
        }
      }
    }

    // ── Waterfall animation timer ─────────────────────────────────────────
    // Cycle waterfall frames every 167ms (6 FPS, same as WorldForge).
    this.time.addEvent({
      delay: 167,
      loop: true,
      callback: () => {
        this.wfFrame = (this.wfFrame + 1) % 30; // LCM of 5 and 6
        for (const s of this.wfSprites) {
          const isTop = s.texture.key.startsWith('wf-top-');
          s.setTexture(isTop
            ? `wf-top-${this.wfFrame % 6}`
            : `waterfall-${this.wfFrame % 5}`);
        }
      },
    });

    // ── Tree scatter (forest zone + sparse homestead trees) ──────────
    this.scatterTrees();

    // ── Placeholder textures ──────────────────────────────────────────────
    const textures: [string, number, number, number][] = [
      ['rn-tree',  24, 40, 0x3a7a28],
      ['rn-rock',  20, 16, 0x7a7265],
      ['rn-ore',   18, 20, 0xd4793a],
      ['rn-herb',  16, 16, 0x7ab33a],
      ['rn-berry', 18, 20, 0x8b3ab3],
      ['rn-water', 22, 14, 0x3a7ab3],
    ];
    for (const [key, w, h, colour] of textures) {
      if (!this.textures.exists(key)) {
        const rt = this.add.renderTexture(0, 0, w, h);
        rt.fill(colour, 1);
        rt.saveTexture(key);
        rt.destroy();
      }
    }

    // ── Player ────────────────────────────────────────────────────────────
    // Physics body lives in world space (invisible).
    // Animated sprite is in iso space, updated each frame.

    // Create animations from all loaded character spritesheets
    for (const c of CHARACTERS) {
      this.createAnimsFromAseprite(c.key);
    }

    // Spawn on lowland meadow (left half, below the mountain range)
    const spawnWx = 15 * TILE_SIZE;
    const spawnWy = 20 * TILE_SIZE;
    this.lastSafeX = spawnWx;
    this.lastSafeY = spawnWy;

    // Invisible physics body — a tiny placeholder texture for the physics sprite
    if (!this.textures.exists('hs-player-phys')) {
      const rt = this.add.renderTexture(0, 0, 14, 14);
      rt.fill(0x000000, 0);
      rt.saveTexture('hs-player-phys');
      rt.destroy();
    }
    this.player = this.physics.add.image(spawnWx, spawnWy, 'hs-player-phys');
    this.player.setCollideWorldBounds(true);
    this.player.setVisible(false);

    // Visible animated sprite in iso space
    const { x: spawnIsoX, y: spawnIsoY } = hsWorldToIso(spawnWx, spawnWy);
    this.playerIso = this.add.sprite(spawnIsoX, spawnIsoY, this.characterKey);
    this.playerIso.setOrigin(0.5, 1); // anchor at feet
    this.playerIso.setScale(0.45);    // ~34px wide — fits one iso tile
    this.playerIso.setDepth(hsIsoDepth(spawnWx, spawnWy));
    this.playerIso.play(`${this.characterKey}_idle_south`);

    // Invisible interact zone (world space)
    this.interactZone = this.add.arc(0, 0, INTERACT_RADIUS).setVisible(false);
    this.physics.add.existing(this.interactZone, false);
    const zoneBody = this.interactZone.body as Phaser.Physics.Arcade.Body;
    zoneBody.setCircle(INTERACT_RADIUS);
    zoneBody.setOffset(-INTERACT_RADIUS, -INTERACT_RADIUS);

    // ── Resource nodes ────────────────────────────────────────────────────
    // Positions are in world space; ResourceNode renders at world coords
    // but we reposition them to iso space after creation.
    const nodeDefs = this.cache.json.get('resource-nodes') as { nodeTypes: ResourceNodeTypeDef[] } | undefined;
    if (nodeDefs?.nodeTypes) {
      // Placements in world-space tile coords (tx, ty) → world pixels
      // Placements shifted by HS_OFFSET so they sit in the centre homestead zone.
      const placements: { defId: string; tx: number; ty: number }[] = [
        { defId: 'tree',  tx: 4  + HS_OFFSET, ty: 5  + HS_OFFSET },
        { defId: 'tree',  tx: 6  + HS_OFFSET, ty: 7  + HS_OFFSET },
        { defId: 'tree',  tx: 3  + HS_OFFSET, ty: 9  + HS_OFFSET },
        { defId: 'tree',  tx: 5  + HS_OFFSET, ty: 12 + HS_OFFSET },
        { defId: 'rock',  tx: 14 + HS_OFFSET, ty: 4  + HS_OFFSET },
        { defId: 'rock',  tx: 16 + HS_OFFSET, ty: 5  + HS_OFFSET },
        { defId: 'ore',   tx: 15 + HS_OFFSET, ty: 14 + HS_OFFSET },
        { defId: 'ore',   tx: 17 + HS_OFFSET, ty: 16 + HS_OFFSET },
        { defId: 'herb',  tx: 9  + HS_OFFSET, ty: 3  + HS_OFFSET },
        { defId: 'herb',  tx: 12 + HS_OFFSET, ty: 12 + HS_OFFSET },
        { defId: 'berry', tx: 10 + HS_OFFSET, ty: 15 + HS_OFFSET },
        { defId: 'berry', tx: 6  + HS_OFFSET, ty: 14 + HS_OFFSET },
        { defId: 'water', tx: 12 + HS_OFFSET, ty: 17 + HS_OFFSET },
      ];

      const nodeGroup = this.physics.add.staticGroup();

      for (const p of placements) {
        const def = nodeDefs.nodeTypes.find(d => d.id === p.defId);
        if (!def) continue;
        const wx = p.tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = p.ty * TILE_SIZE + TILE_SIZE / 2;
        const { x: isoX, y: isoY } = hsWorldToIso(wx, wy);
        const node = new ResourceNode(this, isoX, isoY, def, inv);
        node.setDepth(hsIsoDepth(wx, wy));
        // Store world coords for depth sorting and proximity checks
        node.setData('worldX', wx);
        node.setData('worldY', wy);
        nodeGroup.add(node);
        this.resourceNodes.push(node);
      }
      nodeGroup.refresh();

      this.physics.add.collider(this.player, nodeGroup);
      this.physics.add.overlap(this.interactZone, nodeGroup, (_zone, obj) => {
        this.nodesInRange.add(obj as ResourceNode);
      });
    }

    // ── Tap-to-target ────────────────────────────────────────────────────
    this.events.on('resource-node:targeted', (node: ResourceNode) => {
      if (this.targetNode && this.targetNode !== node) {
        this.targetNode.setTargeted(false);
      }
      this.targetNode = node;
      node.setTargeted(true);
    });

    // ── Input ─────────────────────────────────────────────────────────────
    const kb = this.input.keyboard!;
    this.wasd = {
      up:    kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    kb.on('keydown-C', () => {
      if (!this.scene.isActive(HomesteadScene.KEY)) return; // paused — ignore
      if (this.scene.isActive('CraftingMenuScene')) {
        this.scene.stop('CraftingMenuScene');
      } else {
        this.scene.launch('CraftingMenuScene');
      }
    });

    // ── Camera ────────────────────────────────────────────────────────────
    // Main camera: 3× zoom, follows the player through the iso world.
    const cam = this.cameras.main;
    cam.setZoom(3);
    cam.setBounds(
      -cam.width / (2 * 3),
      -cam.height / (2 * 3),
      ISO_W + cam.width / 3,
      ISO_H + cam.height / 3,
    );
    cam.startFollow(this.playerIso, true, 0.08, 0.08);

    // ── Wolf wildlife preview ─────────────────────────────────────────────
    this.spawnWolf();

    // UI camera: 1× zoom, no scroll — renders HUD elements at native size.
    const uiCam = this.cameras.add(0, 0, cam.width, cam.height);
    uiCam.setScroll(0, 0);

    // Helper: mark game objects as UI-only (visible on uiCam, hidden on main).
    const addUi = (...objs: Phaser.GameObjects.GameObject[]) => {
      for (const obj of objs) {
        cam.ignore(obj);
        this.uiLayer.push(obj);
      }
    };

    // ── Virtual joystick (mobile) ───────────────────────────────────────
    const joyRadius = 40;
    const joyX = 60;
    const joyY = cam.height - 60;

    const joyBase = this.add.arc(joyX, joyY, joyRadius, 0, 360, false, 0x000000, 0.25)
      .setStrokeStyle(2, 0xffffff, 0.3).setDepth(250);
    const thumb = this.add.arc(joyX, joyY, 14, 0, 360, false, 0xffffff, 0.5).setDepth(251);
    addUi(joyBase, thumb);

    this.joystick = new SimpleJoystick(this, joyX, joyY, joyRadius, thumb);

    // ── Action button (mobile) ──────────────────────────────────────────
    const btnX = cam.width - 60;
    const btnY = cam.height - 60;

    this.actionBtn = this.add.arc(btnX, btnY, 28, 0, 360, false, 0x44aa44, 0.3)
      .setStrokeStyle(2, 0x44aa44, 0.6).setDepth(250).setInteractive();
    this.actionLabel = this.add.text(btnX, btnY, 'E', {
      fontSize: '18px', color: '#88cc88', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(251);
    addUi(this.actionBtn, this.actionLabel);

    this.actionBtn.on('pointerdown', () => { this.actionTapped = true; });

    // ── Craft button ────────────────────────────────────────────────────
    const craftBtnY = btnY - 70;
    const craftBtn = this.add.arc(btnX, craftBtnY, 22, 0, 360, false, 0x4466aa, 0.3)
      .setStrokeStyle(2, 0x4466aa, 0.6).setDepth(250).setInteractive();
    const craftLabel = this.add.text(btnX, craftBtnY, 'C', {
      fontSize: '14px', color: '#88aacc', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(251);
    addUi(craftBtn, craftLabel);

    craftBtn.on('pointerdown', () => {
      if (this.scene.isActive('CraftingMenuScene')) {
        this.scene.stop('CraftingMenuScene');
      } else {
        this.scene.launch('CraftingMenuScene');
      }
    });

    // ── HUD ───────────────────────────────────────────────────────────────
    const invHud = new InventoryHUD(this, inv);
    const auth = new HomesteadAuth(this);
    addUi(...invHud.getUIObjects(), ...auth.getUIObjects());

    const modeLabel = this.add.text(8, 8, 'Homestead Mode', {
      fontSize: '11px', color: '#aaccaa', backgroundColor: '#00000066',
      padding: { x: 6, y: 4 },
    }).setDepth(200);
    addUi(modeLabel);

    // ── Pause button (top-right) ───────────────────────────────────────
    const pauseBtn = this.add.text(cam.width - 16, 12, '\u23f8', {
      fontSize: '16px', color: '#7a9a7a', backgroundColor: '#00000044',
      padding: { x: 6, y: 3 },
    }).setOrigin(1, 0).setDepth(200).setInteractive({ useHandCursor: true });
    pauseBtn.on('pointerover', () => pauseBtn.setStyle({ color: '#f0ead6' }));
    pauseBtn.on('pointerout',  () => pauseBtn.setStyle({ color: '#7a9a7a' }));
    pauseBtn.on('pointerdown', () => this.openPauseMenu());
    addUi(pauseBtn);

    // ── Cardinal direction labels (just outside the diamond edges) ──────
    const dirStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '10px', color: '#88aa88', fontFamily: 'monospace',
    };
    const cx = ISO_W / 2;   // centre of diamond in iso space
    const cy = ISO_H / 2;
    const pad = 14;          // px outside the diamond edge
    // N = top apex, S = bottom apex, W = left apex, E = right apex
    this.add.text(cx, -pad, 'N', dirStyle).setOrigin(0.5, 1);
    this.add.text(cx, ISO_H + pad, 'S', dirStyle).setOrigin(0.5, 0);
    this.add.text(-pad, cy, 'W', dirStyle).setOrigin(1, 0.5);
    this.add.text(ISO_W + pad, cy, 'E', dirStyle).setOrigin(0, 0.5);

    // ── Building toolbar + placement ─────────────────────────────────────
    this.createBuildToolbar();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.selectedBuilding) return;
      if (pointer.rightButtonDown()) { this.cancelPlacement(); return; }
      if (pointer.y > cam.height - 70) return;
      const worldPt = cam.getWorldPoint(pointer.x, pointer.y);
      const tile = this.isoToTile(worldPt.x, worldPt.y);
      if (!tile) { this.cancelPlacement(); return; }
      this.placeBuilding(this.selectedBuilding, tile.tx, tile.ty);
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.selectedBuilding) return;
      if (pointer.y > cam.height - 70) { this.clearGhost(); return; }
      const worldPt = cam.getWorldPoint(pointer.x, pointer.y);
      const tile = this.isoToTile(worldPt.x, worldPt.y);
      if (!tile) { this.clearGhost(); return; }
      if (tile.tx === this.lastHoverTx && tile.ty === this.lastHoverTy) return;
      this.lastHoverTx = tile.tx;
      this.lastHoverTy = tile.ty;
      this.drawPlacementPreview(this.selectedBuilding, tile.tx, tile.ty);
    });

    kb.on('keydown-ESC', () => {
      if (!this.scene.isActive(HomesteadScene.KEY)) return; // paused — ignore
      if (this.selectedBuilding) { this.cancelPlacement(); return; }
      if (this.scene.isActive('CraftingMenuScene')) { this.scene.stop('CraftingMenuScene'); return; }
      this.openPauseMenu();
    });
    kb.on('keydown-P', () => {
      if (!this.scene.isActive(HomesteadScene.KEY)) return; // paused — ignore
      if (!this.selectedBuilding) this.openPauseMenu();
    });

    // Tell the UI camera to ignore all non-UI game objects
    const uiSet = new Set(this.uiLayer);
    for (const child of this.children.list) {
      if (!uiSet.has(child)) uiCam.ignore(child);
    }
  }

  update(): void {
    this.updateWolf(this.game.loop.delta);
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // ── Input → world-space velocity ─────────────────────────────────────
    // Screen-space input is converted to world-space so "up" moves northwest.
    let svx = (this.wasd.right.isDown ? 1 : 0) - (this.wasd.left.isDown ? 1 : 0);
    let svy = (this.wasd.down.isDown ? 1 : 0) - (this.wasd.up.isDown ? 1 : 0);

    if (this.joystick && this.joystick.force > 4) {
      svx = Math.cos(this.joystick.rotation);
      svy = Math.sin(this.joystick.rotation);
    }

    // Convert screen-space direction to world-space direction
    let { wx: vx, wy: vy } = isoInputToWorld(svx, svy);

    if ((svx !== 0 || svy !== 0) && this.targetNode) {
      this.targetNode.setTargeted(false);
      this.targetNode = null;
    }

    // Auto-walk toward targeted node (in world space)
    if (this.targetNode && svx === 0 && svy === 0) {
      const twx = this.targetNode.getData('worldX') as number;
      const twy = this.targetNode.getData('worldY') as number;
      const dx = twx - this.player.x;
      const dy = twy - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 10) {
        vx = dx / dist;
        vy = dy / dist;
      } else {
        this.targetNode = null;
      }
    }

    // Normalize and apply speed
    const mag = Math.sqrt(vx * vx + vy * vy);
    if (mag > 0) {
      body.setVelocity((vx / mag) * PLAYER_SPEED, (vy / mag) * PLAYER_SPEED);
    } else {
      body.setVelocity(0, 0);
    }

    // Clamp to world bounds
    const margin = TILE_SIZE * 0.5;
    this.player.x = Phaser.Math.Clamp(this.player.x, margin, WORLD_W - margin);
    this.player.y = Phaser.Math.Clamp(this.player.y, margin, WORLD_H - margin);

    // ── Tile collision — check a small body radius against the walk grid ──
    const BODY_R = 6; // collision check radius in pixels
    const isBlocked = (wx: number, wy: number) => {
      // Check 4 corners of the body box
      for (const [ox, oy] of [[-BODY_R,-BODY_R],[BODY_R,-BODY_R],[-BODY_R,BODY_R],[BODY_R,BODY_R]]) {
        const ttx = Math.floor((wx + ox) / TILE_SIZE);
        const tty = Math.floor((wy + oy) / TILE_SIZE);
        if (ttx < 0 || tty < 0 || ttx >= GRID_W || tty >= GRID_H) return true;
        if (this.walkGrid[tty * GRID_W + ttx] === 1) return true;
      }
      return false;
    };

    if (isBlocked(this.player.x, this.player.y)) {
      // Try sliding: keep new X, revert Y
      if (!isBlocked(this.player.x, this.lastSafeY)) {
        this.player.y = this.lastSafeY;
      // Try sliding: keep new Y, revert X
      } else if (!isBlocked(this.lastSafeX, this.player.y)) {
        this.player.x = this.lastSafeX;
      } else {
        // Fully blocked — revert both
        this.player.x = this.lastSafeX;
        this.player.y = this.lastSafeY;
      }
      body.setVelocity(0, 0);
    }

    // Store last safe position
    this.lastSafeX = this.player.x;
    this.lastSafeY = this.player.y;

    // ── Sync iso sprite to physics body + animate ──────────────────────
    const { x: isoX, y: isoY } = hsWorldToIso(this.player.x, this.player.y);
    this.playerIso.setPosition(isoX, isoY);
    this.playerIso.setDepth(hsIsoDepth(this.player.x, this.player.y));

    // Update facing direction and animation.
    // Use screen-space input (svx, svy) for animation direction, not
    // world-space velocity — the animation directions (south, south-east, etc.)
    // correspond to screen directions, not iso world axes.
    const facing = velocityToFacing(svx, svy);
    if (facing) {
      this.facingDir = facing.dir;
      this.playerIso.setFlipX(facing.flip);
      const walkKey = `${this.characterKey}_walk_${facing.dir}`;
      if (this.playerIso.anims.getName() !== walkKey) {
        this.playerIso.play(walkKey, true);
      }
    } else {
      // Standing still — play idle in current facing direction
      const idleKey = `${this.characterKey}_idle_${this.facingDir}`;
      if (this.playerIso.anims.getName() !== idleKey) {
        this.playerIso.play(idleKey, true);
      }
    }

    // Move interact zone to player (world space)
    this.interactZone.setPosition(this.player.x, this.player.y);
    (this.interactZone.body as Phaser.Physics.Arcade.Body)
      .reset(this.player.x, this.player.y);

    // ── Node proximity ────────────────────────────────────────────────────
    const currentInRange = new Set(this.nodesInRange);
    this.nodesInRange.clear();

    let anyInRange = false;
    for (const node of this.resourceNodes) {
      const inRange = currentInRange.has(node);
      node.setPlayerInRange(inRange);
      if (inRange) {
        anyInRange = true;
        node.checkInput();
        if (this.actionTapped && node.nodeState === 'ready') {
          node.gatherFromTouch();
          this.actionTapped = false;
        }
      }
    }

    this.actionTapped = false;

    if (this.actionBtn) {
      this.actionBtn.setFillStyle(anyInRange ? 0x44aa44 : 0x444444, anyInRange ? 0.5 : 0.2);
      this.actionBtn.setStrokeStyle(2, anyInRange ? 0x44aa44 : 0x444444, anyInRange ? 0.8 : 0.3);
    }
    if (this.actionLabel) {
      this.actionLabel.setColor(anyInRange ? '#88ff88' : '#666666');
    }
  }

  // ── Building toolbar ────────────────────────────────────────────────────

  private createBuildToolbar(): void {
    const cam = this.cameras.main;
    const btnSize = 40;
    const gap = 6;
    const totalW = BUILDINGS.length * (btnSize + gap) - gap;
    const startX = (cam.width - totalW) / 2;
    const y = cam.height - 36;

    for (let i = 0; i < BUILDINGS.length; i++) {
      const b = BUILDINGS[i];
      const x = startX + i * (btnSize + gap) + btnSize / 2;
      const container = this.add.container(x, y).setScrollFactor(0).setDepth(260);
      const bg = this.add.rectangle(0, 0, btnSize, btnSize, 0x1a2a1a, 0.85)
        .setStrokeStyle(1, 0x3a5a3a, 0.8);
      container.add(bg);
      const icon = this.add.image(0, -2, b.spriteKey);
      const scale = Math.min((btnSize - 8) / icon.width, (btnSize - 8) / icon.height);
      icon.setScale(scale);
      container.add(icon);
      const label = this.add.text(0, btnSize / 2 + 4, b.label, {
        fontSize: '7px', color: '#88aa88', fontFamily: 'monospace',
      }).setOrigin(0.5, 0);
      container.add(label);
      container.setSize(btnSize, btnSize);
      container.setInteractive({ useHandCursor: true });
      container.on('pointerdown', () => this.selectBuilding(i));
      this.toolbarBtns.push(container);
      // Render on UI camera only
      this.cameras.main.ignore(container);
      this.uiLayer.push(container);
    }
  }

  private selectBuilding(index: number): void {
    if (this.selectedBuilding === BUILDINGS[index]) {
      this.cancelPlacement();
      return;
    }
    this.selectedBuilding = BUILDINGS[index];
    this.highlightToolbar(index);
    this.showCancelBtn();
  }

  private highlightToolbar(activeIdx: number): void {
    for (let i = 0; i < this.toolbarBtns.length; i++) {
      const bg = this.toolbarBtns[i].getAt(0) as Phaser.GameObjects.Rectangle;
      bg.setStrokeStyle(i === activeIdx ? 2 : 1, i === activeIdx ? 0xddaa44 : 0x3a5a3a, i === activeIdx ? 1 : 0.8);
    }
  }

  private openPauseMenu(): void {
    this.scene.pause();
    this.scene.launch('PauseMenuScene');
  }

  private cancelPlacement(): void {
    this.selectedBuilding = null;
    this.clearGhost();
    this.highlightToolbar(-1);
    this.hideCancelBtn();
  }

  private showCancelBtn(): void {
    if (this.cancelBtn) return;
    const cam = this.cameras.main;
    const x = cam.width / 2;
    const y = cam.height - 72;
    const container = this.add.container(x, y).setDepth(270);
    const bg = this.add.rectangle(0, 0, 60, 22, 0x4a2a2a, 0.9)
      .setStrokeStyle(1, 0x884444, 0.8);
    const label = this.add.text(0, 0, '✕ Cancel', {
      fontSize: '9px', color: '#cc8888', fontFamily: 'monospace',
    }).setOrigin(0.5);
    container.add([bg, label]);
    container.setSize(60, 22);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => this.cancelPlacement());
    cam.ignore(container);
    this.cancelBtn = container;
  }

  private hideCancelBtn(): void {
    if (this.cancelBtn) {
      this.cancelBtn.destroy();
      this.cancelBtn = null;
    }
  }

  private clearGhost(): void {
    if (this.ghostSprite) { this.ghostSprite.destroy(); this.ghostSprite = null; }
    if (this.footprintGfx) { this.footprintGfx.destroy(); this.footprintGfx = null; }
    this.lastHoverTx = -1;
    this.lastHoverTy = -1;
  }

  // ── Iso ↔ tile conversion ──────────────────────────────────────────────

  private isoToTile(isoX: number, isoY: number): { tx: number; ty: number } | null {
    const relX = isoX - ISO_ORIGIN_X;
    const relY = isoY;
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;
    const tx = Math.floor(((relX / hw) + (relY / hh)) / 2);
    const ty = Math.floor(((relY / hh) - (relX / hw)) / 2);
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return null;
    return { tx, ty };
  }

  // ── Placement logic ────────────────────────────────────────────────────

  private canPlace(def: BuildingDef, tx: number, ty: number): boolean {
    if (tx + def.footW > GRID_W || ty + def.footD > GRID_H) return false;
    for (let dx = 0; dx < def.footW; dx++) {
      for (let dy = 0; dy < def.footD; dy++) {
        if (this.occupied[(ty + dy) * GRID_W + (tx + dx)]) return false;
      }
    }
    return true;
  }

  private placeBuilding(def: BuildingDef, tx: number, ty: number): void {
    if (!this.canPlace(def, tx, ty)) return;

    for (let dx = 0; dx < def.footW; dx++) {
      for (let dy = 0; dy < def.footD; dy++) {
        this.occupied[(ty + dy) * GRID_W + (tx + dx)] = 1;
      }
    }

    const centreWx = (tx + def.footW / 2) * TILE_SIZE;
    const centreWy = (ty + def.footD / 2) * TILE_SIZE;
    const { x: isoX, y: isoY } = hsWorldToIso(centreWx, centreWy);

    const sprite = this.add.image(isoX, isoY, def.spriteKey);
    sprite.setOrigin(0.5, 0.75);
    sprite.setDepth(hsIsoDepth(centreWx, centreWy));
    this.placedBuildings.push(sprite);
    this.cancelPlacement();
  }

  // ── Placement preview ──────────────────────────────────────────────────

  private drawPlacementPreview(def: BuildingDef, tx: number, ty: number): void {
    if (this.footprintGfx) this.footprintGfx.destroy();
    if (this.ghostSprite) this.ghostSprite.destroy();

    const outOfBounds = tx + def.footW > GRID_W || ty + def.footD > GRID_H;
    let blocked = outOfBounds;
    if (!outOfBounds) blocked = !this.canPlace(def, tx, ty);

    const color = blocked ? 0xff4444 : 0x44dd44;
    const gfx = this.add.graphics().setDepth(9000);

    if (!outOfBounds) {
      for (let dx = 0; dx < def.footW; dx++) {
        for (let dy = 0; dy < def.footD; dy++) {
          const wx = (tx + dx) * TILE_SIZE;
          const wy = (ty + dy) * TILE_SIZE;
          const { x: ix, y: iy } = hsWorldToIso(wx, wy);
          const hw = ISO_TILE_W / 2;
          const hh = ISO_TILE_H / 2;
          gfx.lineStyle(1.5, color, 0.7);
          gfx.fillStyle(color, 0.12);
          gfx.beginPath();
          gfx.moveTo(ix, iy);
          gfx.lineTo(ix + hw, iy + hh);
          gfx.lineTo(ix, iy + ISO_TILE_H);
          gfx.lineTo(ix - hw, iy + hh);
          gfx.closePath();
          gfx.fillPath();
          gfx.strokePath();
        }
      }
    }
    this.footprintGfx = gfx;

    if (!outOfBounds) {
      const centreWx = (tx + def.footW / 2) * TILE_SIZE;
      const centreWy = (ty + def.footD / 2) * TILE_SIZE;
      const { x: isoX, y: isoY } = hsWorldToIso(centreWx, centreWy);
      this.ghostSprite = this.add.image(isoX, isoY, def.spriteKey);
      this.ghostSprite.setOrigin(0.5, 0.75);
      this.ghostSprite.setAlpha(blocked ? 0.3 : 0.5);
      this.ghostSprite.setDepth(9001);
      if (blocked) this.ghostSprite.setTint(0xff6666);
    } else {
      this.ghostSprite = null;
    }
  }

  // ── Tree scatter ──────────────────────────────────────────────────────
  // Populates the forest zone with dense tree coverage and sprinkles a few
  // trees in the homestead zone.  Deterministic: seeded hash per tile.

  private scatterTrees(): void {
    // Species pool: key prefix + mature count.  Forest zone heavily favours
    // conifers (pine, spruce) with deciduous (oak, birch, elm) mixed in.
    const species: { prefix: string; matureN: number; youngN: number; saplingN: number; weight: number }[] = [
      { prefix: 'tree-pine',   matureN: 3,  youngN: 2, saplingN: 3, weight: 30 },
      { prefix: 'tree-spruce', matureN: 3,  youngN: 3, saplingN: 3, weight: 30 },
      { prefix: 'tree-oak',    matureN: 14, youngN: 5, saplingN: 6, weight: 15 },
      { prefix: 'tree-birch',  matureN: 4,  youngN: 4, saplingN: 4, weight: 15 },
      { prefix: 'tree-elm',    matureN: 4,  youngN: 3, saplingN: 4, weight: 10 },
    ];
    const totalWeight = species.reduce((s, sp) => s + sp.weight, 0);

    // Simple deterministic hash for per-tile decisions.
    const hash = (a: number, b: number, salt: number) =>
      (((a * 2654435761 + b * 2246822519 + salt) >>> 0) & 0x7fffffff);

    // Mark tiles that already have resource nodes so trees don't overlap.
    const nodeSet = new Set<string>();
    for (const n of this.resourceNodes) {
      const nwx = n.getData('worldX') as number;
      const nwy = n.getData('worldY') as number;
      nodeSet.add(`${Math.floor(nwx / TILE_SIZE)},${Math.floor(nwy / TILE_SIZE)}`);
    }

    for (let tx = 1; tx < GRID_W - 1; tx++) {
      for (let ty = 1; ty < GRID_H - 1; ty++) {
        const zone = getZone(tx, ty);

        // Only place trees on homestead half; skip rock/snow tile types
        if (zone === 'wf') continue;
        if (this.walkGrid[ty * GRID_W + tx] === 1) continue;

        // Skip tiles occupied by resource nodes
        if (nodeSet.has(`${tx},${ty}`)) continue;

        // Cluster noise — two overlapping waves create natural clumps
        const n1 = Math.sin(tx * 0.35 + ty * 0.25) * Math.cos(ty * 0.4 - tx * 0.15);
        const n2 = Math.sin(tx * 0.18 - ty * 0.32) * Math.cos(tx * 0.28 + ty * 0.12);
        const cluster = (n1 + n2 + 2) / 4; // normalise to 0-1

        // Sparse scatter on homestead half
        const threshold = 0.65;
        if (cluster < threshold) continue;

        const spawnChance = (cluster - threshold) / (1 - threshold);
        const roll = (hash(tx, ty, 0xBEEF) % 1000) / 1000;
        if (roll > spawnChance) continue;

        {
          // Pick species by weighted random
          const specRoll = hash(tx, ty, 0xCAFE) % totalWeight;
          let acc = 0;
          let sp = species[0];
          for (const s of species) {
            acc += s.weight;
            if (specRoll < acc) { sp = s; break; }
          }

          // 40% mature, 35% young, 25% sapling
          const stageRoll = hash(tx, ty, 0xFACE) % 100;
          let textureKey: string;
          if (stageRoll < 40) {
            textureKey = `${sp.prefix}-${hash(tx, ty, 0xAA) % sp.matureN}`;
          } else if (stageRoll < 75) {
            textureKey = `${sp.prefix}-young-${hash(tx, ty, 0xBB) % sp.youngN}`;
          } else {
            textureKey = `${sp.prefix}-sapling-${hash(tx, ty, 0xCC) % sp.saplingN}`;
          }

          // Position with jitter so trees don't sit on a rigid grid
          const jx = ((hash(tx, ty, 0x111) % 20) - 10) * 0.6;
          const jy = ((hash(tx, ty, 0x222) % 20) - 10) * 0.6;
          const wx = tx * TILE_SIZE + TILE_SIZE / 2 + jx;
          const wy = ty * TILE_SIZE + TILE_SIZE / 2 + jy;
          const { x: isoX, y: isoY } = hsWorldToIso(wx, wy);

          const tree = this.add.image(isoX, isoY, textureKey);
          tree.setOrigin(0.5, 1);
          tree.setDepth(hsIsoDepth(wx, wy));

          const isMature = !textureKey.includes('young') && !textureKey.includes('sapling');
          const isSapling = textureKey.includes('sapling');
          const baseScale = isMature ? 0.55 : isSapling ? 0.3 : 0.4;
          const scaleJitter = 1 + ((hash(tx, ty, 0x333) % 20) - 10) * 0.01;
          tree.setScale(baseScale * scaleJitter);
        }
      }
    }
  }

  // ── Aseprite animation helper ──────────────────────────────────────────
  // Same approach as DungeonForgeScene: reads frame tags from the cached
  // Aseprite JSON and creates Phaser animations with filename-based frame keys.

  private createAnimsFromAseprite(key: string): void {
    type AseFrame = { filename: string; duration?: number };
    type AseTag   = { name: string; from: number; to: number; direction: string };
    const data = this.cache.json.get(key) as {
      frames: AseFrame[];
      meta:   { frameTags: AseTag[] };
    } | null;

    if (!data?.frames || !data.meta?.frameTags) return;

    for (const tag of data.meta.frameTags) {
      if (this.anims.exists(tag.name)) continue;
      const animFrames: { key: string; frame: string; duration: number }[] = [];
      for (let i = tag.from; i <= tag.to; i++) {
        const f = data.frames[i];
        if (!f) continue;
        animFrames.push({ key, frame: f.filename, duration: f.duration ?? 100 });
      }
      if (tag.direction === 'reverse') animFrames.reverse();
      const isLoop = tag.name.includes('idle') || tag.name.includes('walk');
      this.anims.create({ key: tag.name, frames: animFrames, repeat: isLoop ? -1 : 0 });
    }
  }

  // ── Wolf wildlife ──────────────────────────────────────────────────────────

  private spawnWolf(): void {
    // Register wolf directional animations.
    const DIRS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
    const WOLF_ANIMS: Array<[string, number[], number]> = [
      ['idle', [0,1,2,3,4,5,6,7], 6],
      ['walk', [0,1,2,3,4,5],     8],
      ['run',  [0,1,2,3,4,5],     12],
    ];
    for (const [anim, frames, rate] of WOLF_ANIMS) {
      for (const d of DIRS) {
        const texKey = `wolf-${anim}-${d}`;
        const animKey = `hs-wolf-${anim}-${d}`;
        if (this.textures.exists(texKey) && !this.anims.exists(animKey)) {
          this.anims.create({
            key: animKey,
            frames: this.anims.generateFrameNumbers(texKey, { frames }),
            frameRate: rate,
            repeat: -1,
          });
        }
      }
    }

    // Spawn in world space — somewhere in the forest zone (east side).
    // Spawn wolf on lowland meadow
    this.wolfWx = 18 * TILE_SIZE;
    this.wolfWy = 22 * TILE_SIZE;
    const { x: isoX, y: isoY } = hsWorldToIso(this.wolfWx, this.wolfWy);
    this.wolfSprite = this.add.sprite(isoX, isoY, 'wolf-idle-se', 0)
      .setScale(0.55)
      .setOrigin(0.5, 0.8)
      .setDepth(hsIsoDepth(this.wolfWx, this.wolfWy));
    this.wolfSprite.play('hs-wolf-idle-se');
    this.wolfTimer = 0;
  }

  private updateWolf(delta: number): void {
    if (!this.wolfSprite) return;

    this.wolfTimer -= delta;
    if (this.wolfTimer <= 0) {
      const roll = Math.random();
      if (roll < 0.25) {
        // Idle
        this.wolfVx = 0;
        this.wolfVy = 0;
        this.wolfTimer = Phaser.Math.Between(800, 2000);
        const idleKey = `hs-wolf-idle-${this.wolfDir}`;
        if (this.anims.exists(idleKey)) this.wolfSprite.play(idleKey, true);
      } else {
        // Walk or run
        const running = roll > 0.85;
        const speed = running ? 60 : 30;
        const angle = Math.random() * Math.PI * 2;
        this.wolfVx = Math.cos(angle) * speed;
        this.wolfVy = Math.sin(angle) * speed;
        this.wolfTimer = Phaser.Math.Between(1500, 4000);

        // Compute direction from world-space velocity
        const wAngle = Math.atan2(this.wolfVy, this.wolfVx);
        const sector = Math.round(wAngle / (Math.PI / 4));
        const DIR_MAP: Record<number, string> = {
          0: 'e', 1: 'se', 2: 's', 3: 'sw', 4: 'w', '-4': 'w', '-3': 'nw', '-2': 'n', '-1': 'ne',
        };
        this.wolfDir = DIR_MAP[sector] ?? 'se';
        const animBase = running ? 'run' : 'walk';
        const animKey = `hs-wolf-${animBase}-${this.wolfDir}`;
        if (this.anims.exists(animKey)) {
          this.wolfSprite.play(animKey, true);
          this.wolfSprite.setFlipX(false);
        }
      }
    }

    // Move in world space
    const dt = delta / 1000;
    const nextWx = this.wolfWx + this.wolfVx * dt;
    const nextWy = this.wolfWy + this.wolfVy * dt;

    // Check walkability before committing the move
    const wtx = Math.floor(nextWx / TILE_SIZE);
    const wty = Math.floor(nextWy / TILE_SIZE);
    if (wtx >= 0 && wty >= 0 && wtx < GRID_W && wty < GRID_H &&
        this.walkGrid[wty * GRID_W + wtx] === 1) {
      // Blocked — reverse direction to bounce away
      this.wolfVx = -this.wolfVx;
      this.wolfVy = -this.wolfVy;
      this.wolfTimer = 0; // pick a new direction next frame
    } else {
      this.wolfWx = nextWx;
      this.wolfWy = nextWy;
    }

    // Soft boundary — keep within map
    const MARGIN = 40;
    const mapW = GRID_W * TILE_SIZE;
    const mapH = GRID_H * TILE_SIZE;
    if (this.wolfWx < MARGIN)     { this.wolfVx =  Math.abs(this.wolfVx); this.wolfWx = MARGIN; }
    if (this.wolfWx > mapW - MARGIN) { this.wolfVx = -Math.abs(this.wolfVx); this.wolfWx = mapW - MARGIN; }
    if (this.wolfWy < MARGIN)     { this.wolfVy =  Math.abs(this.wolfVy); this.wolfWy = MARGIN; }
    if (this.wolfWy > mapH - MARGIN) { this.wolfVy = -Math.abs(this.wolfVy); this.wolfWy = mapH - MARGIN; }

    // Project to iso
    const { x: isoX, y: isoY } = hsWorldToIso(this.wolfWx, this.wolfWy);
    this.wolfSprite.setPosition(isoX, isoY);
    this.wolfSprite.setDepth(hsIsoDepth(this.wolfWx, this.wolfWy));
  }
}
