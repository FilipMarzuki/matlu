import * as Phaser from 'phaser';
import { FbmNoise } from '../lib/noise';
import { mulberry32, poissonDisk } from '../lib/rng';
import { t } from '../lib/i18n';
import { CHUNKS, CHUNK_COUNT, CHUNK_AVOID_ZONES, CORRUPTED_CLEARING, CORRUPTED_LANDMARKS, HIDDEN_HOLLOW, WAYMARKER_STONE } from '../world/ChunkDef';
import type { ChunkDef, ChunkItem } from '../world/ChunkDef';
import { generateDecorations, decorTexture } from '../world/DecorationScatter';
import { insertMatluRun } from '../lib/matluRuns';
import { log } from '../lib/logger';
import { NavScene } from './NavScene';
import { createSolidGroup } from '../environment/SolidObject';
import { InteractiveObject } from '../environment/InteractiveObject';
import { WorldClock } from '../world/WorldClock';
import type { DayPhase, PhaseOverlay } from '../world/WorldClock';
import { WorldState } from '../world/WorldState';
import { SeasonSystem } from '../world/SeasonSystem';
import type { Season } from '../world/SeasonSystem';
import { WeatherSystem } from '../world/WeatherSystem';
import { emptyLdtkLevel } from '../world/MapData';
import type { LdtkLevel } from '../world/MapData';
import { PathSystem } from '../world/PathSystem';
import { LEVEL1_PATHS } from '../world/Level1Paths';
import { generateAnimalTrails } from '../world/AnimalTrailGen';
import { CorruptionField }   from '../world/CorruptionField';
import { WindSystem }        from '../systems/WindSystem';
import {
  DIAGONAL_RIVERS,
  TracedRiverPath,
  traceRiverPath,
  buildRiverTileGrids,
}                              from '../world/RiverData';
import { buildLakeTileGrid }  from '../world/LakeData';
import { CorruptionFilter } from '../shaders/CorruptionFilter';
import {
  ZONES, COLLECTIBLES, MEETING_POINT, MEETING_RADIUS, PATH_CHOICES,
  meetingOpeningLine, PASSIVE_CLEANSE_RATE, PASSIVE_CLEANSE_CAP,
  SETTLEMENTS, SECRET_POSITIONS, ZONE_BOUNDARY_MARKERS,
} from '../world/Level1';
import type { PathChoice } from '../world/Level1';
import type { NpcDialogData } from './NpcDialogScene';
import { CorruptedGuardian } from '../entities/CorruptedGuardian';
import { Dustling } from '../entities/Dustling';
import { DryShade } from '../entities/DryShade';
import { CrackedGolem } from '../entities/CrackedGolem';
import { Projectile } from '../entities/Projectile';
import { Bao } from '../heroes/Bao';
import { MasterFen } from '../heroes/MasterFen';
import { TheTorrent } from '../heroes/TheTorrent';
import { StormSovereign } from '../heroes/StormSovereign';
import { EndingScene, determineEnding } from './EndingScene';
import { SkillSystem } from '../lib/SkillSystem';
import type { EndingSceneData } from './EndingScene';
import { layoutSettlement } from '../world/SettlementLayout';
import {
  detectCliffs,
  CLIFF_COLORS,
  CLIFF_STEP_PX,
  CLIFF_LIP_PX,
  CLIFF_SHADOW_BANDS,
  CLIFF_CORRUPT_COLOR,
} from '../world/CliffSystem';
import type { CliffFace } from '../world/CliffSystem';
import { detectBoundaries, BLEND_COLORS } from '../world/BiomeBlend';

// ── SimpleJoystick ────────────────────────────────────────────────────────────
/**
 * Minimal virtual joystick that replaces the phaser4-rex-plugins dependency.
 *
 * phaser4-rex-plugins references `Phaser` as a global (legacy UMD pattern) at
 * module evaluation time — before Vite/ESM even starts our game code. That
 * causes `ReferenceError: Phaser is not defined` and the canvas never appears.
 *
 * This class exposes the two properties GameScene actually reads:
 *   - `force`    — distance from centre (0 when idle, up to radius px when active)
 *   - `rotation` — angle in radians pointing from centre → thumb
 *
 * The joystick is fixed-position and claims the first pointer that touches
 * within 2× the base radius of the joystick centre.
 */
class SimpleJoystick {
  force    = 0;
  rotation = 0;

  private pointerId: number | null = null;
  private readonly cx: number;
  private readonly cy: number;
  private readonly radius: number;
  private readonly thumb: Phaser.GameObjects.Arc;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    radius: number,
    thumb: Phaser.GameObjects.Arc,
  ) {
    this.cx     = x;
    this.cy     = y;
    this.radius = radius;
    this.thumb  = thumb;

    scene.input.on('pointerdown',    this.onDown, this);
    scene.input.on('pointermove',    this.onMove, this);
    scene.input.on('pointerup',      this.onUp,   this);
    scene.input.on('pointerupoutside', this.onUp, this);
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (this.pointerId !== null) return;
    const dx = pointer.x - this.cx;
    const dy = pointer.y - this.cy;
    if (dx * dx + dy * dy > (this.radius * 2) ** 2) return;
    this.pointerId = pointer.id;
    this.updateThumb(pointer);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.updateThumb(pointer);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.pointerId = null;
    this.force     = 0;
    this.rotation  = 0;
    this.thumb.setPosition(this.cx, this.cy);
  }

  private updateThumb(pointer: Phaser.Input.Pointer): void {
    const dx   = pointer.x - this.cx;
    const dy   = pointer.y - this.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;
    const clamped = Math.min(dist, this.radius);
    this.force    = clamped;
    this.rotation = Math.atan2(dy, dx);
    this.thumb.setPosition(
      this.cx + (dx / dist) * clamped,
      this.cy + (dy / dist) * clamped,
    );
  }
}

// ── Debug spawn toggles ───────────────────────────────────────────────────────
// Set a flag to true to enable that category; false to skip it entirely.
// Lets you inspect one asset type at a time without hunting through create().
const DEBUG_SPAWN = {
  rabbits:          false,
  groundAnimals:    false,  // deer, hare, fox, grouse, stag, boar, badger
  birds:            false,
  decorScatter:     false,  // flowers, mushrooms, rocks, grass, stumps, sticks
  waterEdgeScatter: false,  // lily pads, rocks-in-water
  butterfliesAndBees: false,
  buildings:        false,
};

// World dimensions — diagonal SW→NE corridor. 4500×3000 at zoom 3.
const WORLD_W = 4500;
const WORLD_H = 3000;

// Terrain tile size in pixels
const TILE_SIZE = 32;
// Noise scales: BASE drives large biome regions, DETAIL adds local colour variation
const BASE_SCALE   = 0.07;
const DETAIL_SCALE = 0.22;
// FIL-154: secondary noise layers — slower than BASE so they create large bands,
// but independent so they vary orthogonally to elevation.
const TEMP_SCALE  = 0.04; // temperature varies in broad N/S-ish bands
const MOIST_SCALE = 0.06; // moisture varies in slightly finer patches

// ─── Fog of war constants (FIL-217) ──────────────────────────────────────────
// Three tile visibility states stored in the fogGrid Uint8Array.
const FOG_UNSEEN  = 0; // never visited — fully black overlay
const FOG_SEEN    = 1; // visited but not currently in sight — 50% black shroud
const FOG_VISIBLE = 2; // within the current sight radius — fully transparent
const FOG_SIGHT_R = 10; // circular sight radius in tiles (320 px at 32 px/tile)
const FOG_LS_KEY  = 'matlu-fog-state'; // localStorage key for persistent explored state

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
// Separate constant so spawn density can be tuned without affecting the cleanse formula.
const RABBIT_SPAWN_COUNT = 25;
const RABBIT_SIZE = 18;
const SPAWN_CLEAR = 320;
const CHASE_RANGE = 200;
const ROAM_SPEED = 40;
const CHASE_SPEED = 70;
const FLEE_SPEED = 120;

// ── FIL-127: distance-based difficulty zones ──────────────────────────────────
// Corridor: spawn (300, 2650) → portal (~4100, 350), total ≈ 4 442 px.
// Zone A  0–30%  (< 1 333 px) → ×1.0 (normal)
// Zone B 30–65%  (< 2 887 px) → ×1.3
// Zone C 65–100% (≥ 2 887 px) → ×1.5
const ZONE_A_END = 1333;
const ZONE_B_END = 2887;
const FLEE_MS = 1500;
/** Speed (px/s) when player drives an animal in attract/wilderview mode — slightly below FLEE_SPEED for comfort. */
const POSSESS_SPEED = 100;
/** Milliseconds between automatic animal cycles in attract/wilderview mode. */
const ATTRACT_CYCLE_MS = 600_000;

/** FIL-8: swipe toward pointer */
const SWIPE_COOLDOWN_MS = 400;
const SWIPE_RANGE = 120;
const SWIPE_ARC = Phaser.Math.DegToRad(120);

/** FIL-126: ranged cleanse bolt — second combat tool fired with right-click or R key */
const RANGED_COOLDOWN_MS = 1200;
const RANGED_SPEED       =  280; // px/s
const RANGED_RANGE       =  250; // max travel distance in pixels
const RANGED_RADIUS      =    6; // hit-detection radius in pixels

/** Portal at the NE end of the diagonal corridor */
const PORTAL_X = 4100;
const PORTAL_Y = 350;
const PORTAL_RADIUS = 44;

/** Corrupted Guardian boss spawn point — slightly SW of portal */
const BOSS_X = 3800;
const BOSS_Y = 520;
/** Distance at which the boss entrance camera pan triggers */
const BOSS_ENTRANCE_RADIUS = 500;

/**
 * Active hero in arena mode. Change to 'masterfen' to play as Master Fen.
 * 'tinkerer' keeps the existing Tinkerer sprite with no panda abilities.
 */
const SELECTED_HERO: 'tinkerer' | 'bao' | 'masterfen' | 'torrent' | 'stormsovereign' = 'bao';

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
  crackedGolem:       { gold: { min: 5,  max: 15 } },
};

// ── Loot chests (FIL-92) ─────────────────────────────────────────────────────
/**
 * One interactive loot chest placed near a settlement.
 * Chests have stable string IDs so opened state can be persisted in localStorage
 * across page reloads — positions near fixed settlements never change.
 */
interface LootChest {
  id: string;
  sprite: Phaser.GameObjects.Sprite;
  /** "E: Open" label shown when the player is within CHEST_PROMPT_RADIUS. */
  prompt: Phaser.GameObjects.Text;
  gold: { min: number; max: number };
  opened: boolean;
}

// ── Vendors (FIL-93) ─────────────────────────────────────────────────────────
/**
 * A vendor NPC placed near a settlement that opens ShopScene when the player
 * presses E within 70 px. Each vendor maps to a vendorId that ShopScene uses
 * to look up that settlement's item catalogue.
 */
interface Vendor {
  vendorId: string;
  sprite:   Phaser.GameObjects.Image;
  /** "E: Shop" label — hidden until the player is within VENDOR_PROMPT_RADIUS. */
  prompt:   Phaser.GameObjects.Text;
}

/**
 * Fixed vendor positions — one trader per settlement.
 *
 * Positions are offset from the settlement centre so vendors don't overlap
 * the existing dialogue NPCs (which spawn at r*0.25 from the centre).
 * Vendors sit at roughly r*0.55 in the direction away from the map centre
 * so they're easy to find when exploring the settlement edge.
 *
 *   Strandviken  (450, 2820) — fishing hamlet — vendor SE of shrine
 *   Skogsgläntan (2300,1400) — trading village — vendor NE of centre
 *   Klippbyn     (3900, 620) — mountain hamlet — vendor SE of centre
 */
const VENDOR_DEFS: ReadonlyArray<{ vendorId: string; x: number; y: number }> = [
  { vendorId: 'strandviken',  x:  560, y: 2840 },
  { vendorId: 'skogsglanten', x: 2430, y: 1340 },
  { vendorId: 'klippbyn',     x: 3990, y:  660 },
];

interface AnimalDef {
  /** Physics body size (smaller than the visual sprite). */
  w: number; h: number;
  fleeRange: number; fleeSpeed: number; roamSpeed: number; count: number;
  /** Pixel scale applied to the 16×16 sprite to reach the desired display size. */
  scale: number;
  /**
   * FIL-50: Per-species startle vocalization played once when the animal starts fleeing.
   * Uses pitch-shifting (`rate`) so species sound distinct without extra audio files.
   * rate < 1 → lower pitch (large animals); rate > 1 → higher pitch (small ones).
   */
  fleeVocal: { key: string; volume: number; rate: number };
}

const ANIMAL_DEFS: Record<string, AnimalDef> = {
  deer:   { w: 22, h: 14, scale: 2.0, fleeRange: 280, fleeSpeed:  95, roamSpeed: 22, count: 18, fleeVocal: { key: 'animal-rustle-1', volume: 0.65, rate: 0.55 } },  // low snort
  hare:   { w: 12, h:  9, scale: 1.5, fleeRange: 180, fleeSpeed: 145, roamSpeed: 38, count: 28, fleeVocal: { key: 'animal-rustle-3', volume: 0.50, rate: 2.00 } },  // high squeak
  fox:    { w: 16, h: 11, scale: 2.0, fleeRange: 140, fleeSpeed:  82, roamSpeed: 30, count: 15, fleeVocal: { key: 'animal-rustle-2', volume: 0.60, rate: 1.30 } },  // sharp yelp
  // Grouse: small ground bird, lives in coveys of 2–4 in dense forest.
  // Slightly smaller display (scale 1.5) and flees faster than it roams.
  grouse: { w: 12, h:  9, scale: 1.5, fleeRange: 160, fleeSpeed: 130, roamSpeed: 28, count: 14, fleeVocal: { key: 'animal-rustle-4', volume: 0.55, rate: 1.60 } },  // rapid cluck
  // ── Critters pack ──────────────────────────────────────────────────────────
  // Source frames are larger (32–42 px) so scale is 1.0–1.2 rather than 2.0.
  // SE-direction strips are loaded; sprite flips horizontally when moving left.
  stag:   { w: 28, h: 18, scale: 1.2, fleeRange: 320, fleeSpeed: 105, roamSpeed: 18, count: 10, fleeVocal: { key: 'animal-rustle-0', volume: 0.75, rate: 0.40 } },  // deep bellow
  boar:   { w: 32, h: 16, scale: 1.0, fleeRange: 100, fleeSpeed:  88, roamSpeed: 26, count:  8, fleeVocal: { key: 'animal-rustle-0', volume: 0.70, rate: 0.65 } },  // low grunt
  badger: { w: 22, h: 14, scale: 1.0, fleeRange: 160, fleeSpeed: 115, roamSpeed: 32, count: 12, fleeVocal: { key: 'animal-rustle-2', volume: 0.65, rate: 0.85 } },  // snarl
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
/**
 * Maps elevation, temperature, moisture, and detail noise to a Mystic Woods tile.
 *
 * FIL-154: biome is a 2D function of (elevation × moisture) at mid-elevations
 * and (elevation × temperature) at high elevations, not a single threshold.
 *
 * FIL-172: expanded from 5 to 10 used rows, fixing identical-tile bugs and adding
 * marsh, snow, and sandy-shore biomes. Temperature now also affects shore and
 * low-elevation tiles (previously only active above elev 0.62).
 *
 * plains.png row audit (16×16 px per frame, 6 cols × 12 rows):
 *   row  0 (frames  0– 5) — rocky shore / earthy shingle
 *   row  1 (frames  6–11) — dry sandy heath / lighter gravel  ← FIL-172: dry mid
 *   row  2 (frames 12–17) — coastal heath / light meadow
 *   row  3 (frames 18–23) — marsh / wet bog                   ← FIL-172: new biome
 *   row  4 (frames 24–29) — mixed birch-spruce forest floor
 *   row  5 (frames 30–35) — denser forest floor (reserved)
 *   row  6 (frames 36–41) — dark spruce interior
 *   row  7 (frames 42–47) — dark spruce transition (reserved)
 *   row  8 (frames 48–53) — cold granite / highland rock
 *   row  9 (frames 54–59) — bare rocky summit                  ← FIL-172: distinct summit
 *   row 10 (frames 60–65) — snow / ice field                   ← FIL-172: cold peak
 *   row 11 (frames 66–71) — reserved
 *
 * water-sheet.png rows (30 frames per row):
 *   row 0 (frames  0–29) — standard ocean / lake water (animated)
 *   row 1 (frames 30–59) — lighter/shallower river water       ← FIL-172: river tiles
 *
 * @param elev     Elevation [0,1] — main land/sea/mountain axis
 * @param temp     Temperature [0,1] — higher = warmer
 * @param moist    Effective moisture [0,1] — may be boosted near rivers (FIL-172)
 * @param detail   High-frequency detail [0,1] — picks frame within biome row
 * @param isRiver  True for diagonal river-band tiles; uses water-sheet row 1
 */
function terrainTileFrame(
  elev: number, temp: number, moist: number, detail: number,
  isRiver = false,
  isLake  = false,
): { key: string; frame: number } {
  const v6 = Math.floor(detail * 5.99); // 0–5: one of 6 frames per biome row

  // ── Water ─────────────────────────────────────────────────────────────────────
  // The custom water_animated.png has 4 frames (0–3): calm → gentle → mid → full ripple.
  // Rivers use frames 1–3 (livelier); ocean uses 0–2; lakes use row 0 frames 0–1
  // (calmer than ocean — only the two stillest frames to suggest a quiet pond).
  if (elev < 0.25) {
    if (isRiver) {
      return { key: 'terrain-water', frame: 1 + (detail > 0.65 ? 2 : detail > 0.35 ? 1 : 0) };
    }
    if (isLake) {
      // Lakes: calm surface — only frames 0 and 1 (no mid/full ripple).
      return { key: 'terrain-water', frame: detail > 0.50 ? 1 : 0 };
    }
    // Ocean: all three ripple levels
    return { key: 'terrain-water', frame: detail > 0.65 ? 2 : detail > 0.35 ? 1 : 0 };
  }

  // ── Shore (elev 0.25–0.30) ────────────────────────────────────────────────────
  // Cold or moist → rocky shingle (row 0); warm and dry → sandy shore (row 1).
  // Temperature now affects the coast so northern shores look different from
  // warm sheltered bays — resolves the "Shore and Sandy identical" FIL-172 gap.
  if (elev < 0.30) {
    return (temp < 0.45 || moist > 0.50)
      ? { key: 'mw-plains', frame:      v6 }  // rocky shore (row 0)
      : { key: 'mw-plains', frame:  6 + v6 }; // sandy shore (row 1)
  }

  // ── Marsh / bog (elev 0.30–0.45, very wet) ───────────────────────────────────
  // Soggy lowlands near rivers shift to bog rather than forest. The threshold
  // is intentionally high (0.72) so marsh is rare but emerges naturally in
  // low-lying river valleys — especially after the river-bank moisture boost.
  if (elev < 0.45 && moist > 0.72) return { key: 'mw-plains', frame: v6 }; // marsh — row 0, earthy/muddy

  // ── Mid elevation (elev 0.30–0.62) ───────────────────────────────────────────
  if (elev < 0.62) {
    if (moist > 0.60) return { key: 'mw-plains',  frame: 6 + v6 }; // mixed forest — row 1, bushy green
    if (moist > 0.52) return { key: 'mw-heather', frame: v6 };      // moist heather fringe — narrow band near forest edge
    if (moist > 0.30) return { key: 'mw-plains',  frame:     v6 }; // open meadow — row 0, earthy brown
    return                   { key: 'mw-grass',   frame: 0 };        // dry heath — flat clean grass
  }

  // ── High elevation (elev 0.62–0.78) ──────────────────────────────────────────
  if (elev < 0.78) {
    return temp > 0.50
      ? { key: 'mw-plains', frame: 6 + v6 }  // warm high — row 1, bushy green
      : { key: 'mw-plains', frame:     v6 }; // cold high — row 0, earthy/rocky
  }

  // ── Summit (elev ≥ 0.78) ──────────────────────────────────────────────────────
  return temp < 0.40
    ? { key: 'mw-snow',   frame: 12 }   // snow summit — generated snow tile (all-upper frame)
    : { key: 'mw-plains', frame: v6 };  // bare rocky summit — row 0, earthy
}

// ── Dev overlay helpers ──────────────────────────────────────────────────────

/**
 * Short label for each biome index — shown in the biome dev overlay.
 * FIL-172: expanded from 8 to 11 biomes.
 */
const BIOME_LABELS = [
  'Sea', 'Rocky Shore', 'Sandy Shore', 'Marsh',
  'Dry Heath', 'Heath', 'Forest', 'Spruce',
  'Granite', 'Summit', 'Snow',
] as const;

/** Fill colour per biome index in the biome dev overlay (FIL-172: 11 entries). */
const BIOME_OVERLAY_COLORS: readonly number[] = [
  0x1a4f7a, // 0  Sea           — deep blue
  0x8b6914, // 1  Rocky shore   — warm sandy brown
  0xe8c870, // 2  Sandy shore   — lighter yellow-sand
  0x4a7a3a, // 3  Marsh / bog   — muddy dark green
  0xb8904a, // 4  Dry heath     — sandy/rocky
  0x7a9a3a, // 5  Coastal heath — olive green
  0x2a7a2a, // 6  Forest        — fresh green
  0x1a5a1a, // 7  Spruce        — dark spruce green
  0x7a7a7a, // 8  Cold granite  — cool grey
  0x9a9898, // 9  Bare summit   — slightly lighter grey (distinct from granite)
  0xd8e8f8, // 10 Snow field    — ice blue
];

/**
 * Resolve which biome index a tile belongs to from its noise values.
 * Must mirror the if-else logic in terrainTileFrame() exactly so dev overlay
 * colours match the visible tiles.
 * FIL-172: expanded from 8 to 11 biomes.
 */
function tileBiomeIdx(elev: number, temp: number, moist: number): number {
  if (elev < 0.25) return 0; // sea
  if (elev < 0.30) return (temp < 0.45 || moist > 0.50) ? 1 : 2; // rocky / sandy shore
  if (elev < 0.45 && moist > 0.72) return 3; // marsh / bog
  if (elev < 0.62) {
    if (moist > 0.60) return 6; // mixed forest
    if (moist > 0.30) return 5; // coastal heath
    return 4;                    // dry heath
  }
  if (elev < 0.78) return temp > 0.50 ? 7 : 8; // spruce / cold granite
  return temp < 0.40 ? 10 : 9;                  // snow / bare summit
}

/**
 * Maps a normalised elevation t∈[0,1] to a heatmap hex colour:
 *   0.0 dark purple → 0.25 dark blue → 0.50 cyan → 0.75 green → 1.0 yellow
 */
function elevHeatColor(t: number): number {
  const stops: readonly [number, number, number][] = [
    [0x2d, 0x00, 0x50], // dark purple
    [0x0a, 0x20, 0x80], // dark blue
    [0x00, 0x80, 0xc0], // cyan
    [0x40, 0xc0, 0x40], // green
    [0xff, 0xff, 0x00], // yellow
  ];
  const n   = stops.length - 1;
  const seg = Math.min(n - 1, Math.floor(t * n));
  const u   = t * n - seg;
  const [ar, ag, ab] = stops[seg];
  const [br, bg, bb] = stops[seg + 1];
  return (Math.round(ar + (br - ar) * u) << 16)
       | (Math.round(ag + (bg - ag) * u) <<  8)
       |  Math.round(ab + (bb - ab) * u);
}

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private playerBody!: Phaser.GameObjects.Arc;
  private playerIndicator!: Phaser.GameObjects.Rectangle;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private playerLastDir: 'down' | 'up' | 'side' = 'down';
  private playerMoving = false;
  private joystick!: SimpleJoystick;
  private mountainWalls!: Phaser.Physics.Arcade.StaticGroup;
  private navigationBarriers!: Phaser.Physics.Arcade.StaticGroup;
  private solidObjects!: Phaser.Physics.Arcade.StaticGroup;
  private interactiveObjects!: InteractiveObject[];
  worldClock!: WorldClock;
  worldState!: WorldState;
  mapData!: LdtkLevel;
  private dayNightOverlay!: Phaser.GameObjects.Rectangle;
  private currentPhase: DayPhase = 'dawn';
  // FIL-227: per-frame lerp state for smooth day/night colour + alpha transitions
  private currentOverlay!: PhaseOverlay;
  private lerpFrom!: PhaseOverlay;
  private lerpTo!: PhaseOverlay;
  private overlayLerpElapsed = 0;
  private readonly OVERLAY_LERP_DURATION = 20_000; // 20 real seconds in ms
  private seasonSystem!: SeasonSystem;
  /** Tracks the last applied effective season so updateDayNight() only re-blends on change. */
  private _currentSeason: Season = 'spring';
  private weatherSystem!: WeatherSystem;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;

  private rabbits!: Phaser.Physics.Arcade.Group;
  private groundAnimals!: Phaser.Physics.Arcade.Group;
  // FIL-106: three new corrupted enemy types
  private foxEnemies!:  Phaser.Physics.Arcade.Group;
  private crowEnemies!: Phaser.Physics.Arcade.Group;
  private wispEnemies!: Phaser.Physics.Arcade.Group;
  private birds: BirdObject[] = [];
  private kills = 0;
  // FIL-106: weighted cleanse value from non-rabbit enemy kills; FIL-94: eco kill tracking
  private cleanseKillsExtra = 0;
  private enemyKills = 0;
  // FIL-94: per-species neutral-kill counters and resulting corruption penalty
  private neutralKills: Partial<Record<string, number>> = {};
  private corruptionPenalty = 0; // 0–100; each unit = 1% effective cleanse lost
  private lastSwipeAt   = 0;
  private lastRangedAt  = 0;
  /** Live ranged bolts — each is a teal Arc travelling toward pointer position. */
  private rangedProjectiles: Array<{
    arc:     Phaser.GameObjects.Arc;
    vx:      number;
    vy:      number;
    dist:    number;
    /** Maximum travel distance — scaled by throwing skill so higher levels reach further. */
    maxDist: number;
  }> = [];

  // ─── Economy ──────────────────────────────────────────────────────────────────
  private playerGold = 0;
  private goldText!: Phaser.GameObjects.Text;

  // ─── Skill system (FIL-95) ────────────────────────────────────────────────────
  private skillSystem!: SkillSystem;
  /** Timestamp of the last run-XP tick so we award at most 1 XP/second. */
  private lastRunXpAt = 0;

  // ─── Loot chests (FIL-92) ─────────────────────────────────────────────────────
  private lootChests: LootChest[] = [];

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
  // FIL-94: dark-red cap overlaid on the right portion of cleanseFill
  private corruptionFill!: Phaser.GameObjects.Rectangle;
  private overlay!: Phaser.GameObjects.Rectangle;
  // All HUD elements (bars + labels) collected so they can be hidden during attract mode
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  // ─── Particle effects ─────────────────────────────────────────────────────────
  // Phase-gated emitters — created once in spawnParticleEffects(), toggled by
  // applyParticlePhase() on every day/night transition.
  private leavesEmitter?:  Phaser.GameObjects.Particles.ParticleEmitter;
  private pollenEmitter?:  Phaser.GameObjects.Particles.ParticleEmitter;
  private fireflyEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  // ─── Shader pipelines ────────────────────────────────────────────────────────
  // null when running under the Canvas renderer (no WebGL) or before create()
  private corruptFilter: CorruptionFilter | null = null;

  // ─── Sound ────────────────────────────────────────────────────────────────────
  // ambience loops continuously in the background once gameplay starts
  private ambienceSound: Phaser.Sound.BaseSound | undefined;
  // FIL-108: ocean/shore ambience layer — volume driven by biome proximity to water
  private oceanAmbienceSound: Phaser.Sound.BaseSound | undefined;
  private lastAmbienceZoneCheck = 0;
  // FIL-112: mountain wind layer — fades in above biome 0.81
  private windSound: Phaser.Sound.BaseSound | undefined;
  // FIL-110: settlement presence layer — single shared loop, volume = max proximity across all settlements
  private settlementSound: Phaser.Sound.BaseSound | undefined;
  // FIL-117: night ambience layer — crickets/insect loop, fades in at dusk and peaks at night
  private ambienceNight: Phaser.Sound.BaseSound | undefined;
  // FIL-47: positional animal ambient — one looping layer per species group
  private animalSounds: Map<string, Phaser.Sound.BaseSound> = new Map();
  private lastAnimalSoundTick = 0;
  private lastSettlementCheck = 0;
  // Background music track for the current day phase (crossfades on transition)
  private musicTrack: Phaser.Sound.BaseSound | undefined;
  // Key of the currently-playing music track (avoid restarting the same track)
  private currentMusicKey = '';
  // FIL-113: Volumes saved before ducking so onSceneResume() can restore them exactly.
  // Stored here (not in the overlay) so GameScene owns the full duck/restore lifecycle.
  private preDuckMusicVol    = 0;
  private preDuckAmbienceVol = 0;
  // FIL-115: User-controlled volume multipliers (0–1, default 1 = authored levels).
  // Read from localStorage in preload(); updated live via settings:*-vol game events.
  private musicVol    = 1.0;
  private sfxVol      = 1.0;
  private ambienceVol = 1.0;
  // tracks when we last played a footstep so we don't fire every frame
  private lastFootstepAt = 0;
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

  // ── Dustling swarm (FIL-302) ─────────────────────────────────────────────────
  private dustlings: Dustling[] = [];
  /** True while at least one Dustling is alive — drives overlay + spell miss. */
  private dustlingSwarmAlive = false;
  /** Semi-opaque black screen overlay — visible while swarm is alive. */
  private dustlingOverlay!: Phaser.GameObjects.Rectangle;
  // ── Panda heroes (FIL-314) ────────────────────────────────────────────────────
  /** Hero instance spawned in arena mode — null for Tinkerer. */
  private arenaHero: Bao | MasterFen | TheTorrent | StormSovereign | null = null;
  /**
   * Active enemy group exposed so StormSovereign.monsoon() can iterate all
   * live enemies without a spatial query. Populated in create(); added to in
   * registerEnemy() so any enemy spawned during gameplay is automatically
   * included. Satisfies the EnemyHostScene interface from StormSovereign.
   */
  public enemies!: Phaser.GameObjects.Group;
  /** Keyboard keys 1–3 drive hero abilities; 4 = Master Fen signature (Torrent). */
  private abilityKey1?: Phaser.Input.Keyboard.Key;
  private abilityKey2?: Phaser.Input.Keyboard.Key;
  private abilityKey3?: Phaser.Input.Keyboard.Key;
  private abilityKey4?: Phaser.Input.Keyboard.Key;
  /** Projectiles emitted by hero cast methods — ticked and pruned each frame. */
  private heroProjectiles: Projectile[] = [];

  // ── Dry Shades (FIL-304) ──────────────────────────────────────────────────────
  private dryShades: DryShade[] = [];
  // ── Cracked Golems (FIL-306) ─────────────────────────────────────────────────
  private golems: CrackedGolem[] = [];
  /** Projectiles spawned by golem death bursts — ticked and pruned each frame. */
  private golemProjectiles: Projectile[] = [];

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
  // FIL-154: secondary noise layers for temperature and moisture — independent of
  // elevation so the same height can produce different biomes depending on position.
  private tempNoise!: FbmNoise;
  private moistNoise!: FbmNoise;

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

  // ─── Vendors (FIL-93) ────────────────────────────────────────────────────────
  private vendors: Vendor[] = [];
  /** True while ShopScene is open — prevents re-triggering via E key. */
  private vendorShopActive = false;
  // True while the NpcDialogScene is open so we don't re-trigger on the same frame.
  private npcDialogActive = false;
  private interactKey?: Phaser.Input.Keyboard.Key;

  // Dev mode switcher — 'wilderview' for terrain/world, 'arena' for combat/Tinkerer
  private gameMode: 'wilderview' | 'arena' = 'wilderview';

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

  // ─── Idle attract (FIL-98) ────────────────────────────────────────────────────
  // After IDLE_ATTRACT_MS of zero input during gameplay the camera drifts to the
  // nearest animal at IDLE_ZOOM; any movement snaps it back to the player.
  private idleMs = 0;
  private idleAttractTarget: Phaser.GameObjects.GameObject | null = null;
  private preIdleZoom = 3;
  private readonly IDLE_ATTRACT_MS = 10_000;
  private readonly IDLE_ZOOM = 5.0;

  // ─── Free-fly camera ──────────────────────────────────────────────────────────
  /** When true, WASD pans the camera freely instead of following an animal. */
  freeCamMode = false;

  // ─── Isometric grid overlay ───────────────────────────────────────
  private isoGridGfx: Phaser.GameObjects.Graphics | null = null;
  private isoGridVisible = false;

  // ─── Dev terrain overlay ──────────────────────────────────────────────────────
  /** Active dev overlay. 'elevation' shows purple→yellow heatmap; 'biome' shows flat biome colours. */
  private devOverlay: 'none' | 'elevation' | 'biome' = 'none';
  /** Pre-built elevation heatmap Graphics — lazily created on first use, then cached. */
  private devElevGfx:  Phaser.GameObjects.Graphics | null = null;
  /** Pre-built biome colour Graphics — lazily created on first use, then cached. */
  private devBiomeGfx: Phaser.GameObjects.Graphics | null = null;
  /** Container holding per-tile text labels (elevation number or biome name). */
  private devTextContainer: Phaser.GameObjects.Container | null = null;

  // ─── Decoration visibility toggle (H key / World Dev panel) ─────────────────
  /** Wind animation system — drives per-frame y-offset sway on visible decorations (FIL-240). */
  private windSystem: WindSystem | null = null;
  /** All world-decoration images (trees, rocks, flowers, buildings, etc.) — toggled by H key or Decor button. */
  private decorImages: Phaser.GameObjects.Image[] = [];
  /** Whether decorations are currently visible. */
  // Start hidden — ground-polish focus. Press H or use the World Dev Decor button to toggle.
  private decorVisible = false;
  /** Whether wildlife (rabbits, ground animals) is currently visible. */
  private animalsVisible = true;
  /** Individual layer visibility flags — tracked independently of the Decor master toggle. */
  private pathsVisible       = false; // pathGraphics hidden at startup
  private zonesVisible       = false; // zoneOverlays hidden at startup
  private settlementsVisible = false; // settlementGlows hidden at startup
  private fogVisible         = true;  // fogRt is visible by default

  /** Raw elevation value per tile [0,1.2] — stored during terrain bake. */
  private tileDevElev:  Float32Array | null = null;
  /** Biome index per tile [0,7] — stored alongside elevation during terrain bake. */
  private tileDevBiome: Uint8Array   | null = null;
  /** Tile grid width — needed to convert flat array index back to (tx, ty). */
  private tileDevW = 0;
  // ── FIL-178: cliff system ─────────────────────────────────────────────────
  /**
   * Corruption overlay drawn on top of cliff faces.
   * Opacity scales with global corruption — updated whenever cleanse-updated fires.
   */
  private cliffCorruptGfx: Phaser.GameObjects.Graphics | null = null;
  // ── FIL-167/168: diagonal river lookup grids ─────────────────────────────
  /**
   * 1 if the tile is covered by any diagonal river band, 0 otherwise.
   * Built by initRiverTileGrids() before drawProceduralTerrain() runs.
   * FIL-260: isLakeTile is built in the same call — inland water pockets not
   * reachable from the map edge are flagged 1 so they can animate differently.
   * FIL-168 uses this to override terrain tiles and animated-water placement.
   */
  private isRiverTile: Uint8Array | null = null;
  /** FIL-260: 1 = inland lake tile; 0 = not. Populated alongside isRiverTile. */
  private isLakeTile: Uint8Array | null = null;
  /**
   * Fully traced diagonal river paths (populated before terrain bake).
   * FIL-170 uses bridge/ford pathIndices to position crossing visuals.
   */
  private tracedRiverPaths: TracedRiverPath[] = [];
  /** Camera state at last text rebuild — avoids rebuilding every frame on tiny moves. */
  private devTextLastX    = -9999;
  private devTextLastY    = -9999;
  private devTextLastZoom = -1;
  /** True when the dev overlay auto-enabled free cam so we can restore state on deactivate. */
  private devOverlayAutoFreeCam = false;
  /** Reference captured at pinch start; null when no two-finger gesture is active. */
  private pinchZoomRef: { dist: number; zoom: number } | null = null;

  // ─── Fog of war (FIL-217) ─────────────────────────────────────────────────────
  // fogGrid: one byte per tile — FOG_UNSEEN / FOG_SEEN / FOG_VISIBLE.
  // Dimensions match the world tile grid: Math.ceil(4500/32) × Math.ceil(3000/32) = 141 × 94.
  private fogGrid: Uint8Array | null = null;
  // Full-world RenderTexture at depth 49 — sits between day/night (48) and corruption (50).
  // Opaque black for UNSEEN, 50%-alpha black for SEEN, fully transparent for VISIBLE.
  private fogRt: Phaser.GameObjects.RenderTexture | null = null;
  // Reusable Graphics stamps for RT draw/erase operations.
  // Positioned at the target tile before each RT call (same pattern as tileImg in terrain bake).
  private fogUnseenGfx: Phaser.GameObjects.Graphics | null = null; // alpha=1 black
  private fogSeenGfx: Phaser.GameObjects.Graphics | null = null;   // alpha=0.5 black
  // Bounding box (tile coords) of the visible circle from the previous update tick.
  // Used to compute the "dirty region" = union of prev + current sight circles.
  private fogPrevBounds: { x0: number; y0: number; x1: number; y1: number } | null = null;

  // Set when the player types their name on the attract screen; used for leaderboard.
  playerName = '';

  constructor() {
    super({ key: 'GameScene' });
  }

  // Phaser calls init() before preload()/create() with data from scene.start/restart.
  // This is where we read the requested game mode so preload() can branch on it.
  private skipAttract = false;

  init(data?: { mode?: 'wilderview' | 'arena'; skipAttract?: boolean }): void {
    this.gameMode    = data?.mode ?? 'wilderview';
    this.skipAttract = data?.skipAttract ?? false;
  }

  preload(): void {
    // Detect audio availability early — WebAudio is unavailable in headless CI.
    // We use this flag to skip all sound.play() calls and avoid Phaser internals crash.
    this.load.once('complete', () => {
      this.audioAvailable = this.cache.audio.has('forest-ambience');
    });

    // FIL-115: Restore per-channel volume multipliers from localStorage so they are
    // ready before the sound graph is built in create().
    if (typeof localStorage !== 'undefined') {
      const mv = parseFloat(localStorage.getItem('matlu_music_vol')    ?? '1');
      const sv = parseFloat(localStorage.getItem('matlu_sfx_vol')      ?? '1');
      const av = parseFloat(localStorage.getItem('matlu_ambience_vol') ?? '1');
      this.musicVol    = isNaN(mv) ? 1 : Phaser.Math.Clamp(mv, 0, 1);
      this.sfxVol      = isNaN(sv) ? 1 : Phaser.Math.Clamp(sv, 0, 1);
      this.ambienceVol = isNaN(av) ? 1 : Phaser.Math.Clamp(av, 0, 1);
    }

    // ── Audio ──────────────────────────────────────────────────────────────────
    // Phaser tries each format in order and picks the first the browser supports.
    // .ogg is smaller and preferred; .mp3 is the fallback for Safari.
    this.load.audio('forest-ambience', [
      'assets/audio/forest-ambience.ogg',
      'assets/audio/forest-ambience.mp3',
    ]);
    // FIL-108: ocean/shore ambience — deep ambient drone used as coastal presence
    this.load.audio('ocean-ambience', [
      'assets/audio/Cozy Tunes (Pro) v1.4/Cozy Tunes (Pro)/Audio/ogg/Sound Effects/underwater world.ogg',
    ]);
    // FIL-112: mountain wind — Cozy Tunes Pro "Gentle Breeze" loop (CC0-compatible)
    this.load.audio('sfx-wind', [
      'assets/audio/Cozy Tunes (Pro) v1.4/Cozy Tunes (Pro)/Audio/ogg/Tracks/Gentle Breeze.ogg',
    ]);
    // FIL-110: settlement presence — soft ambient loop as distant life texture near hamlets/villages
    this.load.audio('sfx-settlement', [
      'assets/audio/Cozy Tunes (Pro) v1.4/Cozy Tunes (Pro)/Audio/ogg/Tracks/Forgotten Biomes.ogg',
    ]);
    // FIL-117: night ambience — eerie presence sound fades in at dusk and peaks during night.
    // Replace with a dedicated crickets/insect loop when one is sourced from freesound.org.
    this.load.audio('night-ambience', [
      'assets/audio/night-ambience.ogg',
      'assets/audio/Cozy Tunes (Pro) v1.4/Cozy Tunes (Pro)/Audio/ogg/Sound Effects/stalker.ogg',
    ]);
    // ── Background music — four Cozy Tunes (Pro) tracks, one per day phase ────────
    // Mapped: dawn → Sunlight Through Leaves, morning/midday/afternoon → Whispering Woods,
    // dusk → Evening Harmony, night → Polar Lights.
    const cozyBase = 'assets/audio/Cozy Tunes (Pro) v1.4/Cozy Tunes (Pro)/Audio/ogg/Tracks';
    this.load.audio('music-dawn',  [`${cozyBase}/Sunlight Through Leaves.ogg`]);
    this.load.audio('music-day',   [`${cozyBase}/Whispering Woods.ogg`]);
    this.load.audio('music-dusk',  [`${cozyBase}/Evening Harmony.ogg`]);
    this.load.audio('music-night', [`${cozyBase}/Polar Lights.ogg`]);
    // Phase-transition stinger: single bell strike at the moment the crossfade starts (FIL-122)
    // impactBell_heavy_001 is distinct from _000 (sfx-swipe-hit) and _004 (sfx-swipe)
    this.load.audio('sfx-phase-stinger', ['assets/audio/kenney_impact-sounds/Audio/impactBell_heavy_001.ogg']);

    // ── Event SFX ─────────────────────────────────────────────────────────────────
    const ken = 'assets/audio/kenney_impact-sounds/Audio';
    const jingles = 'assets/audio/kenney_music-jingles/Audio';
    // Collectible pickup: warm pizzicato jingle (Kenney Music Jingles, CC0)
    this.load.audio('sfx-pickup',  [`${jingles}/Pizzicato jingles/jingles_PIZZI05.ogg`]);
    // Portal reveal: crystalline steel jingle (Kenney Music Jingles, CC0)
    this.load.audio('sfx-portal',  [`${jingles}/Steel jingles/jingles_STEEL05.ogg`]);
    // FIL-111: victory jingle on level completion — warm pizzicato (Kenney Music Jingles, CC0)
    this.load.audio('sfx-victory', [`${jingles}/Pizzicato jingles/jingles_PIZZI07.ogg`]);
    // Cleanse swipe gesture: bright bell whoosh (Kenney Impact Sounds, CC0)
    this.load.audio('sfx-swipe',   [`${ken}/impactBell_heavy_004.ogg`]);
    // Swipe makes contact with an enemy: deeper bell strike (Kenney Impact Sounds, CC0)
    this.load.audio('sfx-swipe-hit', [`${ken}/impactBell_heavy_000.ogg`]);
    // Corrupted enemy dies: soft organic dissolve/pop (Kenney Impact Sounds, CC0)
    this.load.audio('sfx-enemy-death', [`${ken}/impactSoft_heavy_001.ogg`]);
    // Button hover SFX for PauseMenuScene and SettingsScene (shared audio cache)
    this.load.audio('sfx-hover', [`${ken}/impactPlate_light_000.ogg`]);
    // Player takes damage: dull punch impact (Kenney Impact Sounds, CC0)
    this.load.audio('sfx-player-hit',  [`${ken}/impactPunch_medium_000.ogg`]);
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

    // FIL-47: ambient animal calls — positional volume/pan driven by nearest animal.
    // Source files from Freesound.org CC0 or Kenney Animal Pack (see FIL-47 for links).
    // Missing files are silently skipped via cache.audio.has() checks in create().
    this.load.audio('animal-bird', 'assets/audio/animal/bird-call.ogg');
    this.load.audio('animal-deer', 'assets/audio/animal/deer-call.ogg');
    this.load.audio('animal-hare', 'assets/audio/animal/hare-rustle.ogg');
    this.load.audio('animal-fox',  'assets/audio/animal/fox-bark.ogg');

    // ── Terrain tilesets (Mystic Woods 2.2, preferred for Level 1) ───────────────
    // plains.png  — 96×192, 16×16 tiles (6 cols × 12 rows = 72 frames)
    //   Each ground biome maps to a consecutive row-pair (12 frames of variety).
    //   See terrainTileFrame() for the exact row-to-biome mapping.
    // water-sheet — loaded separately below; 30-frame animated water.
    const mwTiles = 'assets/packs/mystic_woods_2.2/sprites/tilesets';
    this.load.spritesheet('mw-plains',   `${mwTiles}/plains.png`,   { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('mw-grass',    `${mwTiles}/grass.png`,    { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('mw-snow',     `${mwTiles}/snow.png`,     { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('mw-heather',  `${mwTiles}/heather.png`,  { frameWidth: 16, frameHeight: 16 });

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
    // Flowers_2 — taller, more upright meadow flowers (4 colour variants)
    this.load.image('flowers-2-yellow', `${paFMO}/Flowers_2_yellow.png`);
    this.load.image('flowers-2-red',    `${paFMO}/Flowers_2_red.png`);
    this.load.image('flowers-2-blue',   `${paFMO}/Flowers_2_blue.png`);
    this.load.image('flowers-2-purple', `${paFMO}/Flowers_2_purple.png`);
    // Flowers_3 — small daisy-like flowers (4 colour variants)
    this.load.image('flowers-3-yellow', `${paFMO}/Flowers_3_yellow.png`);
    this.load.image('flowers-3-red',    `${paFMO}/Flowers_3_red.png`);
    this.load.image('flowers-3-blue',   `${paFMO}/Flowers_3_blue.png`);
    this.load.image('flowers-3-purple', `${paFMO}/Flowers_3_purple.png`);
    this.load.image('mushroom',        `${paFMO}/Mushroom.png`);
    this.load.image('mushrooms-yellow',`${paFMO}/Mushrooms_1_Yellow.png`);
    this.load.image('mushrooms-red',   `${paFMO}/Mushrooms_2_Red.png`);
    // Stumps — fallen tree remnants for forest scatter and chunks
    this.load.image('stump-1', `${paFMO}/Stump_1.png`);
    this.load.image('stump-2', `${paFMO}/Stump_2_Mushrooms.png`);
    // Stick — loose debris for shore/heath scatter
    this.load.image('stick', `${paFMO}/Stick.png`);

    const paW = `${paFMO}/Puddles-And-Water-Anim`;
    this.load.image('puddle-grass-1', `${paW}/Puddle_On-Grass_1_Grass_Green.png`);
    this.load.image('puddle-grass-2', `${paW}/Puddle_On-Grass_2_Grass_Green.png`);
    this.load.image('puddle-grass-3', `${paW}/Puddle_On-Grass_3_Grass_Green.png`);

    // ── Water terrain tiles (FIL-173) ────────────────────────────────────────────
    // water_animated.png is a custom 4-frame spritesheet (64×16, 16×16 per frame).
    // Frames 0–3 cycle calm → gentle ripple → mid-ripple → full ripple at 4 FPS.
    // Ocean uses frames 0–2; rivers use frames 1–3 for a slightly livelier look.
    // Replace this file with a PixelLab create_tiles_pro output for custom pixel art.
    this.load.spritesheet('terrain-water', 'assets/sprites/water_animated.png', { frameWidth: 16, frameHeight: 16 });

    // ── Wang water tilesets — depth + shore transition (PixelLab generated) ─────
    // Both are 4×4 grids of 16 Wang tiles (64×64 px, 16×16 per tile).
    // water-deep : lower=deep teal ocean → upper=shallow teal near coast.
    //              Second bake pass draws depth gradient across the ocean body.
    // water-shore: lower=shallow water  → upper=sandy beach.
    //              Third bake pass draws water↔sand transitions at the coastline,
    //              sitting under the cliff faces that drawCliffEdges() layers on top.
    this.load.spritesheet('water-deep',  'assets/sprites/tilesets/world/water_deep.png',  { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('water-shore', 'assets/sprites/tilesets/world/water_shore.png', { frameWidth: 16, frameHeight: 16 });

    // ── Water edge decorations (Mystic Woods 2.2) ─────────────────────────────────
    // Scattered near the shoreline by stampWaterEdgeScatter() to break up the hard
    // water/land boundary and add natural-looking detail.
    const mwObj = 'assets/packs/mystic_woods_2.2/sprites/objects';
    const mwTl  = 'assets/packs/mystic_woods_2.2/sprites/tilesets';
    // 6 lily pad variants in a single row — pick by frame index 0–5
    this.load.spritesheet('water-lillies',  `${mwTl}/water_lillies.png`,          { frameWidth: 16, frameHeight: 16 });
    // 6 rock-in-water variants in a single strip — same frame-pick pattern
    this.load.spritesheet('rocks-in-water', `${mwObj}/rock_in_water_01-sheet.png`, { frameWidth: 16, frameHeight: 16 });

    // ── Mystic Woods chests (for ABANDONED_CAMP chunk) ────────────────────────────
    // 4-frame sheet; frame 0 = closed chest. Referenced in ChunkDef with frame: 0.
    this.load.spritesheet('mw-chest-01', `${mwObj}/chest_01.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('mw-chest-02', `${mwObj}/chest_02.png`, { frameWidth: 16, frameHeight: 16 });

    // ── Craftpix top-down animal sprites (FIL-73) ─────────────────────────────────
    // Each sheet uses 16×16 px tiles. The TMX animation data shows even-column frames
    // are the actual animation frames (0,2,4,6 for idle; 0,2,4,6,8,10 for walk).
    const craftpixBase = 'assets/packs/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/PNG/Without_shadow';
    // ── Critters pack ──────────────────────────────────────────────────────────
    // SE-direction horizontal strips exported from Aseprite source files.
    // Frame sizes come from the Aseprite canvas: stag 32×41, boar 41×25 (trimmed),
    // badger 42×32. We load one direction and flip horizontally for leftward movement.
    const critterBase = 'assets/packs/critters';
    this.load.spritesheet('stag-idle',   `${critterBase}/stag/critter_stag_SE_idle.png`,    { frameWidth: 32, frameHeight: 41 });
    this.load.spritesheet('stag-walk',   `${critterBase}/stag/critter_stag_SE_walk.png`,    { frameWidth: 32, frameHeight: 41 });
    this.load.spritesheet('boar-idle',   `${critterBase}/boar/boar_SE_idle_strip.png`,      { frameWidth: 41, frameHeight: 25 });
    this.load.spritesheet('boar-walk',   `${critterBase}/boar/boar_SE_run_strip.png`,       { frameWidth: 41, frameHeight: 25 });
    this.load.spritesheet('badger-idle', `${critterBase}/badger/critter_badger_SE_idle.png`, { frameWidth: 42, frameHeight: 32 });
    this.load.spritesheet('badger-walk', `${critterBase}/badger/critter_badger_SE_walk.png`, { frameWidth: 42, frameHeight: 32 });
    this.load.spritesheet('deer-idle', `${craftpixBase}/Deer/Deer_Idle.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('deer-walk', `${craftpixBase}/Deer/Deer_Walk.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('hare-idle', `${craftpixBase}/Hare/Hare_Idle.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('hare-walk', `${craftpixBase}/Hare/Hare_Walk.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('fox-idle',  `${craftpixBase}/Fox/Fox_Idle.png`,   { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('fox-walk',  `${craftpixBase}/Fox/Fox_walk.png`,   { frameWidth: 16, frameHeight: 16 });
    // Black grouse flight sheet (192×128, 12 cols × 8 rows at 16×16 px) — used for all flying birds.
    this.load.spritesheet('grouse-fly',  `${craftpixBase}/Black_grouse/Black_grouse_Flight.png`, { frameWidth: 16, frameHeight: 16 });
    // Grouse idle/walk — used for ground-walking coveys in dense forest (same frame convention as deer/hare/fox).
    this.load.spritesheet('grouse-idle', `${craftpixBase}/Black_grouse/Black_grouse_Idle.png`,   { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('grouse-walk', `${craftpixBase}/Black_grouse/Black_grouse_Walk.png`,   { frameWidth: 16, frameHeight: 16 });

    // ── Pixel Crawler Free Pack — Body_A character sprite sheets (64×64 px frames)
    const bodyBase = 'assets/packs/Pixel Crawler - Free Pack 2.0.4/Pixel Crawler - Free Pack/Entities/Characters/Body_A/Animations';
    this.load.spritesheet('pc-idle-down', `${bodyBase}/Idle_Base/Idle_Down-Sheet.png`,  { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-idle-up',   `${bodyBase}/Idle_Base/Idle_Up-Sheet.png`,    { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-idle-side', `${bodyBase}/Idle_Base/Idle_Side-Sheet.png`,  { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-walk-down', `${bodyBase}/Walk_Base/Walk_Down-Sheet.png`,  { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-walk-up',   `${bodyBase}/Walk_Base/Walk_Up-Sheet.png`,    { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('pc-walk-side', `${bodyBase}/Walk_Base/Walk_Side-Sheet.png`,  { frameWidth: 64, frameHeight: 64 });

    // ── Mystic Woods style buildings — PixelLab generated, JRPG 3/4 view ────────────
    // Six pre-composed building sprites (roof + front wall visible). Each is a
    // separate PNG with transparent background, loaded as individual textures so
    // the texture key IS the frameKey stored on PlacedBuilding.
    const mwb = 'assets/packs/mw-buildings';
    this.load.image('mw-cottage',     `${mwb}/mw-cottage.png`);
    this.load.image('mw-dwelling',    `${mwb}/mw-dwelling.png`);
    this.load.image('mw-longhouse',   `${mwb}/mw-longhouse.png`);
    this.load.image('mw-smokehouse',  `${mwb}/mw-smokehouse.png`);
    this.load.image('mw-workshop',    `${mwb}/mw-workshop.png`);
    this.load.image('mw-market-hall', `${mwb}/mw-market-hall.png`);

    // ── Arena mode: Tinkerer hero (48×48 px PixelLab atlas) ───────────────────────
    // Only loaded in arena mode — avoids a needless download in wilderview.
    // Directions: south=down, north=up, east=side-right (west mirrored in code).
    if (this.gameMode === 'arena') {
      this.load.atlas(
        'tinkerer',
        'assets/sprites/characters/earth/heroes/tinkerer/tinkerer.png',
        'assets/sprites/characters/earth/heroes/tinkerer/tinkerer.json',
      );
      // TODO: replace with real panda atlas when sprites are available.
      // Stubs use a placeholder image so the atlas key registers without throwing.
      this.load.atlas('bao-panda',       'assets/packs/heroes/bao-panda.png',       'assets/packs/heroes/bao-panda.json');
      this.load.atlas('masterfen-panda', 'assets/packs/heroes/masterfen-panda.png', 'assets/packs/heroes/masterfen-panda.json');
    }
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    // Level 1 starts at dawn (FIL-37)
    this.worldClock = new WorldClock({ startPhase: 'dawn' });
    this.worldState = new WorldState(this, this.worldClock);

    // SeasonSystem layers seasonal state (spring/rainy/summer/autumn/winter) on
    // top of the WorldClock day/night cycle. It advances every 3 in-game days by
    // default and blends a palette tint into the day/night overlay (see blendedOverlay()).
    this.seasonSystem = new SeasonSystem(this, this.worldClock, this.worldState);
    this.worldState.registerSystem(this.seasonSystem);

    // FIL-58: WeatherSystem drives rain/clear transitions on a random schedule
    // (30–120 s gaps, 10–30 s rain periods) and handles all rain visual effects
    // (particles + dark overlay).  No audio until a rain-ambient asset is added.
    this.weatherSystem = new WeatherSystem(this, this.worldState);
    this.worldState.registerSystem(this.weatherSystem);

    // Placeholder map data — replaced by parseLdtkLevel() once LDtk export exists
    this.mapData = emptyLdtkLevel(WORLD_W, WORLD_H, TILE_SIZE);

    // Tear down WorldState when scene shuts down
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.musicTrack?.stop();
      // Stop ambient loops so they don't bleed into other scenes (e.g. CombatArenaScene).
      this.ambienceSound?.stop();
      this.oceanAmbienceSound?.stop();
      this.worldState.destroy();
      // Persist explored fog state so revisiting areas doesn't reset the fog.
      this.saveFogOfWar();
    });

    this.runSeed = Math.floor(Math.random() * 0xffffffff);
    this.baseNoise  = new FbmNoise(this.runSeed);
    // XOR seeds keep temp and moist completely uncorrelated with elevation and each other.
    // The hex literals spell 'temp' and 'mois' in ASCII for readability.
    this.tempNoise  = new FbmNoise(this.runSeed ^ 0x74656d70);
    this.moistNoise = new FbmNoise(this.runSeed ^ 0x6d6f6973);
    this.corruptionField = new CorruptionField(this.runSeed);
    // Merge hand-authored Level1Paths with procedurally generated animal trails (FIL-88).
    // generateAnimalTrails() traces noise-jittered paths between settlements and POIs,
    // returning 'animal'-type segments that the existing affinity system already honours.
    this.pathSystem = new PathSystem([
      ...LEVEL1_PATHS.map(s => ({ ...s })),
      ...generateAnimalTrails(this.runSeed),
    ]);
    // Trace diagonal rivers + build isRiverTile / isWaterfallTile grids (FIL-167).
    // Must run before drawProceduralTerrain so FIL-168 can use isRiverTile during
    // the terrain bake instead of the legacy horizontal RIVER_BANDS check.
    this.initRiverTileGrids();
    // FIL-170: patch the two wading-ford path segments with the ford positions
    // computed at runtime from the traced river paths.  The static definitions in
    // Level1Paths.ts are approximations — actual positions depend on the elevation
    // grid (noise-seed specific) and are only known after initRiverTileGrids().
    const wadingIds = ['river-a-wading', 'river-b-wading'];
    this.tracedRiverPaths.forEach((traced, i) => {
      const id = wadingIds[i];
      if (!id) return;
      const fordPt = traced.points[traced.river.ford.pathIndex];
      if (!fordPt) return;
      const hw = traced.river.ford.width / 2;
      const hh = traced.river.halfWidth;
      this.pathSystem.updateSegmentBounds(id, fordPt.x - hw, fordPt.y - hh, hw * 2, hh * 2);
    });
    this.drawProceduralTerrain();
    this.drawPaths();
    this.drawSettlementMarkers();
    this.createMountainWalls();
    this.createNavigationBarriers();
    this.createNavigationBarrierVisuals();
    this.createRiverCrossingVisuals();
    this.createSolidObjects();
    this.stampProceduralChunks();
    this.stampCorruptedLandmarks();
    this.stampSecretAreas();
    this.stampZoneBoundaries();
    if (DEBUG_SPAWN.decorScatter)       this.stampDecorationScatter();
    if (DEBUG_SPAWN.waterEdgeScatter)   this.stampWaterEdgeScatter();
    if (DEBUG_SPAWN.butterfliesAndBees) this.spawnButterfliesAndBees();
    if (DEBUG_SPAWN.buildings)          this.stampSettlementBuildings();
    this.spawnParticleEffects();

    // FIL-240: create WindSystem after all decorations are placed.
    // tileDevElev and tileDevW are populated by drawProceduralTerrain() above,
    // so the biome grid is available for per-decoration amplitude lookup.
    this.windSystem = new WindSystem(
      this,
      this.decorImages,
      this.tileDevElev,
      this.tileDevW,
    );

    // Hide all non-ground visuals on startup so the terrain bake can be
    // evaluated in isolation. Press H to toggle everything back on.
    for (const img of this.decorImages) img.setVisible(false);
    this.pathGraphics.setVisible(false);
    for (const ov of this.zoneOverlays.values()) ov.setVisible(false);
    for (const g of this.settlementGlows) g.setVisible(false);
    if (this.leavesEmitter)  this.leavesEmitter.emitting  = false;
    if (this.pollenEmitter)  this.pollenEmitter.emitting   = false;
    if (this.fireflyEmitter) this.fireflyEmitter.emitting  = false;

    this.spawnSettlementNpcs();
    this.createVendors();
    this.createLootChests();
    this.createInteractiveObjects();
    this.createPlayer();

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    // Zoom in so pixel-art sprites read clearly on a tablet screen.
    // 2.5× gives a tighter, more intimate view than the previous 2×.
    this.cameras.main.setZoom(3);

    const JOY_X      = 120;
    const JOY_Y      = this.scale.height - 120;
    const JOY_RADIUS = 50;

    // setScrollFactor(0) pins these circles to screen space so they don't scroll
    // with the camera — equivalent to rex's `fixed: true`.
    const base  = this.add.circle(JOY_X, JOY_Y, JOY_RADIUS, 0x444444, 0.45).setScrollFactor(0).setDepth(9999);
    const thumb = this.add.circle(JOY_X, JOY_Y, 22,          0xcccccc, 0.55).setScrollFactor(0).setDepth(9999);

    this.joystick = new SimpleJoystick(this, JOY_X, JOY_Y, JOY_RADIUS, thumb);

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

    // P = spawn/despawn player at camera centre, G = toggle iso grid (world dev route only)
    if (window.location.pathname.replace(/\/$/, '') === '/world') {
      this.input.keyboard!.on('keydown-P', () => this.toggleDevPlayer());
      this.input.keyboard!.on('keydown-G', () => this.toggleIsoGrid());
    }

    // ── Panda hero ability keys (FIL-314) — only registered in arena mode ─────────
    // 1/2 = Bao's Water Jet / Water Shield.
    // 1/2/3/4 = Master Fen's Ice Bolt / Water Push / Healing Rain / Torrent.
    if (this.gameMode === 'arena') {
      this.abilityKey1 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
      this.abilityKey2 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
      this.abilityKey3 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);
      this.abilityKey4 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR);
      // Hero-fired projectiles are emitted via 'projectile-spawned'; collect and tick them.
      this.events.on('projectile-spawned', (p: Projectile) => this.heroProjectiles.push(p));
    }

    // Reset dialog-active flags when any overlay returns control to GameScene
    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      this.npcDialogActive    = false;
      this.shrineDialogActive = false;
      this.vendorShopActive   = false;
    });
    // Deduct gold when UpgradeScene confirms a purchase (GameScene is paused, not sleeping,
    // so its event bus still processes emits from the overlay scene).
    this.events.on('upgrade-purchased', (cost: number) => {
      this.playerGold = Math.max(0, this.playerGold - cost);
      this.refreshGoldText();
    });
    // Apply shop purchases from ShopScene (FIL-93).
    // GameScene is paused while ShopScene is open; the event bus still fires.
    this.events.on('shop-purchased', (data: { effect: string; value: number; cost: number }) => {
      this.playerGold = Math.max(0, this.playerGold - data.cost);
      this.refreshGoldText();
      if (data.effect === 'heal') {
        // Clamp to max so a potion at full health isn't wasted on overflow.
        this.playerHp = Math.min(this.playerMaxHp, this.playerHp + data.value);
        this.setHpHud(this.playerHp);
      } else if (data.effect === 'cleanse_pct') {
        // Convert percentage points to the equivalent kill-credit.
        // RABBIT_COUNT is the denominator of the cleanse formula, so adding
        // RABBIT_COUNT * (pct/100) extra kill-credits raises the meter by pct%.
        this.cleanseKillsExtra += RABBIT_COUNT * (data.value / 100);
        const pct = Math.min(100, (this.kills + this.cleanseKillsExtra) / RABBIT_COUNT * 100);
        this.setCleanseHud(pct);
        this.events.emit('cleanse-updated', pct);
        this.worldState.setCleansePercent('zone-main', pct);
      }
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

    // H — toggle all world decorations so the bare terrain is visible for
    // design / polish. Delegates to toggleDecor() so the World Dev panel button stays in sync.
    this.input.keyboard?.on('keydown-H', () => { this.toggleDecor(); });

    this.rabbits = this.physics.add.group();
    if (DEBUG_SPAWN.rabbits) this.spawnRabbits();
    this.physics.add.collider(this.rabbits, this.mountainWalls);

    // FIL-106: spawn the three new corrupted enemy types
    this.foxEnemies  = this.physics.add.group();
    this.crowEnemies = this.physics.add.group();
    this.wispEnemies = this.physics.add.group();
    // Combined enemies group — exposes the EnemyHostScene interface required
    // by StormSovereign.monsoon() to iterate all active enemies in one pass.
    this.enemies = this.physics.add.group();
    this.spawnCorruptedEnemies();

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
      if (this.audioAvailable) this.sound.play('sfx-player-hit', { volume: 0.6 * this.sfxVol });
      // Red tint flash — more readable than alpha blink, same intent.
      this.playerSprite.setTint(0xff4444);
      this.time.delayedCall(200, () => this.playerSprite.clearTint());
      if (this.playerHp <= 0) this.onPlayerDeath();
    });

    // FIL-106: corrupted fox deals 30 damage on contact; crow only damages while swooping.
    // Both share the same 1.5 s invulnerability window as the rabbit overlap.
    const applyContactDamage = (dmg: number): void => {
      if (this.gameEnded || this.attractMode) return;
      const now = this.time.now;
      if (now < this.dashingUntil) return;
      if (now - this.lastDamagedAt < 1500) return;
      this.lastDamagedAt = now;
      this.playerHp = Math.max(0, this.playerHp - dmg);
      this.setHpHud(this.playerHp);
      if (this.audioAvailable) this.sound.play('sfx-player-hit', { volume: 0.6 * this.sfxVol });
      this.playerSprite.setTint(0xff4444);
      this.time.delayedCall(200, () => this.playerSprite.clearTint());
      if (this.playerHp <= 0) this.onPlayerDeath();
    };
    this.physics.add.overlap(this.player, this.foxEnemies, () => applyContactDamage(30));
    this.physics.add.overlap(this.player, this.crowEnemies, (_player, crow) => {
      if ((crow as Phaser.GameObjects.Rectangle).getData('state') === 'swooping') {
        applyContactDamage(25);
      }
    });

    this.createAnimalAnimations();
    this.groundAnimals = this.physics.add.group();
    if (DEBUG_SPAWN.groundAnimals) this.spawnGroundAnimals();
    if (DEBUG_SPAWN.birds)         this.spawnBirds();

    this.createHudAndOverlay();
    this.createPortal();
    this.createBoss();
    this.createGolems();
    this.createLevel1Zones();
    this.createLevel1Collectibles();
    this.createShrine();
    this.applyUpgrades();
    // SkillSystem reads from localStorage — initialise after upgrades so both
    // systems are ready before the first frame runs.
    this.skillSystem = new SkillSystem();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.trySwipe(pointer);
      } else if (pointer.rightButtonDown()) {
        this.tryRangedAttack(pointer);
      }
    });

    // Keyboard shortcut for ranged attack — fires toward the last known pointer position.
    this.input.keyboard?.on('keydown-R', () => {
      this.tryRangedAttack(this.input.activePointer);
    });

    this.events.on('cleanse-updated', (percent: number) => {
      this.applyWorldTint(percent);
      // FIL-178: update cliff corruption overlay as cleanse level changes.
      // The overlay darkens cliff faces with a purple tint in corrupted zones.
      this.updateCliffCorruption(percent);
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
    // Fog of war overlay at depth 49 — must come after terrain is drawn so the
    // RenderTexture sits on top of the world but under the HUD.
    this.initFogOfWar();

    // Ambient forest sound — skipped entirely when audio is unavailable (CI).
    // Initial volume matches the starting phase so it doesn't snap on first transition.
    if (this.audioAvailable && this.cache.audio.has('forest-ambience')) {
      this.ambienceSound = this.sound.add('forest-ambience', {
        loop: true,
        volume: this.phaseAmbienceVolume(this.currentPhase),
      });
      this.ambienceSound.play();
    }
    // FIL-108: ocean ambience starts at volume 0; updateAmbienceZone() fades it in
    // when the player is near the coast (biome < 0.33).
    if (this.audioAvailable && this.cache.audio.has('ocean-ambience')) {
      this.oceanAmbienceSound = this.sound.add('ocean-ambience', { loop: true, volume: 0 });
      this.oceanAmbienceSound.play();
    }
    // FIL-112: wind starts silent; updateAmbienceZone() fades it in on the mountain plateau.
    if (this.audioAvailable && this.cache.audio.has('sfx-wind')) {
      this.windSound = this.sound.add('sfx-wind', { loop: true, volume: 0 });
      this.windSound.play();
    }
    // FIL-110: settlement presence starts silent; updateSettlementAmbience() fades it in.
    if (this.audioAvailable && this.cache.audio.has('sfx-settlement')) {
      this.settlementSound = this.sound.add('sfx-settlement', { loop: true, volume: 0 });
      this.settlementSound.play();
    }
    // FIL-117: night ambience — starts at the correct volume for the initial phase
    // (0 during daytime, rises at dusk, peaks at night) so there's no snap on first transition.
    if (this.audioAvailable && this.cache.audio.has('night-ambience')) {
      this.ambienceNight = this.sound.add('night-ambience', {
        loop: true,
        volume: this.phaseNightAmbienceVolume(this.currentPhase),
      });
      this.ambienceNight.play();
    }

    // FIL-47: positional animal sounds — one loop per species group, volume driven by
    // the closest animal of that type. Files are optional; silently skipped if not yet sourced.
    for (const key of ['animal-bird', 'animal-deer', 'animal-hare', 'animal-fox']) {
      if (this.audioAvailable && this.cache.audio.has(key)) {
        const s = this.sound.add(key, { loop: true, volume: 0 });
        s.play();
        this.animalSounds.set(key, s);
      }
    }

    // Start background music for the initial day phase
    this.startPhaseMusic(this.currentPhase, 0);

    // FIL-113: When this scene resumes after a pause (any overlay closes), tween audio
    // back up. Phaser sets active=true BEFORE emitting 'resume', so our tween manager
    // is running again by the time this fires — safe to add new tweens here.
    this.events.on('resume', this.onSceneResume, this);

    // FIL-115: Live volume updates from SettingsScene sliders.
    // Each handler updates the multiplier and adjusts currently-playing sounds.
    type AudibleVol = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    this.game.events.on('settings:music-vol', (v: number) => {
      this.musicVol = v;
      if (this.musicTrack) {
        (this.musicTrack as AudibleVol).setVolume(this.phaseMusicVolume(this.currentPhase));
      }
    });
    this.game.events.on('settings:ambience-vol', (v: number) => {
      this.ambienceVol = v;
      // Force next updateAmbienceZone() to recalculate immediately.
      this.lastAmbienceZoneCheck = 0;
    });
    this.game.events.on('settings:sfx-vol', (v: number) => {
      this.sfxVol = v;
      // SFX are fire-and-forget; next plays pick up the new multiplier automatically.
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('settings:music-vol');
      this.game.events.off('settings:ambience-vol');
      this.game.events.off('settings:sfx-vol');
    });

    this.launchNavPanel();

    // Mouse-wheel zoom — works in both free-cam and normal play.
    this.input.on('wheel',
      (_ptr: unknown, _objs: unknown, _dx: number, dy: number) => {
        const cam  = this.cameras.main;
        const step = dy > 0 ? -0.15 : 0.15;
        cam.setZoom(Phaser.Math.Clamp(cam.zoom + step, 0.2, 6));
      },
    );

    // ── Keyboard zoom (= / + to zoom in, - to zoom out) ─────────────────────
    // Same ±0.15 step as the wheel so the two methods feel identical.
    // OS key-repeat means holding the key gives continuous smooth zoom.
    // = (no Shift) and + (Shift+=) both map to zoom-in for convenience.
    const stepZoom = (step: number) =>
      this.cameras.main.setZoom(
        Phaser.Math.Clamp(this.cameras.main.zoom + step, 0.2, 6),
      );
    this.input.keyboard!.on('keydown-PLUS',   () => stepZoom(+0.15));
    this.input.keyboard!.on('keydown-EQUALS', () => stepZoom(+0.15));
    this.input.keyboard!.on('keydown-MINUS',  () => stepZoom(-0.15));

    // ── Pinch-to-zoom (two-finger touch) ────────────────────────────────────
    // Phaser tracks pointer1 and pointer2 by default; addPointer(1) explicitly
    // ensures the second slot is initialised before the listeners fire.
    // When both fingers are down we compute the spread distance and scale the
    // camera zoom proportionally to the ratio of current / reference distance —
    // the same formula used by every mobile map app.
    this.input.addPointer(1);

    this.input.on('pointermove', () => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      if (!p1.isDown || !p2.isDown) {
        this.pinchZoomRef = null;
        return;
      }

      const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);

      if (!this.pinchZoomRef) {
        // First pointermove with two fingers — snapshot the starting state.
        this.pinchZoomRef = { dist, zoom: this.cameras.main.zoom };
        return;
      }

      if (this.pinchZoomRef.dist < 10) return; // guard: ignore near-zero reference
      this.cameras.main.setZoom(
        Phaser.Math.Clamp(
          this.pinchZoomRef.zoom * (dist / this.pinchZoomRef.dist),
          0.2,
          6,
        ),
      );
    });

    // Reset pinch reference whenever a finger lifts so the next gesture starts fresh.
    this.input.on('pointerup', () => { this.pinchZoomRef = null; });

    // ── Corruption filter (Phaser 4) ────────────────────────────────────────
    // Full-viewport corruption visual: UV warp, purple desat, pulsing vignette.
    // Passthrough when corruption == 0 (no GPU cost for a clean world).
    if (this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      this.corruptFilter = new CorruptionFilter(this.cameras.main);
      this.cameras.main.filters.external.add(this.corruptFilter);
    }
    // Skip attract screen on the /world dev route or when launched from the nav panel.
    const isDevWorld = window.location.pathname.replace(/\/$/, '') === '/world';
    if (isDevWorld) {
      // World dev route — free camera starting at Strandviken. Player hidden;
      // press P to spawn/despawn at camera centre for walkthrough testing.
      this.overlay.setAlpha(0);
      this.attractMode = false;
      this.freeCamMode = true;
      this.game.events.emit('nav-free-cam-changed', true);
      this.cameras.main.centerOn(450, 2820); // Strandviken
    } else if (this.skipAttract) {
      this.overlay.setAlpha(0);
      this.attractMode = false;
      this.player.setAlpha(1);
      (this.player.body as Phaser.Physics.Arcade.Body).setEnable(true);
      this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    } else {
      this.initAttractMode();
    }
  }

  update(time: number, delta: number): void {
    this.worldClock.update(delta);
    this.worldState.update(delta);
    this.updateDayNight(delta);
    if (this.attractMode) {
      this.updateAttractMode(time, delta);
    } else {
      this.updatePlayerMovement();
      this.updateAmbienceZone();
      this.updateSettlementAmbience();
      this.updateAnimalAmbience();
      this.updateLevel1(delta);
      this.updateNpcProximity();
      this.updateVendorInteraction();
      this.updateLootChestInteraction();
      this.updateShrine();
    }
    // Y-sort player every frame — depth = world-Y matches the raw-Y system used by
    // chunk-placed trees so the player correctly occludes them based on position.
    // Done outside the attractMode branch so it runs whether or not input is active.
    this.player.setDepth(this.player.y);
    this.playerShadow.setPosition(this.player.x + 6, this.player.y + 8);
    this.playerShadow.setDepth(this.player.y - 1);

    this.updateRabbits(time);
    this.updateCorruptedFoxes(time);
    this.updateCorruptedCrows(time);
    this.updateCorruptedWisps(time);
    this.updateRangedProjectiles(delta);
    if (this.bossAlive && this.boss) this.boss.update(delta);
    this.updateDustlings(delta);
    this.updateDryShades(delta);
    if (this.arenaHero) this.updateArenaHero(delta);
    this.updateGolems(delta);
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
    // ── Corruption shader update ─────────────────────────────────────────────
    // Computed every frame (getCleansePercent is a cheap state read) so the
    // shader responds immediately as the player cleanses shrines rather than
    // lagging by up to 5 s. Re-used below for path degradation too.
    const cleanse01           = this.worldState.getCleansePercent('zone-main');
    const globalCorruption01  = Math.max(0, 100 - cleanse01) / 100;
    if (this.corruptFilter) {
      this.corruptFilter.setCorruption(globalCorruption01);
    }

    // FIL-240: wind sway on visible decoration sprites.
    if (this.windSystem && this.decorVisible) {
      this.windSystem.update(
        time * 0.001,
        globalCorruption01,
        this.worldState.weather,
      );
    }

    // ── Corruption camera jitter ─────────────────────────────────────────────
    // Sample the corruption field at 5 points (player centre + 4 cardinal offsets
    // at ±80 px) to detect whether the player is near a corruption hotspot, even
    // if the centre pixel is clean. Using Math.max of 5 samples avoids the jitter
    // cutting out abruptly as the player skirts the edge of a corruption tendril.
    {
      const px = this.player.x;
      const py = this.player.y;
      const OFFSET = 80;
      const corruptionStrength = Math.max(
        this.corruptionField.sample(px,          py,          globalCorruption01),
        this.corruptionField.sample(px,          py - OFFSET, globalCorruption01),
        this.corruptionField.sample(px,          py + OFFSET, globalCorruption01),
        this.corruptionField.sample(px - OFFSET, py,          globalCorruption01),
        this.corruptionField.sample(px + OFFSET, py,          globalCorruption01),
      );
      // Oscillate back and forth at ~0.4 Hz so the camera jiggles rather than
      // tilting to a fixed angle. Max rotation 0.008 rad (~0.46°) — barely
      // perceptible but creates an unsettling "wrongness" feel in corrupted zones.
      // When corruptionStrength is 0 (player outside all corrupted tiles),
      // jitterAngle evaluates to 0 and setRotation(0) restores the normal view.
      const jitterAngle = Math.sin(time / 400) * 0.008 * corruptionStrength;
      this.cameras.main.setRotation(jitterAngle);
    }

    // Degrade path conditions every 5 s when corruption is above 0.
    if (time > this.nextPathDegradeAt) {
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
    // WASD camera pan runs every frame when free cam is active, regardless of game mode.
    // Calling it here (outside the attractMode branch) means it also works during gameplay.
    if (this.freeCamMode) this.updateFreeCam(delta);
    this.updateDevOverlay();
    // Fog of war: reveal tiles around the player each frame.
    // Runs outside the attractMode branch so the overlay is always visible,
    // but the player doesn't move during attract mode so fog is effectively static.
    this.updateFogOfWar();
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
  private spawnBias(wx: number, wy: number, type: 'deer' | 'hare' | 'fox' | 'rabbit' | 'grouse' | 'stag' | 'boar' | 'badger'): number {
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
      case 'grouse': return v > 0.65 && v < 0.90 ? 1.0 : 0.1;  // dense spruce forest only
      case 'stag':   return v > 0.40 && v < 0.72 ? 1.0 : 0.2;  // forest edge through mixed forest
      case 'boar':   return v > 0.62 && v < 0.88 ? 1.0 : 0.1;  // dense forest interior
      case 'badger': return v > 0.50 && v < 0.85 ? 1.0 : 0.2;  // forest belt
      default:       return 1.0;
    }
  }

  /** FIL-127: return a speed multiplier based on distance from spawn. */
  private getZoneMultiplier(x: number, y: number): number {
    const dist = Phaser.Math.Distance.Between(x, y, SPAWN_X, SPAWN_Y);
    if (dist < ZONE_A_END) return 1.0;
    if (dist < ZONE_B_END) return 1.3;
    return 1.5;
  }

  private spawnRabbits(): void {
    // Use a sub-seed so rabbits always appear at the same positions for a given runSeed.
    // Timing values (roamNext, fleeUntil) stay non-deterministic for gameplay variety.
    const rng = mulberry32(this.runSeed ^ 0xf00d1234);
    const rndBetween = (min: number, max: number): number =>
      Math.floor(rng() * (max - min + 1)) + min;

    for (let i = 0; i < RABBIT_SPAWN_COUNT; i++) {
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
        // FIL-127: scale speeds by zone so rabbits near the portal are harder.
        const mult = this.getZoneMultiplier(x, y);
        r.setData('chaseSpeed', Math.round(CHASE_SPEED * mult));
        r.setData('fleeSpeed',  Math.round(FLEE_SPEED  * mult));
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
        // FIL-295: 100 ms ramp so the rabbit accelerates into flight rather than snapping to full speed.
        const fleeStart = (r.getData('fleeStartTime') as number | null) ?? time;
        const ramp = Math.min((time - fleeStart) / 100, 1);
        this.physics.velocityFromRotation(away, ramp * ((r.getData('fleeSpeed') ?? FLEE_SPEED) as number), b.velocity);
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
        this.physics.velocityFromRotation(ang, (r.getData('chaseSpeed') ?? CHASE_SPEED) as number, b.velocity);
      } else if (next === 'roaming') {
        if (time > (r.getData('roamNext') as number)) {
          const wander = Phaser.Math.FloatBetween(0, Math.PI * 2);
          this.physics.velocityFromRotation(wander, ROAM_SPEED, b.velocity);
          r.setData('roamNext', time + Phaser.Math.Between(2000, 4000));
        }
      }
    }
  }

  /**
   * Spawn corrupted enemy types across the map (FIL-106).
   *
   * Uses a different RNG sub-seed from rabbits so the two populations don't
   * interfere. Each enemy is a coloured Rectangle — matching the zombie rabbit
   * pattern so all hit-detection and kill logic stays in the same code paths.
   *
   * Placement rules:
   *   - At least SPAWN_CLEAR (320 px) from the player start position
   *   - Up to 3 attempts per slot; slots that fail the bias check are skipped
   */
  private spawnCorruptedEnemies(): void {
    const rng = mulberry32(this.runSeed ^ 0xdead1106);
    const rndBetween = (min: number, max: number): number =>
      Math.floor(rng() * (max - min + 1)) + min;

    const place = (
      count: number,
      w: number,
      h: number,
      color: number,
      stroke: number,
      group: Phaser.Physics.Arcade.Group,
      initData: Record<string, unknown>,
    ): void => {
      for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const x = rndBetween(80, WORLD_W - 80);
          const y = rndBetween(80, WORLD_H - 80);
          if (Phaser.Math.Distance.Between(x, y, SPAWN_X, SPAWN_Y) < SPAWN_CLEAR) continue;
          const e = this.add.rectangle(x, y, w, h, color);
          e.setStrokeStyle(1, stroke);
          this.physics.add.existing(e);
          const body = e.body as Phaser.Physics.Arcade.Body;
          body.setCollideWorldBounds(true);
          body.setDrag(30, 30);
          group.add(e);
          for (const [k, v] of Object.entries(initData)) e.setData(k, v);
          break;
        }
      }
    };

    // Corrupted Fox — orange-red, 22×14, chases from 280 px
    place(5, 22, 14, 0xff5522, 0x882200, this.foxEnemies, { state: 'roaming', roamNext: 0 });
    // Corrupted Crow — blue-grey, 14×10, lurking / swooping / retreating
    place(4, 14, 10, 0x4466bb, 0x223388, this.crowEnemies, { state: 'lurking', swoopUntil: 0, retreatUntil: 0 });
    // Corruption Wisp — magenta, 14×14, drifts slowly; bursts near player
    place(4, 14, 14, 0xbb33bb, 0x771177, this.wispEnemies, { state: 'drifting', roamNext: 0, warnUntil: 0 });
  }

  /**
   * AI tick for corrupted foxes (FIL-106).
   *
   * Foxes have two states: roaming (slow random wander) and chasing (110 px/s
   * straight toward the player). Unlike rabbits they never flee — once aggro'd
   * they stay in chase until they are killed or run out of range by 40 px.
   */
  private updateCorruptedFoxes(time: number): void {
    const px = this.player.x;
    const py = this.player.y;
    const FOX_AGGRO  = 280;
    const FOX_SPEED  = 110;
    const FOX_ROAM   = 40;

    for (const child of this.foxEnemies.getChildren()) {
      const f = child as Phaser.GameObjects.Rectangle;
      const b = f.body as Phaser.Physics.Arcade.Body;
      const dist = Phaser.Math.Distance.Between(f.x, f.y, px, py);
      let state = f.getData('state') as string;

      if (state === 'roaming' && dist < FOX_AGGRO) {
        state = 'chasing';
        f.setData('state', state);
      } else if (state === 'chasing' && dist > FOX_AGGRO + 40) {
        state = 'roaming';
        f.setData('state', state);
        f.setData('roamNext', time + Phaser.Math.Between(1500, 3000));
      }

      if (state === 'chasing') {
        const ang = Phaser.Math.Angle.Between(f.x, f.y, px, py);
        this.physics.velocityFromRotation(ang, FOX_SPEED, b.velocity);
      } else {
        if (time > (f.getData('roamNext') as number)) {
          const wander = Phaser.Math.FloatBetween(0, Math.PI * 2);
          this.physics.velocityFromRotation(wander, FOX_ROAM, b.velocity);
          f.setData('roamNext', time + Phaser.Math.Between(2000, 4000));
        }
      }
    }
  }

  /**
   * AI tick for corrupted crows (FIL-106).
   *
   * Three-state machine: lurking → swooping → retreating → lurking.
   *   lurking    : slow approach (45 px/s); transition at dist < 160 px
   *   swooping   : fast dash (200 px/s); on close contact GameScene physics overlap
   *                deals 25 damage; transition once swoopUntil timer expires
   *   retreating : move away (100 px/s) for 1.2 s, then back to lurking
   *
   * Note: the contact damage check (state === 'swooping') lives in the physics
   * overlap callback set up in create() — not here.
   */
  private updateCorruptedCrows(time: number): void {
    const px = this.player.x;
    const py = this.player.y;
    const CROW_LURCH      =  45;
    const CROW_SWOOP      = 200;
    const CROW_RETREAT    = 100;
    const SWOOP_TRIGGER   = 160;
    const SWOOP_DURATION  = 800;  // ms before crow gives up and retreats
    const RETREAT_DURATION = 1200;

    for (const child of this.crowEnemies.getChildren()) {
      const c = child as Phaser.GameObjects.Rectangle;
      const b = c.body as Phaser.Physics.Arcade.Body;
      const dist  = Phaser.Math.Distance.Between(c.x, c.y, px, py);
      const state = c.getData('state') as string;

      if (state === 'lurking') {
        if (dist < SWOOP_TRIGGER) {
          c.setData('state', 'swooping');
          c.setData('swoopUntil', time + SWOOP_DURATION);
        } else {
          const ang = Phaser.Math.Angle.Between(c.x, c.y, px, py);
          this.physics.velocityFromRotation(ang, CROW_LURCH, b.velocity);
        }
      } else if (state === 'swooping') {
        if (time > (c.getData('swoopUntil') as number)) {
          c.setData('state', 'retreating');
          c.setData('retreatUntil', time + RETREAT_DURATION);
        } else {
          const ang = Phaser.Math.Angle.Between(c.x, c.y, px, py);
          this.physics.velocityFromRotation(ang, CROW_SWOOP, b.velocity);
        }
      } else if (state === 'retreating') {
        if (time > (c.getData('retreatUntil') as number)) {
          c.setData('state', 'lurking');
          b.setVelocity(0, 0);
        } else {
          const ang = Phaser.Math.Angle.Between(px, py, c.x, c.y);
          this.physics.velocityFromRotation(ang, CROW_RETREAT, b.velocity);
        }
      }
    }
  }

  /**
   * AI tick for corruption wisps (FIL-106).
   *
   * Wisps are ambient hazards, not chasers:
   *   drifting : slow random wander (25 px/s); if player enters 90 px → warning
   *   warning  : flash alpha (cosmetic) for 600 ms; if still close → burst
   *   burst    : deal 35 AOE damage if player within 120 px, then self-destruct
   *
   * The burst self-destructs via killCorruptedEnemy(), so it also credits cleanse
   * energy — wisps are actually worth killing indirectly by staying nearby.
   */
  private updateCorruptedWisps(time: number): void {
    const px = this.player.x;
    const py = this.player.y;
    const WISP_DRIFT     = 25;
    const WARN_RANGE     =  90;
    const BURST_RANGE    = 120;
    const WARN_DURATION  = 600;
    const WISP_DAMAGE    =  35;

    for (const child of this.wispEnemies.getChildren()) {
      const w = child as Phaser.GameObjects.Rectangle;
      const b = w.body as Phaser.Physics.Arcade.Body;
      const dist  = Phaser.Math.Distance.Between(w.x, w.y, px, py);
      const state = w.getData('state') as string;

      if (state === 'drifting') {
        // Drift with slow random direction changes
        if (time > (w.getData('roamNext') as number)) {
          const wander = Phaser.Math.FloatBetween(0, Math.PI * 2);
          this.physics.velocityFromRotation(wander, WISP_DRIFT, b.velocity);
          w.setData('roamNext', time + Phaser.Math.Between(2000, 4000));
        }
        if (dist < WARN_RANGE) {
          w.setData('state', 'warning');
          w.setData('warnUntil', time + WARN_DURATION);
          b.setVelocity(0, 0);
        }
      } else if (state === 'warning') {
        // Cosmetic pulse — oscillate alpha so it visually telegraphs the burst
        w.setAlpha(0.4 + 0.6 * Math.abs(Math.sin(time * 0.012)));

        if (time > (w.getData('warnUntil') as number)) {
          w.setData('state', 'burst');
        }
      } else if (state === 'burst') {
        w.setAlpha(1);
        // Deal damage only if player is still close enough
        if (dist < BURST_RANGE && !this.gameEnded && !this.attractMode) {
          const now = this.time.now;
          if (now > this.lastDamagedAt + 1500) {
            this.lastDamagedAt = now;
            this.playerHp = Math.max(0, this.playerHp - WISP_DAMAGE);
            this.setHpHud(this.playerHp);
            if (this.audioAvailable && this.cache.audio.has('sfx-player-hit')) {
              this.sound.play('sfx-player-hit', { volume: 0.6 * this.sfxVol });
            }
            this.playerSprite.setTint(0xff4444);
            this.time.delayedCall(200, () => this.playerSprite.clearTint());
            if (this.playerHp <= 0) this.onPlayerDeath();
          }
        }
        // Self-destruct regardless (credits cleanse energy)
        this.killCorruptedEnemy(w, 2.0);
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
      // Running skill multiplier scales speed by 1 % per level (invisible to the player —
      // they notice the improvement organically as movement starts feeling snappier).
      const speed = this.effectiveSpeed * this.skillSystem.multiplier('running') * speedMult;
      body.setVelocity((dx / len) * speed, (dy / len) * speed);

      // Award 1 running XP per second while the player is moving.
      if (now - this.lastRunXpAt >= 1000) {
        this.lastRunXpAt = now;
        this.skillSystem.addXP('running', 1);
      }
    } else {
      body.setVelocity(0, 0);
    }

    // Footstep sound — rate and volume scale with current movement speed (FIL-119).
    //
    // speedRatio: 0 = standing still, 1 = full sprint (PLAYER_SPEED px/s).
    // dynamicInterval: at half speed the interval doubles (steps sound slower);
    //   below 5 % speed (joystick drift, nearly still) it becomes Infinity so
    //   we don't fire a footstep for micro-movements.
    // Volume: 0.15 (quiet tiptoe) → 0.40 (full sprint), matching the visual cadence.
    const playerBody      = this.player.body as Phaser.Physics.Arcade.Body;
    const speedRatio      = Phaser.Math.Clamp(playerBody.speed / PLAYER_SPEED, 0, 1);
    const dynamicInterval = speedRatio > 0.05
      ? this.FOOTSTEP_INTERVAL_MS / speedRatio
      : Infinity;
    if (moving && this.time.now - this.lastFootstepAt > dynamicInterval) {
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

        const variant  = Phaser.Math.Between(0, 4);
        const footKey  = `footstep-${surface}-${variant}`;
        const stepVol  = 0.15 + 0.25 * speedRatio; // quiet crawl → louder sprint
        if (this.audioAvailable && this.cache.audio.has(footKey)) {
          this.sound.play(footKey, { volume: stepVol * this.sfxVol });
        }
      }
      this.lastFootstepAt = this.time.now;
    }

    // ── Idle attract trigger (FIL-98) ─────────────────────────────────────────
    // Count consecutive idle frames. After IDLE_ATTRACT_MS with no input during
    // real gameplay, hand the camera to the nearest animal at a closer zoom.
    // Any movement (joystick or keyboard) cancels it immediately.
    if (moving) {
      this.idleMs = 0;
      if (this.idleAttractTarget) this.exitIdleAttract();
    } else if (!this.attractMode && !this.freeCamMode) {
      this.idleMs += this.game.loop.delta;
      if (this.idleMs >= this.IDLE_ATTRACT_MS && !this.idleAttractTarget) {
        this.enterIdleAttract();
      }
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

  /**
   * FIL-105: draw a faint swipe-arc pie-slice at the player, aimed at pointer.
   * alpha 0.45 is used on the first-ever swipe so it reads as a hint;
   * normal gameplay can also call this at full alpha for future feedback.
   */
  private drawSwipeArc(pointer: Phaser.Input.Pointer, alpha = 1): void {
    const px  = this.player.x;
    const py  = this.player.y;
    const aim = Math.atan2(pointer.worldY - py, pointer.worldX - px);
    // Cleansing skill multiplier widens the visible arc radius so the player can
    // see their improved reach without any UI numbers.
    const r   = this.effectiveSwipeRange * this.skillSystem.multiplier('cleansing');
    const half = SWIPE_ARC / 2;

    const gfx = this.add.graphics();
    gfx.setDepth(50);
    gfx.fillStyle(0x88ddff, alpha);
    gfx.beginPath();
    gfx.moveTo(px, py);
    // strokeArcTo is not available on Phaser.GameObjects.Graphics;
    // we approximate the arc with small line segments.
    const STEPS = 16;
    for (let i = 0; i <= STEPS; i++) {
      const a = (aim - half) + (SWIPE_ARC * i) / STEPS;
      gfx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
    }
    gfx.closePath();
    gfx.fillPath();

    // Fade out and destroy over 350 ms.
    this.tweens.add({
      targets:  gfx,
      alpha:    0,
      duration: 350,
      ease:     'Sine.easeIn',
      onComplete: () => gfx.destroy(),
    });
  }

  private trySwipe(pointer: Phaser.Input.Pointer): void {
    if (this.attractMode) return;
    this.idleMs = 0;
    const now = this.time.now;
    if (now - this.lastSwipeAt < SWIPE_COOLDOWN_MS) {
      return;
    }
    this.lastSwipeAt = now;

    // FIL-105: on the very first swipe, show the arc visually so the player
    // discovers the mechanic, then return early (no damage this once).
    const isFirstSwipe = !localStorage.getItem('matlu_swipe_discovered');
    if (isFirstSwipe) {
      localStorage.setItem('matlu_swipe_discovered', '1');
      this.drawSwipeArc(pointer, 0.45);
      return;
    }

    // Dustling swarm disrupts the player's spells — 40 % chance of a miss
    // while any swarm member is alive. The cooldown is still consumed so the
    // player feels the penalty without realising the source immediately.
    if (this.dustlingSwarmAlive && Math.random() < 0.4) return;

    // FIL-132: white-flash + micro scale-pulse on every swipe attempt.
    this.playerSprite.setTint(0xffffff);
    this.time.delayedCall(90, () => this.playerSprite.clearTint());
    this.tweens.add({
      targets: this.playerSprite,
      scaleX: 1.18, scaleY: 1.18,
      duration: 75, yoyo: true, ease: 'Sine.easeOut',
    });

    // Swipe whoosh SFX — plays regardless of whether a rabbit is hit
    if (this.audioAvailable && this.cache.audio.has('sfx-swipe')) {
      this.sound.play('sfx-swipe', { volume: 0.35 * this.sfxVol });
    }

    const px = this.player.x;
    const py = this.player.y;
    const aim = Math.atan2(pointer.worldY - py, pointer.worldX - px);
    const half = SWIPE_ARC / 2;
    // Cleansing skill multiplier extends the arc radius by 1 % per level.
    // Using a local variable avoids mutating effectiveSwipeRange so upgrades
    // (cleanse_mastery) and skill bonuses stack independently.
    const swipeRange = this.effectiveSwipeRange * this.skillSystem.multiplier('cleansing');

    // ── Boss hit check (priority over rabbits) ────────────────────────────────
    //
    // The boss is a large 40×40 entity; use a slightly wider range (1.5×) so
    // it's satisfying to hit. Swipe is consumed if the boss is in range.
    if (this.bossAlive && this.boss) {
      const db = Phaser.Math.Distance.Between(px, py, this.boss.x, this.boss.y);
      if (db <= swipeRange * 1.5) {
        this.boss.takeDamage(1);
        this.boss.onHitBy(px, py);
        this.cameras.main.shake(200, 0.006);
        this.updateBossHud();
        this.skillSystem.addXP('cleansing', 3);
        return;
      }
    }

    // ── Golem hit check ───────────────────────────────────────────────────────
    for (const golem of this.golems) {
      if (!golem.isAlive) continue;
      const dg = Phaser.Math.Distance.Between(px, py, golem.x, golem.y);
      if (dg <= swipeRange * 1.2) {
        const gx = golem.x;
        const gy = golem.y;
        golem.takeDamage(1);
        golem.onHitBy(px, py);
        this.cameras.main.shake(120, 0.004);
        if (!golem.isAlive) {
          this.resolveDrops('crackedGolem', gx, gy);
        }
        this.skillSystem.addXP('cleansing', 3);
        return;
      }
    }

    // getChildren() already returns a plain array — no spread copy needed.
    for (const child of this.rabbits.getChildren()) {
      const r = child as Phaser.GameObjects.Rectangle;
      const d = Phaser.Math.Distance.Between(px, py, r.x, r.y);
      if (d > swipeRange) {
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
      this.skillSystem.addXP('cleansing', 3);
      break;
    }

    // FIL-94: neutral animals are now hittable — same distance/arc check as rabbits.
    // Killing too many of one species triggers the corruption penalty (see killNeutralAnimal).
    for (const child of this.groundAnimals.getChildren()) {
      const a = child as Phaser.GameObjects.Sprite;
      const d = Phaser.Math.Distance.Between(px, py, a.x, a.y);
      if (d > swipeRange) continue;
      const toA = Math.atan2(a.y - py, a.x - px);
      let da = toA - aim;
      while (da >  Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > half) continue;
      this.cameras.main.shake(80, 0.002);
      if (this.audioAvailable) this.sound.play('sfx-swipe-hit', { volume: 0.4 * this.sfxVol });
      this.killNeutralAnimal(a);
      this.skillSystem.addXP('cleansing', 2);
      break;
    }

    // FIL-106: corrupted enemies hittable with the same arc/range check.
    const enemyGroups: Array<[Phaser.Physics.Arcade.Group, number]> = [
      [this.foxEnemies, 2.0], [this.crowEnemies, 1.5], [this.wispEnemies, 2.0],
    ];
    for (const [grp, cv] of enemyGroups) {
      let hit = false;
      for (const child of grp.getChildren()) {
        const e = child as Phaser.GameObjects.Rectangle;
        const d = Phaser.Math.Distance.Between(px, py, e.x, e.y);
        if (d > swipeRange) continue;
        const toE = Math.atan2(e.y - py, e.x - px);
        let de = toE - aim;
        while (de >  Math.PI) de -= Math.PI * 2;
        while (de < -Math.PI) de += Math.PI * 2;
        if (Math.abs(de) > half) continue;
        this.cameras.main.shake(150, 0.004);
        if (this.audioAvailable) this.sound.play('sfx-swipe-hit', { volume: 0.55 * this.sfxVol });
        this.killCorruptedEnemy(e, cv);
        this.skillSystem.addXP('cleansing', 4);
        hit = true;
        break;
      }
      if (hit) break;
    }

    // Dustling AoE: swipe is an area-of-effect — kills ALL swarm members within
    // swipe range in one pass, unlike single-target rabbit logic above.
    if (this.dustlingSwarmAlive) {
      const killed = Dustling.aoeKill(px, py, swipeRange);
      if (killed > 0) {
        this.cameras.main.shake(100, 0.003);
        if (this.audioAvailable) this.sound.play('sfx-swipe-hit', { volume: 0.5 * this.sfxVol });
        this.skillSystem.addXP('cleansing', 2 * killed);
      }
    }
  }

  private applySwipeHit(rabbit: Phaser.GameObjects.Rectangle): void {
    const state = rabbit.getData('state') as RabbitState;
    if (state === 'fleeing') {
      return;
    }

    // Camera shake on every successful hit — same intensity as the arena (FIL-124).
    this.cameras.main.shake(150, 0.004);
    // Contact hit sound — layered on top of the gesture whoosh for tactile feedback.
    if (this.audioAvailable) this.sound.play('sfx-swipe-hit', { volume: 0.55 * this.sfxVol });

    if (Math.random() < 0.5) {
      this.killRabbit(rabbit);
    } else {
      const body = rabbit.body as Phaser.Physics.Arcade.Body;
      const away = Phaser.Math.Angle.Between(this.player.x, this.player.y, rabbit.x, rabbit.y);
      rabbit.setData('state', 'fleeing' satisfies RabbitState);
      rabbit.setData('fleeUntil', this.time.now + FLEE_MS);
      // Record when flee started so the update loop can apply the 100 ms acceleration ramp.
      rabbit.setData('fleeStartTime', this.time.now);
      this.physics.velocityFromRotation(away, FLEE_SPEED, body.velocity);
    }
  }

  /**
   * FIL-126: Fire a ranged cleanse bolt toward the pointer position.
   *
   * The bolt travels in a straight line, hits the first rabbit or boss it
   * reaches within RANGED_RANGE px, and applies the same kill/flee logic as
   * the melee swipe. Visually it's a small teal arc (circle) that differs
   * clearly from the blue swipe arc.
   *
   * Input: right-click or keyboard R.
   * Cooldown: RANGED_COOLDOWN_MS (1200ms — slower than swipe to feel secondary).
   */
  private tryRangedAttack(pointer: Phaser.Input.Pointer): void {
    if (this.attractMode || this.gameEnded) return;
    this.idleMs = 0;
    const now = this.time.now;
    if (now - this.lastRangedAt < RANGED_COOLDOWN_MS) return;
    this.lastRangedAt = now;

    // Dustling swarm disrupts ranged spells — same 40 % miss as melee swipe.
    if (this.dustlingSwarmAlive && Math.random() < 0.4) return;

    const px    = this.player.x;
    const py    = this.player.y;
    const angle = Math.atan2(pointer.worldY - py, pointer.worldX - px);

    // Teal bolt — distinct colour from the blue swipe arc (0x88ddff).
    const arc = this.add.arc(px, py, RANGED_RADIUS, 0, 360, false, 0x44ddcc)
      .setDepth(50)
      .setStrokeStyle(1, 0xaaffee);

    // Throwing skill extends max travel distance by 1 % per level — skilled
    // throwers reach targets that were previously just out of range.
    const maxDist = RANGED_RANGE * this.skillSystem.multiplier('throwing');

    this.rangedProjectiles.push({
      arc,
      vx:      Math.cos(angle) * RANGED_SPEED,
      vy:      Math.sin(angle) * RANGED_SPEED,
      dist:    0,
      maxDist,
    });

    // Award XP per throw; bonus XP on the very first throw ever.
    this.skillSystem.addXP('throwing', 5);
    if (this.skillSystem.trackFirst('first-throw')) {
      this.skillSystem.addXP('throwing', 25);
    }

    // White flash on player — same feedback as swipe so the action feels responsive.
    this.playerSprite.setTint(0xffffff);
    this.time.delayedCall(90, () => this.playerSprite.clearTint());
  }

  /**
   * Advance all live ranged bolts and check for hits.
   * Called every frame from update() — O(n × m) where n is typically 1–2 bolts.
   */
  private updateRangedProjectiles(delta: number): void {
    if (this.rangedProjectiles.length === 0) return;
    const dt = delta / 1000;

    this.rangedProjectiles = this.rangedProjectiles.filter(p => {
      // Advance position.
      p.arc.x  += p.vx * dt;
      p.arc.y  += p.vy * dt;
      p.dist   += Math.hypot(p.vx, p.vy) * dt;

      // Expire when max range is exceeded (skill-scaled per projectile).
      if (p.dist >= p.maxDist) {
        p.arc.destroy();
        return false;
      }

      // Boss hit — slightly larger radius since it's a 40×40 target.
      if (this.bossAlive && this.boss) {
        if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, this.boss.x, this.boss.y) < RANGED_RADIUS + 20) {
          this.boss.takeDamage(1);
          this.boss.onHitBy(p.arc.x, p.arc.y);
          this.cameras.main.shake(200, 0.006);
          this.updateBossHud();
          p.arc.destroy();
          return false;
        }
      }

      // Golem hit — 26×26 body, use moderate radius.
      for (const golem of this.golems) {
        if (!golem.isAlive) continue;
        if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, golem.x, golem.y) < RANGED_RADIUS + 14) {
          const gx = golem.x;
          const gy = golem.y;
          golem.takeDamage(1);
          golem.onHitBy(p.arc.x, p.arc.y);
          this.cameras.main.shake(120, 0.004);
          if (!golem.isAlive) {
            this.resolveDrops('crackedGolem', gx, gy);
          }
          p.arc.destroy();
          return false;
        }
      }


      // Rabbit hit — reuse applySwipeHit for consistent kill/flee logic.
      for (const child of this.rabbits.getChildren()) {
        const r = child as Phaser.GameObjects.Rectangle;
        if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, r.x, r.y) < RANGED_RADIUS + 8) {
          this.applySwipeHit(r);
          p.arc.destroy();
          return false;
        }
      }

      // FIL-94: neutral animal hit by ranged bolt
      for (const child of this.groundAnimals.getChildren()) {
        const a = child as Phaser.GameObjects.Sprite;
        if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, a.x, a.y) < RANGED_RADIUS + 8) {
          this.killNeutralAnimal(a);
          p.arc.destroy();
          return false;
        }
      }

      // FIL-106: corrupted enemy hit by ranged bolt
      for (const [grp, cv] of [
        [this.foxEnemies, 2.0], [this.crowEnemies, 1.5], [this.wispEnemies, 2.0],
      ] as Array<[Phaser.Physics.Arcade.Group, number]>) {
        for (const child of grp.getChildren()) {
          const e = child as Phaser.GameObjects.Rectangle;
          if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, e.x, e.y) < RANGED_RADIUS + 8) {
            this.killCorruptedEnemy(e, cv);
            p.arc.destroy();
            return false;
          }
        }
      }

      // FIL-302: Dustling hit — ranged bolt is single-target (swipe is the AoE).
      if (this.dustlingSwarmAlive) {
        for (const d of Dustling.getLiveSwarm()) {
          if (Phaser.Math.Distance.Between(p.arc.x, p.arc.y, d.x, d.y) < RANGED_RADIUS + 8) {
            d.takeDamage(d.maxHp);
            p.arc.destroy();
            return false;
          }
        }
      }

      return true; // still travelling
    });
  }

  private killRabbit(rabbit: Phaser.GameObjects.Rectangle): void {
    const rx = rabbit.x;
    const ry = rabbit.y;
    this.spawnEnergyBurst(rx, ry, this.player.x, this.player.y);
    if (this.audioAvailable) this.sound.play('sfx-enemy-death', { volume: 0.5 * this.sfxVol, pan: this.stereoPan(rx) });
    rabbit.destroy();
    this.kills += 1;
    const percent = Math.min(100, (this.kills + this.cleanseKillsExtra) / RABBIT_COUNT * 100);
    this.setCleanseHud(percent);
    this.events.emit('cleanse-updated', percent);
    // Also propagate through WorldState so systems can react to zone cleansing
    this.worldState.setCleansePercent('zone-main', percent);
    // Each rabbit kill nudges nearby road conditions back toward health.
    this.pathSystem.restoreNear(rx, ry, 300, 3);
    this.onZoneCleansed('rabbit', rx, ry);
    // Resolve drop table — award gold and show floating feedback text
    this.resolveDrops('zombieRabbit', rx, ry);
    // Bonus XP for the first kill ever (silent — no UI shown).
    if (this.skillSystem.trackFirst('first-kill')) {
      this.skillSystem.addXP('combat', 50);
    }
  }

  /**
   * Kill a neutral animal hit by swipe or ranged bolt (FIL-94).
   *
   * Neutral animals (deer, hare, fox, etc.) are the living world — killing too
   * many of one species adds a corruption penalty that caps the effective cleanse
   * bar. The first species-specific kill that crosses the 30 % threshold flashes
   * the bar amber as a warning; every kill beyond it adds 5 % corruption (max 40%).
   */
  private killNeutralAnimal(animal: Phaser.GameObjects.Sprite): void {
    const type = animal.getData('animalType') as string;
    const def = ANIMAL_DEFS[type];
    if (!def) { animal.destroy(); return; }

    const prev = this.neutralKills[type] ?? 0;
    const next = prev + 1;
    this.neutralKills[type] = next;

    const threshold = Math.max(1, Math.floor(def.count * 0.30));

    // At exactly the threshold: flash the cleanse bar amber as a warning.
    // Rectangle has no setTint — we briefly override the fill color and restore
    // it by re-running setCleanseHud() after 500 ms.
    if (next === threshold) {
      this.cleanseFill.setFillStyle(0xffaa33);
      const pct = Math.min(100, (this.kills + this.cleanseKillsExtra) / RABBIT_COUNT * 100);
      this.time.delayedCall(500, () => this.setCleanseHud(pct));
    }

    // Beyond the threshold: each extra kill adds 5 % corruption (capped at 40 %)
    if (next > threshold) {
      this.corruptionPenalty = Math.min(40, this.corruptionPenalty + 5);
      const percent = Math.min(100, (this.kills + this.cleanseKillsExtra) / RABBIT_COUNT * 100);
      this.setCleanseHud(percent);
    }

    this.spawnEnergyBurst(animal.x, animal.y, this.player.x, this.player.y);
    if (this.audioAvailable && this.cache.audio.has('sfx-enemy-death')) {
      this.sound.play('sfx-enemy-death', { volume: 0.3 * this.sfxVol, pan: this.stereoPan(animal.x) });
    }
    animal.destroy();
  }

  /**
   * Kill a corrupted enemy (fox / crow / wisp) and credit cleanse energy (FIL-106).
   *
   * cleanseVal is fractional — foxes/wisps give 2.0, crows give 1.5. This allows
   * fine-grained balancing without changing RABBIT_COUNT (the denominator stays
   * constant so the bar is always "how many rabbit-equivalents have you cleansed").
   */
  private killCorruptedEnemy(e: Phaser.GameObjects.Rectangle, cleanseVal: number): void {
    this.spawnEnergyBurst(e.x, e.y, this.player.x, this.player.y);
    if (this.audioAvailable) this.sound.play('sfx-enemy-death', { volume: 0.5 * this.sfxVol, pan: this.stereoPan(e.x) });
    e.destroy();
    this.cleanseKillsExtra += cleanseVal;
    this.enemyKills += 1;
    const percent = Math.min(100, (this.kills + this.cleanseKillsExtra) / RABBIT_COUNT * 100);
    this.setCleanseHud(percent);
    this.events.emit('cleanse-updated', percent);
    this.worldState.setCleansePercent('zone-main', percent);
    this.pathSystem.restoreNear(e.x, e.y, 300, 3);
    this.onZoneCleansed('enemy', e.x, e.y);
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
      // Stacked multipliers:
      //  1) lucky_strike upgrade (1.5×) if purchased
      //  2) combat skill multiplier (1 % per level) — more experienced fighters
      //     shake down slightly more gold, invisibly improving over many sessions.
      const boughtUpgrades = JSON.parse(localStorage.getItem('matlu_upgrades') ?? '{}') as Record<string, boolean>;
      const goldMult = (boughtUpgrades['lucky_strike'] ? 1.5 : 1) * this.skillSystem.multiplier('combat');
      const amount = Math.round(Phaser.Math.Between(table.gold.min, table.gold.max) * goldMult);
      this.playerGold += amount;
      this.refreshGoldText();
      // Floating "+N gold" feedback in world-space — rises and fades like collectible labels
      this.spawnFloatText(x, y, `+${amount} ${t('hud.gold')}`, '#ffe066');
    }

    // Award combat XP for every kill that has a drop table.
    this.skillSystem.addXP('combat', 5);
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
    // FIL-132: dissolve the player sprite before showing game-over.
    // The scene stays running during the tween so the camera/HUD remain visible.
    this.tweens.add({
      targets:  this.playerSprite,
      alpha:    0,
      scaleX:   1.5,
      scaleY:   0.15,
      duration: 350,
      ease:     'Cubic.easeIn',
      onComplete: () => {
        this.scene.pause();
        this.scene.launch('GameOverScene', { cleanse, kills: this.kills, durationMs } as unknown as object);
      },
    });
  }

  private onLevelComplete(): void {
    if (this.gameEnded) return;
    this.gameEnded = true;
    const durationMs = this.gameStartedAt > 0
      ? Math.round(this.time.now - this.gameStartedAt)
      : 0;
    const cleanse = Math.round(Math.min(100, (this.kills + this.cleanseKillsExtra) / RABBIT_COUNT * 100));
    const totalKills = this.kills + this.enemyKills;
    insertMatluRun({
      nickname: this.playerName || 'Player',
      score:    totalKills,
      duration_ms: durationMs,
    }).catch(() => {});
    const alignment = this.worldState.getAlignment();
    const endingData: EndingSceneData = {
      ending:    determineEnding(alignment, cleanse),
      alignment,
      kills:     totalKills,
      durationMs,
      cleanse,
    };

    // FIL-111: Fade out game music + ambience, play victory jingle, then launch
    // EndingScene after a brief pause so the jingle audibly starts first.
    type AudibleSound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    if (this.audioAvailable) {
      if (this.musicTrack) {
        this.tweens.add({ targets: this.musicTrack as AudibleSound, volume: 0, duration: 1500, ease: 'Sine.easeIn' });
      }
      if (this.ambienceSound) {
        this.tweens.add({ targets: this.ambienceSound as AudibleSound, volume: 0, duration: 1500, ease: 'Sine.easeIn' });
      }
      if (this.ambienceNight) {
        this.tweens.add({ targets: this.ambienceNight as AudibleSound, volume: 0, duration: 1500, ease: 'Sine.easeIn' });
      }
      if (this.cache.audio.has('sfx-victory')) {
        this.sound.play('sfx-victory', { volume: 0.7 * this.sfxVol });
      }
    }
    // Short delay lets the jingle begin before the scene freezes.
    this.time.delayedCall(400, () => {
      this.scene.pause();
      this.scene.launch(EndingScene.KEY, endingData as unknown as object);
    });
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
    this.idleMs = 0;
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

    // FIL-132: squish the sprite in the dominant dash direction, then pop back.
    const horiz = Math.abs(this.dashDx) >= Math.abs(this.dashDy);
    this.tweens.add({
      targets:  this.playerSprite,
      scaleX:   horiz ? 1.4 : 0.75,
      scaleY:   horiz ? 0.75 : 1.4,
      duration: this.effectiveDashDuration,
      ease:     'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.playerSprite,
          scaleX: 1, scaleY: 1,
          duration: 80, ease: 'Back.easeOut',
        });
      },
    });

    this.spawnDashAfterimages();

    // Bonus XP on the first dash ever — rewards discovering the mechanic.
    if (this.skillSystem.trackFirst('first-dash')) {
      this.skillSystem.addXP('running', 25);
    }

    // Reuse swipe SFX at a higher pitch for a distinct whoosh feel.
    if (this.audioAvailable && this.cache.audio.has('sfx-swipe')) {
      this.sound.play('sfx-swipe', { volume: 0.22 * this.sfxVol, rate: 1.6 });
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

    // Dark-red cap overlaid on the right portion of cleanseFill — shows corrupted
    // cleanse energy from over-hunting neutral animals (FIL-94). Width/position
    // updated in setCleanseHud() whenever corruptionPenalty changes.
    this.corruptionFill = this.add
      .rectangle(sw - pad - w + 2, pad + 10, 0, h - 4, 0x882222)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(301);
    this.hudObjects.push(this.corruptionFill);

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

    // Dustling swarm darkening overlay — shown while any swarm member is alive.
    // Depth 48 puts it below the main tint overlay (50) so they layer correctly.
    this.dustlingOverlay = this.add
      .rectangle(sw / 2, sh / 2, sw, sh, 0x000000, 0.45)
      .setScrollFactor(0)
      .setDepth(48)
      .setVisible(false);

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

    // Update corruption overlay — dark-red cap on the right end of the fill,
    // width proportional to corruptionPenalty (0-40). Anchored to the right edge
    // of whatever cleanseFill is currently filled to, not the full bar width.
    const corruptedPx = Math.min(
      this.cleanseFill.width,
      inner * Phaser.Math.Clamp(this.corruptionPenalty / 100, 0, 1),
    );
    this.corruptionFill.width = corruptedPx;
    this.corruptionFill.setX(this.cleanseFill.x + this.cleanseFill.width - corruptedPx);
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

    // FIL-118: Dramatic music moment — duck music to ~10% for ~1 s, play the
    // steel jingle after the duck completes, then swell music back over ~2 s.
    // This sequences the audio so the jingle "lands" in a moment of near-silence.
    //
    // We snapshot the live .volume before ducking rather than using phaseMusicVolume()
    // because the track may be mid-crossfade (e.g. during a phase transition) and the
    // live value is what the player actually hears.
    if (this.audioAvailable && this.musicTrack) {
      type AudibleSound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
      const savedVol = (this.musicTrack as AudibleSound).volume;
      this.tweens.add({
        targets: this.musicTrack as AudibleSound,
        volume: savedVol * 0.1,
        duration: 1000,
        ease: 'Sine.easeIn',
        onComplete: () => {
          // Play the jingle in the moment of near-silence.
          // Use sound.add() + .play() so we get a typed BaseSound back for the
          // 'complete' listener — sound.play() returns boolean | BaseSound and
          // TypeScript can't safely narrow it for the cast we need below.
          if (this.cache.audio.has('sfx-portal')) {
            const jingle = this.sound.add('sfx-portal', { volume: 0.6 * this.sfxVol, pan: this.stereoPan(this.portal.x) });
            jingle.once('complete', () => {
              // Swell music back to its pre-duck volume after the jingle finishes.
              if (this.musicTrack) {
                this.tweens.add({
                  targets: this.musicTrack as AudibleSound,
                  volume: savedVol,
                  duration: 2000,
                  ease: 'Sine.easeOut',
                });
              }
            });
            jingle.play();
          } else {
            // No jingle asset — swell back immediately so music doesn't stay quiet.
            if (this.musicTrack) {
              this.tweens.add({
                targets: this.musicTrack as AudibleSound,
                volume: savedVol,
                duration: 2000,
                ease: 'Sine.easeOut',
              });
            }
          }
        },
      });
    } else if (this.audioAvailable && this.cache.audio.has('sfx-portal')) {
      // No music track active — just play the jingle at face value.
      this.sound.add('sfx-portal', { volume: 0.6 * this.sfxVol, pan: this.stereoPan(this.portal.x) }).play();
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
      if (this.audioAvailable) this.sound.play('sfx-player-hit', { volume: 0.6 * this.sfxVol });
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
    this.createDustlingSwarm();
    this.createDryShades();
  }

  /**
   * Spawn 20 Dustling swarm enemies clustered near the boss area.
   *
   * Dustlings are Entity-based (extend Enemy → LivingEntity → Container), so
   * each one gets an Arcade physics body via physics.add.existing() — same
   * pattern as CorruptedGuardian. The shared player-position getter gives every
   * member the same gentle drift target without coupling Dustling to GameScene.
   */
  private createDustlingSwarm(): void {
    Dustling.clearRegistry();
    Dustling.setPlayerGetter(() => ({ x: this.player.x, y: this.player.y }));

    // Spawn 300 px west of the boss — inside the Vattenpandalandet entrance zone
    // but not on top of the boss spawn point.
    const SWARM_X = BOSS_X - 300;
    const SWARM_Y = BOSS_Y;

    for (let i = 0; i < 20; i++) {
      // Spread members in a ring so they immediately feel like a swarm.
      const angle = (i / 20) * Math.PI * 2;
      const radius = 40 + Math.random() * 60;
      const d = new Dustling(
        this,
        SWARM_X + Math.cos(angle) * radius,
        SWARM_Y + Math.sin(angle) * radius,
      );
      d.setDepth(SWARM_Y);
      this.physics.add.existing(d);
      (d.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
      this.enemies.add(d);
      this.dustlings.push(d);
    }

    this.dustlingSwarmAlive = true;
  }

  /**
   * Per-frame Dustling update: tick each live member, then sync the dark
   * overlay and swarmAlive flag based on whether any member remains.
   */
  private updateDustlings(delta: number): void {
    // Spread to a snapshot so registry mutations during death don't skip entries.
    const live = [...Dustling.getLiveSwarm()];
    for (const d of live) d.update(delta);

    const anyAlive = Dustling.getLiveSwarm().length > 0;
    if (this.dustlingSwarmAlive && !anyAlive) {
      // Swarm just died — lift the overlay and re-enable spells.
      this.dustlingSwarmAlive = false;
      this.dustlingOverlay.setVisible(false);
    } else if (anyAlive) {
      this.dustlingOverlay.setVisible(true);
    }
  }

  /**
   * Spawn DryShades in the Vattenpandalandet entrance area alongside the
   * Dustling swarm. Five shades patrol loosely — enough to force the player
   * to be aware of ability charges without completely denying them.
   *
   * Contact drains one ability charge per 1.5 s per Shade (per-instance
   * cooldown). A `'player-charge-drain'` scene event is emitted on each drain
   * so the future charge system can hook in without modifying this method.
   * Currently the event has no listener — the drain is a no-op until charges
   * are implemented (see backlog).
   */
  private createDryShades(): void {
    DryShade.clearRegistry();
    DryShade.setPlayerGetter(() => ({ x: this.player.x, y: this.player.y }));

    // Scatter shades in a ring around the Dustling swarm spawn point so the
    // player encounters them together with the swarm, not as a separate wave.
    const SWARM_X = BOSS_X - 300;
    const SWARM_Y = BOSS_Y;
    const COUNT   = 5;

    for (let i = 0; i < COUNT; i++) {
      const angle  = (i / COUNT) * Math.PI * 2;
      const radius = 80 + Math.random() * 60;
      const shade  = new DryShade(
        this,
        SWARM_X + Math.cos(angle) * radius,
        SWARM_Y + Math.sin(angle) * radius,
      );
      shade.setDepth(SWARM_Y);
      this.physics.add.existing(shade);
      (shade.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);

      // Overlap: no HP damage — only attempt an ability-charge drain.
      this.physics.add.overlap(this.player, shade, () => {
        if (this.gameEnded || this.attractMode || !shade.isAlive) return;
        const drained = shade.tryDrain(this.time.now);
        if (drained) {
          // Emit for the future charge system — currently a no-op.
          this.events.emit('player-charge-drain');
          // Brief tint feedback so the player knows contact occurred.
          this.playerSprite.setTint(0x99ccff);
          this.time.delayedCall(150, () => this.playerSprite.clearTint());
        }
      });

      // Register in the combined enemies group so StormSovereign.monsoon()
      // can iterate all live entities without knowing their concrete types.
      this.enemies.add(shade);
      this.dryShades.push(shade);
    }
  }

  /** Tick all live DryShades each frame. */
  private updateDryShades(delta: number): void {
    for (const shade of this.dryShades) {
      if (shade.isAlive) shade.update(delta);
    }
  }

  /**
   * Tick the panda hero (Bao or Master Fen) and handle ability key presses.
   *
   * The hero entity is kept at the player container's world position so its
   * cast methods use accurate coordinates.  The ability keys only fire when
   * the hero is alive and the scene is not in attract mode.
   *
   * Keys: 1/2 = Bao abilities; 1/2/3/4 = Master Fen abilities.
   * Target position is the current pointer location in world space.
   */
  private updateArenaHero(delta: number): void {
    const hero = this.arenaHero!;

    // Sync hero world position to the player container every frame.
    hero.setPosition(this.player.x, this.player.y);
    hero.update(delta);

    // Y-sort StormSovereign's scene-level rain emitter so it renders above
    // the ground layer but below entities at higher Y. TheTorrent's emitter
    // is inside the Container and inherits depth automatically.
    if (hero instanceof StormSovereign) {
      hero.setEmitterDepth(hero.y);
    }

    // Ability keys only fire when the hero is alive and input is active.
    if (!hero.isAlive || this.attractMode) return;
    if (!this.abilityKey1 || !this.abilityKey2) return;

    // Convert pointer screen coords → world coords using camera scroll + zoom.
    const ptr  = this.input.activePointer;
    const cam  = this.cameras.main;
    const wx   = ptr.x / cam.zoom + cam.scrollX;
    const wy   = ptr.y / cam.zoom + cam.scrollY;

    if (hero instanceof Bao) {
      // Key 1 — Water Jet: fires toward pointer.
      if (Phaser.Input.Keyboard.JustDown(this.abilityKey1)) {
        hero.castWaterJet(wx, wy);
      }
      // Key 2 — Water Shield: absorbs next incoming hit (30 s cooldown).
      if (Phaser.Input.Keyboard.JustDown(this.abilityKey2)) {
        hero.castWaterShield();
      }
    } else if (hero instanceof MasterFen) {
      // Key 1 — Ice Bolt: frost bolt toward pointer, slows on hit.
      if (Phaser.Input.Keyboard.JustDown(this.abilityKey1)) {
        hero.castIceBolt(wx, wy);
      }
      // Key 2 — Water Push: knockback to nearest enemy near pointer.
      if (Phaser.Input.Keyboard.JustDown(this.abilityKey2)) {
        hero.castWaterPush(wx, wy);
      }
      // Key 3 — Healing Rain: place a 3-tick heal zone at pointer.
      if (this.abilityKey3 && Phaser.Input.Keyboard.JustDown(this.abilityKey3)) {
        hero.castHealingRain(wx, wy);
      }
      // Key 4 — Torrent (signature): radial knockback + interrupt around hero.
      if (this.abilityKey4 && Phaser.Input.Keyboard.JustDown(this.abilityKey4)) {
        hero.castTorrent();
      }
    } else if (hero instanceof TheTorrent) {
      // Key 1 — Fluid Form: briefly disables solid-layer collision so the hero
      // can pass through terrain gaps. GameScene uses a static physics group
      // (not a TilemapLayer), so solidLayer is omitted — the body-immovability
      // change alone still lets the hero slip through dynamic bodies.
      if (Phaser.Input.Keyboard.JustDown(this.abilityKey1!)) {
        hero.fluidForm();
      }
    } else if (hero instanceof StormSovereign) {
      // Key 1 — Monsoon: deal flat damage to all enemies in the `enemies` group
      // and fire visual lightning bolts toward each one.
      if (Phaser.Input.Keyboard.JustDown(this.abilityKey1!)) {
        hero.monsoon();
      }
    }

    // Tick and prune projectiles fired by the hero (Water Jet / Ice Bolt).
    for (const p of this.heroProjectiles) p.tick(delta);
    this.heroProjectiles = this.heroProjectiles.filter(p => !p.isExpired);
  }

  /**
   * Spawn CrackedGolems in the forest/plateau area and wire up physics,
   * player overlap damage, and death-burst projectile collection.
   *
   * Golems are placed in a cluster near the mid-map forest zone so the player
   * encounters them before reaching the portal boss. Three fixed positions give
   * a deterministic layout without adding another RNG sub-seed.
   */
  private createGolems(): void {
    // Mid-corridor positions — spread across the Skuleskogen/forest zone.
    const SPAWN_POSITIONS: Array<{ x: number; y: number }> = [
      { x: 2100, y: 1300 },
      { x: 2450, y: 1150 },
      { x: 2700, y: 1450 },
    ];

    for (const pos of SPAWN_POSITIONS) {
      const golem = new CrackedGolem(this, pos.x, pos.y);
      golem.setDepth(pos.y);
      golem.setPlayerTarget(() => {
        // Expose the player as a Damageable for death-burst projectile targeting.
        // The player satisfies the Damageable interface via LivingEntity.
        return this.player as unknown as import('../entities/Projectile').Damageable;
      });

      this.physics.add.existing(golem);
      (golem.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
      this.physics.add.collider(golem, this.mountainWalls);

      // Contact damage — same invincibility window as boss and rabbit overlap.
      this.physics.add.overlap(this.player, golem, () => {
        if (this.gameEnded || this.attractMode || !golem.isAlive) return;
        const now = this.time.now;
        if (now < this.dashingUntil) return;
        if (now - this.lastDamagedAt < 1500) return;
        this.lastDamagedAt = now;
        this.playerHp = Math.max(0, this.playerHp - 15);
        this.setHpHud(this.playerHp);
        if (this.audioAvailable) this.sound.play('sfx-player-hit', { volume: 0.6 * this.sfxVol });
        this.playerSprite.setTint(0xff4444);
        this.time.delayedCall(200, () => this.playerSprite.clearTint());
        if (this.playerHp <= 0) this.onPlayerDeath();
      });

      this.enemies.add(golem);
      this.golems.push(golem);
    }

    // Collect projectiles from golem death bursts and tick them each frame.
    this.events.on('golem-death-burst', (projectiles: Projectile[]) => {
      this.golemProjectiles.push(...projectiles);
    });
  }

  /**
   * Tick all live golem entities and their death-burst projectiles.
   * Prunes expired projectiles from the list each frame.
   */
  private updateGolems(delta: number): void {
    for (const golem of this.golems) {
      if (golem.isAlive) golem.update(delta);
    }

    if (this.golemProjectiles.length === 0) return;
    for (const proj of this.golemProjectiles) {
      proj.tick(delta);
    }
    // Remove expired projectiles (hit target, exceeded range, or gone off-bounds).
    this.golemProjectiles = this.golemProjectiles.filter(p => !p.isExpired);
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
      // Boss is near the portal — always Zone C speeds.
      r.setData('chaseSpeed', Math.round(CHASE_SPEED * 1.5));
      r.setData('fleeSpeed',  Math.round(FLEE_SPEED  * 1.5));
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

  // ─── Day/Night + Season overlay (FIL-37, FIL-175) ───────────────────────────

  /**
   * Computes the blended RGBA overlay that combines the WorldClock phase tint
   * with the SeasonSystem season tint. Both overlays contribute proportionally
   * to their alpha values — when one has alpha 0 (e.g. morning) the other
   * dominates, so the season color is always visible.
   *
   * Uses `getEffectiveSeason('zone-main')` so corrupted zones (corruption > 0.5)
   * produce a winter tint rather than the current raw season.
   *
   * Called from both createDayNightOverlay() (initial frame) and
   * updateDayNight() (on phase or season change).
   */
  private blendedOverlay(): { colour: number; alpha: number } {
    const po = this.worldClock.overlay;
    // Use effective season for the main zone — corrupted zones are locked to winter.
    const so = this.seasonSystem.getEffectiveSeasonOverlay('zone-main');

    const totalAlpha = Math.min(1, po.alpha + so.alpha);
    let r: number, g: number, b: number;
    if (totalAlpha <= 0) {
      r = 0; g = 0; b = 0;
    } else {
      // Blend each channel weighted by each overlay's alpha contribution.
      // This means a season with alpha 0.08 gets 50% weight when the phase
      // is at alpha 0.08 too, producing an equal mix.
      const pw = po.alpha / totalAlpha;
      const sw = so.alpha / totalAlpha;
      r = Math.round(po.r * pw + so.r * sw);
      g = Math.round(po.g * pw + so.g * sw);
      b = Math.round(po.b * pw + so.b * sw);
    }

    return { colour: Phaser.Display.Color.GetColor(r, g, b), alpha: totalAlpha };
  }

  private createDayNightOverlay(): void {
    // Full-world rectangle sitting above all world objects but below HUD
    this.dayNightOverlay = this.add
      .rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x000000, 0)
      .setDepth(48)
      .setScrollFactor(1);
    // Apply the initial blended phase + season overlay (no tween on first frame)
    const { colour, alpha } = this.blendedOverlay();
    this.dayNightOverlay.setFillStyle(colour, alpha);
    this.currentPhase = this.worldClock.phase;
    this._currentSeason = this.seasonSystem.getEffectiveSeason('zone-main');
    // FIL-227 / FIL-299: seed lerp state — treat the initial overlay as fully arrived so
    // the first updateDayNight() call has valid from/to values and no stale lerp.
    const ov = this.worldClock.overlay;
    this.currentOverlay = { ...ov };
    this.lerpFrom       = { ...ov };
    this.lerpTo         = { ...ov };
    this.overlayLerpElapsed = this.OVERLAY_LERP_DURATION;
  }

  // FIL-227 / FIL-299: called every frame; lerps r/g/b/alpha of the overlay over
  // OVERLAY_LERP_DURATION (20 s) whenever the phase changes.
  private updateDayNight(delta: number): void {
    const newPhase = this.worldClock.phase;
    // SeasonSystem.update() already ran this frame (worldState.update() calls it),
    // so getEffectiveSeason() reflects the latest season state.
    const newSeason = this.seasonSystem.getEffectiveSeason('zone-main');

    // Only start a new lerp when either the phase or the season has changed.
    if (newPhase !== this.currentPhase || newSeason !== this._currentSeason) {
      this.currentPhase = newPhase;
      this._currentSeason = newSeason;

      // Capture where the display currently sits as the lerp start so a
      // mid-transition change blends from the actual displayed colour
      // rather than jumping back to the previous overlay.
      this.lerpFrom           = { ...this.currentOverlay };
      // Compute the blended phase + season target as raw RGBA for the lerp.
      const po = this.worldClock.overlay;
      const so = this.seasonSystem.getEffectiveSeasonOverlay('zone-main');
      const totalAlpha = Math.min(1, po.alpha + so.alpha);
      if (totalAlpha <= 0) {
        this.lerpTo = { r: 0, g: 0, b: 0, alpha: 0 };
      } else {
        const pw = po.alpha / totalAlpha;
        const sw = so.alpha / totalAlpha;
        this.lerpTo = {
          r: Math.round(po.r * pw + so.r * sw),
          g: Math.round(po.g * pw + so.g * sw),
          b: Math.round(po.b * pw + so.b * sw),
          alpha: totalAlpha,
        };
      }
      this.overlayLerpElapsed = 0;

      // Audio and particle transitions stay at 8 s — they don't need to match
      // the visual lerp duration.
      if (this.ambienceSound) {
        this.tweens.add({
          targets: this.ambienceSound,
          volume: this.phaseAmbienceVolume(newPhase),
          duration: 8000,
          ease: 'Sine.easeInOut',
        });
      }
      // FIL-117: fade night ambience in/out with each phase transition (8 s, matches music crossfade)
      if (this.ambienceNight) {
        this.tweens.add({
          targets: this.ambienceNight,
          volume: this.phaseNightAmbienceVolume(newPhase),
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

    // Advance the lerp every frame and apply the interpolated colour + alpha.
    // Clamping elapsed to the duration keeps t pinned at 1.0 after the
    // transition finishes so we don't over-shoot.
    this.overlayLerpElapsed = Math.min(
      this.overlayLerpElapsed + delta,
      this.OVERLAY_LERP_DURATION,
    );
    const raw = this.overlayLerpElapsed / this.OVERLAY_LERP_DURATION;
    // Ease-in-out for a natural-feeling sunrise/sunset
    const t = Phaser.Math.Easing.Sine.InOut(raw);

    const r     = Math.round(Phaser.Math.Linear(this.lerpFrom.r,     this.lerpTo.r,     t));
    const g     = Math.round(Phaser.Math.Linear(this.lerpFrom.g,     this.lerpTo.g,     t));
    const b     = Math.round(Phaser.Math.Linear(this.lerpFrom.b,     this.lerpTo.b,     t));
    const alpha = Phaser.Math.Linear(this.lerpFrom.alpha, this.lerpTo.alpha, t);

    // Track current display state so the next phase-change lerp starts here.
    this.currentOverlay = { r, g, b, alpha };
    this.dayNightOverlay.setFillStyle(Phaser.Display.Color.GetColor(r, g, b), alpha);
  }

  // ─── Fog of war (FIL-217) ─────────────────────────────────────────────────────

  /**
   * Initialise the fog-of-war system.
   *
   * Creates the 141×94 Uint8Array state grid, restores any previously explored
   * tiles from localStorage, then paints the initial RenderTexture overlay.
   *
   * The overlay sits at depth 49 — above the day/night rectangle (48) and
   * below the corruption overlay (50).
   */
  private initFogOfWar(): void {
    const tilesX = Math.ceil(WORLD_W / TILE_SIZE); // 141
    const tilesY = Math.ceil(WORLD_H / TILE_SIZE); // 94

    // Allocate state grid — all bytes default to 0 (FOG_UNSEEN).
    this.fogGrid = new Uint8Array(tilesX * tilesY);

    // Restore explored (SEEN) tiles persisted from a previous session.
    // The saved value is a JSON array of flat tile indices.
    // VISIBLE is never persisted — all saved entries are loaded as SEEN (= 1).
    const saved = localStorage.getItem(FOG_LS_KEY);
    if (saved) {
      try {
        const indices = JSON.parse(saved) as number[];
        for (const idx of indices) {
          if (idx >= 0 && idx < this.fogGrid.length) {
            this.fogGrid[idx] = FOG_SEEN;
          }
        }
      } catch {
        // Corrupt or unexpected format — silently discard and start fresh.
      }
    }

    // ── Stamp Graphics ────────────────────────────────────────────────────────
    // Two reusable 32×32 Graphics objects used as "stamps" for RT draw/erase.
    // They are invisible in the normal render but usable as RT sources —
    // same pattern as the terrain bake's off-screen tileImg.
    this.fogUnseenGfx = this.add.graphics().setVisible(false);
    this.fogUnseenGfx.fillStyle(0x000000, 1).fillRect(0, 0, TILE_SIZE, TILE_SIZE);

    this.fogSeenGfx = this.add.graphics().setVisible(false);
    this.fogSeenGfx.fillStyle(0x000000, 0.5).fillRect(0, 0, TILE_SIZE, TILE_SIZE);

    // ── RenderTexture overlay ──────────────────────────────────────────────────
    // Covers the full world. setOrigin(0,0) so position (0,0) = top-left of world.
    this.fogRt = this.add
      .renderTexture(0, 0, WORLD_W, WORLD_H)
      .setOrigin(0, 0)
      .setDepth(49);

    // Start with the entire world blacked out (every tile UNSEEN).
    // A single fill() call is far cheaper than 13 254 individual draws.
    this.fogRt.fill(0x000000, 1);

    // Restore SEEN tiles: erase the solid black, then paint the 50%-alpha shroud.
    // Two RT operations per SEEN tile — only paid at startup, and only for
    // tiles the player has already explored (empty on a fresh save).
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        if (this.fogGrid[ty * tilesX + tx] === FOG_SEEN) {
          const px = tx * TILE_SIZE;
          const py = ty * TILE_SIZE;
          // erase() punches a transparent hole (DESTINATION_OUT blend).
          // The stamp is positioned at the target tile before each call.
          this.fogUnseenGfx.setPosition(px, py);
          this.fogRt.erase(this.fogUnseenGfx);
          this.fogSeenGfx.setPosition(px, py);
          this.fogRt.draw(this.fogSeenGfx);
        }
      }
    }
  }

  /**
   * Update the fog overlay for the current frame.
   *
   * Only processes the "dirty region" — the union of the previous and current
   * sight-circle bounding boxes — so tiles far from the player are untouched.
   *
   * State machine per tile inside the dirty region:
   *   UNSEEN  → VISIBLE : erase black → transparent
   *   SEEN    → VISIBLE : erase shroud → transparent
   *   VISIBLE → SEEN    : erase transparent → draw 50%-alpha shroud
   *   (UNSEEN/SEEN outside the new circle: no change)
   */
  private updateFogOfWar(): void {
    if (!this.fogGrid || !this.fogRt || !this.fogUnseenGfx || !this.fogSeenGfx) return;

    const tilesX = Math.ceil(WORLD_W / TILE_SIZE);
    const tilesY = Math.ceil(WORLD_H / TILE_SIZE);

    // Player's tile coordinate (centre of the sight circle).
    const ptx = Math.floor(this.player.x / TILE_SIZE);
    const pty = Math.floor(this.player.y / TILE_SIZE);

    // Current sight-circle bounding box (clamped to the tile grid).
    const currBounds = {
      x0: Math.max(0, ptx - FOG_SIGHT_R),
      y0: Math.max(0, pty - FOG_SIGHT_R),
      x1: Math.min(tilesX - 1, ptx + FOG_SIGHT_R),
      y1: Math.min(tilesY - 1, pty + FOG_SIGHT_R),
    };

    // Dirty region = union of previous and current bounding boxes so tiles
    // that LEAVE the sight circle this frame are also updated.
    const prev = this.fogPrevBounds ?? currBounds;
    const dirtyX0 = Math.min(prev.x0, currBounds.x0);
    const dirtyY0 = Math.min(prev.y0, currBounds.y0);
    const dirtyX1 = Math.max(prev.x1, currBounds.x1);
    const dirtyY1 = Math.max(prev.y1, currBounds.y1);

    const R2 = FOG_SIGHT_R * FOG_SIGHT_R;

    // Single pass through the dirty region.
    // For each tile, compute new state, then update the RT only if it changed.
    for (let ty = dirtyY0; ty <= dirtyY1; ty++) {
      for (let tx = dirtyX0; tx <= dirtyX1; tx++) {
        const idx     = ty * tilesX + tx;
        const oldState = this.fogGrid[idx];

        const dx = tx - ptx;
        const dy = ty - pty;
        const inSight = dx * dx + dy * dy <= R2;

        // New state: VISIBLE if within radius, otherwise downgrade VISIBLE→SEEN,
        // leave UNSEEN/SEEN unchanged.
        const newState = inSight
          ? FOG_VISIBLE
          : oldState === FOG_VISIBLE
            ? FOG_SEEN
            : oldState;

        if (newState === oldState) continue; // nothing to do for this tile

        this.fogGrid[idx] = newState;

        const px = tx * TILE_SIZE;
        const py = ty * TILE_SIZE;

        if (newState === FOG_VISIBLE) {
          // Remove whatever fog was covering this tile (black or shroud).
          this.fogUnseenGfx.setPosition(px, py);
          this.fogRt.erase(this.fogUnseenGfx);
        } else {
          // newState === FOG_SEEN: tile was VISIBLE (transparent), now needs shroud.
          // erase first to reset alpha, then draw 50%-alpha stamp on top.
          this.fogUnseenGfx.setPosition(px, py);
          this.fogRt.erase(this.fogUnseenGfx);
          this.fogSeenGfx.setPosition(px, py);
          this.fogRt.draw(this.fogSeenGfx);
        }
      }
    }

    this.fogPrevBounds = currBounds;
  }

  /**
   * Serialise the fog state to localStorage so explored areas persist across sessions.
   *
   * Only SEEN/UNSEEN bits are persisted — VISIBLE tiles are saved as SEEN
   * (the player was just there; it would be jarring to reset on reload).
   * Called from the SHUTDOWN event so it runs on both normal exits and tab closes.
   */
  private saveFogOfWar(): void {
    if (!this.fogGrid) return;

    // Collect indices of all explored tiles (SEEN or VISIBLE → treated as SEEN).
    // FOG_UNSEEN (0) tiles are skipped — they haven't been visited.
    const seenIndices: number[] = [];
    for (let i = 0; i < this.fogGrid.length; i++) {
      if (this.fogGrid[i] > FOG_UNSEEN) {
        seenIndices.push(i);
      }
    }

    try {
      localStorage.setItem(FOG_LS_KEY, JSON.stringify(seenIndices));
    } catch {
      // localStorage quota exceeded or unavailable — fog state will reset on next load.
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
    // FIL-115: multiply by user-controlled musicVol slider (default 1.0).
    let base: number;
    switch (phase) {
      case 'dawn':      base = 0.20; break;
      case 'morning':   base = 0.30; break;
      case 'midday':    base = 0.28; break;
      case 'afternoon': base = 0.25; break;
      case 'dusk':      base = 0.18; break;
      case 'night':     base = 0.15; break;
    }
    return base * this.musicVol;
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

    // One-shot bell stinger marks the moment the phase flips — plays at the
    // very start of the crossfade, not after, so it punctuates the transition.
    if (this.cache.audio.has('sfx-phase-stinger')) {
      this.sound.play('sfx-phase-stinger', { volume: 0.15 });
    }

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

  /** Ambience volume target for each day phase, scaled by the user's ambience slider. */
  private phaseAmbienceVolume(phase: DayPhase): number {
    // FIL-115: multiply by user-controlled ambienceVol slider (default 1.0).
    let base: number;
    switch (phase) {
      case 'dawn':      base = 0.10; break; // forest waking slowly
      case 'morning':   base = 0.25; break; // full birdsong
      case 'midday':    base = 0.25; break;
      case 'afternoon': base = 0.20; break; // settling toward evening
      case 'dusk':      base = 0.08; break; // last light fading
      case 'night':     base = 0.00; break; // silent except wind
    }
    return base * this.ambienceVol;
  }

  /**
   * FIL-117: Night ambience volume per day phase.
   * Silent during daytime; rises at dusk as the forest goes quiet; peaks at night.
   * Complement to phaseAmbienceVolume() — the two layers cross-fade naturally.
   */
  private phaseNightAmbienceVolume(phase: DayPhase): number {
    switch (phase) {
      case 'dawn':      return 0.00;
      case 'morning':   return 0.00;
      case 'midday':    return 0.00;
      case 'afternoon': return 0.00;
      case 'dusk':      return 0.12; // insects start as the light fades
      case 'night':     return 0.25; // full night chorus
    }
  }

  /**
   * FIL-116: Convert a world-space X coordinate to a stereo pan value (-1 left, +1 right).
   *
   * `pan = clamp((sourceX - cameraCenter.x) / halfScreenWidth, -1, 1)`
   *
   * Where cameraCenter.x accounts for camera scroll so the pan reflects what the
   * player actually sees — a sound off the right edge of the viewport pans right.
   * Returns 0 (centre) if the camera hasn't been set up yet.
   */
  private stereoPan(sourceX: number): number {
    const cam = this.cameras.main;
    if (!cam) return 0;
    const centerX    = cam.scrollX + cam.width / 2;
    const halfScreen = this.scale.width / 2;
    return Phaser.Math.Clamp((sourceX - centerX) / halfScreen, -1, 1);
  }

  // ── FIL-108: Zone-sensitive ambience ─────────────────────────────────────────

  /**
   * Cross-fades forest ↔ ocean ambience based on the player's biome position.
   * Throttled to run every 1 000 ms — a 2 s tween covers the gap smoothly.
   *
   * Biome formula mirrors `updatePlayerMovement()` exactly so the sound matches
   * the terrain colour the player sees underfoot. biome < 0.33 = coastal zone;
   * biome < 0.25 = open sea (full ocean ambience, forest fades to near-zero).
   */
  private updateAmbienceZone(): void {
    const now = this.time.now;
    if (now - this.lastAmbienceZoneCheck < 1000) return;
    this.lastAmbienceZoneCheck = now;

    const tx = this.player.x / TILE_SIZE;
    const ty = this.player.y / TILE_SIZE;
    const biomeVal = this.baseNoise.fbm(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
    const fsPerp   = (this.player.x / WORLD_W - (1 - this.player.y / WORLD_H)) / 2;
    const fsMtB    = Math.pow(Math.max(0, -fsPerp - 0.10), 1.5) * 4.0;
    const fsOcB    = Math.pow(Math.max(0, fsPerp  - 0.15), 1.5) * 3.0;
    const biome    = Math.max(0, Math.min(1.2, biomeVal * 0.70 + fsMtB - fsOcB));

    // oceanFrac: 1.0 at the waterline (biome = 0), 0.0 at the forest edge (biome ≥ 0.33).
    const oceanFrac       = Phaser.Math.Clamp((0.33 - biome) / 0.33, 0, 1);
    const phaseForestVol  = this.phaseAmbienceVolume(this.currentPhase);
    const targetForest    = phaseForestVol * (1 - oceanFrac * 0.85);
    const targetOcean     = 0.18 * oceanFrac;

    const FADE = 2000;
    type AudibleSound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    if (this.ambienceSound) {
      this.tweens.add({ targets: this.ambienceSound as AudibleSound, volume: targetForest, duration: FADE, ease: 'Sine.easeInOut' });
    }
    if (this.oceanAmbienceSound) {
      this.tweens.add({ targets: this.oceanAmbienceSound as AudibleSound, volume: targetOcean, duration: FADE, ease: 'Sine.easeInOut' });
    }
    // FIL-112: wind fades in on the mountain plateau (biome ≥ 0.81 — Klipptoppen and above).
    const windFrac   = Phaser.Math.Clamp((biome - 0.81) / 0.19, 0, 1);
    const targetWind = 0.22 * windFrac;
    if (this.windSound) {
      this.tweens.add({ targets: this.windSound as AudibleSound, volume: targetWind, duration: FADE, ease: 'Sine.easeInOut' });
    }
  }

  // ── FIL-110: Settlement ambient ───────────────────────────────────────────────

  /**
   * Fades in a soft ambient loop when the player is near any of the three settlements.
   * Uses a single shared sound so walking between settlements feels continuous — volume
   * reflects the closest settlement rather than layering multiple tracks.
   * Throttled to 800 ms; the 1500 ms tween fills the gap smoothly.
   */
  private updateSettlementAmbience(): void {
    const now = this.time.now;
    if (now - this.lastSettlementCheck < 800) return;
    this.lastSettlementCheck = now;

    let maxFrac = 0;
    for (const s of SETTLEMENTS) {
      const dist  = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
      const outer = s.radius * 2.5;
      const inner = s.radius * 0.5;
      if (dist < outer) {
        maxFrac = Math.max(maxFrac, Phaser.Math.Clamp((outer - dist) / (outer - inner), 0, 1));
      }
    }

    const targetVol = 0.12 * maxFrac;
    type AudibleSound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    if (this.settlementSound) {
      this.tweens.add({ targets: this.settlementSound as AudibleSound, volume: targetVol, duration: 1500, ease: 'Sine.easeInOut' });
    }
  }

  // ── FIL-47: Positional animal ambient ─────────────────────────────────────────

  /**
   * Updates volume and stereo pan on each species-group ambient loop based on the
   * nearest animal of that species to the player. Throttled to every 100 ms.
   *
   * Species → sound key:
   *   bird / grouse       → 'animal-bird'
   *   deer / stag         → 'animal-deer'
   *   hare                → 'animal-hare'
   *   fox / boar / badger → 'animal-fox'
   *
   * Volume: 0 at MAX_DIST (500 px), MAX_VOL at FULL_DIST (80 px).
   * Pan: uses stereoPan() helper (camera-centre-relative, ±1 at screen edges).
   */
  private updateAnimalAmbience(): void {
    if (this.animalSounds.size === 0) return;
    const now = this.time.now;
    if (now - this.lastAnimalSoundTick < 100) return;
    this.lastAnimalSoundTick = now;

    type Audible = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;

    // Mute all species loops while animals are hidden in the nav panel
    if (!this.animalsVisible) {
      for (const s of this.animalSounds.values()) (s as Audible).setVolume(0);
      return;
    }

    const px = this.player.x;
    const py = this.player.y;
    const MAX_DIST = 500;
    const FULL_DIST = 80;
    const MAX_VOL = 0.35;

    const closest: Record<string, { dist: number; x: number }> = {
      'animal-bird': { dist: Infinity, x: 0 },
      'animal-deer': { dist: Infinity, x: 0 },
      'animal-hare': { dist: Infinity, x: 0 },
      'animal-fox':  { dist: Infinity, x: 0 },
    };

    const BIRD_TYPES = new Set(['grouse']);   // ground birds; flying birds handled below
    const DEER_TYPES = new Set(['deer', 'stag']);
    const HARE_TYPES = new Set(['hare']);
    const FOX_TYPES  = new Set(['fox', 'boar', 'badger']);

    for (const child of this.groundAnimals.getChildren()) {
      const a = child as Phaser.GameObjects.Sprite;
      const type = a.getData('animalType') as string;
      let key: string | undefined;
      if (BIRD_TYPES.has(type))       key = 'animal-bird';
      else if (DEER_TYPES.has(type))  key = 'animal-deer';
      else if (HARE_TYPES.has(type))  key = 'animal-hare';
      else if (FOX_TYPES.has(type))   key = 'animal-fox';
      if (!key) continue;
      const d = Phaser.Math.Distance.Between(px, py, a.x, a.y);
      if (d < closest[key].dist) { closest[key].dist = d; closest[key].x = a.x; }
    }

    // Flying birds (crows) contribute to the bird channel
    for (const b of this.birds) {
      const d = Phaser.Math.Distance.Between(px, py, b.body.x, b.body.y);
      if (d < closest['animal-bird'].dist) {
        closest['animal-bird'].dist = d;
        closest['animal-bird'].x   = b.body.x;
      }
    }

    for (const [key, info] of Object.entries(closest)) {
      const s = this.animalSounds.get(key);
      if (!s) continue;
      const frac = info.dist >= MAX_DIST
        ? 0
        : Phaser.Math.Clamp((MAX_DIST - info.dist) / (MAX_DIST - FULL_DIST), 0, 1);
      const vol = MAX_VOL * frac * this.ambienceVol;
      const pan = info.dist < MAX_DIST ? this.stereoPan(info.x) : 0;
      (s as Audible).setVolume(vol);
      // setPan is WebAudioSound-only; silently absent in HTML5 fallback
      if ('setPan' in s) (s as Phaser.Sound.WebAudioSound).setPan(pan);
    }
  }

  // ── FIL-113: Audio ducking ────────────────────────────────────────────────────

  /**
   * Duck music and ambience by 50% when an overlay opens (pause menu, NPC dialog, etc.).
   *
   * **Why accept a `tweens` parameter instead of using `this.tweens`?**
   * When Phaser pauses a scene it freezes that scene's tween manager — any tween
   * added to a paused scene's manager never ticks. The overlay scene (PauseMenuScene,
   * UpgradeScene, etc.) is still *running*, so its tween manager works fine. We ask
   * callers to pass their own `this.tweens` so the tween actually executes.
   *
   * **Why 50% and 300 ms?**
   * Half volume is clearly lower but still audible (reassures the player audio is live).
   * 300 ms is just long enough to feel intentional without making you wait.
   *
   * @param tweens - The overlay scene's (running) tween manager.
   */
  public duckAudio(tweens: Phaser.Tweens.TweenManager): void {
    if (!this.audioAvailable) return;
    // `BaseSound` doesn't expose `volume` in TypeScript types; both concrete
    // implementations (WebAudioSound, HTML5AudioSound) do, so the cast is safe.
    type AudibleSound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    if (this.musicTrack) {
      this.preDuckMusicVol = (this.musicTrack as AudibleSound).volume;
      tweens.add({ targets: this.musicTrack, volume: this.preDuckMusicVol * 0.5, duration: 300, ease: 'Sine.easeInOut' });
    }
    if (this.ambienceSound) {
      this.preDuckAmbienceVol = (this.ambienceSound as AudibleSound).volume;
      tweens.add({ targets: this.ambienceSound, volume: this.preDuckAmbienceVol * 0.5, duration: 300, ease: 'Sine.easeInOut' });
    }
    // Duck environmental layers too (ocean, wind, settlement). No need to save/restore their
    // pre-duck volumes — updateAmbienceZone()/updateSettlementAmbience() recalculate from
    // scratch on the next gameplay tick after the overlay closes.
    for (const s of [this.oceanAmbienceSound, this.windSound, this.settlementSound, this.ambienceNight]) {
      if (s) {
        const vol = (s as AudibleSound).volume;
        tweens.add({ targets: s as AudibleSound, volume: vol * 0.5, duration: 300, ease: 'Sine.easeInOut' });
      }
    }
  }

  /**
   * FIL-113: Called when the scene resumes (any overlay closed via scene.resume()).
   * Phaser activates the scene *before* emitting 'resume', so this.tweens is live again.
   */
  private onSceneResume(): void {
    if (!this.audioAvailable) return;
    if (this.musicTrack && this.preDuckMusicVol > 0) {
      this.tweens.add({ targets: this.musicTrack, volume: this.preDuckMusicVol, duration: 300, ease: 'Sine.easeInOut' });
    }
    if (this.ambienceSound && this.preDuckAmbienceVol > 0) {
      this.tweens.add({ targets: this.ambienceSound, volume: this.preDuckAmbienceVol, duration: 300, ease: 'Sine.easeInOut' });
    }
  }

  protected onZoneCleansed(type: string, x: number, y: number): void {
    log.info('zone_cleansed', { corruption_type: type, x: Math.round(x), y: Math.round(y) });
  }

  protected onFsmTransition(oldState: string, newState: string): void {
    log.debug('fsm_transition', { entity: this.constructor.name, from: oldState, to: newState });
  }

  protected onHeightBlocked(diff: number, toX: number, toY: number): void {
    log.debug('height_blocked', { diff, x: Math.round(toX), y: Math.round(toY) });
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
    if (this.gameMode === 'arena') {
      // Tinkerer hero (earth path, tier 2) — PixelLab-generated 48×48 px atlas.
      // Registers animations under the same pc-* keys so updatePlayerAnimation()
      // works unchanged. South = facing camera (down), north = away, east = right.
      // West-facing is handled by setFlipX(true) on the east animation in updatePlayerAnimation().
      const tkFrames = (anim: string, dir: string, n: number) =>
        Array.from({ length: n }, (_, i) => ({ key: 'tinkerer', frame: `${anim}_${dir}_${i}` }));
      this.anims.create({ key: 'pc-idle-down', frames: tkFrames('idle', 'south', 4), frameRate: 6, repeat: -1 });
      this.anims.create({ key: 'pc-idle-up',   frames: tkFrames('idle', 'north', 4), frameRate: 6, repeat: -1 });
      this.anims.create({ key: 'pc-idle-side', frames: tkFrames('idle', 'east',  4), frameRate: 6, repeat: -1 });
      this.anims.create({ key: 'pc-walk-down', frames: tkFrames('walk', 'south', 4), frameRate: 9, repeat: -1 });
      this.anims.create({ key: 'pc-walk-up',   frames: tkFrames('walk', 'north', 4), frameRate: 9, repeat: -1 });
      this.anims.create({ key: 'pc-walk-side', frames: tkFrames('walk', 'east',  4), frameRate: 9, repeat: -1 });
      this.playerSprite = this.add.sprite(0, 0, 'tinkerer', 'idle_south_0');
      this.playerSprite.setScale(1);
      this.playerSprite.play('pc-idle-down');

      // Instantiate the panda hero when a non-Tinkerer hero is selected.
      // The hero's position is synced to the player container each frame
      // (see updateArenaHero) so cast methods fire from the correct world position.
      // Entity constructor calls scene.add.existing() so no explicit add is needed.
      if (SELECTED_HERO === 'bao') {
        this.arenaHero = new Bao(this, SPAWN_X, SPAWN_Y);
        this.arenaHero.setAlpha(0); // invisible — the player Container is the visual
      } else if (SELECTED_HERO === 'masterfen') {
        this.arenaHero = new MasterFen(this, SPAWN_X, SPAWN_Y);
        this.arenaHero.setAlpha(0);
      } else if (SELECTED_HERO === 'torrent') {
        // TheTorrent: water-construct with fluid-form ability. Container children
        // (including the particle emitter) inherit the Container's depth, which is
        // Y-sorted each frame in updateArenaHero. No manual emitter depth needed.
        this.arenaHero = new TheTorrent(this, SPAWN_X, SPAWN_Y);
        this.arenaHero.setAlpha(0);
      } else if (SELECTED_HERO === 'stormsovereign') {
        // StormSovereign: rain aura + monsoon AoE. The rain emitter is a scene-level
        // object (not a Container child) so we set its depth explicitly after construction
        // to place it above the ground layer (Y-sort value) and below the HUD.
        this.arenaHero = new StormSovereign(this, SPAWN_X, SPAWN_Y);
        this.arenaHero.setAlpha(0);
        (this.arenaHero as StormSovereign).setEmitterDepth(SPAWN_Y);
      }
    } else {
      // WilderView: Pixel Crawler Free Pack Body_A character (64×64 px sheets)
      this.anims.create({ key: 'pc-idle-down', frames: this.anims.generateFrameNumbers('pc-idle-down', {}), frameRate: 6, repeat: -1 });
      this.anims.create({ key: 'pc-idle-up',   frames: this.anims.generateFrameNumbers('pc-idle-up',   {}), frameRate: 6, repeat: -1 });
      this.anims.create({ key: 'pc-idle-side', frames: this.anims.generateFrameNumbers('pc-idle-side', {}), frameRate: 6, repeat: -1 });
      this.anims.create({ key: 'pc-walk-down', frames: this.anims.generateFrameNumbers('pc-walk-down', {}), frameRate: 9, repeat: -1 });
      this.anims.create({ key: 'pc-walk-up',   frames: this.anims.generateFrameNumbers('pc-walk-up',   {}), frameRate: 9, repeat: -1 });
      this.anims.create({ key: 'pc-walk-side', frames: this.anims.generateFrameNumbers('pc-walk-side', {}), frameRate: 9, repeat: -1 });
      this.playerSprite = this.add.sprite(0, 0, 'pc-idle-down');
      this.playerSprite.setScale(1);
      this.playerSprite.play('pc-idle-down');
    }

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

    // On the /world dev route the player starts invisible and physics-disabled.
    // The P key toggles spawn/despawn at the camera centre for walkthrough testing.
    if (window.location.pathname.replace(/\/$/, '') === '/world') {
      this.player.setAlpha(0);
      this.playerShadow.setAlpha(0);
      body.setEnable(false);
    }

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
   * Invisible static physics bodies that block player movement, dividing the world
   * into navigable zones with guided SW→NE flow:
   *
   *   Zone 4 — Highland / Portal         (y < 830)
   *   ─── Highland Rim ───────────────── gap at x 2830–2930
   *   Zone 3 — Skogsgläntan area         (y 830–1240)
   *   ─── Forest Belt ────────────────── gaps at x 1930–2020 and x 2380–2470
   *   Zone 2 — Boreal mid-corridor       (y 1240–2060)
   *   ─── River A & River B ──────────── stair-step barriers following tracedRiverPaths
   *   Zone 1 — Coastal / Strandviken     (y 2060–3000) ← spawn here
   *
   * River barriers (FIL-169): instead of the old fixed horizontal rectangles, we
   * iterate each traced river path row by row and emit one TILE_SIZE-tall barrier
   * per row centred on that row's average tile x.  Bridge and ford rows are skipped
   * so the player can cross only at the designated gaps.
   */
  private createNavigationBarriers(): void {
    this.navigationBarriers = this.physics.add.staticGroup();

    // Thin helper — adds one invisible static collision rectangle to the group.
    const addBlock = (x: number, y: number, w: number, h: number): void => {
      const rect = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0);
      this.physics.add.existing(rect, true);
      this.navigationBarriers.add(rect);
    };

    // ── River A & River B — stair-step barriers following traced paths (FIL-169) ──
    //
    // For each traced river we iterate its raw tile steps, grouping them by row (ty).
    // For each row we compute the average tile-centre x of that river in that row,
    // then emit a barrier block spanning (xCenter ± halfWidth) × TILE_SIZE tall.
    //
    // Rows that fall within the bridge or ford crossing gap are skipped so the
    // player can only cross at the designated points.  The gap radius is derived
    // from the crossing width defined in DiagonalRiver (same units as halfWidth).
    //
    // Why row-by-row rather than one big rectangle?
    //   Diagonal rivers cut across tile rows at an angle — a single horizontal
    //   rect would either block the crossings or leave gaps at the river edges.
    //   Per-row blocks follow the river's actual diagonal shape precisely.
    for (const traced of this.tracedRiverPaths) {
      const { river, rawPath, points } = traced;
      const { halfWidth } = river;

      // Resolve the world-pixel crossing centres from the smoothed path.
      // points[] is in world pixels; bridge/ford pathIndex indexes into it.
      const bridgePt = river.bridge.pathIndex < points.length
        ? points[river.bridge.pathIndex]
        : undefined;
      const fordPt = river.ford.pathIndex < points.length
        ? points[river.ford.pathIndex]
        : undefined;

      // Convert crossing y to tile row so we can compare against ty.
      const bridgeTy = bridgePt !== undefined ? Math.floor(bridgePt.y / TILE_SIZE) : -9999;
      const fordTy   = fordPt   !== undefined ? Math.floor(fordPt.y   / TILE_SIZE) : -9999;

      // Half-radius in tile rows to clear on each side of the crossing.
      // +1 gives a small extra margin so no pixel of barrier overlaps the gap.
      const bridgeGapR = Math.ceil(river.bridge.width / 2 / TILE_SIZE) + 1;
      const fordGapR   = Math.ceil(river.ford.width   / 2 / TILE_SIZE) + 1;

      // Accumulate average tx per row from raw gradient-descent steps.
      // rawPath can have multiple steps per ty when the river zig-zags, so we
      // average them to get a representative centre x for the barrier block.
      const rowTxSums = new Map<number, { sum: number; count: number }>();
      for (const step of rawPath) {
        const entry = rowTxSums.get(step.ty);
        if (entry) {
          entry.sum   += step.tx;
          entry.count += 1;
        } else {
          rowTxSums.set(step.ty, { sum: step.tx, count: 1 });
        }
      }

      for (const [ty, { sum, count }] of rowTxSums) {
        // Skip this row if it falls inside a crossing gap.
        if (Math.abs(ty - bridgeTy) <= bridgeGapR) continue;
        if (Math.abs(ty - fordTy)   <= fordGapR)   continue;

        // Centre of the river in world pixels at this row.
        const xCenter = (sum / count) * TILE_SIZE + TILE_SIZE / 2;
        addBlock(xCenter - halfWidth, ty * TILE_SIZE, halfWidth * 2, TILE_SIZE);
      }
    }

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

    // River A tileSprite visual removed — terrain now generates actual water tiles
    // via the RIVER_BANDS override in drawProceduralTerrain() (FIL-100).

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
          this.decorImages.push(
            this.add.image(tx + ox, ty + oy, key).setScale(0.5).setDepth(ty + oy),
          );
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
          this.decorImages.push(
            this.add.image(tx + ox, ty + oy, 'rock-grass')
              .setScale(0.5 + rng() * 0.5)
              .setDepth(ty + oy),
          );
        }
      }
    }
  }

  /**
   * Bridge planks and wading-ford rocks for every traced river (FIL-170).
   *
   * ## Why two crossing types?
   * A bridge gives the player a direct, fast crossing aligned with the road path.
   * A wading ford offers an alternative that slows the player (PathType 'wading')
   * — both teach the player that rivers are obstacles with discrete crossing points.
   *
   * ## Position source (FIL-170)
   * Crossing positions now come from `this.tracedRiverPaths` (computed by
   * `initRiverTileGrids()`), not from the deprecated `RIVER_BANDS` constants.
   * `traced.points[traced.river.bridge.pathIndex]` gives the bridge world-pixel
   * centre; `traced.points[traced.river.ford.pathIndex]` gives the ford centre.
   *
   * ## Depths
   * Bridge rectangle: depth 1.9 — above water animation sprites (0.5) and path
   * overlay (1), but below any Y-sorted decoration (depth = world y > 800).
   * Rocks-in-water: depth 1.8 — just below the bridge so they don't overlap planks.
   */
  private createRiverCrossingVisuals(): void {
    const rng = mulberry32(0x71766572); // 'rivr' in ASCII — deterministic placement

    for (const traced of this.tracedRiverPaths) {
      const { river, points } = traced;
      // River height for crossing visuals: full band height = halfWidth × 2.
      const bandH = river.halfWidth * 2;

      // ── Bridge ────────────────────────────────────────────────────────────────
      // Centre is the smoothed-path point closest to the SW→NE corridor.
      const bridgePt = points[river.bridge.pathIndex];
      if (bridgePt) {
        const bx = bridgePt.x;
        const by = bridgePt.y;
        const bw = river.bridge.width;

        // Dark wood-plank rectangle spanning the full river band height.
        this.add.rectangle(bx, by, bw, bandH, 0x5c4033).setDepth(1.9);
        // Plank-line overlays — lighter centre strip + dark top/bottom edges.
        this.add.rectangle(bx, by,             bw, 4, 0x8b6040).setDepth(1.91);
        this.add.rectangle(bx, by - bandH / 2 + 4, bw, 4, 0x3a2010).setDepth(1.91);
        this.add.rectangle(bx, by + bandH / 2 - 4, bw, 4, 0x3a2010).setDepth(1.91);
      }

      // ── Wading ford ───────────────────────────────────────────────────────────
      // Centre is ~10 raw gradient-descent steps upstream of the bridge — a
      // shallower crossing that slows the player (PathType 'wading', ×0.55 speed).
      // The 'rocks-in-water' spritesheet has 6 frames (0–5), scaled ×2 for 32px.
      const fordPt = points[river.ford.pathIndex];
      if (fordPt) {
        const fw = river.ford.width;
        for (let i = 0; i < 5; i++) {
          const rx    = fordPt.x - fw / 2 + rng() * fw;
          const ry    = fordPt.y - river.halfWidth * 0.8 + rng() * river.halfWidth * 1.6;
          const frame = Math.floor(rng() * 6);
          this.decorImages.push(
            this.add.image(rx, ry, 'rocks-in-water', frame).setScale(2).setDepth(1.8),
          );
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

  private updateAttractMode(time: number, _delta: number): void {
    // Update thought bubble every frame with the current animal's live state.
    this.updateThoughtBubble();

    if (this.freeCamMode) {
      // Free-fly active — WASD pan is handled by top-level update(); skip animal cycling.
      return;
    }

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

  // ─── Idle attract helpers (FIL-98) ───────────────────────────────────────────

  /** Zoom camera in on the nearest wildlife and follow it while player is idle. */
  private enterIdleAttract(): void {
    if (this.attractTargets.length === 0) return;

    // Find the animal closest to the player's current position.
    const px = this.player.x;
    const py = this.player.y;
    let nearest: Phaser.GameObjects.GameObject | null = null;
    let minDist = Infinity;
    for (const t of this.attractTargets) {
      const go = t as Phaser.GameObjects.Container;
      const d = Phaser.Math.Distance.Between(px, py, go.x, go.y);
      if (d < minDist) { minDist = d; nearest = t; }
    }
    if (!nearest) return;

    this.idleAttractTarget = nearest;
    this.preIdleZoom = this.cameras.main.zoom;
    // Follow the animal with a lazier lerp so the transition feels dreamy.
    this.cameras.main.startFollow(nearest as Phaser.GameObjects.Container, true, 0.06, 0.06);
    this.tweens.add({
      targets: this.cameras.main,
      zoom: this.IDLE_ZOOM,
      duration: 1000,
      ease: 'Sine.easeInOut',
    });
  }

  /** Restore camera follow + zoom when the player starts moving again. */
  private exitIdleAttract(): void {
    this.idleAttractTarget = null;
    this.idleMs = 0;
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.tweens.add({
      targets: this.cameras.main,
      zoom: this.preIdleZoom,
      duration: 600,
      ease: 'Sine.easeInOut',
    });
  }

  private exitAttractMode(): void {
    if (!this.attractMode) return;
    this.attractMode = false;
    // Clear any idle-attract state that may have leaked in edge cases.
    if (this.idleAttractTarget) this.exitIdleAttract();
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
      ['grouse-fly-anim',  'grouse-fly',  [0, 2, 4, 6, 8, 10], 10],
      // Grouse ground animations — same even-frame convention as deer/hare/fox.
      ['grouse-idle-anim', 'grouse-idle', [0, 2, 4, 6],          7],
      ['grouse-walk-anim', 'grouse-walk', [0, 2, 4, 6, 8, 10],   9],
      // ── Critters pack ────────────────────────────────────────────────────────
      // Sequential frames (no skip columns unlike craftpix). Frame counts:
      //   stag idle 24f / walk 11f; boar idle 7f / run 4f; badger idle 22f / walk 9f
      ['stag-idle-anim',   'stag-idle',   [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23], 12],
      ['stag-walk-anim',   'stag-walk',   [0,1,2,3,4,5,6,7,8,9,10], 10],
      ['boar-idle-anim',   'boar-idle',   [0,1,2,3,4,5,6],            8],
      ['boar-walk-anim',   'boar-walk',   [0,1,2,3],                  10],
      ['badger-idle-anim', 'badger-idle', [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21], 12],
      ['badger-walk-anim', 'badger-walk', [0,1,2,3,4,5,6,7,8],        10],
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
      // FIL-223: raised cluster minimums so there's a higher chance of at least
      // one cluster landing near the SW-corner spawn point (~300, 2650).
      // Aim: 3–5 animals visible within the 800×600 viewport at game start.
      deer:   { clusters: [6, 9],  perCluster: [5, 8], clusterR: 60,  clusterMinDist: 600 },
      hare:   { clusters: [10, 15], perCluster: [4, 6], clusterR: 30,  clusterMinDist: 300 },
      fox:    { clusters: [1, 1],  perCluster: [1, 1], clusterR: 300, clusterMinDist: 300 },
      // fox: one "cluster" of 1 — effectively solo placement with Poisson spacing
      // Grouse: small coveys of 2–4 birds, multiple coveys per forest zone
      grouse: { clusters: [6, 9],  perCluster: [3, 5], clusterR: 40,  clusterMinDist: 400 },
      // Critters pack
      stag:   { clusters: [3, 6],  perCluster: [2, 5], clusterR: 70,  clusterMinDist: 700 },
      boar:   { clusters: [4, 7],  perCluster: [3, 5], clusterR: 50,  clusterMinDist: 500 },
      badger: { clusters: [5, 9],  perCluster: [2, 4], clusterR: 40,  clusterMinDist: 350 },
    };

    for (const [type, def] of Object.entries(ANIMAL_DEFS)) {
      const biasType = type as 'deer' | 'hare' | 'fox' | 'grouse' | 'stag' | 'boar' | 'badger';
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

    // Cache once — getChildren() returns the same backing array each call, but
    // calling it three times is wasteful and allocates the filter results twice.
    const allAnimals  = this.groundAnimals.getChildren() as Phaser.GameObjects.Sprite[];
    const foxSprites  = allAnimals.filter(a => !a.getData('playerControlled') && a.getData('animalType') === 'fox');
    const hareSprites = allAnimals.filter(a => !a.getData('playerControlled') && a.getData('animalType') === 'hare');

    for (const child of allAnimals) {
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
        // Play vocalization only on the frame the animal starts fleeing, not every frame.
        // FIL-109: each species has a distinct pitch via Phaser's `rate` parameter so
        // a deer's snort sounds different from a hare's squeak without new audio files.
        if (prevState !== 'fleeing') {
          // Record the timestamp when flee begins so the acceleration ramp knows
          // how much time has elapsed since the startle (FIL-226).
          r.setData('fleeStartTime', this.time.now);
          // FIL-50: fleeVocal is co-located in AnimalDef — no separate lookup needed.
          if (this.audioAvailable && this.cache.audio.has(def.fleeVocal.key)) {
            // FIL-116: pan the flee sound to the animal's screen position.
            this.sound.play(def.fleeVocal.key, { volume: def.fleeVocal.volume * this.sfxVol, rate: def.fleeVocal.rate, pan: this.stereoPan(r.x) });
          }
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
      //
      // chaseTarget and fleeFromX/Y are only needed within this loop iteration, so
      // use local variables instead of setData/getData (DataManager hashmap lookups).
      let chaseTarget: Phaser.GameObjects.Sprite | null = null;
      let fleeFromX = px; // default flee origin is the player
      let fleeFromY = py;

      if (type === 'fox' && state !== 'fleeing') {
        let nearestHare: Phaser.GameObjects.Sprite | null = null;
        let nearestDist = FOX_CHASE_RANGE;
        for (const hare of hareSprites) {
          const d = Phaser.Math.Distance.Between(r.x, r.y, hare.x, hare.y);
          if (d < nearestDist) { nearestDist = d; nearestHare = hare; }
        }
        if (nearestHare) {
          chaseTarget = nearestHare;
          if (state !== 'chasing') {
            state = 'chasing';
            r.setData('animalState', state);
            r.play('fox-walk-anim');
          }
        } else if (state === 'chasing') {
          state = 'roaming';
          r.setData('animalState', state);
          r.setData('roamNext', this.time.now + Phaser.Math.Between(2000, 5000));
          r.play('fox-idle-anim');
        }
      }

      // Hares flee from nearby foxes using the same mechanism as player-flee.
      if (type === 'hare') {
        let nearestFox: Phaser.GameObjects.Sprite | null = null;
        let nearestFoxDist = def.fleeRange;
        for (const fox of foxSprites) {
          const d = Phaser.Math.Distance.Between(r.x, r.y, fox.x, fox.y);
          if (d < nearestFoxDist) { nearestFoxDist = d; nearestFox = fox; }
        }
        if (nearestFox) {
          fleeFromX = nearestFox.x;
          fleeFromY = nearestFox.y;
          if (state !== 'fleeing') {
            state = 'fleeing';
            r.setData('animalState', state);
            // Record flee start so the ramp can compute elapsed time (FIL-226).
            r.setData('fleeStartTime', this.time.now);
            r.play('hare-walk-anim');
          }
        }
        // else fleeFromX/Y stays as player position (already set above)
      }

      if (state === 'fleeing') {
        // fleeFromX/Y is either the nearest fox (hare) or the player (everyone else).
        const away = Phaser.Math.Angle.Between(fleeFromX, fleeFromY, r.x, r.y);
        // FIL-226: 100ms acceleration ramp so the direction change reads as a
        // startle response rather than an instant velocity snap. Speed lerps from
        // 0 → fleeSpeed over the first 100ms of the flee state.
        const FLEE_RAMP_MS = 100;
        const fleeStart = (r.getData('fleeStartTime') as number | null) ?? this.time.now;
        const ramp = Math.min((this.time.now - fleeStart) / FLEE_RAMP_MS, 1);
        this.physics.velocityFromRotation(away, ramp * def.fleeSpeed, b.velocity);
      } else if (state === 'chasing') {
        if (chaseTarget?.active) {
          const toward = Phaser.Math.Angle.Between(r.x, r.y, chaseTarget.x, chaseTarget.y);
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

      // Critters pack sprites face SE; flip horizontally when moving left so they
      // face SW instead — a simple directional cue without needing all 4 direction strips.
      if (type === 'stag' || type === 'boar' || type === 'badger') {
        if (Math.abs(b.velocity.x) > 5) r.setFlipX(b.velocity.x < 0);
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
  /**
   * FIL-154/172: tint matches terrainTileFrame() biome logic exactly.
   * Each new FIL-172 biome has a distinct hue so the colour wash is consistent
   * with the tile choice — sandy shore gets a warmer yellow, marsh gets muddy
   * green, snow gets ice-blue, etc.
   */
  private biomeTint(elev: number, temp: number, moist: number): number {
    if (elev < 0.25) return 0x55ccff;  // sea — bright sky blue
    if (elev < 0.30) {
      return (temp < 0.45 || moist > 0.50)
        ? 0xeecc66   // rocky shore — warm golden sand
        : 0xffdd66;  // sandy shore — bright sunny yellow
    }
    if (elev < 0.45 && moist > 0.72) return 0x55cc44; // marsh — bright fresh green
    if (elev < 0.62) {
      if (moist > 0.60) return 0x44ee55; // forest  — vibrant green
      if (moist > 0.30) return 0xaaee55; // heath   — lime yellow-green
      return                  0xddcc44;  // dry heath — golden
    }
    if (elev < 0.78) {
      return temp > 0.50 ? 0x33bb44 : 0xaac8dd; // spruce green / pale blue-grey granite
    }
    return temp < 0.40 ? 0xd0e4f8 : 0xb0b0b8; // snow / bare rocky summit
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
        // Domain-warped base noise (FIL-153) so colour wash regions match tile biomes exactly.
        // FIL-154: sample temp + moist so tint matches the biome tile exactly.
        const base   = noise.warped(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
        const temp   = this.tempNoise.fbm(tx * TEMP_SCALE,  ty * TEMP_SCALE,  3, 0.5);
        const moist  = this.moistNoise.fbm(tx * MOIST_SCALE, ty * MOIST_SCALE, 3, 0.5);
        const perpDiag     = (tx / tilesX - (1 - ty / tilesY)) / 2;
        const mountainBias = Math.pow(Math.max(0, -perpDiag - 0.10), 1.5) * 4.0;
        const oceanBias    = Math.pow(Math.max(0, perpDiag  - 0.05), 1.5) * 4.5;
        const val = Math.max(0, Math.min(1.2, base + mountainBias - oceanBias));

        // Skip water and river tiles — they have identity from animated sprites.
        // FIL-168: use precomputed isRiverTile grid (diagonal paths) instead of
        // the old horizontal RIVER_BANDS band check.
        if (val < 0.25) continue;
        if (this.isRiverTile?.[ty * tilesX + tx]) continue;

        // FIL-172: apply the same river-bank moisture boost as the terrain bake
        // so the colour wash tint matches the tile that was drawn.
        let effectiveMoist = moist;
        if (this.isRiverTile) {
          const bankR = 2;
          outer: for (let dy = -bankR; dy <= bankR; dy++) {
            for (let dx = -bankR; dx <= bankR; dx++) {
              if (dy === 0 && dx === 0) continue;
              const nx = tx + dx;
              const ny = ty + dy;
              if (nx >= 0 && nx < tilesX && ny >= 0 && ny < tilesY &&
                  this.isRiverTile[ny * tilesX + nx] === 1) {
                effectiveMoist = Math.min(1, moist + 0.30);
                break outer;
              }
            }
          }
        }

        const tint = this.biomeTint(val, temp, effectiveMoist);
        let arr = groups.get(tint);
        if (!arr) { arr = []; groups.set(tint, arr); }
        arr.push(tx * TILE_SIZE, ty * TILE_SIZE);
      }
    }

    // Second pass: one fillStyle() per biome colour, then fillRect for every tile of that colour.
    // This keeps GPU state changes to ~5 (one per biome type) regardless of world size.
    const gfx = this.add.graphics().setDepth(0.1);
    for (const [tint, coords] of groups) {
      gfx.fillStyle(tint, 0.12);
      for (let i = 0; i < coords.length; i += 2) {
        gfx.fillRect(coords[i], coords[i + 1], TILE_SIZE, TILE_SIZE);
      }
    }
  }

  /**
   * FIL-177: Draw feathered colour strips at biome boundaries.
   *
   * At each tile edge where two biomes of different priority meet, a narrow
   * 8-pixel strip is drawn on the lower-priority tile using the higher-priority
   * biome's colour.  This softens the hard tile boundary that would otherwise
   * appear as a perfectly straight colour edge — the same feathering technique
   * used by many top-down 16-bit RPGs.
   *
   * ## Depth
   * Strips sit at depth 0.46 — above the biome colour wash (0.1) and cliff east
   * shadows (0.452) but below paths (1) and decorations (2+).
   *
   * ## Priority
   * Priority is defined in BiomeBlend.BIOME_PRIORITY (sea = 0, snow = 10).
   * Higher-priority biomes bleed into lower-priority ones; equal-priority biomes
   * are treated as peers and emit no strip.
   *
   * @param biomeIdxGrid  Flat row-major biome indices (0–10), one per tile.
   * @param tilesX        World width in tiles.
   * @param tilesY        World height in tiles.
   */
  private drawBiomeBlendStrips(
    biomeIdxGrid: Uint8Array,
    tilesX: number,
    tilesY: number,
  ): void {
    const T       = TILE_SIZE; // 32 px
    const STRIP_W = 8;         // feather width in pixels — ~25% of a tile
    const ALPHA   = 0.40;      // opacity of the blend strip

    const boundaries = detectBoundaries(biomeIdxGrid, tilesX, tilesY);
    if (boundaries.length === 0) return;

    // One shared Graphics object for all strips — cheaper than per-tile objects.
    const gfx = this.add.graphics().setDepth(0.46);

    for (const { tx, ty, side, higherBiome } of boundaries) {
      const color = BLEND_COLORS[higherBiome];
      gfx.fillStyle(color, ALPHA);

      // Place the strip rectangle on the correct edge of the lower-priority tile.
      // T = tile size in pixels; tx/ty are grid coordinates.
      switch (side) {
        case 'north':
          // Neighbour is above — strip at the top of this tile
          gfx.fillRect(tx * T,           ty * T,           T,       STRIP_W);
          break;
        case 'south':
          // Neighbour is below — strip at the bottom of this tile
          gfx.fillRect(tx * T,           (ty + 1) * T - STRIP_W, T, STRIP_W);
          break;
        case 'west':
          // Neighbour is to the left — strip at the left edge
          gfx.fillRect(tx * T,           ty * T,           STRIP_W, T);
          break;
        case 'east':
          // Neighbour is to the right — strip at the right edge
          gfx.fillRect((tx + 1) * T - STRIP_W, ty * T,    STRIP_W, T);
          break;
      }
    }
  }

  /**
   * FIL-178: Cliff & Elevation Transition System.
   *
   * Renders layered cliff-face illusions at all south-facing and east-facing
   * elevation drops across the procedurally generated terrain.
   *
   * ## Detection
   * Calls detectCliffs() (CliffSystem.ts) to run a full cliff-detection pass
   * over the biomeGrid.  The continuous elevation float is first quantized into
   * 5 discrete levels (sea → coast → lowland → highland → mountain); a cliff
   * face is emitted wherever the level drops between a tile and its south or
   * east neighbour.
   *
   * ## Multi-step cliffs
   * If the elevation drops by more than one level (e.g. highland straight to
   * coast), CLIFF_STEP_PX-pixel wall segments are stacked vertically — one strip
   * per elevation step.  Each strip has the same three-layer treatment (lip,
   * face, shadow) but is offset downward by one step's worth of pixels.
   *
   * ## Biome-aware appearance
   * The UPPER tile's biome index determines colour (CLIFF_COLORS), so the cliff
   * face visually represents the cross-section of the upper surface material
   * (dark forest soil, granite, ice-blue snow, etc.) rather than the lower one.
   *
   * ## Depth sorting
   * South-facing cliff Graphics are created one-per-row with depth equal to
   * (ty + 1) * TILE_SIZE — matching the raw-Y depth convention used by trees
   * and entities.  Highland entities (Y < ty * T) appear behind the cliff;
   * lowland entities (Y > (ty+1) * T) appear in front.
   *
   * East-facing cliff shadow strips use a single shared Graphics at depth 0.452
   * (above the biome wash but below paths), since they are narrow side accents
   * and not primary depth-sorting participants.
   *
   * ## Corruption overlay
   * A separate Graphics object (cliffCorruptGfx) is created over all south cliff
   * positions.  Its alpha is updated by updateCliffCorruption() whenever the
   * cleanse-updated event fires, tinting cliffs dark purple in corrupted zones.
   *
   * @param biomeGrid     Flat row-major elevation values [0,1.2], one per tile.
   * @param biomeIdxGrid  Flat row-major biome indices (0–10), one per tile.
   * @param tilesX        World width in tiles.
   * @param tilesY        World height in tiles.
   */
  private drawCliffEdges(
    biomeGrid: Float32Array,
    biomeIdxGrid: Uint8Array,
    tilesX: number,
    tilesY: number,
  ): void {
    const T = TILE_SIZE; // 32 px

    // Run the full cliff-detection pass — produces one CliffFace descriptor per
    // cliff tile, covering all elevation levels (not just the old HIGHLAND = 0.78
    // threshold) and all biomes.
    const faces = detectCliffs(biomeGrid, biomeIdxGrid, tilesX, tilesY);

    // ── East-facing cliffs ────────────────────────────────────────────────────
    // Narrow vertical shadow strips on the right edge of east-facing drops.
    // All share one Graphics at a low depth — they are accent shadows, not primary
    // depth-sorting objects.  Alpha 0.7 for the dark face, 0.2/0.09 for feather.
    const gfxEast = this.add.graphics().setDepth(0.452);
    for (const face of faces) {
      if (face.isSouth) continue;

      const px = (face.tx + 1) * T; // left edge of the eastern (lower) tile
      const py = face.ty * T;

      // Per-biome colour lookup — upper biome owns the cliff face.
      const [darkBase] = CLIFF_COLORS[face.biomeIdx] ?? CLIFF_COLORS[8];
      gfxEast.fillStyle(darkBase, 0.75);
      // Width scales with number of elevation steps — deeper drops are wider.
      const shadowW = Math.min(6 + (face.steps - 1) * 2, 10);
      gfxEast.fillRect(px, py, shadowW, T);
      // Feather into lower tile
      gfxEast.fillStyle(0x000000, 0.22);
      gfxEast.fillRect(px + shadowW,     py, 3, T);
      gfxEast.fillStyle(0x000000, 0.09);
      gfxEast.fillRect(px + shadowW + 3, py, 2, T);
    }

    // ── South-facing cliffs ───────────────────────────────────────────────────
    // Group cliff faces by row (ty) so each row can own its own Graphics object
    // at the correct Y-sorted depth.  Only south-facing cliffs participate in
    // depth sorting; their depth = (ty + 1) * TILE_SIZE matches tree/entity convention.

    // Collect distinct ty values that have south-facing cliffs.
    const southByRow = new Map<number, CliffFace[]>();
    for (const face of faces) {
      if (!face.isSouth) continue;
      let arr = southByRow.get(face.ty);
      if (!arr) { arr = []; southByRow.set(face.ty, arr); }
      arr.push(face);
    }

    for (const [ty, rowFaces] of southByRow) {
      const depth = (ty + 1) * T; // Y-sort: cliff face sits at the top of the lower tile

      // Three Graphics layers per row — depth offsets keep lip, face, and shadow
      // in the correct painter order within the same depth band.
      // The 0.001 fractions are imperceptible but keep the ordering deterministic.
      const gfxLip    = this.add.graphics().setDepth(depth - 0.002); // bright ledge top
      const gfxFace   = this.add.graphics().setDepth(depth - 0.001); // dark cliff face
      const gfxShadow = this.add.graphics().setDepth(depth);          // drop shadow

      for (const face of rowFaces) {
        const px = face.tx * T;
        const py = (ty + 1) * T; // world Y at the top of the lower tile

        const [darkBase, midHighlight] = CLIFF_COLORS[face.biomeIdx] ?? CLIFF_COLORS[8];

        // ── Bright lip — 2-px highlight at the very bottom of the upper tile ──
        // Simulates sunlight catching the ledge top.  Warm tone for earth, cool
        // for granite/snow — derived by brightening the mid-highlight colour.
        gfxLip.fillStyle(midHighlight, 0.60);
        gfxLip.fillRect(px, py - CLIFF_LIP_PX, T, CLIFF_LIP_PX);

        // ── Cliff face — one strip per elevation step ─────────────────────────
        // Multi-step cliffs stack wall segments vertically.  Each segment is
        // CLIFF_STEP_PX tall with a mid-highlight band through its centre.
        for (let step = 0; step < face.steps; step++) {
          const faceY = py + step * CLIFF_STEP_PX;

          gfxFace.fillStyle(darkBase, 0.92);
          gfxFace.fillRect(px, faceY, T, CLIFF_STEP_PX);

          // Mid-highlight band — brightens the centre of each step to give the
          // illusion of a slightly convex rock face catching diffuse light.
          gfxFace.fillStyle(midHighlight, 0.35);
          gfxFace.fillRect(px, faceY + 4, T, Math.max(1, CLIFF_STEP_PX - 8));
        }

        // ── Concave inner corner fill ─────────────────────────────────────────
        // When both a south drop AND an east drop originate at this tile the two
        // cliff faces meet at a 90° notch.  Fill the corner block at (tx+1, ty+1)
        // to prevent a visible gap at the inner corner intersection.
        if (face.isInnerCorner) {
          const cornerX = (face.tx + 1) * T;
          const faceH   = face.steps * CLIFF_STEP_PX;
          gfxFace.fillStyle(darkBase, 0.92);
          gfxFace.fillRect(cornerX, py, T, faceH);
        }

        // ── Drop shadow — feathered bands below the cliff face ────────────────
        // Three thin bands of decreasing opacity feather the cliff into the
        // lower terrain, grounding it visually without a hard bottom edge.
        const totalFaceH = face.steps * CLIFF_STEP_PX;
        let shadowY = py + totalFaceH;
        for (const [bandH, bandAlpha] of CLIFF_SHADOW_BANDS) {
          gfxShadow.fillStyle(0x000000, bandAlpha);
          gfxShadow.fillRect(px, shadowY, T, bandH);
          shadowY += bandH;
        }
      }
    }

    // ── Corruption overlay ────────────────────────────────────────────────────
    // A single Graphics object drawn above all south cliff faces.  Filled with
    // the corruption colour at each south cliff position; alpha is set to 0 at
    // startup and updated by updateCliffCorruption() when cleanse state changes.
    // Depth: just above the highest possible cliff row Graphics
    // (any Y value > world height is fine since this layer only shows when
    // corruption is active and the PostFX shader handles the camera-wide effect).
    const corruptGfx = this.add.graphics().setDepth(WORLD_H + 1);
    corruptGfx.setAlpha(0); // invisible until corruption rises
    for (const face of faces) {
      if (!face.isSouth) continue;
      const px = face.tx * T;
      const py = (face.ty + 1) * T;
      const faceH = face.steps * CLIFF_STEP_PX;
      corruptGfx.fillStyle(CLIFF_CORRUPT_COLOR, 1);
      corruptGfx.fillRect(px, py - CLIFF_LIP_PX, T, faceH + CLIFF_LIP_PX);
    }
    this.cliffCorruptGfx = corruptGfx;
  }

  /**
   * FIL-178: Update the cliff corruption overlay opacity to match the current
   * world corruption level.
   *
   * Called from the cleanse-updated event listener whenever the player's cleanse
   * percentage changes (kill rabbits, activate shrines, etc.).  The overlay
   * samples a spatial noise field so corruption appears in organic patches rather
   * than uniformly across all cliffs — but for this GPU-friendly implementation
   * the global alpha uniformly modulates the pre-drawn patch coverage.
   *
   * @param cleansePercent  0–100: 0 = fully corrupted, 100 = fully cleansed.
   */
  private updateCliffCorruption(cleansePercent: number): void {
    if (!this.cliffCorruptGfx) return;
    // Convert cleanse percentage to a corruption intensity [0, 1].
    // The overlay starts appearing at 70 % corruption (30 % cleansed) and
    // reaches full strength at 100 % corruption (0 % cleansed).
    const globalCorruption = Math.max(0, 100 - cleansePercent) / 100;
    const overlayAlpha = Math.max(0, (globalCorruption - 0.30) / 0.70) * 0.55;
    this.cliffCorruptGfx.setAlpha(overlayAlpha);
  }

  // ─── FIL-167: diagonal river tile grids ────────────────────────────────────

  /**
   * Compute the terrain elevation for every tile WITHOUT the horizontal
   * RIVER_BANDS override.  This "clean" grid is needed by traceRiverPath() so
   * gradient descent sees the real mountain→ocean slope rather than the
   * artificially low values (≈ 0.15) that the FIL-100 RIVER_BANDS bake injects.
   *
   * The formula is identical to the inner loop of drawProceduralTerrain() except
   * for the three lines that force river-band tiles to water values.
   *
   * FIL-168 removes the RIVER_BANDS override from drawProceduralTerrain entirely;
   * until then both passes run (one for gradient-descent input, one for rendering).
   */
  private computeNaturalElevGrid(tilesX: number, tilesY: number): Float32Array {
    const noise    = this.baseNoise;
    // Same detail-noise seed as drawProceduralTerrain — keeps elevation consistent.
    const detNoise = new FbmNoise(this.runSeed ^ 0xb5ad4ecb);
    const grid     = new Float32Array(tilesX * tilesY);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const base   = noise.warped(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
        const detail = detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE, 2, 0.6);
        // Diagonal bias: NW corner is mountains (high), SE corner is ocean (low).
        const perpDiag     = (tx / tilesX - (1 - ty / tilesY)) / 2;
        const mountainBias = Math.pow(Math.max(0, -perpDiag - 0.10), 1.5) * 4.0;
        const oceanBias    = Math.pow(Math.max(0, perpDiag  - 0.05), 1.5) * 4.5;
        grid[ty * tilesX + tx] = Math.max(
          0, Math.min(1.2, base * 0.70 + detail * 0.30 + mountainBias - oceanBias),
        );
      }
    }
    return grid;
  }

  /**
   * Trace all diagonal rivers and build the isRiverTile / isWaterfallTile lookup
   * grids.  Called once during create(), before drawProceduralTerrain() so the
   * grids are ready for FIL-168 to use during the terrain bake.
   *
   * ## Why before drawProceduralTerrain?
   * FIL-168 will replace the RIVER_BANDS horizontal-band override in the terrain
   * bake with `isRiverTile[ty * tilesX + tx]`.  That lookup must exist before the
   * bake runs.  We therefore compute a separate "natural" elevation grid here
   * (without the RIVER_BANDS override) so gradient descent can follow the true
   * mountain→ocean slope.
   */
  private initRiverTileGrids(): void {
    const tilesX = Math.ceil(WORLD_W / TILE_SIZE);
    const tilesY = Math.ceil(WORLD_H / TILE_SIZE);

    // Step 1: compute clean elevation (no RIVER_BANDS override).
    const naturalElev = this.computeNaturalElevGrid(tilesX, tilesY);

    // Step 2: trace each river over the clean elevation grid.
    // traceRiverPath() runs gradient descent + Catmull-Rom smoothing + crossing
    // discovery, returning a TracedRiverPath with bridge/ford pathIndices filled in.
    this.tracedRiverPaths = DIAGONAL_RIVERS.map(river =>
      traceRiverPath(river, naturalElev, tilesX, tilesY),
    );

    // Step 3: build the flat Uint8Array lookup grids from the traced paths.
    // buildRiverTileGrids() marks every tile within river.halfWidth of the smoothed
    // path, then clears crossing-gap tiles at bridge and ford centres.
    // isWaterfallTile is returned by buildRiverTileGrids but not yet consumed —
    // FIL-171 (waterfall visuals + barriers) will store and use it.
    const { isRiverTile } = buildRiverTileGrids(
      this.tracedRiverPaths, tilesX, tilesY,
    );
    this.isRiverTile = isRiverTile;

    // FIL-260: classify inland pockets as lakes using the same natural-elevation
    // grid.  River tiles that happen to sit in low-lying coastal depressions would
    // be mis-classified as lakes if we used the baked grid (forced to 0.15 for
    // rivers) — naturalElev avoids that.  After BFS, zero out any lake tile that
    // overlaps a river to prevent visual collision at river mouths.
    const isLakeTile = buildLakeTileGrid(naturalElev, tilesX, tilesY);
    for (let i = 0; i < isLakeTile.length; i++) {
      if (isRiverTile[i] === 1) isLakeTile[i] = 0;
    }
    this.isLakeTile = isLakeTile;
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

    // FIL-258: Two separate water animations with different frame rates so rivers
    // look fast-moving and ocean rolls slowly. Both use the same 4-frame spritesheet
    // (water_animated.png: 0=calm, 1=gentle, 2=mid-ripple, 3=full ripple).
    // Rivers use frames 1–3 (skips the calm frame for a livelier look) at 8 fps.
    // Ocean uses all four frames at 2 fps for a slow, rolling feel.
    // Created here so they are ready when sprite.play() is called after the bake loop.
    this.anims.create({
      key: 'river-anim',
      frames: this.anims.generateFrameNumbers('terrain-water', { frames: [1, 2, 3] }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: 'ocean-anim',
      frames: this.anims.generateFrameNumbers('terrain-water', { frames: [0, 1, 2, 3] }),
      frameRate: 2,
      repeat: -1,
    });
    // FIL-260: lake animation — same sheet but only the two calmest frames at 1 fps
    // so ponds look near-still compared to the rippling ocean and fast-moving rivers.
    this.anims.create({
      key: 'lake-anim',
      frames: this.anims.generateFrameNumbers('terrain-water', { frames: [0, 1] }),
      frameRate: 1,
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

    // FIL-258/260: Three water arrays — rivers (fast), ocean (slow), lakes (still).
    // Combined cap kept at 3000: 2400 ocean + 600 lake so GPU load is unchanged.
    const riverCentres: number[] = []; // flat [cx0, cy0, ...] for fast river animation
    const oceanCentres: number[] = []; // flat [cx0, cy0, ...] for slow ocean animation
    const lakeCentres:  number[] = []; // flat [cx0, cy0, ...] for near-still lake anim

    // Biome grid — one float per tile — stored for the cliff-edge shadow pass below.
    // Float32Array is cheap (~52 KB for 141×94 tiles) and avoids re-sampling the noise.
    const biomeGrid    = new Float32Array(tilesX * tilesY);
    // Biome index grid — one byte per tile — stored for the dev biome overlay.
    const biomeIdxGrid = new Uint8Array(tilesX * tilesY);

    // Phaser 4: RenderTexture.draw() handles batching internally —
    // no manual beginDraw()/endDraw() needed.

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        // Domain-warped base noise (FIL-153) — displaces the sample point by a
        // low-frequency noise offset before sampling, making biome borders fold and
        // warp organically (fjord-like coastlines, irregular forest edges) rather than
        // following mathematically smooth noise contours.
        const base   = noise.warped(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
        const detail = detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE,   2, 0.6);
        // FIL-154: temperature and moisture vary independently of elevation.
        const temp   = this.tempNoise.fbm(tx * TEMP_SCALE,  ty * TEMP_SCALE,  3, 0.5);
        const moist  = this.moistNoise.fbm(tx * MOIST_SCALE, ty * MOIST_SCALE, 3, 0.5);

        // Diagonal SW→NE corridor gradient. perpDiag<0 = NW mountains, perpDiag>0 = SE ocean.
        // Power-curve biases push flanks to extreme biomes (mountain >0.90, ocean <0.25).
        const perpDiag     = (tx / tilesX - (1 - ty / tilesY)) / 2;
        const mountainBias = Math.pow(Math.max(0, -perpDiag - 0.10), 1.5) * 4.0;
        const oceanBias    = Math.pow(Math.max(0, perpDiag  - 0.05), 1.5) * 4.5;
        let val = Math.max(0, Math.min(1.2, base * 0.70 + detail * 0.30 + mountainBias - oceanBias));

        // FIL-168: force water elevation for diagonal river-band tiles.
        const isRiverHere = this.isRiverTile?.[ty * tilesX + tx] === 1;
        // FIL-260: inland lake tiles (not reachable from the map border)
        const isLakeHere  = this.isLakeTile?.[ty  * tilesX + tx] === 1;
        if (isRiverHere) {
          // detail-based jitter (×0.08) keeps the river surface visually varied
          // while staying safely below the water threshold (< 0.25).
          val = 0.15 + detail * 0.08;
        }

        // FIL-172: river-bank wetland transition — tiles within 2 tile-rows of a
        // river get a moisture boost so low-elevation biomes shift toward marsh
        // rather than dry heath.  Creates a natural soggy edge without explicit
        // transition tile assets.  The +0.30 boost is enough to push borderline
        // heath tiles (moist ~0.65) past the marsh threshold (>0.72).
        let effectiveMoist = moist;
        if (!isRiverHere && this.isRiverTile) {
          const bankR = 2;
          outer: for (let dy = -bankR; dy <= bankR; dy++) {
            for (let dx = -bankR; dx <= bankR; dx++) {
              if (dy === 0 && dx === 0) continue;
              const nx = tx + dx;
              const ny = ty + dy;
              if (nx >= 0 && nx < tilesX && ny >= 0 && ny < tilesY &&
                  this.isRiverTile[ny * tilesX + nx] === 1) {
                effectiveMoist = Math.min(1, moist + 0.30);
                break outer;
              }
            }
          }
        }

        biomeGrid[ty * tilesX + tx]    = val;
        biomeIdxGrid[ty * tilesX + tx] = tileBiomeIdx(val, temp, effectiveMoist);

        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;

        // Draw the matching tileset frame (including water) scaled 2× to fill the 32×32 tile.
        // batchDraw() uses the image's own position — no per-tile batch flush.
        // Biome tint multiplies with each tile's pixel colours so the tile detail
        // stays visible while each region gets a distinct dominant hue — the same
        // technique CrossCode uses to give each zone a clear visual identity.
        // FIL-172: pass isRiverHere so river tiles use water-sheet row 1 (lighter).
        // FIL-260: pass isLakeHere so lake tiles use the calm 2-frame variant.
        const { key, frame } = terrainTileFrame(val, temp, effectiveMoist, detail, isRiverHere, isLakeHere);
        tileImg.setTexture(key, frame).setPosition(wx + 16, wy + 16);
        terrainRt.draw(tileImg);

        // Mark every 2nd water tile (in both axes) for the animated overlay pass.
        // Route to the correct array based on river / lake / ocean (FIL-258/260).
        // Cap: rivers unlimited within 3000 total; ocean ≤ 2400; lakes ≤ 600.
        if (key === 'terrain-water' && tx % 2 === 0 && ty % 2 === 0) {
          if (isRiverHere) {
            riverCentres.push(wx + 16, wy + 16);
          } else if (isLakeHere && lakeCentres.length < 1200) { // 600 entries × 2 coords
            lakeCentres.push(wx + 16, wy + 16);
          } else if (!isRiverHere && !isLakeHere && oceanCentres.length < 4800) { // 2400 entries × 2
            oceanCentres.push(wx + 16, wy + 16);
          }
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
          terrainRt.draw(tileImg);
        }
      }
    }

    // ── FIL-151: Biome transition dithering ──────────────────────────────────
    // Second pass over biomeGrid — at each tile we check its east and south
    // neighbours. When the biome values differ by more than a threshold (i.e. a
    // biome boundary crosses here), we draw an extra tile between the two using a
    // position-seeded bit-hash to alternate between the two biome frames.
    // This is "dithered blending" — the same technique many 16-bit era RPGs used
    // to smooth hard tile edges without explicit transition tile assets.
    //
    // We check only east + south (not west + north) to avoid drawing any transition
    // tile twice. Reusing tileImg + batchDraw means zero extra GPU draw calls.
    const TRANSITION_THRESHOLD = 0.12; // min biome difference to trigger blending
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const here = biomeGrid[ty * tilesX + tx];

        // East and south neighbours — stay in bounds
        const neighbours: Array<{ nx: number; ny: number; nVal: number }> = [];
        if (tx + 1 < tilesX) neighbours.push({ nx: tx + 1, ny: ty,     nVal: biomeGrid[ty * tilesX + (tx + 1)] });
        if (ty + 1 < tilesY) neighbours.push({ nx: tx,     ny: ty + 1, nVal: biomeGrid[(ty + 1) * tilesX + tx] });

        for (const { nx, ny, nVal } of neighbours) {
          if (Math.abs(here - nVal) < TRANSITION_THRESHOLD) continue;

          // Position-seeded hash: same (tx,ty) always picks the same frame.
          // Two large primes give good bit-mixing across the grid.
          const hashBit = ((tx * 2654435761 ^ ty * 2246822519) >>> 0) & 1;
          // Alternate between the two neighbouring biome elevations for dither effect
          const blendElev = hashBit === 0 ? here : nVal;
          // High-frequency detail from position hash for frame variety within the row
          const blendDetail = ((tx * 1664525 ^ ny * 1013904223) >>> 0) / 0xffffffff;

          // Resample temp + moist at the neighbour tile for correct biome lookup
          const blendTemp  = this.tempNoise.fbm(nx * TEMP_SCALE,  ny * TEMP_SCALE,  3, 0.5);
          const blendMoist = this.moistNoise.fbm(nx * MOIST_SCALE, ny * MOIST_SCALE, 3, 0.5);

          const { key, frame } = terrainTileFrame(blendElev, blendTemp, blendMoist, blendDetail);
          // Position the tile at the midpoint between the two neighbours
          tileImg.setTexture(key, frame).setPosition(
            ((tx + nx) / 2) * TILE_SIZE + 16,
            ((ty + ny) / 2) * TILE_SIZE + 16,
          );
          terrainRt.draw(tileImg);
        }
      }
    }

    // ── Water Wang depth pass ────────────────────────────────────────────────────
    // Redraws every ocean tile (elev < 0.25, not river/lake) using the 'water-deep'
    // Wang tileset so the ocean shows a depth gradient: dark teal in the open
    // ocean, lighter teal near the shore where elevation approaches 0.25.
    //
    // Corner key encoding: NW<<3 | NE<<2 | SW<<1 | SE (1=shallow/upper, 0=deep/lower)
    // A diagonal corner is "shallow" when that neighbour's elevation ≥ SHALLOW_THRESH
    // (approaching the water surface) or when it's out-of-bounds (treat as land).
    // Frame lookup built from the tileset JSON bounding_box positions:
    //   frame = (bbox.y / 16) * 4 + (bbox.x / 16)
    // Index 0 (all deep) → frame 6 (wang_0, pure deep tile); 15 (all shallow) → frame 12.
    const WATER_WANG_FRAMES = [6, 7, 10, 9, 2, 11, 4, 15, 5, 14, 1, 8, 3, 0, 13, 12];
    const SHALLOW_THRESH    = 0.22; // elevation band just below the water threshold (0.25)

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const elev = biomeGrid[ty * tilesX + tx];
        if (elev >= 0.25) continue;                                    // not ocean
        if (this.isRiverTile?.[ty * tilesX + tx] === 1) continue;     // rivers keep their own animation
        if (this.isLakeTile?.[ty  * tilesX + tx] === 1) continue;     // lakes too

        // Elevation at the four diagonal corner neighbours (out-of-bounds → 1 = land/shallow)
        const nwE = (tx > 0        && ty > 0)        ? biomeGrid[(ty - 1) * tilesX + (tx - 1)] : 1;
        const neE = (tx < tilesX-1 && ty > 0)        ? biomeGrid[(ty - 1) * tilesX + (tx + 1)] : 1;
        const swE = (tx > 0        && ty < tilesY-1) ? biomeGrid[(ty + 1) * tilesX + (tx - 1)] : 1;
        const seE = (tx < tilesX-1 && ty < tilesY-1) ? biomeGrid[(ty + 1) * tilesX + (tx + 1)] : 1;

        const nw = nwE >= SHALLOW_THRESH ? 1 : 0;
        const ne = neE >= SHALLOW_THRESH ? 1 : 0;
        const sw = swE >= SHALLOW_THRESH ? 1 : 0;
        const se = seE >= SHALLOW_THRESH ? 1 : 0;
        const frame = WATER_WANG_FRAMES[(nw << 3) | (ne << 2) | (sw << 1) | se];

        tileImg.setTexture('water-deep', frame).setPosition(tx * TILE_SIZE + 16, ty * TILE_SIZE + 16);
        terrainRt.draw(tileImg);
      }
    }

    // ── Shore Wang transition pass ───────────────────────────────────────────────
    // Draws water-shore Wang tiles over shore-band tiles (elev 0.25–0.30) that
    // have at least one water corner. Interior shore tiles (all-land corners,
    // wangKey=15) are skipped so they keep their existing Mystic Woods look.
    //
    // Layering: these tiles are baked at depth 0 (same RenderTexture). The cliff
    // faces from drawCliffEdges() are drawn afterwards at depth 0.3–0.5, so they
    // naturally sit on top — sandy shore at the base, cliff wall above it.
    //
    // Same WATER_WANG_FRAMES lookup; corner encoding is inverted relative to the
    // depth pass: here lower=water (elev<0.25, bit=0), upper=land (bit=1).
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const elev = biomeGrid[ty * tilesX + tx];
        if (elev < 0.25 || elev >= 0.30) continue; // only shore band

        const nwE = (tx > 0        && ty > 0)        ? biomeGrid[(ty - 1) * tilesX + (tx - 1)] : 1;
        const neE = (tx < tilesX-1 && ty > 0)        ? biomeGrid[(ty - 1) * tilesX + (tx + 1)] : 1;
        const swE = (tx > 0        && ty < tilesY-1) ? biomeGrid[(ty + 1) * tilesX + (tx - 1)] : 1;
        const seE = (tx < tilesX-1 && ty < tilesY-1) ? biomeGrid[(ty + 1) * tilesX + (tx + 1)] : 1;

        // bit=1 when corner is land (>=0.25), bit=0 when water (<0.25)
        const nw = nwE >= 0.25 ? 1 : 0;
        const ne = neE >= 0.25 ? 1 : 0;
        const sw = swE >= 0.25 ? 1 : 0;
        const se = seE >= 0.25 ? 1 : 0;
        const wangKey = (nw << 3) | (ne << 2) | (sw << 1) | se;
        if (wangKey === 15) continue; // all-land corners — no water adjacency, skip

        const frame = WATER_WANG_FRAMES[wangKey];
        tileImg.setTexture('water-shore', frame).setPosition(tx * TILE_SIZE + 16, ty * TILE_SIZE + 16);
        terrainRt.draw(tileImg);
      }
    }

    tileImg.destroy();

    // Store tile data so the dev overlay can be built lazily when first enabled.
    this.tileDevW     = tilesX;
    this.tileDevElev  = biomeGrid;
    this.tileDevBiome = biomeIdxGrid;

    // ── Biome colour wash (depth 0.1) ────────────────────────────────────────
    // A coarse-grid Graphics layer drawn at low alpha over the terrain texture.
    // Gives each biome region a distinct dominant hue — the same visual technique
    // CrossCode uses so players instantly read "I'm in the forest / shore / highlands".
    // Using TILE_SIZE*6 (192px) cells keeps it under 200 fillRect calls while still
    // matching the noise gradient closely enough to look organic at play zoom.
    this.drawBiomeColorWash(noise, tilesX, tilesY);
    // FIL-178: cliff-face rendering — Y-sorted per row, biome-aware, multi-step.
    // biomeIdxGrid is now passed so the cliff system can look up per-biome colours.
    this.drawCliffEdges(biomeGrid, biomeIdxGrid, tilesX, tilesY);
    // FIL-177: feathered colour strips at biome boundaries.
    // Drawn at depth 0.46 — above the biome colour wash (0.1) but below paths (1)
    // and decorations (2+).
    this.drawBiomeBlendStrips(biomeIdxGrid, tilesX, tilesY);

    // Place animated water sprites at depth 0.5 — just above the static terrain bake (0)
    // but below decorations (2+). Each sprite covers the baked water tile underneath.
    // Rivers play a faster 3-frame animation; ocean plays a slow 4-frame roll (FIL-258).
    // Stagger start frames so adjacent tiles don't flash in sync.
    const riverAnim = this.anims.get('river-anim');
    for (let i = 0; i < riverCentres.length; i += 2) {
      const spr = this.add.sprite(riverCentres[i], riverCentres[i + 1], 'terrain-water');
      spr.setScale(2).setDepth(0.5);
      spr.play('river-anim');
      spr.anims.setCurrentFrame(riverAnim.frames[(i / 2) % riverAnim.frames.length]);
    }
    // FIL-259: single TileSprite replaces up to 2400 per-tile ocean animated sprites.
    // One GPU draw call + one tween instead of one AnimationState update per tile per frame.
    if (oceanCentres.length >= 2) {
      // Compute bounding box of all ocean tile centres (world coordinates).
      let minOceanX = Infinity, minOceanY = Infinity, maxOceanX = -Infinity, maxOceanY = -Infinity;
      for (let i = 0; i < oceanCentres.length; i += 2) {
        if (oceanCentres[i]     < minOceanX) minOceanX = oceanCentres[i];
        if (oceanCentres[i]     > maxOceanX) maxOceanX = oceanCentres[i];
        if (oceanCentres[i + 1] < minOceanY) minOceanY = oceanCentres[i + 1];
        if (oceanCentres[i + 1] > maxOceanY) maxOceanY = oceanCentres[i + 1];
      }
      // Each tile centre is 32 world-px from its neighbours; add a half-tile on
      // each edge so the TileSprite covers the outermost tile footprint fully.
      const OCEAN_HALF = 16; // half of the 32×32 displayed tile (16 source × 2 scale)
      const oceanX = (minOceanX + maxOceanX) / 2;
      const oceanY = (minOceanY + maxOceanY) / 2;
      const oceanW  = maxOceanX - minOceanX + 2 * OCEAN_HALF;
      const oceanH  = maxOceanY - minOceanY + 2 * OCEAN_HALF;

      const oceanTile = this.add
        .tileSprite(oceanX, oceanY, oceanW, oceanH, 'terrain-water')
        .setDepth(0.5);
      // Lock to frame 1 (gentle ripple) so the TileSprite tiles a single
      // uniform frame rather than the full 4-frame horizontal strip.
      // Scrolling tilePositionX across all 4 frames caused a distracting
      // left-to-right shift that looked like the water was sliding.
      oceanTile.setFrame(1);
      // Scale the tiled texture to 2× so each tile appears 32×32 in world space,
      // matching the original per-tile sprites.  setTileScale does not inflate the
      // TileSprite's own display rect — it only changes how the texture tiles within it.
      oceanTile.setTileScale(2, 2);

      // Alpha shimmer: gentle brightness pulse reads as water without horizontal drift.
      this.tweens.add({
        targets:  oceanTile,
        alpha:    { from: 0.78, to: 1.0 },
        duration: 2000,
        repeat:   -1,
        yoyo:     true,
        ease:     'Sine.easeInOut',
      });

      // Geometry mask: clip the TileSprite to actual water tiles so land tiles
      // enclosed by the bounding box remain unaffected.  setVisible(false) hides
      // the Graphics from the regular render pass while leaving the stencil pass
      // (which checks `active`, not `visible`) fully functional.
      const oceanMaskGfx = this.add.graphics().setVisible(false);
      for (let i = 0; i < oceanCentres.length; i += 2) {
        oceanMaskGfx.fillRect(
          oceanCentres[i] - OCEAN_HALF, oceanCentres[i + 1] - OCEAN_HALF,
          2 * OCEAN_HALF,               2 * OCEAN_HALF,
        );
      }
      oceanTile.setMask(oceanMaskGfx.createGeometryMask());
    }
    // FIL-260: lake sprites — near-still, 1 fps, only 2 frames so ponds feel quiet.
    const lakeAnim = this.anims.get('lake-anim');
    for (let i = 0; i < lakeCentres.length; i += 2) {
      const spr = this.add.sprite(lakeCentres[i], lakeCentres[i + 1], 'terrain-water');
      spr.setScale(2).setDepth(0.5);
      spr.play('lake-anim');
      spr.anims.setCurrentFrame(lakeAnim.frames[(i / 2) % lakeAnim.frames.length]);
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
        // Approximate the arc as a 4-segment polyline.
        // Phaser 4: strokePoints expects Vector2[], not plain {x,y}.
        const pts: Phaser.Math.Vector2[] = [];
        for (let j = 0; j <= 4; j++) {
          const a = startAngle + dashAngle * (j / 4);
          pts.push(new Phaser.Math.Vector2(
            s.x + Math.cos(a) * s.radius,
            s.y + Math.sin(a) * s.radius,
          ));
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

      // Sample all three noise layers — matches drawProceduralTerrain() exactly so
      // the chunk lands on the biome the player will see underfoot.
      const biomeVal = biomeNoise.fbm(x * BASE_SCALE, y * BASE_SCALE);
      const tempVal  = this.tempNoise.fbm(x * TEMP_SCALE,  y * TEMP_SCALE,  3, 0.5);
      const moistVal = this.moistNoise.fbm(x * MOIST_SCALE, y * MOIST_SCALE, 3, 0.5);

      // Filter chunk pool by elevation, temperature, and moisture.
      // temp/moist fields default to full range [0,1] so existing chunks without
      // them set are unaffected — backward compatible.
      const eligible = CHUNKS.filter(c => {
        const elevOk  = biomeVal >= (c.biomeMin          ?? 0) && biomeVal <= (c.biomeMax          ?? 1);
        const tempOk  = tempVal  >= (c.temperatureMin    ?? 0) && tempVal  <= (c.temperatureMax    ?? 1);
        const moistOk = moistVal >= (c.moistureMin       ?? 0) && moistVal <= (c.moistureMax       ?? 1);
        return elevOk && tempOk && moistOk;
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
   * FIL-128: Place hand-authored corrupted landmark clearings at fixed world positions.
   *
   * Each landmark gets:
   *   - A CORRUPTED_CLEARING chunk (scattered rocks + dark mushrooms).
   *   - A dark low-alpha aura circle to visually signal "dead zone" to the player.
   *
   * Landmarks are intentional and findable — they tell the world's environmental story
   * rather than being purely decorative scatter.
   */
  private stampCorruptedLandmarks(): void {
    for (const lm of CORRUPTED_LANDMARKS) {
      this.stampChunk(CORRUPTED_CLEARING, lm.x, lm.y);
      // Dark purple aura — very low alpha so it doesn't dominate the palette,
      // but creates a clear "something happened here" visual signal.
      this.add.circle(lm.x, lm.y, 90, 0x220022, 0.18).setDepth(0.05);
    }
  }

  /**
   * FIL-129: Place a HIDDEN_HOLLOW chunk + faint hint circle at each secret
   * collectible position. The golden circle is very low alpha — enough to make a
   * curious player stop, but easy to miss at a glance.
   */
  private stampSecretAreas(): void {
    for (const sp of SECRET_POSITIONS) {
      this.stampChunk(HIDDEN_HOLLOW, sp.x, sp.y);
      // Faint golden glow — suggests "something worth finding here" without being obvious.
      this.add.circle(sp.x, sp.y, 50, 0x998800, 0.10).setDepth(0.05);
    }
  }

  /**
   * FIL-129: Place a WAYMARKER_STONE chunk at each zone boundary transition.
   * The stone clusters act as subtle spatial cues — like old trail markers — telling
   * the player that the character of the land is about to change.
   */
  private stampZoneBoundaries(): void {
    for (const m of ZONE_BOUNDARY_MARKERS) {
      this.stampChunk(WAYMARKER_STONE, m.x, m.y);
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

      // Grass tufts sway gently — a sine-eased angle tween rocks each tuft ±2°.
      // Duration and delay are derived from world position so adjacent tufts
      // don't oscillate in lockstep; coprime multipliers prevent axis-aligned banding.
      if (d.type === 'tuft') {
        this.tweens.add({
          targets: sprite,
          angle: { from: -2, to: 2 },                           // narrower arc — light breeze, not wind
          ease: 'Sine.easeInOut',
          duration: 2400 + (Math.abs(d.x + d.y) % 800),        // 2.4–3.2 s cycle (half-cycle 1.2–1.6 s)
          yoyo: true,
          repeat: -1,
          delay: Math.abs(d.x * 3 + d.y * 7) % 1500,  // 0–1.5 s stagger
        });
      }
    }
  }

  /**
   * Scatter water lilies and rocks along the shoreline (biome 0.22–0.35).
   * Placed between terrain rendering (depth 0) and ground decorations (depth 2)
   * so they appear to rest on the water surface or at the water's edge.
   *
   * Uses the same baseNoise instance as terrain rendering so scatter positions
   * align naturally with the visible shoreline — no separate noise setup needed.
   *
   * The mulberry32 seed is XOR'd with a different value from the decoration scatter
   * seed so lily/rock positions are independent of flower/mushroom positions.
   */
  private stampWaterEdgeScatter(): void {
    const rng = mulberry32(this.runSeed ^ 0x57617465); // 0x57617465 = 'Wate'
    const STEP = 72; // sampling grid — roughly 2.25 tiles at 32px/tile
    const MAX_LILIES = 100;
    const MAX_ROCKS  = 70;
    let lilyCount = 0;
    let rockCount  = 0;

    for (let wy = STEP / 2; wy < WORLD_H; wy += STEP) {
      for (let wx = STEP / 2; wx < WORLD_W; wx += STEP) {
        if (lilyCount >= MAX_LILIES && rockCount >= MAX_ROCKS) break;

        const tx = wx / TILE_SIZE;
        const ty = wy / TILE_SIZE;

        // Same fbm call as DecorationScatter — gives biome values consistent with
        // terrain colours and decoration placement, no warp math needed here.
        const biome = this.baseNoise.fbm(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);

        // Shore band: open water side (< 0.30) for lilies, land side (0.28–0.35) for rocks
        if (biome < 0.22 || biome > 0.35) continue;

        // Jitter within the grid cell so items don't form a grid pattern
        const jx = (rng() - 0.5) * STEP * 0.9;
        const jy = (rng() - 0.5) * STEP * 0.9;
        const x = Phaser.Math.Clamp(wx + jx, 16, WORLD_W - 16);
        const y = Phaser.Math.Clamp(wy + jy, 16, WORLD_H - 16);

        if (biome < 0.29 && lilyCount < MAX_LILIES && rng() < 0.60) {
          // Lily pads on open water — pick one of 6 variants by frame index
          const frame = Math.floor(rng() * 6);
          const img = this.add.image(x, y, 'water-lillies', frame);
          this.decorImages.push(img);
          img.setScale(2.0 + rng() * 0.5); // 2.0–2.5× so they read at game zoom
          img.setDepth(0.5 + y / WORLD_H); // on the water surface, y-sorted
          img.setAlpha(0.80 + rng() * 0.20);
          lilyCount++;
        } else if (biome >= 0.27 && rockCount < MAX_ROCKS && rng() < 0.50) {
          // Rocks at the water's edge — 6 variants on the sheet
          const frame = Math.floor(rng() * 6);
          const img = this.add.image(x, y, 'rocks-in-water', frame);
          this.decorImages.push(img);
          img.setScale(2.0);
          img.setDepth(1.0 + y / WORLD_H); // just above lily depth
          rockCount++;
        }
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
      speedY:   { min: 8, max: 25 },    // slow drift down — not a plummet
      speedX:   { min: -6, max: 6 },    // gentle side-drift — not whipping
      rotate:   { min: 0, max: 90 },    // lazy tumble — not a full spin
      alpha:    { start: 0.7, end: 0 },
      scale:    { min: 0.8, max: 1.6 },
      lifespan: 14000,                   // longer air time at slower speed
      frequency: 900,                    // one leaf every ~1 s — sparse, not constant
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
        this.decorImages.push(img);
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
    // Mystic Woods building sprites — each frameKey on PlacedBuilding is a texture key
    // loaded individually in preload(). No atlas registration needed.

    // Graphics layer for intra-settlement dirt lanes.
    // Depth 3.2 — above corruption overlays (3), below building sprites (3.5) and
    // glow circles (3.4) so lanes appear to run under the buildings naturally.
    const laneGfx = this.add.graphics();
    laneGfx.setDepth(3.2);

    for (const s of SETTLEMENTS) {
      // Derive a stable numeric seed from the settlement id (djb2-style hash).
      // XOR with a constant to keep this seed independent from the decoration
      // scatter which also hashes settlement ids.
      let seed = 0xab1234cd;
      for (let i = 0; i < s.id.length; i++) {
        seed = (Math.imul(seed, 31) + s.id.charCodeAt(i)) >>> 0;
      }
      const rng = mulberry32(seed);

      // JRPG-style grid-aligned layout: plaza-first, fixed building slots per
      // settlement, three dirt street segments (south entry, cross, north spur).
      const { buildings, plaza, streets } = layoutSettlement(s, rng);

      // ── Plaza ───────────────────────────────────────────────────────────────
      // Sandy flagstone fill (0xd4b483) — slightly warmer than the dirt streets
      // so the civic square reads as a distinct paved surface.
      laneGfx.fillStyle(0xd4b483, 0.55);
      laneGfx.fillRect(plaza.x - plaza.w / 2, plaza.y - plaza.h / 2, plaza.w, plaza.h);

      // ── Dirt streets ────────────────────────────────────────────────────────
      // Three axis-aligned segments (main south entry, cross E-W, north spur).
      laneGfx.fillStyle(0xb8905a, 0.35);
      for (const seg of streets) {
        laneGfx.fillRect(seg.x, seg.y, seg.w, seg.h);
      }

      // ── Building sprites and physics bodies ────────────────────────────────
      for (const b of buildings) {
        // Scale the sprite uniformly so its display width equals b.w.
        // Height follows from the frame's intrinsic aspect ratio.
        const img = this.add.image(b.x, b.y, b.frameKey);
        this.decorImages.push(img);
        const sprScale = b.w / img.width;
        img.setScale(sprScale);
        img.setDepth(3.5);

        // Warm glow circle — lit at dusk/night via ADD blend mode (FIL-80).
        // Alpha starts at 0 and is tweened by updateDayNight().
        const glowR = Math.max(b.w, img.height * sprScale) * 0.55;
        const glow  = this.add.circle(b.x, b.y, glowR, 0xffaa33, 0);
        glow.setDepth(3.4).setBlendMode(Phaser.BlendModes.ADD);
        this.settlementGlows.push(glow);

        // Invisible static physics body so the player cannot walk through walls.
        // We use a 'rock-grass' image as a convenient always-preloaded texture;
        // it's set invisible so only the physics rectangle is active.
        const physRect = this.physics.add.staticImage(b.x, b.y, 'rock-grass');
        physRect.setVisible(false);
        const body = physRect.body as Phaser.Physics.Arcade.StaticBody;
        body.setSize(b.w, img.height * sprScale);
        body.reset(b.x, b.y);
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
      // item.frame is undefined for single-image textures, which Phaser treats identically
      // to omitting the argument — so this is backward compatible with all existing chunks.
      const obj = this.physics.add.staticImage(wx, wy, item.texture, item.frame);
      this.decorImages.push(obj);
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
      // decoration / puddle — no physics, just a sprite.
      // Pass item.frame so chunks can reference a specific frame on a spritesheet
      // (e.g. frame 0 = closed chest on mw-chest-01). Undefined = whole image.
      const sprite = this.add.image(wx, wy, item.texture, item.frame);
      this.decorImages.push(sprite);
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

    // Wire collectible zone to alignment — coastal=earth, forest=spino, highland=vatten
    const ITEM_ALIGNMENT_MAP: Record<string, 'earth' | 'spino' | 'vatten'> = {
      'item-start': 'earth', 'item-forest': 'spino', 'item-plateau': 'vatten',
    };
    const itemWorld = ITEM_ALIGNMENT_MAP[id];
    if (itemWorld) this.worldState.adjustAlignment(itemWorld, 5);

    // Collectible pickup jingle — pan to the collectible's world X (FIL-116).
    if (this.audioAvailable && this.cache.audio.has('sfx-pickup')) {
      const collectibleSprite = this.collectibleSprites.get(id);
      const pickupPan = collectibleSprite ? this.stereoPan(collectibleSprite.x) : 0;
      this.sound.play('sfx-pickup', { volume: 0.55 * this.sfxVol, pan: pickupPan });
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

  // ── Vendors (FIL-93) ────────────────────────────────────────────────────────

  /**
   * Spawn a vendor NPC near each settlement and register proximity prompts.
   *
   * ## Why separate from settlementNpcs?
   * Settlement dialogue NPCs use NpcDialogScene; vendors open ShopScene.
   * Keeping them in separate arrays means each `update*` method handles its own
   * E-key action without needing to know which NPC type is nearby.
   *
   * ## Visual distinction
   * Vendors use the same player sprite as dialogue NPCs, but tinted orange
   * (`0xffaa44`) so the player can visually tell them apart at a glance.
   * A "Trader" label overhead reinforces the role.
   */
  private createVendors(): void {
    for (const def of VENDOR_DEFS) {
      // Reuse the PC idle sprite — an orange tint immediately sets traders apart
      // from the green-tinted dialogue NPCs.
      const sprite = this.add.image(def.x, def.y, 'pc-idle-down', 0);
      sprite.setScale(0.35);
      sprite.setDepth(2 + def.y / WORLD_H);
      // Orange tint signals "interactable commerce" vs the neutral NPC tint.
      sprite.setTint(0xffaa44);

      // "Trader" label floats above the sprite.
      this.add
        .text(def.x, def.y - 22, 'Trader', {
          fontSize: '8px',
          color: '#ffcc88',
        })
        .setOrigin(0.5)
        .setDepth(sprite.depth + 1);

      // E-key prompt — shown only when the player is within VENDOR_PROMPT_RADIUS.
      const prompt = this.add
        .text(def.x, def.y - 36, t('ui.shop'), {
          fontSize: '10px',
          color: '#f0ead6',
          backgroundColor: '#00000088',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(sprite.depth + 2)
        .setVisible(false);

      this.vendors.push({ vendorId: def.vendorId, sprite, prompt });
    }
  }

  /**
   * Show the "E: Shop" prompt when the player is within 70 px of a vendor,
   * and open ShopScene when E is pressed.
   *
   * Called every frame from update(). Sits after updateNpcProximity() so the
   * dialogue NPC "consumes" the E-key JustDown in the same frame, preventing
   * accidental shop opens when both a dialogue NPC and vendor are in range.
   */
  private updateVendorInteraction(): void {
    /** Pixel radius within which the prompt appears and E becomes active. */
    const VENDOR_PROMPT_RADIUS = 70;

    if (this.vendorShopActive) {
      // Hide all prompts while the shop is open.
      for (const v of this.vendors) v.prompt.setVisible(false);
      return;
    }

    for (const v of this.vendors) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        v.sprite.x,    v.sprite.y,
      );
      const inRange = dist < VENDOR_PROMPT_RADIUS;
      v.prompt.setVisible(inRange);

      if (inRange && this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
        this.vendorShopActive = true;
        this.scene.pause();
        this.scene.launch('ShopScene', {
          callerKey: this.scene.key,
          gold:      this.playerGold,
          vendorId:  v.vendorId,
        } as unknown as object);
        // Only open one shop per keypress.
        break;
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

  // ── Loot chests (FIL-92) ─────────────────────────────────────────────────────

  /**
   * Place interactive chests near each settlement and register their animations.
   *
   * ## Why fixed positions (not procedural)?
   * Chunk placement uses a random per-run seed, so procedurally placed chests
   * would land at different world coordinates on every page load — making stable
   * localStorage IDs impossible. Fixed positions near settlements keep IDs stable
   * across sessions.
   *
   * ## Sprite vs Image
   * Chests must animate on opening, so we use `this.add.sprite()` rather than
   * `this.add.image()`. Both load from the same spritesheet; sprite just exposes
   * the `play()` animation API.
   *
   * ## Chest animations
   * Each Mystic Woods chest sheet is 64×16 px with 4 frames (16×16 each):
   *   frame 0 = closed, frames 1–3 = opening sequence.
   * `repeat: 0` plays once and leaves the sprite on frame 3 (fully open).
   */
  private createLootChests(): void {
    // Register the one-shot opening animations (safe to call even if already created
    // from a previous scene restart — Phaser ignores duplicate animation keys).
    if (!this.anims.exists('chest-01-open')) {
      this.anims.create({
        key: 'chest-01-open',
        frames: this.anims.generateFrameNumbers('mw-chest-01', { start: 0, end: 3 }),
        frameRate: 8,  // 4 frames × 0.125 s each = 0.5 s total
        repeat: 0,
      });
    }
    if (!this.anims.exists('chest-02-open')) {
      this.anims.create({
        key: 'chest-02-open',
        frames: this.anims.generateFrameNumbers('mw-chest-02', { start: 0, end: 3 }),
        frameRate: 8,
        repeat: 0,
      });
    }

    // One chest per settlement. Gold ranges reflect each community's wealth.
    //   Strandviken — poor fishing hamlet, modest cache
    //   Skogsgläntan — forest trading village, richer stores
    //   Klippbyn — isolated mountain hamlet, travellers' supply cache
    const defs: ReadonlyArray<{
      id: string; x: number; y: number;
      texture: string; animKey: string;
      gold: { min: number; max: number };
    }> = [
      { id: 'chest-strandviken',  x: 540,  y: 2780, texture: 'mw-chest-01', animKey: 'chest-01-open', gold: { min: 8,  max: 15 } },
      { id: 'chest-skogsglanten', x: 2170, y: 1370, texture: 'mw-chest-02', animKey: 'chest-02-open', gold: { min: 15, max: 30 } },
      { id: 'chest-klippbyn',     x: 3840, y: 660,  texture: 'mw-chest-01', animKey: 'chest-01-open', gold: { min: 10, max: 20 } },
    ];

    // Load which chests were already opened in a previous session.
    const openedSet = new Set<string>(
      JSON.parse(localStorage.getItem('matlu_opened_chests') ?? '[]') as string[]
    );

    for (const def of defs) {
      const alreadyOpened = openedSet.has(def.id);

      // Frame 3 = fully open. Already-opened chests render immediately open
      // so the player doesn't see them "pop" closed on load.
      const sprite = this.add.sprite(def.x, def.y, def.texture, alreadyOpened ? 3 : 0);
      // Scale 2× matches other Mystic Woods decorations in the world (16 px → 32 px display).
      sprite.setScale(2.0);
      // y-sort: depth = world-y so the player correctly occludes/underlaps the chest.
      sprite.setDepth(def.y);
      // Origin (0.5, 1): sprite is anchored at its bottom-centre, consistent with
      // all other world objects that use y-sorting.
      sprite.setOrigin(0.5, 1);
      // Store the animation key on the sprite data so openLootChest() doesn't
      // need to know which sheet this particular chest uses.
      sprite.setData('animKey', def.animKey);

      // "E: Open" prompt — 8 px above the sprite top (sprite is 32 px tall at scale 2).
      // Depth 500 renders above all world objects.
      const prompt = this.add
        .text(def.x, def.y - 40, t('ui.open'), {
          fontSize: '10px',
          color: '#f0ead6',
          backgroundColor: '#00000088',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(500)
        .setVisible(false);

      this.lootChests.push({ id: def.id, sprite, prompt, gold: def.gold, opened: alreadyOpened });
    }
  }

  /**
   * Show the "E: Open" prompt when the player is within 70 px of an unopened
   * chest, and open it when E is pressed.
   *
   * Called every frame from update(). Matches the pattern of updateNpcProximity()
   * and updateShrine() so all three interactions share the same E key.
   *
   * Multiple chests can show their prompts simultaneously if somehow in range,
   * but in practice settlements are far apart so only one is ever nearby.
   */
  private updateLootChestInteraction(): void {
    /** Pixel radius within which the prompt appears and E becomes active. */
    const PROMPT_RADIUS = 70;

    for (const chest of this.lootChests) {
      // Already-opened chests never show a prompt.
      if (chest.opened) {
        chest.prompt.setVisible(false);
        continue;
      }

      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        chest.sprite.x, chest.sprite.y,
      );
      const inRange = dist < PROMPT_RADIUS;
      chest.prompt.setVisible(inRange);

      if (inRange && this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
        this.openLootChest(chest);
        // Only open one chest per keypress even if two were somehow in range.
        break;
      }
    }
  }

  /**
   * Open a loot chest: animate it, award gold, play a sound, and persist the
   * opened state to localStorage so a page reload doesn't reset it.
   *
   * Gold is awarded using the same Lucky Strike multiplier applied to combat
   * drops, keeping the economy consistent — a found chest feels like a
   * meaningful bonus rather than a separate system.
   */
  private openLootChest(chest: LootChest): void {
    chest.opened = true;
    chest.prompt.setVisible(false);

    // Play the opening animation — Phaser leaves the sprite on the last frame
    // (frame 3 = fully open) after a repeat-0 animation completes.
    const animKey = chest.sprite.getData('animKey') as string;
    chest.sprite.play(animKey);

    // Award gold, applying Lucky Strike upgrade if purchased.
    const boughtUpgrades = JSON.parse(
      localStorage.getItem('matlu_upgrades') ?? '{}'
    ) as Record<string, boolean>;
    const goldMult = boughtUpgrades['lucky_strike'] ? 1.5 : 1;
    const amount   = Math.round(
      Phaser.Math.Between(chest.gold.min, chest.gold.max) * goldMult
    );
    this.playerGold += amount;
    this.refreshGoldText();

    // Floating "+N gold" label — rises and fades, same as combat drop feedback.
    // Spawn above the chest top so it doesn't overlap the sprite.
    this.spawnFloatText(
      chest.sprite.x,
      chest.sprite.y - chest.sprite.displayHeight,
      `+${amount} ${t('hud.gold')}`,
      '#ffe066',
    );

    // Re-use an existing impact sound pitched up (+50% rate) for a "chest pop"
    // feel. No dedicated audio file needed — Phaser's rate parameter pitch-shifts
    // the existing soft-impact variants to sound distinct from footsteps.
    if (this.audioAvailable && this.cache.audio.has('sfx-impact-soft-0')) {
      this.sound.play('sfx-impact-soft-0', { volume: 0.6 * this.sfxVol, rate: 1.5 });
    }

    // Bonus XP for opening the very first chest — rewards exploring settlements.
    if (this.skillSystem.trackFirst('first-chest')) {
      this.skillSystem.addXP('combat', 30);
    }

    // Persist opened IDs. We read and re-write each time so concurrent tabs
    // (or future multi-chest openings) don't overwrite each other's state.
    const openedSet = new Set<string>(
      JSON.parse(localStorage.getItem('matlu_opened_chests') ?? '[]') as string[]
    );
    openedSet.add(chest.id);
    localStorage.setItem('matlu_opened_chests', JSON.stringify([...openedSet]));
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
      // Wire dialog choice to alignment — jordens=earth, spinolandets=spino, vattenpandalandets=vatten
      const CHOICE_ALIGNMENT_MAP: Record<string, 'earth' | 'spino' | 'vatten'> = {
        jordens: 'earth', spinolandets: 'spino', vattenpandalandets: 'vatten',
      };
      const world = CHOICE_ALIGNMENT_MAP[choiceId];
      if (world) this.worldState.adjustAlignment(world, 15);
    });

    this.scene.pause();
    this.scene.launch('NpcDialogScene', dialogData as unknown as object);
  }

  // ─── Nav panel (NavScene overlay) ────────────────────────────────────────────

  /**
   * Launch NavScene as an overlay — it renders the nav panel in its own camera
   * (no zoom) so its elements are never culled by the zoomed main camera.
   * NavScene communicates back via game.events.
   */
  private launchNavPanel(): void {
    if (!this.scene.isActive(NavScene.KEY)) {
      // Pass mode as init data so NavScene shows the correct button on its very
      // first frame — avoids a race where game.events.emit() fires before
      // NavScene's create() has registered the nav-mode-change listener.
      this.scene.launch(NavScene.KEY, { mode: 'wilderview' });
    } else {
      // NavScene already running (e.g. switched back from arena) — update live.
      this.game.events.emit('nav-mode-change', 'wilderview');
    }

    // NavScene button → goto arena.
    this.game.events.on('nav-goto-arena', () => {
      this.scene.stop(NavScene.KEY);
      // Show tier selector — player picks a tier, then ArenaSelectScene
      // launches CombatArenaScene with the matching ArenaTierConfig.
      this.scene.pause(this.scene.key);
      this.scene.start('ArenaSelectScene', { returnTo: this.scene.key });
    }, this);

    // NavScene button → toggle free cam.
    this.game.events.on('nav-toggle-free-cam', () => {
      this.toggleFreeCam();
    }, this);

    // NavScene buttons → toggle dev overlays.
    this.game.events.on('nav-toggle-elev-overlay', () => {
      this.toggleDevOverlay('elevation');
    }, this);
    this.game.events.on('nav-toggle-biome-overlay', () => {
      this.toggleDevOverlay('biome');
    }, this);

    // NavScene World Dev buttons → toggle world-layer visibility.
    this.game.events.on('nav-toggle-decor', () => {
      this.toggleDecor();
    }, this);
    this.game.events.on('nav-toggle-animals', () => {
      this.toggleAnimals();
    }, this);
    this.game.events.on('nav-toggle-paths',       () => { this.togglePaths();       }, this);
    this.game.events.on('nav-toggle-zones',       () => { this.toggleZones();       }, this);
    this.game.events.on('nav-toggle-settlements', () => { this.toggleSettlements(); }, this);
    this.game.events.on('nav-toggle-fog',         () => { this.toggleFog();         }, this);
    this.game.events.on('nav-toggle-iso-grid',    () => { this.toggleIsoGrid();    }, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('nav-goto-arena', undefined, this);
      this.game.events.off('nav-toggle-free-cam', undefined, this);
      this.game.events.off('nav-toggle-elev-overlay', undefined, this);
      this.game.events.off('nav-toggle-biome-overlay', undefined, this);
      this.game.events.off('nav-toggle-decor', undefined, this);
      this.game.events.off('nav-toggle-animals', undefined, this);
      this.game.events.off('nav-toggle-paths', undefined, this);
      this.game.events.off('nav-toggle-zones', undefined, this);
      this.game.events.off('nav-toggle-settlements', undefined, this);
      this.game.events.off('nav-toggle-fog', undefined, this);
      this.game.events.off('nav-toggle-iso-grid', undefined, this);
    });
  }

  /** Toggle free-fly camera on/off. Notifies NavScene to update its button. */
  toggleFreeCam(): void {
    this.freeCamMode = !this.freeCamMode;
    if (this.freeCamMode) {
      this.cameras.main.stopFollow();
    } else {
      if (this.attractTargets.length > 0) {
        this.cameras.main.startFollow(
          this.attractTargets[this.attractIdx] as Phaser.GameObjects.GameObject,
          true, 0.06, 0.06,
        );
      }
    }
    this.game.events.emit('nav-free-cam-changed', this.freeCamMode);
  }

  /**
   * Toggle world decorations (trees, rocks, flowers, paths, zone tints, particles)
   * on/off.  Mirrors the H-key shortcut but also fires a NavScene update event so
   * the World Dev panel button reflects the current state.
   */
  toggleDecor(): void {
    this.decorVisible = !this.decorVisible;
    for (const img of this.decorImages) img.setVisible(this.decorVisible);
    this.pathGraphics.setVisible(this.decorVisible);
    for (const ov of this.zoneOverlays.values()) ov.setVisible(this.decorVisible);
    for (const g of this.settlementGlows) g.setVisible(this.decorVisible);
    if (this.leavesEmitter)  this.leavesEmitter.emitting  = this.decorVisible && (this.worldClock?.phase === 'dawn' || this.worldClock?.phase === 'dusk');
    if (this.pollenEmitter)  this.pollenEmitter.emitting   = this.decorVisible && (this.worldClock?.phase === 'morning' || this.worldClock?.phase === 'midday' || this.worldClock?.phase === 'afternoon');
    if (this.fireflyEmitter) this.fireflyEmitter.emitting  = this.decorVisible && this.worldClock?.phase === 'night';
    // true means decorations are on (shown), button shows ✓
    this.game.events.emit('nav-decor-changed', this.decorVisible);
  }

  /**
   * Toggle wildlife visibility on/off.  Hides the rabbit and ground-animal physics
   * groups so the world can be inspected without animals cluttering the view.
   * Notifies NavScene so the Animals button label stays in sync.
   */
  toggleAnimals(): void {
    this.animalsVisible = !this.animalsVisible;
    this.rabbits?.setAlpha(this.animalsVisible ? 1 : 0);
    this.groundAnimals?.setAlpha(this.animalsVisible ? 1 : 0);
    // true means animals are visible, button shows ✓
    this.game.events.emit('nav-animals-changed', this.animalsVisible);
  }

  /** Toggle path network independently of the Decor master toggle. */
  togglePaths(): void {
    this.pathsVisible = !this.pathsVisible;
    this.pathGraphics.setVisible(this.pathsVisible);
    this.game.events.emit('nav-paths-changed', this.pathsVisible);
  }

  /** Toggle zone tint overlays independently of the Decor master toggle. */
  toggleZones(): void {
    this.zonesVisible = !this.zonesVisible;
    for (const ov of this.zoneOverlays.values()) ov.setVisible(this.zonesVisible);
    this.game.events.emit('nav-zones-changed', this.zonesVisible);
  }

  /** Toggle settlement glow circles independently of the Decor master toggle. */
  toggleSettlements(): void {
    this.settlementsVisible = !this.settlementsVisible;
    for (const g of this.settlementGlows) g.setVisible(this.settlementsVisible);
    this.game.events.emit('nav-settlements-changed', this.settlementsVisible);
  }

  /** Toggle the fog-of-war render texture overlay on/off. */
  toggleFog(): void {
    this.fogVisible = !this.fogVisible;
    if (this.fogRt) this.fogRt.setVisible(this.fogVisible);
    this.game.events.emit('nav-fog-changed', this.fogVisible);
  }

  /** Spawn or despawn the player at the current camera centre (P key, world dev route). */
  private toggleDevPlayer(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const visible = this.player.alpha > 0;
    if (visible) {
      // Despawn: hide and switch to free-cam.
      this.player.setAlpha(0);
      this.playerShadow.setAlpha(0);
      body.setEnable(false);
      if (!this.freeCamMode) {
        this.freeCamMode = true;
        this.cameras.main.stopFollow();
        this.game.events.emit('nav-free-cam-changed', true);
      }
    } else {
      // Spawn at camera centre so the player lands where you're looking.
      const cam = this.cameras.main;
      const wx  = cam.scrollX + cam.width  / 2 / cam.zoom;
      const wy  = cam.scrollY + cam.height / 2 / cam.zoom;
      this.player.setPosition(wx, wy);
      this.playerShadow.setPosition(wx + 6, wy + 8);
      body.reset(wx, wy);
      body.setEnable(true);
      this.player.setAlpha(1);
      this.playerShadow.setAlpha(0.22);
      this.freeCamMode = false;
      this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
      this.game.events.emit('nav-free-cam-changed', false);
    }
  }

  /** Toggle the isometric grid overlay (lazily created on first show). */
  toggleIsoGrid(): void {
    this.isoGridVisible = !this.isoGridVisible;
    if (this.isoGridVisible) {
      if (!this.isoGridGfx) this.createIsoGrid();
      this.isoGridGfx!.setVisible(true);
    } else {
      this.isoGridGfx?.setVisible(false);
    }
    this.game.events.emit('nav-iso-grid-changed', this.isoGridVisible);
  }

  /**
   * Draw a 2:1 isometric diamond grid over the entire world.
   *
   * Two families of parallel lines at ±0.5 slope give the classic "iso" look.
   * CELL_W = 128 px / CELL_H = 64 px — each diamond is one 8×8-tile chunk.
   * Lines are drawn once into a static Graphics object at depth 5, then toggled
   * visible/invisible. Alpha 0.15 keeps it subtle; raise to 0.3 for authoring.
   */
  private createIsoGrid(): void {
    const gfx = this.add.graphics();
    gfx.setDepth(5);
    gfx.lineStyle(1, 0xd4c4a0, 0.15);

    const W = WORLD_W;   // 4500
    const H = WORLD_H;   // 3000
    const CELL_W = 128;
    const CELL_H = CELL_W / 2; // 64 — 2:1 diamond ratio

    // NE-SW lines — slope +0.5 (y = 0.5x + b).
    // b steps from -(W/2) to H in CELL_H increments.
    const bMin = -Math.ceil((W / 2) / CELL_H) * CELL_H;
    for (let b = bMin; b <= H; b += CELL_H) {
      gfx.beginPath();
      gfx.moveTo(0,  b);
      gfx.lineTo(W,  0.5 * W + b);
      gfx.strokePath();
    }

    // NW-SE lines — slope -0.5 (y = -0.5x + b).
    // b steps from 0 to H + W/2.
    for (let b = 0; b <= H + W / 2; b += CELL_H) {
      gfx.beginPath();
      gfx.moveTo(0,  b);
      gfx.lineTo(W, -0.5 * W + b);
      gfx.strokePath();
    }

    gfx.setVisible(false);
    this.isoGridGfx = gfx;
  }

  /** Pan the camera with WASD/arrows when in free-fly mode. */
  private updateFreeCam(delta: number): void {
    const right = (this.cursors.right.isDown || this.wasd['right'].isDown) ? 1 : 0;
    const left  = (this.cursors.left.isDown  || this.wasd['left'].isDown)  ? 1 : 0;
    const down  = (this.cursors.down.isDown  || this.wasd['down'].isDown)  ? 1 : 0;
    const up    = (this.cursors.up.isDown    || this.wasd['up'].isDown)    ? 1 : 0;

    const speed = 400 / this.cameras.main.zoom;
    const cam   = this.cameras.main;
    cam.scrollX += (right - left) * speed * (delta / 1000);
    cam.scrollY += (down  - up)   * speed * (delta / 1000);
  }

  // ── Dev terrain overlay ──────────────────────────────────────────────────────

  /**
   * Toggle a dev overlay on/off. Calling the same mode again turns it off.
   * Only one overlay is active at a time — activating one automatically hides the other.
   */
  toggleDevOverlay(mode: 'elevation' | 'biome'): void {
    const next = this.devOverlay === mode ? 'none' : mode;
    this.devOverlay = next;

    if (next === 'elevation') {
      // Build the heatmap Graphics lazily on first use.
      if (!this.devElevGfx) this.buildDevElevGfx();
      this.devElevGfx?.setVisible(true);
      this.devBiomeGfx?.setVisible(false);
    } else if (next === 'biome') {
      if (!this.devBiomeGfx) this.buildDevBiomeGfx();
      this.devBiomeGfx?.setVisible(true);
      this.devElevGfx?.setVisible(false);
    } else {
      this.devElevGfx?.setVisible(false);
      this.devBiomeGfx?.setVisible(false);
    }

    // Auto-manage free cam so the user can pan/zoom immediately without a separate click.
    if (next !== 'none') {
      // Activating overlay — enable free cam if it isn't already on.
      if (!this.freeCamMode) {
        this.toggleFreeCam();
        this.devOverlayAutoFreeCam = true;
      }
    } else {
      // Deactivating overlay — restore free cam to its prior state only if we enabled it.
      if (this.devOverlayAutoFreeCam && this.freeCamMode) {
        this.toggleFreeCam();
      }
      this.devOverlayAutoFreeCam = false;
    }

    // Force text to rebuild on next update().
    this.devTextContainer?.removeAll(true);
    this.devTextLastX = -9999;

    this.game.events.emit('nav-dev-overlay-changed', next);
  }

  /**
   * Builds the elevation heatmap Graphics — one colour per tile on a dark-purple→yellow
   * gradient, bucketed into 16 steps to keep GPU state changes low.
   * Stored and reused; call toggleDevOverlay() to show/hide.
   */
  private buildDevElevGfx(): void {
    if (!this.tileDevElev) return;
    const tilesX = this.tileDevW;
    const N_BUCKETS = 16;

    // Group tile positions by colour bucket so each fillStyle() covers many fillRect() calls.
    const groups = new Map<number, number[]>();
    for (let i = 0, len = this.tileDevElev.length; i < len; i++) {
      const t      = Math.min(1, this.tileDevElev[i]);       // clamp [0,1]
      const bucket = Math.min(N_BUCKETS - 1, Math.floor(t * N_BUCKETS));
      const color  = elevHeatColor(bucket / (N_BUCKETS - 1));
      let arr = groups.get(color);
      if (!arr) { arr = []; groups.set(color, arr); }
      arr.push((i % tilesX) * TILE_SIZE, Math.floor(i / tilesX) * TILE_SIZE);
    }

    // Render at depth 5000 — above the player (world-Y depth) and all decorations.
    const gfx = this.add.graphics().setDepth(5000).setVisible(false);
    for (const [color, coords] of groups) {
      gfx.fillStyle(color, 0.82);
      for (let j = 0; j < coords.length; j += 2) {
        gfx.fillRect(coords[j], coords[j + 1], TILE_SIZE, TILE_SIZE);
      }
    }
    this.devElevGfx = gfx;
  }

  /**
   * Builds the biome colour Graphics — one flat colour per biome type.
   * Colours match BIOME_OVERLAY_COLORS so they're distinct but readable.
   */
  private buildDevBiomeGfx(): void {
    if (!this.tileDevBiome) return;
    const tilesX = this.tileDevW;

    const groups = new Map<number, number[]>();
    for (let i = 0, len = this.tileDevBiome.length; i < len; i++) {
      const color = BIOME_OVERLAY_COLORS[this.tileDevBiome[i]];
      let arr = groups.get(color);
      if (!arr) { arr = []; groups.set(color, arr); }
      arr.push((i % tilesX) * TILE_SIZE, Math.floor(i / tilesX) * TILE_SIZE);
    }

    const gfx = this.add.graphics().setDepth(5000).setVisible(false);
    for (const [color, coords] of groups) {
      gfx.fillStyle(color, 0.82);
      for (let j = 0; j < coords.length; j += 2) {
        gfx.fillRect(coords[j], coords[j + 1], TILE_SIZE, TILE_SIZE);
      }
    }
    this.devBiomeGfx = gfx;
  }

  /**
   * Called from update() — refreshes per-tile text labels whenever the camera moves
   * enough to change the visible tile set. Labels only appear at zoom ≥ 2 so they
   * remain readable (8px font × 2 zoom = 16 px apparent).
   */
  private updateDevOverlay(): void {
    if (this.devOverlay === 'none' || !this.tileDevElev) return;

    const cam = this.cameras.main;
    const dx  = Math.abs(cam.scrollX - this.devTextLastX);
    const dy  = Math.abs(cam.scrollY - this.devTextLastY);
    const dz  = Math.abs(cam.zoom   - this.devTextLastZoom);
    // Only rebuild when camera has moved at least one tile or zoom changed.
    if (dx < TILE_SIZE && dy < TILE_SIZE && dz < 0.05) return;

    this.devTextLastX    = cam.scrollX;
    this.devTextLastY    = cam.scrollY;
    this.devTextLastZoom = cam.zoom;

    if (!this.devTextContainer) {
      this.devTextContainer = this.add.container(0, 0).setDepth(5001);
    } else {
      this.devTextContainer.removeAll(true);
    }

    // Skip text at low zoom — labels would be illegible.
    if (cam.zoom < 2.0) return;

    const tilesX = this.tileDevW;
    const tilesY = Math.ceil(WORLD_H / TILE_SIZE);
    const viewW  = cam.width  / cam.zoom;
    const viewH  = cam.height / cam.zoom;

    const tx0 = Math.max(0,          Math.floor(cam.scrollX / TILE_SIZE));
    const ty0 = Math.max(0,          Math.floor(cam.scrollY / TILE_SIZE));
    const tx1 = Math.min(tilesX - 1, Math.ceil((cam.scrollX + viewW) / TILE_SIZE));
    const ty1 = Math.min(tilesY - 1, Math.ceil((cam.scrollY + viewH) / TILE_SIZE));

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const idx   = ty * tilesX + tx;
        const label = this.devOverlay === 'elevation'
          ? String(Math.round(this.tileDevElev[idx] * 100))
          : BIOME_LABELS[this.tileDevBiome![idx]];

        // White text with black stroke so it's readable on any tile colour.
        const txt = this.add.text(
          tx * TILE_SIZE + TILE_SIZE / 2,
          ty * TILE_SIZE + TILE_SIZE / 2,
          label,
          { fontSize: '8px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 },
        ).setOrigin(0.5);
        this.devTextContainer.add(txt);
      }
    }
  }
}
