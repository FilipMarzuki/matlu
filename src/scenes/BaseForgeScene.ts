/**
 * BaseForgeScene — interactive testbed for the player base placement system.
 *
 * Shows an iso grid centered on the base anchor. Click to place structures
 * from a toolbar. Structures persist via BaseManager (localStorage).
 *
 * Routes: /base, /baseforge
 * Controls:
 *   Click          — place selected structure (or establish anchor)
 *   Right-click    — dismantle structure at cursor
 *   1-9            — select structure from toolbar
 *   Scroll         — zoom
 *   Middle-drag    — pan
 *   R              — reset base (wipe all)
 */

import * as Phaser from 'phaser';
import { BaseManager, BASE_EVENTS } from '../systems/BaseManager';
import { InventorySystem } from '../systems/InventorySystem';
import { InventoryHUD } from '../ui/InventoryHUD';

// ── Placeable structure definitions ─────────────────────────────────────────

interface ToolbarItem {
  itemId: string;
  label: string;
  color: number;
  spriteKey?: string;
}

const TOOLBAR: ToolbarItem[] = [
  { itemId: 'campfire',            label: 'Campfire',       color: 0xff6633, spriteKey: 'iki-campfire' },
  { itemId: 'lean-to',             label: 'Lean-To',        color: 0x8b6914 },
  { itemId: 'tent',                label: 'Tent',           color: 0xaa8844 },
  { itemId: 'struct-workbench',    label: 'Workbench',      color: 0xcc8844 },
  { itemId: 'struct-storage-chest',label: 'Storage Chest',  color: 0x666699 },
  { itemId: 'struct-drying-rack',  label: 'Drying Rack',    color: 0x996633 },
  { itemId: 'struct-rain-catcher', label: 'Rain Catcher',   color: 0x4488cc },
  { itemId: 'struct-field-forge',  label: 'Field Forge',    color: 0xcc4444 },
  { itemId: 'struct-palisade',     label: 'Palisade',       color: 0x5a3a1a },
  { itemId: 'struct-watchtower',   label: 'Watchtower',     color: 0x888844 },
  { itemId: 'struct-generator',    label: 'Generator',      color: 0x44aacc },
  { itemId: 'struct-mech-dock',    label: 'Mech Dock',      color: 0x4466aa },
  { itemId: 'struct-beacon',       label: 'Beacon',         color: 0xffaa33 },
];

// ── Scene ───────────────────────────────────────────────────────────────────

export class BaseForgeScene extends Phaser.Scene {
  static readonly KEY = 'BaseForgeScene';

  constructor() { super({ key: BaseForgeScene.KEY }); }

  // ── Iso grid ────────────────────────────────────────────────────────────
  private zoomFactor = 2.5;
  private get ISO_W() { return 24 * this.zoomFactor; }
  private get ISO_H() { return 12 * this.zoomFactor; }
  private originX = 0;
  private originY = 0;

  // ── State ───────────────────────────────────────────────────────────────
  private base!: BaseManager;
  private selectedIdx = 0;

  // ── Display objects ─────────────────────────────────────────────────────
  private groundGfx: Phaser.GameObjects.Graphics | null = null;
  private structureObjects: Phaser.GameObjects.GameObject[] = [];
  private labelObjects: Phaser.GameObjects.Text[] = [];

  // ── DOM ─────────────────────────────────────────────────────────────────
  private controlPanel: HTMLDivElement | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    // Resource definitions for InventoryHUD display names
    this.load.json('resources', '/macro-world/resources.json');

    // Building sprites (shared cache with other forge scenes)
    const ikiBase = '/assets/packs/building-objects/ikibeki';
    this.load.image('iki-campfire',       `${ikiBase}/campfire.png`);
    this.load.image('iki-well',           `${ikiBase}/well.png`);
    this.load.image('iki-shelter-hut',    `${ikiBase}/shelter-hut.png`);
    this.load.image('iki-cottage',        `${ikiBase}/cottage.png`);
    this.load.image('iki-smithy',         `${ikiBase}/smithy.png`);
    this.load.image('iki-watchtower',     `${ikiBase}/watchtower.png`);
    this.load.image('iki-palisade-gate',  `${ikiBase}/palisade-gate.png`);
  }

  create(): void {
    this.base = new BaseManager(this.game);
    this.base.setEmitter(this.events);

    this.cameras.main.setBackgroundColor('#1a1a2e');

    // ── Inventory + HUD (test harness) ────────────────────────────────────
    const inv = new InventorySystem(this);
    // Load resource defs for display names
    const resDefs = this.cache.json.get('resources') as { resources: { id: string; name: string; category: string; stackMax: number }[] } | undefined;
    if (resDefs?.resources) inv.loadResourceDefs(resDefs.resources as never[]);
    // Seed with some test items so the HUD has something to show
    inv.add('wood-log', 8); inv.add('stone', 6); inv.add('iron-ore', 5);
    inv.add('plant-fiber', 12); inv.add('herb-green', 3); inv.add('coal', 2);
    inv.add('cooked-meat', 4); inv.add('bandage', 2); inv.add('healing-salve', 1);
    inv.add('rope', 3); inv.add('cloth', 2); inv.add('iron-ingot', 2);
    new InventoryHUD(this, inv);

    // ── Keyboard ──────────────────────────────────────────────────────────
    const kb = this.input.keyboard!;

    // Number keys select toolbar item
    for (let i = 0; i < 9; i++) {
      const keyName = `${i + 1}`;
      kb.on(`keydown-${keyName}`, () => {
        if (i < TOOLBAR.length) { this.selectedIdx = i; this.updateControlPanel(); }
      });
    }

    kb.on('keydown-R', () => { this.base.reset(); this.rebuild(); this.updateControlPanel(); });

    // ── Zoom ──────────────────────────────────────────────────────────────
    const applyZoom = (factor: number) => {
      this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor * factor, 0.5, 6.0);
      this.rebuild();
    };
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, dy: number) =>
      applyZoom(dy > 0 ? 0.88 : 1.0 / 0.88));

    // ── Pan (middle-drag) ─────────────────────────────────────────────────
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!ptr.isDown) return;
      if (ptr.button === 1) {
        const cam = this.cameras.main;
        cam.scrollX -= (ptr.x - ptr.prevPosition.x) / cam.zoom;
        cam.scrollY -= (ptr.y - ptr.prevPosition.y) / cam.zoom;
      }
    });

    // ── Click to place / right-click to dismantle ─────────────────────────
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.button === 0) this.handlePlace(ptr);
      if (ptr.button === 2) this.handleDismantle(ptr);
    });
    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

    // ── Events ────────────────────────────────────────────────────────────
    this.events.on(BASE_EVENTS.STRUCTURE_PLACED, () => { this.rebuild(); this.updateControlPanel(); });
    this.events.on(BASE_EVENTS.STRUCTURE_DISMANTLED, () => { this.rebuild(); this.updateControlPanel(); });
    this.events.on(BASE_EVENTS.ESTABLISHED, () => { this.rebuild(); this.updateControlPanel(); });
    this.events.on(BASE_EVENTS.TIER_CHANGED, () => { this.rebuild(); this.updateControlPanel(); });

    this.buildControlPanel();
    this.rebuild();
  }

  shutdown(): void {
    if (this.controlPanel) { this.controlPanel.remove(); this.controlPanel = null; }
  }

  // ── Iso helpers ─────────────────────────────────────────────────────────

  private isoPos(tx: number, ty: number): { x: number; y: number } {
    return {
      x: this.originX + (tx - ty) * (this.ISO_W / 2),
      y: this.originY + (tx + ty) * (this.ISO_H / 2),
    };
  }

  private screenToTile(screenX: number, screenY: number): { tx: number; ty: number } {
    const cam = this.cameras.main;
    const wx = screenX / cam.zoom + cam.scrollX;
    const wy = screenY / cam.zoom + cam.scrollY;
    const dx = wx - this.originX;
    const dy = wy - this.originY;
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;
    // Inverse iso: tx = (dx/hw + dy/hh) / 2, ty = (dy/hh - dx/hw) / 2
    const tx = Math.round((dx / hw + dy / hh) / 2);
    const ty = Math.round((dy / hh - dx / hw) / 2);
    return { tx, ty };
  }

  private drawIsoDiamond(
    gfx: Phaser.GameObjects.Graphics,
    tx: number, ty: number,
    fillColor: number, fillAlpha: number,
    strokeColor?: number, strokeAlpha?: number,
  ): void {
    const { x, y } = this.isoPos(tx, ty);
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;
    gfx.fillStyle(fillColor, fillAlpha);
    gfx.beginPath();
    gfx.moveTo(x, y);
    gfx.lineTo(x + hw, y + hh);
    gfx.lineTo(x, y + hh * 2);
    gfx.lineTo(x - hw, y + hh);
    gfx.closePath();
    gfx.fillPath();
    if (strokeColor !== undefined) {
      gfx.lineStyle(1, strokeColor, strokeAlpha ?? 0.3);
      gfx.beginPath();
      gfx.moveTo(x, y);
      gfx.lineTo(x + hw, y + hh);
      gfx.lineTo(x, y + hh * 2);
      gfx.lineTo(x - hw, y + hh);
      gfx.closePath();
      gfx.strokePath();
    }
  }

  // ── Placement handlers ────────────────────────────────────────────────

  private handlePlace(ptr: Phaser.Input.Pointer): void {
    const { tx, ty } = this.screenToTile(ptr.x, ptr.y);
    const item = TOOLBAR[this.selectedIdx];

    if (!this.base.isEstablished()) {
      // First placement establishes the anchor
      if (item.itemId === 'campfire') {
        this.base.establish(0, 0); // world coords don't matter in forge mode
      }
      return;
    }

    this.base.place(item.itemId, tx, ty);
  }

  private handleDismantle(ptr: Phaser.Input.Pointer): void {
    const { tx, ty } = this.screenToTile(ptr.x, ptr.y);
    this.base.dismantle(tx, ty);
  }

  // ── Rebuild ─────────────────────────────────────────────────────────────

  private rebuild(): void {
    this.groundGfx?.destroy();
    this.groundGfx = null;
    for (const obj of this.structureObjects) obj.destroy();
    this.structureObjects = [];
    for (const lbl of this.labelObjects) lbl.destroy();
    this.labelObjects = [];

    const { width, height } = this.cameras.main;
    this.originX = width / 2;
    this.originY = height * 0.35;

    const gfx = this.add.graphics();
    this.groundGfx = gfx;

    if (!this.base.isEstablished()) {
      this.renderEmptyPrompt();
      return;
    }

    this.renderGround(gfx);
    this.renderRadius(gfx);
    this.renderStructures(gfx);
    this.renderHUD();
  }

  // ── Render: empty state ─────────────────────────────────────────────────

  private renderEmptyPrompt(): void {
    const { width, height } = this.cameras.main;
    const msg = this.add.text(width / 2, height / 2,
      'Select Campfire (1) and click to establish your base', {
        fontSize: '16px', color: '#ffaa33', backgroundColor: '#000000aa',
        padding: { x: 12, y: 8 },
      }).setOrigin(0.5).setDepth(200).setScrollFactor(0);
    this.labelObjects.push(msg);

    // Draw a small grid anyway
    const gfx = this.groundGfx!;
    for (let ty = -3; ty <= 3; ty++) {
      for (let tx = -3; tx <= 3; tx++) {
        this.drawIsoDiamond(gfx, tx, ty, 0x2d6b2e, 0.2, 0x1a4a1a, 0.15);
      }
    }
  }

  // ── Render: ground grid ─────────────────────────────────────────────────

  private renderGround(gfx: Phaser.GameObjects.Graphics): void {
    const r = this.base.getRadius() + 2; // show a few tiles beyond radius
    for (let ty = -r; ty <= r; ty++) {
      for (let tx = -r; tx <= r; tx++) {
        const inRange = Math.abs(tx) <= this.base.getRadius() && Math.abs(ty) <= this.base.getRadius();
        this.drawIsoDiamond(gfx, tx, ty,
          inRange ? 0x2d6b2e : 0x1a3a1a,
          inRange ? 0.35 : 0.15,
          0x1a4a1a, 0.2);
      }
    }
  }

  // ── Render: radius boundary ─────────────────────────────────────────────

  private renderRadius(gfx: Phaser.GameObjects.Graphics): void {
    const r = this.base.getRadius();
    gfx.lineStyle(2, 0xffaa33, 0.4);

    // Draw diamond boundary at radius
    const corners = [
      this.isoPos(-r, -r),   // top
      this.isoPos(r, -r),    // right
      this.isoPos(r, r),     // bottom
      this.isoPos(-r, r),    // left
    ];
    // Offset to tile centers
    const hh = this.ISO_H / 2;
    gfx.beginPath();
    gfx.moveTo(corners[0].x, corners[0].y + hh);
    gfx.lineTo(corners[1].x + this.ISO_W / 2, corners[1].y + hh);
    gfx.lineTo(corners[2].x, corners[2].y + hh + this.ISO_H);
    gfx.lineTo(corners[3].x - this.ISO_W / 2, corners[3].y + hh);
    gfx.closePath();
    gfx.strokePath();
  }

  // ── Render: placed structures ───────────────────────────────────────────

  private renderStructures(gfx: Phaser.GameObjects.Graphics): void {
    const structures = this.base.getStructures();
    // Sort by depth (back to front)
    const sorted = [...structures].sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));

    for (const s of sorted) {
      const toolbarItem = TOOLBAR.find(t => t.itemId === s.itemId);
      const color = toolbarItem?.color ?? 0x888888;

      if (toolbarItem?.spriteKey && this.textures.exists(toolbarItem.spriteKey)) {
        const { x, y } = this.isoPos(s.tx, s.ty);
        const scale = this.ISO_W / 32;
        const img = this.add.image(x, y + this.ISO_H / 2, toolbarItem.spriteKey);
        img.setScale(scale);
        img.setDepth(10 + s.tx + s.ty);
        this.structureObjects.push(img);
      } else {
        this.drawIsoDiamond(gfx, s.tx, s.ty, color, 0.7, 0xffffff, 0.5);
      }

      // Label
      const { x: lx, y: ly } = this.isoPos(s.tx, s.ty);
      const label = this.add.text(lx, ly + this.ISO_H + 2,
        toolbarItem?.label ?? s.itemId, {
          fontSize: '8px', color: '#cccccc', backgroundColor: '#00000088',
          padding: { x: 2, y: 1 },
        }).setOrigin(0.5, 0).setDepth(100);
      this.labelObjects.push(label);
    }

    // Anchor marker at (0,0)
    this.drawIsoDiamond(gfx, 0, 0, 0xffaa33, 0.3, 0xffaa33, 0.6);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────

  private renderHUD(): void {
    const state = this.base.getState();
    if (!state) return;

    const lines = [
      `Base Tier: ${state.tier} (${state.mainShelter})`,
      `Structures: ${state.structures.length} / ${this.base.getMaxStructures()}`,
      `Radius: ${this.base.getRadius()} tiles`,
      '',
      'Click — place selected',
      'Right-click — dismantle',
      '1-9 — select item',
      'R — reset base',
      'Scroll — zoom',
    ];
    const hud = this.add.text(8, 8, lines.join('\n'), {
      fontSize: '12px', color: '#ffffff', backgroundColor: '#000000aa',
      padding: { x: 8, y: 6 }, lineSpacing: 4,
    }).setDepth(200).setScrollFactor(0);
    this.labelObjects.push(hud);
  }

  // ── DOM control panel (toolbar) ─────────────────────────────────────────

  private buildControlPanel(): void {
    if (this.controlPanel) return;
    const panel = document.createElement('div');
    panel.id = 'base-control-panel';
    panel.style.cssText = `
      position: fixed; bottom: 8px; left: 50%; transform: translateX(-50%);
      background: #1a1a2eee; color: #ccc; font: 11px monospace;
      padding: 8px 12px; border-radius: 6px; z-index: 1000;
      border: 1px solid #333; display: flex; gap: 6px; align-items: center;
    `;
    this.controlPanel = panel;
    document.body.appendChild(panel);
    this.updateControlPanel();
  }

  private updateControlPanel(): void {
    if (!this.controlPanel) return;

    const buttons = TOOLBAR.map((item, i) => {
      const selected = i === this.selectedIdx;
      const hex = '#' + item.color.toString(16).padStart(6, '0');
      return `<button
        data-idx="${i}"
        style="
          background: ${selected ? hex : '#222'};
          color: ${selected ? '#fff' : '#aaa'};
          border: 2px solid ${selected ? '#fff' : hex};
          padding: 4px 8px; border-radius: 4px; cursor: pointer;
          font: 10px monospace; white-space: nowrap;
        "
        title="${item.label} (${i + 1})"
      >${i + 1}: ${item.label}</button>`;
    }).join('');

    const tier = this.base.isEstablished()
      ? `<span style="color:#ffaa33;">T${this.base.getTier()} | ${this.base.getStructures().length}/${this.base.getMaxStructures()}</span>`
      : '<span style="color:#888;">No base</span>';

    this.controlPanel.innerHTML = `${tier} │ ${buttons}`;

    // Wire click handlers
    this.controlPanel.querySelectorAll('button[data-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedIdx = parseInt((btn as HTMLElement).dataset.idx!, 10);
        this.updateControlPanel();
      });
    });
  }
}
