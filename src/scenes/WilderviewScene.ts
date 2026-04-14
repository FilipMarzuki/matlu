import * as Phaser from 'phaser';
import { mulberry32 } from '../lib/rng';

// ── Constants ──────────────────────────────────────────────────────────────────

const WORLD_W      = 1200;
const WORLD_H      =  900;
const TILE_SIZE    =   64;
const PAN_SPEED    =   15;  // px/s — slow drift across the world
const ANIMAL_SCALE =  2.5;  // upscale 16×16 px sprites to be visible

/** Camera waypoints to cycle through — gives the slow "nature documentary pan" feel. */
const PAN_WAYPOINTS = [
  { x: 200, y: 200 },
  { x: 900, y: 280 },
  { x: 700, y: 680 },
  { x: 150, y: 550 },
];

// ── Animal definitions ─────────────────────────────────────────────────────────

interface AnimalDef {
  key:       string;   // walk spritesheet key
  animKey:   string;   // animation key (prefixed to avoid global collision)
  frames:    number[]; // frame indices for the walk cycle
  frameRate: number;
  minSpeed:  number;
  maxSpeed:  number;
}

const ANIMAL_DEFS: AnimalDef[] = [
  { key: 'deer-walk', animKey: 'wv-deer-walk', frames: [0,2,4,6,8,10], frameRate:  8, minSpeed: 30, maxSpeed: 50 },
  { key: 'hare-walk', animKey: 'wv-hare-walk', frames: [0,2,4,6,8],    frameRate: 12, minSpeed: 45, maxSpeed: 70 },
  { key: 'fox-walk',  animKey: 'wv-fox-walk',  frames: [0,2,4,6,8,10], frameRate:  8, minSpeed: 35, maxSpeed: 55 },
];

// ── Scene ──────────────────────────────────────────────────────────────────────

/**
 * WilderviewScene — lightweight nature simulation used as the main-menu backdrop.
 *
 * Renders a soft terrain colour wash and 8 kinematic animals (deer, hare, fox)
 * wandering across a 1200×900 px virtual world, with a slow camera pan through
 * four waypoints. No arcade physics — animals move by manual position update.
 *
 * Runs in parallel with MainMenuScene via `this.scene.launch(WilderviewScene.KEY)`.
 * MainMenuScene calls `this.scene.bringToTop()` so its panel renders above this.
 */
export class WilderviewScene extends Phaser.Scene {
  static readonly KEY = 'WilderviewScene';

  private animals: Array<{
    sprite: Phaser.GameObjects.Sprite;
    tx: number; ty: number;
    speed: number;
    timer: number;
  }> = [];

  private panIdx = 0;
  private rng!: () => number;

  constructor() {
    super({ key: WilderviewScene.KEY });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  preload(): void {
    // Use the same paths and frame dimensions as GameScene.
    // Phaser's texture cache is global — if GameScene already loaded these keys
    // the cache is reused; `textures.exists` avoids redundant network requests.
    const base = 'assets/packs/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/PNG/Without_shadow';
    if (!this.textures.exists('deer-walk')) {
      this.load.spritesheet('deer-walk', `${base}/Deer/Deer_Walk.png`,  { frameWidth: 16, frameHeight: 16 });
    }
    if (!this.textures.exists('hare-walk')) {
      this.load.spritesheet('hare-walk', `${base}/Hare/Hare_Walk.png`,  { frameWidth: 16, frameHeight: 16 });
    }
    if (!this.textures.exists('fox-walk')) {
      this.load.spritesheet('fox-walk',  `${base}/Fox/Fox_walk.png`,    { frameWidth: 16, frameHeight: 16 });
    }
  }

  create(): void {
    // Fixed seed — same terrain and animal starting positions every launch.
    this.rng = mulberry32(0xb00bf00d);

    this.buildTerrain();
    this.registerAnims();
    this.spawnAnimals();

    // Camera: no follow target — we pan manually via scrollX/scrollY in update().
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.scrollX = PAN_WAYPOINTS[0].x - this.scale.width  / 2;
    this.cameras.main.scrollY = PAN_WAYPOINTS[0].y - this.scale.height / 2;
    this.cameras.main.setBackgroundColor(0x2d5a1e);
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;
    this.updateCameraPan(dt);
    this.updateAnimals(dt);
  }

  // ── Terrain ──────────────────────────────────────────────────────────────────

  /**
   * Draw a grid of coloured rectangles to suggest terrain variation.
   * A seeded RNG gives mild colour jitter — meadow greens, darker forest patches,
   * lighter clearings — without the overhead of a full noise-based tilemap.
   */
  private buildTerrain(): void {
    const gfx    = this.add.graphics().setDepth(0);
    const tilesX = Math.ceil(WORLD_W / TILE_SIZE);
    const tilesY = Math.ceil(WORLD_H / TILE_SIZE);

    // Spring Sweden palette — same green family used in GameScene's terrain tints.
    const PALETTE = [
      0x3a7a2e, // meadow
      0x2d6126, // darker meadow
      0x4a8b35, // lighter green
      0x3a6e30, // mid-tone
      0x4d8a3a, // bright meadow
      0x537840, // olive-green forest edge
      0x456638, // forest
    ];

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const colorIdx = Math.floor(this.rng() * PALETTE.length);
        gfx.fillStyle(PALETTE[colorIdx], 1);
        gfx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // ── Animations ───────────────────────────────────────────────────────────────

  /**
   * Register walk animations under scene-local keys (prefixed `wv-`).
   * Phaser's animation manager is global per game — the `wv-` prefix prevents
   * collisions with GameScene's `deer-walk-anim` etc.
   */
  private registerAnims(): void {
    for (const def of ANIMAL_DEFS) {
      if (!this.anims.exists(def.animKey)) {
        this.anims.create({
          key:       def.animKey,
          frames:    this.anims.generateFrameNumbers(def.key, { frames: def.frames }),
          frameRate: def.frameRate,
          repeat:    -1,
        });
      }
    }
  }

  // ── Animals ───────────────────────────────────────────────────────────────────

  private spawnAnimals(): void {
    this.animals = [];

    // 8 animals — 3 deer, 3 hare, 2 fox for a natural-looking mix.
    const roster = [
      ANIMAL_DEFS[0], ANIMAL_DEFS[0], ANIMAL_DEFS[0],
      ANIMAL_DEFS[1], ANIMAL_DEFS[1], ANIMAL_DEFS[1],
      ANIMAL_DEFS[2], ANIMAL_DEFS[2],
    ];

    for (const def of roster) {
      const x  = 40 + this.rng() * (WORLD_W - 80);
      const y  = 40 + this.rng() * (WORLD_H - 80);
      const tx = 40 + this.rng() * (WORLD_W - 80);
      const ty = 40 + this.rng() * (WORLD_H - 80);
      const sp = def.minSpeed + this.rng() * (def.maxSpeed - def.minSpeed);

      const sprite = this.add.sprite(x, y, def.key)
        .setScale(ANIMAL_SCALE)
        .setDepth(10 + y * 0.01); // Y-sort so animals nearer the bottom render in front

      sprite.play(def.animKey);

      this.animals.push({ sprite, tx, ty, speed: sp, timer: 2000 + this.rng() * 5000 });
    }
  }

  private updateAnimals(dt: number): void {
    for (const a of this.animals) {
      a.timer -= dt * 1000;

      const dx   = a.tx - a.sprite.x;
      const dy   = a.ty - a.sprite.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 4 || a.timer <= 0) {
        // Arrived or timer expired — pick a new wander target.
        a.tx    = 40 + this.rng() * (WORLD_W - 80);
        a.ty    = 40 + this.rng() * (WORLD_H - 80);
        a.timer = 3000 + this.rng() * 4000;
      } else {
        const nx = dx / dist;
        const ny = dy / dist;
        a.sprite.x += nx * a.speed * dt;
        a.sprite.y += ny * a.speed * dt;
        // Flip to face direction of movement.
        a.sprite.setFlipX(nx < 0);
        // Keep Y-sort depth current as the animal moves.
        a.sprite.setDepth(10 + a.sprite.y * 0.01);
      }
    }
  }

  // ── Camera pan ───────────────────────────────────────────────────────────────

  /**
   * Drive camera.scrollX/Y toward the current waypoint at PAN_SPEED px/s.
   * Advances to the next waypoint (cycling) when close enough.
   *
   * Using scrollX/Y directly (not startFollow / pan tween) gives us full control
   * without coupling to a game object or fighting the tweens on scene stop/restart.
   */
  private updateCameraPan(dt: number): void {
    const target = PAN_WAYPOINTS[this.panIdx];
    const destX  = target.x - this.scale.width  / 2;
    const destY  = target.y - this.scale.height / 2;

    const dx   = destX - this.cameras.main.scrollX;
    const dy   = destY - this.cameras.main.scrollY;
    const dist = Math.hypot(dx, dy);

    if (dist < 8) {
      this.panIdx = (this.panIdx + 1) % PAN_WAYPOINTS.length;
    } else {
      const nx = dx / dist;
      const ny = dy / dist;
      this.cameras.main.scrollX += nx * PAN_SPEED * dt;
      this.cameras.main.scrollY += ny * PAN_SPEED * dt;
    }
  }
}
