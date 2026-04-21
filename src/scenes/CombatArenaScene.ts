import * as Phaser from 'phaser';
import { log } from '../lib/logger';
import { NavScene } from './NavScene';
import { bspGenerate, ARENA_BSP_CONFIG, BspDungeonLayout } from '../world/DungeonGen';
import { CombatEntity } from '../entities/CombatEntity';
import { Tinkerer } from '../entities/Tinkerer';
import { EarthHero } from '../entities/EarthHero';
import { Ironwing } from '../entities/Ironwing';
import { Rampart } from '../entities/Rampart';
import { Kronos } from '../entities/Kronos';
import { MajaLind } from '../entities/MajaLind';
import { TorstenKraft } from '../entities/TorstenKraft';
import { Loke } from '../entities/heroes/Loke';
import { Projectile } from '../entities/Projectile';
import { ArenaBlackboard } from '../ai/ArenaBlackboard';
import { ShimmerFilter }   from '../shaders/ShimmerFilter';
import { BabyVelcrid, VelcridJuvenile } from '../entities/Velcrid';
import { BurrowHole } from '../entities/BurrowHole';
import { BroodMother, EggSac } from '../entities/BroodMother';
import { GlitchDrone } from '../entities/EarthEnemies';
import { ArenaTierConfig, EnemyCtor, TIER_CONFIGS } from '../data/arenaTiers';
import { SimpleJoystick } from '../lib/SimpleJoystick';
import { worldToArenaIso, arenaIsoDepth, ISO_TILE_W, ISO_TILE_H } from '../lib/IsoTransform';

/** Axis-aligned bounding box for a procedurally-placed dungeon room. */
interface Room {
  x: number;  // left edge
  y: number;  // top edge
  w: number;  // width
  h: number;  // height
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Biome index → asset pack folder name. Mirrors GameScene for cross-scene consistency. */
const CUSTOM_TILE_PACKS: Record<number, string> = {
  1: 'rocky-shore', 2: 'sandy-shore', 3: 'marsh', 4: 'dry-heath',
  5: 'coastal-heath', 6: 'meadow', 7: 'forest', 8: 'spruce',
  9: 'cold-granite', 10: 'bare-summit', 11: 'snow-field',
};

const SPAWN_X_OFFSET  = 80;   // px from arena right edge
const MAX_ALIVE       = 15;   // total alive enemy cap (kept lower so kill rate stays meaningful)
const HERO_RESPAWN_MS = 3000; // ms hero lies dead before the reset sequence begins

/** Kill count at which the mine gadget unlocks, simulating the Tier 1 → Tier 2 transition. */
const GADGET_UNLOCK_KILLS = 10;

// Dungeon zoom — tighter than the overworld (3×) so corridors feel cramped and
// enemies feel close. Easy to tune: bump this value and rebuild to feel the difference.
const DUNGEON_ZOOM = 3.5;

// ── Scene ─────────────────────────────────────────────────────────────────────

/**
 * CombatArenaScene — continuous bio-wave combat sandbox (M1).
 *
 * Two enemy types: BabyVelcrid (fast small rushers) + VelcridJuvenile (orbiting hoppers).
 *   - Main timer fires a WaveGroup every 10→5 s (speeds up each wave).
 *   - Enemies accumulate between waves.
 *   - Tinkerer respawns at full HP after HERO_RESPAWN_MS if killed.
 *
 * Dev menu at the bottom bar switches to GameScene (WilderView).
 */
export class CombatArenaScene extends Phaser.Scene {
  static readonly KEY = 'CombatArenaScene';

  private hero!:         CombatEntity;
  private obstacles!:   Phaser.Physics.Arcade.StaticGroup;
  private heroAlive    = true;
  private aliveEnemies: CombatEntity[] = [];
  private projectiles:  Projectile[]   = [];
  private readonly blackboard = new ArenaBlackboard();

  /**
   * AABB rectangles for line-of-sight tests — one entry per solid interior
   * obstacle (stone pillars). Populated by buildDungeon() and passed to every
   * entity via addPhysics() so their BT can call hasLineOfSight().
   */
  private wallRects: Phaser.Geom.Rectangle[] = [];

  /** Point light that follows the hero — keeps nearby tiles visible as they move. */
  private heroLight: Phaser.GameObjects.Light | null = null;

  /**
   * Active tier configuration — set by init() from the data passed via
   * scene.start(key, config).  Falls back to TIER_CONFIGS[0] (Tier 1) when
   * no config is provided (e.g. CI screenshots, direct URL launch).
   */
  private tierConfig: ArenaTierConfig = TIER_CONFIGS[0];

  /**
   * Generated BSP dungeon layout — stored so other methods can query room data,
   * entry/exit points, etc. without re-running the generator.
   * Null until buildDungeon() runs in create().
   */
  private dungeonLayout: BspDungeonLayout | null = null;
  /**
   * Procedurally-placed rooms, populated by buildRooms() during create().
   * Used by spawnHero() and spawnWaveGroup() to place entities inside rooms.
   */
  private rooms:    Room[]     = [];
  /**
   * The room the hero starts in — enemies will not spawn here at wave boundaries
   * so the hero always has a moment to orient before the first enemies arrive.
   */
  private heroRoom: Room | null = null;

  private waveGroupIndex = 0;
  private waveNumber     = 0;
  private killCount      = 0;

  private mainSpawnTimer = 3000;  // first group fires after 3 s

  /** Active BurrowHole instances — populated by FIL-293 wave placement. */
  private activeHoles: BurrowHole[] = [];

  /** Test NPC — wandering humanoid for animation + interaction testing. */

  // HUD cache — setText() rebuilds the text texture on every call even when the
  // value hasn't changed, so only call it when the value actually differs.
  private _lastHudWave  = -1;
  private _lastHudAlive = -1;
  private _lastHudKills = -1;

  // ── HP bars (FIL-245) ───────────────────────────────────────────────────────
  /** P1 green fill rect — scaleX updated every frame from hero.hpFraction. */
  private p1HpBarFill!: Phaser.GameObjects.Rectangle;
  /** P2 orange fill rect — scaleX updated every frame from hero2.hpFraction.
   *  Stays hidden (scaleX=0) until a second player joins. */
  private p2HpBarFill!: Phaser.GameObjects.Rectangle;
  /** Second player hero — null until co-op P2 is wired in. */
  private hero2: CombatEntity | null = null;

  // Arena bounds — set in buildArena(), used by spawn helpers.
  private arenaX = 0;
  private arenaY = 0;
  private arenaW = 0;
  private arenaH = 0;

  private hudWave!:   Phaser.GameObjects.Text;
  private hudAlive!:  Phaser.GameObjects.Text;
  private hudKills!:  Phaser.GameObjects.Text;
  private hudGadget!: Phaser.GameObjects.Text;

  // ── Player control ──────────────────────────────────────────────────────────
  /** When true the player drives the hero with WASD/arrows + attack keys. */
  private heroPlayerMode = false;
  private moveKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private meleeKey!:  Phaser.Input.Keyboard.Key;
  /** P1 dash — G key (replaces Shift). */
  private dashKey!:   Phaser.Input.Keyboard.Key;
  private shootKey!:  Phaser.Input.Keyboard.Key;
  /** E key — deploy proximity mine (Tinkerer Tier 2 gadget). */
  private gadgetKey!: Phaser.Input.Keyboard.Key;

  /** True once the player reaches GADGET_UNLOCK_KILLS — gates the mine ability. */
  private gadgetUnlocked = false;

  // ── Touch controls ──────────────────────────────────────────────────────────
  /** Virtual joystick — only created on touch devices. */
  private joystick: SimpleJoystick | null = null;
  /** Tracks which touch pointers are currently pressing each action button. */
  private touchMelee  = false;
  private touchRanged = false;
  private touchDash   = false;

  // ── Audio ───────────────────────────────────────────────────────────────────
  private audioAvailable = false;
  // gunshotIndex removed — single real 9mm sample with random pitch variation.
  /** Looping combat/dungeon music track. Null until create() confirms audio is available. */
  private combatMusic: Phaser.Sound.BaseSound | null = null;

  /** User-controlled volume multipliers; read from localStorage in create(). */
  private musicVol = 0.15;
  private sfxVol   = 0.15;

  /** Width of the right-side nav panel. Arena is shrunk to not go behind it. */
  private static readonly PANEL_W = 160;

  /**
   * When true the scene is running as a menu background — HUD and nav panel are
   * hidden so they don't overlap the menu panel rendered on top.
   * Set via `this.scene.launch(CombatArenaScene.KEY, { background: true })`.
   */
  private bgMode = false;

  constructor() {
    super({ key: CombatArenaScene.KEY });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  init(data?: Partial<ArenaTierConfig> & { background?: boolean }): void {
    this.bgMode = data?.background ?? false;

    // Merge incoming data with the T1 defaults.  This means:
    //   scene.start('CombatArenaScene', TIER_CONFIGS[2])  → full T3 config
    //   scene.start('CombatArenaScene', { background: true }) → T1 defaults + bgMode
    //   scene.start('CombatArenaScene')                   → T1 defaults
    const base = TIER_CONFIGS[0];
    this.tierConfig = {
      tier:       data?.tier       ?? base.tier,
      label:      data?.label      ?? base.label,
      heroKey:    data?.heroKey    ?? base.heroKey,
      waveGroups: data?.waveGroups ?? base.waveGroups,
      ready:      data?.ready      ?? base.ready,
    };
  }

  preload(): void {
    // Real 9mm pistol shot (CC0, Freesound community). OGG primary, MP3 fallback.
    // Random pitch variation ±10% replaces the old 3-variant impactPlate cycling.
    this.load.audio('sfx-gunshot', [
      'assets/audio/freesound_community-9mm-pistol-shot-6349.ogg',
      'assets/audio/freesound_community-9mm-pistol-shot-6349.mp3',
    ]);
    // 1911 magazine reload — plays once when the Tinkerer's mag runs dry.
    this.load.audio('sfx-reload', [
      'assets/audio/freesound_community-1911-reload-6248.ogg',
      'assets/audio/freesound_community-1911-reload-6248.mp3',
    ]);

    // Tense dungeon ambience — "Cloak of Darkness" fits the arena's dark-stone aesthetic.
    this.load.audio(
      'combat-music',
      'assets/audio/music-loop-bundle-2026-q1/Week 4 - Cloak of Darkness STAGE 1.ogg',
    );

    // ── Creature ambient vocalisations ────────────────────────────────────────
    // MiniVelcrid insect chirps — 3 variants so back-to-back plays don't repeat
    // the same sound. Source: freesound.org CC0 — search "insect chirp short"
    // or "cricket stridulation single" and drop the OGGs into
    // public/assets/audio/creatures/. The scene skips playback gracefully if
    // the files are absent (audioAvailable guard in the event handler below).
    this.load.audio('sfx-velcrid-chirp-0', 'assets/audio/creatures/mini-velcrid/mini-velcrid-chirp-0.ogg');
    this.load.audio('sfx-velcrid-chirp-1', 'assets/audio/creatures/mini-velcrid/mini-velcrid-chirp-1.ogg');
    this.load.audio('sfx-velcrid-chirp-2', 'assets/audio/creatures/mini-velcrid/mini-velcrid-chirp-2.ogg');

    // VelcridJuvenile combat sounds — placeholder CC0 audio until proper creature
    // recordings are sourced (see scripts/download-creature-sounds.js).
    // Aggro: alien chirp burst on first sighting; attack: mandible snap;
    // hurt: chitin crack; death: heavy collapse with resonance.
    this.load.audio('sfx-velcrid-aggro',  'assets/audio/creatures/mini-velcrid/mini-velcrid-aggro.ogg');
    this.load.audio('sfx-velcrid-attack', 'assets/audio/creatures/mini-velcrid/mini-velcrid-attack.ogg');
    this.load.audio('sfx-velcrid-hurt',   'assets/audio/creatures/mini-velcrid/mini-velcrid-hurt.ogg');
    this.load.audio('sfx-velcrid-death',  'assets/audio/creatures/mini-velcrid/mini-velcrid-death.ogg');

    this.load.aseprite(
      'tinkerer',
      'assets/sprites/characters/earth/heroes/tinkerer/tinkerer.png',
      'assets/sprites/characters/earth/heroes/tinkerer/tinkerer.json',
    );
    this.load.aseprite(
      'loke',
      'assets/sprites/characters/mistheim/heroes/loke/loke.png',
      'assets/sprites/characters/mistheim/heroes/loke/loke.json',
    );
    // Mini Velcrid — used for all spinolandet enemies, tinted/scaled per class.
    this.load.aseprite(
      'mini-velcrid',
      'assets/sprites/characters/spinolandet/enemies/mini-velcrid/mini-velcrid.png',
      'assets/sprites/characters/spinolandet/enemies/mini-velcrid/mini-velcrid.json',
    );

    // Colosseum floor Wang tileset — 4x4 grid of 16x16 px tiles, 64x64 total.
    this.load.spritesheet(
      'colosseum_floor',
      'assets/sprites/tilesets/arena/arena_floor_colosseum.png',
      { frameWidth: 16, frameHeight: 16 },
    );

    // Dungeon floor — same Wang 4×4 format (16 frames, 16×16 each). Used in
    // CombatArenaScene to replace the colosseum look with dark stone.
    this.load.spritesheet(
      'dungeon_floor',
      'assets/sprites/tilesets/arena/arena_floor_earth.png',
      { frameWidth: 16, frameHeight: 16 },
    );
    // NPC Wanderer — generated by PixelLab, assembled by npm run sprites:assemble.
    // The NPC will not spawn until the texture is present (guarded in create()).
    this.load.aseprite(
      'npc-wanderer',
      'assets/sprites/characters/earth/npcs/npc-wanderer/npc-wanderer.png',
      'assets/sprites/characters/earth/npcs/npc-wanderer/npc-wanderer.json',
    );

    // Torch — 3-frame animated strip (48×16 total). Load as spritesheet; frame 1
    // (medium flame) is used as a static placeholder; animation added in FIL-341.
    this.load.spritesheet(
      'dungeon_torch',
      'assets/sprites/tilesets/arena/dungeon_torch.png',
      { frameWidth: 16, frameHeight: 16 },
    );

    // Biome iso tile images — loaded now so the iso floor RenderTexture can use
    // them when it is built. Each pack ships 4 tile variants (0–3).
    for (const packName of Object.values(CUSTOM_TILE_PACKS)) {
      for (let i = 0; i < 4; i++) {
        this.load.image(`${packName}-${i}`, `/assets/packs/${packName}-tiles/${i}.png`);
      }
    }
  }

  create(): void {
    // Read user volume prefs; default 0.15 so new players start quiet.
    const _mv = parseFloat(localStorage.getItem('matlu_music_vol') ?? '0.15');
    const _sv = parseFloat(localStorage.getItem('matlu_sfx_vol')   ?? '0.15');
    this.musicVol = isNaN(_mv) ? 0.15 : Phaser.Math.Clamp(_mv, 0, 1);
    this.sfxVol   = isNaN(_sv) ? 0.15 : Phaser.Math.Clamp(_sv, 0, 1);

    this.aliveEnemies    = [];
    this.projectiles     = [];
    this.waveGroupIndex  = 0;
    this.waveNumber      = 0;
    this.killCount       = 0;
    this.mainSpawnTimer  = 3000;
    this.heroAlive       = true;
    this._lastHudWave    = -1;
    this._lastHudAlive   = -1;
    this._lastHudKills   = -1;

    this.buildDungeon();

    // ── Stone shimmer filter (Phaser 4) ─────────────────────────────────────
    // Subtle UV warp + drifting warm specular on the arena floor.
    if (this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      const shimmer = new ShimmerFilter(this.cameras.main);
      this.cameras.main.filters.external.add(shimmer);
    }

    this.createAnimsFromAseprite('tinkerer');
    this.createAnimsFromAseprite('mini-velcrid');
    this.createAnimsFromAseprite('npc-wanderer');

    // Torch flicker — 3-frame loop at 6 fps (~167 ms/frame) for a slow, warm
    // candle feel. Defined once here; each torch sprite calls play('torch_flicker')
    // with a random progress offset so they don't all flash in sync.
    if (!this.anims.exists('torch_flicker')) {
      this.anims.create({
        key:       'torch_flicker',
        frames:    this.anims.generateFrameNumbers('dungeon_torch', { start: 0, end: 2 }),
        frameRate: 6,
        repeat:    -1,
      });
    }

    // Walk and idle animations must loop so the sprite never freezes mid-stride.
    // Attack / dash / death stay one-shot — their keys don't contain _walk_ or _idle_.
    const LOOP_STATES = ['idle', 'walk'];
    const SPRITE_KEYS = ['tinkerer', 'mini-velcrid', 'npc-wanderer'];
    const ANIM_DIRS   = ['south', 'south-east', 'east', 'north-east', 'north'];
    for (const sKey of SPRITE_KEYS) {
      for (const state of LOOP_STATES) {
        for (const dir of ANIM_DIRS) {
          const anim = this.anims.get(`${sKey}_${state}_${dir}`);
          if (anim) anim.repeat = -1;
        }
      }
    }

    // Audio is unavailable in headless CI (WebAudio context never starts).
    this.audioAvailable = this.cache.audio.has('sfx-gunshot');

    // Start looping combat music. The track runs for the lifetime of the scene;
    // the SHUTDOWN handler stops it so it doesn't bleed back into GameScene.
    if (this.audioAvailable && this.cache.audio.has('combat-music')) {
      this.combatMusic = this.sound.add('combat-music', { loop: true, volume: 0.4 * this.musicVol });
      this.combatMusic.play();
    }

    // Clean up combat music and any active burrow holes when leaving the arena.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.combatMusic?.stop();
      this.combatMusic = null;
      this.clearHoles();
    });

    // Projectile listener lives for the whole scene — enemies and hero both fire.
    this.events.on('projectile-spawned', (p: Projectile) => {
      this.projectiles.push(p);
    });

    // Mine detonation — brief shake proportional to the AoE damage radius.
    this.events.on('mine-detonated', () => {
      this.cameras.main.shake(120, 0.006);
    });

    // Gunshot effects — emitted by the Tinkerer in both AI and player modes.
    // Plays a metallic-crack SFX (pitched up), adds a micro camera shake for
    // recoil feel, and briefly flashes a muzzle bloom at the shot origin.
    this.events.on('hero-shot', (x: number, y: number, _angle: number) => {
      // Gunshot panic — enemies within 120 px of the shot origin scatter.
      const PANIC_R = 120;
      for (const e of this.aliveEnemies) {
        if (Phaser.Math.Distance.Between(x, y, e.x, e.y) < PANIC_R) {
          e.enterPanic(x, y);
        }
      }

      // Recoil shake: very brief + subtle, just enough to feel the gun kick.
      this.cameras.main.shake(60, 0.003);

      // Muzzle bloom: bright oval that expands and fades in ~70 ms.
      const bloom = this.add.arc(x, y, 10, 0, 360, false, 0xffffff);
      bloom.setDepth(12).setAlpha(0.85);
      this.tweens.add({
        targets: bloom,
        scaleX: 3, scaleY: 1.6,
        alpha: 0,
        duration: 70,
        ease: 'Cubic.easeOut',
        onComplete: () => bloom.destroy(),
      });

      // SFX: real 9mm crack with ±10% random pitch variation to avoid repetition fatigue.
      if (this.audioAvailable && this.cache.audio.has('sfx-gunshot')) {
        this.sound.play('sfx-gunshot', { volume: 0.5 * this.sfxVol, rate: 0.9 + Math.random() * 0.2 });
      }
    });

    // Reload SFX — Tinkerer emits 'hero-reload' the moment the last shot empties the mag.
    // Played here (scene-side) so audio logic stays out of the entity.
    this.events.on('hero-reload', () => {
      if (this.audioAvailable && this.cache.audio.has('sfx-reload')) {
        this.sound.play('sfx-reload', { volume: 0.7 * this.sfxVol });
      }
    });

    // ── Entity ambient vocalisations ──────────────────────────────────────────
    // CombatEntity emits this event on a random timer when ambientSounds is
    // configured. We handle it here so the entity never needs a sound manager.
    //
    // Volume is attenuated by distance from the camera midpoint — sounds that
    // are off-screen or near the edge of the viewport feel distant without
    // needing a full 3D audio API. MAX_AMBIENT_DIST is the radius at which the
    // sound fades to silence; within half that range it plays at full volume.
    const MAX_AMBIENT_DIST = 420; // px; tune to taste
    this.events.on(
      'entity-ambient-sound',
      (ev: { key: string; x: number; y: number; volume: number; pitchMin: number; pitchMax: number }) => {
        if (!this.audioAvailable || !this.cache.audio.has(ev.key)) return;
        const cam  = this.cameras.main;
        const camX = cam.scrollX + cam.width  / 2;
        const camY = cam.scrollY + cam.height / 2;
        const dist = Phaser.Math.Distance.Between(ev.x, ev.y, camX, camY);
        // Linear falloff: 1.0 at dist=0, 0.0 at dist=MAX_AMBIENT_DIST.
        const distFactor = Math.max(0, 1 - dist / MAX_AMBIENT_DIST);
        const vol = ev.volume * distFactor * this.sfxVol;
        if (vol < 0.01) return; // too quiet to bother playing
        const rate = ev.pitchMin + Math.random() * (ev.pitchMax - ev.pitchMin);
        this.sound.play(ev.key, { volume: vol, rate });
      },
    );

    // ── Entity combat vocalisations ───────────────────────────────────────────
    // One-shot sounds for aggro, attack, hurt, and death events.
    // Attenuated by camera distance — falls off faster than ambient chirps so
    // only on-screen combat is audible (MAX_COMBAT_DIST = 600 px).
    const MAX_COMBAT_DIST = 600;
    this.events.on(
      'entity-combat-sound',
      (ev: { key: string; x: number; y: number; volume: number; pitchMin: number; pitchMax: number }) => {
        if (!this.audioAvailable || !this.cache.audio.has(ev.key)) return;
        const cam  = this.cameras.main;
        const camX = cam.scrollX + cam.width  / 2;
        const camY = cam.scrollY + cam.height / 2;
        const dist = Phaser.Math.Distance.Between(ev.x, ev.y, camX, camY);
        const distFactor = Math.max(0, 1 - dist / MAX_COMBAT_DIST);
        const vol = ev.volume * distFactor * this.sfxVol;
        if (vol < 0.01) return;
        const rate = ev.pitchMin + Math.random() * (ev.pitchMax - ev.pitchMin);
        this.sound.play(ev.key, { volume: vol, rate });
      },
    );

    this.spawnHero();

    if (!this.bgMode) {
      // P1 keyboard input: WASD move, Space melee, F ranged, G dash.
      this.moveKeys = this.input.keyboard!.addKeys({
        up:    Phaser.Input.Keyboard.KeyCodes.W,
        down:  Phaser.Input.Keyboard.KeyCodes.S,
        left:  Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      }) as Record<string, Phaser.Input.Keyboard.Key>;
      this.meleeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      // G replaces Shift as the P1 dash key — Shift was triggering browser shortcuts.
      this.dashKey   = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G);
      this.shootKey  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
      // E deploys a proximity mine — only active after GADGET_UNLOCK_KILLS.
      this.gadgetKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);

      // Gamepad button events — fired once per press, so no per-frame debounce needed.
      // Axis reading (movement) still happens per-frame in the update methods.
      // GamepadPlugin is typed as nullable; it will be non-null because we enabled
      // `input: { gamepad: true }` in the Phaser config, but we guard anyway.
      this.input.gamepad?.on(
        'down',
        (pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
          // Read left-stick position at the moment the button fires so dash has a direction.
          const axH = pad.axes[0]?.getValue() ?? 0;
          const axV = pad.axes[1]?.getValue() ?? 0;
          const dx = Math.abs(axH) > 0.2 ? axH : 0;
          const dy = Math.abs(axV) > 0.2 ? axV : 0;

          if (pad.index === 0 && this.heroAlive && this.heroPlayerMode) {
            // P1 gamepad: button 0 = melee, button 5 = ranged, button 4 = dash, button 3 = gadget
            if (button.index === 0) this.hero.tryMelee();
            else if (button.index === 5) this.hero.tryRanged();
            else if (button.index === 4 && (dx !== 0 || dy !== 0)) this.hero.tryDash(dx, dy);
            else if (button.index === 3) {
              if (this.hero instanceof Tinkerer && this.gadgetUnlocked) this.hero.deployMine();
              else if (this.hero instanceof EarthHero) this.hero.useSignature();
            }
          }
        },
      );

      this.buildHud();
      this.launchNavPanel();
      this.buildTouchControls();
    }
  }

  /**
   * Snapshot of the current arena state — read by NavScene to attach context
   * metadata to feedback submissions without creating a circular import.
   */
  getArenaState(): { waveNumber: number; enemiesAlive: number; playerHp: number } {
    return {
      waveNumber:   this.waveNumber,
      enemiesAlive: this.aliveEnemies.length,
      playerHp:     this.heroAlive
        ? Math.round(this.hero.hpFraction * this.hero.maxHp)
        : 0,
    };
  }

  override update(_time: number, delta: number): void {
    this.blackboard.tick(delta);

    // ── Hero (P1) ─────────────────────────────────────────────────────────────
    if (this.heroAlive) {
      if (this.heroPlayerMode && !this.bgMode) {
        this.updatePlayerHeroInput(delta);
      } else {
        this.hero.update(delta);
      }
      if (!this.hero.isAlive) {
        this.heroAlive = false;
        this.mainSpawnTimer = 99999; // freeze wave spawning while hero is dead
        this.cameras.main.shake(300, 0.008);
        this.time.delayedCall(HERO_RESPAWN_MS, () => this.respawnHero());
        log.info('hero_died', { wave: this.waveNumber, kills: this.killCount, alive_enemies: this.aliveEnemies.length });
      }
    }

    // ── Camera — follow hero ──────────────────────────────────────────────────
    if (!this.bgMode && this.heroAlive) {
      this.cameras.main.centerOn(this.hero.x, this.hero.y);
    }

    // ── Hero lantern — track hero position ───────────────────────────────────
    // Phaser.GameObjects.Light is not a scene child (it doesn't have x/y
    // auto-updated), so we must sync its position manually each frame.
    if (this.heroLight && this.heroAlive) {
      this.heroLight.setPosition(this.hero.x, this.hero.y);
    }

    // ── Sight line checks (staggered) ─────────────────────────────────────────
    // Each enemy rechecks LOS every SIGHT_CHECK_INTERVAL_MS (150 ms). The index
    // argument staggers the checks across frames so not all raycasts fire at once.
    // Checks run before update() so the BT reads a fresh canSeeTarget this frame.
    const aliveCount = this.aliveEnemies.length;
    for (let i = 0; i < aliveCount; i++) {
      this.aliveEnemies[i].updateSightLine(this.obstacles, i, aliveCount);
    }

    // ── Enemies ───────────────────────────────────────────────────────────────
    for (const e of this.aliveEnemies) e.update(delta);

    // ── Projectiles ───────────────────────────────────────────────────────────
    for (const p of this.projectiles) p.tick(delta);
    this.projectiles = this.projectiles.filter(p => !p.isExpired);

    // ── Prune enemies that just died ──────────────────────────────────────────
    // Single pass: partition into alive / justDied rather than filtering twice.
    const alive: CombatEntity[]    = [];
    const justDied: CombatEntity[] = [];
    for (const e of this.aliveEnemies) {
      (e.isAlive ? alive : justDied).push(e);
    }
    if (justDied.length > 0) {
      this.aliveEnemies = alive;
      this.killCount   += justDied.length;
      for (const e of justDied) {
        // Notify ability-absorption systems (e.g. Progenitor) of the enemy type.
        this.events.emit('enemy-died', e.constructor.name);
        if (this.heroAlive) this.spawnXPMotes(e.x, e.y);

        // Death panic — survivors within 80 px scatter away from the corpse.
        const DEATH_PANIC_R = 80;
        for (const survivor of alive) {
          if (Phaser.Math.Distance.Between(e.x, e.y, survivor.x, survivor.y) < DEATH_PANIC_R) {
            survivor.enterPanic(e.x, e.y);
          }
        }
        // Safety net: onDeath() self-destructs after corpse linger + fade (~20 s max).
        this.time.delayedCall(25000, () => { if (e.active) e.destroy(); });
      }
      this.cameras.main.shake(120, 0.003);
      if (this.heroAlive) this.hero.setOpponents(this.aliveEnemies);
      this.syncEnemyCoordination();
    }

    // ── Main wave spawn timer ─────────────────────────────────────────────────
    if (this.aliveEnemies.length < MAX_ALIVE) {
      this.mainSpawnTimer -= delta;
      if (this.mainSpawnTimer <= 0) {
        this.spawnWaveGroup();
        this.mainSpawnTimer = this.nextMainInterval();
      }
    }

    // ── Gadget unlock (Tier 1 → 2 threshold) ─────────────────────────────────
    // Reaching GADGET_UNLOCK_KILLS simulates "graduating" from Tier 1 basics
    // to Tier 2 Tinkerer: the mine gadget unlocks with a brief banner flash.
    if (!this.bgMode && !this.gadgetUnlocked && this.killCount >= GADGET_UNLOCK_KILLS && this.heroAlive) {
      this.gadgetUnlocked = true;
      this.showGadgetUnlockBanner();
    }

    // ── HUD ───────────────────────────────────────────────────────────────────
    // Only call setText when the value changed — setText rebuilds the texture
    // every call, even for an identical string.
    if (!this.bgMode) {
      // HP bars — scaleX is cheap to set every frame (no texture rebuild).
      this.p1HpBarFill.scaleX = this.heroAlive ? Math.max(0, this.hero.hpFraction) : 0;
      this.p2HpBarFill.scaleX = this.hero2?.isAlive ? Math.max(0, this.hero2.hpFraction) : 0;

      if (this.waveNumber      !== this._lastHudWave)  { this.hudWave.setText(`Wave ${this.waveNumber}`);         this._lastHudWave  = this.waveNumber; }
      if (this.aliveEnemies.length !== this._lastHudAlive) { this.hudAlive.setText(`Alive: ${this.aliveEnemies.length}`); this._lastHudAlive = this.aliveEnemies.length; }
      if (this.killCount       !== this._lastHudKills) { this.hudKills.setText(`Kills: ${this.killCount}`);       this._lastHudKills = this.killCount; }

      // Gadget / signature HUD
      if (this.heroAlive) {
        if (this.hero instanceof Tinkerer && this.gadgetUnlocked) {
          if (this.hero.isGadgetReady) {
            this.hudGadget.setText('MINE [E]: ready').setColor('#ffee55');
          } else {
            const secs = (this.hero.gadgetCooldownRemaining / 1000).toFixed(1);
            this.hudGadget.setText(`MINE [E]: ${secs}s`).setColor('#aaaaaa');
          }
        } else if (this.hero instanceof EarthHero && !(this.hero instanceof Tinkerer)) {
          // Non-Tinkerer Earth heroes show their signature name; subclass owns cooldown display.
          this.hudGadget.setText(`SIG [E]: ${this.hero.name}`).setColor('#88ddff');
        }
      }
    }
  }

  // ── Arena layout ─────────────────────────────────────────────────────────────

  /**
   * Generates a BSP dungeon and sets up the camera, physics world bounds, floor
   * tiles, wall physics bodies, and decorative torch sprites.  Replaces the old
   * buildArena() + buildRooms() pair.
   *
   * ## BSP guarantee
   * Binary Space Partitioning first divides the tile grid into a tree of
   * spatial partitions, then places exactly one room per leaf.  This spreads
   * rooms evenly across the whole 60×60 tile world (960×960 px) — no voids,
   * no clusters.  Corridors are carved with the same Delaunay MST pipeline
   * as the GameScene dungeon generator.
   *
   * ## Wall physics
   * Only wall tiles that directly border floor (4-connected) receive Arcade
   * Physics StaticBody zones.  Interior wall masses (surrounded entirely by
   * other walls) are unreachable and need no collider.
   *
   * ## Camera
   * The viewport is smaller than the dungeon world, so the camera follows the
   * hero with bounds clamped to the dungeon world size.
   */
  private buildDungeon(): void {
    this.wallRects = [];

    // ── Generate BSP layout (seed is fixed for deterministic CI screenshots) ──
    const SEED = 0xdead_beef;
    const layout = bspGenerate(SEED, ARENA_BSP_CONFIG);
    this.dungeonLayout = layout;

    const CELL   = ARENA_BSP_CONFIG.cellSize;   // 16 px per tile
    const dCols  = ARENA_BSP_CONFIG.cols;
    const dRows  = ARENA_BSP_CONFIG.rows;
    const worldW = dCols * CELL;                // 960 px
    const worldH = dRows * CELL;                // 960 px

    // Set arena bounds — used by spawn fallback helpers.
    this.arenaX = 0;
    this.arenaY = 0;
    this.arenaW = worldW;
    this.arenaH = worldH;

    // ── Camera ──────────────────────────────────────────────────────────────
    this.cameras.main.setBackgroundColor(0x120d08); // deep cave black
    // DUNGEON_ZOOM 3.5 → viewport shows ≈229×171 px ≈ 14×11 tiles at once.
    // The camera bounds here are the full dungeon world; the hero-follow in
    // update() centres the viewport on the hero, clamped to these bounds.
    this.cameras.main.setZoom(DUNGEON_ZOOM);
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    // Pre-center on the entry point so bgMode (menu background) shows the
    // start room on the first frame before the hero-follow loop kicks in.
    this.cameras.main.centerOn(layout.entryPoint.x, layout.entryPoint.y);

    // ── Physics world bounds ─────────────────────────────────────────────────
    this.physics.world.setBounds(0, 0, worldW, worldH);

    // ── Static obstacle group ─────────────────────────────────────────────────
    // Wall tile bodies AND future pillar bodies share this group so all existing
    // this.physics.add.collider(entity, this.obstacles) calls cover everything.
    this.obstacles = this.physics.add.staticGroup();

    // ── Phaser Light2D pipeline ───────────────────────────────────────────────
    // Enables Phaser's built-in normal-map lighting system for this scene.
    // Without this call, setPipeline('Light2D') on tiles has no effect.
    //
    // setAmbientColor() is the base "darkness" of the scene when no light
    // source reaches a tile.  0x1e1610 is a very dark warm brown-black —
    // just enough to hint at floor texture without looking like a flat void.
    //
    // Each torch then adds a point light (addLight in createTorchGlow()) that
    // illuminates nearby tiles with a warm cone.  Tiles farther away from any
    // torch remain near-black because the point light's falloff is quadratic.
    this.lights.enable().setAmbientColor(0x1e1610);

    const { values } = layout.tiles;

    // Inline tile reader — returns 1 (wall) for out-of-bounds coordinates.
    const tv = (c: number, r: number): number => {
      if (c < 0 || r < 0 || c >= dCols || r >= dRows) return 1;
      return values[r * dCols + c] ?? 1;
    };

    // ── Tile rendering ─────────────────────────────────────────────────────────
    // Floor tiles are rendered at depth -1.  Wall edge overlay tiles sit at
    // depth 0 (above floor, below entities which start at depth 10+).
    const FRAME_CLEAN = 12; // Wang tile index 15 — all-upper (clean stone)
    const FRAME_WORN  = 6;  // Wang tile index  6 — half-worn variant

    for (let row = 0; row < dRows; row++) {
      for (let col = 0; col < dCols; col++) {
        if (tv(col, row) !== 0) continue; // wall tiles — no floor render needed

        const wx = col * CELL + CELL / 2;
        const wy = row * CELL + CELL / 2;

        // Hash-driven Wang frame picks; same formula as the old buildRooms().
        const hash  = (col * 31 + row * 17 + col * row * 7) % 100;
        const frame = hash < 12 ? FRAME_WORN : FRAME_CLEAN;
        // setLighting(true) opts this tile into Phaser 4's lighting system.
        // The renderer will modulate each tile's pixel colour by the combined
        // contribution of every active Phaser.GameObjects.Light in the scene,
        // attenuated by distance.  Tiles with no nearby light source fade to
        // the ambient colour set above.  Tiles near a torch warm up naturally.
        this.add.image(wx, wy, 'dungeon_floor', frame).setDepth(-1).setLighting(true);

      }
    }

    // ── Iso wall top faces ─────────────────────────────────────────────────────
    // Each border wall tile gets a filled iso diamond rendered in iso-space,
    // replacing the old dungeon_wall_top image tiles. One Graphics object per
    // tile so each carries its own painter-sort depth for correct occlusion
    // when entities pass in front of or behind different wall columns.
    {
      const hw = ISO_TILE_W / 2;
      const hh = ISO_TILE_H / 2;
      for (let row = 0; row < dRows; row++) {
        for (let col = 0; col < dCols; col++) {
          if (tv(col, row) !== 1) continue;
          const bordersFloor =
            tv(col - 1, row) === 0 || tv(col + 1, row) === 0 ||
            tv(col, row - 1) === 0 || tv(col, row + 1) === 0;
          if (!bordersFloor) continue;

          const { x: isoX, y: isoY } = worldToArenaIso(col * CELL, row * CELL);
          const topGfx = this.add.graphics();
          topGfx.fillStyle(0x555555);
          // Draw the diamond as an explicit path (avoids Vector2 type requirement of fillPoints).
          topGfx.beginPath();
          topGfx.moveTo(isoX,      isoY);               // N apex
          topGfx.lineTo(isoX + hw, isoY + hh);          // E
          topGfx.lineTo(isoX,      isoY + ISO_TILE_H);  // S
          topGfx.lineTo(isoX - hw, isoY + hh);          // W
          topGfx.closePath();
          topGfx.fillPath();
          topGfx.setDepth(arenaIsoDepth(col * CELL, row * CELL) + 0.5);
        }
      }
    }

    // ── Wall physics bodies ────────────────────────────────────────────────────
    // One StaticBody Zone per wall tile that directly borders floor (4-connected).
    // Interior wall tiles (surrounded entirely by other walls) are unreachable —
    // skipping them halves the body count with no gameplay difference.
    for (let row = 0; row < dRows; row++) {
      for (let col = 0; col < dCols; col++) {
        if (tv(col, row) !== 1) continue;

        const bordersFloor =
          tv(col - 1, row) === 0 || tv(col + 1, row) === 0 ||
          tv(col, row - 1) === 0 || tv(col, row + 1) === 0;
        if (!bordersFloor) continue;

        const wx = col * CELL + CELL / 2;
        const wy = row * CELL + CELL / 2;

        // Zone with a full-tile StaticBody — invisible physics blocker.
        // The Zone itself has no visual; walls appear as dark background.
        const zone = this.add.zone(wx, wy, CELL, CELL);
        this.physics.add.existing(zone, true);
        this.obstacles.add(zone);
      }
    }

    // ── Convert DungeonGen room tile-coords → pixel-space Room objects ─────────
    // this.rooms is used by spawnHero(), spawnWaveGroup(), placeBurrowHoles(), etc.
    this.rooms = layout.rooms.map(r => ({
      x: r.col * CELL,
      y: r.row * CELL,
      w: r.w   * CELL,
      h: r.h   * CELL,
    }));

    // Hero starts in the entry (largest) room — most space to orient at spawn.
    this.heroRoom = this.rooms[layout.startRoomIndex] ?? this.rooms[0] ?? null;

    // ── Torch decorations ──────────────────────────────────────────────────────
    // One flickering torch near the north wall of each of the first 6 rooms.
    // The 'torch_flicker' animation is created in create() before buildDungeon()
    // is called, so it is always available here.
    for (let i = 0; i < Math.min(6, layout.rooms.length); i++) {
      const r  = layout.rooms[i];
      const tx = r.cx * CELL;
      // Position: 1 tile below the room's north-wall row so the sprite sits on floor.
      const ty = (r.row + 1) * CELL + CELL / 2;

      this.createTorchGlow(tx, ty);

      const torchSprite = this.add.sprite(tx, ty, 'dungeon_torch').setDepth(2);
      torchSprite.play({ key: 'torch_flicker', startFrame: Math.floor(Math.random() * 3) });
    }

    // ── Ambient dust motes ─────────────────────────────────────────────────────
    // Emitted at the hero entry point so they're visible from the start.
    this.add.particles(layout.entryPoint.x, layout.entryPoint.y, 'dungeon_floor', {
      frame:        0,
      scale:        { min: 0.03, max: 0.08 },
      alpha:        { start: 0.45, end: 0 },
      speedY:       { min: -7, max: -2 },
      speedX:       { min: -4, max: 4 },
      lifespan:     4500,
      frequency:    700,
      quantity:     1,
      tint:         0xc8a87a,
      maxParticles: 8,
    }).setDepth(3);

    // ── Wall-base shadow ───────────────────────────────────────────────────────
    // Thin dark strip immediately below each room's north wall tile row adds a
    // sense of wall thickness — same technique as the old buildRooms().
    const shadowGfx = this.add.graphics().setDepth(1);
    shadowGfx.fillStyle(0x000000, 0.32);
    for (const r of this.rooms) {
      shadowGfx.fillRect(r.x, r.y + CELL, r.w, 4);
    }
  }

  /**
   * Renders the warm glow pool around a torch at world position (tx, ty).
   *
   * ## Why this looks better than a plain circle
   *
   * Real torchlight has three properties a single flat-alpha circle can't fake:
   *
   * 1. **Gradient falloff** — brightness drops sharply near the flame and fades
   *    smoothly at the edges. We simulate this with four concentric ellipses whose
   *    alpha increases toward the centre, building up additively.
   *
   * 2. **Additive blending** — `BlendModes.ADD` adds the glow's RGB to whatever
   *    is underneath rather than mixing over it with alpha.  On a dark background
   *    a small add value is nearly invisible; close to the flame the values stack
   *    up and the surface looks genuinely lit.  This is how Enter the Gungeon,
   *    Spelunky, and most modern pixel-art dungeon games handle dynamic lighting
   *    without a full shader.
   *
   * 3. **Organic flicker** — two independent tweens run at different durations
   *    (one driving alpha, one driving scale).  Because their periods are coprime
   *    they rarely peak together, producing the irregular beat pattern of real fire
   *    without any per-frame randomness.
   *
   * The ellipses are slightly wider than tall and offset 4 px upward — heat and
   * light from a flame travel upward, so the bright zone is asymmetric.
   */
  private createTorchGlow(tx: number, ty: number): void {
    // Position the Graphics object at the torch world coordinates.
    // All drawing commands below use (0, 0) as the local origin, so the object
    // can be scaled by tweens without the glow drifting away from the torch.
    const gfx = this.add.graphics({ x: tx, y: ty });
    gfx.setBlendMode(Phaser.BlendModes.ADD);
    gfx.setDepth(1);

    // The glow centre sits 4 px above the torch base — heat rises.
    const oy = -4;

    // Four rings, outer → inner.  Alphas are halved vs the pre-Light2D version
    // because the Phaser point light (below) now does the real illumination work.
    // These rings are "bloom" — they make the flame itself look bright and hot —
    // not the light that falls on the floor.  Keeping them helps the torch read
    // as a visible object; the Light2D pipeline handles the floor illumination.
    gfx.fillStyle(0xff5500, 0.03);  // outer haze  — deep amber
    gfx.fillEllipse(0, oy, 88, 60);

    gfx.fillStyle(0xff8800, 0.05);  // mid ring    — orange
    gfx.fillEllipse(0, oy, 58, 40);

    gfx.fillStyle(0xffaa00, 0.08);  // warm ring   — amber gold
    gfx.fillEllipse(0, oy, 34, 24);

    gfx.fillStyle(0xffee66, 0.12);  // inner core  — hot yellow
    gfx.fillEllipse(0, oy, 14, 10);

    // Tween 1: slow size throb (the glow "breathes" in and out).
    // Using scaleX/Y instead of redrawing the geometry each frame.
    this.tweens.add({
      targets:  gfx,
      scaleX:   { from: 0.86, to: 1.10 },
      scaleY:   { from: 0.88, to: 1.06 },
      duration: Phaser.Math.Between(300, 480),
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
      delay:    Phaser.Math.Between(0, 300),
    });

    // Tween 2: alpha flicker at a different (incommensurable) period.
    // Because the two periods don't share a common factor they rarely peak
    // together — giving the stochastic, irregular feel of real fire without
    // per-frame random() calls.
    this.tweens.add({
      targets:  gfx,
      alpha:    { from: 0.70, to: 1.0 },
      duration: Phaser.Math.Between(380, 620),
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
      delay:    Phaser.Math.Between(50, 420),
    });

    // ── Phaser Light2D point light ────────────────────────────────────────────
    // this.lights.addLight(x, y, radius, color, intensity)
    //
    // This is the "real" light that falls on floor and wall tiles.  Phaser's
    // Light2D renderer computes, per-pixel, how much each active light
    // contributes to a tile's final colour, using a simple quadratic falloff:
    //
    //   attenuation = 1 - (dist / radius)²
    //
    // Tiles outside the radius are unaffected; tiles at the centre receive
    // intensity × color.  The ambient colour (set in buildDungeon) is added on
    // top, so completely unlit tiles still show a faint warm brown rather than
    // pure black.
    //
    // radius=160: at DUNGEON_ZOOM=3.5, 160 world-px ≈ 10 tiles — illuminates
    // roughly the room the torch is in.
    // intensity=1.6: slightly above 1.0 so the centre tile is noticeably bright.
    // 0xff9933: warm amber — cooler than the bloom colour but still flame-toned.
    const pLight = this.lights.addLight(tx, ty - 4, 160, 0xff9933, 1.6);

    // Tween 3: intensity throb — the point light dims and brightens in sync with
    // the scale tween but at a slightly different duration so they stay out of
    // phase.  This makes the illumination on the floor tiles flicker visibly,
    // not just the bloom sprite above.
    this.tweens.add({
      targets:  pLight,
      intensity: { from: 1.2, to: 1.8 },
      radius:    { from: 140, to: 170 },
      duration:  Phaser.Math.Between(280, 460),
      yoyo:      true,
      repeat:    -1,
      ease:      'Sine.easeInOut',
      delay:     Phaser.Math.Between(0, 280),
    });

    // Tween 4: slower intensity drift — another incommensurable period so the
    // combined waveform of tweens 3+4 never repeats in any reasonable time.
    // Models the subtle long-period variation real fire has — a momentary lull
    // followed by a surge.
    this.tweens.add({
      targets:  pLight,
      intensity: { from: 1.0, to: 1.6 },
      duration:  Phaser.Math.Between(360, 580),
      yoyo:      true,
      repeat:    -1,
      ease:      'Sine.easeInOut',
      delay:     Phaser.Math.Between(60, 380),
    });
  }

  // ── Hero ─────────────────────────────────────────────────────────────────────

  private spawnHero(): void {
    // Use the BSP entry point (centre of the start room) so the hero always
    // spawns in the largest room.  Falls back to 20%/50% of the arena bounds
    // if dungeonLayout is somehow null (e.g. first create() hasn't run yet).
    const heroX = this.dungeonLayout?.entryPoint.x ?? this.arenaX + this.arenaW * 0.2;
    const heroY = this.dungeonLayout?.entryPoint.y ?? this.arenaY + this.arenaH * 0.5;

    // heroRoom is already set by buildDungeon() to the start room.
    // No change needed here; the field persists across respawns.

    // Instantiate the hero selected by the active tier config.
    // The switch exhausts all HeroKey values; the default arm handles 'tinkerer'
    // and any future keys added before this switch is updated.
    const hk = this.tierConfig.heroKey;
    this.hero =
      hk === 'loke'          ? new Loke(this, heroX, heroY)           :
      hk === 'ironwing'      ? new Ironwing(this, heroX, heroY)       :
      hk === 'rampart'       ? new Rampart(this, heroX, heroY)        :
      hk === 'kronos'        ? new Kronos(this, heroX, heroY)         :
      hk === 'maja-lind'     ? new MajaLind(this, heroX, heroY)       :
      hk === 'torsten-kraft' ? new TorstenKraft(this, heroX, heroY)   :
      new Tinkerer(this, heroX, heroY); // 'tinkerer' + any unknown key
    this.addPhysics(this.hero);
    this.hero.setOpponents(this.aliveEnemies);
    this.heroAlive = true;

    // ── Hero lantern light ────────────────────────────────────────────────────
    // A dim, slightly cool-white point light that travels with the hero.
    // Without this, any room the hero enters that has no nearby torch would
    // be lit only by the ambient (0x1e1610 ≈ very dark brown), making the
    // floor nearly invisible.
    //
    // The lantern is intentionally dim (intensity 0.7) and slightly blue-white
    // (0xd0e8ff) — it reads as "moonlight leaking in" or a faint magic aura,
    // not a competing warm source.  Torch rooms still look warm because the
    // torch point lights (0xff9933, intensity 1.6) dominate within their range.
    //
    // radius=96: enough to illuminate a small corridor or the immediate area
    // around the hero (~6 tiles at DUNGEON_ZOOM=3.5) without washing out the
    // torch falloff drama in larger rooms.
    if (this.heroLight) {
      // On respawn, reuse the existing Light object — just move it.
      this.heroLight.setPosition(heroX, heroY);
    } else {
      this.heroLight = this.lights.addLight(heroX, heroY, 96, 0xd0e8ff, 0.7);
    }
  }

  private respawnHero(): void {
    const FADE_MS = 600;

    // Fade out all remaining enemies, then destroy them.
    for (const e of this.aliveEnemies) {
      this.tweens.add({
        targets:  e,
        alpha:    0,
        duration: FADE_MS,
        onComplete: () => { if (e.active) e.destroy(); },
      });
    }
    this.aliveEnemies = [];

    // Clear projectiles immediately.
    for (const p of this.projectiles) { if (!p.isExpired) p.destroy(); }
    this.projectiles = [];

    // Remove the dead hero body.
    if (this.hero.active) this.hero.destroy();

    // Reset wave state so the arena restarts clean.
    this.waveGroupIndex = 0;
    this.waveNumber     = 0;
    this.killCount      = 0;
    this._lastHudWave   = -1;
    this._lastHudAlive  = -1;
    this._lastHudKills  = -1;

    // Clean up any active mines before losing the hero reference.
    // Mines are scene children (Arc GameObjects) that outlive the hero entity,
    // so they must be explicitly disposed here rather than relying on destroy().
    if (this.hero instanceof Tinkerer) this.hero.destroyMines();
    else if (this.hero instanceof TorstenKraft) this.hero.destroyMines();
    this.gadgetUnlocked = false;
    if (!this.bgMode) this.hudGadget.setText('MINE: locked').setColor('#555555');

    // Spawn the hero once the fade completes.
    this.time.delayedCall(FADE_MS, () => {
      this.spawnHero();
      this.hero.setPlayerControlled(this.heroPlayerMode);
      this.mainSpawnTimer = 3000; // restart wave timer
    });
  }

  /**
   * After any spawn or death event, re-sync every living enemy with:
   *   - the current aliveEnemies list (for separation steering), and
   *   - the shared arena blackboard (for flyer-dive staggering).
   *
  /**
   * Spawn glittery XP motes from an enemy death position toward the hero —
   * same two-phase effect as GameScene: scatter then converge and fade.
   * Hints at the hidden XP system without surfacing a number or bar.
   */
  private spawnXPMotes(sx: number, sy: number): void {
    const count = 5;
    for (let i = 0; i < count; i++) {
      const delay = i * 28;
      const ox = Phaser.Math.Between(-10, 10);
      const oy = Phaser.Math.Between(-10, 10);
      const mote = this.add.circle(sx + ox, sy + oy, 2, 0xe8f4ff, 1);
      mote.setDepth(59);
      this.tweens.add({
        delay,
        targets: mote,
        x: sx + ox * 2.2,
        y: sy + oy * 2.2,
        duration: 110,
        ease: 'Sine.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: mote,
            x: this.hero.x,
            y: this.hero.y,
            alpha: 0,
            duration: Phaser.Math.Between(360, 500),
            ease: 'Sine.easeIn',
            onComplete: () => mote.destroy(),
          });
        },
      });
    }
  }

  /**
   * Called after spawnWaveGroup, spawnBug, and every prune-dead cycle so
   * separation always reflects the current roster.
   */
  private syncEnemyCoordination(): void {
    for (const e of this.aliveEnemies) {
      e.setSwarmNeighbours(this.aliveEnemies);
      e.setBlackboard(this.blackboard);
    }
  }

  // ── BurrowHole management ─────────────────────────────────────────────────────

  /**
   * Wire a BurrowHole into the arena spawn system.
   *
   * The hole will periodically fire `'hole-spawned'` events.  This method
   * subscribes to that event and, for each spawn, adds the enemy to physics,
   * sets its opponent, and pushes it into `aliveEnemies` — honouring the
   * `MAX_ALIVE` cap (the tick is skipped, not queued, if the arena is full).
   *
   * `'hole-destroyed'` removes the hole from `activeHoles` automatically.
   */
  registerHole(hole: BurrowHole, enemyCtor: typeof BabyVelcrid | typeof VelcridJuvenile, intervalMs: number): void {
    this.activeHoles.push(hole);
    hole.startSpawning(enemyCtor, intervalMs);

    hole.on('hole-spawned', (enemy: CombatEntity) => {
      if (this.aliveEnemies.length >= MAX_ALIVE) {
        // Arena is full — skip this spawn rather than queuing; the next tick
        // will try again.
        if (enemy.active) enemy.destroy();
        return;
      }
      this.addPhysics(enemy);
      enemy.setOpponent(this.hero);
      this.aliveEnemies.push(enemy);
      if (this.heroAlive) this.hero.setOpponents(this.aliveEnemies);
      this.syncEnemyCoordination();
    });

    hole.on('hole-destroyed', () => {
      this.activeHoles = this.activeHoles.filter(h => h !== hole);
    });
  }

  /**
   * Wire a BroodMother and its four egg sacs into the arena system.
   *
   * Adds the BroodMother and each live sac to physics, `aliveEnemies`, and the
   * hero's opponent list — identical to the normal `spawnWaveGroup` pathway.
   * Also subscribes to `'broodmother-spawn-spineling'` so that each Spineling
   * spawned by a sac is immediately registered with physics and `aliveEnemies`
   * without BroodMother or EggSac needing to call `physics.add` themselves.
   *
   * Safe to call multiple times (each call sets up a fresh listener for the
   * specific BroodMother instance, but in practice only one should exist).
   */
  registerBroodMother(bm: BroodMother): void {
    // Wire the boss itself.
    this.addPhysics(bm);
    bm.setOpponent(this.hero);
    this.aliveEnemies.push(bm);

    // Wire each sac as an independent targetable entity.
    for (const sac of bm.getSacs()) {
      if (sac instanceof EggSac) {
        this.addPhysics(sac);
        sac.setOpponent(this.hero);
        this.aliveEnemies.push(sac);
        // Start the periodic Spineling spawn timer after physics is ready.
        sac.startSpawning();
      }
    }

    // Spineling spawns from sacs route through this handler — mirrors registerHole.
    this.events.on('broodmother-spawn-spineling', (spineling: CombatEntity) => {
      if (!this.heroAlive) return;
      if (this.aliveEnemies.length >= MAX_ALIVE) {
        // Arena is full — skip this spawn.
        if (spineling.active) spineling.destroy();
        return;
      }
      this.addPhysics(spineling);
      spineling.setOpponent(this.hero);
      this.aliveEnemies.push(spineling);
      if (this.heroAlive) this.hero.setOpponents(this.aliveEnemies);
      this.syncEnemyCoordination();
    });

    // GlitchDrone spawns emitted by SwarmMatrix — mirrors broodmother-spawn-spineling.
    this.events.on('spawn-glitch-drone', (x: number, y: number) => {
      if (!this.heroAlive) return;
      if (this.aliveEnemies.length >= MAX_ALIVE) return;
      const drone = new GlitchDrone(this, x, y);
      this.addPhysics(drone);
      drone.setOpponent(this.hero);
      this.aliveEnemies.push(drone);
      if (this.heroAlive) this.hero.setOpponents(this.aliveEnemies);
      this.syncEnemyCoordination();
    });

    if (this.heroAlive) this.hero.setOpponents(this.aliveEnemies);
    this.syncEnemyCoordination();
  }

  /** Destroy all active holes and clear the tracking array. */
  private clearHoles(): void {
    for (const h of this.activeHoles) {
      h.stopSpawning();
      if (h.active) h.destroy();
    }
    this.activeHoles = [];
  }

  // ── Enemy spawning ────────────────────────────────────────────────────────────

  private spawnWaveGroup(): void {
    this.waveNumber++;

    const waveGroups = this.tierConfig.waveGroups;
    const group = waveGroups[this.waveGroupIndex];
    this.waveGroupIndex = (this.waveGroupIndex + 1) % waveGroups.length;

    // Every full cycle through all groups, add one extra escalation enemy so
    // difficulty slowly climbs without new enemy types.  The escalation enemy
    // is the first enemy of the first wave group — tier-appropriate by design
    // (BabyVelcrid for T1, Blightfrog for T2, SporeDrifter for T3, etc.).
    const cycle = Math.floor((this.waveNumber - 1) / waveGroups.length);
    const ctors: EnemyCtor[] = [...group.enemies];
    const escalationCtor = waveGroups[0].enemies[0];
    for (let i = 0; i < Math.min(cycle, 3); i++) ctors.push(escalationCtor);

    // Spawn in a room other than the hero's starting room so enemies must
    // travel to reach the hero — giving the player a moment to prepare.
    // Falls back to the right-edge spawn when no other rooms are available.
    const candidateRooms = this.rooms.filter(r => r !== this.heroRoom);
    const spawnRoom = candidateRooms.length > 0
      ? candidateRooms[Math.floor(Math.random() * candidateRooms.length)]
      : null;

    const spawnPositions = spawnRoom
      ? this.spreadInRoom(spawnRoom, ctors.length)
      : this.spreadY(ctors.length).map(y => ({ x: this.arenaX + this.arenaW - SPAWN_X_OFFSET, y }));

    for (let i = 0; i < ctors.length; i++) {
      const { x: spawnX, y: spawnY } = spawnPositions[i];
      const e = new ctors[i](this, spawnX, spawnY);
      this.addPhysics(e);
      e.setOpponent(this.hero);
      this.aliveEnemies.push(e);
    }

    log.info('wave_spawned', {
      wave:        this.waveNumber,
      group_label: group.label,
      spawned:     ctors.length,
      total_alive: this.aliveEnemies.length,
      kills_so_far: this.killCount,
    });

    if (this.heroAlive) this.hero.setOpponents(this.aliveEnemies);
    this.syncEnemyCoordination();

    // Place 2–3 BurrowHoles in non-hero rooms each wave.  Old holes from the
    // previous wave are cleared first so positions rotate and timers don't stack.
    this.placeBurrowHoles(candidateRooms);
  }

  /**
   * Destroy any holes from the previous wave, then place 2–3 new BurrowHoles
   * in side rooms (never in the hero's starting room).
   *
   * Holes are snapped to room centres and registered via `registerHole()` so
   * spawned Velcrids are tracked by the existing aliveEnemies / MAX_ALIVE system.
   *
   * Clamped to the number of available non-hero rooms so small dungeon layouts
   * (fewer than 3 non-hero rooms) don't throw.
   */
  private placeBurrowHoles(candidateRooms: Room[]): void {
    this.clearHoles();

    if (candidateRooms.length === 0) return;

    // Pick 2–3 unique rooms at random; clamp to the pool size.
    const holeCount = Math.min(2 + Math.floor(Math.random() * 2), candidateRooms.length);

    // Shuffle a copy so we can just take the first `holeCount` entries.
    const shuffled = [...candidateRooms].sort(() => Math.random() - 0.5);

    for (let i = 0; i < holeCount; i++) {
      const room = shuffled[i]!;
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;

      // Guard: if the centre falls inside a wall rect, skip this room rather
      // than placing a hole inside geometry.
      const blocked = this.wallRects.some(r => r.contains(cx, cy));
      if (blocked) continue;

      const hole = new BurrowHole(this, cx, cy);
      this.registerHole(hole, BabyVelcrid, 3500);
    }

    log.info('burrow_holes_placed', {
      wave:   this.waveNumber,
      placed: this.activeHoles.length,
    });
  }

  // ── Wave timing ───────────────────────────────────────────────────────────────

  private nextMainInterval(): number {
    // Floor raised to 7500 ms (was 5000) — late waves previously spawned faster
    // than the hero could kill, causing enemies to accumulate to the MAX_ALIVE cap.
    return Math.max(7500, 10000 - this.waveNumber * 400);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────────

  private buildHud(): void {
    const base = {
      fontSize:        '13px',
      backgroundColor: '#00000077',
      padding:         { x: 6, y: 3 },
    };

    // ── P1 / P2 HP bars (FIL-245) ───────────────────────────────────────────
    // Two coloured bars pinned to screen corners so they're always readable
    // regardless of camera zoom or position.
    const BAR_W = 120;
    const BAR_H = 8;
    const BAR_Y = 14;   // bar top edge in screen pixels
    const LBL_Y = 3;    // label top edge above the bar

    // P1 — green, top-left
    this.add.text(12, LBL_Y, 'P1 HP', { fontSize: '10px', color: '#88ffaa' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.add.rectangle(12, BAR_Y, BAR_W, BAR_H, 0x1a3322)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.p1HpBarFill = this.add.rectangle(12, BAR_Y, BAR_W, BAR_H, 0x44ff88)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);

    // P2 — orange, top-right (aligned to left edge of the nav panel).
    // P2 shows 0 HP until a second player is wired in.
    const P2_X = this.scale.width - CombatArenaScene.PANEL_W - BAR_W - 12;
    this.add.text(P2_X, LBL_Y, 'P2 HP', { fontSize: '10px', color: '#ffaa88' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.add.rectangle(P2_X, BAR_Y, BAR_W, BAR_H, 0x33180a)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.p2HpBarFill = this.add.rectangle(P2_X, BAR_Y, BAR_W, BAR_H, 0xff8844)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.p2HpBarFill.scaleX = 0; // empty until hero2 exists

    // ── Status text — shifted down 20 px to sit below the HP bars ───────────
    // HUD anchored left — keeps it away from the right-side nav panel.
    this.hudWave = this.add
      .text(12, 32, 'Wave 0', { ...base, color: '#99ddff' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.hudAlive = this.add
      .text(12, 52, 'Alive: 0', { ...base, color: '#aaffaa' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.hudKills = this.add
      .text(12, 72, 'Kills: 0', { ...base, color: '#ffcc88' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);

    // Mine gadget — locked until GADGET_UNLOCK_KILLS, then shows cooldown status.
    this.hudGadget = this.add
      .text(12, 92, 'MINE: locked', { ...base, color: '#555555' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);

    this.buildZoomSlider();
  }

  /**
   * Zoom slider — lets you dial in the right DUNGEON_ZOOM value live without
   * restarting. Drag the handle or click anywhere on the track.
   * All coordinates are in screen space (scrollFactor 0), so they stay fixed
   * regardless of where the camera is pointing.
   */
  /**
   * Flash a centred banner when the mine gadget unlocks at GADGET_UNLOCK_KILLS.
   *
   * This is the Tier 1 → Tier 2 progression moment: the player has proven they
   * can survive the basics and now gains their first active gadget. The banner
   * fades automatically so it doesn't obstruct gameplay for long.
   */
  private showGadgetUnlockBanner(): void {
    const cx = this.scale.width  / 2;
    const cy = this.scale.height / 2 - 30;

    const banner = this.add
      .text(cx, cy, 'GADGET UNLOCKED\nPress E to deploy a proximity mine', {
        fontSize:        '13px',
        color:           '#ffee55',
        backgroundColor: '#00000099',
        padding:         { x: 14, y: 10 },
        align:           'center',
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(20);

    this.tweens.add({
      targets:  banner,
      alpha:    0,
      delay:    2400,
      duration: 700,
      ease:     'Linear',
      onComplete: () => { if (banner.active) banner.destroy(); },
    });
  }

  private buildZoomSlider(): void {
    const SX       = 12;    // track left edge (screen x)
    const SY       = 108;   // track centre (screen y) — shifted +20 to sit below MINE text
    const SW       = 110;   // track width
    const MIN_ZOOM = 1.0;
    const MAX_ZOOM = 6.0;

    // Track bar
    const gfx = this.add.graphics().setScrollFactor(0).setDepth(2);
    gfx.fillStyle(0x334433, 0.8);
    gfx.fillRect(SX, SY - 3, SW, 6);

    // "ZOOM" label
    this.add.text(SX, SY - 14, 'ZOOM', { fontSize: '10px', color: '#7799aa' })
      .setScrollFactor(0).setDepth(2).setOrigin(0, 0);

    // Live value label to the right of the track
    const zoomLabel = this.add.text(SX + SW + 6, SY, `${DUNGEON_ZOOM.toFixed(1)}×`, {
      fontSize: '12px', color: '#aaccbb',
    }).setScrollFactor(0).setDepth(2).setOrigin(0, 0.5);

    // Draggable handle — starts at the initial DUNGEON_ZOOM position
    const initT  = (DUNGEON_ZOOM - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
    const handle = this.add
      .rectangle(SX + initT * SW, SY, 10, 18, 0x77bbaa)
      .setScrollFactor(0).setDepth(3).setOrigin(0.5, 0.5)
      .setInteractive();

    // Apply a zoom value given a raw screen-x pointer position.
    const applyZoom = (screenX: number): void => {
      const t    = Phaser.Math.Clamp((screenX - SX) / SW, 0, 1);
      const zoom = MIN_ZOOM + t * (MAX_ZOOM - MIN_ZOOM);
      handle.x   = SX + t * SW;
      this.cameras.main.setZoom(zoom);
      zoomLabel.setText(`${zoom.toFixed(1)}×`);
    };

    // Dragging — track whether the handle is being held
    let dragging = false;
    handle.on('pointerdown', () => { dragging = true; });

    // Clicking the track bar jumps directly to that position
    const trackHit = this.add
      .zone(SX, SY - 9, SW, 18)
      .setScrollFactor(0).setDepth(2).setOrigin(0, 0)
      .setInteractive();
    trackHit.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      dragging = true;
      applyZoom(ptr.x);
    });

    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (dragging) applyZoom(ptr.x);
    });
    this.input.on('pointerup', () => { dragging = false; });

    // Clean up listeners when the scene shuts down
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointermove');
      this.input.off('pointerup');
    });
  }

  // ── Nav panel (NavScene overlay) ─────────────────────────────────────────────

  /**
   * Launch NavScene as a persistent overlay. NavScene renders in its own camera
   * (no zoom) and communicates back via game.events.
   */
  private launchNavPanel(): void {
    if (!this.scene.isActive(NavScene.KEY)) {
      // Pass mode as init data so NavScene shows the correct button on its very
      // first frame — avoids a race where game.events.emit() fires before
      // NavScene's create() has registered the nav-mode-change listener.
      this.scene.launch(NavScene.KEY, { mode: 'arena' });
    } else {
      // NavScene already running (e.g. switched back from wilderview) — update live.
      this.game.events.emit('nav-mode-change', 'arena');
    }

    // NavScene button → goto wilderview. skipAttract suppresses the overlay/name-entry screen.
    this.game.events.on('nav-goto-wilderview', () => {
      this.scene.stop(NavScene.KEY);
      this.scene.start('GameScene', { skipAttract: true });
    }, this);

    // NavScene button → toggle play mode.
    this.game.events.on('nav-toggle-play-mode', () => {
      this.toggleHeroPlayerMode();
    }, this);

    // NavScene button → reset arena.
    this.game.events.on('nav-reset-arena', () => {
      this.resetArena();
    }, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('nav-goto-wilderview', undefined, this);
      this.game.events.off('nav-toggle-play-mode', undefined, this);
      this.game.events.off('nav-reset-arena', undefined, this);
    });
  }

  // ── Player mode ───────────────────────────────────────────────────────────────

  toggleHeroPlayerMode(): void {
    this.heroPlayerMode = !this.heroPlayerMode;
    this.hero.setPlayerControlled(this.heroPlayerMode);
    this.game.events.emit('nav-play-mode-changed', this.heroPlayerMode);
  }

  /**
   * Drive the Tinkerer directly from keyboard input.
   * Called every frame instead of hero.update() when heroPlayerMode is true.
   */
  private updatePlayerHeroInput(delta: number): void {
    // Movement — WASD keyboard
    const right = this.moveKeys['right'].isDown ? 1 : 0;
    const left  = this.moveKeys['left'].isDown  ? 1 : 0;
    const down  = this.moveKeys['down'].isDown  ? 1 : 0;
    const up    = this.moveKeys['up'].isDown    ? 1 : 0;

    let dx = right - left;
    let dy = down  - up;

    // Gamepad 1 (index 0) — left stick overrides keyboard for movement when outside
    // the deadzone. Button presses (melee/ranged/dash) are handled via the 'down'
    // event registered in create() so they fire exactly once per press.
    const pad1 = this.input.gamepad?.getPad(0);
    if (pad1) {
      const ax = pad1.axes[0]?.getValue() ?? 0;
      const ay = pad1.axes[1]?.getValue() ?? 0;
      if (Math.abs(ax) > 0.2 || Math.abs(ay) > 0.2) {
        dx = ax;
        dy = ay;
      }
    }

    // Virtual joystick — overrides keyboard/gamepad when active on touch devices.
    if (this.joystick && this.joystick.force > 10) {
      dx = Math.cos(this.joystick.rotation);
      dy = Math.sin(this.joystick.rotation);
    }

    const spd = 160; // px/s — comfortable player speed
    // StaticGhost applies controlsInverted — negate axes for the duration.
    const inv = this.hero.controlsInverted ? -1 : 1;
    this.hero.setMoveVelocity(dx * spd * inv, dy * spd * inv);

    // Melee — Space (just-pressed) or touch button
    if (Phaser.Input.Keyboard.JustDown(this.meleeKey) || this.touchMelee) {
      this.touchMelee = false;
      this.hero.tryMelee();
    }

    // Ranged — F (just-pressed) or touch button
    if (Phaser.Input.Keyboard.JustDown(this.shootKey) || this.touchRanged) {
      this.touchRanged = false;
      this.hero.tryRanged();
    }

    // Dash — G (just-pressed) or touch button; direction required
    if ((Phaser.Input.Keyboard.JustDown(this.dashKey) || this.touchDash) && (dx !== 0 || dy !== 0)) {
      this.touchDash = false;
      this.hero.tryDash(dx, dy);
    }

    // Signature / gadget — E (just-pressed).
    // Tinkerer: deploy proximity mine (gated by kill count unlock).
    // Other EarthHero subclasses: fire signature (no kill-count gate; subclass guards its own cooldown).
    if (Phaser.Input.Keyboard.JustDown(this.gadgetKey)) {
      if (this.hero instanceof Tinkerer && this.gadgetUnlocked) {
        this.hero.deployMine();
      } else if (this.hero instanceof EarthHero) {
        this.hero.useSignature();
      }
    }

    // Let the entity tick its animation + dash physics + HP bar.
    this.hero.update(delta);
  }

  /**
   * Creates the virtual joystick and action buttons for touch devices.
   * Hidden on non-touch devices (mouse/keyboard only).
   *
   * Layout:
   *   Left  side — movement joystick (bottom-left)
   *   Right side — action buttons in an arc: melee (largest), ranged, dash
   */
  private buildTouchControls(): void {
    if (navigator.maxTouchPoints === 0) return;

    const W = this.scale.width;
    const H = this.scale.height;
    const DEPTH = 9999;

    // ── Movement joystick (bottom-left) ──────────────────────────────────────
    const JOY_X = 120;
    const JOY_Y = H - 120;
    const JOY_R = 50;

    const joyBase  = this.add.circle(JOY_X, JOY_Y, JOY_R, 0x444444, 0.45).setScrollFactor(0).setDepth(DEPTH);
    const joyThumb = this.add.circle(JOY_X, JOY_Y, 22,    0xcccccc, 0.60).setScrollFactor(0).setDepth(DEPTH);
    this.joystick = new SimpleJoystick(this, JOY_X, JOY_Y, JOY_R, joyThumb);
    void joyBase; // referenced only for rendering

    // ── Action buttons (bottom-right) ────────────────────────────────────────
    // Three circular touch zones — pointerdown sets the flag consumed by
    // updatePlayerHeroInput() on the next frame.
    const makeBtn = (
      x: number, y: number, r: number, color: number, label: string,
      onTap: () => void,
    ) => {
      const circle = this.add.circle(x, y, r, color, 0.50).setScrollFactor(0).setDepth(DEPTH).setInteractive();
      this.add.text(x, y, label, {
        fontFamily: 'monospace', fontSize: '13px', color: '#ffffff',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH + 1).setAlpha(0.85);

      circle.on('pointerdown', () => { onTap(); });
      return circle;
    };

    // Melee — large button, bottom-right
    makeBtn(W - 90,  H - 90,  44, 0xee4444, 'ATK',  () => { this.touchMelee  = true; });
    // Ranged — above-left of melee
    makeBtn(W - 175, H - 110, 34, 0x4488ee, 'SHOT', () => { this.touchRanged = true; });
    // Dash  — above melee
    makeBtn(W - 100, H - 185, 30, 0xeeaa22, 'DASH', () => { this.touchDash   = true; });

    // Allow multi-touch so joystick + buttons work simultaneously.
    this.input.addPointer(2);
  }

  /**
   * Clear all enemies and projectiles, respawn the hero at default position,
   * and reset wave counters — useful as a quick restart for player-mode testing.
   */
  resetArena(): void {
    // Destroy all live enemies
    for (const e of this.aliveEnemies) { if (e.active) e.destroy(); }
    this.aliveEnemies = [];
    // Destroy any active burrow holes and cancel their spawn timers.
    this.clearHoles();
    // Destroy all projectiles
    for (const p of this.projectiles) { if (!p.isExpired) p.destroy(); }
    this.projectiles = [];

    // Reset wave counters
    this.waveGroupIndex = 0;
    this.waveNumber     = 0;
    this.killCount      = 0;
    this.mainSpawnTimer = 3000;
    this._lastHudWave   = -1;
    this._lastHudAlive  = -1;
    this._lastHudKills  = -1;

    // Clean up mines and reset gadget state before respawning.
    if (this.hero instanceof Tinkerer) this.hero.destroyMines();
    else if (this.hero instanceof TorstenKraft) this.hero.destroyMines();
    this.gadgetUnlocked = false;
    if (!this.bgMode) this.hudGadget.setText('MINE: locked').setColor('#555555');

    // Respawn P1
    if (this.hero.active) this.hero.destroy();
    this.spawnHero();
    this.hero.setPlayerControlled(this.heroPlayerMode);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Creates Phaser animations from an Aseprite-format JSON that was loaded via
   * this.load.aseprite(). Phaser 4's built-in createFromAseprite() references
   * frames by numeric index string ("0", "1", …), but our custom assembler
   * names frames descriptively ("idle_south_0", "idle_south_1", …). This
   * helper reads the same cache.json entry but uses each frame's filename
   * value so the animation frame keys match the atlas texture frame keys.
   *
   * Always removes and recreates each animation so these filename-based frames
   * override any numeric-index animations that Phaser 4 may have auto-created
   * when the aseprite file loaded (fixes FIL-423).
   */
  private createAnimsFromAseprite(key: string): void {
    type AseFrame = { filename: string; duration?: number };
    type AseTag   = { name: string; from: number; to: number; direction: string };
    const data = this.cache.json.get(key) as {
      frames: AseFrame[];
      meta:   { frameTags: AseTag[] };
    } | null;

    if (!data?.frames || !data.meta?.frameTags) {
      console.warn(`createAnimsFromAseprite: no data for key "${key}"`);
      return;
    }

    for (const tag of data.meta.frameTags) {
      const animFrames: { key: string; frame: string; duration: number }[] = [];
      let totalDuration = 0;
      for (let i = tag.from; i <= tag.to; i++) {
        const f = data.frames[i];
        if (!f) continue;
        const dur = f.duration ?? 100;
        animFrames.push({ key, frame: f.filename, duration: dur });
        totalDuration += dur;
      }
      if (tag.direction === 'reverse') animFrames.reverse();
      // Remove before create — ensures our filename-based refs win over any
      // Phaser 4 auto-registered numeric-index animations for the same key.
      if (this.anims.exists(tag.name)) this.anims.remove(tag.name);
      this.anims.create({
        key:      tag.name,
        frames:   animFrames,
        duration: totalDuration,
        yoyo:     tag.direction === 'pingpong',
      });
    }
  }

  private addPhysics(entity: CombatEntity): void {
    this.physics.add.existing(entity);
    const body = entity.body as Phaser.Physics.Arcade.Body;
    // Explicit 16×16 hitbox centered on the entity origin.
    // Without this, Phaser sizes the body from the Container's bounding box,
    // which includes the HP bar sitting ~30 px above the sprite — making the
    // body off-center and taller than intended.  A fixed body ensures every
    // entity type gets a consistent, centered hitbox that matches the derivation
    // in WALL_INSET (body half = 8).
    body.setSize(16, 16);
    body.setOffset(-8, -8);
    body.setCollideWorldBounds(true);
    this.physics.add.collider(entity, this.obstacles);
    // Give the entity the obstacle AABBs so its BT can call hasLineOfSight().
    entity.setWallRects(this.wallRects);
  }

  /**
   * Procedurally places 4–8 rooms inside the arena and renders their floors
   * with colosseum_floor tiles.  Consecutive rooms are connected by L-shaped
   * corridors (horizontal leg first, then vertical).
   *
   * Rooms are visual-only — no physics walls are added.  Entities move freely
   * across the full arena; the floor tiles only define the visible footprint.
   * Called once from buildArena(); the result is stored on this.rooms.
   */
  /**
   * Distributes `count` spawn positions evenly inside a room, keeping a 20%
   * margin from each edge so entities don't clip wall visuals on spawn.
   * Alternates slight X offsets so multiple entities don't stack on the same pixel.
   */
  private spreadInRoom(room: Room, count: number): { x: number; y: number }[] {
    const cx      = room.x + room.w / 2;
    const marginY = room.h * 0.2;
    const y0      = room.y + marginY;
    const y1      = room.y + room.h - marginY;
    if (count === 1) return [{ x: cx, y: (y0 + y1) / 2 }];
    const step = (y1 - y0) / (count - 1);
    return Array.from({ length: count }, (_, i) => ({
      x: cx + (i % 2 === 0 ? -room.w * 0.1 : room.w * 0.1),
      y: y0 + i * step,
    }));
  }

  private spreadY(count: number): number[] {
    const mid = this.arenaY + this.arenaH / 2;
    if (count === 1) return [mid];
    const margin = this.arenaH * 0.15;
    const step   = (this.arenaH - margin * 2) / (count - 1);
    return Array.from({ length: count }, (_, i) => this.arenaY + margin + i * step);
  }
}
