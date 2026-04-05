import Phaser from 'phaser';
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

export class GameScene extends Phaser.Scene {
  private vehicle!: Phaser.GameObjects.Rectangle;
  private joystick!: VirtualJoyStick;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    this.load.plugin(REX_VIRTUAL_JOYSTICK_PLUGIN_KEY, REX_PLUGIN_CDN, true);
  }

  create(): void {
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

    this.vehicle.setDepth(10);
    base.setDepth(20);
    thumb.setDepth(21);
  }

  update(): void {
    const body = this.vehicle.body as Phaser.Physics.Arcade.Body;
    if (this.joystick.force > 10) {
      this.physics.velocityFromRotation(this.joystick.rotation, 200, body.velocity);
      this.vehicle.setRotation(this.joystick.rotation);
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
