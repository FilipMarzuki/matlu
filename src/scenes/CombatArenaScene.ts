import Phaser from 'phaser';
import { NavScene } from './NavScene';
import {
  CombatEntity,
  Tinkerer,
  SporeHusk,
  AcidLancer,
  BruteCarapace,
  ParasiteFlyer,
  WarriorBug,
} from '../entities/CombatEntity';
import { Projectile } from '../entities/Projectile';
import { ArenaBlackboard } from '../ai/ArenaBlackboard';
import { ShimmerPostFX }   from '../shaders/ShimmerPostFX';

// ── Wave group definitions ────────────────────────────────────────────────────

type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number) => CombatEntity;

interface WaveGroup {
  label:   string;
  enemies: EnemyCtor[];
}

/**
 * Ordered groups that cycle indefinitely.
 * Each full cycle adds extra SporeHusk padding so difficulty scales.
 *
 * Main spawn fires the next group every 10→5 s (shrinks each wave).
 * Trickle WarriorBugs start at wave 2.
 */
const WAVE_GROUPS: WaveGroup[] = [
  { label: 'Husk Scout',      enemies: [SporeHusk, SporeHusk, SporeHusk] },
  { label: 'Lancer Advance',  enemies: [SporeHusk, SporeHusk, AcidLancer] },
  { label: 'Brute Emergence', enemies: [BruteCarapace, SporeHusk] },
  { label: 'Flyer Strike',    enemies: [ParasiteFlyer, ParasiteFlyer, AcidLancer] },
  { label: 'Bio Surge',       enemies: [BruteCarapace, ParasiteFlyer, SporeHusk] },
  { label: 'Horde',           enemies: [BruteCarapace, BruteCarapace, AcidLancer, ParasiteFlyer] },
];

// ── Constants ─────────────────────────────────────────────────────────────────

const SPAWN_X_OFFSET  = 80;   // px from arena right edge
const SPAWN_MARGIN_Y  = 80;   // min px from arena top/bottom for spawns
const MAX_ALIVE       = 20;   // total alive enemy cap
const MAX_ALIVE_BUGS  = 8;    // separate cap for WarriorBugs
const HERO_RESPAWN_MS = 2000; // ms before Tinkerer respawns after death

// ── Scene ─────────────────────────────────────────────────────────────────────

/**
 * CombatArenaScene — continuous bio-wave combat sandbox.
 *
 * The Tinkerer fights an endless escalating stream of spinolandet enemies:
 *   - Main timer:    fires a WaveGroup every 10→5 s (speeds up each wave).
 *   - Trickle timer: drops 1–2 WarriorBugs every 1.5→0.9 s from wave 2 onward.
 *   - Enemies accumulate — no reset between waves.
 *   - Tinkerer respawns at full HP after HERO_RESPAWN_MS if killed.
 *
 * Dev menu at the bottom bar switches to GameScene (WilderView).
 */
export class CombatArenaScene extends Phaser.Scene {
  static readonly KEY = 'CombatArenaScene';

  private hero!:         CombatEntity;
  private heroAlive    = true;
  private aliveEnemies: CombatEntity[] = [];
  private projectiles:  Projectile[]   = [];
  private readonly blackboard = new ArenaBlackboard();

  private waveGroupIndex = 0;
  private waveNumber     = 0;
  private killCount      = 0;

  private mainSpawnTimer = 3000;  // first group fires after 3 s
  private trickleTimer   = 0;
  private trickleActive  = false;

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
  private meleeKey!: Phaser.Input.Keyboard.Key;
  private dashKey!:  Phaser.Input.Keyboard.Key;

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
    this.load.aseprite(
      'tinkerer',
      'assets/sprites/characters/earth/heroes/tinkerer/tinkerer.png',
      'assets/sprites/characters/earth/heroes/tinkerer/tinkerer.json',
    );
    // Spider/skag/crow are used as tinted placeholders for the spinolandet enemies
    // until dedicated sprites are generated.
    this.load.aseprite(
      'spider',
      'assets/sprites/characters/earth/enemies/spider/spider.png',
      'assets/sprites/characters/earth/enemies/spider/spider.json',
    );
    this.load.aseprite(
      'skag',
      'assets/sprites/characters/earth/enemies/skag/skag.png',
      'assets/sprites/characters/earth/enemies/skag/skag.json',
    );
    this.load.aseprite(
      'crow',
      'assets/sprites/characters/earth/enemies/crow/crow.png',
      'assets/sprites/characters/earth/enemies/crow/crow.json',
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
    this.trickleTimer    = 0;
    this.trickleActive   = false;
    this.heroAlive       = true;

    this.buildArena();

    // ── Stone shimmer post-FX ─────────────────────────────────────────────────
    // Registers and applies a custom WebGL PostFX pipeline that makes the arena
    // floor feel like real polished stone — subtle UV warp + drifting specular.
    // Guard: PostFX pipelines require WebGL; falls back gracefully on Canvas.
    if (this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      this.renderer.pipelines.addPostPipeline('ShimmerFX', ShimmerPostFX);
      this.cameras.main.setPostPipeline('ShimmerFX');
    }

    this.anims.createFromAseprite('tinkerer');
    this.anims.createFromAseprite('spider');
    this.anims.createFromAseprite('skag');
    this.anims.createFromAseprite('crow');

    // Projectile listener lives for the whole scene — enemies and hero both fire.
    this.events.on('projectile-spawned', (p: Projectile) => {
      this.projectiles.push(p);
    });

    this.spawnHero();

    if (!this.bgMode) {
      // Keyboard input for player-control mode.
      this.moveKeys = this.input.keyboard!.addKeys({
        up:    Phaser.Input.Keyboard.KeyCodes.W,
        down:  Phaser.Input.Keyboard.KeyCodes.S,
        left:  Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      }) as Record<string, Phaser.Input.Keyboard.Key>;
      this.meleeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.dashKey  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

      this.buildHud();
      this.launchNavPanel();
    }
  }

  override update(_time: number, delta: number): void {
    this.blackboard.tick(delta);

    // ── Hero ──────────────────────────────────────────────────────────────────
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
      }
    }

    // ── Enemies ───────────────────────────────────────────────────────────────
    for (const e of this.aliveEnemies) e.update(delta);

    // ── Projectiles ───────────────────────────────────────────────────────────
    for (const p of this.projectiles) p.tick(delta);
    this.projectiles = this.projectiles.filter(p => !p.isExpired);

    // ── Prune enemies that just died ──────────────────────────────────────────
    const justDied = this.aliveEnemies.filter(e => !e.isAlive);
    if (justDied.length > 0) {
      this.aliveEnemies = this.aliveEnemies.filter(e => e.isAlive);
      this.killCount += justDied.length;
      this.cameras.main.shake(120, 0.003);
      for (const e of justDied) {
        this.time.delayedCall(1500, () => { if (e.active) e.destroy(); });
      }
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

    // ── Trickle spawn timer ───────────────────────────────────────────────────
    if (this.trickleActive) {
      const bugCount = this.aliveEnemies.filter(e => e instanceof WarriorBug).length;
      if (bugCount < MAX_ALIVE_BUGS && this.aliveEnemies.length < MAX_ALIVE) {
        this.trickleTimer -= delta;
        if (this.trickleTimer <= 0) {
          this.spawnBug();
          this.trickleTimer = this.nextTrickleInterval();
        }
      }
    }

    // ── HUD ───────────────────────────────────────────────────────────────────
    if (!this.bgMode) {
      this.hudWave.setText(`Wave ${this.waveNumber}`);
      this.hudAlive.setText(`Alive: ${this.aliveEnemies.length}`);
      this.hudKills.setText(`Kills: ${this.killCount}`);
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
    const cx    = this.arenaX + this.arenaW / 2;
    const cy    = this.arenaY + this.arenaH / 2;

    this.cameras.main.setBackgroundColor(0x120d08);
    this.cameras.main.centerOn(cx, cy);

    // ── Tiled colosseum floor ────────────────────────────────────────────────
    // Wang tileset frames: 12 = clean pale travertine (wang_15, all-upper),
    //                       6 = dark worn stone (wang_0, all-lower).
    const TILE        = 16;
    const FRAME_CLEAN = 12;
    const FRAME_WORN  = 6;
    const WALL_T      = 20;
    const cols = Math.ceil(this.arenaW / TILE);
    const rows = Math.ceil(this.arenaH / TILE);

    // Use individual Image objects instead of RenderTexture — Phaser batches
    // same-texture sprites automatically so this is just as fast as stamping
    // but avoids WebGL framebuffer issues with large RT stamp loops.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const hash  = (col * 31 + row * 17 + col * row * 7) % 100;
        const frame = hash < 12 ? FRAME_WORN : FRAME_CLEAN;
        this.add
          .image(
            this.arenaX + col * TILE + TILE / 2,
            this.arenaY + row * TILE + TILE / 2,
            'colosseum_floor',
            frame,
          )
          .setDepth(-1);
      }
    }

    // ── Ashlar stone walls ────────────────────────────────────────────────────
    const gfx = this.add.graphics();

    const drawAshlarRow = (bx: number, by: number, length: number, offset = 0): void => {
      const BLOCK_W = 40;
      const LIGHT   = 0xa08060;
      const DARK    = 0x7a6248;
      const MORTAR  = 0x4a3a2a;
      let bx2 = bx;
      let idx = offset;
      while (bx2 < bx + length) {
        const bw = Math.min(BLOCK_W, bx + length - bx2);
        gfx.fillStyle(idx % 2 === 0 ? LIGHT : DARK, 1);
        gfx.fillRect(bx2 + 1, by + 1, bw - 2, WALL_T - 2);
        gfx.lineStyle(1, MORTAR, 0.9);
        gfx.strokeRect(bx2, by, bw, WALL_T);
        bx2 += bw;
        idx++;
      }
    };

    const drawAshlarCol = (bx: number, by: number, length: number, offset = 0): void => {
      const BLOCK_H = 40;
      const LIGHT   = 0xa08060;
      const DARK    = 0x7a6248;
      const MORTAR  = 0x4a3a2a;
      let by2 = by;
      let idx = offset;
      while (by2 < by + length) {
        const bh = Math.min(BLOCK_H, by + length - by2);
        gfx.fillStyle(idx % 2 === 0 ? LIGHT : DARK, 1);
        gfx.fillRect(bx + 1, by2 + 1, WALL_T - 2, bh - 2);
        gfx.lineStyle(1, MORTAR, 0.9);
        gfx.strokeRect(bx, by2, WALL_T, bh);
        by2 += bh;
        idx++;
      }
    };

    drawAshlarRow(this.arenaX, this.arenaY, this.arenaW, 0);
    drawAshlarRow(this.arenaX, this.arenaY + this.arenaH - WALL_T, this.arenaW, 1);
    drawAshlarCol(this.arenaX, this.arenaY + WALL_T, this.arenaH - WALL_T * 2, 0);

    const GATE_HALF = 36;
    const gateTop   = cy - GATE_HALF;
    const gateBot   = cy + GATE_HALF;
    drawAshlarCol(
      this.arenaX + this.arenaW - WALL_T,
      this.arenaY + WALL_T,
      gateTop - this.arenaY - WALL_T,
      1,
    );
    drawAshlarCol(
      this.arenaX + this.arenaW - WALL_T,
      gateBot,
      this.arenaY + this.arenaH - WALL_T - gateBot,
      0,
    );

    gfx.fillStyle(0x1a0e08, 1);
    gfx.fillRect(this.arenaX + this.arenaW - WALL_T - 2, gateTop, WALL_T + 4, GATE_HALF * 2);
    gfx.fillStyle(0xc0a080, 1);
    gfx.fillRect(this.arenaX + this.arenaW - WALL_T, gateTop, WALL_T, 8);
    gfx.fillRect(this.arenaX + this.arenaW - WALL_T, gateBot - 8, WALL_T, 8);

    // ── Corner columns ────────────────────────────────────────────────────────
    const COL_SIZE = WALL_T + 8;
    const corners: [number, number][] = [
      [this.arenaX,                          this.arenaY                         ],
      [this.arenaX + this.arenaW - COL_SIZE, this.arenaY                         ],
      [this.arenaX,                          this.arenaY + this.arenaH - COL_SIZE],
      [this.arenaX + this.arenaW - COL_SIZE, this.arenaY + this.arenaH - COL_SIZE],
    ];
    for (const [colX, colY] of corners) {
      gfx.fillStyle(0xb09070, 1);
      gfx.fillRect(colX, colY, COL_SIZE, COL_SIZE);
      gfx.lineStyle(2, 0x4a3a2a, 0.8);
      gfx.strokeRect(colX, colY, COL_SIZE, COL_SIZE);
      gfx.lineStyle(1, 0xd0b090, 0.5);
      gfx.lineBetween(colX + 3, colY + 3, colX + COL_SIZE - 3, colY + 3);
      gfx.lineBetween(colX + 3, colY + COL_SIZE - 3, colX + COL_SIZE - 3, colY + COL_SIZE - 3);
    }

    this.physics.world.setBounds(
      this.arenaX + WALL_T, this.arenaY + WALL_T,
      this.arenaW - WALL_T * 2, this.arenaH - WALL_T * 2,
    );

    // ── Torch glow pools ─────────────────────────────────────────────────────
    const torchPositions: [number, number][] = [
      [this.arenaX + 90,               this.arenaY + 55              ],
      [this.arenaX + this.arenaW - 90, this.arenaY + 55              ],
      [this.arenaX + 90,               this.arenaY + this.arenaH - 55],
      [this.arenaX + this.arenaW - 90, this.arenaY + this.arenaH - 55],
    ];
    for (const [tx, ty] of torchPositions) {
      const glowGfx = this.add.graphics();
      glowGfx.fillStyle(0xff9933, 0.16);
      glowGfx.fillCircle(tx, ty, 38);
      this.tweens.add({
        targets:  glowGfx,
        alpha:    { from: 0.75, to: 1.0 },
        duration: Phaser.Math.Between(420, 680),
        yoyo:     true,
        repeat:   -1,
        ease:     'Sine.easeInOut',
        delay:    Phaser.Math.Between(0, 300),
      });
    }

    // ── Organic cracks (barely noticeable) ───────────────────────────────────
    const crackGfx = this.add.graphics();
    crackGfx.lineStyle(1, 0x1a5540, 0.11);
    const crackSeeds: [number, number, number][] = [
      [cx - 80, cy + 40,  1.1],
      [cx + 120, cy - 60, 2.4],
      [cx - 40,  cy - 90, 0.4],
      [cx + 50,  cy + 70, 1.8],
      [cx - 140, cy + 20, 3.0],
    ];
    for (const [sx, sy, angle] of crackSeeds) {
      const len = 40 + ((sx * 7 + sy * 3) % 25);
      crackGfx.lineBetween(sx, sy, sx + Math.cos(angle) * len, sy + Math.sin(angle) * len);
      crackGfx.lineBetween(sx, sy, sx + Math.cos(angle + 0.4) * len * 0.5, sy + Math.sin(angle + 0.4) * len * 0.5);
    }

    // ── Bioluminescent node ───────────────────────────────────────────────────
    const bioGfx = this.add.graphics();
    bioGfx.fillStyle(0x00ffcc, 0.07);
    bioGfx.fillCircle(cx - 120, cy + 60, 14);
    this.tweens.add({
      targets:  bioGfx,
      alpha:    { from: 0.45, to: 1.0 },
      duration: 2800,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });
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
      e.setAllies(this.aliveEnemies);
      e.setBlackboard(this.blackboard);
    }
  }

  // ── Enemy spawning ────────────────────────────────────────────────────────────

  private spawnWaveGroup(): void {
    this.waveNumber++;
    if (this.waveNumber >= 2) this.trickleActive = true;

    const group = WAVE_GROUPS[this.waveGroupIndex];
    this.waveGroupIndex = (this.waveGroupIndex + 1) % WAVE_GROUPS.length;

    const cycle  = Math.floor((this.waveNumber - 1) / WAVE_GROUPS.length);
    const ctors: EnemyCtor[] = [...group.enemies];
    for (let i = 0; i < Math.min(cycle, 3); i++) ctors.push(SporeHusk);

    const spawnX = this.arenaX + this.arenaW - SPAWN_X_OFFSET;
    const ys     = this.spreadY(ctors.length);

    for (let i = 0; i < ctors.length; i++) {
      const e = new ctors[i](this, spawnX, ys[i]);
      this.addPhysics(e);
      e.setOpponent(this.hero);
      this.aliveEnemies.push(e);
    }

    if (this.heroAlive) this.hero.setOpponents(this.aliveEnemies);
    this.syncEnemyCoordination();
  }

  private spawnBug(): void {
    const spawnX = this.arenaX + this.arenaW - SPAWN_X_OFFSET;
    const count  = this.waveNumber >= 4 && Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const y = Phaser.Math.Between(
        this.arenaY + SPAWN_MARGIN_Y,
        this.arenaY + this.arenaH - SPAWN_MARGIN_Y,
      );
      const bug = new WarriorBug(this, spawnX, y);
      this.addPhysics(bug);
      bug.setOpponent(this.hero);
      this.aliveEnemies.push(bug);
    }
    if (this.heroAlive) this.hero.setOpponents(this.aliveEnemies);
    this.syncEnemyCoordination();
  }

  // ── Wave timing ───────────────────────────────────────────────────────────────

  private nextMainInterval(): number {
    return Math.max(5000, 10000 - this.waveNumber * 400);
  }

  private nextTrickleInterval(): number {
    return this.waveNumber >= 4 ? 900 : 1500;
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
    // Movement — WASD
    const right = this.moveKeys['right'].isDown ? 1 : 0;
    const left  = this.moveKeys['left'].isDown  ? 1 : 0;
    const down  = this.moveKeys['down'].isDown  ? 1 : 0;
    const up    = this.moveKeys['up'].isDown    ? 1 : 0;

    const dx = right - left;
    const dy = down  - up;
    // Use the hero's own speed value via setMoveVelocity.
    const spd = 160; // px/s — comfortable player speed
    this.hero.setMoveVelocity(dx * spd, dy * spd);

    // Attack — Space bar (just-pressed so it doesn't auto-repeat)
    if (Phaser.Input.Keyboard.JustDown(this.meleeKey)) {
      this.hero.tryMelee();
    }

    // Dash — Shift (just-pressed)
    if (Phaser.Input.Keyboard.JustDown(this.dashKey) && (dx !== 0 || dy !== 0)) {
      this.hero.tryDash(dx, dy);
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
    // Destroy all projectiles
    for (const p of this.projectiles) { if (!p.isExpired) p.destroy(); }
    this.projectiles = [];

    // Reset wave counters
    this.waveGroupIndex = 0;
    this.waveNumber     = 0;
    this.killCount      = 0;
    this.mainSpawnTimer = 3000;
    this.trickleTimer   = 0;
    this.trickleActive  = false;

    // Respawn the hero
    if (this.hero.active) this.hero.destroy();
    this.spawnHero();
    this.hero.setPlayerControlled(this.heroPlayerMode);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private addPhysics(entity: CombatEntity): void {
    this.physics.add.existing(entity);
    (entity.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
  }

  private spreadY(count: number): number[] {
    const mid = this.arenaY + this.arenaH / 2;
    if (count === 1) return [mid];
    const margin = this.arenaH * 0.15;
    const step   = (this.arenaH - margin * 2) / (count - 1);
    return Array.from({ length: count }, (_, i) => this.arenaY + margin + i * step);
  }
}
