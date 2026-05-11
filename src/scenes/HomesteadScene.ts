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

// ── Placeable buildings ─────────────────────────────────────────────────────

interface BuildingDef {
  id: string;
  label: string;
  spriteKey: string;
  footW: number;
  footD: number;
}

const BUILDINGS: BuildingDef[] = [
  { id: 'campfire',     label: 'Campfire',     spriteKey: 'bld-campfire',     footW: 1, footD: 1 },
  { id: 'yurt-small',   label: 'Small Yurt',   spriteKey: 'bld-yurt-small',  footW: 2, footD: 2 },
  { id: 'yurt-large',   label: 'Large Yurt',   spriteKey: 'bld-yurt-large',  footW: 3, footD: 3 },
  { id: 'well',         label: 'Well',          spriteKey: 'bld-well',        footW: 1, footD: 1 },
  { id: 'farmstead',    label: 'Farmstead',     spriteKey: 'bld-farmstead',   footW: 3, footD: 3 },
  { id: 'smithy',       label: 'Smithy',        spriteKey: 'bld-smithy',      footW: 2, footD: 2 },
  { id: 'cottage',      label: 'Cottage',       spriteKey: 'bld-cottage',     footW: 2, footD: 2 },
  { id: 'shelter-hut',  label: 'Shelter',       spriteKey: 'bld-shelter-hut', footW: 2, footD: 1 },
];

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
  private characterKey = 'loke';
  private facingDir: 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'west' = 'south';

  // ── Building placement ─────────────────────────────────────────────────
  private selectedBuilding: BuildingDef | null = null;
  private occupied = new Uint8Array(GRID * GRID);
  private placedBuildings: Phaser.GameObjects.Image[] = [];
  private toolbarBtns: Phaser.GameObjects.Container[] = [];
  private ghostSprite: Phaser.GameObjects.Image | null = null;
  private footprintGfx: Phaser.GameObjects.Graphics | null = null;
  private lastHoverTx = -1;
  private lastHoverTy = -1;

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
    // Building sprites (ikibeki culture)
    for (const b of BUILDINGS) {
      this.load.image(b.spriteKey, `/assets/packs/building-objects/ikibeki/${b.id}.png`);
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
    this.playerIso.setScale(0.45);    // ~34px wide — fits one iso tile
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
    // Zoom in 3× and follow the player so we see a close-up portion of the grid.
    cam.setZoom(3);
    cam.setBounds(
      -cam.width / (2 * 3),       // allow some padding beyond diamond edges
      -cam.height / (2 * 3),
      ISO_W + cam.width / 3,
      ISO_H + cam.height / 3,
    );
    cam.startFollow(this.playerIso, true, 0.08, 0.08);

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

    // ── Building toolbar + placement ─────────────────────────────────────
    this.createBuildToolbar();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.selectedBuilding) return;
      if (pointer.y > cam.height - 70) return;
      const worldPt = cam.getWorldPoint(pointer.x, pointer.y);
      const tile = this.isoToTile(worldPt.x, worldPt.y);
      if (!tile) return;
      this.placeBuilding(this.selectedBuilding, tile.tx, tile.ty);
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.selectedBuilding) return;
      if (pointer.y > cam.height - 70) { this.clearGhost(); return; }
      const worldPt = cam.getWorldPoint(pointer.x, pointer.y);
      const tile = this.isoToTile(worldPt.x, worldPt.y);
      if (!tile) { this.clearGhost(); return; }
      if (tile.tx === this.lastHoverTx && tile.ty === this.lastHoverTy) return;
      this.lastHoverTx = tile.tx;
      this.lastHoverTy = tile.ty;
      this.drawPlacementPreview(this.selectedBuilding, tile.tx, tile.ty);
    });
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

  // ── Building toolbar ────────────────────────────────────────────────────

  private createBuildToolbar(): void {
    const cam = this.cameras.main;
    const btnSize = 40;
    const gap = 6;
    const totalW = BUILDINGS.length * (btnSize + gap) - gap;
    const startX = (cam.width - totalW) / 2;
    const y = cam.height - 36;

    for (let i = 0; i < BUILDINGS.length; i++) {
      const b = BUILDINGS[i];
      const x = startX + i * (btnSize + gap) + btnSize / 2;
      const container = this.add.container(x, y).setScrollFactor(0).setDepth(260);
      const bg = this.add.rectangle(0, 0, btnSize, btnSize, 0x1a2a1a, 0.85)
        .setStrokeStyle(1, 0x3a5a3a, 0.8);
      container.add(bg);
      const icon = this.add.image(0, -2, b.spriteKey);
      const scale = Math.min((btnSize - 8) / icon.width, (btnSize - 8) / icon.height);
      icon.setScale(scale);
      container.add(icon);
      const label = this.add.text(0, btnSize / 2 + 4, b.label, {
        fontSize: '7px', color: '#88aa88', fontFamily: 'monospace',
      }).setOrigin(0.5, 0);
      container.add(label);
      container.setSize(btnSize, btnSize);
      container.setInteractive({ useHandCursor: true });
      container.on('pointerdown', () => this.selectBuilding(i));
      this.toolbarBtns.push(container);
    }
  }

  private selectBuilding(index: number): void {
    if (this.selectedBuilding === BUILDINGS[index]) {
      this.selectedBuilding = null;
      this.clearGhost();
      this.highlightToolbar(-1);
      return;
    }
    this.selectedBuilding = BUILDINGS[index];
    this.highlightToolbar(index);
  }

  private highlightToolbar(activeIdx: number): void {
    for (let i = 0; i < this.toolbarBtns.length; i++) {
      const bg = this.toolbarBtns[i].getAt(0) as Phaser.GameObjects.Rectangle;
      bg.setStrokeStyle(i === activeIdx ? 2 : 1, i === activeIdx ? 0xddaa44 : 0x3a5a3a, i === activeIdx ? 1 : 0.8);
    }
  }

  private clearGhost(): void {
    if (this.ghostSprite) { this.ghostSprite.destroy(); this.ghostSprite = null; }
    if (this.footprintGfx) { this.footprintGfx.destroy(); this.footprintGfx = null; }
    this.lastHoverTx = -1;
    this.lastHoverTy = -1;
  }

  // ── Iso ↔ tile conversion ──────────────────────────────────────────────

  private isoToTile(isoX: number, isoY: number): { tx: number; ty: number } | null {
    const relX = isoX - ISO_ORIGIN_X;
    const relY = isoY;
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;
    const tx = Math.floor(((relX / hw) + (relY / hh)) / 2);
    const ty = Math.floor(((relY / hh) - (relX / hw)) / 2);
    if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return null;
    return { tx, ty };
  }

  // ── Placement logic ────────────────────────────────────────────────────

  private canPlace(def: BuildingDef, tx: number, ty: number): boolean {
    if (tx + def.footW > GRID || ty + def.footD > GRID) return false;
    for (let dx = 0; dx < def.footW; dx++) {
      for (let dy = 0; dy < def.footD; dy++) {
        if (this.occupied[(ty + dy) * GRID + (tx + dx)]) return false;
      }
    }
    return true;
  }

  private placeBuilding(def: BuildingDef, tx: number, ty: number): void {
    if (!this.canPlace(def, tx, ty)) return;

    for (let dx = 0; dx < def.footW; dx++) {
      for (let dy = 0; dy < def.footD; dy++) {
        this.occupied[(ty + dy) * GRID + (tx + dx)] = 1;
      }
    }

    const centreWx = (tx + def.footW / 2) * TILE_SIZE;
    const centreWy = (ty + def.footD / 2) * TILE_SIZE;
    const { x: isoX, y: isoY } = hsWorldToIso(centreWx, centreWy);

    const sprite = this.add.image(isoX, isoY, def.spriteKey);
    sprite.setOrigin(0.5, 0.75);
    // Scale buildings so their footprint fills the iso tile area properly.
    // Target width = footW tiles × ISO_TILE_W pixels.
    const targetW = def.footW * ISO_TILE_W;
    const buildingScale = targetW / sprite.width;
    sprite.setScale(buildingScale);
    sprite.setDepth(hsIsoDepth(centreWx, centreWy));
    this.placedBuildings.push(sprite);

    this.selectedBuilding = null;
    this.highlightToolbar(-1);
    this.clearGhost();
  }

  // ── Placement preview ──────────────────────────────────────────────────

  private drawPlacementPreview(def: BuildingDef, tx: number, ty: number): void {
    if (this.footprintGfx) this.footprintGfx.destroy();
    if (this.ghostSprite) this.ghostSprite.destroy();

    const outOfBounds = tx + def.footW > GRID || ty + def.footD > GRID;
    let blocked = outOfBounds;
    if (!outOfBounds) blocked = !this.canPlace(def, tx, ty);

    const color = blocked ? 0xff4444 : 0x44dd44;
    const gfx = this.add.graphics().setDepth(9000);

    if (!outOfBounds) {
      for (let dx = 0; dx < def.footW; dx++) {
        for (let dy = 0; dy < def.footD; dy++) {
          const wx = (tx + dx) * TILE_SIZE;
          const wy = (ty + dy) * TILE_SIZE;
          const { x: ix, y: iy } = hsWorldToIso(wx, wy);
          const hw = ISO_TILE_W / 2;
          const hh = ISO_TILE_H / 2;
          gfx.lineStyle(1.5, color, 0.7);
          gfx.fillStyle(color, 0.12);
          gfx.beginPath();
          gfx.moveTo(ix, iy);
          gfx.lineTo(ix + hw, iy + hh);
          gfx.lineTo(ix, iy + ISO_TILE_H);
          gfx.lineTo(ix - hw, iy + hh);
          gfx.closePath();
          gfx.fillPath();
          gfx.strokePath();
        }
      }
    }
    this.footprintGfx = gfx;

    if (!outOfBounds) {
      const centreWx = (tx + def.footW / 2) * TILE_SIZE;
      const centreWy = (ty + def.footD / 2) * TILE_SIZE;
      const { x: isoX, y: isoY } = hsWorldToIso(centreWx, centreWy);
      this.ghostSprite = this.add.image(isoX, isoY, def.spriteKey);
      this.ghostSprite.setOrigin(0.5, 0.75);
      const targetW = def.footW * ISO_TILE_W;
      this.ghostSprite.setScale(targetW / this.ghostSprite.width);
      this.ghostSprite.setAlpha(blocked ? 0.3 : 0.5);
      this.ghostSprite.setDepth(9001);
      if (blocked) this.ghostSprite.setTint(0xff6666);
    } else {
      this.ghostSprite = null;
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
