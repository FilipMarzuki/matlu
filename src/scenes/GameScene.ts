import Phaser from 'phaser';
import VirtualJoystickPlugin from 'phaser3-rex-plugins/plugins/virtualjoystick-plugin';
import { ValueNoise2D } from '../lib/noise';
import { t } from '../lib/i18n';
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

const REX_VIRTUAL_JOYSTICK_PLUGIN_KEY = 'rexvirtualjoystickplugin';

// World dimensions (tile-based 2400×2000 map)
const WORLD_W = 2400;
const WORLD_H = 2000;

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
const RABBIT_COUNT = 10;
const RABBIT_SIZE = 18;
const SPAWN_CLEAR = 320;
const CHASE_RANGE = 200;
const ROAM_SPEED = 40;
const CHASE_SPEED = 70;
const FLEE_SPEED = 120;
const FLEE_MS = 1500;

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
  w: number; h: number; color: number; stroke: number;
  fleeRange: number; fleeSpeed: number; roamSpeed: number; count: number;
}

const ANIMAL_DEFS: Record<string, AnimalDef> = {
  deer: { w: 22, h: 14, color: 0xc8a060, stroke: 0x9a7840, fleeRange: 280, fleeSpeed:  95, roamSpeed: 22, count: 6  },
  hare: { w: 12, h:  9, color: 0xd0c8a8, stroke: 0xa09880, fleeRange: 180, fleeSpeed: 145, roamSpeed: 38, count: 10 },
  fox:  { w: 16, h: 11, color: 0xe07828, stroke: 0xb05018, fleeRange: 140, fleeSpeed:  82, roamSpeed: 30, count: 4  },
};

const BIRD_COUNT      = 12;
const BIRD_SHADOW_DX  = 7;
const BIRD_SHADOW_DY  = 5;

interface BirdObject {
  body:          Phaser.GameObjects.Ellipse;
  shadow:        Phaser.GameObjects.Ellipse;
  vx:            number;
  vy:            number;
  nextDirChange: number;
}

/**
 * Maps a combined noise value (0–1) and a detail noise value (0–1) to a
 * spring-Sweden terrain colour. Breakpoints tuned for fBm output (mean ≈ 0.5).
 *
 *   < 0.28  — water (small ponds)
 *   < 0.37  — shore / wet grass
 *   < 0.54  — light spring meadow
 *   < 0.65  — meadow
 *   < 0.73  — tall grass / dark meadow
 *   < 0.81  — forest edge (birch / mixed)
 *   < 0.90  — pine / spruce forest
 *   ≥ 0.90  — dense forest interior
 */
function terrainColor(val: number, detail: number): number {
  if (val < 0.28) return detail > 0.5 ? 0x5a91cc : 0x4a7fbf;

  if (val < 0.37) return detail > 0.5 ? 0x92c85a : 0x82b84a;

  if (val < 0.54) {
    const v = [0x7ac04a, 0x88cc52, 0x6eb844] as const;
    return v[Math.min(Math.floor(detail * 3), 2)];
  }

  if (val < 0.65) {
    const v = [0x68a838, 0x72b240, 0x609830] as const;
    return v[Math.min(Math.floor(detail * 3), 2)];
  }

  if (val < 0.73) return detail > 0.55 ? 0x508a28 : 0x487820;

  if (val < 0.81) return detail > 0.5 ? 0x3a6a20 : 0x2e5e18;

  if (val < 0.90) return detail > 0.5 ? 0x28541a : 0x1e4412;

  return detail > 0.5 ? 0x1e3c10 : 0x162e0a;
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
  private portal!: Phaser.GameObjects.Arc;
  private portalActive = false;
  private portalGfx!: Phaser.GameObjects.Graphics;
  private levelCompleteLogged = false;
  private runSeed = 0;

  // ─── Attract mode ─────────────────────────────────────────────────────────────
  private attractMode = true;
  private attractTargets: Phaser.GameObjects.GameObject[] = [];
  private attractIdx = 0;
  private attractNextAt = 0;
  private attractLabel!: Phaser.GameObjects.Text;
  private attractNameDisplay!: Phaser.GameObjects.Text;
  private attractName = '';

  // Set when the player types their name on the attract screen; used for leaderboard.
  playerName = '';

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    // Pixel Crawler Free Pack — Body_A character sprite sheets (64×64 px frames)
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
    this.drawProceduralTerrain();
    this.createObstacles();
    this.createDecorations();
    this.createSolidObjects();
    this.createInteractiveObjects();
    this.createPlayer();

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

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

    this.groundAnimals = this.physics.add.group();
    this.spawnGroundAnimals();
    this.spawnBirds();

    this.createHudAndOverlay();
    this.createPortal();

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
    }
    this.updateRabbits(time);
    this.updateGroundAnimals();
    this.updateBirds(time, delta);
    if (this.portalActive) {
      this.portalGfx.rotation += 0.03;
    }
  }

  private spawnRabbits(): void {
    let spawned = 0;
    while (spawned < RABBIT_COUNT) {
      const x = Phaser.Math.Between(80, WORLD_W - 80);
      const y = Phaser.Math.Between(80, WORLD_H - 80);
      if (Phaser.Math.Distance.Between(x, y, SPAWN_X, SPAWN_Y) < SPAWN_CLEAR) {
        continue;
      }
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
      spawned += 1;
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
      body.setVelocity((dx / len) * PLAYER_SPEED, (dy / len) * PLAYER_SPEED);
    } else {
      body.setVelocity(0, 0);
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

    this.add
      .text(pad, pad - 2, t('hud.hp'), { fontSize: '11px', color: '#ffffff' })
      .setScrollFactor(0)
      .setDepth(300);
    this.add.rectangle(pad + w / 2, pad + 10, w, h, 0x111111, 0.9).setScrollFactor(0).setDepth(299);
    this.add
      .rectangle(pad + 2, pad + 10, w - 4, h - 4, 0xff3333)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(300);

    this.add
      .text(sw - pad - w, pad - 2, t('hud.cleanse'), { fontSize: '11px', color: '#ffffff' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(300);
    this.add
      .rectangle(sw - pad - w / 2, pad + 10, w, h, 0x111111, 0.9)
      .setScrollFactor(0)
      .setDepth(299);
    this.cleanseFill = this.add
      .rectangle(sw - pad - w + 2, pad + 10, 0, h - 4, 0xaaff66)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(300);

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
      console.log('Level complete');
      this.levelCompleteLogged = true;
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
      const box = this.add.rectangle(def.x, def.y, def.w, def.h, 0x7a4a1e);
      box.setStrokeStyle(2, 0x3d2008);
      this.obstacles.add(box);
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

    this.physics.add.collider(this.player, this.solidObjects);
  }

  // ─── Attract mode ─────────────────────────────────────────────────────────────

  private initAttractMode(): void {
    // Hide player and disable its physics body until gameplay starts
    this.player.setAlpha(0);
    (this.player.body as Phaser.Physics.Arcade.Body).setEnable(false);

    // Build target list from ground animals; shuffle for variety
    this.attractTargets = Phaser.Utils.Array.Shuffle([
      ...this.groundAnimals.getChildren(),
    ]);

    // Start camera at world centre, then let it pan to the first target
    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);
    if (this.attractTargets.length > 0) {
      this.cameras.main.startFollow(
        this.attractTargets[0] as Phaser.GameObjects.GameObject,
        true, 0.03, 0.03,
      );
    }
    this.attractNextAt = this.time.now + 12000;

    const cx = this.scale.width / 2;
    const by = this.scale.height - 20;

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
   * Handles keystrokes during attract mode to build the player's name.
   * Printable single characters are appended (max 20); Backspace removes the last;
   * Enter submits when at least one character has been typed.
   */
  private onAttractKey(event: KeyboardEvent): void {
    if (!this.attractMode) return;
    if (event.key === 'Enter') {
      if (this.attractName.length > 0) this.exitAttractMode();
    } else if (event.key === 'Backspace') {
      this.attractName = this.attractName.slice(0, -1);
    } else if (event.key.length === 1 && this.attractName.length < 20) {
      this.attractName += event.key;
    }
    // Show current input with a cursor placeholder
    this.attractNameDisplay.setText((this.attractName || '') + '_');
  }

  private updateAttractMode(time: number): void {
    if (time < this.attractNextAt || this.attractTargets.length === 0) return;

    this.attractIdx = (this.attractIdx + 1) % this.attractTargets.length;
    this.cameras.main.startFollow(
      this.attractTargets[this.attractIdx] as Phaser.GameObjects.GameObject,
      true, 0.03, 0.03,
    );
    // Dwell for 10–14 s on each animal
    this.attractNextAt = time + 10000 + Phaser.Math.Between(-2000, 4000);
  }

  private exitAttractMode(): void {
    if (!this.attractMode) return;
    this.attractMode = false;
    this.playerName = this.attractName || 'Player';
    this.input.keyboard?.off('keydown', this.onAttractKey, this);
    this.attractLabel.destroy();
    this.attractNameDisplay.destroy();
    this.player.setAlpha(1);
    (this.player.body as Phaser.Physics.Arcade.Body).setEnable(true);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
  }

  // ─── Ground animals (deer, hare, fox) ────────────────────────────────────────

  private spawnGroundAnimals(): void {
    for (const [type, def] of Object.entries(ANIMAL_DEFS)) {
      let spawned = 0;
      while (spawned < def.count) {
        const x = Phaser.Math.Between(80, WORLD_W - 80);
        const y = Phaser.Math.Between(80, WORLD_H - 80);
        if (Phaser.Math.Distance.Between(x, y, SPAWN_X, SPAWN_Y) < SPAWN_CLEAR) continue;

        const rect = this.add.rectangle(x, y, def.w, def.h, def.color);
        rect.setStrokeStyle(1, def.stroke);
        rect.setDepth(3);
        this.physics.add.existing(rect);
        const b = rect.body as Phaser.Physics.Arcade.Body;
        b.setCollideWorldBounds(true);
        b.setDrag(60, 60);
        this.groundAnimals.add(rect);
        rect.setData('animalType', type);
        rect.setData('animalState', 'roaming' satisfies AnimalState);
        rect.setData('roamNext', this.time.now + Phaser.Math.Between(2000, 6000));
        spawned++;
      }
    }
  }

  private updateGroundAnimals(): void {
    const px = this.player.x;
    const py = this.player.y;

    for (const child of this.groundAnimals.getChildren()) {
      const r  = child as Phaser.GameObjects.Rectangle;
      const b  = r.body as Phaser.Physics.Arcade.Body;
      const type = r.getData('animalType') as string;
      const def  = ANIMAL_DEFS[type];
      const dist = Phaser.Math.Distance.Between(r.x, r.y, px, py);
      let state  = r.getData('animalState') as AnimalState;

      if (dist < def.fleeRange) {
        state = 'fleeing';
        r.setData('animalState', state);
      } else if (state === 'fleeing' && dist > def.fleeRange + 80) {
        state = 'roaming';
        r.setData('animalState', state);
        r.setData('roamNext', this.time.now + Phaser.Math.Between(2000, 5000));
      }

      if (state === 'fleeing') {
        const away = Phaser.Math.Angle.Between(px, py, r.x, r.y);
        this.physics.velocityFromRotation(away, def.fleeSpeed, b.velocity);
      } else if (this.time.now > (r.getData('roamNext') as number)) {
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        this.physics.velocityFromRotation(angle, def.roamSpeed, b.velocity);
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
      const w      = isCrow ? 10 : 6;
      const h      = isCrow ?  5 : 3;
      const color  = isCrow ? 0x1a1a1a : 0x3a3a50;

      const shadow = this.add.ellipse(x + BIRD_SHADOW_DX, y + BIRD_SHADOW_DY, w, h, 0x000000, 0.2);
      shadow.setDepth(1);

      const body = this.add.ellipse(x, y, w, h, color);
      body.setDepth(7);

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
      // Gently nudge direction every so often — birds don't fly perfectly straight
      if (time > bird.nextDirChange) {
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
    }
  }

  /**
   * Generates and draws a noise-based spring-Sweden landscape:
   * open meadows, forest patches, small ponds, and a dirt clearing at spawn.
   * Uses this.runSeed for deterministic output (same seed → same map).
   */
  private drawProceduralTerrain(): void {
    const noise    = new ValueNoise2D(this.runSeed);
    const detNoise = new ValueNoise2D(this.runSeed ^ 0xb5ad4ecb);

    const tilesX = Math.ceil(WORLD_W / TILE_SIZE);
    const tilesY = Math.ceil(WORLD_H / TILE_SIZE);

    const g = this.add.graphics();
    g.setDepth(0);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const base   = noise.fbm(tx * BASE_SCALE,   ty * BASE_SCALE,   4, 0.5);
        const detail = detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE, 2, 0.6);
        const val    = base * 0.78 + detail * 0.22;

        g.fillStyle(terrainColor(val, detail), 1);
        g.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }

    // Dirt clearing at spawn so the player starts on a recognisable landmark
    const sx = Math.floor(SPAWN_X / TILE_SIZE);
    const sy = Math.floor(SPAWN_Y / TILE_SIZE);
    g.fillStyle(0xc4a472, 1);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 7) {
          g.fillRect((sx + dx) * TILE_SIZE, (sy + dy) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }
}
