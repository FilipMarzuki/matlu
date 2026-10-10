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
import { playerItems, REGISTRY_ITEMS } from '../lib/items';
import { InventoryHUD } from '../ui/InventoryHUD';
import { ResourceNode, type ResourceNodeTypeDef } from '../entities/ResourceNode';
import { SimpleJoystick } from '../lib/SimpleJoystick';
import { HomesteadAuth } from '../lib/HomesteadAuth';
import { preloadTilePacks, CUSTOM_TILE_PACKS } from '../world/TilePacks';
import { cliffKeyForBiome } from '../world/biomes';
import { aStarWeighted } from '../ai/AStarGrid';
import { WildlifeSystem, type WildlifeEnvContext } from '../systems/WildlifeSystem';
import type { FaunaRegistryData } from '../world/FaunaRegistry';
import { parseLdtkLevel, entitiesOfType, intGridGet, type LdtkLevel, type IntGridLayer } from '../world/MapData';
import { bufferShoreline, blockTreeFootprint, roadOverlayVisible, blockDenseForestZones, type TreeSize } from '../world/CollisionGrid';
import { isCliffBlocked, buildRampSet, buildRampMap, effectiveElevation, type RampDef } from '../world/ElevationWalk';

// ── Grid ──────────────────────────────────────────────────────────────────
// The 60×60 grid (meadow left half, WorldForge terrain right half, mountain
// range along the NE border) is authored once in public/assets/maps/homestead.json
// (#1173) — this scene only reads it. Dimensions come from the loaded level.

const TILE_SIZE = 32;
const PLAYER_SPEED = 120;
const INTERACT_RADIUS = 50;
const DEFAULT_MAP_ID = 'homestead';

// ── Dense forest zones (#935) ────────────────────────────────────────────
// Candidate cutoff on the 0-1 cluster-noise value used by scatterTrees() —
// only the thickest canopy patches become impassable. Tuned so roughly half
// of the pure-forest tiles qualify, leaving the rest as natural clearings.
const DENSE_CANOPY_CLUSTER_MIN = 0.5;
// Minimum connected-tile count before a canopy patch is blocked. Filters out
// single-tile/sliver noise so only genuine clusters funnel the player.
const MIN_FOREST_ZONE_SIZE = 12;

// ── Iso projection ────────────────────────────────────────────────────────
// 2:1 diamond. ISO_ORIGIN_X/ISO_W/ISO_H depend on grid size, so they're
// computed once the level is loaded (see this.isoOriginX/isoW/isoH).

const ISO_TILE_W = 32;
const ISO_TILE_H = 16;

// ── Cliff / elevation ─────────────────────────────────────────────────────
const CLIFF_H = 32;  // one elevation step = one 32×32 cliff block

// One ramp connecting the lowland meadow to the mid highland strip (#936).
// (21,10) is the highland tile with the cliff edge (elev 1, drops south);
// its south neighbour (21,11) is lowland (elev 0) but blocked in the map's
// Collision layer — both tiles are force-unblocked below so the ramp works.
const RAMPS: RampDef[] = [
  { tx: 21, ty: 10, fromElev: 0, toElev: 1 },
];

/** Dual-grid tile hash (natural texture variety within a biome). */
function wfTileHash(tx: number, ty: number): number {
  const px = Math.floor(tx / 6),       py = Math.floor(ty / 6);
  const qx = Math.floor((tx + 3) / 6), qy = Math.floor((ty + 2) / 6);
  const coarse  = ((px * 3571 ^ py * 2297 ^ px * py * 53) >>> 0) % 3;
  const coarse2 = ((qx * 4733 ^ qy * 1867 ^ qx * qy * 97) >>> 0) % 3;
  const fine    = ((tx * 1597 ^ ty * 2833 ^ (tx + ty) * 743) >>> 0) % 7;
  return fine === 0 ? 3 : (fine <= 2 ? coarse2 : coarse);
}

function hsIsoDepth(wx: number, wy: number, elev = 0): number {
  // Standing higher reads visually like standing further "forward" in the
  // iso projection, so bump depth the same way moving one tile would.
  return (wx + wy) / TILE_SIZE + elev;
}

/**
 * Wavy forest/meadow boundary — returns a value from 0 (deep forest) to 1
 * (open meadow). Drives tree-scatter density only (#1173) — the floor
 * texture itself comes from the map's baked Biome layer, not this formula.
 */
function forestMeadowBlend(tx: number, ty: number): number {
  const edge = 21
    + Math.sin(ty * 0.22) * 3.5
    + Math.cos(ty * 0.11 + 1.7) * 2.0
    + Math.sin(ty * 0.37 + tx * 0.05) * 1.5;
  const half = 2;
  if (tx <= edge - half) return 0;   // pure forest
  if (tx >= edge + half) return 1;   // pure meadow
  return (tx - (edge - half)) / (half * 2);  // 0→1 across transition
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

/** Auto-tile bitmask → spritesheet frame (same mapping as GameScene). */
const ROAD_BITMASK_TO_FRAME = [
  /*  0 none     */ 0,
  /*  1 NW       */ 9,
  /*  2 NE       */ 8,
  /*  3 NW+NE    */ 11,
  /*  4 SE       */ 8,
  /*  5 NW+SE    */ 2,
  /*  6 NE+SE    */ 8,
  /*  7 NW+NE+SE */ 6,
  /*  8 SW       */ 9,
  /*  9 NW+SW    */ 9,
  /* 10 NE+SW    */ 1,
  /* 11 NW+NE+SW */ 7,
  /* 12 SE+SW    */ 10,
  /* 13 NW+SE+SW */ 5,
  /* 14 NE+SE+SW */ 4,
  /* 15 all      */ 0,
];

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

  // ── Map (#1173) ───────────────────────────────────────────────────────
  private level!: LdtkLevel;
  private heightGrid!: IntGridLayer;
  private biomeGrid!: IntGridLayer;
  private cliffBiomeGrid!: IntGridLayer;
  private riverGrid!: IntGridLayer;
  private gridW = 0;
  private gridH = 0;
  private worldW = 0;
  private worldH = 0;
  private isoOriginX = 0;
  private isoW = 0;
  private isoH = 0;

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

  // Wildlife system — replaces the old inline wolf preview
  private wildlife?: WildlifeSystem;
  private characterKey = 'loke';
  private facingDir: 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'west' = 'south';
  private lastSafeX = 0;
  private lastSafeY = 0;

  // ── Building placement ─────────────────────────────────────────────────
  private selectedBuilding: BuildingDef | null = null;
  private occupied!: Uint8Array;
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
  // 0 = walkable, 1 = blocked (water, cliff). Row-major: ty * this.gridW + tx.
  private walkGrid!: Uint8Array;
  private roadGrid!: Uint8Array;
  private bridgeTiles: { tx: number; ty: number }[] = [];
  private debugGridGfx: Phaser.GameObjects.Graphics | null = null;
  private playerTileGfx: Phaser.GameObjects.Graphics | null = null;

  // ── Elevation walkability (#936) ────────────────────────────────────────
  private rampSet = buildRampSet(RAMPS);
  private rampMap = buildRampMap(RAMPS);
  private playerElev = 0;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    // The item registry is bundled (REGISTRY_ITEMS), not loaded here: it isn't in the build's public/ (#1512).
    this.load.json('resource-nodes', '/macro-world/resource-nodes.json');
    this.load.json('homestead-map', `/assets/maps/${DEFAULT_MAP_ID}.json`);

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

    // Wildlife spritesheets — 8 directions for idle+run (all species)
    const DIRS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
    // 8-directional animations per species — generated from on-disk files.
    // WildlifeSystem's playAnimalAnim() falls back gracefully (run→walk, sneak→walk, alert→idle).
    const wildlifeSpecs: { species: string; anims: string[]; size: number }[] = [
      { species: 'wolf',         anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 48 },
      { species: 'lynx',         anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 48 },
      { species: 'bear',         anims: ['idle', 'run', 'walk', 'alert'],                   size: 68 },
      { species: 'squirrel',     anims: ['idle', 'run', 'walk', 'alert'],                   size: 24 },
      { species: 'hedgehog',     anims: ['idle', 'run', 'walk', 'alert'],                   size: 24 },
      { species: 'elk',          anims: ['idle', 'run', 'alert'],                           size: 68 },
      { species: 'bison',        anims: ['idle', 'run', 'alert'],                           size: 68 },
      { species: 'roe-deer',     anims: ['idle', 'run', 'alert'],                           size: 48 },
      { species: 'wolverine',    anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 48 },
      { species: 'rabbit',       anims: ['idle', 'run', 'walk', 'alert'],                   size: 24 },
      { species: 'pine-marten',  anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 36 },
      { species: 'polecat',      anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 36 },
      { species: 'stoat',        anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 24 },
      { species: 'beaver',       anims: ['idle', 'run', 'walk', 'alert'],                   size: 48 },
      { species: 'wild-boar',    anims: ['idle', 'run', 'walk', 'alert'],                   size: 68 },
      { species: 'badger',       anims: ['idle', 'run', 'walk', 'alert'],                   size: 48 },
      { species: 'beech-marten', anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 36 },
      { species: 'weasel',       anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 24 },
      { species: 'wildcat',      anims: ['idle', 'run', 'walk', 'alert', 'sneak'],          size: 48 },
      { species: 'raccoon',      anims: ['idle', 'run', 'walk', 'alert'],                   size: 36 },
      { species: 'grass-snake',  anims: ['idle', 'run', 'alert'],                           size: 36 },
      { species: 'arctic-fox',   anims: ['idle', 'run', 'alert', 'sneak'],                  size: 36 },
      { species: 'fallow-deer',  anims: ['idle', 'run', 'alert'],                           size: 48 },
      { species: 'red-deer',     anims: ['idle', 'run', 'alert'],                           size: 68 },
      { species: 'moose',        anims: ['idle', 'run'],                                    size: 68 },
    ];
    for (const { species, anims, size } of wildlifeSpecs) {
      const base = `/assets/sprites/wildlife/${species}`;
      for (const anim of anims) {
        for (const d of DIRS) {
          this.load.spritesheet(`${species}-${anim}-${d}`, `${base}/${anim}_${d}.png`, { frameWidth: size, frameHeight: size });
        }
      }
    }

    // NPC spritesheets — 8 directions for idle+walk+run+role
    const NPC_SPECS: { id: string; anims: string[]; size: number }[] = [
      // Fieldborn culture NPCs
      { id: 'fieldborn-blacksmith',   anims: ['idle', 'walk', 'run', 'hammer'],  size: 68 },
      { id: 'fieldborn-chief',        anims: ['idle', 'walk', 'run', 'command'], size: 68 },
      { id: 'fieldborn-child',        anims: ['idle', 'walk', 'run', 'play'],    size: 48 },
      { id: 'fieldborn-elder',        anims: ['idle', 'walk', 'run', 'gesture'], size: 68 },
      { id: 'fieldborn-farmer',       anims: ['idle', 'walk', 'run', 'dig'],     size: 68 },
      { id: 'fieldborn-guard',        anims: ['idle', 'walk', 'run', 'alert'],   size: 68 },
      { id: 'fieldborn-hearthkeeper', anims: ['idle', 'walk', 'run', 'serve'],   size: 68 },
      { id: 'fieldborn-shrine',       anims: ['idle', 'walk', 'run', 'pray'],    size: 68 },
      // Ikibeki culture NPCs
      { id: 'ikibeki-barmaid',        anims: ['idle', 'walk', 'run', 'serve'],   size: 68 },
      { id: 'ikibeki-brewer',         anims: ['idle', 'walk', 'run', 'stir'],    size: 68 },
      { id: 'ikibeki-commoner',       anims: ['idle', 'walk', 'run', 'wave'],    size: 68 },
      { id: 'ikibeki-cook',           anims: ['idle', 'walk', 'run', 'serve'],   size: 68 },
      { id: 'ikibeki-elder',          anims: ['idle', 'walk', 'run', 'gesture'], size: 68 },
      { id: 'ikibeki-farmer',         anims: ['idle', 'walk', 'run', 'dig'],     size: 68 },
      { id: 'ikibeki-herbalist',      anims: ['idle', 'walk', 'run', 'gesture'], size: 68 },
      { id: 'ikibeki-highfang',       anims: ['idle', 'walk', 'run', 'alert'],   size: 68 },
      { id: 'ikibeki-lorekeeper',     anims: ['idle', 'walk', 'run', 'pray'],    size: 68 },
      { id: 'ikibeki-porter',         anims: ['idle', 'walk', 'run', 'carry'],   size: 68 },
      { id: 'ikibeki-scout',          anims: ['idle', 'walk', 'run', 'lookout'], size: 68 },
      { id: 'ikibeki-smith',          anims: ['idle', 'walk', 'run'],            size: 68 },
      { id: 'ikibeki-stablehand',     anims: ['idle', 'walk', 'run', 'brush'],   size: 68 },
      { id: 'ikibeki-trader',         anims: ['idle', 'walk', 'run', 'gesture'], size: 68 },
      { id: 'ikibeki-warrior',        anims: ['idle', 'walk', 'run', 'alert'],   size: 68 },
      { id: 'ikibeki-woodcutter',     anims: ['idle', 'walk', 'run', 'dig'],     size: 68 },
      // Wallborn culture NPCs
      { id: 'wallborn-gate-guard',    anims: ['idle', 'walk', 'run', 'alert'],   size: 68 },
      // Independent NPCs
      { id: 'wanderer',               anims: ['idle', 'walk', 'run'],            size: 48 },
    ];
    for (const { id, anims, size } of NPC_SPECS) {
      const base = `/assets/sprites/characters/npcs/${id}`;
      for (const anim of anims) {
        for (const d of DIRS) {
          this.load.spritesheet(`npc-${id}-${anim}-${d}`, `${base}/${anim}_${d}.png`, { frameWidth: size, frameHeight: size });
        }
      }
    }

    // Fauna registry for WildlifeSystem
    this.load.json('fauna-registry', '/macro-world/fauna-registry.json');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a3a1a');

    // ── Map (#1173) ─────────────────────────────────────────────────────
    this.level = parseLdtkLevel(this.cache.json.get('homestead-map'));
    this.heightGrid = this.level.intGrids.HeightMap;
    this.biomeGrid = this.level.intGrids.Biome;
    this.cliffBiomeGrid = this.level.intGrids.CliffBiome;
    this.riverGrid = this.level.intGrids.River;
    const collisionLayer = this.level.intGrids.Collision;
    this.gridW = collisionLayer.cols;
    this.gridH = collisionLayer.rows;
    this.worldW = this.level.width;
    this.worldH = this.level.height;
    this.isoOriginX = this.gridH * (ISO_TILE_W / 2);
    this.isoW = (this.gridW + this.gridH) * (ISO_TILE_W / 2);
    this.isoH = (this.gridW + this.gridH) * (ISO_TILE_H / 2) + ISO_TILE_H;
    this.occupied = new Uint8Array(this.gridW * this.gridH);
    this.walkGrid = Uint8Array.from(collisionLayer.values);
    this.roadGrid = new Uint8Array(this.gridW * this.gridH);

    // Collision layer blocks deep water, but its SE-offset vs the Biome
    // layer leaves a strip of visually-wet shore tiles walkable (#938).
    // Grow the blocked zone by one tile around every water tile so the
    // player stops right at the shore instead of wading into it.
    bufferShoreline(this.walkGrid, this.biomeGrid);

    // Ramp tiles (and their lowland foot) must stay walkable even if the
    // Collision layer blocks them — they're the designated crossing points
    // through the cliff-edge block (#936).
    for (const { tx, ty } of RAMPS) {
      this.walkGrid[ty * this.gridW + tx] = 0;
      this.walkGrid[(ty + 1) * this.gridW + tx] = 0; // south foot of the ramp
    }

    // Physics world stays in flat grid space
    this.physics.world.setBounds(0, 0, this.worldW, this.worldH);

    // ── Pre-pass: road path before rendering (walkGrid comes from the map) ──
    this.buildRoadPath();

    // ── Inventory ─────────────────────────────────────────────────────────
    const inv = new InventorySystem(this);
    // Load item definitions from the unified registry.
    inv.loadResourceDefs(playerItems(REGISTRY_ITEMS) as never[]);
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

    for (let diag = 0; diag < this.gridW + this.gridH - 1; diag++) {
      const txMin = Math.max(0, diag - (this.gridH - 1));
      const txMax = Math.min(diag, this.gridW - 1);
      for (let tx = txMin; tx <= txMax; tx++) {
        const ty = diag - tx;
        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const { x: isoX, y: isoY } = this.worldToIso(wx, wy);
        const baseDepth = hsIsoDepth(wx, wy);

        const tileElev = intGridGet(this.heightGrid, tx, ty);
        const biomeId = intGridGet(this.biomeGrid, tx, ty);
        const isWater = biomeId === 0;
        const pack = CUSTOM_TILE_PACKS[biomeId] ?? 'meadow';
        const posY = isoY - tileElev * CLIFF_H;
        // Variant hash used local WF coords on the right half, global
        // coords on the left half — an original quirk kept for visual parity.
        const th = tx < 30 ? wfTileHash(tx, ty) : wfTileHash(tx - 30, ty);

        // Cliff detection from neighbour elevations. The west comparison
        // skips exactly the homestead/WF seam column (tx === 30) — the two
        // halves use unrelated elevation formulas there, so the original
        // code never diffed across that one boundary (it still does on the
        // east side, tx === 29 looking into tx === 30).
        const southElev = ty + 1 < this.gridH ? intGridGet(this.heightGrid, tx, ty + 1) : tileElev;
        const eastElev  = tx + 1 < this.gridW ? intGridGet(this.heightGrid, tx + 1, ty) : tileElev;
        const westElev  = (tx > 0 && tx !== 30) ? intGridGet(this.heightGrid, tx - 1, ty) : tileElev;
        const southDrop = tileElev > 0 ? tileElev - southElev : 0;
        const eastDrop  = tileElev > 0 ? tileElev - eastElev : 0;
        const westDrop  = tileElev > 0 ? tileElev - westElev : 0;
        const hasCliff = southDrop > 0 || eastDrop > 0 || westDrop > 0;
        const isOnRiver = intGridGet(this.riverGrid, tx, ty) === 1;

        if (hasCliff) {
          const cliffBiome = intGridGet(this.cliffBiomeGrid, tx, ty);
          const cliffKey = cliffKeyForBiome(cliffBiome);
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
          if (!isWater) {
            this.add.image(isoX, posY, `${pack}-${th}`)
              .setOrigin(0.5, 0).setDepth(baseDepth - 999);
          } else {
            this.add.image(isoX, posY, 'iso-tiles', 105)
              .setOrigin(0.5, 0).setDepth(baseDepth - 999);
          }
        } else {
          // Flat tile
          if (isWater) {
            this.add.image(isoX, posY, 'iso-tiles', 105)
              .setOrigin(0.5, 0).setDepth(baseDepth - 1000);
          } else {
            this.add.image(isoX, posY, `${pack}-${th}`)
              .setOrigin(0.5, 0).setDepth(baseDepth - 1000);
          }
        }

        // ── Road overlay ─────────────────────────────────────────────────
        // Skip bridge tiles (rendered separately). Water-classified bank
        // tiles beside a bridge still get the overlay (#931) — otherwise
        // the Biome layer's wider water band leaves a 1-tile visual gap
        // between the road and the bridge.
        if (
          roadOverlayVisible(
            tx, ty,
            (x, y) => this.isRoad(x, y),
            (x, y) => intGridGet(this.biomeGrid, x, y) === 0,
            (x, y) => this.isBridgeTile(x, y),
          ) && tileElev === 0
        ) {
          let mask = 0;
          if (tx === 0 || this.isRoad(tx - 1, ty)) mask |= 1;  // NW
          if (this.isRoad(tx, ty - 1))              mask |= 2;  // NE
          if (tx === this.gridW - 1 || this.isRoad(tx + 1, ty)) mask |= 4;  // SE
          if (this.isRoad(tx, ty + 1))              mask |= 8;  // SW
          const frame = ROAD_BITMASK_TO_FRAME[mask];
          this.add.image(isoX, posY + ISO_TILE_H / 2, 'road-dirt', frame)
            .setOrigin(0.5, 0.5).setDepth(baseDepth - 999);
        }
      }
    }

    // ── Bridge tiles at the pre-computed river crossing ─────────────────
    for (const { tx, ty } of this.bridgeTiles) {
      const wx = tx * TILE_SIZE;
      const wy = ty * TILE_SIZE;
      const { x: isoX, y: isoY } = this.worldToIso(wx, wy);
      this.add.image(isoX, isoY + ISO_TILE_H / 2, 'bridge-mid')
        .setDisplaySize(ISO_TILE_W * 1.2, ISO_TILE_H * 1.8)
        .setOrigin(0.5, 0.5)
        .setDepth(hsIsoDepth(wx, wy));
      // Unblock so the player can walk across
      this.walkGrid[ty * this.gridW + tx] = 0;
    }

    // ── Unblock road tiles ───────────────────────────────────────────────
    // Road tiles can sit on cliff-adjacent ground that the Collision layer
    // marked blocked; clear them so the player can walk the road's full
    // length. Bridge tiles are unblocked separately above.
    for (let ty = 0; ty < this.gridH; ty++) {
      for (let tx = 0; tx < this.gridW; tx++) {
        if (this.isRoad(tx, ty) && !this.isBridgeTile(tx, ty)) {
          this.walkGrid[ty * this.gridW + tx] = 0;
        }
      }
    }

    // ── Debug tile grid overlay ─────────────────────────────────────────
    // Draws iso diamond outlines: green = walkable, red = blocked.
    // Toggle with G key; off by default.
    this.debugGridGfx = this.add.graphics().setDepth(9000).setVisible(false);
    this.drawDebugGrid();
    this.input.keyboard!.on('keydown-G', () => {
      if (!this.scene.isActive(HomesteadScene.KEY)) return;
      this.debugGridGfx!.setVisible(!this.debugGridGfx!.visible);
    });

    // ── Player tile highlight — golden diamond under the character ───────
    this.playerTileGfx = this.add.graphics().setDepth(8999);

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

    // ── Dense forest zones become impassable barriers (#935) ───────────
    // Flood-fill the thickest canopy patches and block any cluster above
    // the size threshold, funnelling the player through clearings, gaps,
    // and the road instead of straight through the deep forest.
    blockDenseForestZones(
      this.walkGrid,
      this.buildDenseCanopyMask(this.buildResourceNodeSet()),
      this.gridW,
      this.gridH,
      MIN_FOREST_ZONE_SIZE,
    );

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
    const { x: spawnIsoX, y: spawnIsoY } = this.worldToIso(spawnWx, spawnWy);
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

    // ── Resource nodes (#1173) ───────────────────────────────────────────
    // Positions come from the map's ResourceNode entities; ResourceNode
    // renders at world coords but we reposition them to iso space after
    // creation.
    const nodeDefs = this.cache.json.get('resource-nodes') as { nodeTypes: ResourceNodeTypeDef[] } | undefined;
    const entitiesLayer = this.level.entityLayers.Entities;
    if (nodeDefs?.nodeTypes && entitiesLayer) {
      const nodeGroup = this.physics.add.staticGroup();

      for (const e of entitiesOfType(entitiesLayer, 'ResourceNode')) {
        const defId = String(e.fields.nodeType ?? '');
        const def = nodeDefs.nodeTypes.find(d => d.id === defId);
        if (!def) continue;
        const wx = e.x;
        const wy = e.y;
        const { x: isoX, y: isoY } = this.worldToIso(wx, wy);
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
      this.isoW + cam.width / 3,
      this.isoH + cam.height / 3,
    );
    cam.startFollow(this.playerIso, true, 0.08, 0.08);

    // ── Wildlife system ────────────────────────────────────────────────────
    this.initWildlife();

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
    const cx = this.isoW / 2;   // centre of diamond in iso space
    const cy = this.isoH / 2;
    const pad = 14;          // px outside the diamond edge
    // N = top apex, S = bottom apex, W = left apex, E = right apex
    this.add.text(cx, -pad, 'N', dirStyle).setOrigin(0.5, 1);
    this.add.text(cx, this.isoH + pad, 'S', dirStyle).setOrigin(0.5, 0);
    this.add.text(-pad, cy, 'W', dirStyle).setOrigin(1, 0.5);
    this.add.text(this.isoW + pad, cy, 'E', dirStyle).setOrigin(0, 0.5);

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
    // Wildlife system update — pass player world-space position (physics body)
    // so distance checks are in world space, matching the refactored WildlifeSystem.
    if (this.wildlife && this.player) {
      this.wildlife.update(
        this.game.loop.time,
        this.game.loop.delta,
        this.player.x,
        this.player.y,
      );
    }

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
    this.player.x = Phaser.Math.Clamp(this.player.x, margin, this.worldW - margin);
    this.player.y = Phaser.Math.Clamp(this.player.y, margin, this.worldH - margin);

    // ── Tile collision — walk grid + sub-tile cliff-base check ─────────
    const BODY_R = 6;
    const isBlocked = (wx: number, wy: number) => {
      // Check 4 corners of the body box against the walkGrid
      for (const [ox, oy] of [[-BODY_R,-BODY_R],[BODY_R,-BODY_R],[-BODY_R,BODY_R],[BODY_R,BODY_R]]) {
        const ttx = Math.floor((wx + ox) / TILE_SIZE);
        const tty = Math.floor((wy + oy) / TILE_SIZE);
        if (ttx < 0 || tty < 0 || ttx >= this.gridW || tty >= this.gridH) return true;
        if (this.walkGrid[tty * this.gridW + ttx] === 1) return true;
      }
      // Sub-tile cliff-edge check: block the half of this tile nearest any
      // south/east/west drop (ramps bypass it) — see ElevationWalk (#936).
      const ttx = Math.floor(wx / TILE_SIZE);
      const tty = Math.floor(wy / TILE_SIZE);
      const localX = wx - ttx * TILE_SIZE;
      const localY = wy - tty * TILE_SIZE;
      return isCliffBlocked(this.heightGrid, this.rampSet, ttx, tty, localX, localY, TILE_SIZE);
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
    // Offset sprite so feet land in the centre of the tile diamond.
    // The diamond centre is at (isoX, isoY + ISO_TILE_H/2) relative to
    // the north apex; shift sprite there.
    this.playerElev = effectiveElevation(this.heightGrid, this.rampMap, this.player.x, this.player.y, TILE_SIZE);
    const { x: isoX, y: isoY } = this.worldToIso(this.player.x, this.player.y);
    this.playerIso.setPosition(isoX, isoY + ISO_TILE_H - this.playerElev * CLIFF_H);
    this.playerIso.setDepth(hsIsoDepth(this.player.x, this.player.y, this.playerElev));

    // ── Player tile highlight — golden diamond on the tile the player occupies
    if (this.playerTileGfx) {
      this.playerTileGfx.clear();
      const ptx = Math.floor(this.player.x / TILE_SIZE);
      const pty = Math.floor(this.player.y / TILE_SIZE);
      const twx = ptx * TILE_SIZE;
      const twy = pty * TILE_SIZE;
      const { x: tix, y: tiyFlat } = this.worldToIso(twx, twy);
      const tiy = tiyFlat - intGridGet(this.heightGrid, ptx, pty) * CLIFF_H;
      const hw = ISO_TILE_W / 2;
      const hh = ISO_TILE_H / 2;
      this.playerTileGfx.lineStyle(1.5, 0xf0c040, 0.8);
      this.playerTileGfx.fillStyle(0xf0c040, 0.15);
      this.playerTileGfx.beginPath();
      this.playerTileGfx.moveTo(tix, tiy);
      this.playerTileGfx.lineTo(tix + hw, tiy + hh);
      this.playerTileGfx.lineTo(tix, tiy + ISO_TILE_H);
      this.playerTileGfx.lineTo(tix - hw, tiy + hh);
      this.playerTileGfx.closePath();
      this.playerTileGfx.fillPath();
      this.playerTileGfx.strokePath();
    }

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
      // Create children via `new` to avoid adding them to the scene display
      // list — only the container should be in the list. This prevents the
      // main camera from rendering the toolbar icons as tiny world sprites.
      const bg = new Phaser.GameObjects.Rectangle(this, 0, 0, btnSize, btnSize, 0x1a2a1a, 0.85)
        .setStrokeStyle(1, 0x3a5a3a, 0.8);
      container.add(bg);
      const icon = new Phaser.GameObjects.Image(this, 0, -2, b.spriteKey);
      const scale = Math.min((btnSize - 8) / icon.width, (btnSize - 8) / icon.height);
      icon.setScale(scale);
      container.add(icon);
      const label = new Phaser.GameObjects.Text(this, 0, btnSize / 2 + 4, b.label, {
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

  private worldToIso(wx: number, wy: number): { x: number; y: number } {
    const tx = wx / TILE_SIZE;
    const ty = wy / TILE_SIZE;
    return {
      x: this.isoOriginX + (tx - ty) * (ISO_TILE_W / 2),
      y: (tx + ty) * (ISO_TILE_H / 2),
    };
  }

  private isoToTile(isoX: number, isoY: number): { tx: number; ty: number } | null {
    const relX = isoX - this.isoOriginX;
    const relY = isoY;
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;
    const tx = Math.floor(((relX / hw) + (relY / hh)) / 2);
    const ty = Math.floor(((relY / hh) - (relX / hw)) / 2);
    if (tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridH) return null;
    return { tx, ty };
  }

  // ── Placement logic ────────────────────────────────────────────────────

  private canPlace(def: BuildingDef, tx: number, ty: number): boolean {
    if (tx + def.footW > this.gridW || ty + def.footD > this.gridH) return false;
    for (let dx = 0; dx < def.footW; dx++) {
      for (let dy = 0; dy < def.footD; dy++) {
        if (this.occupied[(ty + dy) * this.gridW + (tx + dx)]) return false;
      }
    }
    return true;
  }

  private placeBuilding(def: BuildingDef, tx: number, ty: number): void {
    if (!this.canPlace(def, tx, ty)) return;

    for (let dx = 0; dx < def.footW; dx++) {
      for (let dy = 0; dy < def.footD; dy++) {
        this.occupied[(ty + dy) * this.gridW + (tx + dx)] = 1;
      }
    }

    const centreWx = (tx + def.footW / 2) * TILE_SIZE;
    const centreWy = (ty + def.footD / 2) * TILE_SIZE;
    const { x: isoX, y: isoY } = this.worldToIso(centreWx, centreWy);

    const sprite = this.add.image(isoX, isoY, def.spriteKey);
    sprite.setOrigin(0.5, 0.75);
    sprite.setDepth(hsIsoDepth(centreWx, centreWy));
    // Hide from UI camera so it only renders on the main (zoomed) camera
    this.cameras.cameras[1]?.ignore(sprite);
    this.placedBuildings.push(sprite);
    this.cancelPlacement();
  }

  // ── Placement preview ──────────────────────────────────────────────────

  private drawPlacementPreview(def: BuildingDef, tx: number, ty: number): void {
    if (this.footprintGfx) this.footprintGfx.destroy();
    if (this.ghostSprite) this.ghostSprite.destroy();

    const outOfBounds = tx + def.footW > this.gridW || ty + def.footD > this.gridH;
    let blocked = outOfBounds;
    if (!outOfBounds) blocked = !this.canPlace(def, tx, ty);

    const color = blocked ? 0xff4444 : 0x44dd44;
    const gfx = this.add.graphics().setDepth(9000);

    if (!outOfBounds) {
      for (let dx = 0; dx < def.footW; dx++) {
        for (let dy = 0; dy < def.footD; dy++) {
          const wx = (tx + dx) * TILE_SIZE;
          const wy = (ty + dy) * TILE_SIZE;
          const { x: ix, y: iy } = this.worldToIso(wx, wy);
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
    this.cameras.cameras[1]?.ignore(gfx);

    if (!outOfBounds) {
      const centreWx = (tx + def.footW / 2) * TILE_SIZE;
      const centreWy = (ty + def.footD / 2) * TILE_SIZE;
      const { x: isoX, y: isoY } = this.worldToIso(centreWx, centreWy);
      this.ghostSprite = this.add.image(isoX, isoY, def.spriteKey);
      this.ghostSprite.setOrigin(0.5, 0.75);
      this.ghostSprite.setAlpha(blocked ? 0.3 : 0.5);
      this.ghostSprite.setDepth(9001);
      this.cameras.cameras[1]?.ignore(this.ghostSprite);
      if (blocked) this.ghostSprite.setTint(0xff6666);
    } else {
      this.ghostSprite = null;
    }
  }

  // ── Road path (pre-pass before rendering) ─────────────────────────────
  // walkGrid itself comes straight from the map's Collision layer (#1173).

  /** Build cost grid from walkGrid, run A*, populate roadGrid + bridgeTiles. */
  private buildRoadPath(): void {
    const { gridW, gridH } = this;
    const cost = new Float32Array(gridW * gridH);
    for (let i = 0; i < gridW * gridH; i++) {
      // Blocked tiles are impassable; clear tiles cost 1
      cost[i] = this.walkGrid[i] === 1 ? 0 : 1;
    }

    // Override: river tiles in WF half are expensive but crossable (→ bridge).
    // RiverCrossable is pre-baked (#1173): inland river tiles only, not the
    // ocean/river-mouth band and not cliffs — the map file already resolved
    // that distinction.
    const riverCrossable = this.level.intGrids.RiverCrossable;
    if (riverCrossable) {
      for (let ty = 0; ty < gridH; ty++) {
        for (let tx = 30; tx < gridW; tx++) {
          if (intGridGet(riverCrossable, tx, ty) === 1) cost[ty * gridW + tx] = 30;
        }
      }
    }

    // A* between interior points, then extend straight to map edges.
    // This prevents A* from running along the edge to reach a fixed ty.
    // Vertical penalty (3×) biases toward horizontal travel.
    const startTx = 2, startTy = 15;
    const goalTx = gridW - 3, goalTy = 10;
    const path = aStarWeighted(cost, gridW, gridH,
      startTx, startTy, goalTx, goalTy, 20000, 3);

    if (path) {
      // Extend road straight west from start to map edge
      for (let tx = 0; tx <= startTx; tx++) {
        this.roadGrid[startTy * gridW + tx] = 1;
      }
      // Mark A* path
      for (const p of path) {
        this.roadGrid[p.y * gridW + p.x] = 1;
      }
      // Extend road straight east from goal to map edge
      const endTy = path.length > 0 ? path[path.length - 1].y : goalTy;
      for (let tx = goalTx; tx < gridW; tx++) {
        this.roadGrid[endTy * gridW + tx] = 1;
      }
      // Bridge tiles = road tiles on water (cost ≥ 30)
      for (const p of path) {
        if (cost[p.y * gridW + p.x] >= 30) {
          this.bridgeTiles.push({ tx: p.x, ty: p.y });
        }
      }
    }
  }

  private isRoad(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridH) return false;
    return this.roadGrid[ty * this.gridW + tx] === 1;
  }

  private isBridgeTile(tx: number, ty: number): boolean {
    return this.bridgeTiles.some(b => b.tx === tx && b.ty === ty);
  }

  // ── Tree scatter ──────────────────────────────────────────────────────
  // Dense forest on the left, sparse meadow trees on the right, with a
  // natural transition zone.  Deterministic: seeded hash per tile.

  // ── Debug grid ──────────────────────────────────────────────────────

  private drawDebugGrid(): void {
    const gfx = this.debugGridGfx!;
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;

    for (let ty = 0; ty < this.gridH; ty++) {
      for (let tx = 0; tx < this.gridW; tx++) {
        const blocked = this.walkGrid[ty * this.gridW + tx] === 1;
        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const { x: ix, y: iy } = this.worldToIso(wx, wy);

        gfx.lineStyle(0.5, blocked ? 0xff4444 : 0x44ff44, blocked ? 0.4 : 0.15);
        gfx.beginPath();
        gfx.moveTo(ix, iy);
        gfx.lineTo(ix + hw, iy + hh);
        gfx.lineTo(ix, iy + ISO_TILE_H);
        gfx.lineTo(ix - hw, iy + hh);
        gfx.closePath();
        gfx.strokePath();

        if (blocked) {
          gfx.fillStyle(0xff4444, 0.1);
          gfx.fillPath();
        }
      }
    }
  }

  /** Resource-node tile coordinates, as `"tx,ty"` keys — shared by scatterTrees() and the dense-canopy mask so neither places/blocks on top of a node. */
  private buildResourceNodeSet(): Set<string> {
    const nodeSet = new Set<string>();
    for (const n of this.resourceNodes) {
      const nwx = n.getData('worldX') as number;
      const nwy = n.getData('worldY') as number;
      nodeSet.add(`${Math.floor(nwx / TILE_SIZE)},${Math.floor(nwy / TILE_SIZE)}`);
    }
    return nodeSet;
  }

  /**
   * Shared exclusions for tree placement and dense-forest-zone candidacy:
   * walkable, off-road, not water/rock, not hugging a cliff, and not sitting
   * on a resource node.
   */
  private isForestEligible(tx: number, ty: number, nodeSet: Set<string>): boolean {
    // Skip non-walkable tiles and roads
    if (this.walkGrid[ty * this.gridW + tx] === 1) return false;
    if (this.isRoad(tx, ty)) return false;

    // Only spawn on flat meadow — skip water, rock, granite, summit tiles
    const tileElev = intGridGet(this.heightGrid, tx, ty);
    const shoreEdge = 42 + Math.round(Math.sin(tx * 0.3) * 3 + Math.cos(tx * 0.18) * 2);
    const hsIsWater = tileElev === 0 && ty > shoreEdge;
    if (hsIsWater) return false;
    if (tileElev >= 1) return false; // rock/granite/summit — no trees

    // 1-tile buffer from cliff faces: skip if any neighbour has elevation
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = tx + dx, ny = ty + dy;
        if (nx >= 0 && nx < this.gridW && ny >= 0 && ny < this.gridH) {
          if (intGridGet(this.heightGrid, nx, ny) > 0) return false;
        }
      }
    }

    // Skip tiles occupied by resource nodes
    if (nodeSet.has(`${tx},${ty}`)) return false;

    return true;
  }

  /**
   * Candidate mask for the thickest forest canopy (#935): pure forest
   * (blend === 0) tiles whose cluster noise reads as "very high" density.
   * Fed to `blockDenseForestZones()`, which flood-fills it and blocks
   * clusters above the size threshold — smaller patches and the gaps
   * between clusters stay walkable as natural clearings.
   */
  private buildDenseCanopyMask(nodeSet: Set<string>): Uint8Array {
    const mask = new Uint8Array(this.gridW * this.gridH);
    for (let tx = 1; tx < this.gridW - 1; tx++) {
      for (let ty = 1; ty < this.gridH - 1; ty++) {
        if (!this.isForestEligible(tx, ty, nodeSet)) continue;
        if (forestMeadowBlend(tx, ty) !== 0) continue; // transition + meadow stay walkable-around

        const n1 = Math.sin(tx * 0.35 + ty * 0.25) * Math.cos(ty * 0.4 - tx * 0.15);
        const n2 = Math.sin(tx * 0.18 - ty * 0.32) * Math.cos(tx * 0.28 + ty * 0.12);
        const cluster = (n1 + n2 + 2) / 4; // same cluster noise as scatterTrees(), normalised to 0-1
        if (cluster >= DENSE_CANOPY_CLUSTER_MIN) mask[ty * this.gridW + tx] = 1;
      }
    }
    return mask;
  }

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
    // Per-species weights are computed per-tile based on forest/meadow blend.

    // Simple deterministic hash for per-tile decisions.
    const hash = (a: number, b: number, salt: number) =>
      (((a * 2654435761 + b * 2246822519 + salt) >>> 0) & 0x7fffffff);

    const nodeSet = this.buildResourceNodeSet();

    for (let tx = 1; tx < this.gridW - 1; tx++) {
      for (let ty = 1; ty < this.gridH - 1; ty++) {
        if (!this.isForestEligible(tx, ty, nodeSet)) continue;

        // Forest/meadow blend drives tree density:
        //   forest (blend=0) → ~85% coverage, dense canopy
        //   transition       → gradual thinning
        //   meadow (blend=1) → ~5% coverage, occasional lone trees
        const blend = forestMeadowBlend(tx, ty);

        // Cluster noise — two overlapping waves create natural clumps
        const n1 = Math.sin(tx * 0.35 + ty * 0.25) * Math.cos(ty * 0.4 - tx * 0.15);
        const n2 = Math.sin(tx * 0.18 - ty * 0.32) * Math.cos(tx * 0.28 + ty * 0.12);
        const cluster = (n1 + n2 + 2) / 4; // normalise to 0-1

        // Forest: low threshold (0.10) for dense canopy.
        // Meadow: moderate threshold (0.45, same as WorldForge) for natural scatter.
        const threshold = 0.10 + blend * 0.35;  // forest=0.10, meadow=0.45
        if (cluster < threshold) continue;

        const spawnChance = (cluster - threshold) / (1 - threshold);
        const roll = (hash(tx, ty, 0xBEEF) % 1000) / 1000;
        // Forest: high bonus keeps it dense. Meadow: solid bonus ensures
        // visible tree scatter across open areas.
        const forestBonus = (1 - blend) * 0.4;
        const meadowBonus = blend * 0.35;
        if (roll > spawnChance + forestBonus + meadowBonus) continue;

        {
          // Pick species by weighted random.
          // Forest side strongly favours conifers; meadow side favours deciduous.
          const forestWeights = [40, 35, 10, 10, 5];  // pine, spruce, oak, birch, elm
          const meadowWeights = [10, 10, 35, 30, 15]; // pine, spruce, oak, birch, elm
          const weights = species.map((_, i) => {
            const fw = forestWeights[i], mw = meadowWeights[i];
            return Math.round(fw + (mw - fw) * blend);
          });
          const tw = weights.reduce((a, b) => a + b, 0);
          const specRoll = hash(tx, ty, 0xCAFE) % tw;
          let acc = 0;
          let sp = species[0];
          for (let i = 0; i < species.length; i++) {
            acc += weights[i];
            if (specRoll < acc) { sp = species[i]; break; }
          }

          // Forest: mostly mature trees for a dense canopy.
          // Meadow: more young/sapling for an open feel.
          const matureChance = blend <= 0 ? 65 : blend >= 1 ? 30 : Math.round(65 - 35 * blend);
          const youngCap = blend <= 0 ? 90 : blend >= 1 ? 70 : Math.round(90 - 20 * blend);
          const stageRoll = hash(tx, ty, 0xFACE) % 100;
          let textureKey: string;
          if (stageRoll < matureChance) {
            textureKey = `${sp.prefix}-${hash(tx, ty, 0xAA) % sp.matureN}`;
          } else if (stageRoll < youngCap) {
            textureKey = `${sp.prefix}-young-${hash(tx, ty, 0xBB) % sp.youngN}`;
          } else {
            textureKey = `${sp.prefix}-sapling-${hash(tx, ty, 0xCC) % sp.saplingN}`;
          }

          // Position with jitter so trees don't sit on a rigid grid
          const jx = ((hash(tx, ty, 0x111) % 20) - 10) * 0.6;
          const jy = ((hash(tx, ty, 0x222) % 20) - 10) * 0.6;
          const wx = tx * TILE_SIZE + TILE_SIZE / 2 + jx;
          const wy = ty * TILE_SIZE + TILE_SIZE / 2 + jy;
          const { x: isoX, y: isoY } = this.worldToIso(wx, wy);

          const tree = this.add.image(isoX, isoY, textureKey);
          tree.setOrigin(0.5, 1);
          tree.setDepth(hsIsoDepth(wx, wy));

          // Forest trees are slightly larger for a thick canopy feel
          const isMature = !textureKey.includes('young') && !textureKey.includes('sapling');
          const isSapling = textureKey.includes('sapling');
          const forestScaleBoost = blend <= 0 ? 1.15 : 1 + (1 - blend) * 0.15;
          const baseScale = isMature ? 0.55 : isSapling ? 0.3 : 0.4;
          const scaleJitter = 1 + ((hash(tx, ty, 0x333) % 20) - 10) * 0.01;
          tree.setScale(baseScale * scaleJitter * forestScaleBoost);

          // Block movement under the canopy (#934).
          const treeSize: TreeSize = isMature ? 'mature' : isSapling ? 'sapling' : 'young';
          blockTreeFootprint(this.walkGrid, this.gridW, this.gridH, tx, ty, treeSize);
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

  // ── Wildlife system ────────────────────────────────────────────────────────

  private initWildlife(): void {
    // Register wolf directional animations for the WildlifeSystem to use.
    // Animation keys follow the pattern: wolf-{action}-{dir}-anim
    // Register directional animations for all wildlife species.
    // Frame counts and rates per animation type — the spritesheet frame count varies
    // by species/template, so we detect it from the loaded texture.
    const ANIM_RATES: Record<string, number> = {
      idle: 6, walk: 8, run: 12, alert: 6, sneak: 6,
    };
    const DIRS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];

    // Re-read the wildlifeSpecs used in preload to know which species+anims were loaded
    const allSpecs = [
      { species: 'wolf', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'lynx', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'bear', anims: ['idle', 'run', 'walk', 'alert'] },
      { species: 'squirrel', anims: ['idle', 'run', 'walk', 'alert'] },
      { species: 'hedgehog', anims: ['idle', 'run', 'walk', 'alert'] },
      { species: 'elk', anims: ['idle', 'run', 'alert'] },
      { species: 'bison', anims: ['idle', 'run', 'alert'] },
      { species: 'roe-deer', anims: ['idle', 'run', 'alert'] },
      { species: 'wolverine', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'rabbit', anims: ['idle', 'run', 'walk', 'alert'] },
      { species: 'pine-marten', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'polecat', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'stoat', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'beaver', anims: ['idle', 'run', 'walk', 'alert'] },
      { species: 'wild-boar', anims: ['idle', 'run', 'walk', 'alert'] },
      { species: 'badger', anims: ['idle', 'run', 'walk', 'alert'] },
      { species: 'beech-marten', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'weasel', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'wildcat', anims: ['idle', 'run', 'walk', 'alert', 'sneak'] },
      { species: 'raccoon', anims: ['idle', 'run', 'walk', 'alert'] },
      { species: 'grass-snake', anims: ['idle', 'run', 'alert'] },
      { species: 'arctic-fox', anims: ['idle', 'run', 'alert', 'sneak'] },
      { species: 'fallow-deer', anims: ['idle', 'run', 'alert'] },
      { species: 'red-deer', anims: ['idle', 'run', 'alert'] },
      { species: 'moose', anims: ['idle', 'run'] },
    ];

    for (const { species, anims } of allSpecs) {
      for (const anim of anims) {
        const rate = ANIM_RATES[anim] ?? 6;
        for (const d of DIRS) {
          const texKey = `${species}-${anim}-${d}`;
          const animKey = `${species}-${anim}-${d}-anim`;
          if (this.textures.exists(texKey) && !this.anims.exists(animKey)) {
            // For spritesheets, Phaser already knows the frame count from the load call
            const frameCount = this.textures.get(texKey).getFrameNames(false).length;
            const frames = Array.from({ length: Math.max(1, frameCount) }, (_, i) => i);
            this.anims.create({ key: animKey, frames: this.anims.generateFrameNumbers(texKey, { frames }), frameRate: rate, repeat: -1 });
          }
        }
      }
      // Base idle-anim fallback (SE direction, used when no directional anim matches)
      const fallbackTex = `${species}-idle-se`;
      const fallbackKey = `${species}-idle-anim`;
      if (this.textures.exists(fallbackTex) && !this.anims.exists(fallbackKey)) {
        const frameCount = this.textures.get(fallbackTex).getFrameNames(false).length;
        const frames = Array.from({ length: Math.max(1, frameCount) }, (_, i) => i);
        this.anims.create({ key: fallbackKey, frames: this.anims.generateFrameNumbers(fallbackTex, { frames }), frameRate: 6, repeat: -1 });
      }
    }

    const faunaReg = this.cache.json.get('fauna-registry') as FaunaRegistryData | undefined;
    if (!faunaReg) return;

    // Iso helper that converts world-to-iso and back, matching the scene's projection.
    // WildlifeSystem uses world-space physics bodies + iso-projected visual sprites.
    const isoToWorld = (ix: number, iy: number): { x: number; y: number } => {
      // Invert worldToIso: ix = O + (tx-ty)*Tw/2, iy = (tx+ty)*Th/2
      const sum  = iy / (ISO_TILE_H / 2);               // tx + ty
      const diff = (ix - this.isoOriginX) / (ISO_TILE_W / 2); // tx - ty
      const tx = (sum + diff) / 2;
      const ty = (sum - diff) / 2;
      return { x: tx * TILE_SIZE, y: ty * TILE_SIZE };
    };

    this.wildlife = new WildlifeSystem({
      scene: this,
      faunaRegistry: faunaReg,
      worldW: this.worldW,
      worldH: this.worldH,
      tileSize: TILE_SIZE,
      worldToIso: (wx: number, wy: number) => this.worldToIso(wx, wy),
      isoToWorld,
      isoDepth: hsIsoDepth,
      // Spawn a variety of wildlife — all species with sprites
      speciesFilter: [
        'wolf', 'lynx', 'bear', 'squirrel', 'hedgehog', 'rabbit',
        'beaver', 'badger', 'raccoon', 'wildcat', 'arctic-fox',
        'pine-marten', 'beech-marten', 'polecat', 'stoat', 'weasel',
        'elk', 'bison', 'roe-deer', 'fallow-deer', 'red-deer', 'moose',
        'wolverine', 'wild-boar', 'grass-snake',
      ],
      seed: 12345,
      // Keep wolves in the homestead meadow half (tx 5-25), away from WF terrain
      spawnClearCenter: { x: 15 * TILE_SIZE, y: 15 * TILE_SIZE },
      spawnClearRadius: 80,
      // Constrain spawning to the left (homestead) half of the map
      spawnBias: (wx: number, _wy: number) => {
        const tx = wx / TILE_SIZE;
        if (tx >= 28) return 0;   // reject WF terrain half
        if (tx < 3) return 0;     // reject edge
        return 1;
      },
      // Scale override: HomesteadScene is more zoomed than GameScene,
      // so wildlife sprites need to be smaller.
      scaleOverride: 0.55,
      // Pass walkGrid so animals avoid water, cliffs, and other blocked tiles
      walkGrid: this.walkGrid,
      gridW: this.gridW,
      gridH: this.gridH,
      getEnvContext: (): WildlifeEnvContext => ({
        isRaining: false,
        season: 'summer',
        phase: 'morning',
      }),
    });
    this.wildlife.init();
    this.wildlife.spawnGroundAnimals();

    // ── NPC animations + spawning ────────────────────────────────────────
    this.initNpcs();
  }

  private initNpcs(): void {
    const DIRS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
    const ANIM_RATES: Record<string, number> = {
      idle: 6, walk: 8, run: 12, alert: 6,
      hammer: 6, dig: 6, serve: 6, gesture: 6, pray: 6,
      stir: 6, carry: 8, lookout: 6, command: 6, play: 8,
      wave: 6, brush: 6,
    };

    // NPC specs matching preload — all cultures + independents
    const NPC_LIST = [
      // Fieldborn
      'fieldborn-blacksmith', 'fieldborn-chief', 'fieldborn-child',
      'fieldborn-elder', 'fieldborn-farmer', 'fieldborn-guard',
      'fieldborn-hearthkeeper', 'fieldborn-shrine',
      // Ikibeki
      'ikibeki-barmaid', 'ikibeki-brewer', 'ikibeki-commoner',
      'ikibeki-cook', 'ikibeki-elder', 'ikibeki-farmer',
      'ikibeki-herbalist', 'ikibeki-highfang', 'ikibeki-lorekeeper',
      'ikibeki-porter', 'ikibeki-scout', 'ikibeki-smith',
      'ikibeki-stablehand', 'ikibeki-trader', 'ikibeki-warrior',
      'ikibeki-woodcutter',
      // Wallborn
      'wallborn-gate-guard',
      // Independent
      'wanderer',
    ];

    // Register animations for all loaded NPC spritesheets
    for (const npcId of NPC_LIST) {
      for (const anim of ['idle', 'walk', 'run', 'hammer', 'dig', 'serve', 'gesture', 'pray', 'stir', 'carry', 'lookout', 'command', 'play', 'alert']) {
        const rate = ANIM_RATES[anim] ?? 6;
        for (const d of DIRS) {
          const texKey = `npc-${npcId}-${anim}-${d}`;
          const animKey = `npc-${npcId}-${anim}-${d}-anim`;
          if (this.textures.exists(texKey) && !this.anims.exists(animKey)) {
            const frameCount = this.textures.get(texKey).getFrameNames(false).length;
            const frames = Array.from({ length: Math.max(1, frameCount) }, (_, i) => i);
            this.anims.create({ key: animKey, frames: this.anims.generateFrameNumbers(texKey, { frames }), frameRate: rate, repeat: -1 });
          }
        }
        // Base fallback (SE direction)
        const fallbackTex = `npc-${npcId}-${anim}-se`;
        const fallbackKey = `npc-${npcId}-${anim}-anim`;
        if (this.textures.exists(fallbackTex) && !this.anims.exists(fallbackKey)) {
          const frameCount = this.textures.get(fallbackTex).getFrameNames(false).length;
          const frames = Array.from({ length: Math.max(1, frameCount) }, (_, i) => i);
          this.anims.create({ key: fallbackKey, frames: this.anims.generateFrameNumbers(fallbackTex, { frames }), frameRate: rate, repeat: -1 });
        }
      }
    }

    // Spawn NPCs from the map's NPC entities (#1173) — simple wandering
    // villagers that idle, walk around, and play role animations.
    const entitiesLayer = this.level.entityLayers.Entities;
    if (!entitiesLayer) return;

    for (const e of entitiesOfType(entitiesLayer, 'NPC')) {
      const npcId = String(e.fields.npcId ?? '');
      const role = String(e.fields.role ?? 'idle');
      const wx = e.x;
      const wy = e.y;
      const { x: isoX, y: isoY } = this.worldToIso(wx, wy);
      const texKey = `npc-${npcId}-idle-se`;
      if (!this.textures.exists(texKey)) continue;

      const npc = this.add.sprite(isoX, isoY, texKey, 0);
      npc.setOrigin(0.5, 0.8);
      npc.setScale(0.45);
      npc.setDepth(hsIsoDepth(wx, wy));

      // Play idle animation
      const idleAnim = `npc-${npcId}-idle-se-anim`;
      if (this.anims.exists(idleAnim)) npc.play(idleAnim);

      // Store data for future NPC AI system
      npc.setData('npcId', npcId);
      npc.setData('role', role);
      npc.setData('worldX', wx);
      npc.setData('worldY', wy);
    }
  }
}
