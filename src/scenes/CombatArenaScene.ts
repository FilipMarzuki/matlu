import Phaser from 'phaser';
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

  /**
   * When true the scene is running as a menu background — HUD and dev bar are
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

    this.anims.createFromAseprite('tinkerer');
    this.anims.createFromAseprite('spider');
    this.anims.createFromAseprite('skag');
    this.anims.createFromAseprite('crow');

    // Projectile listener lives for the whole scene — enemies and hero both fire.
    this.events.on('projectile-spawned', (p: Projectile) => {
      this.projectiles.push(p);
    });

    this.spawnHero();
    if (!this.bgMode) this.buildHud();
    if (!this.bgMode) this.buildDevMenu();
  }

  override update(_time: number, delta: number): void {
    // ── Hero ──────────────────────────────────────────────────────────────────
    if (this.heroAlive) {
      this.hero.update(delta);
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
    // HUD objects only exist when bgMode=false; skip in background mode.
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

    this.arenaX = margin;
    this.arenaY = margin;
    this.arenaW = W - margin * 2;
    this.arenaH = H - margin * 2;
    const cx    = this.arenaX + this.arenaW / 2;
    const cy    = this.arenaY + this.arenaH / 2;

    // Bio floor — dark organic green-black.
    this.add.rectangle(cx, cy, this.arenaW, this.arenaH, 0x070f07);

    // Spinolandet-palette border (acid-green accents).
    const gfx = this.add.graphics();
    gfx.lineStyle(3, 0x336633, 1);
    gfx.strokeRect(this.arenaX, this.arenaY, this.arenaW, this.arenaH);

    const cornerLen = 16;
    gfx.lineStyle(2, 0x44aa44, 0.7);
    for (const [px, py] of [
      [this.arenaX,              this.arenaY             ],
      [this.arenaX + this.arenaW, this.arenaY             ],
      [this.arenaX,              this.arenaY + this.arenaH],
      [this.arenaX + this.arenaW, this.arenaY + this.arenaH],
    ] as [number, number][]) {
      const sx = px === this.arenaX ? 1 : -1;
      const sy = py === this.arenaY ? 1 : -1;
      gfx.lineBetween(px, py, px + sx * cornerLen, py);
      gfx.lineBetween(px, py, px, py + sy * cornerLen);
    }

    this.physics.world.setBounds(
      this.arenaX + 10, this.arenaY + 10,
      this.arenaW - 20, this.arenaH - 20,
    );
    this.cameras.main.setBackgroundColor(0x020702);
    this.cameras.main.centerOn(cx, cy);
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

  // ── Enemy spawning ────────────────────────────────────────────────────────────

  private spawnWaveGroup(): void {
    this.waveNumber++;
    if (this.waveNumber >= 2) this.trickleActive = true;

    const group = WAVE_GROUPS[this.waveGroupIndex];
    this.waveGroupIndex = (this.waveGroupIndex + 1) % WAVE_GROUPS.length;

    // Extra SporeHusks every full cycle (capped at +3).
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
  }

  // ── Wave timing ───────────────────────────────────────────────────────────────

  /** 10 s base, −400 ms per wave, min 5 s. */
  private nextMainInterval(): number {
    return Math.max(5000, 10000 - this.waveNumber * 400);
  }

  /** 1.5 s until wave 4, then 0.9 s. */
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
    this.hudWave = this.add
      .text(this.scale.width - 12, 12, 'Wave 0', { ...base, color: '#99ddff' })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(2);
    this.hudAlive = this.add
      .text(12, 12, 'Alive: 0', { ...base, color: '#aaffaa' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
    this.hudKills = this.add
      .text(12, 32, 'Kills: 0', { ...base, color: '#ffcc88' })
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2);
  }

  // ── Dev menu ─────────────────────────────────────────────────────────────────

  private buildDevMenu(): void {
    const W    = this.scale.width;
    const barY = this.scale.height - 11;

    this.add
      .rectangle(W / 2, barY, W, 22, 0x000000, 0.6)
      .setScrollFactor(0).setDepth(1000);

    const items = [
      { label: 'WilderView', active: false, target: 'GameScene' },
      { label: 'Arena',      active: true,  target: '' },
    ];

    items.forEach(({ label, active, target }, i) => {
      const x   = W / 2 - 55 + i * 110;
      const txt = this.add
        .text(x, barY, label, {
          fontSize: '11px',
          color:    active ? '#aaffaa' : '#667766',
          padding:  { x: 8, y: 3 },
        })
        .setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(1001);

      if (!active) {
        txt
          .setInteractive({ useHandCursor: true })
          .on('pointerup',   () => this.scene.start(target))
          .on('pointerover', () => txt.setColor('#99bb99'))
          .on('pointerout',  () => txt.setColor('#667766'));
      }
    });
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
