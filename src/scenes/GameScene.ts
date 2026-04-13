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
  SETTLEMENTS,
} from '../world/Level1';
import type { PathChoice } from '../world/Level1';
import type { NpcDialogData } from './NpcDialogScene';
import { CorruptedGuardian } from '../entities/CorruptedGuardian';

const REX_VIRTUAL_JOYSTICK_PLUGIN_KEY = 'rexvirtualjoystickplugin';

// World dimensions — diagonal SW→NE corridor. 4500×3000 at zoom 3.
const WORLD_W = 4500;
const WORLD_H = 3000;

// Terrain tile size in pixels
const TILE_SIZE = 32;
// Noise scales: BASE drives large biome regions, DETAIL adds local colour variation
const BASE_SCALE   = 0.07;
const DETAIL_SCALE = 0.22;

// Player spawn at the SW end of the diagonal corridor (rocky shore)
const SPAWN_X = 300;
const SPAWN_Y = 2650;

// Player movement speed in px/s
const PLAYER_SPEED = 180;

// ── Dash mechanic (FIL-123) ───────────────────────────────────────────────────
// Short burst of high speed with invincibility frames. Double-tap the joystick
// or press Shift to dash in the current movement direction.
const DASH_SPEED        = 520;  // px/s during the burst
const DASH_DURATION_MS  = 180;  // how long the velocity override lasts
const DASH_COOLDOWN_MS  = 600;  // minimum gap between consecutive dashes
const DASH_AFTERIMAGE_N = 4;    // ghost sprites left in the wake

// Player shape dimensions
const BODY_RADIUS = 16;
const INDICATOR_W = 10;
const INDICATOR_H = 6;


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

/** Portal at the NE end of the diagonal corridor */
const PORTAL_X = 4100;
const PORTAL_Y = 350;
const PORTAL_RADIUS = 44;

/** Corrupted Guardian boss spawn point — slightly SW of portal */
const BOSS_X = 3800;
const BOSS_Y = 520;
/** Distance at which the boss entrance camera pan triggers */
const BOSS_ENTRANCE_RADIUS = 500;

const HUD_BAR_W = 200;
const HUD_BAR_H = 14;
const HUD_PAD = 14;

/** NPC dialog lines — one per settlement, shown when the player presses E nearby. */
const NPC_DIALOG: Record<string, string> = {
  strandviken:  'Havet var annorlunda förr. Nu luktar det annorlunda vid tidvattnet.',
  skogsglanten: 'Skogen minner om saker. Lyssna när vinden vänder.',
  klippbyn:     'Det är kallt här uppe. Men utsikten — den ljuger aldrig.',
};

type RabbitState = 'roaming' | 'chasing' | 'fleeing';
type AnimalState = 'roaming' | 'fleeing' | 'chasing';

// ── Drop tables ───────────────────────────────────────────────────────────────
// Extensible config — add new entity keys as more enemy types are introduced (FIL-106).
// Gold range is kept small early-game; the economy will be balanced when the
// shop (FIL-93) and loot containers (FIL-92) are implemented.
interface DropTable {
  gold?: { min: number; max: number };
}
const DROP_TABLES: Record<string, DropTable> = {
  zombieRabbit:       { gold: { min: 1,  max: 4  } },
  corruptedGuardian:  { gold: { min: 60, max: 80 } },
};

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

/** Fox detects hares within this radius and enters chase state. */
const FOX_CHASE_RANGE = 220;

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
 * Maps a biome value + detail value to a Mystic Woods tileset frame.
 *
 * Setting: Höga Kusten (Swedish High Coast), early spring.
 * The landscape rises steeply from the Gulf of Bothnia. Biomes run from
 * open sea through rocky shore, coastal heath, and boreal forest up to
 * the bare granite of the highland summits.
 *
 * Tilesets (all Mystic Woods 2.2, 16×16 tiles):
 *   terrain-water  — water-sheet.png  480×48,  30 cols × 3 rows  (animated overlay)
 *   mw-plains      — plains.png       96×192,   6 cols × 12 rows
 *
 * Each ground biome maps to a consecutive row-pair (12 frames per biome).
 * detail noise spreads across all 12 frames so no two adjacent tiles repeat:
 *
 *   Biome            val range   rows   frames
 *   Rocky shore      0.25–0.33   0–1     0–11   earthy shingle
 *   Coastal heath    0.33–0.48   2–3    12–23   open ground / heather
 *   Mixed forest     0.48–0.65   4–5    24–35   birch-spruce floor
 *   Dense forest     0.65–0.80   6–7    36–47   dark spruce interior
 *   Highland rock    ≥ 0.80      8–9    48–59   granite / stone
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
  // Stay within a single row (6 columns) per biome — v12 across 2 rows caused
  // coastal tiles to visibly cycle as detail noise oscillated between rows.
  // plains.png rows: 0 = earthy shingle, 2 = light meadow, 4 = birch-spruce,
  //                  6 = dark spruce,    8 = bare granite
  const v6 = Math.floor(detail * 5.99); // 0–5, one row of plains.png
  if      (val < 0.25) return { key: 'terrain-water', frame: detail > 0.65 ? 2 : detail > 0.35 ? 1 : 0 }; // sea / lake
  else if (val < 0.30) return { key: 'mw-plains', frame: v6 };         // rocky shore        — row 0
  else if (val < 0.42) return { key: 'mw-plains', frame: 12 + v6 };    // coastal heath      — row 2
  else if (val < 0.62) return { key: 'mw-plains', frame: 24 + v6 };    // mixed birch-spruce — row 4
  else if (val < 0.78) return { key: 'mw-plains', frame: 36 + v6 };    // dense spruce       — row 6
  else                 return { key: 'mw-plains', frame: 48 + v6 };    // highland granite   — row 8
}

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private playerBody!: Phaser.GameObjects.Arc;
  private playerIndicator!: Phaser.GameObjects.Rectangle;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private playerLastDir: 'down' | 'up' | 'side' = 'down';
  private playerMoving = false;
  private joystick!: VirtualJoyStick;
  private mountainWalls!: Phaser.Physics.Arcade.StaticGroup;
  private navigationBarriers!: Phaser.Physics.Arcade.StaticGroup;
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

  // ─── Economy ──────────────────────────────────────────────────────────────────
  private playerGold = 0;
  private goldText!: Phaser.GameObjects.Text;

  // ─── Cleanse milestones ───────────────────────────────────────────────────────
  // Tracks which threshold percentages have already triggered so they don't
  // repeat if the cleanse-updated event fires multiple times near a boundary.
  private milestonesHit: Set<number> = new Set();

  // ─── Player health ────────────────────────────────────────────────────────────
  private playerHp = 100;
  private playerMaxHp = 100;
  // Upgrade-adjusted stats — initialised in applyUpgrades() called from create().
  // Each field shadows a module-level constant so upgrades don't mutate shared state.
  private effectiveMaxHp        = 100;
  private effectiveSpeed        = PLAYER_SPEED;
  private effectiveDashDuration = DASH_DURATION_MS;
  private effectiveSwipeRange   = SWIPE_RANGE;
  // Filled rect that shrinks as HP drops — same pattern as cleanseFill
  private hpFill!: Phaser.GameObjects.Rectangle;
  // Timestamp of last player hit — prevents instant death from rapid rabbit taps
  private lastDamagedAt = 0;

  // ─── Dash state (FIL-123) ─────────────────────────────────────────────────────
  // dashingUntil: game-time (ms) when the current dash expires (0 = not dashing).
  // Invincibility is active for the full duration — rabbits can't damage the player
  // mid-dash, which rewards skilful dodge timing.
  private dashingUntil   = 0;
  private lastDashAt     = 0;   // cooldown gating
  private dashDx         = 0;   // normalised direction held for the burst
  private dashDy         = 0;
  // Joystick double-tap detection: record when joystick goes idle so a quick
  // re-engagement within 220 ms triggers a dash.
  private joystickWasActive   = false;
  private joystickReleasedAt  = 0;

  // ─── Run timing ───────────────────────────────────────────────────────────────
  // Set when the player exits attract mode (name entered) so the timer reflects
  // actual gameplay time, not time spent on the attract/name-entry screen.
  private gameStartedAt = 0;
  // Guard flag — prevents onPlayerDeath / onLevelComplete firing more than once
  private gameEnded = false;

  private cleanseFill!: Phaser.GameObjects.Rectangle;
  private overlay!: Phaser.GameObjects.Rectangle;
  // All HUD elements (bars + labels) collected so they can be hidden during attract mode
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  // ─── Particle effects ─────────────────────────────────────────────────────────
  // Phase-gated emitters — created once in spawnParticleEffects(), toggled by
  // applyParticlePhase() on every day/night transition.
  private leavesEmitter?:  Phaser.GameObjects.Particles.ParticleEmitter;
  private pollenEmitter?:  Phaser.GameObjects.Particles.ParticleEmitter;
  private fireflyEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  // ─── Sound ────────────────────────────────────────────────────────────────────
  // ambience loops continuously in the background once gameplay starts
  private ambienceSound: Phaser.Sound.BaseSound | undefined;
  // Background music track for the current day phase (crossfades on transition)
  private musicTrack: Phaser.Sound.BaseSound | undefined;
  // Key of the currently-playing music track (avoid restarting the same track)
  private currentMusicKey = '';
  // tracks when we last played a footstep so we don't fire every frame
  private lastFootstepAt = 0;
  // Countdown (ms) until the corruption presence SFX may fire again.
  // Starts positive so the SFX doesn't play on the first frame.
  private corruptionSfxCooldown = 10_000;
  private readonly FOOTSTEP_INTERVAL_MS = 380; // tune this to match your walk animation rhythm
  private portal!: Phaser.GameObjects.Arc;
  private portalActive = false;
  private portalGfx!: Phaser.GameObjects.Graphics;

  // ── Boss (FIL-125) ──────────────────────────────────────────────────────────
  private boss?: CorruptedGuardian;
  private bossAlive         = false;
  private bossEntranceDone  = false;
  /** HP bar fill rectangle in the boss HUD — scaleX tracks boss HP. */
  private bossHudFill?: Phaser.GameObjects.Rectangle;
  /** Wrapper destroyed on boss death so all HUD elements go at once. */
  private bossHudContainer?: Phaser.GameObjects.Container;

  // ── Upgrade shrine (FIL-130) ──────────────────────────────────────────────────
  private readonly shrinePos       = { x: 380, y: 2760 };
  private shrineDialogActive       = false;
  private shrinePromptText?: Phaser.GameObjects.Text;

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

  // ─── Settlements Ph5 ──────────────────────────────────────────────────────────
  // Warm glow circles under each building — fade in at dusk/night via tween.
  private settlementGlows: Phaser.GameObjects.Arc[] = [];
  // Standing NPC figures — checked each frame for proximity interaction.
  private settlementNpcs: Phaser.GameObjects.Image[] = [];
  // True while the NpcDialogScene is open so we don't re-trigger on the same frame.
  private npcDialogActive = false;
  private interactKey?: Phaser.Input.Keyboard.Key;

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
    this.load.audio('forest-ambience', [
      'assets/audio/forest-ambience.ogg',
      'assets/audio/forest-ambience.mp3',
    ]);
    // ── Background music — four Cozy Tunes (Pro) tracks, one per day phase ────────
    // Mapped: dawn → Sunlight Through Leaves, morning/midday/afternoon → Whispering Woods,
    // dusk → Evening Harmony, night → Polar Lights.
    const cozyBase = 'assets/audio/Cozy Tunes (Pro) v1.4/Cozy Tunes (Pro)/Audio/ogg/Tracks';
    this.load.audio('music-dawn',  [`${cozyBase}/Sunlight Through Leaves.ogg`]);
    this.load.audio('music-day',   [`${cozyBase}/Whispering Woods.ogg`]);
    this.load.audio('music-dusk',  [`${cozyBase}/Evening Harmony.ogg`]);
    this.load.audio('music-night', [`${cozyBase}/Polar Lights.ogg`]);

    // ── Event SFX ─────────────────────────────────────────────────────────────────
    // Collectible pickup: warm pizzicato jingle (Kenney Music Jingles, CC0)
    this.load.audio('sfx-pickup',  ['assets/audio/kenney_music-jingles/Audio/Pizzicato jingles/jingles_PIZZI05.ogg']);
    // Portal reveal: crystalline steel jingle (Kenney Music Jingles, CC0)
    this.load.audio('sfx-portal',  ['assets/audio/kenney_music-jingles/Audio/Steel jingles/jingles_STEEL05.ogg']);
    // Cleanse swipe: arcane wind-chime whoosh (Shapeforms, free preview)
    this.load.audio('sfx-swipe',   ['assets/audio/Shapeforms Audio Free Sound Effects/Arcane Activations Preview/AUDIO/Arcane Wind Chime Gust.wav']);
    // Corruption presence: ominous drone (Cozy Tunes Pro sound effect)
    this.load.audio('sfx-corruption', ['assets/audio/Cozy Tunes (Pro) v1.4/Cozy Tunes (Pro)/Audio/ogg/Sound Effects/shadow.ogg']);

    // Load all 5 variants for three terrain surfaces from the Kenney Impact Sounds
    // pack (CC0). Multiple variants prevent the "machine gun" effect (identical
    // sounds repeating feel unnatural). Three surfaces map to terrain biome values:
    //   grass    → meadow / forest floor (biome 0.33–0.80)
    //   concrete → rocky shore and highland rock (biome 0.25–0.33 and ≥0.80)
    //   wood     → dense forest (biome 0.65–0.80, same range as dark terrain)
    const kenney = 'assets/audio/kenney_impact-sounds/Audio';
    for (let i = 0; i < 5; i++) {
      this.load.audio(`footstep-grass-${i}`,    `${kenney}/footstep_grass_00${i}.ogg`);
      this.load.audio(`footstep-concrete-${i}`, `${kenney}/footstep_concrete_00${i}.ogg`);
      this.load.audio(`footstep-wood-${i}`,     `${kenney}/footstep_wood_00${i}.ogg`);
    }

    // Animal rustle — soft impact sound plays when an animal starts fleeing.
    // Using Kenney impactSoft (CC0) as a convincing "sudden movement" sound.
    for (let i = 0; i < 5; i++) {
      this.load.audio(`animal-rustle-${i}`, `${kenney}/impactSoft_medium_00${i}.ogg`);
    }

    // ── Terrain tilesets (Mystic Woods 2.2, preferred for Level 1) ───────────────
    // plains.png  — 96×192, 16×16 tiles (6 cols × 12 rows = 72 frames)
    //   Each ground biome maps to a consecutive row-pair (12 frames of variety).
    //   See terrainTileFrame() for the exact row-to-biome mapping.
    // water-sheet — loaded separately below; 30-frame animated water.
    const mwTiles = 'assets/packs/mystic_woods_2.2/sprites/tilesets';
    this.load.spritesheet('mw-plains', `${mwTiles}/plains.png`, { frameWidth: 16, frameHeight: 16 });

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

    // ── Pixel Crawler building roofs (FIL-79) ─────────────────────────────────────
    // Single 400×400 sheet; named frames are registered in stampSettlementBuildings()
    // via this.textures.get().add() rather than a JSON atlas (none is bundled).
    const pcBuildings = 'assets/packs/Pixel Crawler - Free Pack 2.0.4/Pixel Crawler - Free Pack/Environment/Structures/Buildings';
    this.load.image('building-roofs', `${pcBuildings}/Roofs.png`);
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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.musicTrack?.stop();
      this.worldState.destroy();
    });

    this.runSeed = Math.floor(Math.random() * 0xffffffff);
    this.baseNoise = new FbmNoise(this.runSeed);
    this.corruptionField = new CorruptionField(this.runSeed);
    this.pathSystem = new PathSystem(LEVEL1_PATHS.map(s => ({ ...s })));
    this.drawProceduralTerrain();
    this.drawPaths();
    this.drawSettlementMarkers();
    this.createMountainWalls();
    this.createNavigationBarriers();
    this.createNavigationBarrierVisuals();
    this.createSolidObjects();
    this.stampProceduralChunks();
    this.stampDecorationScatter();
    this.spawnButterfliesAndBees();
    this.stampSettlementBuildings();
    this.spawnParticleEffects();
    this.spawnSettlementNpcs();
    this.createInteractiveObjects();
    this.createPlayer();

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    // Zoom in so pixel-art sprites read clearly on a tablet screen.
    // 2.5× gives a tighter, more intimate view than the previous 2×.
    this.cameras.main.setZoom(3);

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

    // Hide the joystick on non-touch devices (desktop with mouse/keyboard).
    // navigator.maxTouchPoints > 0 covers phones, tablets, and touch-screen laptops.
    // The joystick object still exists so this.joystick.force checks remain safe.
    const isTouchDevice = navigator.maxTouchPoints > 0;
    if (!isTouchDevice) {
      base.setVisible(false);
      thumb.setVisible(false);
    }

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // E key for NPC interaction (FIL-80)
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    // Reset dialog-active flags when any overlay returns control to GameScene
    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      this.npcDialogActive    = false;
      this.shrineDialogActive = false;
    });
    // Deduct gold when UpgradeScene confirms a purchase (GameScene is paused, not sleeping,
    // so its event bus still processes emits from the overlay scene).
    this.events.on('upgrade-purchased', (cost: number) => {
      this.playerGold = Math.max(0, this.playerGold - cost);
      this.refreshGoldText();
    });

    // Open credits overlay (C key)
    this.input.keyboard?.on('keydown-C', () => {
      this.scene.pause();
      this.scene.launch('CreditsScene', this.scene.key as unknown as object);
    });

    // Open pause menu (Escape or P) — only when no dialog is already blocking input
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!this.npcDialogActive) this.openPauseMenu();
    });
    this.input.keyboard?.on('keydown-P', () => {
      if (!this.npcDialogActive) this.openPauseMenu();
    });

    // Dash on Shift key — same action as joystick double-tap (FIL-123)
    this.input.keyboard?.on('keydown-SHIFT', () => this.tryDash());

    this.rabbits = this.physics.add.group();
    this.spawnRabbits();
    this.physics.add.collider(this.rabbits, this.mountainWalls);

    // Corrupted rabbits deal damage when they touch the player.
    // lastDamagedAt provides 1.5 s of invincibility frames so a single contact
    // doesn't drain the full HP bar instantly.
    this.physics.add.overlap(this.player, this.rabbits, () => {
      if (this.gameEnded || this.attractMode) return;
      const now = this.time.now;
      // Player is invincible while dashing — reward the dodge
      if (now < this.dashingUntil) return;
      if (now - this.lastDamagedAt < 1500) return;
      this.lastDamagedAt = now;
      this.playerHp = Math.max(0, this.playerHp - 20);
      this.setHpHud(this.playerHp);
      // Red tint flash — more readable than alpha blink, same intent.
      this.playerSprite.setTint(0xff4444);
      this.time.delayedCall(200, () => this.playerSprite.clearTint());
      if (this.playerHp <= 0) this.onPlayerDeath();
    });

    this.createAnimalAnimations();
    this.groundAnimals = this.physics.add.group();
    this.spawnGroundAnimals();
    this.spawnBirds();

    this.createHudAndOverlay();
    this.createPortal();
    this.createBoss();
    this.createLevel1Zones();
    this.createLevel1Collectibles();
    this.createShrine();
    this.applyUpgrades();

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
      // Show a toast for each 25 % milestone, once each.
      // The messages give the player a sense of progress without a numeric readout.
      for (const [threshold, key] of [
        [25,  'cleanse.milestone_25'],
        [50,  'cleanse.milestone_50'],
        [75,  'cleanse.milestone_75'],
        [100, 'cleanse.milestone_100'],
      ] as [number, string][]) {
        if (percent >= threshold && !this.milestonesHit.has(threshold)) {
          this.milestonesHit.add(threshold);
          this.showCleanseToast(t(key));
        }
      }
    });

    base.setDepth(200);
    thumb.setDepth(201);

    this.createDayNightOverlay();

    // Ambient forest sound — skipped entirely when audio is unavailable (CI).
    // Initial volume matches the starting phase so it doesn't snap on first transition.
    if (this.audioAvailable && this.cache.audio.has('forest-ambience')) {
      this.ambienceSound = this.sound.add('forest-ambience', {
        loop: true,
        volume: this.phaseAmbienceVolume(this.currentPhase),
      });
      this.ambienceSound.play();
    }

    // Start background music for the initial day phase
    this.startPhaseMusic(this.currentPhase, 0);

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
      this.updateNpcProximity();
      this.updateShrine();
    }
    // Y-sort player every frame — depth = world-Y matches the raw-Y system used by
    // chunk-placed trees so the player correctly occludes them based on position.
    // Done outside the attractMode branch so it runs whether or not input is active.
    this.player.setDepth(this.player.y);
    this.playerShadow.setPosition(this.player.x + 6, this.player.y + 8);
    this.playerShadow.setDepth(this.player.y - 1);

    this.updateRabbits(time);
    if (this.bossAlive && this.boss) this.boss.update(delta);
    this.updateGroundAnimals();
    this.updateBirds(time, delta);
    if (this.portalActive) {
      this.portalGfx.rotation += 0.03;
    }
    // Firefly emitter follows the player so particles always appear near the
    // camera centre. Updated every frame — cheap since it's just a position copy.
    if (this.fireflyEmitter) {
      this.fireflyEmitter.setPosition(this.player.x, this.player.y);
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
    // Mirror the diagonal terrain gradient from drawProceduralTerrain()
    const spawnPerp = (wx / WORLD_W - (1 - wy / WORLD_H)) / 2;
    const spawnMtB  = Math.pow(Math.max(0, -spawnPerp - 0.10), 1.5) * 4.0;
    const spawnOcB  = Math.pow(Math.max(0, spawnPerp  - 0.15), 1.5) * 3.0;
    const v = Math.max(0, Math.min(1.2, raw * 0.70 + spawnMtB - spawnOcB));
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
    const now = this.time.now;

    // ── Dash override ─────────────────────────────────────────────────────────
    // While dashingUntil hasn't elapsed, force the pre-calculated direction at
    // DASH_SPEED and skip the normal movement read entirely.
    if (now < this.dashingUntil) {
      body.setVelocity(this.dashDx * DASH_SPEED, this.dashDy * DASH_SPEED);
      this.updatePlayerAnimation(this.dashDx, this.dashDy, true);
      return;
    }

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

    // ── Joystick double-tap detection ─────────────────────────────────────────
    // Detect when the joystick goes from active → idle → active within 220 ms
    // and treat it as a dash trigger (the mobile equivalent of pressing Shift).
    const joystickActive = this.joystick.force > 10;
    if (this.joystickWasActive && !joystickActive) {
      this.joystickReleasedAt = now;
    }
    if (!this.joystickWasActive && joystickActive && this.joystickReleasedAt > 0) {
      if (now - this.joystickReleasedAt < 220) {
        this.tryDash();
      }
    }
    this.joystickWasActive = joystickActive;

    const moving = dx !== 0 || dy !== 0;

    if (moving) {
      const len = Math.sqrt(dx * dx + dy * dy);
      // Multiply base speed by the path multiplier so roads feel faster/slower.
      // Off-road returns 1.0 (no change); paved road at full condition returns 1.35.
      const speedMult = this.pathSystem.getSpeedMultiplier(this.player.x, this.player.y);
      const speed = this.effectiveSpeed * speedMult;
      body.setVelocity((dx / len) * speed, (dy / len) * speed);
    } else {
      body.setVelocity(0, 0);
    }

    // Footstep sound — fires once every FOOTSTEP_INTERVAL_MS while walking.
    // We check time.now instead of a frame counter so it stays in sync even
    // if the frame rate drops.
    if (moving && this.time.now - this.lastFootstepAt > this.FOOTSTEP_INTERVAL_MS) {
      // Sample the biome noise at the player's tile position to pick the right
      // surface sound. BASE_SCALE and baseNoise match drawProceduralTerrain() exactly,
      // so the value corresponds to the terrain colour the player sees underfoot.
      const tx = this.player.x / TILE_SIZE;
      const ty = this.player.y / TILE_SIZE;
      const biomeVal = this.baseNoise.fbm(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
      // Mirror the diagonal gradient so surface sound matches the tile colour underfoot.
      const fsPerp = (this.player.x / WORLD_W - (1 - this.player.y / WORLD_H)) / 2;
      const fsMtB  = Math.pow(Math.max(0, -fsPerp - 0.10), 1.5) * 4.0;
      const fsOcB  = Math.pow(Math.max(0, fsPerp  - 0.15), 1.5) * 3.0;
      const biome = Math.max(0, Math.min(1.2, biomeVal * 0.70 + fsMtB - fsOcB));

      // Suppress footsteps on open water (nothing to step on).
      // Map remaining biome ranges to surface keys matching the terrain colours:
      //   rocky shore  (0.25–0.33) → concrete (gravel / stone shingle)
      //   meadow/heath (0.33–0.65) → grass
      //   forest       (0.65–0.80) → wood (forest floor, muffled)
      //   highland     (≥ 0.80)    → concrete (bare granite plateau)
      if (biome >= 0.25) {
        let surface: string;
        if      (biome < 0.33) surface = 'concrete';
        else if (biome < 0.65) surface = 'grass';
        else if (biome < 0.80) surface = 'wood';
        else                   surface = 'concrete';

        const variant = Phaser.Math.Between(0, 4);
        const footKey = `footstep-${surface}-${variant}`;
        if (this.audioAvailable && this.cache.audio.has(footKey)) this.sound.play(footKey, { volume: 0.45 });
      }
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

    // Swipe whoosh SFX — plays regardless of whether a rabbit is hit
    if (this.audioAvailable && this.cache.audio.has('sfx-swipe')) {
      this.sound.play('sfx-swipe', { volume: 0.35 });
    }

    const px = this.player.x;
    const py = this.player.y;
    const aim = Math.atan2(pointer.worldY - py, pointer.worldX - px);
    const half = SWIPE_ARC / 2;

    // ── Boss hit check (priority over rabbits) ────────────────────────────────
    //
    // The boss is a large 40×40 entity; use a slightly wider range (1.5×) so
    // it's satisfying to hit. Swipe is consumed if the boss is in range.
    if (this.bossAlive && this.boss) {
      const db = Phaser.Math.Distance.Between(px, py, this.boss.x, this.boss.y);
      if (db <= this.effectiveSwipeRange * 1.5) {
        this.boss.takeDamage(1);
        this.boss.onHitBy(px, py);
        this.cameras.main.shake(200, 0.006);
        this.updateBossHud();
        return;
      }
    }

    for (const child of [...this.rabbits.getChildren()]) {
      const r = child as Phaser.GameObjects.Rectangle;
      const d = Phaser.Math.Distance.Between(px, py, r.x, r.y);
      if (d > this.effectiveSwipeRange) {
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

    // Camera shake on every successful hit — same intensity as the arena (FIL-124).
    this.cameras.main.shake(150, 0.004);

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
    // Resolve drop table — award gold and show floating feedback text
    this.resolveDrops('zombieRabbit', rx, ry);
  }

  /**
   * Resolve an entity's drop table and apply rewards to the player.
   *
   * Keyed by entity type so new enemies (FIL-106) just need an entry in
   * DROP_TABLES — no other code changes required.
   */
  private resolveDrops(entityType: string, x: number, y: number): void {
    const table = DROP_TABLES[entityType];
    if (!table) return;

    if (table.gold) {
      // Lucky strike upgrade multiplies all gold drops by 1.5 (rounded).
      const boughtUpgrades = JSON.parse(localStorage.getItem('matlu_upgrades') ?? '{}') as Record<string, boolean>;
      const goldMult = boughtUpgrades['lucky_strike'] ? 1.5 : 1;
      const amount = Math.round(Phaser.Math.Between(table.gold.min, table.gold.max) * goldMult);
      this.playerGold += amount;
      this.refreshGoldText();
      // Floating "+N gold" feedback in world-space — rises and fades like collectible labels
      this.spawnFloatText(x, y, `+${amount} ${t('hud.gold')}`, '#ffe066');
    }
  }

  private refreshGoldText(): void {
    this.goldText.setText(`${t('hud.gold')}: ${this.playerGold}`);
  }

  /**
   * Spawn a floating text label at world coordinates that rises 60px and fades out.
   * Used for drop rewards and other instant feedback in the game world.
   */
  private spawnFloatText(x: number, y: number, text: string, color: string): void {
    const label = this.add
      .text(x, y - 20, text, {
        fontSize: '13px',
        color,
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setDepth(500)
      .setOrigin(0.5, 1);
    this.tweens.add({
      targets: label,
      y: y - 80,
      alpha: 0,
      duration: 1400,
      ease: 'Sine.easeOut',
      onComplete: () => label.destroy(),
    });
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

  private onPlayerDeath(): void {
    if (this.gameEnded) return;
    this.gameEnded = true;
    const durationMs = this.gameStartedAt > 0
      ? Math.round(this.time.now - this.gameStartedAt)
      : 0;
    const cleanse = Math.round((this.kills / RABBIT_COUNT) * 100);
    // Record the run — fire-and-forget, failures are non-critical
    insertMatluRun({
      nickname: this.playerName || 'Player',
      score:    this.kills,
      duration_ms: durationMs,
    }).catch(() => {});
    // Freeze the world and overlay the game-over screen
    this.scene.pause();
    this.scene.launch('GameOverScene', { cleanse, kills: this.kills, durationMs } as unknown as object);
  }

  private onLevelComplete(): void {
    if (this.gameEnded) return;
    this.gameEnded = true;
    const durationMs = this.gameStartedAt > 0
      ? Math.round(this.time.now - this.gameStartedAt)
      : 0;
    const cleanse = Math.round((this.kills / RABBIT_COUNT) * 100);
    insertMatluRun({
      nickname: this.playerName || 'Player',
      score:    this.kills,
      duration_ms: durationMs,
    }).catch(() => {});
    this.scene.pause();
    this.scene.launch('LevelCompleteScene', { cleanse, kills: this.kills, durationMs } as unknown as object);
  }

  private openPauseMenu(): void {
    // Pause this scene (freezes update + physics) then launch the pause overlay
    // in parallel so the frozen world stays visible behind it.
    this.scene.pause();
    this.scene.launch('PauseMenuScene');
  }

  // ── Dash mechanic (FIL-123) ─────────────────────────────────────────────────

  /**
   * Initiates a dash in the current movement direction (or last-known facing
   * direction if the player is standing still).
   *
   * Called from the Shift keydown listener and from the joystick double-tap
   * path in updatePlayerMovement(). Guards: attract mode, game ended, cooldown.
   */
  private tryDash(): void {
    if (this.attractMode || this.gameEnded) return;
    const now = this.time.now;
    if (now - this.lastDashAt < DASH_COOLDOWN_MS) return;

    // Resolve dash direction — prefer live input, fall back to last facing.
    let dx = 0;
    let dy = 0;

    if (this.joystick.force > 10) {
      dx = Math.cos(this.joystick.rotation);
      dy = Math.sin(this.joystick.rotation);
    } else {
      const right = this.cursors.right.isDown || this.wasd['right'].isDown ? 1 : 0;
      const left  = this.cursors.left.isDown  || this.wasd['left'].isDown  ? 1 : 0;
      const down  = this.cursors.down.isDown  || this.wasd['down'].isDown  ? 1 : 0;
      const up    = this.cursors.up.isDown    || this.wasd['up'].isDown    ? 1 : 0;
      dx = right - left;
      dy = down - up;
    }

    // If no directional input, use the last known facing direction so standing
    // dashes still feel intentional (dash "away" from last movement).
    if (dx === 0 && dy === 0) {
      if (this.playerLastDir === 'up')   { dy = -1; }
      else if (this.playerLastDir === 'down') { dy =  1; }
      else { dx = this.playerSprite.flipX ? -1 : 1; }
    }

    const len = Math.sqrt(dx * dx + dy * dy);
    this.dashDx = dx / len;
    this.dashDy = dy / len;
    this.lastDashAt   = now;
    this.dashingUntil = now + this.effectiveDashDuration;

    this.spawnDashAfterimages();

    // Reuse swipe SFX at a higher pitch for a distinct whoosh feel.
    if (this.audioAvailable && this.cache.audio.has('sfx-swipe')) {
      this.sound.play('sfx-swipe', { volume: 0.22, rate: 1.6 });
    }
  }

  /**
   * Drops DASH_AFTERIMAGE_N semi-transparent ghost circles staggered over the
   * first ~120 ms of the dash. Each ghost spawns at the player's live position
   * at the moment of spawn, so earlier ghosts trail further behind — the trail
   * appears to grow behind the player as they dash forward.
   */
  private spawnDashAfterimages(): void {
    for (let i = 0; i < DASH_AFTERIMAGE_N; i++) {
      // Stagger spawns: i=0 is immediate (start position), i=N-1 is near dash end.
      this.time.delayedCall(i * 30, () => {
        const ghost = this.add.arc(
          this.player.x, this.player.y,
          BODY_RADIUS,
          0, 360, false,
          0xa8d8ff,
          // Earlier ghosts (lower i) are more transparent — they lag further
          // behind the player so a softer echo suits them visually.
          0.50 - i * 0.08,
        );
        // Use the player's live Y as depth so the ghost renders just behind the player
        // in the same raw-Y system used by chunk trees and ground animals.
        ghost.setDepth(this.player.y - 1);
        this.tweens.add({
          targets:  ghost,
          alpha:    0,
          duration: 280,
          ease:     'Power2',
          onComplete: () => ghost.destroy(),
        });
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

    // HP fill is stored separately so setHpHud() can resize it on damage
    this.hpFill = this.add
      .rectangle(pad + 2, pad + 10, w - 4, h - 4, 0xff3333)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(300);

    this.hudObjects.push(
      this.add
        .text(pad, pad - 2, t('hud.hp'), { fontSize: '11px', color: '#ffffff' })
        .setScrollFactor(0)
        .setDepth(300),
      this.add.rectangle(pad + w / 2, pad + 10, w, h, 0x111111, 0.9).setScrollFactor(0).setDepth(299),
      this.hpFill,
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

    // Milestone tick marks at 25 %, 50 %, 75 % on the cleanse bar.
    // Drawn with a Graphics object in screen-space so they render above the fill.
    // These give the player visual targets to aim for without displaying a number.
    const ticks = this.add.graphics().setScrollFactor(0).setDepth(301);
    ticks.lineStyle(1, 0xffffff, 0.4);
    const barLeft = sw - pad - w;
    const barTop  = pad + 10 - h / 2;
    for (const frac of [0.25, 0.5, 0.75]) {
      const tx = barLeft + w * frac;
      ticks.moveTo(tx, barTop);
      ticks.lineTo(tx, barTop + h);
    }
    ticks.strokePath();
    this.hudObjects.push(ticks);

    // Gold counter — sits below the HP bar in the top-left.
    // Updates in resolveDrops() each time a reward is collected.
    this.goldText = this.add
      .text(pad, pad + h + 12, `${t('hud.gold')}: 0`, {
        fontSize: '11px',
        color: '#ffe066',
      })
      .setScrollFactor(0)
      .setDepth(300);
    this.hudObjects.push(this.goldText);

    // Pause button — top-centre, between the two HUD bars.
    // Small and unobtrusive on tablet; tapping or clicking it opens the pause menu.
    const pauseBtn = this.add
      .text(sw / 2, pad + 4, '  ⏸  ', {
        fontSize: '12px',
        color: '#7a9a7a',
        backgroundColor: '#00000044',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(300)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => pauseBtn.setStyle({ color: '#f0ead6' }))
      .on('pointerout',   () => pauseBtn.setStyle({ color: '#7a9a7a' }))
      .on('pointerdown',  () => this.openPauseMenu());
    this.hudObjects.push(pauseBtn);

    // Full-screen tint overlay — covers whatever viewport size we have.
    this.overlay = this.add
      .rectangle(sw / 2, sh / 2, sw, sh, 0x8899aa, 0.38)
      .setScrollFactor(0)
      .setDepth(50);

    this.setCleanseHud(0);
  }

  private setHpHud(hp: number): void {
    // Resize the red fill bar proportionally — mirrors how cleanseFill works
    const ratio = Phaser.Math.Clamp(hp / this.playerMaxHp, 0, 1);
    this.hpFill.width = (HUD_BAR_W - 4) * ratio;
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

  /**
   * Show a brief toast message at the bottom-centre of the screen.
   * Used for cleanse milestones — keeps the player informed without a permanent UI element.
   * Uses scrollFactor(0) so the text stays in screen-space regardless of camera position.
   */
  private showCleanseToast(message: string): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height - 80;
    const toast = this.add
      .text(cx, cy + 20, message, {
        fontSize: '14px',
        color: '#88ffaa',
        stroke: '#000000',
        strokeThickness: 2,
        backgroundColor: '#00000088',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(600)
      .setAlpha(0);
    this.tweens.add({
      targets: toast,
      alpha: 1,
      y: cy,
      duration: 400,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: toast,
          alpha: 0,
          delay: 2200,
          duration: 600,
          ease: 'Sine.easeIn',
          onComplete: () => toast.destroy(),
        });
      },
    });
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
      if (!this.portalActive) return;
      this.onLevelComplete();
    });
  }

  private revealPortal(): void {
    this.portalActive = true;
    this.drawPortalRing();
    // Steel jingle marks the portal unlocking — distinct from the pickup pizzicato
    if (this.audioAvailable && this.cache.audio.has('sfx-portal')) {
      this.sound.play('sfx-portal', { volume: 0.6 });
    }
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

  // ─── Boss fight (FIL-125) ────────────────────────────────────────────────────

  /**
   * Spawn the Corrupted Guardian boss near the portal zone and wire up all
   * event listeners and physics interactions.
   */
  private createBoss(): void {
    this.boss = new CorruptedGuardian(this, BOSS_X, BOSS_Y);
    this.boss.setDepth(BOSS_Y);   // raw-Y depth so it sorts with other objects
    // Provide a player position getter — boss uses this to aim charges.
    this.boss.setTarget(() => ({ x: this.player.x, y: this.player.y }));

    // Attach arcade physics so the boss can move and be overlapped.
    this.physics.add.existing(this.boss);
    (this.boss.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);

    this.bossAlive = true;

    // Boss contact damages the player — same invincibility window as rabbits.
    this.physics.add.overlap(this.player, this.boss, () => {
      if (this.gameEnded || this.attractMode || !this.bossAlive) return;
      const now = this.time.now;
      if (now < this.dashingUntil) return;           // dash invincibility
      if (now - this.lastDamagedAt < 1500) return;   // hit cooldown
      this.lastDamagedAt = now;
      this.playerHp = Math.max(0, this.playerHp - 25);
      this.setHpHud(this.playerHp);
      this.playerSprite.setTint(0xff4444);
      this.time.delayedCall(200, () => this.playerSprite.clearTint());
      if (this.playerHp <= 0) this.onPlayerDeath();
    });

    // Phase 2+: boss requests rabbit spawns via scene events.
    this.events.on('boss-spawn-rabbits', (bx: number, by: number) => {
      this.spawnBossRabbits(bx, by);
    });

    // Boss defeated.
    this.events.once('boss-died', () => this.onBossDied());

    this.createBossHud();
  }

  /**
   * Fixed-to-screen HUD showing the boss name and HP bar at the top centre.
   * Uses setScrollFactor(0) so it stays in place as the camera moves.
   */
  private createBossHud(): void {
    const cx = this.scale.width / 2;

    // Background bar
    const bg = this.add
      .rectangle(cx, 22, 220, 14, 0x220033, 0.85)
      .setScrollFactor(0)
      .setDepth(100);

    // HP fill (purple) — scaleX tracks boss HP fraction.
    this.bossHudFill = this.add
      .rectangle(cx - 108, 22, 216, 10, 0xaa44ff)
      .setScrollFactor(0)
      .setDepth(101)
      .setOrigin(0, 0.5);

    // Label above the bar.
    const label = this.add
      .text(cx, 10, 'Corrupted Guardian', {
        fontSize: '11px',
        color: '#cc88ff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101);

    // Group into a Container so onBossDied() can destroy it all at once.
    // Note: these are already on the display list; Container.add() moves them.
    this.bossHudContainer = this.add.container(0, 0, [bg, this.bossHudFill, label]);
    this.bossHudContainer.setScrollFactor(0).setDepth(100);
  }

  /**
   * Update boss HP bar fill width to match current HP fraction.
   * Called every frame while the boss is alive.
   */
  private updateBossHud(): void {
    if (!this.boss || !this.bossHudFill) return;
    this.bossHudFill.scaleX = Math.max(0, this.boss.hpFraction);
  }

  /**
   * Entrance cinematic: stop camera follow, pan to the boss, hold, pan back,
   * resume follow. The boss pulses in scale to signal its presence.
   */
  private triggerBossEntrance(): void {
    this.bossEntranceDone = true;
    const cam = this.cameras.main;
    cam.stopFollow();

    // Pan to boss (1.2 s).
    cam.pan(BOSS_X, BOSS_Y, 1200, 'Sine.easeInOut');

    // Boss scale-pulse during the reveal.
    if (this.boss) {
      this.tweens.add({
        targets:  this.boss,
        scaleX:   { from: 0.8, to: 1.4 },
        scaleY:   { from: 0.8, to: 1.4 },
        yoyo:     true,
        duration: 700,
        ease:     'Sine.easeInOut',
      });
    }

    // Hold on boss for ~1.8 s, then pan back to player (0.8 s).
    this.time.delayedCall(3000, () => {
      cam.pan(this.player.x, this.player.y, 800, 'Sine.easeInOut');
    });

    // Resume follow after the full sequence (~4 s total).
    this.time.delayedCall(3800, () => {
      cam.startFollow(this.player, true, 0.1, 0.1);
    });
  }

  /**
   * Spawn two zombie rabbits near the boss position (phase 2 ability).
   * Uses the same pattern as spawnRabbits() but places them close to the boss.
   */
  private spawnBossRabbits(bx: number, by: number): void {
    for (let i = 0; i < 2; i++) {
      const offsetX = (i === 0 ? -1 : 1) * Phaser.Math.Between(30, 60);
      const offsetY = Phaser.Math.Between(-40, 40);
      const r = this.add.rectangle(bx + offsetX, by + offsetY, 18, 18, 0x993333);
      this.physics.add.existing(r);
      (r.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
      r.setData('state',    'roaming' satisfies RabbitState);
      r.setData('roamNext', this.time.now + Phaser.Math.Between(500, 1500));
      r.setData('fleeUntil', 0);
      r.setDepth(r.y);
      this.rabbits.add(r);
    }
  }

  /**
   * Boss defeated: award drops, fill cleanse bar, reveal portal, destroy HUD.
   */
  private onBossDied(): void {
    this.bossAlive = false;

    // Large camera shake — bigger than a regular hit.
    this.cameras.main.shake(300, 0.008);

    // Gold drop + floating text.
    if (this.boss) {
      this.resolveDrops('corruptedGuardian', this.boss.x, this.boss.y);
    }

    // Fill cleanse bar to 100% and trigger portal reveal.
    this.events.emit('cleanse-updated', 100);
    if (!this.portalActive) this.revealPortal();

    // Destroy the boss HUD after a short pause so the player can see it reach 0.
    this.time.delayedCall(600, () => {
      this.bossHudContainer?.destroy();
      this.bossHudContainer = undefined;
      this.bossHudFill      = undefined;
    });
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

    // Fade the ambient sound to a phase-appropriate volume over the same 8-second
    // window as the visual overlay transition. Night is silent; dawn/dusk are quiet.
    if (this.ambienceSound) {
      this.tweens.add({
        targets: this.ambienceSound,
        volume: this.phaseAmbienceVolume(newPhase),
        duration: 8000,
        ease: 'Sine.easeInOut',
      });
    }
    this.applyParticlePhase(newPhase);
    this.crossfadeMusic(newPhase, 8000);

    // Settlement window glow — warm at dusk/night, off during daylight (FIL-80)
    const glowAlpha = (newPhase === 'dusk' || newPhase === 'night') ? 0.18 : 0;
    for (const glow of this.settlementGlows) {
      this.tweens.add({ targets: glow, alpha: glowAlpha, duration: 8000, ease: 'Sine.easeInOut' });
    }
  }

  /** Music track key for each day phase. */
  private phaseMusicKey(phase: DayPhase): string {
    switch (phase) {
      case 'dawn':      return 'music-dawn';
      case 'morning':   return 'music-day';
      case 'midday':    return 'music-day';
      case 'afternoon': return 'music-day';
      case 'dusk':      return 'music-dusk';
      case 'night':     return 'music-night';
    }
  }

  /** Music volume target for each day phase (music is softer than ambience). */
  private phaseMusicVolume(phase: DayPhase): number {
    switch (phase) {
      case 'dawn':      return 0.20;
      case 'morning':   return 0.30;
      case 'midday':    return 0.28;
      case 'afternoon': return 0.25;
      case 'dusk':      return 0.18;
      case 'night':     return 0.15;
    }
  }

  /**
   * Start the music track for the given phase immediately at the given volume.
   * Used for the first frame so we don't cross-fade from silence every session.
   * `fadeDuration` = 0 means instant start.
   */
  private startPhaseMusic(phase: DayPhase, fadeDuration: number): void {
    if (!this.audioAvailable) return;
    const key = this.phaseMusicKey(phase);
    if (!this.cache.audio.has(key)) return;
    this.currentMusicKey = key;
    this.musicTrack = this.sound.add(key, { loop: true, volume: 0 });
    this.musicTrack.play();
    if (fadeDuration > 0) {
      this.tweens.add({ targets: this.musicTrack, volume: this.phaseMusicVolume(phase), duration: fadeDuration, ease: 'Sine.easeInOut' });
    } else {
      (this.musicTrack as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound).setVolume(this.phaseMusicVolume(phase));
    }
  }

  /**
   * Crossfade from the current music track to the one matching `newPhase`.
   * If the track key hasn't changed (e.g. morning → midday both use music-day)
   * we skip the transition to avoid an audible restart.
   */
  private crossfadeMusic(newPhase: DayPhase, duration: number): void {
    if (!this.audioAvailable) return;
    const nextKey = this.phaseMusicKey(newPhase);
    if (nextKey === this.currentMusicKey) return;

    // Fade out old track
    if (this.musicTrack) {
      const old = this.musicTrack;
      this.tweens.add({
        targets: old,
        volume: 0,
        duration,
        ease: 'Sine.easeInOut',
        onComplete: () => old.stop(),
      });
    }

    // Fade in new track
    if (!this.cache.audio.has(nextKey)) return;
    this.currentMusicKey = nextKey;
    const next = this.sound.add(nextKey, { loop: true, volume: 0 });
    next.play();
    this.musicTrack = next;
    this.tweens.add({
      targets: next,
      volume: this.phaseMusicVolume(newPhase),
      duration,
      ease: 'Sine.easeInOut',
    });
  }

  /** Ambience volume target for each day phase. */
  private phaseAmbienceVolume(phase: DayPhase): number {
    switch (phase) {
      case 'dawn':      return 0.10; // forest waking slowly
      case 'morning':   return 0.25; // full birdsong
      case 'midday':    return 0.25;
      case 'afternoon': return 0.20; // settling toward evening
      case 'dusk':      return 0.08; // last light fading
      case 'night':     return 0.00; // silent except wind
    }
  }

  /**
   * Conditionally play the corruption presence SFX ('sfx-corruption').
   *
   * The SFX fires when the player is standing in a locally-corrupt patch of
   * terrain. Frequency and volume both scale with `multiplier` — Level 1 uses
   * 1.0 (rare, almost out of place), Level 5 uses 5.0 (near-constant drone).
   *
   * ## Why a cooldown instead of a Phaser timer?
   * Phaser.Time.addEvent fires on a fixed schedule regardless of where the
   * player is. We want the SFX to be silent in clean zones and active in
   * corrupt ones, so we sample the corruption field every frame and only
   * decrement the cooldown inside corrupt patches.  The random jitter on
   * reset prevents the SFX from sounding mechanical.
   *
   * @param delta       Frame delta in milliseconds (from update()).
   * @param multiplier  Per-level SFX intensity multiplier (from LevelMusicConfig).
   */
  private maybePlayCorruptionSfx(delta: number, multiplier: number): void {
    if (!this.audioAvailable) return;
    if (!this.cache.audio.has('sfx-corruption')) return;

    // Sample the corruption field at the player's world position.
    // CorruptionField.sample() returns 0–0.9; anything above 0.35 is
    // visually noticeable corruption that warrants an audio cue.
    const localCorruption = this.corruptionField.sample(
      this.player.x,
      this.player.y,
      1.0,  // pass global=1 so field geography drives the result, not cleanse %
    );

    if (localCorruption < 0.35) {
      // Player is in a relatively clean patch — no SFX, but keep counting down
      // so we're ready when they enter a dark zone.
      this.corruptionSfxCooldown = Math.max(0, this.corruptionSfxCooldown - delta);
      return;
    }

    // Inside corruption — count down and fire when cooldown expires.
    this.corruptionSfxCooldown -= delta;
    if (this.corruptionSfxCooldown > 0) return;

    // Volume scales with both local corruption intensity and the level multiplier.
    // Cap at 0.5 so it never overwhelms the music track.
    const volume = Math.min(0.5, localCorruption * multiplier * 0.25);
    this.sound.play('sfx-corruption', { volume });

    // Base cooldown is 18 seconds. Multiplier shortens it (Level 5 = ~3.6s base).
    // ±4s random jitter stops it feeling mechanical.
    const jitter = Phaser.Math.Between(-4000, 4000);
    this.corruptionSfxCooldown = Math.max(1000, (18_000 / multiplier) + jitter);
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
      { x: 460, y: 2560 },
      { x: 460, y: 2750 },
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
    // Initial depth matches spawn Y so the first frame renders correctly.
    // Updated every frame in update() using the same raw-Y system as chunk trees.
    this.player.setDepth(SPAWN_Y);

    // Drop shadow — oval offset SE from the player's feet, depth just below the player.
    // Same pattern as bird shadows (add.ellipse at offset position, low alpha).
    this.playerShadow = this.add.ellipse(SPAWN_X + 6, SPAWN_Y + 8, 22, 10, 0x000000, 0.22);
    this.playerShadow.setDepth(SPAWN_Y - 1);

    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    body.setCircle(BODY_RADIUS);

    this.physics.add.collider(this.player, this.mountainWalls);
    this.physics.add.collider(this.player, this.navigationBarriers);
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

  /**
   * Invisible static physics bodies along the diagonal mountain boundary.
   *
   * The NW triangle is mountain territory (perpDiag < -0.10). We approximate
   * the boundary with vertical column slabs. Boundary formula:
   *   boundaryY/WORLD_H = 0.80 - wx/WORLD_W  (from perpDiag = -0.10)
   * A 6%-height margin keeps the invisible wall inside visible granite.
   */
  private createMountainWalls(): void {
    this.mountainWalls = this.physics.add.staticGroup();

    const COLS = 22;
    const colW = Math.ceil(WORLD_W / COLS) + 2; // slight overlap prevents gaps

    for (let i = 0; i < COLS; i++) {
      const wx = i * Math.ceil(WORLD_W / COLS);
      const boundaryFrac = 0.74 - wx / WORLD_W; // 0.80 - 0.06 margin - wx/WORLD_W
      if (boundaryFrac <= 0) break;

      const boundaryY = boundaryFrac * WORLD_H;
      const rect = this.add.rectangle(
        wx + colW / 2, boundaryY / 2,
        colW, boundaryY,
        0x000000, 0,
      );
      this.physics.add.existing(rect, true);
      this.mountainWalls.add(rect);
    }

    this.mountainWalls.refresh();
  }

  /**
   * Three horizontal impassable strips that divide the world into four navigable zones,
   * creating a guided SW→NE experience:
   *
   *   Zone 4 — Highland / Portal         (y < 830)
   *   ─── Highland Rim ───────────────── gap at x 2830–2930
   *   Zone 3 — Skogsgläntan area         (y 830–1240)
   *   ─── Forest Belt ────────────────── gaps at x 1930–2020 and x 2380–2470
   *   Zone 2 — Boreal mid-corridor       (y 1240–2060)
   *   ─── Southern River ─────────────── ford gap at x 530–680
   *   Zone 1 — Coastal / Strandviken     (y 2060–3000) ← spawn here
   *
   * The gap positions are chosen to align with existing path segments in Level1Paths.ts
   * so the player naturally discovers the crossings while following the dirt / animal /
   * forest / paved route from spawn to portal.
   */
  private createNavigationBarriers(): void {
    this.navigationBarriers = this.physics.add.staticGroup();

    // Thin helper — adds one invisible static collision rectangle to the group.
    const addBlock = (x: number, y: number, w: number, h: number): void => {
      const rect = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0);
      this.physics.add.existing(rect, true);
      this.navigationBarriers.add(rect);
    };

    // ── Southern River (y 2060–2160) — ford gap at x 530–680 ────────────────
    // Gap aligns with dirt-sw-3 (x:580, w:80) from Level1Paths.ts.
    addBlock(0,    2060, 530,  100);
    addBlock(680,  2060, 3820, 100);

    // ── Forest Belt (y 1240–1340) — gaps at x 1930–2020 and x 2380–2470 ─────
    // Left gap aligns with animal-trail-5 exit (x:1950), right gap with forest-path-1 entry.
    addBlock(0,    1240, 1930, 100);
    addBlock(2020, 1240, 360,  100);
    addBlock(2470, 1240, 2030, 100);

    // ── Highland Rim (y 830–920) — gap at x 2830–2930 ────────────────────────
    // Gap aligns with forest-path-2 / paved-plateau-1 junction.
    addBlock(0,    830,  2830, 90);
    addBlock(2930, 830,  1570, 90);

    this.navigationBarriers.refresh();
  }

  /**
   * Cosmetic visuals that make each navigation barrier legible to the player.
   * The physics bodies (createNavigationBarriers) do the actual blocking —
   * these sprites just signal "you can't walk here" in a natural-feeling way.
   */
  private createNavigationBarrierVisuals(): void {
    // Fixed seed so placement is identical on every run regardless of runSeed.
    const rng = mulberry32(0xba771e75);

    // ── River: tiled water strip (frame 0 of terrain-water is a 16×16 water tile) ──
    const riverY    = 2060;
    const riverH    = 100;
    const riverMidY = riverY + riverH / 2;
    this.add.tileSprite(265,              riverMidY, 530,  riverH, 'terrain-water', 0).setDepth(1.5);
    this.add.tileSprite(680 + 3820 / 2,  riverMidY, 3820, riverH, 'terrain-water', 0).setDepth(1.5);

    // ── Forest Belt: dense tree scatter across all three belt segments ────────
    const treeTex = ['tree-spruce', 'tree-spruce-2', 'tree-normal', 'tree-big', 'tree-pine', 'tree-birch', 'tree-birch-2'];
    const forestSegments: [number, number, number, number][] = [
      [0,    1240, 1930, 100],
      [2020, 1240, 360,  100],
      [2470, 1240, 2030, 100],
    ];
    for (const [sx, sy, sw, sh] of forestSegments) {
      for (let tx = sx + 14; tx < sx + sw - 14; tx += 28) {
        for (let ty = sy + 14; ty < sy + sh - 14; ty += 28) {
          const ox  = (rng() - 0.5) * 18;
          const oy  = (rng() - 0.5) * 18;
          const key = treeTex[Math.floor(rng() * treeTex.length)];
          // Raw Y depth so trees Y-sort with the player — when the player passes
          // through a gap and stands north of the belt, trees (depth ~1245–1335)
          // correctly render in front of the player (depth = player.y < 1240).
          this.add.image(tx + ox, ty + oy, key).setScale(0.5).setDepth(ty + oy);
        }
      }
    }

    // ── Highland Rim: rock scatter along the two rim segments ─────────────────
    const rimSegments: [number, number, number, number][] = [
      [0,    830, 2830, 90],
      [2930, 830, 1570, 90],
    ];
    for (const [sx, sy, sw, sh] of rimSegments) {
      for (let tx = sx + 14; tx < sx + sw - 14; tx += 28) {
        for (let ty = sy + 12; ty < sy + sh - 12; ty += 28) {
          const ox = (rng() - 0.5) * 18;
          const oy = (rng() - 0.5) * 18;
          // Raw Y depth — same rationale as forest-belt trees above.
          this.add.image(tx + ox, ty + oy, 'rock-grass')
            .setScale(0.5 + rng() * 0.5)
            .setDepth(ty + oy);
        }
      }
    }
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
      // Trees near SW spawn (300, 2650) — flanking the shore clearing
      { x: 160, y: 2520 }, { x: 420, y: 2480 }, { x: 560, y: 2510 }, { x: 680, y: 2540 },
      { x: 140, y: 2800 }, { x: 380, y: 2830 }, { x: 540, y: 2810 }, { x: 720, y: 2780 },
    ];
    const rockDefs = [
      { x: 220, y: 2590 }, { x: 600, y: 2600 },
      { x: 190, y: 2750 }, { x: 620, y: 2730 },
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
    // Start the run timer now — this.time.now is ms since the Phaser game started
    this.gameStartedAt = this.time.now;
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

    // Pre-filter typed lists for predator/prey checks — cheaper than O(n²) getData calls.
    // Player-controlled animals skip AI entirely, so exclude them here too.
    const foxSprites  = (this.groundAnimals.getChildren() as Phaser.GameObjects.Sprite[])
      .filter(a => !a.getData('playerControlled') && a.getData('animalType') === 'fox');
    const hareSprites = (this.groundAnimals.getChildren() as Phaser.GameObjects.Sprite[])
      .filter(a => !a.getData('playerControlled') && a.getData('animalType') === 'hare');

    for (const child of this.groundAnimals.getChildren()) {
      // Ground animals are now sprites (FIL-73); cast accordingly.
      const r  = child as Phaser.GameObjects.Sprite;
      // Y-sort with the same raw-Y system as chunk-placed trees so animals
      // correctly pass behind/in-front of trees and the player as they move.
      r.setDepth(r.y);
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
          const rustleKey = `animal-rustle-${Phaser.Math.Between(0, 4)}`;
        if (this.audioAvailable && this.cache.audio.has(rustleKey)) this.sound.play(rustleKey, { volume: 0.5 });
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

      // ── Predator/prey: fox chases hare ─────────────────────────────────────────
      // Player-flee takes priority — a fox that is already fleeing the player won't
      // simultaneously chase a hare. Once the player retreats the fox will resume.
      if (type === 'fox' && state !== 'fleeing') {
        let nearestHare: Phaser.GameObjects.Sprite | null = null;
        let nearestDist = FOX_CHASE_RANGE;
        for (const hare of hareSprites) {
          const d = Phaser.Math.Distance.Between(r.x, r.y, hare.x, hare.y);
          if (d < nearestDist) { nearestDist = d; nearestHare = hare; }
        }
        if (nearestHare) {
          if (state !== 'chasing') {
            state = 'chasing';
            r.setData('animalState', state);
            r.play('fox-walk-anim');
          }
          r.setData('chaseTarget', nearestHare); // refreshed each frame to track movement
        } else if (state === 'chasing') {
          state = 'roaming';
          r.setData('animalState', state);
          r.setData('chaseTarget', null);
          r.setData('roamNext', this.time.now + Phaser.Math.Between(2000, 5000));
          r.play('fox-idle-anim');
        }
      }

      // Hares flee from nearby foxes using the same mechanism as player-flee.
      // 'fleeFromX/Y' is set each frame so the hare always tracks the closest threat.
      if (type === 'hare') {
        let nearestFox: Phaser.GameObjects.Sprite | null = null;
        let nearestFoxDist = def.fleeRange;
        for (const fox of foxSprites) {
          const d = Phaser.Math.Distance.Between(r.x, r.y, fox.x, fox.y);
          if (d < nearestFoxDist) { nearestFoxDist = d; nearestFox = fox; }
        }
        if (nearestFox) {
          if (state !== 'fleeing') {
            state = 'fleeing';
            r.setData('animalState', state);
            r.play('hare-walk-anim');
          }
          r.setData('fleeFromX', nearestFox.x);
          r.setData('fleeFromY', nearestFox.y);
        } else {
          // No fox nearby — default flee origin is the player.
          r.setData('fleeFromX', px);
          r.setData('fleeFromY', py);
        }
      }

      if (state === 'fleeing') {
        // Hares store their flee origin (fox or player); all others flee the player.
        const ftx = type === 'hare' ? (r.getData('fleeFromX') as number) : px;
        const fty = type === 'hare' ? (r.getData('fleeFromY') as number) : py;
        const away = Phaser.Math.Angle.Between(ftx, fty, r.x, r.y);
        this.physics.velocityFromRotation(away, def.fleeSpeed, b.velocity);
      } else if (state === 'chasing') {
        const target = r.getData('chaseTarget') as Phaser.GameObjects.Sprite | null;
        if (target?.active) {
          const toward = Phaser.Math.Angle.Between(r.x, r.y, target.x, target.y);
          this.physics.velocityFromRotation(toward, def.fleeSpeed, b.velocity);
          // Flip sprite so the fox faces the direction it is running.
          r.setFlipX(Math.cos(toward) < 0);
        }
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
   * Maps a biome value to a WebGL tint colour applied to each terrain tile.
   * Tinting multiplies per-channel so tile pixel detail is preserved — only
   * the dominant hue shifts. Bright tint components (≥ 0x90) keep tiles
   * readable; dark components deepen shadows naturally.
   *
   * Breakpoints mirror terrainTileFrame() so tint matches the tile type:
   *   sea          < 0.25  → deep blue
   *   rocky shore  < 0.30  → warm sandy stone
   *   coastal heath< 0.42  → light olive
   *   mixed forest < 0.62  → fresh mid-green
   *   dense forest < 0.78  → deep forest green
   *   highland     ≥ 0.78  → cool granite grey
   */
  private biomeTint(val: number): number {
    if (val < 0.25) return 0x7ab0d8; // sea — blue
    if (val < 0.30) return 0xd4a86a; // rocky shore — warm sandy
    if (val < 0.42) return 0xb8d480; // coastal heath — light olive
    if (val < 0.62) return 0x80c068; // mixed forest — fresh green
    if (val < 0.78) return 0x50904a; // dense forest — deep green
    return 0xb8b4ac;                  // highland — cool grey
  }

  /**
   * Draws a per-tile biome colour wash at depth 0.1 — just above the baked terrain.
   * Tiles are grouped by biome colour before drawing so all tiles of the same hue
   * are issued as one fillStyle + N fillRect calls, minimising GPU state changes.
   * Per-tile resolution (32×32 px) means there are no visible seams at biome
   * boundaries — the noise gradient produces smooth organic edges.
   */
  private drawBiomeColorWash(noise: FbmNoise, tilesX: number, tilesY: number): void {

    // First pass: collect every non-water tile position, grouped by biome tint.
    // Using a flat array per tint avoids repeated map lookups during the draw pass.
    const groups = new Map<number, number[]>(); // tint → flat [x0, y0, x1, y1, ...]

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        // Use ONLY the low-frequency base noise here — omitting detail noise keeps
        // biome colour regions large and smoothly-edged. The terrain tile below still
        // uses detail noise for fine texture; the wash is purely about zone identity.
        const base   = noise.fbm(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
        const perpDiag     = (tx / tilesX - (1 - ty / tilesY)) / 2;
        const mountainBias = Math.pow(Math.max(0, -perpDiag - 0.10), 1.5) * 4.0;
        const oceanBias    = Math.pow(Math.max(0, perpDiag  - 0.15), 1.5) * 3.0;
        const val = Math.max(0, Math.min(1.2, base + mountainBias - oceanBias));

        if (val < 0.25) continue; // water already has identity from animated sprites

        const tint = this.biomeTint(val);
        let arr = groups.get(tint);
        if (!arr) { arr = []; groups.set(tint, arr); }
        arr.push(tx * TILE_SIZE, ty * TILE_SIZE);
      }
    }

    // Second pass: one fillStyle() per biome colour, then fillRect for every tile of that colour.
    // This keeps GPU state changes to ~5 (one per biome type) regardless of world size.
    const gfx = this.add.graphics().setDepth(0.1);
    for (const [tint, coords] of groups) {
      gfx.fillStyle(tint, 0.45);
      for (let i = 0; i < coords.length; i += 2) {
        gfx.fillRect(coords[i], coords[i + 1], TILE_SIZE, TILE_SIZE);
      }
    }
  }

  /**
   * Draws a thin dark shadow strip on the south face of every highland tile that
   * borders a lower biome. This fakes a vertical cliff face in top-down view —
   * the same trick used in Stardew Valley and CrossCode to convey elevation without
   * any actual 3D geometry. Depth 0.45 sits between the biome wash (0.1) and paths
   * (1) so the edge is visible but doesn't overpower the terrain texture below.
   */
  private drawCliffEdges(biomeGrid: Float32Array, tilesX: number, tilesY: number): void {
    const HIGHLAND = 0.78;
    const gfx = this.add.graphics().setDepth(0.45);

    gfx.fillStyle(0x000000, 0.40);
    for (let ty = 0; ty < tilesY - 1; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const val  = biomeGrid[ty       * tilesX + tx];
        const valS = biomeGrid[(ty + 1) * tilesX + tx];
        // South-facing cliff: highland tile above, lower biome below.
        if (val >= HIGHLAND && valS < HIGHLAND) {
          gfx.fillRect(tx * TILE_SIZE, (ty + 1) * TILE_SIZE, TILE_SIZE, 10);
        }
      }
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

    // 4-frame water ripple animation played by live sprites overlaid on the baked terrain.
    // frameRate 4 → one 1-second cycle; subtle enough not to distract from gameplay.
    // Created here so it is ready when we call sprite.play() after the bake loop.
    this.anims.create({
      key: 'water-anim',
      frames: this.anims.generateFrameNumbers('terrain-water', { frames: [0, 1, 2, 3] }),
      frameRate: 4,
      repeat: -1,
    });

    // All tiles (including water) are drawn into a pre-baked RenderTexture so the
    // entire terrain costs one GPU draw call at runtime — ~100× faster than per-tile flushes.
    // We use beginDraw() + batchDraw() + endDraw() to flush the WebGL batch only ONCE.
    const terrainRt = this.add.renderTexture(0, 0, WORLD_W, WORLD_H).setDepth(0);

    // Reuse a single off-screen Image to draw scaled (32×32) tiles from the
    // 16×16 tileset frames. setTexture() + setPosition() change state without
    // creating a new object each iteration.
    const tileImg = this.add.image(-9999, -9999, 'mw-plains', 0)
      .setScale(2)        // 16px → 32px to match TILE_SIZE
      .setVisible(false);

    // Collect water tile centres for the animated sprite pass below.
    // stride 2 (tx & ty both even) → 1/4 of water tiles; cap 1500 keeps mobile GPU load small.
    const waterCentres: number[] = []; // flat [cx0, cy0, cx1, cy1, ...]

    // Biome grid — one float per tile — stored for the cliff-edge shadow pass below.
    // Float32Array is cheap (~52 KB for 141×94 tiles) and avoids re-sampling the noise.
    const biomeGrid = new Float32Array(tilesX * tilesY);

    // Open a single batch for the entire terrain — no WebGL flush per tile.
    terrainRt.beginDraw();

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const base   = noise.fbm(tx * BASE_SCALE,     ty * BASE_SCALE,     4, 0.5);
        const detail = detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE,   2, 0.6);

        // Diagonal SW→NE corridor gradient. perpDiag<0 = NW mountains, perpDiag>0 = SE ocean.
        // Power-curve biases push flanks to extreme biomes (mountain >0.90, ocean <0.25).
        const perpDiag     = (tx / tilesX - (1 - ty / tilesY)) / 2;
        const mountainBias = Math.pow(Math.max(0, -perpDiag - 0.10), 1.5) * 4.0;
        const oceanBias    = Math.pow(Math.max(0, perpDiag  - 0.15), 1.5) * 3.0;
        const val = Math.max(0, Math.min(1.2, base * 0.70 + detail * 0.30 + mountainBias - oceanBias));

        biomeGrid[ty * tilesX + tx] = val;

        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;

        // Draw the matching tileset frame (including water) scaled 2× to fill the 32×32 tile.
        // batchDraw() uses the image's own position — no per-tile batch flush.
        // Biome tint multiplies with each tile's pixel colours so the tile detail
        // stays visible while each region gets a distinct dominant hue — the same
        // technique CrossCode uses to give each zone a clear visual identity.
        const { key, frame } = terrainTileFrame(val, detail);
        tileImg.setTexture(key, frame).setPosition(wx + 16, wy + 16);
        terrainRt.batchDraw(tileImg);

        // Mark every 2nd water tile (in both axes) for the animated overlay pass.
        if (key === 'terrain-water' && tx % 2 === 0 && ty % 2 === 0 && waterCentres.length < 3000) {
          waterCentres.push(wx + 16, wy + 16);
        }
      }
    }

    // Spawn clearing — stamp earthy shore tiles (mw-plains row 0) over the underlying
    // biome in a circular patch so the player has a recognisable gravel landmark.
    // Done inside beginDraw()/endDraw() so it costs zero extra GPU draw calls.
    // Cycling frames 0–5 uses the full row width to break up visible tiling.
    // Spawn clearing stamps plain shore tiles — no tint needed here.
    const sx = Math.floor(SPAWN_X / TILE_SIZE);
    const sy = Math.floor(SPAWN_Y / TILE_SIZE);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 7) {
          const frame = (Math.abs(dx) * 2 + Math.abs(dy)) % 6;
          tileImg.setTexture('mw-plains', frame)
                 .setPosition((sx + dx) * TILE_SIZE + 16, (sy + dy) * TILE_SIZE + 16);
          terrainRt.batchDraw(tileImg);
        }
      }
    }

    terrainRt.endDraw();
    tileImg.destroy();

    // ── Biome colour wash (depth 0.1) ────────────────────────────────────────
    // A coarse-grid Graphics layer drawn at low alpha over the terrain texture.
    // Gives each biome region a distinct dominant hue — the same visual technique
    // CrossCode uses so players instantly read "I'm in the forest / shore / highlands".
    // Using TILE_SIZE*6 (192px) cells keeps it under 200 fillRect calls while still
    // matching the noise gradient closely enough to look organic at play zoom.
    this.drawBiomeColorWash(noise, tilesX, tilesY);
    // Cliff-edge shadows (depth 0.45) render on top of the colour wash but below paths.
    this.drawCliffEdges(biomeGrid, tilesX, tilesY);

    // Place animated water sprites at depth 0.5 — just above the static terrain bake (0)
    // but below decorations (2+). Each sprite covers the baked water tile underneath.
    // Stagger start frames (0-3) so adjacent tiles don't flash in sync.
    const waterAnim = this.anims.get('water-anim');
    for (let i = 0; i < waterCentres.length; i += 2) {
      const spr = this.add.sprite(waterCentres[i], waterCentres[i + 1], 'terrain-water');
      spr.setScale(2).setDepth(0.5);
      spr.play('water-anim');
      spr.anims.setCurrentFrame(waterAnim.frames[(i / 2) % 4]);
    }
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

  // ─── Settlement markers (FIL-76) ─────────────────────────────────────────────

  /**
   * Draw a dashed circle boundary and name label for each settlement.
   *
   * Phaser's Graphics object has no native dashed-stroke, so we simulate it
   * by drawing 20 short polyline arcs around the circle with gaps between them.
   * Each arc is approximated by 4 line segments — enough smoothness at this scale.
   *
   * Depth 4: above terrain (0), paths (1), and corruption overlays (3) so the
   * settlement boundary stays readable even inside a heavily corrupted zone.
   */
  /**
   * Draw settlement markers: soft fill, path spur, dashed circle boundary,
   * center icon, and name label.
   *
   * Draw order within each settlement (painter's algorithm on a single Graphics):
   *   1. Fill  — large soft disc; must come first so later strokes render on top
   *   2. Spur  — dirt-track line connecting to the nearest PathSystem segment
   *   3. Dashed circle — boundary ring
   *   4. House icon — small roof+base silhouette at center
   */
  private drawSettlementMarkers(): void {
    const gfx = this.add.graphics();
    gfx.setDepth(4);

    for (const s of SETTLEMENTS) {
      // Warm tan for villages, muted grey-brown for hamlets — used by stroke and icon
      const strokeColor = s.type === 'village' ? 0xd4b483 : 0xa08870;

      // ── 1. Soft fill ──────────────────────────────────────────────────────────
      // Low-alpha disc tints the terrain underneath without obscuring it.
      const fillColor = s.type === 'village' ? 0xe8c878 : 0xc8b898;
      gfx.fillStyle(fillColor, s.type === 'village' ? 0.10 : 0.08);
      gfx.fillCircle(s.x, s.y, s.radius);

      // ── 2. Path spur ──────────────────────────────────────────────────────────
      // Find the nearest point on any PathSystem segment (each segment is an
      // axis-aligned rect — clamp the settlement centre into the rect to get
      // the closest point). Draw a dirt-coloured line from there to the centre.
      let nearestDist = Infinity, nearestX = s.x, nearestY = s.y;
      for (const seg of this.pathSystem.getSegments()) {
        const nx = Phaser.Math.Clamp(s.x, seg.x, seg.x + seg.w);
        const ny = Phaser.Math.Clamp(s.y, seg.y, seg.y + seg.h);
        const d  = Phaser.Math.Distance.Between(s.x, s.y, nx, ny);
        if (d < nearestDist) { nearestDist = d; nearestX = nx; nearestY = ny; }
      }
      // Only draw a spur if the settlement isn't already sitting on a path
      if (nearestDist > s.radius * 0.5) {
        gfx.lineStyle(3, 0xb8905a, 0.35); // matches dirt-path colour in PathSystem
        gfx.beginPath();
        gfx.moveTo(nearestX, nearestY);
        gfx.lineTo(s.x, s.y);
        gfx.strokePath();
      }

      // ── 3. Dashed circle boundary ─────────────────────────────────────────────
      // 20 dash + 20 gap segments evenly distributed around the full circle.
      // dashAngle = angle spanned by one dash; gap is the same size.
      gfx.lineStyle(2, strokeColor, 0.9);
      const dashCount = 20;
      const dashAngle = Math.PI / dashCount; // π/20 ≈ 9° per dash
      for (let i = 0; i < dashCount; i++) {
        const startAngle = i * dashAngle * 2;
        // Approximate the arc as a 4-segment polyline
        const pts: { x: number; y: number }[] = [];
        for (let j = 0; j <= 4; j++) {
          const a = startAngle + dashAngle * (j / 4);
          pts.push({
            x: s.x + Math.cos(a) * s.radius,
            y: s.y + Math.sin(a) * s.radius,
          });
        }
        gfx.strokePoints(pts, false);
      }

      // ── 4. Center icon (house silhouette) ─────────────────────────────────────
      // A minimal house shape: triangle roof + rectangle base. Drawn in the same
      // colour as the dashed boundary so it reads as part of the same marker.
      const ic = 10; // half-width of the icon
      gfx.fillStyle(strokeColor, 0.9);
      // Roof — isoceles triangle above the base
      gfx.fillTriangle(
        s.x,       s.y - ic,         // apex
        s.x - ic,  s.y - ic * 0.3,  // bottom-left
        s.x + ic,  s.y - ic * 0.3,  // bottom-right
      );
      // Base — slightly narrower rectangle
      gfx.fillRect(s.x - ic * 0.65, s.y - ic * 0.3, ic * 1.3, ic * 0.9);

      // ── Name label ────────────────────────────────────────────────────────────
      this.add.text(s.x, s.y - s.radius - 10, s.name, {
        fontFamily: 'Georgia, serif',
        fontSize: '13px',
        color: s.type === 'village' ? '#d4b483' : '#b09878',
        stroke: '#111111',
        strokeThickness: 3,
        align: 'center',
      })
        .setOrigin(0.5, 1)
        .setDepth(4);
    }
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
      1500,
    );

    for (const d of decors) {
      const texture = decorTexture(d.type, d.variant);
      const sprite = this.add.image(d.x, d.y, texture);
      sprite.setScale(d.scale);
      // Sort by y so decorations further down the screen render in front —
      // the standard "painter's algorithm" for top-down 2D.
      sprite.setDepth(2 + d.y / WORLD_H);

      // Grass tufts sway gently — a sine-eased angle tween rocks each tuft ±3°.
      // Duration and delay are derived from world position so adjacent tufts
      // don't oscillate in lockstep; coprime multipliers prevent axis-aligned banding.
      if (d.type === 'tuft') {
        this.tweens.add({
          targets: sprite,
          angle: { from: -3, to: 3 },
          ease: 'Sine.easeInOut',
          duration: 1200 + (Math.abs(d.x + d.y) % 600), // 1.2–1.8 s cycle
          yoyo: true,
          repeat: -1,
          delay: Math.abs(d.x * 3 + d.y * 7) % 1500,  // 0–1.5 s stagger
        });
      }
    }
  }

  // ─── Particle effects (FIL-57) ───────────────────────────────────────────────

  /**
   * Create particle textures and emitters for all three phase-gated effects:
   *   dawn/dusk   → falling leaves
   *   day phases  → drifting pollen
   *   night       → fireflies near the player
   *
   * Textures are generated programmatically — no external sprite sheet needed.
   * All emitters start paused; applyParticlePhase() activates the right one on
   * each day/night transition.
   *
   * Phaser 3.60+ particle API: this.add.particles(x, y, key, config) returns a
   * ParticleEmitter directly. setEmitting(false) starts it in a paused state.
   */
  private spawnParticleEffects(): void {
    // Generate tiny particle textures with Graphics — avoids any load dependency.
    // generateTexture() bakes the Graphics commands into a named cache entry.
    // add.graphics() + setVisible(false) keeps it off-screen; generateTexture()
    // works on any Graphics object regardless of display-list membership.
    const g = this.add.graphics().setVisible(false);

    // Leaf: muted green-brown oval (falling autumn/spring leaf)
    g.fillStyle(0x6a8a40, 1);
    g.fillEllipse(4, 3, 8, 6);
    g.generateTexture('particle-leaf', 8, 6);
    g.clear();

    // Pollen: tiny pale-yellow dot
    g.fillStyle(0xffee88, 1);
    g.fillCircle(1.5, 1.5, 1.5);
    g.generateTexture('particle-pollen', 3, 3);
    g.clear();

    // Firefly: soft warm-white circle — small enough to feel like a point of light
    g.fillStyle(0xffffaa, 1);
    g.fillCircle(2.5, 2.5, 2.5);
    g.generateTexture('particle-firefly', 5, 5);
    g.destroy();

    // ── Leaves (screen-space, depth 3) ───────────────────────────────────────
    // setScrollFactor(0) pins them to the camera so they always rain across the
    // visible viewport regardless of world position.
    // Slow fall speed + rotation gives a natural tumbling leaf feel.
    this.leavesEmitter = this.add.particles(0, -10, 'particle-leaf', {
      x:        { min: 0, max: 800 },
      speedY:   { min: 25, max: 70 },
      speedX:   { min: -20, max: 20 },
      rotate:   { min: 0, max: 360 },
      alpha:    { start: 0.7, end: 0 },
      scale:    { min: 0.8, max: 1.6 },
      lifespan: 9000,
      frequency: 300,
      quantity:  1,
      emitting: false,
    }).setScrollFactor(0).setDepth(3);

    // ── Pollen (screen-space, depth 3) ───────────────────────────────────────
    // Slow upward drift with slight horizontal wobble — spring pollen in sunlight.
    this.pollenEmitter = this.add.particles(0, 0, 'particle-pollen', {
      x:        { min: 0, max: 800 },
      y:        { min: 0, max: 600 },
      speedY:   { min: -12, max: -4 },
      speedX:   { min: -8, max: 8 },
      alpha:    { start: 0.5, end: 0 },
      scale:    { min: 0.6, max: 1.2 },
      lifespan: 7000,
      frequency: 500,
      quantity:  1,
      emitting: false,
    }).setScrollFactor(0).setDepth(3);

    // ── Fireflies (world-space, depth 3.5) ───────────────────────────────────
    // World-space so they appear to exist in the environment rather than on the HUD.
    // Position is updated each frame in update() to follow the player, keeping
    // fireflies visible in the camera's current view without flooding the whole world.
    // Fade-in / hold / fade-out lifecycle creates a natural blink effect.
    this.fireflyEmitter = this.add.particles(SPAWN_X, SPAWN_Y, 'particle-firefly', {
      x:        { min: -350, max: 350 },
      y:        { min: -250, max: 250 },
      speedX:   { min: -8, max: 8 },
      speedY:   { min: -8, max: 8 },
      alpha:    { start: 0.85, end: 0 },
      scale:    { min: 0.4, max: 1.0 },
      lifespan: 3500,
      frequency: 600,
      quantity:  1,
      emitting: false,
    }).setDepth(3.5);

    // Set initial emitter state for the phase the clock starts in
    this.applyParticlePhase(this.currentPhase);
  }

  /**
   * Start/stop the right particle emitters for the current day phase.
   * Called once on startup (spawnParticleEffects) and again on every transition
   * (updateDayNight) so the effects always match the visible sky tint.
   */
  private applyParticlePhase(phase: DayPhase): void {
    // Optional chaining guards the brief window before create() assigns the emitters.
    // ParticleEmitter.emitting is a writable boolean — true = actively emitting.
    if (this.leavesEmitter)  this.leavesEmitter.emitting  = phase === 'dawn' || phase === 'dusk';
    if (this.pollenEmitter)  this.pollenEmitter.emitting   = phase === 'morning' || phase === 'midday' || phase === 'afternoon';
    if (this.fireflyEmitter) this.fireflyEmitter.emitting  = phase === 'night';
  }

  // ─── Butterflies and bees (FIL-59) ──────────────────────────────────────────

  /**
   * Place small ambient butterfly and bee creatures in meadow/heath areas.
   *
   * No sprite sheets are available for insects, so textures are generated from
   * Graphics: butterflies as two overlapping ellipses (wings) plus a thin body,
   * bees as a striped oval. Both are tiny — 10×7 and 6×4 px respectively.
   *
   * Each creature gets two tweens:
   *  1. Wing flutter — angle ±8° at 180 ms cycle (same sine-yoyo pattern as grass
   *     sway, just faster and wider).
   *  2. Drift — tweens x/y to a random target within 120 px, picks a new target on
   *     completion, repeating indefinitely.
   *
   * Placement uses baseNoise + the same coastal gradient as drawProceduralTerrain()
   * so creatures only appear in biome range 0.33–0.65 (coastal heath → mixed forest
   * = flower zones). A mulberry32 RNG keyed on runSeed makes placement deterministic.
   */
  private spawnButterfliesAndBees(): void {
    // ── Generate textures ────────────────────────────────────────────────────
    const g = this.add.graphics().setVisible(false);

    // Butterfly: two wing ellipses side-by-side + narrow dark body
    g.fillStyle(0xe87c3e, 1); g.fillEllipse(3, 3.5, 5, 5);   // left wing
    g.fillStyle(0xf4a940, 1); g.fillEllipse(7, 3.5, 5, 5);   // right wing
    g.fillStyle(0x3a2a1a, 1); g.fillRect(4.5, 1, 1, 6);       // body
    g.generateTexture('butterfly-tex', 10, 7);
    g.clear();

    // Bee: yellow oval with dark stripe bands
    g.fillStyle(0xf5c518, 1); g.fillEllipse(3, 2, 6, 4);      // body
    g.fillStyle(0x2a1a00, 1); g.fillRect(2, 1, 1, 2);          // stripe 1
    g.fillStyle(0x2a1a00, 1); g.fillRect(4, 1, 1, 2);          // stripe 2
    g.generateTexture('bee-tex', 6, 4);
    g.destroy();

    // ── Placement ────────────────────────────────────────────────────────────
    const rng = mulberry32(this.runSeed ^ 0xbee5f1a7);
    const rand = () => rng();

    // Drift helper — picks a new random target within 120 px and tweens to it,
    // then calls itself again on completion for continuous ambient movement.
    const drift = (img: Phaser.GameObjects.Image) => {
      const nx = Phaser.Math.Clamp(img.x + (rand() - 0.5) * 240, 0, WORLD_W);
      const ny = Phaser.Math.Clamp(img.y + (rand() - 0.5) * 240, 0, WORLD_H);
      this.tweens.add({
        targets: img, x: nx, y: ny,
        duration: 3000 + rand() * 3000,
        ease: 'Sine.easeInOut',
        onComplete: () => drift(img),
      });
    };

    const STEP = 160; // sample grid spacing — balances coverage vs candidate count
    let placed = 0;

    for (let wy = STEP / 2; wy < WORLD_H && placed < 60; wy += STEP) {
      for (let wx = STEP / 2; wx < WORLD_W && placed < 60; wx += STEP) {
        // Biome check — identical to drawProceduralTerrain() so placement aligns
        // with the visible ground type. Skip water and highland biomes.
        const tx = wx / TILE_SIZE;
        const ty = wy / TILE_SIZE;
        const base       = this.baseNoise.fbm(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
        const perpD = (wx / WORLD_W - (1 - wy / WORLD_H)) / 2;
        const mtB   = Math.pow(Math.max(0, -perpD - 0.10), 1.5) * 4.0;
        const ocB   = Math.pow(Math.max(0, perpD  - 0.15), 1.5) * 3.0;
        const biome = Math.max(0, Math.min(1.2, base * 0.70 + mtB - ocB));
        if (biome < 0.33 || biome > 0.65) continue;

        // Randomise actual position within the grid cell
        const jx = (rand() - 0.5) * STEP;
        const jy = (rand() - 0.5) * STEP;
        const x  = Phaser.Math.Clamp(wx + jx, 0, WORLD_W);
        const y  = Phaser.Math.Clamp(wy + jy, 0, WORLD_H);

        // 60 % butterflies, 40 % bees (matches approximate flower/clover split)
        const key = rand() < 0.6 ? 'butterfly-tex' : 'bee-tex';
        const img = this.add.image(x, y, key);
        img.setDepth(2 + y / WORLD_H).setScale(1.5);

        // Wing flutter — ±8° at 180 ms; butterflies slightly faster than bees
        this.tweens.add({
          targets: img,
          angle: { from: -8, to: 8 },
          ease: 'Sine.easeInOut',
          duration: key === 'butterfly-tex' ? 160 : 220,
          yoyo: true,
          repeat: -1,
          delay: rand() * 300,
        });

        drift(img);
        placed++;
      }
    }
  }

  // ─── Settlement buildings (FIL-78 / FIL-79) ─────────────────────────────────

  /**
   * Scatter building sprites inside each settlement boundary.
   *
   * Buildings are placed via rejection sampling in the annulus between a small
   * central clearing and the settlement edge, using a deterministic per-settlement
   * RNG so the layout is identical on every load.
   *
   * Each building gets:
   *  - A Pixel Crawler Roofs.png sprite scaled to fit the footprint (depth 3.5)
   *  - An invisible staticImage added to solidObjects so the player collides with it
   *
   * Named frames are registered once from the Roofs.png sheet using
   * this.textures.get().add() — Phaser's way of defining atlas frames at runtime
   * when the source pack doesn't ship a JSON atlas.
   */
  private stampSettlementBuildings(): void {
    // Register named crop-regions on the already-loaded 'building-roofs' texture.
    // Coordinates measured from the 400×400 Roofs.png sheet (white-background sprite atlas).
    const roofTex = this.textures.get('building-roofs');
    roofTex.add('roof-brown-large',   0,   0,   0, 120,  70); // large brown gabled roof
    roofTex.add('roof-green-large',   0, 130,   0, 120,  70); // large green tiled roof
    roofTex.add('roof-blue',          0, 270,   0,  90,  70); // blue glass/striped roof
    roofTex.add('roof-brown-small',   0,   0, 210,  60,  50); // small brown peaked roof
    roofTex.add('roof-green-complex', 0, 140,  80, 120, 110); // green hall with base

    for (const s of SETTLEMENTS) {
      // Hash the settlement id string to a numeric seed (djb2-style multiplicative hash)
      let seed = 0;
      for (let i = 0; i < s.id.length; i++) {
        seed = (Math.imul(seed, 31) + s.id.charCodeAt(i)) >>> 0;
      }
      const rng = mulberry32(seed);

      const count = s.type === 'hamlet'
        ? 3 + Math.floor(rng() * 3)   // 3–5
        : 8 + Math.floor(rng() * 7);  // 8–14

      // Keep a small clearing at the settlement centre (e.g. a market square)
      const clearR = s.radius * 0.2;

      // Track placed AABBs for overlap rejection
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];

      let placed_count = 0;
      const maxAttempts = count * 20;

      for (let attempt = 0; attempt < maxAttempts && placed_count < count; attempt++) {
        // Uniform random point in annulus [clearR, radius-20] using sqrt trick
        const angle = rng() * Math.PI * 2;
        const dist  = clearR + Math.sqrt(rng()) * (s.radius - clearR - 20);
        const bx = s.x + Math.cos(angle) * dist;
        const by = s.y + Math.sin(angle) * dist;

        const bw = 24 + Math.floor(rng() * 20); // 24–43 px — drives sprite scale + overlap check
        const bh = 18 + Math.floor(rng() * 16); // 18–33 px — used for overlap check only

        // AABB overlap check against already-placed buildings (4 px gap)
        const gap = 4;
        const left   = bx - bw / 2 - gap;
        const right  = bx + bw / 2 + gap;
        const top    = by - bh / 2 - gap;
        const bottom = by + bh / 2 + gap;

        let overlaps = false;
        for (const p of placed) {
          if (right  > p.x - p.w / 2 &&
              left   < p.x + p.w / 2 &&
              bottom > p.y - p.h / 2 &&
              top    < p.y + p.h / 2) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;

        placed.push({ x: bx, y: by, w: bw, h: bh });
        placed_count++;

        // Pick a roof sprite frame appropriate to the settlement type.
        // Hamlet gets rustic brown frames; village gets tiled green frames.
        const frameKey = s.type === 'hamlet'
          ? (rng() < 0.6 ? 'roof-brown-large' : 'roof-brown-small')
          : (rng() < 0.5 ? 'roof-green-large' : rng() < 0.5 ? 'roof-blue' : 'roof-green-complex');

        // Scale the sprite uniformly so its display-width equals bw;
        // height follows naturally from the frame's aspect ratio.
        const img = this.add.image(bx, by, 'building-roofs', frameKey);
        const sprScale = bw / img.width;
        img.setScale(sprScale);
        img.setDepth(3.5);

        // Warm glow circle — lights up at dusk/night via ADD blend (FIL-80).
        // Starts at alpha 0 (invisible) and is tweened by updateDayNight().
        const glow = this.add.circle(bx, by, Math.max(bw, img.height * sprScale) * 0.55, 0xffaa33, 0);
        glow.setDepth(3.4).setBlendMode(Phaser.BlendModes.ADD);
        this.settlementGlows.push(glow);

        // Invisible physics body sized to the sprite's actual displayed footprint.
        // 'rock-grass' is always preloaded — any always-available texture works here.
        const physRect = this.physics.add.staticImage(bx, by, 'rock-grass');
        physRect.setVisible(false);
        const body = physRect.body as Phaser.Physics.Arcade.StaticBody;
        body.setSize(bw, img.height * sprScale);
        body.reset(bx, by);
        this.solidObjects.add(physRect);
      }
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

    // ── Corruption SFX ───────────────────────────────────────────────────────
    // Level 1 uses corruptionSfxMultiplier = 1.0 (baseline — rare, out of place).
    // When Levels 2–5 get their own update methods they'll pass higher multipliers.
    // See LevelMusicConfig.ts for the full per-level design.
    this.maybePlayCorruptionSfx(delta, 1.0);

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

    // ── Boss: entrance pan + HUD update ──────────────────────────────────────
    if (this.bossAlive && this.boss) {
      if (!this.bossEntranceDone) {
        const distToBoss = Phaser.Math.Distance.Between(px, py, BOSS_X, BOSS_Y);
        if (distToBoss < BOSS_ENTRANCE_RADIUS) {
          this.triggerBossEntrance();
        }
      }
      this.updateBossHud();
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

    // Collectible pickup jingle
    if (this.audioAvailable && this.cache.audio.has('sfx-pickup')) {
      this.sound.play('sfx-pickup', { volume: 0.55 });
    }

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
   * Place standing NPC figures inside each settlement clearing (FIL-80).
   * Uses pc-idle-down frame 0 scaled small — no animation, just a visible
   * humanoid silhouette that signals "something to interact with here".
   */
  private spawnSettlementNpcs(): void {
    for (const s of SETTLEMENTS) {
      const count = s.type === 'village' ? 2 : 1;
      for (let i = 0; i < count; i++) {
        // Spread NPCs evenly around the inner clearing using equal-angle sectors
        const angle = (i / count) * Math.PI * 2;
        const r = s.radius * 0.25;
        const nx = s.x + Math.cos(angle) * r;
        const ny = s.y + Math.sin(angle) * r;
        const npc = this.add.image(nx, ny, 'pc-idle-down', 0);
        // Scale 0.35 makes the 64×64 frame appear at ~22 px — readable at zoom 2
        npc.setScale(0.35);
        npc.setDepth(2 + ny / WORLD_H);
        npc.setData('settlementId', s.id);
        this.settlementNpcs.push(npc);
      }
    }
  }

  /**
   * Check whether the player is close enough to any NPC to interact (FIL-80).
   * Shows a prompt when within 80 px; E key launches NpcDialogScene and pauses.
   */
  private updateNpcProximity(): void {
    if (this.npcDialogActive) return;
    for (const npc of this.settlementNpcs) {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.x, npc.y) < 80) {
        if (this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
          this.npcDialogActive = true;
          const sid = npc.getData('settlementId') as string;
          const dialogData: NpcDialogData = {
            callerKey: this.scene.key,
            text: NPC_DIALOG[sid] ?? 'Välkommen.',
          };
          this.scene.pause();
          this.scene.launch('NpcDialogScene', dialogData as unknown as object);
        }
        return; // only the nearest NPC counts per frame
      }
    }
  }

  // ── Upgrade shrine (FIL-130) ────────────────────────────────────────────────

  /**
   * Spawn the upgrade shrine visual at shrinePos — a gold circle with a label.
   * Interact prompt is hidden until the player walks within 80 px.
   */
  private createShrine(): void {
    this.add
      .arc(this.shrinePos.x, this.shrinePos.y, 10, 0, 360, false, 0xffe066)
      .setDepth(this.shrinePos.y);

    this.add
      .text(this.shrinePos.x, this.shrinePos.y - 24, 'Upgrade Shrine', {
        fontSize: '10px',
        color: '#ffe066',
      })
      .setOrigin(0.5)
      .setDepth(this.shrinePos.y + 1);

    this.shrinePromptText = this.add
      .text(this.shrinePos.x, this.shrinePos.y - 42, 'E: Upgrade', {
        fontSize: '10px',
        color: '#f0ead6',
        backgroundColor: '#00000088',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(this.shrinePos.y + 2)
      .setVisible(false);
  }

  /**
   * Read purchased upgrades from localStorage and apply stat bonuses.
   * Called once in create() after the HUD is built so the HP bar reflects
   * the correct max-HP immediately.
   */
  private applyUpgrades(): void {
    const bought = JSON.parse(localStorage.getItem('matlu_upgrades') ?? '{}') as Record<string, boolean>;
    if (bought['hardened'])        this.effectiveMaxHp += 25;
    if (bought['fleet_footed'])    this.effectiveSpeed        = Math.round(PLAYER_SPEED       * 1.15);
    if (bought['longer_dash'])     this.effectiveDashDuration = Math.round(DASH_DURATION_MS   * 1.5);
    if (bought['cleanse_mastery']) this.effectiveSwipeRange   = Math.round(SWIPE_RANGE        * 1.2);
    // lucky_strike is checked at drop-time in resolveDrops()
    this.playerMaxHp = this.effectiveMaxHp;
    this.playerHp    = this.effectiveMaxHp;
  }

  /**
   * Show/hide the E-key prompt when the player is near the shrine.
   * Pressing E pauses the game and launches UpgradeScene.
   */
  private updateShrine(): void {
    if (this.shrineDialogActive) return;
    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.shrinePos.x, this.shrinePos.y,
    );
    const near = dist < 80;
    this.shrinePromptText?.setVisible(near);
    if (near && this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.shrineDialogActive = true;
      this.scene.pause();
      this.scene.launch('UpgradeScene', { callerKey: this.scene.key, gold: this.playerGold } as unknown as object);
    }
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
