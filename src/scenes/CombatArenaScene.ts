import * as Phaser from 'phaser';
import { log } from '../lib/logger';
import { NavScene } from './NavScene';
import {
  CombatEntity,
  Tinkerer,
} from '../entities/CombatEntity';
import { Projectile } from '../entities/Projectile';
import { ArenaBlackboard } from '../ai/ArenaBlackboard';
import { ShimmerFilter }   from '../shaders/ShimmerFilter';
import { BabyVelcrid, VelcridJuvenile } from '../entities/Velcrid';

// ── Wave group definitions ────────────────────────────────────────────────────

type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number) => CombatEntity;

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
const HERO_RESPAWN_MS = 2000; // ms before Tinkerer respawns after death

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

  private waveGroupIndex = 0;
  private waveNumber     = 0;
  private killCount      = 0;

  private mainSpawnTimer = 3000;  // first group fires after 3 s

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

  private hudWave!:  Phaser.GameObjects.Text;
  private hudAlive!: Phaser.GameObjects.Text;
  private hudKills!: Phaser.GameObjects.Text;

  // ── Player control ──────────────────────────────────────────────────────────
  /** When true the player drives the hero with WASD/arrows + attack keys. */
  private heroPlayerMode = false;
  private moveKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private meleeKey!:  Phaser.Input.Keyboard.Key;
  /** P1 dash — G key (replaces Shift). */
  private dashKey!:   Phaser.Input.Keyboard.Key;
  private shootKey!:  Phaser.Input.Keyboard.Key;

  // ── P2 player control ────────────────────────────────────────────────────────
  /** P2 Tinkerer — always player-controlled, never AI. Null in bgMode. */
  private hero2: CombatEntity | null = null;
  private hero2Alive = false;
  private p2MoveKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private p2MeleeKey!: Phaser.Input.Keyboard.Key;
  /** P2 dash — L key. */
  private p2DashKey!: Phaser.Input.Keyboard.Key;
  private p2ShootKey!: Phaser.Input.Keyboard.Key;

  // ── Audio ───────────────────────────────────────────────────────────────────
  private audioAvailable = false;
  /** Round-robins through 3 gunshot variants to avoid repetition fatigue. */
  private gunshotIndex   = 0;

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
    // Gunshot SFX — impactMetal_heavy pitched up gives a snappy, metallic crack.
    // Three variants (000–002) are cycled on each shot to avoid repetition fatigue.
    const ksfx = 'assets/audio/kenney_impact-sounds/Audio';
    for (let i = 0; i < 3; i++) {
      this.load.audio(`gunshot-${i}`, `${ksfx}/impactMetal_heavy_00${i}.ogg`);
    }

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
    this.hero2           = null;
    this.hero2Alive      = false;
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

    this.anims.createFromAseprite('tinkerer');
    this.anims.createFromAseprite('mini-velcrid');

    // Audio is unavailable in headless CI (WebAudio context never starts).
    this.audioAvailable = this.cache.audio.has('gunshot-0');

    // Projectile listener lives for the whole scene — enemies and hero both fire.
    this.events.on('projectile-spawned', (p: Projectile) => {
      this.projectiles.push(p);
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

      // SFX: cycle through 3 variants, play at 2× rate for a sharp crack.
      if (this.audioAvailable) {
        const key = `gunshot-${this.gunshotIndex}`;
        this.gunshotIndex = (this.gunshotIndex + 1) % 3;
        if (this.cache.audio.has(key)) {
          this.sound.play(key, { volume: 0.55, rate: 2.2 });
        }
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
      this.dashKey  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G);
      this.shootKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);

      // P2 keyboard input: Arrow keys move, J melee, K ranged, L dash.
      this.p2MoveKeys = this.input.keyboard!.addKeys({
        up:    Phaser.Input.Keyboard.KeyCodes.UP,
        down:  Phaser.Input.Keyboard.KeyCodes.DOWN,
        left:  Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      }) as Record<string, Phaser.Input.Keyboard.Key>;
      this.p2MeleeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.J);
      this.p2ShootKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.K);
      this.p2DashKey  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.L);

      // Spawn P2 immediately — P2 is always player-controlled, never AI.
      this.spawnHero2();

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
            // P1 gamepad: button 0 = melee, button 5 = ranged, button 4 = dash
            if (button.index === 0) this.hero.tryMelee();
            else if (button.index === 5) this.hero.tryRanged();
            else if (button.index === 4 && (dx !== 0 || dy !== 0)) this.hero.tryDash(dx, dy);
          } else if (pad.index === 1 && this.hero2 && this.hero2Alive) {
            // P2 gamepad: same layout — button 0 = melee, button 5 = ranged, button 4 = dash
            if (button.index === 0) this.hero2.tryMelee();
            else if (button.index === 5) this.hero2.tryRanged();
            else if (button.index === 4 && (dx !== 0 || dy !== 0)) this.hero2.tryDash(dx, dy);
          }
        },
      );

      this.buildHud();
      this.launchNavPanel();
    }
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
        this.cameras.main.shake(300, 0.008);
        this.time.delayedCall(HERO_RESPAWN_MS, () => this.respawnHero());
        log.info('hero_died', { wave: this.waveNumber, kills: this.killCount, alive_enemies: this.aliveEnemies.length });
      }
    }

    // ── Hero 2 (P2 — always player-controlled) ────────────────────────────────
    if (!this.bgMode && this.hero2 && this.hero2Alive) {
      this.updateP2Input(delta);
      if (!this.hero2.isAlive) {
        this.hero2Alive = false;
        this.time.delayedCall(HERO_RESPAWN_MS, () => this.respawnHero2());
      }
    }

    // ── Camera — follow midpoint of live heroes ───────────────────────────────
    // Both players can wander the arena, so we keep them both centred in view.
    if (!this.bgMode) {
      const pts: { x: number; y: number }[] = [];
      if (this.heroAlive) pts.push(this.hero);
      if (this.hero2 && this.hero2Alive) pts.push(this.hero2);
      if (pts.length > 0) {
        const midX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const midY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        this.cameras.main.centerOn(midX, midY);
      }
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
      if (this.hero2 && this.hero2Alive) this.hero2.setOpponents(this.aliveEnemies);
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

    // ── HUD ───────────────────────────────────────────────────────────────────
    // Only call setText when the value changed — setText rebuilds the texture
    // every call, even for an identical string.
    if (!this.bgMode) {
      if (this.waveNumber      !== this._lastHudWave)  { this.hudWave.setText(`Wave ${this.waveNumber}`);         this._lastHudWave  = this.waveNumber; }
      if (this.aliveEnemies.length !== this._lastHudAlive) { this.hudAlive.setText(`Alive: ${this.aliveEnemies.length}`); this._lastHudAlive = this.aliveEnemies.length; }
      if (this.killCount       !== this._lastHudKills) { this.hudKills.setText(`Kills: ${this.killCount}`);       this._lastHudKills = this.killCount; }
    }
  }

  // ── Arena layout ─────────────────────────────────────────────────────────────

  private buildArena(): void {
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
    this.cameras.main.centerOn(cx, cy);

    const WALL_T  = 22;
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

    // ── Tiled colosseum floor ─────────────────────────────────────────────────
    // Wang tileset: frame 12 = pale travertine, frame 6 = dark worn stone.
    // Tiles inside the four chamfered corner zones are skipped — the wall fill
    // covers that area. Tiles near pillar bases have a higher worn probability,
    // suggesting battle damage around the obstacles.
    const TILE        = 16;
    const FRAME_CLEAN = 12;
    const FRAME_WORN  = 6;

    const cols = Math.ceil(this.arenaW / TILE);
    const rows = Math.ceil(this.arenaH / TILE);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const wx = this.arenaX + col * TILE + TILE / 2;
        const wy = this.arenaY + row * TILE + TILE / 2;
        // Skip tiles that fall inside the chamfered corner zones
        const nearL = wx < this.arenaX + CHAMFER;
        const nearR = wx > this.arenaX + this.arenaW - CHAMFER;
        const nearT = wy < this.arenaY + CHAMFER;
        const nearB = wy > this.arenaY + this.arenaH - CHAMFER;
        if ((nearL && nearT) || (nearR && nearT) || (nearL && nearB) || (nearR && nearB)) continue;

        const hash = (col * 31 + row * 17 + col * row * 7) % 100;
        let wornThreshold = 12; // base 12% worn
        for (const [px, py] of pillarDefs) {
          const d = Math.hypot(wx - px, wy - py);
          if      (d < 36) wornThreshold += 45;
          else if (d < 64) wornThreshold += 20;
        }
        const frame = hash < wornThreshold ? FRAME_WORN : FRAME_CLEAN;
        this.add.image(wx, wy, 'colosseum_floor', frame).setDepth(-1);
      }
    }

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
      (zone.body as Phaser.Physics.Arcade.StaticBody).setSize(PILLAR_W - 4, PILLAR_FH - 4);
      this.obstacles.add(zone);
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

    // ── Physics world bounds ──────────────────────────────────────────────────
    this.physics.world.setBounds(
      this.arenaX + WALL_T, this.arenaY + WALL_T,
      this.arenaW - WALL_T * 2, this.arenaH - WALL_T * 2,
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
    const heroX = this.arenaX + this.arenaW * 0.2;
    const heroY = this.arenaY + this.arenaH * 0.5;
    this.hero = new Tinkerer(this, heroX, heroY);
    this.addPhysics(this.hero);
    this.hero.setOpponents(this.aliveEnemies);
    this.heroAlive = true;
  }

  private respawnHero(): void {
    for (const p of this.projectiles) { if (!p.isExpired) p.destroy(); }
    this.projectiles = [];
    if (this.hero.active) this.hero.destroy();
    this.spawnHero();
    for (const e of this.aliveEnemies) e.setOpponent(this.hero);
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

    const spawnX = this.arenaX + this.arenaW - SPAWN_X_OFFSET;
    const ys     = this.spreadY(ctors.length);

    for (let i = 0; i < ctors.length; i++) {
      const e = new ctors[i](this, spawnX, ys[i]);
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
    if (this.hero2 && this.hero2Alive) this.hero2.setOpponents(this.aliveEnemies);
    this.syncEnemyCoordination();
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

    // NavScene button → goto wilderview.
    this.game.events.on('nav-goto-wilderview', () => {
      this.scene.stop(NavScene.KEY);
      this.scene.start('GameScene');
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

    // Let the entity tick its animation + dash physics + HP bar.
    this.hero.update(delta);
  }

  // ── P2 spawn / input ──────────────────────────────────────────────────────────

  private spawnHero2(): void {
    // Place P2 near P1's start but offset downward so they don't overlap.
    const heroX = this.arenaX + this.arenaW * 0.2;
    const heroY = this.arenaY + this.arenaH * 0.6;
    this.hero2 = new Tinkerer(this, heroX, heroY);
    this.addPhysics(this.hero2);
    this.hero2.setOpponents(this.aliveEnemies);
    // P2 is always player-controlled — the behaviour tree never runs for this entity.
    this.hero2.setPlayerControlled(true);
    this.hero2Alive = true;
  }

  private respawnHero2(): void {
    if (this.hero2?.active) this.hero2.destroy();
    this.spawnHero2();
  }

  /**
   * Drive the P2 Tinkerer from keyboard (Arrow keys / J / K / L) or Gamepad 2
   * (index 1). Called every frame in non-background mode alongside P1 input.
   *
   * Key bindings:
   *   Move  — Arrow keys  |  left stick
   *   Melee — J           |  button 0 (A / Cross)
   *   Ranged— K           |  button 5 (RB / R1)
   *   Dash  — L           |  button 4 (LB / L1)
   */
  private updateP2Input(delta: number): void {
    if (!this.hero2) return;

    // Keyboard movement — Arrow keys
    const right = this.p2MoveKeys['right'].isDown ? 1 : 0;
    const left  = this.p2MoveKeys['left'].isDown  ? 1 : 0;
    const down  = this.p2MoveKeys['down'].isDown  ? 1 : 0;
    const up    = this.p2MoveKeys['up'].isDown    ? 1 : 0;

    let dx = right - left;
    let dy = down  - up;

    // Gamepad 2 (index 1) — left stick overrides keyboard for movement.
    // Button presses (melee/ranged/dash) are handled via the 'down' event in create().
    const pad2 = this.input.gamepad?.getPad(1);
    if (pad2) {
      const ax = pad2.axes[0]?.getValue() ?? 0;
      const ay = pad2.axes[1]?.getValue() ?? 0;
      if (Math.abs(ax) > 0.2 || Math.abs(ay) > 0.2) {
        dx = ax;
        dy = ay;
      }
    }

    const spd = 160;
    this.hero2.setMoveVelocity(dx * spd, dy * spd);

    // Melee — J (just-pressed)
    if (Phaser.Input.Keyboard.JustDown(this.p2MeleeKey)) {
      this.hero2.tryMelee();
    }

    // Ranged — K (just-pressed)
    if (Phaser.Input.Keyboard.JustDown(this.p2ShootKey)) {
      this.hero2.tryRanged();
    }

    // Dash — L (just-pressed); direction required
    if (Phaser.Input.Keyboard.JustDown(this.p2DashKey) && (dx !== 0 || dy !== 0)) {
      this.hero2.tryDash(dx, dy);
    }

    // Tick animation, dash physics, and HP bar.
    this.hero2.update(delta);
  }

  /**
   * Clear all enemies and projectiles, respawn the hero at default position,
   * and reset wave counters — useful as a quick restart for player-mode testing.
   */
  resetArena(): void {
    // Destroy all live enemies
    for (const e of this.aliveEnemies) { if (e.active) e.destroy(); }
    this.aliveEnemies = [];
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

    // Respawn P1
    if (this.hero.active) this.hero.destroy();
    this.spawnHero();
    this.hero.setPlayerControlled(this.heroPlayerMode);

    // Respawn P2
    if (this.hero2?.active) this.hero2.destroy();
    this.hero2 = null;
    this.hero2Alive = false;
    this.spawnHero2();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private addPhysics(entity: CombatEntity): void {
    this.physics.add.existing(entity);
    (entity.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
    this.physics.add.collider(entity, this.obstacles);
  }

  private spreadY(count: number): number[] {
    const mid = this.arenaY + this.arenaH / 2;
    if (count === 1) return [mid];
    const margin = this.arenaH * 0.15;
    const step   = (this.arenaH - margin * 2) / (count - 1);
    return Array.from({ length: count }, (_, i) => this.arenaY + margin + i * step);
  }
}
