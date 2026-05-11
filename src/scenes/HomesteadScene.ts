/**
 * HomesteadScene — standalone base-building + crafting + gathering scene.
 *
 * Renders an isometric tiled meadow using the same 2:1 projection as the
 * main world (IsoTransform). Physics stays in flat world space; only the
 * visual rendering is projected to iso.
 *
 * Route: /homestead
 * Controls:
 *   WASD / Arrow keys — move (iso-corrected: "up" = northwest)
 *   E — interact with nearby resource node
 *   C — open crafting menu
 *   I — toggle inventory panel
 */

import * as Phaser from 'phaser';
import { InventorySystem } from '../systems/InventorySystem';
import { InventoryHUD } from '../ui/InventoryHUD';
import { ResourceNode, type ResourceNodeTypeDef } from '../entities/ResourceNode';
import { SimpleJoystick } from '../lib/SimpleJoystick';
import { HomesteadAuth } from '../lib/HomesteadAuth';

// ── Homestead grid constants ───────────────────────────────────────────────
// Small 20×20 tile grid — cozy plot, not an open world.

const TILE_SIZE = 32;          // world-space pixels per tile
const GRID = 20;               // tiles in each axis
const WORLD_W = GRID * TILE_SIZE;  // 640
const WORLD_H = GRID * TILE_SIZE;  // 640
const PLAYER_SPEED = 120;
const INTERACT_RADIUS = 50;

// ── Iso projection (homestead-local) ───────────────────────────────────────
// Same 2:1 formula as IsoTransform but with homestead-specific origin offset.

const ISO_TILE_W = 32;
const ISO_TILE_H = 16;
const ISO_ORIGIN_X = GRID * (ISO_TILE_W / 2);  // left-edge offset
const ISO_W = (GRID + GRID) * (ISO_TILE_W / 2); // bounding width
const ISO_H = (GRID + GRID) * (ISO_TILE_H / 2) + ISO_TILE_H; // bounding height

function hsWorldToIso(wx: number, wy: number): { x: number; y: number } {
  const tx = wx / TILE_SIZE;
  const ty = wy / TILE_SIZE;
  return {
    x: ISO_ORIGIN_X + (tx - ty) * (ISO_TILE_W / 2),
    y: (tx + ty) * (ISO_TILE_H / 2),
  };
}

function hsIsoDepth(wx: number, wy: number): number {
  return (wx + wy) / TILE_SIZE;
}

/**
 * Convert screen-space input direction to world-space direction.
 * In iso view, "screen up" = northwest in world space (rotated 45° CCW).
 */
function isoInputToWorld(svx: number, svy: number): { wx: number; wy: number } {
  // Rotate 45° CCW to map screen axes → world axes
  const cos45 = Math.SQRT1_2;
  return {
    wx:  svx * cos45 + svy * cos45,
    wy: -svx * cos45 + svy * cos45,
  };
}

// ── Tile hash for variety ──────────────────────────────────────────────────
// Simple hash to pick one of 4 tile variants per position (deterministic).
function tileVariant(tx: number, ty: number): number {
  return ((tx * 7 + ty * 13) & 0x7fffffff) % 4;
}

// ── Available characters ────────────────────────────────────────────────────

interface CharacterDef {
  key: string;
  label: string;
  png: string;
  json: string;
}

const CHARACTERS: CharacterDef[] = [
  { key: 'loke',     label: 'Loke',     png: '/assets/sprites/characters/mistheim/heroes/loke/loke.png',         json: '/assets/sprites/characters/mistheim/heroes/loke/loke.json' },
  { key: 'skald',    label: 'Skald',    png: '/assets/sprites/characters/earth/heroes/skald/skald.png',          json: '/assets/sprites/characters/earth/heroes/skald/skald.json' },
  { key: 'tinkerer', label: 'Tinkerer', png: '/assets/sprites/characters/earth/heroes/tinkerer/tinkerer.png',    json: '/assets/sprites/characters/earth/heroes/tinkerer/tinkerer.json' },
];

// ── Direction helpers ──────────────────────────────────────────────────────
// Map world-space velocity to a canonical facing direction.
// West-side dirs are mirrored via flipX (same pattern as HumanoidNPC).

type FaceDir = 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'west';

function velocityToFacing(vx: number, vy: number): { dir: FaceDir; flip: boolean } | null {
  if (vx === 0 && vy === 0) return null;
  const angle = Math.atan2(vy, vx);
  const sector = Math.round(angle / (Math.PI / 4));
  const DIR_MAP: Record<number, { dir: FaceDir; flip: boolean }> = {
     0: { dir: 'east',       flip: false },
     1: { dir: 'south-east', flip: false },
     2: { dir: 'south',      flip: false },
     3: { dir: 'south-east', flip: true  },   // SW → flip SE
     4: { dir: 'west',       flip: false },
    '-4': { dir: 'west',     flip: false },
    '-3': { dir: 'north-east', flip: true  }, // NW → flip NE
    '-2': { dir: 'north',    flip: false },
    '-1': { dir: 'north-east', flip: false },
  };
  return DIR_MAP[sector] ?? { dir: 'south', flip: false };
}

// ── Scene ───────────────────────────────────────────────────────────────────

export class HomesteadScene extends Phaser.Scene {
  static readonly KEY = 'HomesteadScene';

  constructor() { super({ key: HomesteadScene.KEY }); }

  private player!: Phaser.Physics.Arcade.Image;
  private playerIso!: Phaser.GameObjects.Sprite;  // animated sprite in iso space
  private interactZone!: Phaser.GameObjects.Arc;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private joystick: SimpleJoystick | null = null;
  private actionBtn: Phaser.GameObjects.Arc | null = null;
  private actionLabel: Phaser.GameObjects.Text | null = null;
  private resourceNodes: ResourceNode[] = [];
  private nodesInRange = new Set<ResourceNode>();
  private actionTapped = false;
  private targetNode: ResourceNode | null = null;
  private characterKey = 'loke';  // active character sprite key
  private facingDir: 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'west' = 'south';

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    this.load.json('resources', '/macro-world/resources.json');
    this.load.json('resource-nodes', '/macro-world/resource-nodes.json');
    // Meadow tile variants (4 PNGs)
    for (let i = 0; i < 4; i++) {
      this.load.image(`meadow-${i}`, `/assets/packs/meadow-tiles/${i}.png`);
    }
    // Character spritesheets (Aseprite atlas format)
    for (const c of CHARACTERS) {
      this.load.aseprite(c.key, c.png, c.json);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a3a1a');

    // Physics world stays in flat grid space
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    // ── Inventory ─────────────────────────────────────────────────────────
    const inv = new InventorySystem(this);
    const resDefs = this.cache.json.get('resources') as { resources: { id: string; name: string; category: string; stackMax: number }[] } | undefined;
    if (resDefs?.resources) inv.loadResourceDefs(resDefs.resources as never[]);
    inv.add('flint', 4);
    inv.add('dry-grass', 6);

    // ── Iso terrain ──────────────────────────────────────────────────────
    // Painter's algorithm: iterate diagonals (tx + ty = constant) so
    // back tiles render first and front tiles overlap correctly.
    for (let diag = 0; diag < GRID * 2 - 1; diag++) {
      const txMin = Math.max(0, diag - (GRID - 1));
      const txMax = Math.min(diag, GRID - 1);
      for (let tx = txMin; tx <= txMax; tx++) {
        const ty = diag - tx;
        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const { x: isoX, y: isoY } = hsWorldToIso(wx, wy);
        const variant = tileVariant(tx, ty);
        const tile = this.add.image(isoX, isoY, `meadow-${variant}`);
        tile.setOrigin(0.5, 0);  // anchor at north apex
        tile.setDepth(hsIsoDepth(wx, wy) - 1000); // behind everything
      }
    }

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
    // Physics body lives in world space (invisible).
    // Animated sprite is in iso space, updated each frame.

    // Create animations from all loaded character spritesheets
    for (const c of CHARACTERS) {
      this.createAnimsFromAseprite(c.key);
    }

    const spawnWx = WORLD_W / 2;
    const spawnWy = WORLD_H / 2;

    // Invisible physics body — a tiny placeholder texture for the physics sprite
    if (!this.textures.exists('hs-player-phys')) {
      const rt = this.add.renderTexture(0, 0, 14, 14);
      rt.fill(0x000000, 0);
      rt.saveTexture('hs-player-phys');
      rt.destroy();
    }
    this.player = this.physics.add.image(spawnWx, spawnWy, 'hs-player-phys');
    this.player.setCollideWorldBounds(true);
    this.player.setVisible(false);

    // Visible animated sprite in iso space
    const { x: spawnIsoX, y: spawnIsoY } = hsWorldToIso(spawnWx, spawnWy);
    this.playerIso = this.add.sprite(spawnIsoX, spawnIsoY, this.characterKey);
    this.playerIso.setOrigin(0.5, 1); // anchor at feet
    this.playerIso.setDepth(hsIsoDepth(spawnWx, spawnWy));
    this.playerIso.play(`${this.characterKey}_idle_south`);

    // Invisible interact zone (world space)
    this.interactZone = this.add.arc(0, 0, INTERACT_RADIUS).setVisible(false);
    this.physics.add.existing(this.interactZone, false);
    const zoneBody = this.interactZone.body as Phaser.Physics.Arcade.Body;
    zoneBody.setCircle(INTERACT_RADIUS);
    zoneBody.setOffset(-INTERACT_RADIUS, -INTERACT_RADIUS);

    // ── Resource nodes ────────────────────────────────────────────────────
    // Positions are in world space; ResourceNode renders at world coords
    // but we reposition them to iso space after creation.
    const nodeDefs = this.cache.json.get('resource-nodes') as { nodeTypes: ResourceNodeTypeDef[] } | undefined;
    if (nodeDefs?.nodeTypes) {
      // Placements in world-space tile coords (tx, ty) → world pixels
      const placements: { defId: string; tx: number; ty: number }[] = [
        { defId: 'tree',  tx: 4,  ty: 5  }, { defId: 'tree',  tx: 6,  ty: 7  },
        { defId: 'tree',  tx: 3,  ty: 9  }, { defId: 'tree',  tx: 5,  ty: 12 },
        { defId: 'rock',  tx: 14, ty: 4  }, { defId: 'rock',  tx: 16, ty: 5  },
        { defId: 'ore',   tx: 15, ty: 14 }, { defId: 'ore',   tx: 17, ty: 16 },
        { defId: 'herb',  tx: 9,  ty: 3  }, { defId: 'herb',  tx: 12, ty: 12 },
        { defId: 'berry', tx: 10, ty: 15 }, { defId: 'berry', tx: 6,  ty: 14 },
        { defId: 'water', tx: 12, ty: 17 },
      ];

      const nodeGroup = this.physics.add.staticGroup();

      for (const p of placements) {
        const def = nodeDefs.nodeTypes.find(d => d.id === p.defId);
        if (!def) continue;
        const wx = p.tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = p.ty * TILE_SIZE + TILE_SIZE / 2;
        const { x: isoX, y: isoY } = hsWorldToIso(wx, wy);
        const node = new ResourceNode(this, isoX, isoY, def, inv);
        node.setDepth(hsIsoDepth(wx, wy));
        // Store world coords for depth sorting and proximity checks
        node.setData('worldX', wx);
        node.setData('worldY', wy);
        nodeGroup.add(node);
        this.resourceNodes.push(node);
      }
      nodeGroup.refresh();

      this.physics.add.collider(this.player, nodeGroup);
      this.physics.add.overlap(this.interactZone, nodeGroup, (_zone, obj) => {
        this.nodesInRange.add(obj as ResourceNode);
      });
    }

    // ── Tap-to-target ────────────────────────────────────────────────────
    this.events.on('resource-node:targeted', (node: ResourceNode) => {
      if (this.targetNode && this.targetNode !== node) {
        this.targetNode.setTargeted(false);
      }
      this.targetNode = node;
      node.setTargeted(true);
    });

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

    this.add.arc(joyX, joyY, joyRadius, 0, 360, false, 0x000000, 0.25)
      .setStrokeStyle(2, 0xffffff, 0.3)
      .setScrollFactor(0).setDepth(250);

    const thumb = this.add.arc(joyX, joyY, 14, 0, 360, false, 0xffffff, 0.5)
      .setScrollFactor(0).setDepth(251);

    this.joystick = new SimpleJoystick(this, joyX, joyY, joyRadius, thumb);

    // ── Action button (mobile) ──────────────────────────────────────────
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

    // ── Craft button ────────────────────────────────────────────────────
    const craftBtnY = btnY - 70;
    const craftBtn = this.add.arc(btnX, craftBtnY, 22, 0, 360, false, 0x4466aa, 0.3)
      .setStrokeStyle(2, 0x4466aa, 0.6)
      .setScrollFactor(0).setDepth(250)
      .setInteractive();
    this.add.text(btnX, craftBtnY, 'C', {
      fontSize: '14px', color: '#88aacc', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(251);

    craftBtn.on('pointerdown', () => {
      if (this.scene.isActive('CraftingMenuScene')) {
        this.scene.stop('CraftingMenuScene');
      } else {
        this.scene.launch('CraftingMenuScene');
      }
    });

    // ── HUD ───────────────────────────────────────────────────────────────
    new InventoryHUD(this, inv);
    new HomesteadAuth(this);

    this.add.text(8, 8, 'Homestead Mode', {
      fontSize: '11px', color: '#aaccaa', backgroundColor: '#00000066',
      padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(200);

    // ── Camera ────────────────────────────────────────────────────────────
    // The 20×20 iso diamond fits on screen — center it, no scrolling.
    const offsetX = (cam.width - ISO_W) / 2;
    const offsetY = (cam.height - ISO_H) / 2;
    cam.setScroll(-offsetX, -offsetY);

    // ── Cardinal direction labels (just outside the diamond edges) ──────
    const dirStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '10px', color: '#88aa88', fontFamily: 'monospace',
    };
    const cx = ISO_W / 2;   // centre of diamond in iso space
    const cy = ISO_H / 2;
    const pad = 14;          // px outside the diamond edge
    // N = top apex, S = bottom apex, W = left apex, E = right apex
    this.add.text(cx, -pad, 'N', dirStyle).setOrigin(0.5, 1);
    this.add.text(cx, ISO_H + pad, 'S', dirStyle).setOrigin(0.5, 0);
    this.add.text(-pad, cy, 'W', dirStyle).setOrigin(1, 0.5);
    this.add.text(ISO_W + pad, cy, 'E', dirStyle).setOrigin(0, 0.5);
  }

  update(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // ── Input → world-space velocity ─────────────────────────────────────
    // Screen-space input is converted to world-space so "up" moves northwest.
    let svx = (this.wasd.right.isDown ? 1 : 0) - (this.wasd.left.isDown ? 1 : 0);
    let svy = (this.wasd.down.isDown ? 1 : 0) - (this.wasd.up.isDown ? 1 : 0);

    if (this.joystick && this.joystick.force > 4) {
      svx = Math.cos(this.joystick.rotation);
      svy = Math.sin(this.joystick.rotation);
    }

    // Convert screen-space direction to world-space direction
    let { wx: vx, wy: vy } = isoInputToWorld(svx, svy);

    if ((svx !== 0 || svy !== 0) && this.targetNode) {
      this.targetNode.setTargeted(false);
      this.targetNode = null;
    }

    // Auto-walk toward targeted node (in world space)
    if (this.targetNode && svx === 0 && svy === 0) {
      const twx = this.targetNode.getData('worldX') as number;
      const twy = this.targetNode.getData('worldY') as number;
      const dx = twx - this.player.x;
      const dy = twy - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 10) {
        vx = dx / dist;
        vy = dy / dist;
      } else {
        this.targetNode = null;
      }
    }

    // Normalize and apply speed
    const mag = Math.sqrt(vx * vx + vy * vy);
    if (mag > 0) {
      body.setVelocity((vx / mag) * PLAYER_SPEED, (vy / mag) * PLAYER_SPEED);
    } else {
      body.setVelocity(0, 0);
    }

    // ── Sync iso sprite to physics body + animate ──────────────────────
    const { x: isoX, y: isoY } = hsWorldToIso(this.player.x, this.player.y);
    this.playerIso.setPosition(isoX, isoY);
    this.playerIso.setDepth(hsIsoDepth(this.player.x, this.player.y));

    // Update facing direction and animation
    const facing = velocityToFacing(vx, vy);
    if (facing) {
      this.facingDir = facing.dir;
      this.playerIso.setFlipX(facing.flip);
      const walkKey = `${this.characterKey}_walk_${facing.dir}`;
      if (this.playerIso.anims.getName() !== walkKey) {
        this.playerIso.play(walkKey, true);
      }
    } else {
      // Standing still — play idle in current facing direction
      const idleKey = `${this.characterKey}_idle_${this.facingDir}`;
      if (this.playerIso.anims.getName() !== idleKey) {
        this.playerIso.play(idleKey, true);
      }
    }

    // Move interact zone to player (world space)
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
        if (this.actionTapped && node.nodeState === 'ready') {
          node.gatherFromTouch();
          this.actionTapped = false;
        }
      }
    }

    this.actionTapped = false;

    if (this.actionBtn) {
      this.actionBtn.setFillStyle(anyInRange ? 0x44aa44 : 0x444444, anyInRange ? 0.5 : 0.2);
      this.actionBtn.setStrokeStyle(2, anyInRange ? 0x44aa44 : 0x444444, anyInRange ? 0.8 : 0.3);
    }
    if (this.actionLabel) {
      this.actionLabel.setColor(anyInRange ? '#88ff88' : '#666666');
    }
  }

  // ── Aseprite animation helper ──────────────────────────────────────────
  // Same approach as DungeonForgeScene: reads frame tags from the cached
  // Aseprite JSON and creates Phaser animations with filename-based frame keys.

  private createAnimsFromAseprite(key: string): void {
    type AseFrame = { filename: string; duration?: number };
    type AseTag   = { name: string; from: number; to: number; direction: string };
    const data = this.cache.json.get(key) as {
      frames: AseFrame[];
      meta:   { frameTags: AseTag[] };
    } | null;

    if (!data?.frames || !data.meta?.frameTags) return;

    for (const tag of data.meta.frameTags) {
      if (this.anims.exists(tag.name)) continue;
      const animFrames: { key: string; frame: string; duration: number }[] = [];
      for (let i = tag.from; i <= tag.to; i++) {
        const f = data.frames[i];
        if (!f) continue;
        animFrames.push({ key, frame: f.filename, duration: f.duration ?? 100 });
      }
      if (tag.direction === 'reverse') animFrames.reverse();
      const isLoop = tag.name.includes('idle') || tag.name.includes('walk');
      this.anims.create({ key: tag.name, frames: animFrames, repeat: isLoop ? -1 : 0 });
    }
  }
}
