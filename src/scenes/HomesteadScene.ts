/**
 * HomesteadScene — standalone base-building + crafting + gathering scene.
 *
 * A small playable area with resource nodes, player movement, crafting,
 * and base placement. No combat, no enemies. The chill mode / testbed
 * for the homestead epic (#834).
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

// ── Constants ───────────────────────────────────────────────────────────────

const WORLD_W = 800;
const WORLD_H = 600;
const PLAYER_SPEED = 120;

// ── Scene ───────────────────────────────────────────────────────────────────

export class HomesteadScene extends Phaser.Scene {
  static readonly KEY = 'HomesteadScene';

  constructor() { super({ key: HomesteadScene.KEY }); }

  private player!: Phaser.Physics.Arcade.Image;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private resourceNodes: ResourceNode[] = [];

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

    // Seed starter items so crafting is immediately testable
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

      for (const p of placements) {
        const def = nodeDefs.nodeTypes.find(d => d.id === p.defId);
        if (!def) continue;
        const node = new ResourceNode(this, p.x, p.y, def);
        this.physics.add.existing(node, true);
        node.initStaticBody();
        this.physics.add.collider(this.player, node);
        this.resourceNodes.push(node);
      }
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

    // ── HUD ───────────────────────────────────────────────────────────────
    new InventoryHUD(this, inv);

    this.add.text(8, 8, [
      'Homestead Mode',
      'WASD — move  |  E — gather',
      'C — craft    |  I — inventory',
    ].join('\n'), {
      fontSize: '10px', color: '#aaccaa', backgroundColor: '#00000066',
      padding: { x: 6, y: 4 }, lineSpacing: 3,
    }).setScrollFactor(0).setDepth(200);
  }

  update(_time: number, delta: number): void {
    // Player movement
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const vx = (this.wasd.right.isDown ? 1 : 0) - (this.wasd.left.isDown ? 1 : 0);
    const vy = (this.wasd.down.isDown ? 1 : 0) - (this.wasd.up.isDown ? 1 : 0);
    body.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
    this.player.setDepth(this.player.y);

    // Resource node proximity checks
    for (const node of this.resourceNodes) {
      node.tick(delta, this.player.x, this.player.y);
    }
  }
}
