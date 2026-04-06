import Phaser from 'phaser';
import * as Sentry from '@sentry/browser';
import VirtualJoystickPlugin from 'phaser3-rex-plugins/plugins/virtualjoystick-plugin';
import type VirtualJoyStick from 'phaser3-rex-plugins/plugins/virtualjoystick';

const REX_VIRTUAL_JOYSTICK_PLUGIN_KEY = 'rexvirtualjoystickplugin';
const REX_PLUGIN_CDN =
  'https://raw.githubusercontent.com/rexrainbow/phaser3-rex-notes/master/dist/rexvirtualjoystickplugin.min.js';

// Obstacle definitions: placed in the four grass quadrants, away from roads.
// Roads span cx±44 (x 356–444) and cy±44 (y 256–344).
const OBSTACLE_DEFS: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 160,  y: 130,  w: 56, h: 40 }, // top-left crate
  { x: 630,  y: 145,  w: 40, h: 56 }, // top-right tall crate
  { x: 140,  y: 470,  w: 48, h: 48 }, // bottom-left square crate
  { x: 640,  y: 460,  w: 64, h: 36 }, // bottom-right wide crate
  { x: 230,  y: 200,  w: 36, h: 36 }, // extra crate near top-left road edge
];

const VEHICLE_SPEED = 200;

export class GameScene extends Phaser.Scene {
  private vehicle!: Phaser.GameObjects.Rectangle;
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

    this.drawMap();
    this.createObstacles();

    this.vehicle = this.add.rectangle(400, 300, 40, 24, 0xff2222);
    this.vehicle.setStrokeStyle(2, 0x880000);
    this.physics.add.existing(this.vehicle);
    const body = this.vehicle.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);

    // Collide the vehicle with every static obstacle.
    this.physics.add.collider(this.vehicle, this.obstacles);

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
    });

    // Register keyboard inputs so arrow keys and WASD both drive the vehicle.
    // createCursorKeys() covers arrow keys + shift + space.
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    this.vehicle.setDepth(10);
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
    const body = this.vehicle.body as Phaser.Physics.Arcade.Body;

    // Joystick takes priority when actively pushed.
    if (this.joystick.force > 10) {
      this.physics.velocityFromRotation(this.joystick.rotation, VEHICLE_SPEED, body.velocity);
      this.vehicle.setRotation(this.joystick.rotation);
      return;
    }

    // Resolve a direction vector from whichever keys are held.
    const right =
      this.cursors.right.isDown || this.wasd['right'].isDown ? 1 : 0;
    const left =
      this.cursors.left.isDown || this.wasd['left'].isDown ? 1 : 0;
    const down =
      this.cursors.down.isDown || this.wasd['down'].isDown ? 1 : 0;
    const up =
      this.cursors.up.isDown || this.wasd['up'].isDown ? 1 : 0;

    const dx = right - left;
    const dy = down - up;

    if (dx !== 0 || dy !== 0) {
      // atan2(y, x) gives the angle in Phaser's coordinate system where
      // right = 0, down = PI/2, left = ±PI, up = -PI/2.
      const angle = Math.atan2(dy, dx);
      this.physics.velocityFromRotation(angle, VEHICLE_SPEED, body.velocity);
      this.vehicle.setRotation(angle);
    } else {
      body.setVelocity(0, 0);
    }
  }

  // Each obstacle is a brown crate-style rectangle added to a static physics
  // group so Arcade physics treats it as an immovable solid.
  private createObstacles(): void {
    this.obstacles = this.physics.add.staticGroup();

    for (const def of OBSTACLE_DEFS) {
      // Wood-brown fill with a dark outline to look intentional.
      const box = this.add.rectangle(def.x, def.y, def.w, def.h, 0x7a4a1e);
      box.setStrokeStyle(2, 0x3d2008);
      this.obstacles.add(box);
    }

    // Sync all static bodies with their game object positions.
    this.obstacles.refresh();
  }

  private drawMap(): void {
    const g = this.add.graphics();

    g.fillStyle(0x2d6b2e, 1);
    g.fillRect(0, 0, 800, 600);

    const roadW = 88;
    const cx = 400;
    const cy = 300;
    g.fillStyle(0x3a3a3a, 1);
    g.fillRect(0, cy - roadW / 2, 800, roadW);
    g.fillRect(cx - roadW / 2, 0, roadW, 600);

    g.lineStyle(3, 0xffdd00, 1);
    const dash = 18;
    const gap = 14;
    for (let x = 20; x < 800; x += dash + gap) {
      g.lineBetween(x, cy, Math.min(x + dash, 780), cy);
    }
    for (let y = 20; y < 600; y += dash + gap) {
      g.lineBetween(cx, y, cx, Math.min(y + dash, 580));
    }

    g.lineStyle(2, 0xffcc00, 1);
    g.strokeRect(0, cy - roadW / 2, 800, roadW);
    g.strokeRect(cx - roadW / 2, 0, roadW, 600);
  }
}
