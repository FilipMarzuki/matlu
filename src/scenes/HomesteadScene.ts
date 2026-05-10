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
 * Cloud save (#851): on boot we sign the player in (anonymously by default)
 * and pull their last save. Subsequent inventory/node/position changes are
 * debounced and upserted to Supabase. Magic-link sign-in upgrades the anon
 * account in place — same user_id, same save row.
 *
 * Route: /homestead
 * Controls:
 *   WASD / Arrow keys — move
 *   E — interact with nearby resource node
 *   C — open crafting menu
 *   I — toggle inventory panel
 */

import * as Phaser from 'phaser';
import { InventorySystem, INVENTORY_CHANGED } from '../systems/InventorySystem';
import { InventoryHUD } from '../ui/InventoryHUD';
import { ResourceNode, type ResourceNodeTypeDef } from '../entities/ResourceNode';
import { SimpleJoystick } from '../lib/SimpleJoystick';
import { ensureSession, sendMagicLink, signOutAndAnon, getAuthInfo } from '../lib/auth';
import {
  loadSave,
  queueSave,
  flushSave,
  SAVE_VERSION,
  type HomesteadState,
} from '../lib/homesteadSave';
import { supabase } from '../lib/supabaseClient';

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

  /** Cached inventory reference so save snapshots don't re-read the registry. */
  private inv!: InventorySystem;
  /** Supabase user id; null until ensureSession() resolves (or if Supabase isn't configured). */
  private userId: string | null = null;
  /** Auth pill text — updated on sign in / sign out / email upgrade. */
  private authPill: Phaser.GameObjects.Text | null = null;
  /** Pending visibility/unload listener so we can clean up on shutdown. */
  private onPageHide: (() => void) | null = null;
  /** Toast text used for sign-in feedback ("Magic link sent…", errors). */
  private toast: Phaser.GameObjects.Text | null = null;

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
    this.inv = inv;
    const resDefs = this.cache.json.get('resources') as { resources: { id: string; name: string; category: string; stackMax: number }[] } | undefined;
    if (resDefs?.resources) inv.loadResourceDefs(resDefs.resources as never[]);
    // Starter items only seed the inventory when localStorage is empty AND
    // the cloud load won't replace them. Easiest: only seed if inventory
    // is currently empty after restore.
    if (inv.slotCount === 0) {
      inv.add('flint', 4);
      inv.add('dry-grass', 6);
    }

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

      // defCount tracks how many of each type we've placed so far, so we can
      // assign stable per-placement IDs like `tree-0`, `tree-1`. The save
      // file references nodes by these IDs.
      const defCount: Record<string, number> = {};
      for (const p of placements) {
        const def = nodeDefs.nodeTypes.find(d => d.id === p.defId);
        if (!def) continue;
        const node = new ResourceNode(this, p.x, p.y, def, inv);
        const idx = defCount[p.defId] ?? 0;
        defCount[p.defId] = idx + 1;
        node.nodeId = `${p.defId}-${idx}`;
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

    this.add.text(8, 8, 'Homestead Mode', {
      fontSize: '11px', color: '#aaccaa', backgroundColor: '#00000066',
      padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(200);

    // Auth pill (top-right) — shows current sign-in status; tap to manage.
    this.authPill = this.add.text(cam.width - 8, 8, 'Loading…', {
      fontSize: '11px', color: '#cccccc', backgroundColor: '#00000066',
      padding: { x: 8, y: 4 },
    })
      .setOrigin(1, 0)
      .setScrollFactor(0).setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.authPill.on('pointerup', () => this.openAuthMenu());

    this.toast = this.add.text(cam.width / 2, 40, '', {
      fontSize: '12px', color: '#ffe066', backgroundColor: '#000000aa',
      padding: { x: 10, y: 6 },
    })
      .setOrigin(0.5, 0)
      .setScrollFactor(0).setDepth(300)
      .setVisible(false);

    // ── Cloud save lifecycle ──────────────────────────────────────────────
    void this.bootSave();

    this.events.on('resource-gathered', () => this.scheduleSave());
    this.events.on('resource-node:respawned', () => this.scheduleSave());
    this.game.events.on(INVENTORY_CHANGED, this.scheduleSave, this);

    // Page-hide flush: tablets background tabs aggressively, so push the
    // pending save before the browser cuts the network. visibilitychange
    // fires on tab switch / app background; pagehide on actual unload.
    this.onPageHide = () => { if (this.userId) void flushSave(this.userId); };
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onPageHide);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.onShutdown());
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
  }

  // ── Cloud save ───────────────────────────────────────────────────────────

  private async bootSave(): Promise<void> {
    const session = await ensureSession();
    if (!session) {
      // Supabase not configured (dev without .env) or anon sign-in failed —
      // fall back to localStorage-only mode. Inventory still persists locally
      // via InventorySystem._persist(); just no cross-device sync.
      this.setAuthPill('Offline');
      return;
    }
    this.userId = session.user.id;
    this.refreshAuthPill();

    // Pull saved state and apply it. If there's no row yet, the scene keeps
    // the defaults the InventorySystem and node placements already set up.
    const saved = await loadSave(this.userId);
    if (saved) this.applySave(saved);
  }

  /** Replace inventory + node states + player pos with the saved snapshot. */
  private applySave(state: HomesteadState): void {
    if (state.inventory && Array.isArray(state.inventory)) {
      const map: Record<string, number> = {};
      for (const e of state.inventory) {
        if (e?.id && typeof e.qty === 'number') map[e.id] = e.qty;
      }
      this.inv.replaceAll(map);
    }
    if (state.nodes && Array.isArray(state.nodes)) {
      const byId = new Map(state.nodes.map(n => [n.id, n]));
      for (const node of this.resourceNodes) {
        const saved = byId.get(node.nodeId);
        if (saved) node.applyLoadedState(saved.state, saved.respawnAt);
      }
    }
    if (state.player && typeof state.player.x === 'number' && typeof state.player.y === 'number') {
      this.player.setPosition(state.player.x, state.player.y);
    }
  }

  /** Snapshot current state for saving. */
  private snapshot(): HomesteadState {
    return {
      version: SAVE_VERSION,
      inventory: this.inv.entries().map(([id, qty]) => ({ id, qty })),
      nodes: this.resourceNodes.map(n => ({
        id: n.nodeId,
        state: n.nodeState,
        respawnAt: n.getRespawnAt(),
      })),
      player: { x: this.player.x, y: this.player.y },
    };
  }

  /** Hook for any change event — debounced upsert lives in homesteadSave.ts. */
  private scheduleSave(): void {
    if (!this.userId) return;
    queueSave(this.userId, this.snapshot());
  }

  // ── Auth UI ───────────────────────────────────────────────────────────

  private setAuthPill(text: string): void {
    this.authPill?.setText(text);
  }

  private async refreshAuthPill(): Promise<void> {
    if (!supabase) { this.setAuthPill('Offline'); return; }
    const { data } = await supabase.auth.getUser();
    const info = getAuthInfo(data.user ?? null);
    if (info.isAnonymous) {
      this.setAuthPill('Guest · Sign in');
    } else {
      this.setAuthPill(info.email ? `${info.email} ▾` : 'Signed in ▾');
    }
  }

  /** Open a tiny pop-up for sign in / sign out. Uses native prompt() on
   *  purpose — keeps the diff small, works fine on tablets. A nicer modal
   *  is a follow-up. */
  private async openAuthMenu(): Promise<void> {
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    const info = getAuthInfo(data.user ?? null);

    if (info.isAnonymous || !info.email) {
      const email = window.prompt('Sign in with magic link\n\nEnter your email:')?.trim();
      if (!email) return;
      this.showToast('Sending magic link…');
      const res = await sendMagicLink(email);
      if (res.ok) this.showToast('Check your email for the sign-in link.', 5000);
      else this.showToast(`Sign-in failed: ${res.error}`, 5000);
      return;
    }

    // Already signed in — offer to sign out.
    const ok = window.confirm(`Signed in as ${info.email}.\n\nSign out? Your save will keep working as a Guest on this device.`);
    if (!ok) return;
    await signOutAndAnon();
    await this.refreshAuthPill();
    this.showToast('Signed out.');
  }

  private showToast(text: string, ms = 2500): void {
    if (!this.toast) return;
    this.toast.setText(text).setVisible(true);
    this.time.delayedCall(ms, () => this.toast?.setVisible(false));
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  private onShutdown(): void {
    this.game.events.off(INVENTORY_CHANGED, this.scheduleSave, this);
    if (this.onPageHide) {
      window.removeEventListener('pagehide', this.onPageHide);
      document.removeEventListener('visibilitychange', this.onPageHide);
      this.onPageHide = null;
    }
    if (this.userId) void flushSave(this.userId);
  }
}
