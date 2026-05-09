/**
 * HomesteadScene — standalone base-building + crafting + gathering scene.
 *
 * A small playable area with resource nodes, player movement, crafting,
 * and base placement. No combat, no enemies. The chill mode / testbed
 * for the homestead epic (#834).
 *
 * Resource node proximity is handled by Phaser physics overlap — no
 * manual distance loops in update(). The scene just checks E-key input.
 *
 * Route: /homestead
 * Controls:
 *   WASD / Arrow keys — move
 *   E — interact with nearby resource node
 *   C — open crafting menu
 *   I — toggle inventory panel
 */

import * as Phaser from 'phaser';
import { InventorySystem } from '../systems/InventorySystem';
import { InventoryHUD } from '../ui/InventoryHUD';
import { ResourceNode, type ResourceNodeTypeDef } from '../entities/ResourceNode';
import { SimpleJoystick } from '../lib/SimpleJoystick';

// ── Constants ───────────────────────────────────────────────────────────────

const WORLD_W = 800;
const WORLD_H = 600;
const PLAYER_SPEED = 120;
/** Invisible circle around the player that triggers node overlap checks. */
const INTERACT_RADIUS = 50;

// ── Scene ───────────────────────────────────────────────────────────────────

export class HomesteadScene extends Phaser.Scene {
  static readonly KEY = 'HomesteadScene';

  constructor() { super({ key: HomesteadScene.KEY }); }

  private player!: Phaser.Physics.Arcade.Image;
  private interactZone!: Phaser.GameObjects.Arc;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private joystick: SimpleJoystick | null = null;
  private actionBtn: Phaser.GameObjects.Arc | null = null;
  private actionLabel: Phaser.GameObjects.Text | null = null;
  private resourceNodes: ResourceNode[] = [];
  /** Nodes currently overlapping the interact zone this frame. */
  private nodesInRange = new Set<ResourceNode>();
  /** True if the action button was tapped this frame. */
  private actionTapped = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    this.load.json('resources', '/macro-world/resources.json');
    this.load.json('resource-nodes', '/macro-world/resource-nodes.json');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#2a5a2a');
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    // ── Inventory ─────────────────────────────────────────────────────────
    const inv = new InventorySystem(this);
    const resDefs = this.cache.json.get('resources') as { resources: { id: string; name: string; category: string; stackMax: number }[] } | undefined;
    if (resDefs?.resources) inv.loadResourceDefs(resDefs.resources as never[]);
    inv.add('flint', 4);
    inv.add('dry-grass', 6);

    // ── Ground ────────────────────────────────────────────────────────────
    const gfx = this.add.graphics();
    gfx.fillStyle(0x3a7a3a, 1);
    gfx.fillRect(0, 0, WORLD_W, WORLD_H);
    gfx.lineStyle(1, 0x2d6b2e, 0.3);
    for (let x = 0; x < WORLD_W; x += 32) gfx.lineBetween(x, 0, x, WORLD_H);
    for (let y = 0; y < WORLD_H; y += 32) gfx.lineBetween(0, y, WORLD_W, y);
    gfx.lineStyle(3, 0x5a3a1a, 0.8);
    gfx.strokeRect(2, 2, WORLD_W - 4, WORLD_H - 4);
    gfx.setDepth(-1);

    // ── Placeholder textures ──────────────────────────────────────────────
    const textures: [string, number, number, number][] = [
      ['rn-tree',  24, 40, 0x3a7a28],
      ['rn-rock',  20, 16, 0x7a7265],
      ['rn-ore',   18, 20, 0xd4793a],
      ['rn-herb',  16, 16, 0x7ab33a],
      ['rn-berry', 18, 20, 0x8b3ab3],
      ['rn-water', 22, 14, 0x3a7ab3],
    ];
    for (const [key, w, h, colour] of textures) {
      if (!this.textures.exists(key)) {
        const rt = this.add.renderTexture(0, 0, w, h);
        rt.fill(colour, 1);
        rt.saveTexture(key);
        rt.destroy();
      }
    }

    // ── Player ────────────────────────────────────────────────────────────
    if (!this.textures.exists('hs-player')) {
      const rt = this.add.renderTexture(0, 0, 14, 14);
      rt.fill(0x4488cc, 1);
      rt.saveTexture('hs-player');
      rt.destroy();
    }
    this.player = this.physics.add.image(WORLD_W / 2, WORLD_H / 2, 'hs-player');
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(100);

    // Invisible interact zone — physics circle that follows the player.
    // Overlap with nodes triggers prompt display without per-frame distance math.
    this.interactZone = this.add.arc(0, 0, INTERACT_RADIUS).setVisible(false);
    this.physics.add.existing(this.interactZone, false);
    const zoneBody = this.interactZone.body as Phaser.Physics.Arcade.Body;
    zoneBody.setCircle(INTERACT_RADIUS);
    zoneBody.setOffset(-INTERACT_RADIUS, -INTERACT_RADIUS);

    // ── Resource nodes ────────────────────────────────────────────────────
    const nodeDefs = this.cache.json.get('resource-nodes') as { nodeTypes: ResourceNodeTypeDef[] } | undefined;
    if (nodeDefs?.nodeTypes) {
      const placements: { defId: string; x: number; y: number }[] = [
        { defId: 'tree',  x: 120, y: 150 }, { defId: 'tree',  x: 180, y: 200 },
        { defId: 'tree',  x: 100, y: 280 }, { defId: 'tree',  x: 160, y: 350 },
        { defId: 'rock',  x: 550, y: 120 }, { defId: 'rock',  x: 620, y: 170 },
        { defId: 'ore',   x: 600, y: 450 }, { defId: 'ore',   x: 670, y: 500 },
        { defId: 'herb',  x: 300, y: 100 }, { defId: 'herb',  x: 450, y: 380 },
        { defId: 'berry', x: 350, y: 480 }, { defId: 'berry', x: 200, y: 450 },
        { defId: 'water', x: 400, y: 520 },
      ];

      // Static group so one collider covers all nodes
      const nodeGroup = this.physics.add.staticGroup();

      for (const p of placements) {
        const def = nodeDefs.nodeTypes.find(d => d.id === p.defId);
        if (!def) continue;
        const node = new ResourceNode(this, p.x, p.y, def, inv);
        nodeGroup.add(node);
        this.resourceNodes.push(node);
      }
      nodeGroup.refresh();

      // Collider: player bumps into nodes
      this.physics.add.collider(this.player, nodeGroup);

      // Overlap: interact zone detects nearby nodes — Phaser's broadphase
      // handles spatial culling, so only nodes near the player are checked.
      this.physics.add.overlap(this.interactZone, nodeGroup, (_zone, obj) => {
        const node = obj as ResourceNode;
        this.nodesInRange.add(node);
      });
    }

    // ── Input ─────────────────────────────────────────────────────────────
    const kb = this.input.keyboard!;
    this.wasd = {
      up:    kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    kb.on('keydown-C', () => {
      if (this.scene.isActive('CraftingMenuScene')) {
        this.scene.stop('CraftingMenuScene');
      } else {
        this.scene.launch('CraftingMenuScene');
      }
    });

    // ── Virtual joystick (mobile) ───────────────────────────────────────
    const cam = this.cameras.main;
    const joyRadius = 40;
    const joyX = 60;
    const joyY = cam.height - 60;

    // Base ring
    this.add.arc(joyX, joyY, joyRadius, 0, 360, false, 0x000000, 0.25)
      .setStrokeStyle(2, 0xffffff, 0.3)
      .setScrollFactor(0).setDepth(250);

    // Thumb (moves with touch)
    const thumb = this.add.arc(joyX, joyY, 14, 0, 360, false, 0xffffff, 0.5)
      .setScrollFactor(0).setDepth(251);

    this.joystick = new SimpleJoystick(this, joyX, joyY, joyRadius, thumb);

    // ── Action button (mobile — replaces E key) ──────────────────────────
    const btnX = cam.width - 60;
    const btnY = cam.height - 60;
    const btnR = 28;

    this.actionBtn = this.add.arc(btnX, btnY, btnR, 0, 360, false, 0x44aa44, 0.3)
      .setStrokeStyle(2, 0x44aa44, 0.6)
      .setScrollFactor(0).setDepth(250)
      .setInteractive();

    this.actionLabel = this.add.text(btnX, btnY, 'E', {
      fontSize: '18px', color: '#88cc88', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(251);

    this.actionBtn.on('pointerdown', () => { this.actionTapped = true; });

    // ── HUD ───────────────────────────────────────────────────────────────
    new InventoryHUD(this, inv);

    this.add.text(8, 8, 'Homestead Mode', {
      fontSize: '11px', color: '#aaccaa', backgroundColor: '#00000066',
      padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(200);
  }

  update(): void {
    // ── Player movement (keyboard + joystick) ─────────────────────────────
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Keyboard
    let vx = (this.wasd.right.isDown ? 1 : 0) - (this.wasd.left.isDown ? 1 : 0);
    let vy = (this.wasd.down.isDown ? 1 : 0) - (this.wasd.up.isDown ? 1 : 0);

    // Joystick overrides keyboard if active
    if (this.joystick && this.joystick.force > 4) {
      vx = Math.cos(this.joystick.rotation);
      vy = Math.sin(this.joystick.rotation);
    }

    body.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
    this.player.setDepth(this.player.y);

    // Move interact zone to player position
    this.interactZone.setPosition(this.player.x, this.player.y);
    (this.interactZone.body as Phaser.Physics.Arcade.Body)
      .reset(this.player.x, this.player.y);

    // ── Node proximity ────────────────────────────────────────────────────
    const currentInRange = new Set(this.nodesInRange);
    this.nodesInRange.clear();

    let anyInRange = false;
    for (const node of this.resourceNodes) {
      const inRange = currentInRange.has(node);
      node.setPlayerInRange(inRange);
      if (inRange) {
        anyInRange = true;
        node.checkInput();
        // Action button tap triggers gather on the nearest ready node
        if (this.actionTapped && node.nodeState === 'ready') {
          node.gatherFromTouch();
          this.actionTapped = false;
        }
      }
    }

    // Consume tap if no node was in range
    this.actionTapped = false;

    // Highlight action button when near a harvestable node
    if (this.actionBtn) {
      this.actionBtn.setFillStyle(anyInRange ? 0x44aa44 : 0x444444, anyInRange ? 0.5 : 0.2);
      this.actionBtn.setStrokeStyle(2, anyInRange ? 0x44aa44 : 0x444444, anyInRange ? 0.8 : 0.3);
    }
    if (this.actionLabel) {
      this.actionLabel.setColor(anyInRange ? '#88ff88' : '#666666');
    }
  }
}
