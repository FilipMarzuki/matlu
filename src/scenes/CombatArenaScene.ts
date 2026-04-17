import * as Phaser from 'phaser';
import { log } from '../lib/logger';
import { NavScene } from './NavScene';
import { CombatEntity } from '../entities/CombatEntity';
import { Tinkerer } from '../entities/Tinkerer';
import { Projectile } from '../entities/Projectile';
import { ArenaBlackboard } from '../ai/ArenaBlackboard';
import { ShimmerFilter }   from '../shaders/ShimmerFilter';
import { BabyVelcrid, VelcridJuvenile } from '../entities/Velcrid';
import { BurrowHole } from '../entities/BurrowHole';
import { BroodMother, EggSac } from '../entities/BroodMother';

// ── Wave group definitions ────────────────────────────────────────────────────

type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number) => CombatEntity;

/** Axis-aligned bounding box for a procedurally-placed dungeon room. */
interface Room {
  x: number;  // left edge
  y: number;  // top edge
  w: number;  // width
  h: number;  // height
}

interface WaveGroup {
  label:   string;
  enemies: EnemyCtor[];
}

/**
 * M1 enemy roster: BabyVelcrid (fast small rushers) + VelcridJuvenile (orbiting hoppers).
 * Groups cycle indefinitely; difficulty scales via the wave number multiplier in spawnWaveGroup.
 */
const WAVE_GROUPS: WaveGroup[] = [
  { label: 'Baby Swarm',   enemies: [BabyVelcrid, BabyVelcrid, BabyVelcrid] },
  { label: 'Scout Pair',   enemies: [VelcridJuvenile, VelcridJuvenile] },
  { label: 'Mixed Pack',   enemies: [VelcridJuvenile, BabyVelcrid, BabyVelcrid] },
  { label: 'Baby Horde',   enemies: [BabyVelcrid, BabyVelcrid, BabyVelcrid, BabyVelcrid] },
  { label: 'Reaver Squad', enemies: [VelcridJuvenile, VelcridJuvenile, BabyVelcrid] },
];

// ── Constants ─────────────────────────────────────────────────────────────────

const SPAWN_X_OFFSET  = 80;   // px from arena right edge
const MAX_ALIVE       = 20;   // total alive enemy cap
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
   * obstacle (stone pillars). Populated by buildArena() and passed to every
   * entity via addPhysics() so their BT can call hasLineOfSight().
   */
  private wallRects: Phaser.Geom.Rectangle[] = [];
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

  // HUD cache — setText() rebuilds the text texture on every call even when the
  // value hasn't changed, so only call it when the value actually differs.
  private _lastHudWave  = -1;
  private _lastHudAlive = -1;
  private _lastHudKills = -1;

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

  // ── Audio ───────────────────────────────────────────────────────────────────
  private audioAvailable = false;
  // gunshotIndex removed — single real 9mm sample with random pitch variation.
  /** Looping combat/dungeon music track. Null until create() confirms audio is available. */
  private combatMusic: Phaser.Sound.BaseSound | null = null;

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

  init(data?: { background?: boolean }): void {
    this.bgMode = data?.background ?? false;
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

    this.load.aseprite(
      'tinkerer',
      'assets/sprites/characters/earth/heroes/tinkerer/tinkerer.png',
      'assets/sprites/characters/earth/heroes/tinkerer/tinkerer.json',
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
  }

  create(): void {
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

    this.buildArena();

    // ── Stone shimmer filter (Phaser 4) ─────────────────────────────────────
    // Subtle UV warp + drifting warm specular on the arena floor.
    if (this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      const shimmer = new ShimmerFilter(this.cameras.main);
      this.cameras.main.filters.external.add(shimmer);
    }

    this.createAnimsFromAseprite('tinkerer');
    this.createAnimsFromAseprite('mini-velcrid');

    // Walk and idle animations must loop so the sprite never freezes mid-stride.
    // Attack / dash / death stay one-shot — their keys don't contain _walk_ or _idle_.
    const LOOP_STATES = ['idle', 'walk'];
    const SPRITE_KEYS = ['tinkerer', 'mini-velcrid'];
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
      this.combatMusic = this.sound.add('combat-music', { loop: true, volume: 0.4 });
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
        this.sound.play('sfx-gunshot', { volume: 0.5, rate: 0.9 + Math.random() * 0.2 });
      }
    });

    // Reload SFX — Tinkerer emits 'hero-reload' the moment the last shot empties the mag.
    // Played here (scene-side) so audio logic stays out of the entity.
    this.events.on('hero-reload', () => {
      if (this.audioAvailable && this.cache.audio.has('sfx-reload')) {
        this.sound.play('sfx-reload', { volume: 0.7 });
      }
    });

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
            else if (button.index === 3 && this.gadgetUnlocked) (this.hero as Tinkerer).deployMine();
          }
        },
      );

      this.buildHud();
      this.launchNavPanel();
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

        // Death panic — survivors within 80 px scatter away from the corpse.
        const DEATH_PANIC_R = 80;
        for (const survivor of alive) {
          if (Phaser.Math.Distance.Between(e.x, e.y, survivor.x, survivor.y) < DEATH_PANIC_R) {
            survivor.enterPanic(e.x, e.y);
          }
        }
        this.time.delayedCall(1500, () => { if (e.active) e.destroy(); });
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
      if (this.waveNumber      !== this._lastHudWave)  { this.hudWave.setText(`Wave ${this.waveNumber}`);         this._lastHudWave  = this.waveNumber; }
      if (this.aliveEnemies.length !== this._lastHudAlive) { this.hudAlive.setText(`Alive: ${this.aliveEnemies.length}`); this._lastHudAlive = this.aliveEnemies.length; }
      if (this.killCount       !== this._lastHudKills) { this.hudKills.setText(`Kills: ${this.killCount}`);       this._lastHudKills = this.killCount; }

      // Gadget HUD — updates every frame while unlocked (cooldown is a live countdown)
      if (this.gadgetUnlocked && this.heroAlive) {
        const tinkerer = this.hero as Tinkerer;
        if (tinkerer.isGadgetReady) {
          this.hudGadget.setText('MINE [E]: ready').setColor('#ffee55');
        } else {
          const secs = (tinkerer.gadgetCooldownRemaining / 1000).toFixed(1);
          this.hudGadget.setText(`MINE [E]: ${secs}s`).setColor('#aaaaaa');
        }
      }
    }
  }

  // ── Arena layout ─────────────────────────────────────────────────────────────

  private buildArena(): void {
    // Reset so a scene restart doesn't accumulate duplicate rects.
    this.wallRects = [];

    const W      = this.scale.width;
    const H      = this.scale.height;
    const margin = 60;
    // Reserve space for the right-side nav panel so the arena never goes behind it.
    const rightEdge = this.bgMode ? W - margin : W - CombatArenaScene.PANEL_W - margin;

    this.arenaX = margin;
    this.arenaY = margin;
    this.arenaW = rightEdge - margin;
    this.arenaH = H - margin * 2;
    const cx = this.arenaX + this.arenaW / 2;
    const cy = this.arenaY + this.arenaH / 2;

    this.cameras.main.setBackgroundColor(0x120d08);
    // Zoom in tighter than the overworld (3×) so the dungeon feels claustrophobic.
    // NavScene owns its own camera, so it is unaffected by this zoom.
    this.cameras.main.setZoom(DUNGEON_ZOOM);
    this.cameras.main.centerOn(cx, cy);

    const WALL_T  = 22;
    // WALL_INSET: how far to push the physics world bounds from the arena edge.
    // Derivation: body-half (8) + sprite-half-max (24 for 48×48 Tinkerer) + clearance (8) = 40.
    // Round up to WALL_T + 24 = 46 so the inset also exceeds the CHAMFER (42), making the
    // corner-triangle zone bodies unreachable — world bounds stop entities at 46 px from the
    // edge, well inside the 42 px diagonal cut.
    //   Entity visual left edge min = (arenaX + 46 + 8) − 24 = arenaX + 30 > arenaX + 22 (wall face). ✓
    const WALL_INSET = WALL_T + 24;  // 46 px total
    // CHAMFER: how many pixels the octagonal corners cut inward.
    const CHAMFER = 42;

    // Stone palette matching the floor tileset's warm travertine tones
    const STONE_MID   = 0x9a7a58;
    const STONE_LIGHT = 0xb8956e;
    const STONE_DARK  = 0x6a5038;
    const MORTAR_C    = 0x3a2818;

    // ── Pillar positions (early — floor loop references them) ─────────────────
    // Asymmetric placement: symmetric pairs feel staged; these feel like
    // surviving ruins from a once-larger structure.
    const pillarDefs: [number, number][] = [
      [cx - 125, cy - 22],
      [cx + 98,  cy + 38],
    ];

    // ── Procedural room layout ────────────────────────────────────────────────
    // Rooms are placed and tiled inside buildRooms(). The returned array is
    // stored on this.rooms so spawnHero() and spawnWaveGroup() can position
    // entities inside rooms rather than at fixed arena coordinates.
    this.rooms = this.buildRooms();

    // ── Stone pillar obstacles ────────────────────────────────────────────────
    // Broken columns in 3/4 top-down perspective: a lighter top face (visible
    // from above) sits over a darker front face (camera-facing side), with a
    // cast shadow ellipse at the base.
    this.obstacles = this.physics.add.staticGroup();

    const PILLAR_W  = 28; // visual width
    const PILLAR_FH = 22; // front face height (camera-facing)
    const PILLAR_TH = 10; // top face height (foreshortened in 3/4 view)

    for (const [px, py] of pillarDefs) {
      const pg = this.add.graphics();

      // Cast shadow
      pg.fillStyle(0x000000, 0.28);
      pg.fillEllipse(px + 5, py + PILLAR_FH / 2 + 5, PILLAR_W + 14, 9);

      // Front face — darker, camera-facing stone
      pg.fillStyle(STONE_DARK, 1);
      pg.fillRect(px - PILLAR_W / 2, py - PILLAR_FH / 2, PILLAR_W, PILLAR_FH);

      // Top face — lighter, angled away from camera
      pg.fillStyle(STONE_LIGHT, 1);
      pg.fillRect(px - PILLAR_W / 2, py - PILLAR_FH / 2 - PILLAR_TH, PILLAR_W, PILLAR_TH);

      // Left highlight — ambient light catch
      pg.fillStyle(0xc8a880, 1);
      pg.fillRect(px - PILLAR_W / 2, py - PILLAR_FH / 2 - PILLAR_TH, 3, PILLAR_FH + PILLAR_TH);

      // Right shadow — self-shadow
      pg.fillStyle(0x3a2414, 1);
      pg.fillRect(px + PILLAR_W / 2 - 3, py - PILLAR_FH / 2, 3, PILLAR_FH);

      // Mortar lines on front face
      pg.lineStyle(1, MORTAR_C, 0.7);
      for (let i = 1; i < 3; i++) {
        const ly = py - PILLAR_FH / 2 + (PILLAR_FH / 3) * i;
        pg.lineBetween(px - PILLAR_W / 2, ly, px + PILLAR_W / 2, ly);
      }
      pg.lineBetween(px - PILLAR_W / 2, py - PILLAR_FH / 2, px + PILLAR_W / 2, py - PILLAR_FH / 2);

      // Y-sort: depth = bottom of front face so the pillar occludes entities
      // correctly — they walk behind the upper part, in front of the base.
      pg.setDepth(py + PILLAR_FH / 2);

      // Static physics body covering the pillar footprint
      const zone = this.add.zone(px, py, PILLAR_W + 4, PILLAR_FH);
      this.physics.add.existing(zone, true);
      const bodyW = PILLAR_W - 4;
      const bodyH = PILLAR_FH - 4;
      (zone.body as Phaser.Physics.Arcade.StaticBody).setSize(bodyW, bodyH);
      this.obstacles.add(zone);

      // Register this pillar as a line-of-sight blocker.
      // Uses the same AABB as the physics body (centred at px, py) so LOS
      // is blocked by exactly the same region that blocks physical passage.
      this.wallRects.push(new Phaser.Geom.Rectangle(
        px - bodyW / 2, py - bodyH / 2, bodyW, bodyH,
      ));
    }

    // ── Octagonal wall border ─────────────────────────────────────────────────
    // Wall drawn as 8 filled sections: 4 straight strips + 4 bevelled corner
    // triangles. 3/4 perspective hints: top wall is thinner (lit top-face),
    // bottom wall has an extra dark strip simulating visible front-face height.
    const gfx = this.add.graphics();

    const ashlarH = (bx: number, by: number, w: number, h: number, offset: number): void => {
      const BRICK_W = 38;
      let x = bx; let idx = offset;
      while (x < bx + w) {
        const bw = Math.min(BRICK_W, bx + w - x);
        gfx.fillStyle(idx % 2 === 0 ? STONE_MID : STONE_LIGHT, 1);
        gfx.fillRect(x + 1, by + 1, bw - 2, h - 2);
        gfx.lineStyle(1, MORTAR_C, 1);
        gfx.strokeRect(x, by, bw, h);
        x += bw; idx++;
      }
    };

    const ashlarV = (bx: number, by: number, w: number, h: number, offset: number): void => {
      const BRICK_H = 38;
      let y = by; let idx = offset;
      while (y < by + h) {
        const bh = Math.min(BRICK_H, by + h - y);
        gfx.fillStyle(idx % 2 === 0 ? STONE_MID : STONE_LIGHT, 1);
        gfx.fillRect(bx + 1, y + 1, w - 2, bh - 2);
        gfx.lineStyle(1, MORTAR_C, 1);
        gfx.strokeRect(bx, y, w, bh);
        y += bh; idx++;
      }
    };

    // Top wall — lit from above, no front-face depth needed
    gfx.fillStyle(STONE_LIGHT, 1);
    gfx.fillRect(this.arenaX + CHAMFER, this.arenaY, this.arenaW - CHAMFER * 2, WALL_T);
    ashlarH(this.arenaX + CHAMFER, this.arenaY + 2, this.arenaW - CHAMFER * 2, WALL_T - 2, 0);
    gfx.fillStyle(STONE_DARK, 0.45);
    gfx.fillRect(this.arenaX + CHAMFER, this.arenaY + WALL_T - 3, this.arenaW - CHAMFER * 2, 3);

    // Bottom wall — extra dark strip at top implies visible wall height in 3/4
    const BOT_EXTRA = 8;
    gfx.fillStyle(STONE_DARK, 1);
    gfx.fillRect(this.arenaX + CHAMFER, this.arenaY + this.arenaH - WALL_T - BOT_EXTRA, this.arenaW - CHAMFER * 2, BOT_EXTRA);
    ashlarH(this.arenaX + CHAMFER, this.arenaY + this.arenaH - WALL_T, this.arenaW - CHAMFER * 2, WALL_T, 1);
    gfx.fillStyle(MORTAR_C, 0.8);
    gfx.fillRect(this.arenaX + CHAMFER, this.arenaY + this.arenaH - 2, this.arenaW - CHAMFER * 2, 2);

    // Left wall
    ashlarV(this.arenaX, this.arenaY + CHAMFER, WALL_T, this.arenaH - CHAMFER * 2, 0);
    gfx.fillStyle(STONE_LIGHT, 0.5);
    gfx.fillRect(this.arenaX, this.arenaY + CHAMFER, WALL_T, 2);

    // Right wall with gate opening
    const GATE_HALF = 34;
    const gateTop   = cy - GATE_HALF;
    const gateBot   = cy + GATE_HALF;
    ashlarV(this.arenaX + this.arenaW - WALL_T, this.arenaY + CHAMFER, WALL_T, gateTop - this.arenaY - CHAMFER, 1);
    ashlarV(this.arenaX + this.arenaW - WALL_T, gateBot, WALL_T, this.arenaY + this.arenaH - CHAMFER - gateBot, 0);
    gfx.fillStyle(0x0a0604, 1);
    gfx.fillRect(this.arenaX + this.arenaW - WALL_T - 3, gateTop, WALL_T + 5, GATE_HALF * 2);
    gfx.fillStyle(STONE_LIGHT, 1);
    gfx.fillRect(this.arenaX + this.arenaW - WALL_T, gateTop, WALL_T, 7);
    gfx.fillRect(this.arenaX + this.arenaW - WALL_T, gateBot - 7, WALL_T, 7);

    // Chamfered corner fills — triangles bridging the wall strips
    gfx.fillStyle(STONE_MID, 1);
    const ax = this.arenaX, ay = this.arenaY, aw = this.arenaW, ah = this.arenaH;
    gfx.fillTriangle(ax,      ay,      ax + CHAMFER,      ay,      ax,           ay + CHAMFER);
    gfx.fillTriangle(ax + aw, ay,      ax + aw - CHAMFER, ay,      ax + aw,      ay + CHAMFER);
    gfx.fillTriangle(ax,      ay + ah, ax + CHAMFER,      ay + ah, ax,           ay + ah - CHAMFER);
    gfx.fillTriangle(ax + aw, ay + ah, ax + aw - CHAMFER, ay + ah, ax + aw,      ay + ah - CHAMFER);
    // Mortar seam along each diagonal cut
    gfx.lineStyle(2, MORTAR_C, 0.9);
    gfx.lineBetween(ax + CHAMFER,      ay,           ax,           ay + CHAMFER);
    gfx.lineBetween(ax + aw - CHAMFER, ay,           ax + aw,      ay + CHAMFER);
    gfx.lineBetween(ax,                ay + ah - CHAMFER, ax + CHAMFER,      ay + ah);
    gfx.lineBetween(ax + aw,           ay + ah - CHAMFER, ax + aw - CHAMFER, ay + ah);

    // ── Chamfered corner physics bodies ──────────────────────────────────────
    // World bounds (below) cover the four straight wall strips as a rectangle,
    // but the four diagonal corner triangles sit *inside* that rectangle.
    // Without extra colliders, entities can be pushed into the visual corners.
    // Each Zone body is a CHAMFER×CHAMFER rectangle — a conservative bounding
    // box over the corner triangle. Minor overshoot into open floor is
    // imperceptible. The same StaticGroup (this.obstacles) is used for pillar
    // bodies, so existing per-entity colliders cover these automatically.
    const addCornerZone = (cx: number, cy: number): void => {
      const zone = this.add.zone(cx, cy, CHAMFER, CHAMFER);
      this.physics.add.existing(zone, true);
      this.obstacles.add(zone);
    };
    addCornerZone(ax + CHAMFER / 2,      ay + CHAMFER / 2);      // top-left
    addCornerZone(ax + aw - CHAMFER / 2, ay + CHAMFER / 2);      // top-right
    addCornerZone(ax + CHAMFER / 2,      ay + ah - CHAMFER / 2); // bottom-left
    addCornerZone(ax + aw - CHAMFER / 2, ay + ah - CHAMFER / 2); // bottom-right

    // ── Physics world bounds ──────────────────────────────────────────────────
    // WALL_INSET (not WALL_T) so entity visuals never overlap the wall graphic.
    // See the WALL_INSET constant above for the derivation.
    this.physics.world.setBounds(
      this.arenaX + WALL_INSET, this.arenaY + WALL_INSET,
      this.arenaW - WALL_INSET * 2, this.arenaH - WALL_INSET * 2,
    );

    // ── Torch glow pools ──────────────────────────────────────────────────────
    const torchPositions: [number, number][] = [
      [this.arenaX + CHAMFER + 26,               this.arenaY + CHAMFER + 20               ],
      [this.arenaX + this.arenaW - CHAMFER - 26, this.arenaY + CHAMFER + 20               ],
      [this.arenaX + CHAMFER + 26,               this.arenaY + this.arenaH - CHAMFER - 20 ],
      [this.arenaX + this.arenaW - CHAMFER - 26, this.arenaY + this.arenaH - CHAMFER - 20 ],
    ];
    for (const [tx, ty] of torchPositions) {
      const glowGfx = this.add.graphics();
      glowGfx.fillStyle(0xff9933, 0.18);
      glowGfx.fillCircle(tx, ty, 40);
      this.tweens.add({
        targets:  glowGfx,
        alpha:    { from: 0.7, to: 1.0 },
        duration: Phaser.Math.Between(400, 700),
        yoyo:     true,
        repeat:   -1,
        ease:     'Sine.easeInOut',
        delay:    Phaser.Math.Between(0, 350),
      });
    }

    // ── Floor cracks from pillar bases ────────────────────────────────────────
    const crackGfx = this.add.graphics();
    for (const [px, py] of pillarDefs) {
      crackGfx.lineStyle(1, STONE_DARK, 0.18);
      for (let i = 0; i < 4; i++) {
        const angle = ((px * 3 + py * 7 + i * 73) % 628) / 100;
        const len   = 28 + (i * 11) % 18;
        crackGfx.lineBetween(px, py, px + Math.cos(angle) * len, py + Math.sin(angle) * len);
        crackGfx.lineBetween(
          px + Math.cos(angle) * len * 0.5, py + Math.sin(angle) * len * 0.5,
          px + Math.cos(angle + 0.5) * len * 0.35, py + Math.sin(angle + 0.5) * len * 0.35,
        );
      }
    }
    crackGfx.setDepth(-0.5);
  }

  // ── Hero ─────────────────────────────────────────────────────────────────────

  private spawnHero(): void {
    // Spawn inside the largest room so the hero starts with the most manoeuvring
    // space.  Falls back to the 20 % / 50 % arena position if no rooms exist.
    const largestRoom = this.rooms.length > 0
      ? this.rooms.reduce((best, r) => r.w * r.h > best.w * best.h ? r : best)
      : null;

    const heroX = largestRoom ? largestRoom.x + largestRoom.w / 2 : this.arenaX + this.arenaW * 0.2;
    const heroY = largestRoom ? largestRoom.y + largestRoom.h / 2 : this.arenaY + this.arenaH * 0.5;

    // Track which room the hero starts in — enemies are kept out of this room
    // at wave boundaries so there's always some travel time before they arrive.
    this.heroRoom = largestRoom;

    this.hero = new Tinkerer(this, heroX, heroY);
    this.addPhysics(this.hero);
    this.hero.setOpponents(this.aliveEnemies);
    this.heroAlive = true;
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
    (this.hero as Tinkerer).destroyMines();
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

    const group = WAVE_GROUPS[this.waveGroupIndex];
    this.waveGroupIndex = (this.waveGroupIndex + 1) % WAVE_GROUPS.length;

    // Every full cycle through all groups, add one extra BabyVelcrid so difficulty
    // slowly escalates without requiring new enemy types.
    const cycle  = Math.floor((this.waveNumber - 1) / WAVE_GROUPS.length);
    const ctors: EnemyCtor[] = [...group.enemies];
    for (let i = 0; i < Math.min(cycle, 3); i++) ctors.push(BabyVelcrid);

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
    return Math.max(5000, 10000 - this.waveNumber * 400);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────────

  private buildHud(): void {
    const base = {
      fontSize:        '13px',
      backgroundColor: '#00000077',
      padding:         { x: 6, y: 3 },
    };
    // HUD anchored left — keeps it away from the right-side nav panel.
    this.hudWave = this.add
      .text(12, 12, 'Wave 0', { ...base, color: '#99ddff' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.hudAlive = this.add
      .text(12, 32, 'Alive: 0', { ...base, color: '#aaffaa' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.hudKills = this.add
      .text(12, 52, 'Kills: 0', { ...base, color: '#ffcc88' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);

    // Mine gadget — locked until GADGET_UNLOCK_KILLS, then shows cooldown status.
    this.hudGadget = this.add
      .text(12, 72, 'MINE: locked', { ...base, color: '#555555' })
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
    const SY       = 88;    // track centre (screen y)
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

    const spd = 160; // px/s — comfortable player speed
    this.hero.setMoveVelocity(dx * spd, dy * spd);

    // Melee — Space (just-pressed, no auto-repeat)
    if (Phaser.Input.Keyboard.JustDown(this.meleeKey)) {
      this.hero.tryMelee();
    }

    // Ranged — F (just-pressed)
    if (Phaser.Input.Keyboard.JustDown(this.shootKey)) {
      this.hero.tryRanged();
    }

    // Dash — G (just-pressed); direction required
    if (Phaser.Input.Keyboard.JustDown(this.dashKey) && (dx !== 0 || dy !== 0)) {
      this.hero.tryDash(dx, dy);
    }

    // Mine gadget — E (just-pressed; only active after GADGET_UNLOCK_KILLS)
    if (this.gadgetUnlocked && Phaser.Input.Keyboard.JustDown(this.gadgetKey)) {
      (this.hero as Tinkerer).deployMine();
    }

    // Let the entity tick its animation + dash physics + HP bar.
    this.hero.update(delta);
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
    (this.hero as Tinkerer).destroyMines();
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
  private buildRooms(): Room[] {
    const WALL_T      = 22;   // mirrors buildArena — rooms must stay inside the border
    const TILE        = 16;
    const FRAME_CLEAN = 12;
    const FRAME_WORN  = 6;
    const CORRIDOR_W  = 32;   // corridor strip width in px
    const PAD         = 10;   // minimum gap between room edges
    const MIN_W = 80;  const MAX_W = 200;
    const MIN_H = 70;  const MAX_H = 150;
    const TARGET    = 6;   // aim for this many rooms
    const MAX_TRIES = 24;  // rejection-sampling attempts

    // Arena interior — rooms must fit within the wall border.
    const innerX = this.arenaX + WALL_T;
    const innerY = this.arenaY + WALL_T;
    const innerW = this.arenaW - WALL_T * 2;
    const innerH = this.arenaH - WALL_T * 2;

    const rooms: Room[] = [];

    // Rejection-sample random rooms; keep candidates that don't overlap existing ones.
    for (let t = 0; t < MAX_TRIES && rooms.length < TARGET; t++) {
      const rw = MIN_W + Math.floor(Math.random() * (MAX_W - MIN_W + 1));
      const rh = MIN_H + Math.floor(Math.random() * (MAX_H - MIN_H + 1));
      const rx = innerX + Math.floor(Math.random() * Math.max(1, innerW - rw));
      const ry = innerY + Math.floor(Math.random() * Math.max(1, innerH - rh));
      const candidate: Room = { x: rx, y: ry, w: rw, h: rh };

      const overlaps = rooms.some(r =>
        candidate.x < r.x + r.w + PAD &&
        candidate.x + candidate.w + PAD > r.x &&
        candidate.y < r.y + r.h + PAD &&
        candidate.y + candidate.h + PAD > r.y,
      );
      if (!overlaps) rooms.push(candidate);
    }

    // Safety net: if sampling didn't produce enough rooms, fall back to a 2×2 grid.
    if (rooms.length < 4) {
      const hw = Math.floor(innerW / 2 - PAD);
      const hh = Math.floor(innerH / 2 - PAD);
      rooms.length = 0;  // discard partial results so the grid is clean
      rooms.push(
        { x: innerX,              y: innerY,              w: hw, h: hh },
        { x: innerX + hw + PAD,   y: innerY,              w: hw, h: hh },
        { x: innerX,              y: innerY + hh + PAD,   w: hw, h: hh },
        { x: innerX + hw + PAD,   y: innerY + hh + PAD,   w: hw, h: hh },
      );
    }

    // Tile a rectangle of floor, clipped to the arena interior.
    const tileRect = (x: number, y: number, w: number, h: number): void => {
      const x1 = Math.max(innerX, x);
      const y1 = Math.max(innerY, y);
      const x2 = Math.min(innerX + innerW, x + w);
      const y2 = Math.min(innerY + innerH, y + h);
      if (x2 <= x1 || y2 <= y1) return;
      const cols = Math.ceil((x2 - x1) / TILE);
      const rows = Math.ceil((y2 - y1) / TILE);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const wx = x1 + col * TILE + TILE / 2;
          const wy = y1 + row * TILE + TILE / 2;
          if (wx > x2 || wy > y2) continue;
          const hash  = (col * 31 + row * 17 + col * row * 7) % 100;
          const frame = hash < 12 ? FRAME_WORN : FRAME_CLEAN;
          this.add.image(wx, wy, 'colosseum_floor', frame).setDepth(-1);
        }
      }
    };

    // Tile each room's floor.
    for (const room of rooms) tileRect(room.x, room.y, room.w, room.h);

    // Connect consecutive rooms with L-shaped corridors (horizontal leg first,
    // then vertical at the elbow). This guarantees at least one path between
    // every adjacent pair in the list.
    for (let i = 1; i < rooms.length; i++) {
      const a    = rooms[i - 1];
      const b    = rooms[i];
      const ax   = Math.round(a.x + a.w / 2);
      const ay   = Math.round(a.y + a.h / 2);
      const bx   = Math.round(b.x + b.w / 2);
      const by   = Math.round(b.y + b.h / 2);
      const half = Math.round(CORRIDOR_W / 2);

      // Horizontal leg: room-a centre → room-b centre X, at room-a centre Y.
      tileRect(Math.min(ax, bx), ay - half, Math.abs(bx - ax), CORRIDOR_W);
      // Vertical leg: elbow (bx, ay) → room-b centre Y.
      tileRect(bx - half, Math.min(ay, by), CORRIDOR_W, Math.abs(by - ay));
    }

    return rooms;
  }

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
