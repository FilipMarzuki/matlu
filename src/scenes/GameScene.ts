import Phaser from 'phaser';
import * as Sentry from '@sentry/browser';
import VirtualJoystickPlugin from 'phaser3-rex-plugins/plugins/virtualjoystick-plugin';
import type VirtualJoyStick from 'phaser3-rex-plugins/plugins/virtualjoystick';

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
  { x: 160,  y: 870,  w: 56, h: 40 },
  { x: 630,  y: 885,  w: 40, h: 56 },
  { x: 140,  y: 1170, w: 48, h: 48 },
  { x: 640,  y: 1160, w: 64, h: 36 },
  { x: 230,  y: 900,  w: 36, h: 36 },
];

export class GameScene extends Phaser.Scene {
  // Player is a container holding a circle body + facing indicator
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Arc;
  private playerIndicator!: Phaser.GameObjects.Rectangle;
  private joystick!: VirtualJoyStick;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    this.load.plugin(REX_VIRTUAL_JOYSTICK_PLUGIN_KEY, REX_PLUGIN_CDN, true);
  }

  create(): void {
    this.sys.game.events.on('error', (err: Error) => {
      Sentry.captureException(err, { tags: { scene: this.scene.key } });
    });

    // Expand world bounds to the full map size
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    this.drawMap();
    this.createObstacles();
    this.createPlayer();

    // Camera follows player and is clamped to world bounds
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    const joystickPlugin = this.plugins.get(
      REX_VIRTUAL_JOYSTICK_PLUGIN_KEY
    ) as VirtualJoystickPlugin;

    const base = this.add.circle(0, 0, 50, 0x444444, 0.45);
    const thumb = this.add.circle(0, 0, 22, 0xcccccc, 0.55);

    // Joystick is fixed to camera (setScrollFactor(0) not needed; use fixed=true or position by cam)
    this.joystick = joystickPlugin.add(this, {
      x: 120,
      y: 480,
      radius: 50,
      base,
      thumb,
      fixed: true,
    });

    // Register keyboard inputs so arrow keys and WASD both move the player.
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    base.setDepth(20);
    thumb.setDepth(21);
  }

  // Call when a corruption zone is cleansed
  protected onZoneCleansed(type: string, x: number, y: number): void {
    Sentry.addBreadcrumb({
      category: 'game',
      message: `Zone cleansed: corruption type ${type} at (${x}, ${y})`,
      level: 'info',
    });
  }

  // Call on FSM state transitions
  protected onFsmTransition(oldState: string, newState: string): void {
    Sentry.addBreadcrumb({
      category: 'entity',
      message: `${this.constructor.name} FSM: ${oldState} → ${newState}`,
      level: 'debug',
    });
  }

  // Call when height-based movement is blocked
  protected onHeightBlocked(diff: number, toX: number, toY: number): void {
    Sentry.addBreadcrumb({
      category: 'movement',
      message: `Blocked: height diff ${diff} at (${toX}, ${toY})`,
      level: 'debug',
    });
  }

  update(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    let dx = 0;
    let dy = 0;

    // Joystick takes priority when actively pushed.
    if (this.joystick.force > 10) {
      // Decompose joystick angle into a normalised vector (force is already normalised by radius)
      dx = Math.cos(this.joystick.rotation);
      dy = Math.sin(this.joystick.rotation);
    } else {
      // 8-directional keyboard movement
      const right = this.cursors.right.isDown || this.wasd['right'].isDown ? 1 : 0;
      const left  = this.cursors.left.isDown  || this.wasd['left'].isDown  ? 1 : 0;
      const down  = this.cursors.down.isDown  || this.wasd['down'].isDown  ? 1 : 0;
      const up    = this.cursors.up.isDown    || this.wasd['up'].isDown    ? 1 : 0;
      dx = right - left;
      dy = down - up;
    }

    if (dx !== 0 || dy !== 0) {
      // Normalise so diagonal speed matches cardinal speed
      const len = Math.sqrt(dx * dx + dy * dy);
      body.setVelocity((dx / len) * PLAYER_SPEED, (dy / len) * PLAYER_SPEED);
    } else {
      body.setVelocity(0, 0);
    }

    // Player container always rotates to face the mouse cursor (worldX/worldY
    // accounts for camera scroll)
    const angle = Phaser.Math.Angle.Between(
      this.player.x,
      this.player.y,
      this.input.activePointer.worldX,
      this.input.activePointer.worldY
    );
    this.player.setRotation(angle);
  }

  private createPlayer(): void {
    // Circle for the body
    this.playerBody = this.add.circle(0, 0, BODY_RADIUS, 0x4466ff);
    this.playerBody.setStrokeStyle(2, 0x2233aa);

    // Small rectangle offset forward (along +x before rotation) to indicate facing direction
    this.playerIndicator = this.add.rectangle(
      BODY_RADIUS + INDICATOR_W / 2,
      0,
      INDICATOR_W,
      INDICATOR_H,
      0xffffff
    );

    // Container lets us rotate both child objects together around the player centre
    this.player = this.add.container(SPAWN_X, SPAWN_Y, [
      this.playerBody,
      this.playerIndicator,
    ]);
    this.player.setSize(BODY_RADIUS * 2, BODY_RADIUS * 2);
    this.player.setDepth(10);

    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    // Circle collider matching the visual radius
    body.setCircle(BODY_RADIUS);

    // Collide the player with every static obstacle.
    this.physics.add.collider(this.player, this.obstacles);
  }

  // Each obstacle is a brown crate-style rectangle added to a static physics
  // group so Arcade physics treats it as an immovable solid.
  private createObstacles(): void {
    this.obstacles = this.physics.add.staticGroup();

    for (const def of OBSTACLE_DEFS) {
      const box = this.add.rectangle(def.x, def.y, def.w, def.h, 0x7a4a1e);
      box.setStrokeStyle(2, 0x3d2008);
      this.obstacles.add(box);
    }

    this.obstacles.refresh();
  }

  private drawMap(): void {
    const g = this.add.graphics();

    // Grass background
    g.fillStyle(0x2d6b2e, 1);
    g.fillRect(0, 0, WORLD_W, WORLD_H);

    // Cross-roads centred roughly at (400, 1000) in the expanded world
    const roadW = 88;
    const cx = 400;
    const cy = 1000;
    g.fillStyle(0x3a3a3a, 1);
    g.fillRect(0, cy - roadW / 2, WORLD_W, roadW);
    g.fillRect(cx - roadW / 2, 0, roadW, WORLD_H);

    // Dashed centre lines
    g.lineStyle(3, 0xffdd00, 1);
    const dash = 18;
    const gap = 14;
    for (let x = 20; x < WORLD_W; x += dash + gap) {
      g.lineBetween(x, cy, Math.min(x + dash, WORLD_W - 20), cy);
    }
    for (let y = 20; y < WORLD_H; y += dash + gap) {
      g.lineBetween(cx, y, cx, Math.min(y + dash, WORLD_H - 20));
    }

    // Road outlines
    g.lineStyle(2, 0xffcc00, 1);
    g.strokeRect(0, cy - roadW / 2, WORLD_W, roadW);
    g.strokeRect(cx - roadW / 2, 0, roadW, WORLD_H);
  }
}
