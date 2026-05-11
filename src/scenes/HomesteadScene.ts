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
import { InventorySystem, INVENTORY_CHANGED, type ResourceDef } from '../systems/InventorySystem';
import { InventoryHUD } from '../ui/InventoryHUD';
import { ResourceNode, type ResourceNodeTypeDef } from '../entities/ResourceNode';
import { SimpleJoystick } from '../lib/SimpleJoystick';
import {
  describeAuthStatus,
  getCurrentSession,
  getOrSignInAnon,
  onAuthStateChange,
  sendMagicLink,
  signOut,
  type HomesteadAuthStatus,
} from '../lib/auth';
import {
  flushSave,
  HOMESTEAD_SAVE_VERSION,
  loadSave,
  queueSave,
  type HomesteadSaveState,
} from '../lib/homesteadSave';

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
  /** Node the player is walking toward (tap-to-target). */
  private targetNode: ResourceNode | null = null;
  private inventory!: InventorySystem;
  private saveEnabled = false;
  private authStatus: HomesteadAuthStatus | null = null;
  private authSubscription: { unsubscribe: () => void } | null = null;
  private authPanelBg!: Phaser.GameObjects.Rectangle;
  private authPillText!: Phaser.GameObjects.Text;
  private authActionText!: Phaser.GameObjects.Text;
  private saveStatusText!: Phaser.GameObjects.Text;
  private loginModal: Phaser.GameObjects.Container | null = null;
  private lastQueuedPlayerPos: { x: number; y: number } | null = null;

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
    this.inventory = inv;
    const resDefs = this.cache.json.get('resources') as { resources: ResourceDef[] } | undefined;
    if (resDefs?.resources) inv.loadResourceDefs(resDefs.resources);
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
      const nodeOrdinals = new Map<string, number>();

      for (const p of placements) {
        const def = nodeDefs.nodeTypes.find(d => d.id === p.defId);
        if (!def) continue;
        const ordinal = nodeOrdinals.get(p.defId) ?? 0;
        nodeOrdinals.set(p.defId, ordinal + 1);
        const node = new ResourceNode(this, p.x, p.y, def, inv, `${p.defId}-${ordinal}`);
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

    // ── Tap-to-target: player taps a node → walk to it → auto-gather ────
    this.events.on('resource-node:targeted', (node: ResourceNode) => {
      // Clear previous target
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

    // ── Craft button (above action button) ───────────────────────────────
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
    this.createAuthHud();

    this.add.text(8, 8, 'Homestead Mode', {
      fontSize: '11px', color: '#aaccaa', backgroundColor: '#00000066',
      padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(200);

    this.game.events.on(INVENTORY_CHANGED, this.onInventoryChanged, this);
    this.events.on('resource-gathered', this.onResourceGathered, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    this.authSubscription = onAuthStateChange((_event, session) => {
      this.updateAuthHud(describeAuthStatus(session));
      if (this.saveEnabled) this.queueCurrentSave('Saving...');
    });

    void this.bootstrapCloudSave().catch((error: unknown) => {
      console.warn('[matlu] Homestead cloud save setup failed', error);
      this.saveEnabled = false;
      this.setSaveStatus('Cloud save unavailable');
    });
  }

  update(): void {
    // ── Player movement (keyboard + joystick + auto-walk) ─────────────────
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Keyboard
    let vx = (this.wasd.right.isDown ? 1 : 0) - (this.wasd.left.isDown ? 1 : 0);
    let vy = (this.wasd.down.isDown ? 1 : 0) - (this.wasd.up.isDown ? 1 : 0);

    // Joystick overrides keyboard if active
    if (this.joystick && this.joystick.force > 4) {
      vx = Math.cos(this.joystick.rotation);
      vy = Math.sin(this.joystick.rotation);
    }

    // Manual input cancels auto-walk target
    if ((vx !== 0 || vy !== 0) && this.targetNode) {
      this.targetNode.setTargeted(false);
      this.targetNode = null;
    }

    // Auto-walk toward targeted node
    if (this.targetNode && vx === 0 && vy === 0) {
      const t = this.targetNode.targetPos;
      const dx = t.x - this.player.x;
      const dy = t.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 10) {
        // Walk toward target
        vx = dx / dist;
        vy = dy / dist;
      } else {
        // Arrived — the overlap will trigger auto-gather via setPlayerInRange
        this.targetNode = null;
      }
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

    this.maybeQueuePositionSave();
  }

  private async bootstrapCloudSave(): Promise<void> {
    this.updateAuthHud(describeAuthStatus(null));
    const session = await getOrSignInAnon();
    this.updateAuthHud(describeAuthStatus(session));

    const save = await loadSave();
    if (save) {
      this.applySave(save);
      this.setSaveStatus('Cloud save loaded');
    } else {
      this.setSaveStatus('New cloud save');
    }

    this.saveEnabled = session !== null;
    this.lastQueuedPlayerPos = { x: this.player.x, y: this.player.y };
    this.queueCurrentSave('Saved');
  }

  private createAuthHud(): void {
    const cam = this.cameras.main;
    const panelW = 230;
    const panelH = 48;
    const x = cam.width - panelW - 8;
    const y = 8;

    this.authPanelBg = this.add.rectangle(x, y, panelW, panelH, 0x07120b, 0.78)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x6faa79, 0.6)
      .setScrollFactor(0)
      .setDepth(300);

    this.authPillText = this.add.text(x + 8, y + 6, 'Connecting...', {
      fontSize: '10px',
      color: '#d8ffe0',
      fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(301);

    this.authActionText = this.add.text(x + panelW - 8, y + 6, 'Sign in', {
      fontSize: '10px',
      color: '#ffe066',
      fontStyle: 'bold',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(301).setInteractive({ useHandCursor: true });

    this.saveStatusText = this.add.text(x + 8, y + 26, 'Cloud save starting...', {
      fontSize: '9px',
      color: '#9fc79f',
    }).setScrollFactor(0).setDepth(301);

    this.authActionText.on('pointerdown', () => {
      void this.handleAuthAction().catch((error: unknown) => {
        console.warn('[matlu] Homestead auth action failed', error);
        this.setSaveStatus('Auth failed');
      });
    });
  }

  private updateAuthHud(status: HomesteadAuthStatus): void {
    this.authStatus = status;
    this.authPillText.setText(status.label.length > 24 ? `${status.label.slice(0, 23)}...` : status.label);
    this.authPillText.setColor(status.kind === 'offline' ? '#ffb3b3' : '#d8ffe0');

    if (status.kind === 'signed-in') {
      this.authActionText.setText('Sign out');
    } else if (status.kind === 'guest') {
      this.authActionText.setText('Sign in');
    } else {
      this.authActionText.setText('Retry');
    }

    this.authPanelBg.setStrokeStyle(1, status.kind === 'offline' ? 0xaa6666 : 0x6faa79, 0.6);
    if (!this.saveEnabled) {
      this.saveStatusText.setText(status.detail);
    }
  }

  private async handleAuthAction(): Promise<void> {
    if (this.authStatus?.kind === 'signed-in') {
      this.queueCurrentSave('Saving before sign out...');
      await flushSave();
      await signOut();
      const session = await getOrSignInAnon();
      this.updateAuthHud(describeAuthStatus(session));
      this.saveEnabled = session !== null;
      this.queueCurrentSave('Signed out to Guest');
      return;
    }

    if (this.authStatus?.kind === 'offline') {
      const session = await getOrSignInAnon();
      this.updateAuthHud(describeAuthStatus(session));
      this.saveEnabled = session !== null;
      if (session) this.queueCurrentSave('Cloud save ready');
      return;
    }

    this.openLoginModal();
  }

  private openLoginModal(): void {
    if (this.loginModal) return;

    const cam = this.cameras.main;
    const modal = this.add.container(0, 0).setScrollFactor(0).setDepth(500);
    const overlay = this.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0.55).setOrigin(0, 0);
    const panel = this.add.rectangle(cam.width / 2, cam.height / 2, 320, 150, 0x101820, 0.96)
      .setStrokeStyle(2, 0x88cc88, 0.85);
    const title = this.add.text(cam.width / 2, cam.height / 2 - 54, 'Save your Homestead', {
      fontSize: '16px',
      color: '#d8ffe0',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const body = this.add.text(cam.width / 2, cam.height / 2 - 22, 'Send a magic link to upgrade this guest save.', {
      fontSize: '11px',
      color: '#c7d6c7',
      wordWrap: { width: 270 },
      align: 'center',
    }).setOrigin(0.5);
    const emailButton = this.add.rectangle(cam.width / 2, cam.height / 2 + 24, 210, 30, 0x335533, 0.95)
      .setStrokeStyle(1, 0xaaccaa, 0.85)
      .setInteractive({ useHandCursor: true });
    const emailLabel = this.add.text(cam.width / 2, cam.height / 2 + 24, 'Sign in with email', {
      fontSize: '12px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const cancelLabel = this.add.text(cam.width / 2, cam.height / 2 + 58, 'Cancel', {
      fontSize: '11px',
      color: '#bbbbbb',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    modal.add([overlay, panel, title, body, emailButton, emailLabel, cancelLabel]);
    this.loginModal = modal;

    emailButton.on('pointerdown', () => this.promptForMagicLink());
    emailLabel.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.promptForMagicLink());
    cancelLabel.on('pointerdown', () => this.closeLoginModal());
  }

  private closeLoginModal(): void {
    this.loginModal?.destroy(true);
    this.loginModal = null;
  }

  private promptForMagicLink(): void {
    const email = window.prompt('Email address for your Homestead save');
    if (!email) return;

    this.closeLoginModal();
    this.setSaveStatus('Sending magic link...');
    void this.submitMagicLink(email).catch((error: unknown) => {
      console.warn('[matlu] Homestead magic link failed', error);
      this.setSaveStatus('Magic link failed');
    });
  }

  private async submitMagicLink(email: string): Promise<void> {
    await sendMagicLink(email);
    const session = await getCurrentSession();
    this.updateAuthHud(describeAuthStatus(session));
    this.setSaveStatus('Check your email for the magic link');
  }

  private applySave(save: HomesteadSaveState): void {
    this.inventory.replaceAll(save.inventory.map((item) => [item.id, item.qty]));

    this.player.setPosition(
      Phaser.Math.Clamp(save.player.x, 0, WORLD_W),
      Phaser.Math.Clamp(save.player.y, 0, WORLD_H),
    );
    (this.player.body as Phaser.Physics.Arcade.Body).reset(this.player.x, this.player.y);

    const nodeStateById = new Map(save.nodes.map((node) => [node.id, node]));
    for (const node of this.resourceNodes) {
      const savedNode = nodeStateById.get(node.saveId);
      if (!savedNode) continue;
      node.applySavedState(savedNode.state, savedNode.respawnAt);
    }
  }

  private captureSaveState(): HomesteadSaveState {
    return {
      version: HOMESTEAD_SAVE_VERSION,
      inventory: this.inventory.entries().map(([id, qty]) => ({ id, qty })),
      nodes: this.resourceNodes.map((node) => ({
        id: node.saveId,
        state: node.nodeState,
        respawnAt: node.respawnAt,
      })),
      player: {
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
      },
    };
  }

  private onInventoryChanged(): void {
    this.queueCurrentSave('Saving...');
  }

  private onResourceGathered(): void {
    this.queueCurrentSave('Saving...');
  }

  private maybeQueuePositionSave(): void {
    if (!this.saveEnabled || !this.lastQueuedPlayerPos) return;

    const dx = this.player.x - this.lastQueuedPlayerPos.x;
    const dy = this.player.y - this.lastQueuedPlayerPos.y;
    if (dx * dx + dy * dy < 64) return;

    this.lastQueuedPlayerPos = { x: this.player.x, y: this.player.y };
    this.queueCurrentSave('Saving...');
  }

  private queueCurrentSave(status: string): void {
    if (!this.saveEnabled) return;

    queueSave(this.captureSaveState());
    this.setSaveStatus(status);
  }

  private setSaveStatus(status: string): void {
    this.saveStatusText.setText(status);
  }

  private onShutdown(): void {
    this.game.events.off(INVENTORY_CHANGED, this.onInventoryChanged, this);
    this.events.off('resource-gathered', this.onResourceGathered, this);
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;

    if (this.saveEnabled) {
      queueSave(this.captureSaveState());
      void flushSave().catch((error: unknown) => {
        console.warn('[matlu] Homestead shutdown save failed', error);
      });
    }
  }
}
