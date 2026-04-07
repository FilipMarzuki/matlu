import Phaser from 'phaser';
import VirtualJoystickPlugin from 'phaser3-rex-plugins/plugins/virtualjoystick-plugin';
import type VirtualJoyStick from 'phaser3-rex-plugins/plugins/virtualjoystick';
import { Decoration } from '../environment/Decoration';
import { WorldObject } from '../environment/WorldObject';
import { createSolidGroup } from '../environment/SolidObject';
import { InteractiveObject } from '../environment/InteractiveObject';
import { WorldClock } from '../world/WorldClock';
import type { DayPhase } from '../world/WorldClock';

const REX_VIRTUAL_JOYSTICK_PLUGIN_KEY = 'rexvirtualjoystickplugin';
const REX_PLUGIN_CDN =
  'https://raw.githubusercontent.com/rexrainbow/phaser3-rex-notes/master/dist/rexvirtualjoystickplugin.min.js';

// World dimensions (tile-based 2400×2000 map)
const WORLD_W = 2400;
const WORLD_H = 2000;

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

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Arc;
  private playerIndicator!: Phaser.GameObjects.Rectangle;
  private joystick!: VirtualJoyStick;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private solidObjects!: Phaser.Physics.Arcade.StaticGroup;
  private interactiveObjects!: InteractiveObject[];
  worldClock!: WorldClock;
  private dayNightOverlay!: Phaser.GameObjects.Rectangle;
  private currentPhase: DayPhase = 'dawn';
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;

  private rabbits!: Phaser.Physics.Arcade.Group;
  private kills = 0;
  private lastSwipeAt = 0;

  private cleanseFill!: Phaser.GameObjects.Rectangle;
  private overlay!: Phaser.GameObjects.Rectangle;
  private portal!: Phaser.GameObjects.Arc;
  private portalActive = false;
  private portalGfx!: Phaser.GameObjects.Graphics;
  private levelCompleteLogged = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    this.load.plugin(REX_VIRTUAL_JOYSTICK_PLUGIN_KEY, REX_PLUGIN_CDN, true);
    // CC0 placeholder character sprite (16×32px, scaled up 3× in createPlayer)
    this.load.image('player-character', 'assets/sprites/player/character.png');
  }

  create(): void {
    this.sys.game.events.on('error', (err: Error) => {
      console.error(`[${this.scene.key}]`, err);
    });

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    // Level 1 starts at dawn (FIL-37)
    this.worldClock = new WorldClock({ startPhase: 'dawn' });

    this.drawMap();
    this.createObstacles();
    this.createDecorations();
    this.createSolidObjects();
    this.createInteractiveObjects();
    this.createPlayer();

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    const joystickPlugin = this.plugins.get(
      REX_VIRTUAL_JOYSTICK_PLUGIN_KEY
    ) as VirtualJoystickPlugin;

    const base = this.add.circle(0, 0, 50, 0x444444, 0.45);
    const thumb = this.add.circle(0, 0, 22, 0xcccccc, 0.55);

    this.joystick = joystickPlugin.add(this, {
      x: 120,
      y: 480,
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

    this.rabbits = this.physics.add.group();
    this.spawnRabbits();
    this.physics.add.collider(this.rabbits, this.obstacles);

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
  }

  update(time: number, delta: number): void {
    this.worldClock.update(delta);
    this.updateDayNight();
    this.updatePlayerMovement();
    this.updateRabbits(time);
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

    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      body.setVelocity((dx / len) * PLAYER_SPEED, (dy / len) * PLAYER_SPEED);
    } else {
      body.setVelocity(0, 0);
    }

    const angle = Phaser.Math.Angle.Between(
      this.player.x,
      this.player.y,
      this.input.activePointer.worldX,
      this.input.activePointer.worldY
    );
    this.player.setRotation(angle);
  }

  private trySwipe(pointer: Phaser.Input.Pointer): void {
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

    this.add
      .text(pad, pad - 2, 'HP', { fontSize: '11px', color: '#ffffff' })
      .setScrollFactor(0)
      .setDepth(300);
    this.add.rectangle(pad + w / 2, pad + 10, w, h, 0x111111, 0.9).setScrollFactor(0).setDepth(299);
    this.add
      .rectangle(pad + 2, pad + 10, w - 4, h - 4, 0xff3333)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(300);

    this.add
      .text(800 - pad - w, pad - 2, 'Cleanse', { fontSize: '11px', color: '#ffffff' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(300);
    this.add
      .rectangle(800 - pad - w / 2, pad + 10, w, h, 0x111111, 0.9)
      .setScrollFactor(0)
      .setDepth(299);
    this.cleanseFill = this.add
      .rectangle(800 - pad - w + 2, pad + 10, 0, h - 4, 0xaaff66)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(300);

    this.overlay = this.add
      .rectangle(400, 300, 800, 600, 0x8899aa, 0.38)
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
    // Use the placeholder character sprite (16×32px scaled up 3×) if loaded,
    // otherwise fall back to the coloured circle placeholder.
    if (this.textures.exists('player-character')) {
      const sprite = this.add.sprite(0, 0, 'player-character');
      sprite.setScale(3);
      // Keep a small invisible circle for the facing indicator position
      this.playerBody = this.add.circle(0, 0, 1, 0x000000, 0);
      this.playerIndicator = this.add.rectangle(BODY_RADIUS + INDICATOR_W / 2, 0, INDICATOR_W, INDICATOR_H, 0xffffff, 0);
      this.player = this.add.container(SPAWN_X, SPAWN_Y, [sprite, this.playerBody, this.playerIndicator]);
    } else {
      this.playerBody = this.add.circle(0, 0, BODY_RADIUS, 0x4466ff);
      this.playerBody.setStrokeStyle(2, 0x2233aa);
      this.playerIndicator = this.add.rectangle(
        BODY_RADIUS + INDICATOR_W / 2, 0, INDICATOR_W, INDICATOR_H, 0xffffff
      );
      this.player = this.add.container(SPAWN_X, SPAWN_Y, [this.playerBody, this.playerIndicator]);
    }

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

  private drawMap(): void {
    const g = this.add.graphics();

    g.fillStyle(0x2d6b2e, 1);
    g.fillRect(0, 0, WORLD_W, WORLD_H);

    const roadW = 88;
    const cx = 400;
    const cy = 1000;
    g.fillStyle(0x3a3a3a, 1);
    g.fillRect(0, cy - roadW / 2, WORLD_W, roadW);
    g.fillRect(cx - roadW / 2, 0, roadW, WORLD_H);

    g.lineStyle(3, 0xffdd00, 1);
    const dash = 18;
    const gap = 14;
    for (let x = 20; x < WORLD_W; x += dash + gap) {
      g.lineBetween(x, cy, Math.min(x + dash, WORLD_W - 20), cy);
    }
    for (let y = 20; y < WORLD_H; y += dash + gap) {
      g.lineBetween(cx, y, cx, Math.min(y + dash, WORLD_H - 20));
    }

    g.lineStyle(2, 0xffcc00, 1);
    g.strokeRect(0, cy - roadW / 2, WORLD_W, roadW);
    g.strokeRect(cx - roadW / 2, 0, roadW, WORLD_H);
  }
}
