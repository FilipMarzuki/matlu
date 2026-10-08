/**
 * InventoryHUD — three-layer inventory display following Zelda BOTW / Elden Ring
 * philosophy: show almost nothing, let the player pull up info on demand.
 *
 * **Layer 1 — Active Item Badge** (always visible, bottom-right)
 *   One selected consumable/tool with colored square + stack count.
 *   Tap to use, swipe/D-pad to cycle.
 *
 * **Layer 2 — Quick Panel** (toggle with I key or tap badge)
 *   Slides out from right edge, categorized item list, tap to select active.
 *
 * **Layer 3 — Full Inventory** (CraftingMenuScene Pack tab — no changes needed)
 *
 * Usage: `new InventoryHUD(scene, inventorySystem)` in any scene's create().
 */

import * as Phaser from 'phaser';
import {
  type InventorySystem,
  INVENTORY_CHANGED,
  type ItemCategory,
} from '../systems/InventorySystem';
import { playerItems, type RegistryItem } from '../lib/items';
import { Color, TextColor, Font, Depth, Space } from './theme';

// ── Constants ───────────────────────────────────────────────────────────────

const DEPTH_BADGE = Depth.HUD;
const DEPTH_PANEL = Depth.HUD + 5;  // panel renders above badge when open

const BADGE_SIZE = 40;
const BADGE_PAD  = Space.md;

const PANEL_W    = 140;
const ROW_H      = 20;
const HEADER_H   = 22;
const SLIDE_MS   = 200;

/** Display order + colors for each category in the quick panel. */
const CATEGORY_ORDER: { key: ItemCategory; label: string; color: number }[] = [
  { key: 'consumable', label: 'Consumables',  color: 0xcc4444 },
  { key: 'equipment',  label: 'Equipment',    color: 0xcc8844 },
  { key: 'raw',        label: 'Raw',          color: 0x88aa44 },
  { key: 'refined',    label: 'Refined',      color: 0x4488cc },
  { key: 'component',  label: 'Components',   color: 0x999999 },
  { key: 'structure',  label: 'Structures',   color: 0x8b6914 },
  { key: 'deployable', label: 'Deployables',  color: 0x44aacc },
];

const CATEGORY_COLOR_MAP = new Map(CATEGORY_ORDER.map(c => [c.key, c.color]));

// ── HUD Events ──────────────────────────────────────────────────────────────

export const INV_HUD_USE            = 'inventory-hud:use';
export const INV_HUD_ACTIVE_CHANGED = 'inventory-hud:active-changed';

// ── Class ───────────────────────────────────────────────────────────────────

export class InventoryHUD {
  // ── Layer 1: badge ────────────────────────────────────────────────────
  private badge!: Phaser.GameObjects.Container;
  private badgeBg!: Phaser.GameObjects.Graphics;
  private badgeIcon!: Phaser.GameObjects.Rectangle;
  private badgeQty!: Phaser.GameObjects.Text;
  private slotLabel!: Phaser.GameObjects.Text;

  // ── Layer 2: panel ────────────────────────────────────────────────────
  private panel!: Phaser.GameObjects.Container;
  private panelBg!: Phaser.GameObjects.Graphics;
  private panelRows: Phaser.GameObjects.GameObject[] = [];
  private expanded = false;

  // ── State ─────────────────────────────────────────────────────────────
  private activeItemId: string | null = null;
  private resourceDefs = new Map<string, { name: string; category: ItemCategory }>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly inventory: InventorySystem,
  ) {
    this._loadResourceDefs();
    this._buildBadge();
    this._buildPanel();
    this._bindInput();
    this._updateBadge();

    // React to inventory changes
    scene.game.events.on(INVENTORY_CHANGED, this._onInventoryChanged, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this._dispose, this);
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Top-level game objects that should be registered with a UI camera. */
  getUIObjects(): Phaser.GameObjects.GameObject[] {
    return [this.badge, this.slotLabel, this.panel];
  }

  toggle(): void {
    this.expanded = !this.expanded;
    if (this.expanded) {
      this._rebuildPanel();
      this.scene.tweens.add({
        targets: this.panel,
        x: this.scene.cameras.main.width - PANEL_W,
        duration: SLIDE_MS,
        ease: 'Power2',
      });
    } else {
      this.scene.tweens.add({
        targets: this.panel,
        x: this.scene.cameras.main.width,
        duration: SLIDE_MS,
        ease: 'Power2',
      });
    }
  }

  cycleActiveItem(): void {
    const consumables = this._getConsumables();
    if (consumables.length === 0) { this.activeItemId = null; this._updateBadge(); return; }
    const idx = consumables.findIndex(([id]) => id === this.activeItemId);
    const next = (idx + 1) % consumables.length;
    this.activeItemId = consumables[next][0];
    this._updateBadge();
    this.scene.events.emit(INV_HUD_ACTIVE_CHANGED, { itemId: this.activeItemId });
  }

  useActiveItem(): void {
    if (!this.activeItemId) return;
    if (!this.inventory.has(this.activeItemId, 1)) return;
    this.scene.events.emit(INV_HUD_USE, { itemId: this.activeItemId });
    // The scene handles the actual effect (heal, buff, etc.) and calls inventory.remove()
  }

  destroy(): void {
    this._dispose();
  }

  // ── Layer 1: Badge ────────────────────────────────────────────────────

  private _buildBadge(): void {
    const cam = this.scene.cameras.main;
    const x = cam.width - BADGE_SIZE - BADGE_PAD;
    const y = cam.height - BADGE_SIZE - BADGE_PAD - 16; // room for slot label below

    this.badge = this.scene.add.container(x, y).setScrollFactor(0).setDepth(DEPTH_BADGE);

    // Background
    this.badgeBg = this.scene.add.graphics();
    this.badgeBg.fillStyle(Color.panelBg, 0.8);
    this.badgeBg.fillRoundedRect(0, 0, BADGE_SIZE, BADGE_SIZE, 6);
    this.badgeBg.lineStyle(1, Color.slotBorder, 0.6);
    this.badgeBg.strokeRoundedRect(0, 0, BADGE_SIZE, BADGE_SIZE, 6);
    this.badge.add(this.badgeBg);

    // Item color indicator (placeholder for future icon)
    this.badgeIcon = this.scene.add.rectangle(
      BADGE_SIZE / 2, BADGE_SIZE / 2 - 2, 20, 20, 0x888888, 0.8,
    );
    this.badge.add(this.badgeIcon);

    // Stack count (bottom-right of badge)
    this.badgeQty = this.scene.add.text(BADGE_SIZE - 4, BADGE_SIZE - 4, '', {
      ...Font.tiny, color: TextColor.primary, fontStyle: 'bold',
    }).setOrigin(1, 1);
    this.badge.add(this.badgeQty);

    // Slot counter below badge
    this.slotLabel = this.scene.add.text(
      x + BADGE_SIZE / 2, y + BADGE_SIZE + 4,
      '', { ...Font.tiny, color: TextColor.secondary },
    ).setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH_BADGE);

    // Badge interaction: tap = cycle active item, long-press = use, swipe-up = panel
    const hitZone = this.scene.add.rectangle(
      x + BADGE_SIZE / 2, y + BADGE_SIZE / 2,
      BADGE_SIZE + 16, BADGE_SIZE + 16,
    ).setScrollFactor(0).setDepth(DEPTH_BADGE + 1).setInteractive().setVisible(false);

    let pressStart = 0;
    let pressY = 0;

    hitZone.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      pressStart = Date.now();
      pressY = ptr.y;
    });

    hitZone.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      const held = Date.now() - pressStart;
      const dy = pressY - ptr.y; // positive = swiped up

      if (dy > 20) {
        // Swipe up → toggle panel
        this.toggle();
      } else if (held > 400) {
        // Long press → use active item
        this.useActiveItem();
      } else {
        // Quick tap → cycle active item
        this.cycleActiveItem();
      }
    });
  }

  private _updateBadge(): void {
    const slots = this.inventory.slotCount;
    const max = this.inventory.maxSlots;
    this.slotLabel.setText(`${slots}/${max}`);

    if (this.activeItemId && this.inventory.has(this.activeItemId, 1)) {
      const qty = this.inventory.getQty(this.activeItemId);
      const def = this.resourceDefs.get(this.activeItemId);
      const color = CATEGORY_COLOR_MAP.get(def?.category ?? 'raw') ?? 0x888888;
      this.badgeIcon.setFillStyle(color, 0.8);
      this.badgeQty.setText(`${qty}`);
    } else {
      // No active item or it's gone — try to auto-select
      const consumables = this._getConsumables();
      if (consumables.length > 0) {
        this.activeItemId = consumables[0][0];
        this._updateBadge();
        return;
      }
      this.activeItemId = null;
      this.badgeIcon.setFillStyle(Color.slotBorder, 0.5);
      this.badgeQty.setText('');
    }
  }

  // ── Layer 2: Panel ────────────────────────────────────────────────────

  private _buildPanel(): void {
    const cam = this.scene.cameras.main;
    // Start offscreen right
    this.panel = this.scene.add.container(cam.width, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_PANEL);

    this.panelBg = this.scene.add.graphics();
    this.panel.add(this.panelBg);
  }

  private _rebuildPanel(): void {
    // Clear old rows
    for (const obj of this.panelRows) obj.destroy();
    this.panelRows = [];

    const cam = this.scene.cameras.main;
    const h = cam.height;

    // Background
    this.panelBg.clear();
    this.panelBg.fillStyle(Color.panelBg, 0.9);
    this.panelBg.fillRect(0, 0, PANEL_W, h);
    this.panelBg.lineStyle(1, Color.slotBorder, 0.8);
    this.panelBg.lineBetween(0, 0, 0, h);

    // Title
    const title = this.scene.add.text(8, 8, `Inventory ${this.inventory.slotCount}/${this.inventory.maxSlots}`, {
      ...Font.small, color: TextColor.primary, fontStyle: 'bold',
    });
    this.panel.add(title);
    this.panelRows.push(title);

    let y = 28;

    // Group items by category
    const items = this.inventory.getMap();
    for (const cat of CATEGORY_ORDER) {
      const catItems: [string, number][] = [];
      items.forEach((qty, id) => {
        if (qty <= 0) return;
        const def = this.resourceDefs.get(id);
        if ((def?.category ?? 'raw') === cat.key) catItems.push([id, qty]);
      });
      if (catItems.length === 0) continue;

      // Sort by quantity descending
      catItems.sort((a, b) => b[1] - a[1]);

      // Category header
      const headerBg = this.scene.add.graphics();
      headerBg.fillStyle(cat.color, 0.15);
      headerBg.fillRect(0, y, PANEL_W, HEADER_H);
      headerBg.fillStyle(cat.color, 0.8);
      headerBg.fillRect(0, y, 3, HEADER_H);
      this.panel.add(headerBg);
      this.panelRows.push(headerBg);

      const headerText = this.scene.add.text(8, y + 4, cat.label, {
        ...Font.small, color: TextColor.secondary, fontStyle: 'bold',
      });
      this.panel.add(headerText);
      this.panelRows.push(headerText);
      y += HEADER_H;

      // Item rows
      for (const [id, qty] of catItems) {
        const def = this.resourceDefs.get(id);
        const name = def?.name ?? id.replace(/-/g, ' ');
        // Truncate long names
        const display = name.length > 14 ? name.slice(0, 13) + '…' : name;

        // Color dot
        const dot = this.scene.add.rectangle(10, y + ROW_H / 2, 6, 6, cat.color, 0.8);
        this.panel.add(dot);
        this.panelRows.push(dot);

        // Name
        const nameText = this.scene.add.text(18, y + 3, display, {
          ...Font.tiny, color: TextColor.primary,
        });
        this.panel.add(nameText);
        this.panelRows.push(nameText);

        // Quantity
        const qtyText = this.scene.add.text(PANEL_W - 8, y + 3, `x${qty}`, {
          ...Font.tiny, color: TextColor.secondary,
        }).setOrigin(1, 0);
        this.panel.add(qtyText);
        this.panelRows.push(qtyText);

        // Hit zone for selecting as active item
        const rowHit = this.scene.add.rectangle(
          PANEL_W / 2, y + ROW_H / 2, PANEL_W, ROW_H,
        ).setInteractive().setVisible(false);
        rowHit.on('pointerdown', () => {
          this.activeItemId = id;
          this._updateBadge();
          this.scene.events.emit(INV_HUD_ACTIVE_CHANGED, { itemId: id });
        });
        // Hover highlight
        rowHit.on('pointerover', () => {
          nameText.setColor(TextColor.hover);
        });
        rowHit.on('pointerout', () => {
          nameText.setColor(TextColor.primary);
        });
        this.panel.add(rowHit);
        this.panelRows.push(rowHit);

        // Highlight if this is the active item
        if (id === this.activeItemId) {
          const activeMark = this.scene.add.rectangle(
            PANEL_W / 2, y + ROW_H / 2, PANEL_W - 4, ROW_H - 2,
          ).setStrokeStyle(1, Color.accentFantasy, 0.5).setFillStyle(Color.accentFantasy, 0.08);
          this.panel.add(activeMark);
          this.panelRows.push(activeMark);
        }

        y += ROW_H;
      }

      y += 4; // gap between categories
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────

  // Bound handler refs for cleanup
  private _onKeyI = () => this.toggle();
  private _onKeyQ = () => this.useActiveItem();
  private _onKeyDown = () => { if (!this.expanded) this.cycleActiveItem(); };

  private _bindInput(): void {
    const kb = this.scene.input.keyboard;
    if (!kb) return;

    kb.on('keydown-I', this._onKeyI);
    kb.on('keydown-Q', this._onKeyQ);
    kb.on('keydown-DOWN', this._onKeyDown);
  }

  // ── Events ────────────────────────────────────────────────────────────

  private _onInventoryChanged(): void {
    this._updateBadge();
    if (this.expanded) this._rebuildPanel();
  }

  // ── Resource defs ─────────────────────────────────────────────────────

  private _loadResourceDefs(): void {
    const data = this.scene.cache.json.get('item-registry') as
      { items: RegistryItem[] } | undefined;
    if (!data?.items) return;
    for (const r of playerItems(data.items)) {
      this.resourceDefs.set(r.id, { name: r.name, category: r.category as ItemCategory });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private _getConsumables(): [string, number][] {
    const result: [string, number][] = [];
    this.inventory.getMap().forEach((qty, id) => {
      if (qty <= 0) return;
      const def = this.resourceDefs.get(id);
      if (def?.category === 'consumable') result.push([id, qty]);
    });
    return result;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  private _dispose(): void {
    this.scene.game.events.off(INVENTORY_CHANGED, this._onInventoryChanged, this);
    // Remove keyboard listeners to prevent leaks on scene restart
    const kb = this.scene.input.keyboard;
    if (kb) {
      kb.off('keydown-I', this._onKeyI);
      kb.off('keydown-Q', this._onKeyQ);
      kb.off('keydown-DOWN', this._onKeyDown);
    }
    this.badge.destroy();
    this.slotLabel.destroy();
    this.panel.destroy();
    for (const obj of this.panelRows) obj.destroy();
    this.panelRows = [];
  }
}
