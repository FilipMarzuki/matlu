import Phaser from 'phaser';
import VirtualJoystickPlugin from 'phaser3-rex-plugins/plugins/virtualjoystick-plugin';
import { FbmNoise } from '../lib/noise';
import { mulberry32, poissonDisk } from '../lib/rng';
import { t } from '../lib/i18n';
import { CHUNKS, CHUNK_COUNT, CHUNK_AVOID_ZONES } from '../world/ChunkDef';
import type { ChunkDef, ChunkItem } from '../world/ChunkDef';
import { generateDecorations, decorTexture } from '../world/DecorationScatter';
import { insertMatluRun } from '../lib/matluRuns';
import type VirtualJoyStick from 'phaser3-rex-plugins/plugins/virtualjoystick';
import { Decoration } from '../environment/Decoration';
import { WorldObject } from '../environment/WorldObject';
import { createSolidGroup } from '../environment/SolidObject';
import { InteractiveObject } from '../environment/InteractiveObject';
import { WorldClock } from '../world/WorldClock';
import type { DayPhase } from '../world/WorldClock';
import { WorldState } from '../world/WorldState';
import { emptyLdtkLevel } from '../world/MapData';
import type { LdtkLevel } from '../world/MapData';
import { PathSystem } from '../world/PathSystem';
import { LEVEL1_PATHS } from '../world/Level1Paths';
import { CorruptionField } from '../world/CorruptionField';
import {
  ZONES, COLLECTIBLES, MEETING_POINT, MEETING_RADIUS, PATH_CHOICES,
  meetingOpeningLine, PASSIVE_CLEANSE_RATE, PASSIVE_CLEANSE_CAP,
} from '../world/Level1';
import type { PathChoice } from '../world/Level1';
import type { NpcDialogData } from './NpcDialogScene';

const REX_VIRTUAL_JOYSTICK_PLUGIN_KEY = 'rexvirtualjoystickplugin';

// World dimensions — large enough that the camera has room to roam in attract mode
const WORLD_W = 8000;
const WORLD_H = 8000;

// Terrain tile size in pixels
const TILE_SIZE = 32;
// Noise scales: BASE drives large biome regions, DETAIL adds local colour variation
const BASE_SCALE   = 0.07;
const DETAIL_SCALE = 0.22;

// Player spawn position: center-left on the dirt path
const SPAWN_X = 400;
const SPAWN_Y = 1000;

// Player movement speed in px/s
const PLAYER_SPEED = 180;

// Player shape dimensions
const BODY_RADIUS = 16;
const INDICATOR_W = 10;
const INDICATOR_H = 6;

// Obstacle definitions: placed in the four grass quadrants, away from roads.
// Roads span cx±44 (x 356–444) and cy±44 (y 956–1044) in world space.
const OBSTACLE_DEFS: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 160, y: 870, w: 56, h: 40 },
  { x: 630, y: 885, w: 40, h: 56 },
  { x: 140, y: 1170, w: 48, h: 48 },
  { x: 640, y: 1160, w: 64, h: 36 },
  { x: 230, y: 900, w: 36, h: 36 },
];

/** FIL-9 / FIL-10: one cleanse unit per defeated rabbit */
const RABBIT_COUNT = 25;
const RABBIT_SIZE = 18;
const SPAWN_CLEAR = 320;
const CHASE_RANGE = 200;
const ROAM_SPEED = 40;
const CHASE_SPEED = 70;
const FLEE_SPEED = 120;
const FLEE_MS = 1500;
/** Speed (px/s) when player drives an animal in attract/wilderview mode — slightly below FLEE_SPEED for comfort. */
const POSSESS_SPEED = 100;
/** Milliseconds between automatic animal cycles in attract/wilderview mode. */
const ATTRACT_CYCLE_MS = 600_000;

/** FIL-8: swipe toward pointer */
const SWIPE_COOLDOWN_MS = 400;
const SWIPE_RANGE = 120;
const SWIPE_ARC = Phaser.Math.DegToRad(120);

/** FIL-11: portal in world space (Linear: ~x 2100) */
const PORTAL_X = 2100;
const PORTAL_Y = 220;
const PORTAL_RADIUS = 44;

const HUD_BAR_W = 200;
const HUD_BAR_H = 14;
const HUD_PAD = 14;

type RabbitState = 'roaming' | 'chasing' | 'fleeing';
type AnimalState = 'roaming' | 'fleeing';

interface AnimalDef {
  /** Physics body size (smaller than the visual sprite). */
  w: number; h: number;
  fleeRange: number; fleeSpeed: number; roamSpeed: number; count: number;
  /** Pixel scale applied to the 16×16 sprite to reach the desired display size. */
  scale: number;
}

const ANIMAL_DEFS: Record<string, AnimalDef> = {
  deer: { w: 22, h: 14, scale: 2.0, fleeRange: 280, fleeSpeed:  95, roamSpeed: 22, count: 18 },
  hare: { w: 12, h:  9, scale: 1.5, fleeRange: 180, fleeSpeed: 145, roamSpeed: 38, count: 28 },
  fox:  { w: 16, h: 11, scale: 2.0, fleeRange: 140, fleeSpeed:  82, roamSpeed: 30, count: 10 },
};

const BIRD_COUNT      = 30;
const BIRD_SHADOW_DX  = 7;
const BIRD_SHADOW_DY  = 5;

interface BirdObject {
  body:            Phaser.GameObjects.Sprite;
  shadow:          Phaser.GameObjects.Ellipse;
  vx:              number;
  vy:              number;
  nextDirChange:   number;
  /** True while the player is driving this bird via nav keys in attract mode. */
  playerControlled?: boolean;
}


/**
 * Maps a biome value + detail value to a background tileset frame.
 *
 * Setting: Höga Kusten (Swedish High Coast), early spring.
 * The landscape rises steeply from the Gulf of Bothnia. Biomes run from
 * open sea through rocky shore, coastal heath, and boreal forest up to
 * the bare granite of the highland summits.
 *
 * Each tileset is 384×272 with 16×16 tiles (24 cols × 17 rows).
 * Using 2–3 frame variants per biome driven by detail noise breaks up tiling.
 *
 * Biome mapping (mirrors coastal terrain breakpoints used in spawnBias):
 *   < 0.25  Bottenhavet — the Gulf of Bothnia / inland lakes
 *   < 0.33  Rocky shore — wave-smoothed granite and shingle beach
 *   < 0.48  Coastal heath — heather, crow-berries, early spring flowers
 *   < 0.65  Mixed birch-spruce forest — the main boreal belt
 *   < 0.80  Dense spruce forest — dark interior forest
 *   ≥ 0.80  Highland rock — bare granite, gnarled mountain birch
 */
function terrainTileFrame(val: number, detail: number): { key: string; frame: number } {
  // Toggle between 2 frame variants using detail noise to break up repetition
  const v = detail > 0.55 ? 1 : 0;
  if      (val < 0.25) return { key: 'terrain-water',  frame: detail > 0.65 ? 2 : detail > 0.35 ? 1 : 0 }; // sea / lake
  else if (val < 0.33) return { key: 'terrain-yellow', frame: v };      // rocky shore / shingle
  else if (val < 0.48) return { key: 'terrain-green',  frame: v };      // coastal heath (spring)
  else if (val < 0.65) return { key: 'terrain-green',  frame: v + 2 };  // mixed birch-spruce
  else if (val < 0.80) return { key: 'terrain-green',  frame: v + 4 };  // dense spruce forest
  else                 return { key: 'terrain-dark',   frame: v };      // highland granite
}

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Arc;
  private playerIndicator!: Phaser.GameObjects.Rectangle;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private playerLastDir: 'down' | 'up' | 'side' = 'down';
  private playerMoving = false;
  private joystick!: VirtualJoyStick;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private solidObjects!: Phaser.Physics.Arcade.StaticGroup;
  private interactiveObjects!: InteractiveObject[];
  worldClock!: WorldClock;
  worldState!: WorldState;
  mapData!: LdtkLevel;
  private dayNightOverlay!: Phaser.GameObjects.Rectangle;
  private currentPhase: DayPhase = 'dawn';
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;

  private rabbits!: Phaser.Physics.Arcade.Group;
  private groundAnimals!: Phaser.Physics.Arcade.Group;
  private birds: BirdObject[] = [];
  private kills = 0;
  private lastSwipeAt = 0;

  private cleanseFill!: Phaser.GameObjects.Rectangle;
  private overlay!: Phaser.GameObjects.Rectangle;
  // All HUD elements (bars + labels) collected so they can be hidden during attract mode
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  // ─── Sound ────────────────────────────────────────────────────────────────────
  // ambience loops continuously in the background once gameplay starts
  private ambienceSound: Phaser.Sound.BaseSound | undefined;
  // tracks when we last played a footstep so we don't fire every frame
  private lastFootstepAt = 0;
  private readonly FOOTSTEP_INTERVAL_MS = 380; // tune this to match your walk animation rhythm
  private portal!: Phaser.GameObjects.Arc;
  private portalActive = false;
  private portalGfx!: Phaser.GameObjects.Graphics;
  private levelCompleteLogged = false;
  private runSeed = 0;
  /** Whether the audio system is functional — false in headless CI environments */
  private audioAvailable = false;

  // ─── Corruption field ─────────────────────────────────────────────────────────
  // Per-position corruption intensity — gives corruption organic geography instead
  // of uniform zone-wide darkening. Sampled each degradation tick.
  private corruptionField!: CorruptionField;

  // ─── Path system ──────────────────────────────────────────────────────────────
  private pathSystem!: PathSystem;
  // Graphics object kept alive so drawPaths() can redraw after condition changes
  private pathGraphics!: Phaser.GameObjects.Graphics;
  // Next time (ms) we run path condition degradation — runs every 5 s
  private nextPathDegradeAt = 0;

  // ─── Terrain noise ────────────────────────────────────────────────────────────
  // Created once in create() so both drawProceduralTerrain() and stampProceduralChunks()
  // share the same instance instead of each constructing their own FbmNoise.
  private baseNoise!: FbmNoise;

  // ─── Level 1 ──────────────────────────────────────────────────────────────────
  // Semi-transparent zone tint overlays — one per zone, faded on collectible pickup
  private zoneOverlays: Map<string, Phaser.GameObjects.Rectangle> = new Map();
  // Set of collected item IDs
  private collectedItems: Set<string> = new Set();
  // Collectible circle sprites (live objects, removed on pickup)
  private collectibleSprites: Map<string, Phaser.GameObjects.Arc> = new Map();
  // Whether the parent meeting dialog has fired yet
  private meetingTriggered = false;
  // Path chosen at the end of the meeting dialog (no gameplay effect in Level 1)
  chosenPath: PathChoice | null = null;
  // How much passive cleanse has accrued from standing in Zone 3
  private passiveCleanseTotal = 0;

  // ─── Attract mode ─────────────────────────────────────────────────────────────
  private attractMode = true;
  private attractTargets: Phaser.GameObjects.GameObject[] = [];
  private attractIdx = 0;
  private attractNextAt = 0;
  private attractLabel!: Phaser.GameObjects.Text;
  private attractNameDisplay!: Phaser.GameObjects.Text;
  private attractName = '';
  private attractTitle!: Phaser.GameObjects.Text;
  private attractThoughtBubble!: Phaser.GameObjects.Text;

  // Set when the player types their name on the attract screen; used for leaderboard.
  playerName = '';

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    // Detect audio availability early — WebAudio is unavailable in headless CI.
    // We use this flag to skip all sound.play() calls and avoid Phaser internals crash.
    this.load.once('complete', () => {
      this.audioAvailable = this.cache.audio.has('forest-ambience');
    });

    // ── Audio ──────────────────────────────────────────────────────────────────
    // Phaser tries each format in order and picks the first the browser supports.
    // .ogg is smaller and preferred; .mp3 is the fallback for Safari.
    //
    // REPLACE these placeholder paths with real files from freesound.org / kenney.nl.
    // Suggested searches:
    //   forest-ambience  → freesound "forest birds morning" (CC0)
    //   footstep-grass   → kenney.nl "Impact Sounds" or freesound "footstep grass"
    //   animal-rustle    → freesound "leaves rustle" or "animal startle"
    this.load.audio('forest-ambience', [
      'assets/audio/forest-ambience.ogg',
      'assets/audio/forest-ambience.mp3',
    ]);
    // Load all 5 grass variants from the Kenney Impact Sounds pack (CC0).
    // Using multiple variants and picking one randomly each step prevents the
    // "machine gun" effect — identical sounds repeating feel unnatural.
    const grassBase = 'assets/audio/kenney_impact-sounds/Audio';
    for (let i = 0; i < 5; i++) {
      this.load.audio(`footstep-grass-${i}`, `${grassBase}/footstep_grass_00${i}.ogg`);
    }

    this.load.audio('animal-rustle', [
      'assets/audio/animal-rustle.mp3',
    ]);

    // ── Terrain tilesets (PostApocalypse background sheets, FIL-53) ──────────────
    // Three 384×272 spritesheets, 16×16 tiles (24 cols × 17 rows).
    // Used in drawProceduralTerrain() to replace flat-color blocks with textured ground.
    // Water biome has no usable free tile — stays as solid color.
    const paTiles = 'assets/packs/PostApocalypse_AssetPack_v1.1.2/Tiles';
    this.load.spritesheet('terrain-green',  `${paTiles}/Background_Green_TileSet.png`,       { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('terrain-dark',   `${paTiles}/Background_Dark-Green_TileSet.png`,   { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('terrain-yellow', `${paTiles}/Background_Bleak-Yellow_TileSet.png`, { frameWidth: 16, frameHeight: 16 });

    // ── Nature sprites (PostApocalypse AssetPack) ──────────────────────────────
    // Used by procedural scatter and chunk stamping (FIL-51/52/67).
    // Two sub-folders: Green (trees, grass, bushes) and Flowers_Mashrooms_Other.
    const pa    = 'assets/packs/PostApocalypse_AssetPack_v1.1.2/Objects/Nature';
    const paGrn = `${pa}/Green`;
    const paFMO = `${pa}/Flowers_Mashrooms_Other-nature-stuff`;

    this.load.image('tree-spruce',     `${paGrn}/Tree_1_Spruce_Green.png`);
    this.load.image('tree-spruce-2',   `${paGrn}/Tree_2_Spruce-Sparse_Green.png`);
    this.load.image('tree-normal',     `${paGrn}/Tree_3_Normal_Green.png`);
    this.load.image('tree-big',        `${paGrn}/Tree_5_Big_Green.png`);
    this.load.image('tree-pine',       `${paGrn}/Tree_6_Pine_Big_Green.png`);
    this.load.image('tree-birch',      `${paGrn}/Tree_7_Birch_Green.png`);
    this.load.image('tree-birch-2',    `${paGrn}/Tree_8_Birch_Green.png`);
    this.load.image('tree-oak-small',  `${paGrn}/Tree_9_Small-oak_Green.png`);
    this.load.image('tree-oak',        `${paGrn}/Tree_10_Small-oak_Green.png`);

    for (let i = 1; i <= 5; i++) {
      this.load.image(`grass-tuft-${i}`, `${paGrn}/Grass_${i}_Green.png`);
    }
    this.load.image('bush-1',   `${paGrn}/Bush_1_Green.png`);
    this.load.image('bush-2',   `${paGrn}/Bush_2_Green.png`);
    this.load.image('rock-grass', `${paGrn}/Rocks/Rock-grass.png`);

    this.load.image('flower-1-yellow', `${paFMO}/Flower_1_yellow.png`);
    this.load.image('flower-1-red',    `${paFMO}/Flower_1_red.png`);
    this.load.image('flower-1-blue',   `${paFMO}/Flower_1_blue.png`);
    this.load.image('flower-1-purple', `${paFMO}/Flower_1_purple.png`);
    this.load.image('mushroom',        `${paFMO}/Mushroom.png`);
    this.load.image('mushrooms-yellow',`${paFMO}/Mushrooms_1_Yellow.png`);
    this.load.image('mushrooms-red',   `${paFMO}/Mushrooms_2_Red.png`);

    const paW = `${paFMO}/Puddles-And-Water-Anim`;
    this.load.image('puddle-grass-1', `${paW}/Puddle_On-Grass_1_Grass_Green.png`);
    this.load.image('puddle-grass-2', `${paW}/Puddle_On-Grass_2_Grass_Green.png`);
    this.load.image('puddle-grass-3', `${paW}/Puddle_On-Grass_3_Grass_Green.png`);

    // ── Water terrain tiles (Mystic Woods 2.2, FIL-74) ────────────────────────────
    // water-sheet.png is 480×48 with 16×16 tiles (30 cols × 3 rows).
    // We use 3 frame variants in row 0 driven by detail noise to prevent obvious tiling.
    this.load.spritesheet('terrain-water', 'assets/packs/mystic_woods_2.2/sprites/tilesets/water-sheet.png', { frameWidth: 16, frameHeight: 16 });

    // ── Craftpix top-down animal sprites (FIL-73) ─────────────────────────────────
    // Each sheet uses 16×16 px tiles. The TMX animation data shows even-column frames
    // are the actual animation frames (0,2,4,6 for idle; 0,2,4,6,8,10 for walk).
    const craftpixBase = 'assets/packs/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/PNG/Without_shadow';
    this.load.spritesheet('deer-idle', `${craftpixBase}/Deer/Deer_Idle.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('deer-walk', `${craftpixBase}/Deer/Deer_Walk.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('hare-idle', `${craftpixBase}/Hare/Hare_Idle.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('hare-walk', `${craftpixBase}/Hare/Hare_Walk.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('fox-idle',  `${craftpixBase}/Fox/Fox_Idle.png`,   { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('fox-walk',  `${craftpixBase}/Fox/Fox_walk.png`,   { frameWidth: 16, frameHeight: 16 });
    // Black grouse flight sheet (192×128, 12 cols × 8 rows at 16×16 px) — used for all flying birds.
    this.load.spritesheet('grouse-fly', `${craftpixBase}/Black_grouse/Black_grouse_Flight.png`, { frameWidth: 16, frameHeight: 16 });

    // ── Pixel Crawler Free Pack — Body_A character sprite sheets (64×64 px frames)
    const bodyBase = 'assets/packs/Pixel Crawler - Free Pack 2.0.4/Pixel Crawler - Free Pack/Entities/Characters/Body_A/Animations';
    this.load.spritesheet('pc-idle-down', `${bodyBase}/Idle_Base/Idle_Down-Sheet.png`,  { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-idle-up',   `${bodyBase}/Idle_Base/Idle_Up-Sheet.png`,    { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-idle-side', `${bodyBase}/Idle_Base/Idle_Side-Sheet.png`,  { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-walk-down', `${bodyBase}/Walk_Base/Walk_Down-Sheet.png`,  { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-walk-up',   `${bodyBase}/Walk_Base/Walk_Up-Sheet.png`,    { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-walk-side', `${bodyBase}/Walk_Base/Walk_Side-Sheet.png`,  { frameWidth: 64, frameHeight: 64 });
  }

  create(): void {
    this.sys.game.events.on('error', (err: Error) => {
      console.error(`[${this.scene.key}]`, err);
    });

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    // Level 1 starts at dawn (FIL-37)
    this.worldClock = new WorldClock({ startPhase: 'dawn' });
    this.worldState = new WorldState(this, this.worldClock);
    // Placeholder map data — replaced by parseLdtkLevel() once LDtk export exists
    this.mapData = emptyLdtkLevel(WORLD_W, WORLD_H, TILE_SIZE);

    // Tear down WorldState when scene shuts down
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.worldState.destroy());

    this.runSeed = Math.floor(Math.random() * 0xffffffff);
    this.baseNoise = new FbmNoise(this.runSeed);
    this.corruptionField = new CorruptionField(this.runSeed);
    this.pathSystem = new PathSystem(LEVEL1_PATHS.map(s => ({ ...s })));
    this.drawProceduralTerrain();
    this.drawPaths();
    this.createObstacles();
    this.createDecorations();
    this.createSolidObjects();
    this.stampProceduralChunks();
    this.stampDecorationScatter();
    this.createInteractiveObjects();
    this.createPlayer();

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    // Zoom in so pixel-art sprites read clearly on a tablet screen.
    // At zoom 2 the viewport shows half the world area, but sprites appear twice as large.
    this.cameras.main.setZoom(2);

    const joystickPlugin = this.plugins.get(
      REX_VIRTUAL_JOYSTICK_PLUGIN_KEY
    ) as VirtualJoystickPlugin;

    const base = this.add.circle(0, 0, 50, 0x444444, 0.45);
    const thumb = this.add.circle(0, 0, 22, 0xcccccc, 0.55);

    this.joystick = joystickPlugin.add(this, {
      x: 120,
      y: this.scale.height - 120,
      radius: 50,
      base,
      thumb,
      fixed: true,
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // Open credits overlay (C key)
    this.input.keyboard?.on('keydown-C', () => {
      this.scene.pause();
      this.scene.launch('CreditsScene', this.scene.key as unknown as object);
    });

    this.rabbits = this.physics.add.group();
    this.spawnRabbits();
    this.physics.add.collider(this.rabbits, this.obstacles);

    this.createAnimalAnimations();
    this.groundAnimals = this.physics.add.group();
    this.spawnGroundAnimals();
    this.spawnBirds();

    this.createHudAndOverlay();
    this.createPortal();
    this.createLevel1Zones();
    this.createLevel1Collectibles();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.trySwipe(pointer);
      }
    });

    this.events.on('cleanse-updated', (percent: number) => {
      this.applyWorldTint(percent);
      if (percent >= 50 && !this.portalActive) {
        this.revealPortal();
        // Big cleanse milestone — slow the day cycle (world breathes out)
        this.worldClock.slowDown(30);
      }
    });

    base.setDepth(200);
    thumb.setDepth(201);

    this.createDayNightOverlay();

    // Ambient forest sound — skipped entirely when audio is unavailable (CI).
    if (this.audioAvailable && this.cache.audio.has('forest-ambience')) {
      this.ambienceSound = this.sound.add('forest-ambience', {
        loop: true,
        volume: 0.25,
      });
      this.ambienceSound.play();
    }

    this.initAttractMode();
  }

  update(time: number, delta: number): void {
    this.worldClock.update(delta);
    this.worldState.update(delta);
    this.updateDayNight();
    if (this.attractMode) {
      this.updateAttractMode(time);
    } else {
      this.updatePlayerMovement();
      this.updateLevel1(delta);
    }
    this.updateRabbits(time);
    this.updateGroundAnimals();
    this.updateBirds(time, delta);
    if (this.portalActive) {
      this.portalGfx.rotation += 0.03;
    }
    // Degrade path conditions every 5 s when corruption is above 0.
    if (time > this.nextPathDegradeAt) {
      const cleanse = this.worldState.getCleansePercent('zone-main');
      const globalCorruption01 = Math.max(0, 100 - cleanse) / 100;
      if (globalCorruption01 > 0) {
        // Sample corruptionField at each segment centre so roads inside
        // corruption hotspots degrade faster than roads in cleaner areas.
        this.pathSystem.degradeLocal((cx, cy) =>
          this.corruptionField.sample(cx, cy, globalCorruption01)
        );
        this.pathSystem.drawPaths(this.pathGraphics);
      }
      this.nextPathDegradeAt = time + 5000;
    }
  }

  /**
   * Returns a 0–1 spawn-acceptance probability for `type` at world position (wx, wy).
   *
   * Uses the same coastal gradient as drawProceduralTerrain so spawn density
   * matches the visible biome — animals in the sea would look wrong.
   * Breakpoints mirror the terrainTileFrame() biome thresholds:
   *   < 0.25  sea / lake          (nothing spawns here)
   *   < 0.33  rocky shore
   *   < 0.48  coastal heath
   *   < 0.65  mixed birch-spruce  (main forest belt)
   *   < 0.80  dense spruce
   *   ≥ 0.80  highland granite
   */
  private spawnBias(wx: number, wy: number, type: 'deer' | 'hare' | 'fox' | 'rabbit'): number {
    const raw = this.baseNoise.fbm(wx * BASE_SCALE, wy * BASE_SCALE);
    // Apply the same coastal gradient used in terrain rendering
    const coastBias = Math.pow(Math.max(0, wx / WORLD_W - 0.55), 1.8) * 2.0;
    const v = Math.max(0, raw - coastBias);
    if (v < 0.25) return 0; // never spawn in open water
    switch (type) {
      case 'deer':   return v > 0.33 && v < 0.65 ? 1.0 : 0.2;  // heath through mixed birch-spruce
      case 'hare':   return v > 0.25 && v < 0.48 ? 1.0 : 0.3;  // shore through coastal heath
      case 'fox':    return v > 0.48 && v < 0.85 ? 1.0 : 0.15; // forest belt into highland
      case 'rabbit': return v > 0.25 && v < 0.48 ? 1.0 : 0.2;  // shore through coastal heath
      default:       return 1.0;
    }
  }

  private spawnRabbits(): void {
    // Use a sub-seed so rabbits always appear at the same positions for a given runSeed.
    // Timing values (roamNext, fleeUntil) stay non-deterministic for gameplay variety.
    const rng = mulberry32(this.runSeed ^ 0xf00d1234);
    const rndBetween = (min: number, max: number): number =>
      Math.floor(rng() * (max - min + 1)) + min;

    for (let i = 0; i < RABBIT_COUNT; i++) {
      // Try up to 3 candidate positions — accept the first one whose biome matches.
      // If all 3 fail the bias check, skip this rabbit rather than forcing it into
      // the wrong terrain. In practice < 5% of slots are skipped at these settings.
      let accepted = false;
      for (let attempt = 0; attempt < 3 && !accepted; attempt++) {
        const x = rndBetween(80, WORLD_W - 80);
        const y = rndBetween(80, WORLD_H - 80);
        if (Phaser.Math.Distance.Between(x, y, SPAWN_X, SPAWN_Y) < SPAWN_CLEAR) continue;
        if (rng() >= this.spawnBias(x, y, 'rabbit')) continue;

        const r = this.add.rectangle(x, y, RABBIT_SIZE, RABBIT_SIZE, 0x4a3558);
        r.setStrokeStyle(1, 0x221122);
        this.physics.add.existing(r);
        const b = r.body as Phaser.Physics.Arcade.Body;
        b.setCollideWorldBounds(true);
        b.setDrag(40, 40);
        this.rabbits.add(r);
        r.setData('state', 'roaming' satisfies RabbitState);
        r.setData('roamNext', this.time.now + Phaser.Math.Between(1500, 3500));
        r.setData('fleeUntil', 0);
        accepted = true;
      }
    }
  }

  private updateRabbits(time: number): void {
    const px = this.player.x;
    const py = this.player.y;

    for (const child of this.rabbits.getChildren()) {
      const r = child as Phaser.GameObjects.Rectangle;
      const b = r.body as Phaser.Physics.Arcade.Body;
      const state = r.getData('state') as RabbitState;
      const fleeUntil = r.getData('fleeUntil') as number;
      const dist = Phaser.Math.Distance.Between(r.x, r.y, px, py);

      if (state === 'fleeing' && time < fleeUntil) {
        const away = Phaser.Math.Angle.Between(px, py, r.x, r.y);
        this.physics.velocityFromRotation(away, FLEE_SPEED, b.velocity);
        continue;
      }
      if (state === 'fleeing' && time >= fleeUntil) {
        r.setData('state', 'roaming' satisfies RabbitState);
        r.setData('roamNext', time + Phaser.Math.Between(1500, 3500));
      }

      let next: RabbitState = state === 'fleeing' ? 'roaming' : state;
      if (dist < CHASE_RANGE && state !== 'fleeing') {
        next = 'chasing';
      } else if (state === 'chasing' && dist > CHASE_RANGE + 40) {
        next = 'roaming';
      }

      r.setData('state', next);

      if (next === 'chasing') {
        const ang = Phaser.Math.Angle.Between(r.x, r.y, px, py);
        this.physics.velocityFromRotation(ang, CHASE_SPEED, b.velocity);
      } else if (next === 'roaming') {
        if (time > (r.getData('roamNext') as number)) {
          const wander = Phaser.Math.FloatBetween(0, Math.PI * 2);
          this.physics.velocityFromRotation(wander, ROAM_SPEED, b.velocity);
          r.setData('roamNext', time + Phaser.Math.Between(2000, 4000));
        }
      }
    }
  }

  private updatePlayerMovement(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    let dx = 0;
    let dy = 0;

    if (this.joystick.force > 10) {
      dx = Math.cos(this.joystick.rotation);
      dy = Math.sin(this.joystick.rotation);
    } else {
      const right = this.cursors.right.isDown || this.wasd['right'].isDown ? 1 : 0;
      const left = this.cursors.left.isDown || this.wasd['left'].isDown ? 1 : 0;
      const down = this.cursors.down.isDown || this.wasd['down'].isDown ? 1 : 0;
      const up = this.cursors.up.isDown || this.wasd['up'].isDown ? 1 : 0;
      dx = right - left;
      dy = down - up;
    }

    const moving = dx !== 0 || dy !== 0;

    if (moving) {
      const len = Math.sqrt(dx * dx + dy * dy);
      // Multiply base speed by the path multiplier so roads feel faster/slower.
      // Off-road returns 1.0 (no change); paved road at full condition returns 1.35.
      const speedMult = this.pathSystem.getSpeedMultiplier(this.player.x, this.player.y);
      const speed = PLAYER_SPEED * speedMult;
      body.setVelocity((dx / len) * speed, (dy / len) * speed);
    } else {
      body.setVelocity(0, 0);
    }

    // Footstep sound — fires once every FOOTSTEP_INTERVAL_MS while walking.
    // We check time.now instead of a frame counter so it stays in sync even
    // if the frame rate drops.
    if (moving && this.time.now - this.lastFootstepAt > this.FOOTSTEP_INTERVAL_MS) {
      // Pick a random variant (0–4) each step so it never sounds repetitive.
      const variant = Phaser.Math.Between(0, 4);
      const footKey = `footstep-grass-${variant}`;
      if (this.audioAvailable && this.cache.audio.has(footKey)) this.sound.play(footKey, { volume: 0.45 });
      this.lastFootstepAt = this.time.now;
    }

    // Update directional animation
    this.updatePlayerAnimation(dx, dy, moving);
  }

  private updatePlayerAnimation(dx: number, dy: number, moving: boolean): void {
    // Determine dominant direction
    let dir: 'down' | 'up' | 'side' = this.playerLastDir;
    let flipX = false;

    if (moving) {
      if (Math.abs(dy) >= Math.abs(dx)) {
        dir = dy > 0 ? 'down' : 'up';
      } else {
        dir = 'side';
        flipX = dx < 0;
      }
      this.playerLastDir = dir;
    }

    const animKey = moving ? `pc-walk-${dir}` : `pc-idle-${this.playerLastDir}`;

    if (this.playerSprite.anims.currentAnim?.key !== animKey || this.playerMoving !== moving) {
      this.playerSprite.play(animKey);
    }
    this.playerSprite.setFlipX(dir === 'side' ? flipX : false);
    this.playerMoving = moving;
  }

  private trySwipe(pointer: Phaser.Input.Pointer): void {
    if (this.attractMode) return;
    const now = this.time.now;
    if (now - this.lastSwipeAt < SWIPE_COOLDOWN_MS) {
      return;
    }
    this.lastSwipeAt = now;

    const px = this.player.x;
    const py = this.player.y;
    const aim = Math.atan2(pointer.worldY - py, pointer.worldX - px);
    const half = SWIPE_ARC / 2;

    for (const child of [...this.rabbits.getChildren()]) {
      const r = child as Phaser.GameObjects.Rectangle;
      const d = Phaser.Math.Distance.Between(px, py, r.x, r.y);
      if (d > SWIPE_RANGE) {
        continue;
      }
      const toR = Math.atan2(r.y - py, r.x - px);
      let delta = toR - aim;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > half) {
        continue;
      }
      this.applySwipeHit(r);
      break;
    }
  }

  private applySwipeHit(rabbit: Phaser.GameObjects.Rectangle): void {
    const state = rabbit.getData('state') as RabbitState;
    if (state === 'fleeing') {
      return;
    }

    if (Math.random() < 0.5) {
      this.killRabbit(rabbit);
    } else {
      const body = rabbit.body as Phaser.Physics.Arcade.Body;
      const away = Phaser.Math.Angle.Between(this.player.x, this.player.y, rabbit.x, rabbit.y);
      rabbit.setData('state', 'fleeing' satisfies RabbitState);
      rabbit.setData('fleeUntil', this.time.now + FLEE_MS);
      this.physics.velocityFromRotation(away, FLEE_SPEED, body.velocity);
    }
  }

  private killRabbit(rabbit: Phaser.GameObjects.Rectangle): void {
    const rx = rabbit.x;
    const ry = rabbit.y;
    this.spawnEnergyBurst(rx, ry, this.player.x, this.player.y);
    rabbit.destroy();
    this.kills += 1;
    const percent = (this.kills / RABBIT_COUNT) * 100;
    this.setCleanseHud(percent);
    this.events.emit('cleanse-updated', percent);
    // Also propagate through WorldState so systems can react to zone cleansing
    this.worldState.setCleansePercent('zone-main', percent);
    // Each rabbit kill nudges nearby road conditions back toward health.
    this.pathSystem.restoreNear(rx, ry, 300, 3);
    this.onZoneCleansed('rabbit', rx, ry);
  }

  private spawnEnergyBurst(sx: number, sy: number, ex: number, ey: number): void {
    const midX = (sx + ex) / 2;
    const midY = Math.min(sy, ey) - 60;
    const curve = new Phaser.Curves.CubicBezier(
      new Phaser.Math.Vector2(sx, sy),
      new Phaser.Math.Vector2(midX, midY),
      new Phaser.Math.Vector2(midX + 20, midY),
      new Phaser.Math.Vector2(ex, ey)
    );

    const count = 7;
    for (let i = 0; i < count; i++) {
      const delay = i * 45;
      const dot = this.add.circle(sx, sy, 3, 0xffffcc, 1);
      dot.setDepth(60);
      const tObj = { t: 0 };
      const isLast = i === count - 1;
      this.tweens.add({
        delay,
        targets: tObj,
        t: 1,
        duration: 420,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          const p = curve.getPoint(tObj.t);
          dot.setPosition(p.x, p.y);
        },
        onComplete: () => {
          dot.destroy();
          if (isLast) {
            this.tweens.add({
              targets: this.player,
              scaleX: 1.06,
              scaleY: 1.06,
              yoyo: true,
              duration: 90,
              onComplete: () => {
                this.player.setScale(1);
              },
            });
          }
        },
      });
    }
  }

  private createHudAndOverlay(): void {
    const w = HUD_BAR_W;
    const h = HUD_BAR_H;
    const pad = HUD_PAD;
    // Use actual viewport dimensions so HUD works at any resolution.
    const sw = this.scale.width;
    const sh = this.scale.height;

    // Collect all HUD elements so they can be hidden during attract/wilderview mode.
    this.hudObjects = [];

    this.hudObjects.push(
      this.add
        .text(pad, pad - 2, t('hud.hp'), { fontSize: '11px', color: '#ffffff' })
        .setScrollFactor(0)
        .setDepth(300),
      this.add.rectangle(pad + w / 2, pad + 10, w, h, 0x111111, 0.9).setScrollFactor(0).setDepth(299),
      this.add
        .rectangle(pad + 2, pad + 10, w - 4, h - 4, 0xff3333)
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(300),
      this.add
        .text(sw - pad - w, pad - 2, t('hud.cleanse'), { fontSize: '11px', color: '#ffffff' })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(300),
      this.add
        .rectangle(sw - pad - w / 2, pad + 10, w, h, 0x111111, 0.9)
        .setScrollFactor(0)
        .setDepth(299),
    );

    this.cleanseFill = this.add
      .rectangle(sw - pad - w + 2, pad + 10, 0, h - 4, 0xaaff66)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(300);
    this.hudObjects.push(this.cleanseFill);

    // Full-screen tint overlay — covers whatever viewport size we have.
    this.overlay = this.add
      .rectangle(sw / 2, sh / 2, sw, sh, 0x8899aa, 0.38)
      .setScrollFactor(0)
      .setDepth(50);

    this.setCleanseHud(0);
  }

  private setCleanseHud(percent: number): void {
    const inner = HUD_BAR_W - 4;
    const ratio = Phaser.Math.Clamp(percent / 100, 0, 1);
    this.cleanseFill.width = inner * ratio;
    const murky = Phaser.Display.Color.ValueToColor(0x334433);
    const bright = Phaser.Display.Color.ValueToColor(0x88ff99);
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      murky,
      bright,
      100,
      Math.floor(ratio * 100)
    );
    const hex = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    this.cleanseFill.setFillStyle(hex);
  }

  private applyWorldTint(percent: number): void {
    const ratio = Phaser.Math.Clamp(percent / 100, 0, 1);
    this.overlay.setAlpha(0.38 * (1 - ratio));
  }

  private createPortal(): void {
    this.portal = this.add.circle(PORTAL_X, PORTAL_Y, PORTAL_RADIUS, 0x6644ff, 0.35);
    this.portal.setStrokeStyle(3, 0xffffff, 0.6);
    this.portal.setAlpha(0);
    this.portal.setDepth(25);
    this.physics.add.existing(this.portal, true);
    const pb = this.portal.body as Phaser.Physics.Arcade.StaticBody;
    pb.setCircle(PORTAL_RADIUS);

    this.portalGfx = this.add.graphics({ x: PORTAL_X, y: PORTAL_Y });
    this.portalGfx.setDepth(24);

    this.physics.add.overlap(this.player, this.portal, () => {
      if (!this.portalActive || this.levelCompleteLogged) {
        return;
      }
      this.levelCompleteLogged = true;
      console.log(`[Level complete] seed=${this.runSeed} kills=${this.kills}`);
      // Save run to Supabase — fire-and-forget, failures are non-critical
      insertMatluRun({
        nickname: this.playerName || 'Player',
        score:    this.kills,
      }).catch(() => {/* Supabase not configured — ignore */});
    });
  }

  private revealPortal(): void {
    this.portalActive = true;
    this.drawPortalRing();
    this.tweens.add({
      targets: this.portal,
      alpha: 1,
      duration: 900,
      ease: 'Sine.easeOut',
    });
  }

  private drawPortalRing(): void {
    this.portalGfx.clear();
    this.portalGfx.lineStyle(4, 0xaa77ff, 0.9);
    this.portalGfx.strokeCircle(0, 0, PORTAL_RADIUS + 6);
  }

  // ─── Day/Night cycle (FIL-37) ───────────────────────────────────────────────

  private createDayNightOverlay(): void {
    // Full-world rectangle sitting above all world objects but below HUD
    this.dayNightOverlay = this.add
      .rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x000000, 0)
      .setDepth(48)
      .setScrollFactor(1);
    // Apply the initial phase immediately (no tween on first frame)
    const ov = this.worldClock.overlay;
    const colour = Phaser.Display.Color.GetColor(ov.r, ov.g, ov.b);
    this.dayNightOverlay.setFillStyle(colour, ov.alpha);
    this.currentPhase = this.worldClock.phase;
  }

  private updateDayNight(): void {
    const newPhase = this.worldClock.phase;
    if (newPhase === this.currentPhase) return;
    this.currentPhase = newPhase;

    const ov = this.worldClock.overlay;
    const colour = Phaser.Display.Color.GetColor(ov.r, ov.g, ov.b);
    this.dayNightOverlay.setFillStyle(colour);
    this.tweens.add({
      targets: this.dayNightOverlay,
      alpha: ov.alpha,
      duration: 8000,
      ease: 'Sine.easeInOut',
    });
  }

  protected onZoneCleansed(_type: string, _x: number, _y: number): void {
    // Hook for subclasses / future telemetry (Better Stack, etc.)
  }

  protected onFsmTransition(_oldState: string, _newState: string): void {
    // Hook for subclasses
  }

  protected onHeightBlocked(_diff: number, _toX: number, _toY: number): void {
    // Hook for subclasses
  }

  /**
   * Place interactive trees that shake when the player touches them (FIL-30).
   * Uses the same placeholder texture as solid trees.
   */
  private createInteractiveObjects(): void {
    const ensureTexture = (key: string, w: number, h: number, colour: number): void => {
      if (!this.textures.exists(key)) {
        const rt = this.add.renderTexture(0, 0, w, h);
        rt.fill(colour, 1);
        rt.saveTexture(key);
        rt.destroy();
      }
    };
    ensureTexture('tree-interactive', 24, 40, 0x3a7a28);

    const shakingTreeDefs = [
      { x: 460, y: 760 },
      { x: 460, y: 1250 },
    ];

    this.interactiveObjects = shakingTreeDefs.map(({ x, y }) => {
      const tree = new InteractiveObject(this, x, y, 'tree-interactive', {
        trigger: 'player-touch',
        colliderWidth: 10,
        colliderHeight: 8,
        colliderOffsetY: -2,
      });
      this.physics.add.existing(tree, true);
      const body = tree.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(tree.colliderWidth, tree.colliderHeight);
      body.setOffset(
        (tree.displayWidth - tree.colliderWidth) / 2,
        tree.displayHeight - tree.colliderHeight - 2,
      );
      return tree;
    });
  }

  private createPlayer(): void {
    // Register directional animations from Pixel Crawler Free Pack Body_A sheets
    this.anims.create({ key: 'pc-idle-down', frames: this.anims.generateFrameNumbers('pc-idle-down', {}), frameRate: 6, repeat: -1 });
    this.anims.create({ key: 'pc-idle-up',   frames: this.anims.generateFrameNumbers('pc-idle-up',   {}), frameRate: 6, repeat: -1 });
    this.anims.create({ key: 'pc-idle-side', frames: this.anims.generateFrameNumbers('pc-idle-side', {}), frameRate: 6, repeat: -1 });
    this.anims.create({ key: 'pc-walk-down', frames: this.anims.generateFrameNumbers('pc-walk-down', {}), frameRate: 9, repeat: -1 });
    this.anims.create({ key: 'pc-walk-up',   frames: this.anims.generateFrameNumbers('pc-walk-up',   {}), frameRate: 9, repeat: -1 });
    this.anims.create({ key: 'pc-walk-side', frames: this.anims.generateFrameNumbers('pc-walk-side', {}), frameRate: 9, repeat: -1 });

    this.playerSprite = this.add.sprite(0, 0, 'pc-idle-down');
    this.playerSprite.setScale(1);
    this.playerSprite.play('pc-idle-down');

    // Invisible circle + indicator kept for physics sizing / pointer aim
    this.playerBody = this.add.circle(0, 0, 1, 0x000000, 0);
    this.playerIndicator = this.add.rectangle(BODY_RADIUS + INDICATOR_W / 2, 0, INDICATOR_W, INDICATOR_H, 0xffffff, 0);

    this.player = this.add.container(SPAWN_X, SPAWN_Y, [this.playerSprite, this.playerBody, this.playerIndicator]);
    this.player.setSize(BODY_RADIUS * 2, BODY_RADIUS * 2);
    this.player.setDepth(10);

    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    body.setCircle(BODY_RADIUS);

    this.physics.add.collider(this.player, this.obstacles);
    // Register solid-objects collider here (not in createSolidObjects) because
    // this.player is undefined until createPlayer() runs.
    this.physics.add.collider(this.player, this.solidObjects);

    // Wire interactive object overlaps
    for (const obj of this.interactiveObjects) {
      if (obj.interactionTrigger === 'player-touch') {
        this.physics.add.overlap(this.player, obj, () => obj.react());
      }
    }
  }

  private createObstacles(): void {
    this.obstacles = this.physics.add.staticGroup();

    for (const def of OBSTACLE_DEFS) {
      // rock-grass.png is 13×9 px. Scale 4.5 → ~58×40 px boulder, readable at zoom 2.
      // The StaticGroup auto-sizes the physics body to displayWidth × displayHeight,
      // so collision coverage matches what the player sees without any manual setSize().
      // Depth = def.y follows the scene's y-sorting convention (further down = in front).
      const rock = this.add.image(def.x, def.y, 'rock-grass')
        .setScale(4.5)
        .setDepth(def.y);
      this.obstacles.add(rock);
    }

    this.obstacles.refresh();
  }

  /**
   * Place placeholder Decoration objects in the four grass quadrants.
   * Textures will be replaced with real sprites when assets are ready —
   * for now we use Phaser's built-in '__WHITE' texture tinted to colour.
   *
   * Three decoration types as placeholders:
   *   flower  — small pink circle (8×8)
   *   rock    — grey square (12×12)
   *   grass   — thin green rect (4×14)
   */
  private createDecorations(): void {
    // [x, y, type] — spread across grass areas away from roads (cx 400, cy 1000)
    const defs: Array<[number, number, 'flower' | 'rock' | 'grass']> = [
      [120, 780, 'flower'], [200, 820, 'grass'],  [300, 750, 'rock'],
      [560, 800, 'flower'], [680, 760, 'grass'],  [750, 850, 'rock'],
      [100, 1200, 'rock'],  [220, 1250, 'grass'], [350, 1180, 'flower'],
      [580, 1220, 'grass'], [700, 1180, 'rock'],  [760, 1240, 'flower'],
    ];

    const colourMap = { flower: 0xff88cc, rock: 0x8a8a8a, grass: 0x4ab84a };
    const sizeMap  = { flower: [8, 8],   rock: [12, 12],  grass: [4, 14] };

    for (const [x, y, type] of defs) {
      // Decoration extends Phaser.GameObjects.Sprite which requires a texture.
      // We generate a tiny coloured RenderTexture as the stand-in sprite.
      const [w, h] = sizeMap[type];
      const key = `dec-${type}`;
      if (!this.textures.exists(key)) {
        const rt = this.add.renderTexture(0, 0, w, h);
        rt.fill(colourMap[type], 1);
        rt.saveTexture(key);
        rt.destroy();
      }
      const dec = new Decoration(this, x, y, key);
      dec.sortDepth();
    }

    // Keep TypeScript happy — WorldObject is imported for future use
    void (WorldObject);
  }

  /**
   * Place placeholder SolidObject trees and rocks in the grass quadrants.
   * Uses tinted RenderTextures as stand-ins until real sprites are ready.
   * Collision boxes are narrow (trunk only) so the player can walk behind trees.
   */
  private createSolidObjects(): void {
    // Generate placeholder textures on first call
    const ensureTexture = (key: string, w: number, h: number, colour: number): void => {
      if (!this.textures.exists(key)) {
        const rt = this.add.renderTexture(0, 0, w, h);
        rt.fill(colour, 1);
        rt.saveTexture(key);
        rt.destroy();
      }
    };
    ensureTexture('tree-placeholder', 24, 40, 0x2d5c1e);  // dark green
    ensureTexture('rock-placeholder', 18, 14, 0x7a7265);  // grey

    const treeDefs = [
      { x: 180, y: 720 }, { x: 320, y: 680 }, { x: 520, y: 700 }, { x: 700, y: 730 },
      { x: 140, y: 1300 }, { x: 280, y: 1350 }, { x: 560, y: 1310 }, { x: 720, y: 1280 },
    ];
    const rockDefs = [
      { x: 240, y: 800 }, { x: 660, y: 810 },
      { x: 200, y: 1230 }, { x: 640, y: 1260 },
    ];

    this.solidObjects = createSolidGroup(this, [
      ...treeDefs.map(p => ({ ...p, texture: 'tree-placeholder', options: { colliderWidth: 10, colliderHeight: 8, colliderOffsetY: -2 } })),
      ...rockDefs.map(p => ({ ...p, texture: 'rock-placeholder', options: { colliderWidth: 16, colliderHeight: 10 } })),
    ]);
    // Collider with player registered in createPlayer() after this.player is initialized.
  }

  // ─── Attract mode ─────────────────────────────────────────────────────────────

  private initAttractMode(): void {
    // Hide player and disable its physics body until gameplay starts
    this.player.setAlpha(0);
    (this.player.body as Phaser.Physics.Arcade.Body).setEnable(false);

    // Mix birds (first) and ground animals so Wilderview always opens on a bird in flight.
    const birdBodies = this.birds.map(b => b.body);
    const groundBodies = this.groundAnimals.getChildren() as Phaser.GameObjects.GameObject[];
    this.attractTargets = [
      ...Phaser.Utils.Array.Shuffle(birdBodies),
      ...Phaser.Utils.Array.Shuffle(groundBodies),
    ];

    // Start camera following the first bird immediately — no initial pan from world centre.
    if (this.attractTargets.length > 0) {
      this.cameras.main.startFollow(
        this.attractTargets[0] as Phaser.GameObjects.GameObject,
        true, 0.06, 0.06,
      );
    }
    this.attractNextAt = this.time.now + ATTRACT_CYCLE_MS;

    // Hide HUD bars — they belong to gameplay, not the wilderview screen.
    for (const obj of this.hudObjects) {
      (obj as Phaser.GameObjects.GameObject & { setVisible: (v: boolean) => void }).setVisible(false);
    }

    const cx = this.scale.width / 2;
    const by = this.scale.height - 20;

    // Static title at the top of the wilderview screen.
    this.attractTitle = this.add
      .text(cx, 18, 'matlu wilderview', {
        fontSize: '16px',
        color: '#ffffffb3',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(500);

    // Thought bubble — shows the focused animal's type and state just below the title.
    // Text is updated every frame in updateThoughtBubble().
    this.attractThoughtBubble = this.add
      .text(cx, 46, '', {
        fontSize: '13px',
        color: '#ffffff',
        backgroundColor: '#00000066',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(500);

    // Prompt label above the input field
    this.attractLabel = this.add
      .text(cx, by - 46, t('attract.tap_to_play'), {
        fontSize: '15px',
        color: '#ffffff',
        backgroundColor: '#00000066',
        padding: { x: 14, y: 7 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(500);

    // Shows the characters the player has typed so far, with a blinking cursor
    this.attractName = '';
    this.attractNameDisplay = this.add
      .text(cx, by, '_', {
        fontSize: '22px',
        color: '#ffe066',
        backgroundColor: '#00000099',
        padding: { x: 18, y: 8 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(500);

    this.tweens.add({
      targets: this.attractLabel,
      alpha: 0.5,
      duration: 900,
      yoyo: true,
      repeat: -1,
    });

    // Capture typed characters; ENTER starts the game when a name has been entered.
    this.input.keyboard?.on('keydown', this.onAttractKey, this);
  }

  /**
   * Handles keystrokes during attract mode.
   *
   * Mapped keys:
   *   - Printable single chars  → append to player name (max 20)
   *   - Backspace               → remove last name character
   *   - Enter                   → submit name and start game
   *   - Arrow / WASD            → drive the focused animal (handled in updateAttractControl)
   *
   * Any key that falls outside these mappings immediately cycles to the next animal.
   */
  private onAttractKey(event: KeyboardEvent): void {
    if (!this.attractMode) return;

    // Arrow keys drive the focused animal via isDown polling in updateAttractControl.
    // They should not append to the name or trigger a cycle — just fall through silently.
    // WASD are printable single chars so they fall into the name-append branch below;
    // movement still happens because updateAttractControl polls isDown every frame.
    const isArrowKey = event.key === 'ArrowUp' || event.key === 'ArrowDown'
                    || event.key === 'ArrowLeft' || event.key === 'ArrowRight';

    if (event.key === 'Enter') {
      if (this.attractName.length > 0) this.exitAttractMode();
    } else if (event.key === 'Backspace') {
      this.attractName = this.attractName.slice(0, -1);
    } else if (event.key.length === 1 && this.attractName.length < 20) {
      this.attractName += event.key;
    } else if (!isArrowKey) {
      // Non-printable, non-arrow key — cycle to the next animal.
      this.cycleAttractTarget(this.time.now);
    }

    // Show current input with a cursor placeholder
    this.attractNameDisplay.setText(this.attractName + '_');
  }

  private updateAttractMode(time: number): void {
    // Update thought bubble every frame with the current animal's live state.
    this.updateThoughtBubble();
    // Allow player to drive the focused animal via nav keys.
    this.updateAttractControl();

    if (time < this.attractNextAt || this.attractTargets.length === 0) return;
    this.cycleAttractTarget(time);
  }

  /**
   * Advances the wilderview to the next animal in the list and resets the dwell timer.
   * Called by the auto-cycle timer and by unmapped key presses.
   */
  private cycleAttractTarget(time: number): void {
    if (this.attractTargets.length === 0) return;
    // Release possession on the current target before moving on.
    this.releaseAttractControl();
    this.attractIdx = (this.attractIdx + 1) % this.attractTargets.length;
    this.cameras.main.startFollow(
      this.attractTargets[this.attractIdx] as Phaser.GameObjects.GameObject,
      true, 0.03, 0.03,
    );
    this.attractNextAt = time + ATTRACT_CYCLE_MS;
  }

  /**
   * Called every frame during attract mode.
   * If a navigation key (arrow or WASD) is held, the player drives the focused animal.
   * The moment all nav keys are released the animal immediately resumes its own AI.
   *
   * Speed is tuned to feel responsive without being faster than the animal normally flees.
   */
  private updateAttractControl(): void {
    if (!this.attractMode || this.attractTargets.length === 0) return;

    const right = (this.cursors.right.isDown || this.wasd['right'].isDown) ? 1 : 0;
    const left  = (this.cursors.left.isDown  || this.wasd['left'].isDown)  ? 1 : 0;
    const down  = (this.cursors.down.isDown  || this.wasd['down'].isDown)  ? 1 : 0;
    const up    = (this.cursors.up.isDown    || this.wasd['up'].isDown)    ? 1 : 0;

    const target = this.attractTargets[this.attractIdx];

    if (!right && !left && !down && !up) {
      // No nav input — hand control back to AI.
      this.releaseAttractControl();
      return;
    }

    // Player is actively driving the focused animal.
    const dx = right - left;
    const dy = down - up;

    const s = target as Phaser.GameObjects.Sprite;
    if (s.getData('animalState') === 'flying') {
      // Bird — steer by setting vx/vy directly (birds aren't in the physics group).
      const bird = this.birds.find(b => b.body === s);
      if (bird) {
        bird.vx = dx * POSSESS_SPEED;
        bird.vy = dy * POSSESS_SPEED;
        // Suppress the autonomous direction-nudge while the player steers.
        bird.nextDirChange = this.time.now + 500;
        bird.playerControlled = true;
      }
    } else {
      // Ground animal — steer via physics body.
      const body = s.body as Phaser.Physics.Arcade.Body;
      const type = s.getData('animalType') as string;
      body.setVelocity(dx * POSSESS_SPEED, dy * POSSESS_SPEED);
      // Flip the sprite so it faces the direction of travel.
      if (dx !== 0) s.setFlipX(dx < 0);
      s.setData('playerControlled', true);
      // Keep the walk animation running while the player drives.
      if (!s.anims.isPlaying || s.anims.currentAnim?.key !== `${type}-walk-anim`) {
        s.play(`${type}-walk-anim`);
      }
    }
  }

  /** Clears the player-control flag on whichever target is currently focused. */
  private releaseAttractControl(): void {
    if (this.attractTargets.length === 0) return;
    const target = this.attractTargets[this.attractIdx];
    const s = target as Phaser.GameObjects.Sprite;
    if (s.getData('animalState') === 'flying') {
      const bird = this.birds.find(b => b.body === s);
      if (bird) bird.playerControlled = false;
    } else {
      if (s.getData('playerControlled') as boolean) {
        s.setData('playerControlled', false);
        const type = s.getData('animalType') as string;
        // Return to idle animation; AI will switch to walk again if needed.
        s.play(`${type}-idle-anim`);
      }
    }
  }

  /**
   * Reads the focused animal's type and state from its Phaser data store and
   * updates the thought bubble text at the top of the screen.
   * Called every frame during attract mode so it reacts immediately to state changes.
   */
  private updateThoughtBubble(): void {
    if (this.attractTargets.length === 0) return;
    const target = this.attractTargets[this.attractIdx] as Phaser.GameObjects.GameObject;
    const type  = (target.getData('animalType')  as string | undefined) ?? 'animal';
    const state = (target.getData('animalState') as string | undefined) ?? 'roaming';

    // Map internal state identifiers to readable descriptions.
    const stateLabel: Record<string, string> = {
      roaming:  'looking for food',
      fleeing:  'fleeing!',
      chasing:  'chasing',
      flying:   'soaring',
    };

    this.attractThoughtBubble.setText(`${type} — ${stateLabel[state] ?? state}`);
  }

  private exitAttractMode(): void {
    if (!this.attractMode) return;
    this.attractMode = false;
    this.playerName = this.attractName || 'Player';
    this.input.keyboard?.off('keydown', this.onAttractKey, this);
    this.attractLabel.destroy();
    this.attractNameDisplay.destroy();
    this.attractTitle.destroy();
    this.attractThoughtBubble.destroy();
    // Restore HUD bars now that gameplay is starting.
    for (const obj of this.hudObjects) {
      (obj as Phaser.GameObjects.GameObject & { setVisible: (v: boolean) => void }).setVisible(true);
    }
    this.player.setAlpha(1);
    (this.player.body as Phaser.Physics.Arcade.Body).setEnable(true);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
  }

  // ─── Ground animals (deer, hare, fox) ────────────────────────────────────────

  /**
   * Register Phaser animations for all ground animal sprites (FIL-73).
   *
   * The craftpix spritesheet layout (from the Tiled TMX metadata):
   *   - Each sheet has 8 or 12 columns of 16×16 tiles.
   *   - Even-indexed columns (0,2,4,…) are the actual animation frames;
   *     odd columns carry supplemental data (e.g. highlight layer) that we skip.
   *   - Idle sheets (128×128): 4 frames → cols 0,2,4,6
   *   - Walk sheets (160–192×128): 6 frames → cols 0,2,4,6,8,10
   */
  private createAnimalAnimations(): void {
    const defs: Array<[key: string, texture: string, frames: number[], frameRate: number]> = [
      ['deer-idle-anim', 'deer-idle', [0, 2, 4, 6],          6],
      ['deer-walk-anim', 'deer-walk', [0, 2, 4, 6, 8, 10],   8],
      ['hare-idle-anim', 'hare-idle', [0, 2, 4, 6],         8],
      // Hare_Walk.png is 160×128 (10 cols) so only 5 even-column frames fit in row 0.
      // Deer/fox walk sheets are 192px wide (12 cols) and can hold 6.
      ['hare-walk-anim', 'hare-walk', [0, 2, 4, 6, 8],    12],
      ['fox-idle-anim',  'fox-idle',  [0, 2, 4, 6],          6],
      ['fox-walk-anim',  'fox-walk',  [0, 2, 4, 6, 8, 10],   8],
      // Black grouse flight — even-numbered frames from row 0 of the 192×128 sheet.
      ['grouse-fly-anim', 'grouse-fly', [0, 2, 4, 6, 8, 10], 10],
    ];
    for (const [key, texture, frames, frameRate] of defs) {
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(texture, { frames }),
        frameRate,
        repeat: -1,
      });
    }
  }

  /**
   * Spawn ground animals using cluster-based Poisson disk sampling.
   *
   * Instead of placing animals one-by-one at random positions (which looks
   * artificial), we first pick cluster centres and then scatter each cluster's
   * animals with Poisson disk sampling. This mimics real animal behaviour:
   *   - Deer move in herds — 3–5 tight clusters of 4–7 animals
   *   - Hares live in warrens — 8–12 dense colonies of 3–5
   *   - Foxes are solitary — placed individually, minDist 300px apart
   *
   * Each cluster centre is also filtered through spawnBias() (FIL-61) so herds
   * appear in ecologically plausible terrain even before individual points are placed.
   */
  private spawnGroundAnimals(): void {
    const rng = mulberry32(this.runSeed ^ 0xa1b2c3d4);
    const rndBetween = (lo: number, hi: number): number =>
      Math.floor(rng() * (hi - lo + 1)) + lo;

    // ── Cluster config per species ─────────────────────────────────────────────
    // clusters: how many herds/warrens to place
    // perCluster: animals per herd [min, max]
    // clusterR: Poisson minDist within a cluster (tight or loose?)
    // clusterMinDist: minimum distance between cluster centres
    const CLUSTER_CONFIG: Record<string, {
      clusters: [number, number];
      perCluster: [number, number];
      clusterR: number;
      clusterMinDist: number;
    }> = {
      deer: { clusters: [3, 5],  perCluster: [4, 7], clusterR: 60,  clusterMinDist: 600 },
      hare: { clusters: [8, 12], perCluster: [3, 5], clusterR: 30,  clusterMinDist: 300 },
      fox:  { clusters: [1, 1],  perCluster: [1, 1], clusterR: 300, clusterMinDist: 300 },
      // fox: one "cluster" of 1 — effectively solo placement with Poisson spacing
    };

    for (const [type, def] of Object.entries(ANIMAL_DEFS)) {
      const biasType = type as 'deer' | 'hare' | 'fox';
      const cfg = CLUSTER_CONFIG[type];
      if (!cfg) continue;

      const numClusters = rndBetween(cfg.clusters[0], cfg.clusters[1]);

      // For foxes, run a single Poisson field across the whole world so they
      // maintain territory spacing. For herding animals, pick cluster centres
      // first, then scatter individuals within each cluster.
      if (type === 'fox') {
        // Global Poisson field, one point per fox
        const totalFoxes = def.count;
        const foxPoints = poissonDisk(rng, WORLD_W - 160, WORLD_H - 160, cfg.clusterR, totalFoxes * 3);
        let placed = 0;
        for (const pt of foxPoints) {
          if (placed >= totalFoxes) break;
          const x = pt.x + 80;
          const y = pt.y + 80;
          if (Phaser.Math.Distance.Between(x, y, SPAWN_X, SPAWN_Y) < SPAWN_CLEAR) continue;
          if (rng() >= this.spawnBias(x, y, biasType)) continue;
          this.placeGroundAnimal(type, def, x, y);
          placed++;
        }
      } else {
        // Pick cluster centres, then Poisson-scatter animals within each cluster
        const clusterCentres = poissonDisk(rng, WORLD_W - 400, WORLD_H - 400, cfg.clusterMinDist, numClusters * 4);
        let clustersPlaced = 0;

        for (const centre of clusterCentres) {
          if (clustersPlaced >= numClusters) break;
          const cx = centre.x + 200;
          const cy = centre.y + 200;

          // Reject cluster centres in the wrong biome or near spawn
          if (Phaser.Math.Distance.Between(cx, cy, SPAWN_X, SPAWN_Y) < SPAWN_CLEAR + 100) continue;
          if (this.spawnBias(cx, cy, biasType) < 0.5) continue;

          const clusterSize = rndBetween(cfg.perCluster[0], cfg.perCluster[1]);
          // Poisson disk within a small area around the cluster centre
          const clusterArea = cfg.clusterR * 4;
          const localPoints = poissonDisk(rng, clusterArea, clusterArea, cfg.clusterR, clusterSize * 3);

          let animalCount = 0;
          for (const lp of localPoints) {
            if (animalCount >= clusterSize) break;
            const x = cx + lp.x - clusterArea / 2;
            const y = cy + lp.y - clusterArea / 2;
            if (x < 80 || x > WORLD_W - 80 || y < 80 || y > WORLD_H - 80) continue;
            this.placeGroundAnimal(type, def, x, y);
            animalCount++;
          }
          clustersPlaced++;
        }
      }
    }
  }

  /**
   * Create a single ground animal sprite at world position (x, y).
   * Uses craftpix 16×16 pixel-art sheets (FIL-73), scaled up to def.scale × 16px.
   * The physics body is set to def.w × def.h so collisions feel tight despite
   * the larger visual.
   */
  private placeGroundAnimal(type: string, def: AnimalDef, x: number, y: number): void {
    const sprite = this.add.sprite(x, y, `${type}-idle`, 0);
    sprite.setScale(def.scale);
    sprite.setDepth(3);
    sprite.play(`${type}-idle-anim`);
    this.physics.add.existing(sprite);
    const b = sprite.body as Phaser.Physics.Arcade.Body;
    b.setCollideWorldBounds(true);
    b.setDrag(60, 60);
    // Keep the physics body compact so it matches the logical animal size
    b.setSize(def.w, def.h);
    this.groundAnimals.add(sprite);
    sprite.setData('animalType', type);
    sprite.setData('animalState', 'roaming' satisfies AnimalState);
    sprite.setData('roamNext', this.time.now + Phaser.Math.Between(2000, 6000));
  }

  private updateGroundAnimals(): void {
    const px = this.player.x;
    const py = this.player.y;

    for (const child of this.groundAnimals.getChildren()) {
      // Ground animals are now sprites (FIL-73); cast accordingly.
      const r  = child as Phaser.GameObjects.Sprite;
      const b  = r.body as Phaser.Physics.Arcade.Body;
      const type = r.getData('animalType') as string;
      const def  = ANIMAL_DEFS[type];
      // While the player is driving this animal in attract mode, skip AI entirely.
      if (r.getData('playerControlled') as boolean) continue;
      const dist = Phaser.Math.Distance.Between(r.x, r.y, px, py);
      let state  = r.getData('animalState') as AnimalState;
      // Remember state before this frame so we can detect the transition below.
      const prevState = state;

      if (dist < def.fleeRange) {
        state = 'fleeing';
        r.setData('animalState', state);
        // Play rustle only on the frame the animal starts fleeing, not every frame.
        // This is the "state transition" pattern: prev was not fleeing, now it is.
        if (prevState !== 'fleeing') {
          if (this.audioAvailable && this.cache.audio.has('animal-rustle')) this.sound.play('animal-rustle', { volume: 0.5 });
          // Switch to walk animation when fleeing starts — faster-looking movement.
          r.play(`${type}-walk-anim`);
        }
      } else if (state === 'fleeing' && dist > def.fleeRange + 80) {
        state = 'roaming';
        r.setData('animalState', state);
        r.setData('roamNext', this.time.now + Phaser.Math.Between(2000, 5000));
        // Return to idle animation once safely away from the player.
        r.play(`${type}-idle-anim`);
      }

      if (state === 'fleeing') {
        const away = Phaser.Math.Angle.Between(px, py, r.x, r.y);
        this.physics.velocityFromRotation(away, def.fleeSpeed, b.velocity);
      } else if (this.time.now > (r.getData('roamNext') as number)) {
        // Sample 4 candidate directions and pick the one with the highest path
        // affinity score. This makes animals naturally gravitate toward animal
        // trails (+1) and avoid paved roads (−1) without explicit waypoints.
        let bestAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        let bestScore = -Infinity;
        for (let c = 0; c < 4; c++) {
          const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
          const tx = r.x + Math.cos(a) * 80;
          const ty = r.y + Math.sin(a) * 80;
          const score = this.pathSystem.getAffinityScore(tx, ty) + Math.random() * 0.4;
          if (score > bestScore) { bestScore = score; bestAngle = a; }
        }
        this.physics.velocityFromRotation(bestAngle, def.roamSpeed, b.velocity);
        r.setData('roamNext', this.time.now + Phaser.Math.Between(3000, 8000));
      }
    }
  }

  // ─── Birds ────────────────────────────────────────────────────────────────────

  private spawnBirds(): void {
    for (let i = 0; i < BIRD_COUNT; i++) {
      const x = Phaser.Math.Between(50, WORLD_W - 50);
      const y = Phaser.Math.Between(50, WORLD_H - 50);

      const isCrow = i < 4;          // first 4 are crow-sized, rest are small songbirds
      // Shadow dimensions match the approximate visual footprint at each scale.
      const w = isCrow ? 10 : 6;
      const h = isCrow ?  5 : 3;

      const shadow = this.add.ellipse(x + BIRD_SHADOW_DX, y + BIRD_SHADOW_DY, w, h, 0x000000, 0.2);
      shadow.setDepth(1);

      // Replace the old ellipse with a sprite using the black grouse flight sheet.
      // Crows are drawn at 0.7× scale (~11 px), songbirds at 0.45× (~7 px) —
      // small enough to read as distant birds without overwhelming the landscape.
      const scale = isCrow ? 0.7 : 0.45;
      const body  = this.add.sprite(x, y, 'grouse-fly', 0);
      body.setScale(scale);
      body.setDepth(7);
      // Tag so the Wilderview thought bubble can identify and describe the bird.
      // animalState 'flying' also distinguishes birds from ground animals in attract mode.
      body.setData('animalType', isCrow ? 'crow' : 'songbird');
      body.setData('animalState', 'flying');
      body.play('grouse-fly-anim');

      const speed = Phaser.Math.Between(55, 95);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);

      this.birds.push({
        body, shadow,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        nextDirChange: this.time.now + Phaser.Math.Between(6000, 14000),
      });
    }
  }

  private updateBirds(time: number, delta: number): void {
    const dt = delta / 1000;

    for (const bird of this.birds) {
      // Gently nudge direction every so often — birds don't fly perfectly straight.
      // Skip this when the player is steering the bird in attract mode.
      if (!bird.playerControlled && time > bird.nextDirChange) {
        const speed    = Math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy);
        const newAngle = Math.atan2(bird.vy, bird.vx) + Phaser.Math.FloatBetween(-0.5, 0.5);
        bird.vx = Math.cos(newAngle) * speed;
        bird.vy = Math.sin(newAngle) * speed;
        bird.nextDirChange = time + Phaser.Math.Between(6000, 14000);
      }

      let nx = bird.body.x + bird.vx * dt;
      let ny = bird.body.y + bird.vy * dt;

      // Bounce off world edges
      if (nx < 40 || nx > WORLD_W - 40) { bird.vx = -bird.vx; nx = Phaser.Math.Clamp(nx, 40, WORLD_W - 40); }
      if (ny < 40 || ny > WORLD_H - 40) { bird.vy = -bird.vy; ny = Phaser.Math.Clamp(ny, 40, WORLD_H - 40); }

      bird.body.setPosition(nx, ny);
      bird.shadow.setPosition(nx + BIRD_SHADOW_DX, ny + BIRD_SHADOW_DY);
      // Flip the sprite so it always faces the direction it's flying.
      if (bird.vx !== 0) bird.body.setFlipX(bird.vx < 0);
    }
  }

  /**
   * Generates and draws a noise-based spring-Sweden landscape:
   * open meadows, forest patches, small ponds, and a dirt clearing at spawn.
   * Uses this.runSeed for deterministic output (same seed → same map).
   */
  private drawProceduralTerrain(): void {
    const noise    = this.baseNoise;
    const detNoise = new FbmNoise(this.runSeed ^ 0xb5ad4ecb);

    const tilesX = Math.ceil(WORLD_W / TILE_SIZE);
    const tilesY = Math.ceil(WORLD_H / TILE_SIZE);

    // All tiles (including water) are drawn into a pre-baked RenderTexture so the
    // entire terrain costs one GPU draw call at runtime — ~100× faster than per-tile flushes.
    // We use beginDraw() + batchDraw() + endDraw() to flush the WebGL batch only ONCE.
    const terrainRt = this.add.renderTexture(0, 0, WORLD_W, WORLD_H).setDepth(0);

    // Reuse a single off-screen Image to draw scaled (32×32) tiles from the
    // 16×16 tileset frames. setTexture() + setPosition() change state without
    // creating a new object each iteration.
    const tileImg = this.add.image(-9999, -9999, 'terrain-green', 0)
      .setScale(2)        // 16px → 32px to match TILE_SIZE
      .setVisible(false);

    // Open a single batch for the entire terrain — no WebGL flush per tile.
    terrainRt.beginDraw();

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const base   = noise.fbm(tx * BASE_SCALE,     ty * BASE_SCALE,     4, 0.5);
        const detail = detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE,   2, 0.6);

        // Höga Kusten coastal gradient: the eastern portion of the world slopes
        // down to the Gulf of Bothnia. A power-curve bias pulls high-x tiles toward
        // sea level — the farther east, the more likely they become open water.
        // This creates a natural coastline, offshore islands (noise peaks that
        // survive the bias), and inland lakes (noise troughs away from the coast).
        const coastBias = Math.pow(Math.max(0, tx / tilesX - 0.55), 1.8) * 2.0;
        const val = Math.max(0, base * 0.78 + detail * 0.22 - coastBias);

        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;

        // Draw the matching tileset frame (including water) scaled 2× to fill the 32×32 tile.
        // batchDraw() uses the image's own position — no per-tile batch flush.
        const { key, frame } = terrainTileFrame(val, detail);
        tileImg.setTexture(key, frame).setPosition(wx + 16, wy + 16);
        terrainRt.batchDraw(tileImg);
      }
    }

    // Spawn clearing — stamp shore/shingle tiles (terrain-yellow) over the underlying
    // biome in a circular patch so the player has a recognisable gravel landmark.
    // Done inside beginDraw()/endDraw() so it costs zero extra GPU draw calls.
    // Alternating frame 0/1 breaks up the tiling pattern just like the main terrain.
    const sx = Math.floor(SPAWN_X / TILE_SIZE);
    const sy = Math.floor(SPAWN_Y / TILE_SIZE);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 7) {
          const frame = (Math.abs(dx) + Math.abs(dy)) % 2;
          tileImg.setTexture('terrain-yellow', frame)
                 .setPosition((sx + dx) * TILE_SIZE + 16, (sy + dy) * TILE_SIZE + 16);
          terrainRt.batchDraw(tileImg);
        }
      }
    }

    terrainRt.endDraw();
    tileImg.destroy();
  }

  /**
   * Draw path segments as semi-transparent overlays on top of the terrain.
   * Depth 1 puts them just above the terrain (depth 0) but below decorations.
   * Each path type has its own color defined in PathSystem.PATH_DEFS.
   */
  private drawPaths(): void {
    this.pathGraphics = this.add.graphics();
    this.pathGraphics.setDepth(1);
    this.pathSystem.drawPaths(this.pathGraphics);
  }

  // ─── Procedural chunk stamping (FIL-67) ──────────────────────────────────────

  /**
   * Place CHUNK_COUNT hand-authored set pieces at seeded random positions.
   *
   * Algorithm:
   *  1. Build a weighted-random selector from CHUNKS[].weight
   *  2. Try up to CHUNK_COUNT × 20 candidate positions
   *  3. Reject if the position overlaps an avoid zone or an already-placed chunk
   *  4. Accept and stamp the chunk by creating Phaser objects at world coords
   *
   * Using mulberry32(seed ^ 0xc01dc0de) keeps placement deterministic per run.
   */
  private stampProceduralChunks(): void {
    const rng       = mulberry32(this.runSeed ^ 0xc01dc0de);
    // Reuse baseNoise — same instance as drawProceduralTerrain() so biome values
    // correspond exactly to the colours the player sees underfoot.
    const biomeNoise = this.baseNoise;

    /** Pick a chunk from a pool using weighted random. */
    const weightedPick = (pool: typeof CHUNKS): typeof CHUNKS[0] => {
      let t = 0;
      for (const c of pool) t += c.weight;
      let r = rng() * t;
      for (const c of pool) { r -= c.weight; if (r <= 0) return c; }
      return pool[pool.length - 1];
    };

    const placed: Array<{ x: number; y: number; r: number }> = [];
    let attempts = 0;
    const maxAttempts = CHUNK_COUNT * 20;

    while (placed.length < CHUNK_COUNT && attempts < maxAttempts) {
      attempts++;

      // Random world position (keep away from world edges)
      const x = 200 + rng() * (WORLD_W - 400);
      const y = 200 + rng() * (WORLD_H - 400);

      // Sample terrain noise at this position to determine the biome.
      // Matches the scale used by drawProceduralTerrain() so the noise value
      // corresponds to the actual terrain colour the player will see underfoot.
      const biomeVal = biomeNoise.fbm(x * BASE_SCALE, y * BASE_SCALE);

      // Filter chunk pool to types whose biome range covers this position.
      // Falls back to the full pool if nothing matches (e.g. mid-range terrain
      // that sits between two defined biomes).
      const eligible = CHUNKS.filter(c => {
        const lo = c.biomeMin ?? 0;
        const hi = c.biomeMax ?? 1;
        return biomeVal >= lo && biomeVal <= hi;
      });
      const pool = eligible.length > 0 ? eligible : CHUNKS;
      const chunk = weightedPick(pool);

      // Reject if inside an avoid zone
      const inAvoid = CHUNK_AVOID_ZONES.some(
        az => Math.sqrt((x - az.x) ** 2 + (y - az.y) ** 2) < az.r + chunk.radius
      );
      if (inAvoid) continue;

      // Reject if too close to an already-placed chunk (80px gap between radii)
      const tooClose = placed.some(
        p => Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2) < p.r + chunk.radius + 80
      );
      if (tooClose) continue;

      placed.push({ x, y, r: chunk.radius });
      this.stampChunk(chunk, x, y);
    }
  }

  /**
   * Scatter noise-driven detail decorations (flowers, mushrooms, stones, grass tufts)
   * across open terrain. Called after stampProceduralChunks() so chunk avoid-zones
   * are already defined and can be passed to generateDecorations().
   *
   * Decorations are placed at depth 2 — above terrain (0) and paths (1), below
   * animals and the player (3+).
   */
  private stampDecorationScatter(): void {
    // Convert CHUNK_AVOID_ZONES circles → conservative bounding rects for the
    // rect-based avoid check inside generateDecorations().
    const avoidRects = CHUNK_AVOID_ZONES.map(az => ({
      x: az.x - az.r, y: az.y - az.r,
      w: az.r * 2,    h: az.r * 2,
    }));

    const decors = generateDecorations(
      this.runSeed,
      WORLD_W, WORLD_H, TILE_SIZE,
      avoidRects,
      800,
    );

    for (const d of decors) {
      const texture = decorTexture(d.type, d.variant);
      const sprite = this.add.image(d.x, d.y, texture);
      sprite.setScale(d.scale);
      // Sort by y so decorations further down the screen render in front —
      // the standard "painter's algorithm" for top-down 2D.
      sprite.setDepth(2 + d.y / WORLD_H);
    }
  }

  /**
   * Stamp a single chunk at world position (cx, cy).
   *
   * Each item's dx/dy offset is added to (cx, cy) to get the world position.
   * Trees and rocks are added to the existing solidObjects StaticGroup so the
   * single collider registered in createPlayer() covers them automatically.
   * Decorations and puddles are non-physics sprites.
   */
  private stampChunk(chunk: ChunkDef, cx: number, cy: number): void {
    for (const item of chunk.items) {
      const wx = cx + item.dx;
      const wy = cy + item.dy;
      this.stampChunkItem(item, wx, wy);
    }
  }

  private stampChunkItem(item: ChunkItem, wx: number, wy: number): void {
    if (item.kind === 'tree' || item.kind === 'rock') {
      // Re-use the existing solidObjects group so the player collider covers these too.
      const obj = this.physics.add.staticImage(wx, wy, item.texture);
      if (item.scale !== undefined) obj.setScale(item.scale);
      obj.setDepth(wy); // y-sorting: lower on screen = in front
      obj.setOrigin(0.5, 1);
      this.solidObjects.add(obj);

      const body = obj.body as Phaser.Physics.Arcade.StaticBody;
      const cw = item.colliderWidth  ?? 12;
      const ch = item.colliderHeight ?? 10;
      const offsetY = item.colliderOffsetY ?? 0;
      body.setSize(cw, ch);
      body.setOffset(
        (obj.displayWidth  - cw) / 2,
        obj.displayHeight  - ch + offsetY,
      );
    } else {
      // decoration / puddle — no physics, just a sprite
      const sprite = this.add.image(wx, wy, item.texture);
      if (item.scale !== undefined) sprite.setScale(item.scale);
      sprite.setOrigin(0.5, 1);
      sprite.setDepth(item.kind === 'puddle' ? 2 : wy); // puddles below sprites
    }
  }

  // ─── Level 1 ──────────────────────────────────────────────────────────────────

  /**
   * Create semi-transparent zone tint overlays at depth 3 (above terrain + paths,
   * below decorations). Each zone starts at its initial tintAlpha.
   * On collectible pickup, the corresponding zone's overlay fades out.
   */
  private createLevel1Zones(): void {
    for (const zone of ZONES) {
      const overlay = this.add
        .rectangle(
          zone.x + zone.w / 2,
          zone.y + zone.h / 2,
          zone.w,
          zone.h,
          zone.tintColor,
          zone.tintAlpha,
        )
        .setDepth(3)
        .setScrollFactor(1); // scrolls with the world
      this.zoneOverlays.set(zone.id, overlay);
    }
  }

  /**
   * Create collectible circles — small pulsing discs, one per zone.
   * No map marker; found by exploration.
   */
  private createLevel1Collectibles(): void {
    for (const col of COLLECTIBLES) {
      const circle = this.add
        .circle(col.x, col.y, 10, 0xffffff, 0.9)
        .setStrokeStyle(2, 0xffffff, 1)
        .setDepth(20);

      // Pulsing scale tween — draws the eye without being obtrusive
      this.tweens.add({
        targets: circle,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      this.collectibleSprites.set(col.id, circle);
    }
  }

  /**
   * Called every frame during gameplay.
   * Checks collectible pickups, passive cleanse in Zone 3, and meeting trigger.
   */
  private updateLevel1(delta: number): void {
    const px = this.player.x;
    const py = this.player.y;

    // ── Collectible pickup ────────────────────────────────────────────────────
    for (const col of COLLECTIBLES) {
      if (this.collectedItems.has(col.id)) continue;
      const sprite = this.collectibleSprites.get(col.id);
      if (!sprite) continue;

      const dist = Phaser.Math.Distance.Between(px, py, col.x, col.y);
      if (dist > 40) continue;

      this.collectItem(col.id, col.label, col.x, col.y, col.zoneId);
    }

    // ── Passive cleanse in Zone 3 ─────────────────────────────────────────────
    const zone3 = ZONES.find(z => z.id === 'zone-plateau');
    if (zone3) {
      const inZone3 =
        px >= zone3.x && px <= zone3.x + zone3.w &&
        py >= zone3.y && py <= zone3.y + zone3.h;

      if (inZone3 && this.passiveCleanseTotal < PASSIVE_CLEANSE_CAP) {
        const gain = PASSIVE_CLEANSE_RATE * delta;
        this.passiveCleanseTotal = Math.min(PASSIVE_CLEANSE_CAP, this.passiveCleanseTotal + gain);
        // Add to the main cleanse percent (on top of rabbit kills)
        const rabbitPercent = (this.kills / RABBIT_COUNT) * 100;
        const total = Math.min(100, rabbitPercent + this.passiveCleanseTotal);
        this.setCleanseHud(total);
        this.events.emit('cleanse-updated', total);
      }
    }

    // ── Parent meeting trigger ────────────────────────────────────────────────
    if (!this.meetingTriggered) {
      const distToMeeting = Phaser.Math.Distance.Between(
        px, py, MEETING_POINT.x, MEETING_POINT.y
      );
      if (distToMeeting < MEETING_RADIUS) {
        this.meetingTriggered = true;
        this.triggerMeetingDialog();
      }
    }
  }

  /**
   * Handle picking up a collectible item.
   * 1. Remove the circle sprite
   * 2. Fly a label text toward the player
   * 3. Fade the zone's corruption overlay
   * 4. Play the first-cleanse ring on the first pickup
   */
  private collectItem(
    id: string, label: string, ix: number, iy: number, zoneId: string
  ): void {
    this.collectedItems.add(id);

    const sprite = this.collectibleSprites.get(id);
    if (sprite) {
      this.tweens.killTweensOf(sprite);
      // Fly item toward player then destroy
      this.tweens.add({
        targets: sprite,
        x: this.player.x,
        y: this.player.y,
        alpha: 0,
        duration: 350,
        ease: 'Sine.easeIn',
        onComplete: () => sprite.destroy(),
      });
    }

    // Floating label
    const floatText = this.add
      .text(ix, iy, label, {
        fontSize: '13px',
        color: '#ffffaa',
        backgroundColor: '#00000066',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setDepth(50);

    this.tweens.add({
      targets: floatText,
      y: iy - 60,
      alpha: 0,
      duration: 1800,
      ease: 'Sine.easeOut',
      onComplete: () => floatText.destroy(),
    });

    // Fade zone corruption overlay
    const overlay = this.zoneOverlays.get(zoneId);
    if (overlay) {
      this.tweens.add({
        targets: overlay,
        alpha: overlay.fillAlpha * 0.4,
        duration: 1200,
        ease: 'Sine.easeOut',
      });
    }

    // First pickup — expanding green ring (the tutorial moment: world reacts without text)
    if (this.collectedItems.size === 1) {
      this.playFirstCleanseRing(ix, iy);
    }
  }

  /**
   * Expanding green ring effect on first collectible pickup.
   * No text — the visual reaction IS the tutorial.
   */
  private playFirstCleanseRing(x: number, y: number): void {
    const ring = this.add.circle(x, y, 10, 0x00ff88, 0).setStrokeStyle(3, 0x00ff88, 0.9).setDepth(30);
    this.tweens.add({
      targets: ring,
      displayWidth:  300,
      displayHeight: 300,
      strokeAlpha: 0,
      duration: 1200,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * Launch NpcDialogScene with the parent meeting dialog.
   * Opening line varies by number of collectibles found.
   * After the dialog, the chosen path is stored in `this.chosenPath`.
   */
  private triggerMeetingDialog(): void {
    const openingLine = meetingOpeningLine(this.collectedItems.size);

    const dialogData: NpcDialogData = {
      callerKey: this.scene.key,
      text: openingLine,
      choices: PATH_CHOICES.map(c => ({ id: c.id, label: c.label })),
    };

    // Listen for the choice result before pausing (event arrives after resume)
    this.events.once('dialog-choice', (choiceId: string) => {
      this.chosenPath = choiceId as PathChoice;
      console.log(`[Level1] Path chosen: ${this.chosenPath}`);
    });

    this.scene.pause();
    this.scene.launch('NpcDialogScene', dialogData as unknown as object);
  }
}
