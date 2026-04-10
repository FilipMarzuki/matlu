import Phaser from 'phaser';
import { log } from '../lib/logger';
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
  private obstacles!:   Phaser.Physics.Arcade.StaticGroup;
  private heroAlive    = true;
  private aliveEnemies: CombatEntity[] = [];
  private projectiles:  Projectile[]   = [];
  private readonly blackboard = new ArenaBlackboard();

  private waveGroupIndex = 0;
  private waveNumber     = 0;
  private killCount      = 0;
  // Maintained incrementally so the trickle check avoids a per-frame filter().
  private aliveBugCount  = 0;

  private mainSpawnTimer = 3000;  // first group fires after 3 s
  private trickleTimer   = 0;
  private trickleActive  = false;

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
    this.aliveBugCount   = 0;
    this.mainSpawnTimer  = 3000;
    this.trickleTimer    = 0;
    this.trickleActive   = false;
    this.heroAlive       = true;
    this._lastHudWave    = -1;
    this._lastHudAlive   = -1;
    this._lastHudKills   = -1;

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
        log.info('hero_died', { wave: this.waveNumber, kills: this.killCount, alive_enemies: this.aliveEnemies.length });
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
      // Decrement the bug counter for any WarriorBugs that just died.
      for (const e of justDied) {
        if (e instanceof WarriorBug) this.aliveBugCount--;
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

    // ── Trickle spawn timer ───────────────────────────────────────────────────
    if (this.trickleActive) {
      if (this.aliveBugCount < MAX_ALIVE_BUGS && this.aliveEnemies.length < MAX_ALIVE) {
        this.trickleTimer -= delta;
        if (this.trickleTimer <= 0) {
          this.spawnBug();
          this.trickleTimer = this.nextTrickleInterval();
        }
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

    log.info('wave_spawned', {
      wave:        this.waveNumber,
      group_label: group.label,
      spawned:     ctors.length,
      total_alive: this.aliveEnemies.length,
      kills_so_far: this.killCount,
    });

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
      this.aliveBugCount++;
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
    this.aliveBugCount  = 0;
    this.mainSpawnTimer = 3000;
    this.trickleTimer   = 0;
    this.trickleActive  = false;
    this._lastHudWave   = -1;
    this._lastHudAlive  = -1;
    this._lastHudKills  = -1;

    // Respawn the hero
    if (this.hero.active) this.hero.destroy();
    this.spawnHero();
    this.hero.setPlayerControlled(this.heroPlayerMode);
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
