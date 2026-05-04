import * as Phaser from 'phaser';
import { InventorySystem } from '../systems/InventorySystem';
import { TinkerTraySystem, type Discovery } from '../systems/TinkerTraySystem';
import { DiscoverySystem } from '../systems/DiscoverySystem';

/**
 * CraftingMenuScene — prototype crafting menu overlay.
 *
 * Four tabs: Mind (Tinker Tray) | Concepts | Recipes | Pack
 * Launched as a parallel overlay over GameScene (same pattern as PauseMenuScene).
 *
 * ## Prototype scope
 * This is a functional UI skeleton with navigation, tab switching, and
 * placeholder content to validate layout and interaction feel on tablet.
 * Data is loaded from macro-world JSON files via fetch.
 *
 * ## Launch pattern
 *   caller: this.scene.pause(); this.scene.launch('CraftingMenuScene')
 *   close:  this.scene.stop(); this.scene.resume(callerKey)
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

interface Resource {
  id: string;
  name: string;
  category: import('../systems/InventorySystem').ItemCategory;
  stackMax: number;
  slot?: import('../systems/InventorySystem').EquipSlot;
}

interface Concept {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  ranks: number;
}

interface Recipe {
  id: string;
  name: string;
  output: { item: string; qty: number };
  inputs: { item: string; qty: number }[];
  tier: number;
  station: string | null;
  concepts?: string[];
  discovery?: import('../systems/DiscoverySystem').RecipeDiscoveryDef;
}

type TabId = 'mind' | 'concepts' | 'recipes' | 'pack';

// ─── Constants ──────────────────────────────────────────────────────────────────

const DEPTH_BASE = 900;
const TAB_HEIGHT = 44;
const PANEL_MARGIN = 12;
const TAB_COLORS: Record<TabId, number> = {
  mind: 0x3a5a8c,
  concepts: 0x5a7a3a,
  recipes: 0x7a5a3a,
  pack: 0x5a3a6a,
};
const TAB_LABELS: Record<TabId, string> = {
  mind: '🧠 Mind',
  concepts: '📐 Concepts',
  recipes: '📖 Recipes',
  pack: '🎒 Pack',
};

// ─── Scene ──────────────────────────────────────────────────────────────────────

export class CraftingMenuScene extends Phaser.Scene {
  private activeTab: TabId = 'mind';
  private tabButtons: Map<TabId, Phaser.GameObjects.Text> = new Map();
  private contentContainer!: Phaser.GameObjects.Container;
  /** Objects placed outside the container (drag zones, remove buttons) — destroyed on tab switch. */
  private floatingObjects: Phaser.GameObjects.GameObject[] = [];

  // Prototype data (loaded at create)
  private concepts: Concept[] = [];
  private recipes: Recipe[] = [];
  private resources: Resource[] = [];

  /** Last discovery result — shown as a notification on the Mind tab. */
  private lastDiscovery: Discovery | null = null;

  // ── Shared systems (lazy-init for standalone /craft route) ─────────────────

  private get inventorySystem(): InventorySystem {
    let sys = this.game.registry.get('inventorySystem') as InventorySystem | undefined;
    if (!sys) {
      sys = new InventorySystem(this);
      const starterKit: [string, number][] = [
        ['iron-ore', 12], ['coal', 8], ['wood-log', 8], ['hide-raw', 4],
        ['plant-fiber', 14], ['herb-green', 7], ['salt', 5], ['iron-ingot', 3],
        ['leather', 3], ['rope', 2], ['cloth', 3], ['charcoal', 4],
      ];
      for (const [id, qty] of starterKit) sys.add(id, qty);
    }
    return sys;
  }

  private get tinkerTray(): TinkerTraySystem {
    let sys = this.game.registry.get('tinkerTraySystem') as TinkerTraySystem | undefined;
    if (!sys) {
      sys = new TinkerTraySystem(this);
      // Seed demo slots for standalone prototype
      sys.slots = ['tension', 'iron-ingot', null, null, null];
    }
    return sys;
  }

  /** Shorthand — tray slots by reference (mutations go through system). */
  private get traySlots(): (string | null)[] {
    return this.tinkerTray.slots;
  }

  private get trayProgress(): number {
    return this.tinkerTray.progress;
  }

  private get discoverySys(): DiscoverySystem {
    let sys = this.game.registry.get('discoverySystem') as DiscoverySystem | undefined;
    if (!sys) {
      sys = new DiscoverySystem(this);
      // Load recipe defs if available
      if (this.recipes.length > 0) sys.loadRecipeDefs(this.recipes);
    }
    return sys;
  }

  private get inventory(): ReadonlyMap<string, number> {
    return this.inventorySystem.getMap();
  }

  constructor() {
    super({ key: 'CraftingMenuScene' });
  }

  async create(): Promise<void> {
    // Load data files
    await this.loadData();

    // Load combo data into the tray system
    this.loadTrayData();

    const { width, height } = this.scale;

    // ── Backdrop ─────────────────────────────────────────────────────────────
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.82)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE)
      .setInteractive()
      .on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
      });

    // ── Main panel ────────────────────────────────────────────────────────────
    const panelW = Math.min(width - PANEL_MARGIN * 2, 720);
    const panelH = Math.min(height - PANEL_MARGIN * 2, 520);
    const panelX = width / 2;
    const panelY = height / 2;

    this.add
      .rectangle(panelX, panelY, panelW, panelH, 0x1a1a24, 0.96)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE + 1)
      .setInteractive();

    // Border
    const border = this.add.graphics().setScrollFactor(0).setDepth(DEPTH_BASE + 2);
    border.lineStyle(1.5, 0x665533, 0.6);
    border.strokeRect(panelX - panelW / 2, panelY - panelH / 2, panelW, panelH);

    // ── Close button ──────────────────────────────────────────────────────────
    const closeBtn = this.add
      .text(panelX + panelW / 2 - 16, panelY - panelH / 2 + 8, '✕', {
        fontSize: '20px',
        color: '#aa8866',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE + 10)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.closeMenu());

    closeBtn.on('pointerover', () => closeBtn.setColor('#ffcc88'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#aa8866'));

    // ── Tab bar ───────────────────────────────────────────────────────────────
    const tabY = panelY - panelH / 2 + TAB_HEIGHT / 2 + 4;
    const tabW = panelW / 4;
    const tabs: TabId[] = ['mind', 'concepts', 'recipes', 'pack'];

    tabs.forEach((tab, i) => {
      const tx = panelX - panelW / 2 + tabW * i + tabW / 2;
      const tabText = this.add
        .text(tx, tabY, TAB_LABELS[tab], {
          fontSize: '13px',
          color: this.activeTab === tab ? '#ffffff' : '#888888',
          fontStyle: this.activeTab === tab ? 'bold' : 'normal',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_BASE + 5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.switchTab(tab));

      tabText.on('pointerover', () => { if (this.activeTab !== tab) tabText.setColor('#cccccc'); });
      tabText.on('pointerout', () => { if (this.activeTab !== tab) tabText.setColor('#888888'); });

      this.tabButtons.set(tab, tabText);
    });

    // Tab underline indicator
    this.drawTabIndicator();

    // ── Content area ──────────────────────────────────────────────────────────
    const contentY = panelY - panelH / 2 + TAB_HEIGHT + 16;
    this.contentContainer = this.add.container(panelX - panelW / 2 + 16, contentY)
      .setDepth(DEPTH_BASE + 6);

    this.renderTab();

    // ── Keyboard ──────────────────────────────────────────────────────────────
    this.input.keyboard?.on('keydown-ESC', () => this.closeMenu());
  }

  // ─── Data loading ───────────────────────────────────────────────────────────

  private async loadData(): Promise<void> {
    try {
      const [conceptsRes, recipesRes, resourcesRes] = await Promise.all([
        fetch('/macro-world/concepts.json'),
        fetch('/macro-world/recipes.json'),
        fetch('/macro-world/resources.json'),
      ]);
      // Note: macro-world isn't in public/ so these will 404 in dev.
      // For the prototype, we'll use inline fallback data if fetch fails.
      if (conceptsRes.ok) {
        const data = await conceptsRes.json();
        this.concepts = data.concepts ?? [];
      }
      if (recipesRes.ok) {
        const data = await recipesRes.json();
        this.recipes = data.recipes ?? [];
        // Feed discovery defs so innate recipes auto-unlock
        this.discoverySys.loadRecipeDefs(this.recipes);
      }
      if (resourcesRes.ok) {
        const data = await resourcesRes.json();
        this.resources = data.resources ?? [];
        // Feed stack limits + categories into the shared inventory system
        const sys = this.inventorySystem;
        if (sys) sys.loadResourceDefs(this.resources);
      }
    } catch {
      // Prototype fallback — use inline minimal data
      this.loadFallbackData();
    }
    if (this.concepts.length === 0) this.loadFallbackData();
  }

  private loadFallbackData(): void {
    this.concepts = [
      { id: 'heat-treatment', name: 'Heat Treatment', icon: 'patch-flame', category: 'metallurgy', description: 'Controlling temperature to change material properties.', ranks: 3 },
      { id: 'friction', name: 'Friction', icon: 'patch-spark', category: 'mechanics', description: 'How surfaces interact — grip, wear, heat generation.', ranks: 3 },
      { id: 'tension', name: 'Tension', icon: 'patch-bow', category: 'mechanics', description: 'Stored energy in stretched or compressed materials.', ranks: 3 },
      { id: 'rotation', name: 'Rotating Parts', icon: 'patch-gear', category: 'mechanics', description: 'Axles, wheels, gears — converting motion.', ranks: 3 },
      { id: 'joinery', name: 'Joinery', icon: 'patch-dovetail', category: 'woodcraft', description: 'Connecting wood pieces.', ranks: 3 },
      { id: 'sharpening', name: 'Edge & Point', icon: 'patch-blade', category: 'metallurgy', description: 'Creating and maintaining cutting edges.', ranks: 3 },
      { id: 'combustion', name: 'Combustion', icon: 'patch-explosion', category: 'alchemy', description: 'Controlled burning — fuel ratios, flash points.', ranks: 3 },
      { id: 'weaving', name: 'Weaving & Binding', icon: 'patch-knot', category: 'textiles', description: 'Interlocking fibers into sheets, ropes, nets.', ranks: 3 },
      { id: 'tanning', name: 'Tanning & Curing', icon: 'patch-hide', category: 'materials', description: 'Preserving and strengthening organic materials.', ranks: 3 },
      { id: 'distillation', name: 'Distillation', icon: 'patch-droplet', category: 'alchemy', description: 'Separating substances through heating and condensation.', ranks: 3 },
      { id: 'inscription', name: 'Inscription', icon: 'patch-rune', category: 'arcane', description: 'Carving symbols that hold meaning or power.', ranks: 3 },
    ];
    this.recipes = [
      { id: 'rope', name: 'Rope', output: { item: 'rope', qty: 1 }, inputs: [{ item: 'plant-fiber', qty: 4 }], tier: 0, station: null, concepts: ['weaving', 'tension'] },
      { id: 'cloth', name: 'Cloth', output: { item: 'cloth', qty: 1 }, inputs: [{ item: 'plant-fiber', qty: 3 }], tier: 0, station: null, concepts: ['weaving'] },
      { id: 'healing-salve', name: 'Healing Salve', output: { item: 'healing-salve', qty: 2 }, inputs: [{ item: 'herb-green', qty: 2 }, { item: 'animal-fat', qty: 1 }], tier: 0, station: null, concepts: ['distillation'] },
      { id: 'iron-ingot', name: 'Iron Ingot', output: { item: 'iron-ingot', qty: 1 }, inputs: [{ item: 'iron-ore', qty: 3 }, { item: 'coal', qty: 1 }], tier: 2, station: 'smelter', concepts: ['heat-treatment', 'alloys'] },
      { id: 'iron-blade', name: 'Iron Blade', output: { item: 'iron-blade', qty: 1 }, inputs: [{ item: 'iron-ingot', qty: 2 }, { item: 'coal', qty: 1 }], tier: 2, station: 'smithy', concepts: ['heat-treatment', 'sharpening'] },
      { id: 'iron-dagger', name: 'Iron Dagger', output: { item: 'iron-dagger', qty: 1 }, inputs: [{ item: 'iron-blade', qty: 1 }, { item: 'leather-strip', qty: 1 }, { item: 'wood-handle', qty: 1 }], tier: 2, station: 'smithy', concepts: ['sharpening', 'joinery', 'friction'] },
      { id: 'iron-sword', name: 'Iron Sword', output: { item: 'iron-sword', qty: 1 }, inputs: [{ item: 'iron-blade', qty: 2 }, { item: 'leather-strip', qty: 2 }, { item: 'wood-handle', qty: 1 }], tier: 2, station: 'smithy', concepts: ['sharpening', 'counterweight', 'heat-treatment'] },
      { id: 'hunting-bow', name: 'Hunting Bow', output: { item: 'hunting-bow', qty: 1 }, inputs: [{ item: 'hardwood-plank', qty: 2 }, { item: 'bowstring', qty: 1 }, { item: 'leather-strip', qty: 1 }], tier: 2, station: 'workshop', concepts: ['tension', 'joinery', 'friction'] },
    ];
    this.resources = [
      { id: 'iron-ore', name: 'Iron Ore', category: 'raw', stackMax: 20 },
      { id: 'coal', name: 'Coal', category: 'raw', stackMax: 20 },
      { id: 'wood-log', name: 'Wood Log', category: 'raw', stackMax: 15 },
      { id: 'plant-fiber', name: 'Plant Fiber', category: 'raw', stackMax: 20 },
      { id: 'herb-green', name: 'Green Herb', category: 'raw', stackMax: 15 },
      { id: 'iron-ingot', name: 'Iron Ingot', category: 'refined', stackMax: 10 },
      { id: 'leather', name: 'Leather', category: 'refined', stackMax: 10 },
      { id: 'rope', name: 'Rope', category: 'refined', stackMax: 10 },
      { id: 'cloth', name: 'Cloth', category: 'refined', stackMax: 10 },
    ];
  }

  /** Load tinker-tray.json combo data into the system. */
  private async loadTrayData(): Promise<void> {
    try {
      const res = await fetch('/macro-world/tinker-tray.json');
      if (res.ok) {
        const data = await res.json();
        this.tinkerTray.loadCombos(data);
      }
    } catch {
      // Combos stay empty — discoveries will hit "dead end" which is fine for prototype
    }
  }

  // ─── Tab navigation ─────────────────────────────────────────────────────────

  private switchTab(tab: TabId): void {
    if (tab === this.activeTab) return;
    this.activeTab = tab;

    // Update tab styles
    this.tabButtons.forEach((text, id) => {
      text.setColor(id === tab ? '#ffffff' : '#888888');
      text.setFontStyle(id === tab ? 'bold' : 'normal');
    });

    this.drawTabIndicator();
    this.renderTab();
  }

  private drawTabIndicator(): void {
    // Remove old indicator
    this.children.getByName('tab-indicator')?.destroy();

    const { width, height } = this.scale;
    const panelW = Math.min(width - PANEL_MARGIN * 2, 720);
    const panelX = width / 2;
    const panelY = height / 2;
    const panelH = Math.min(height - PANEL_MARGIN * 2, 520);
    const tabW = panelW / 4;
    const tabs: TabId[] = ['mind', 'concepts', 'recipes', 'pack'];
    const idx = tabs.indexOf(this.activeTab);

    const indX = panelX - panelW / 2 + tabW * idx;
    const indY = panelY - panelH / 2 + TAB_HEIGHT + 2;

    const g = this.add.graphics().setScrollFactor(0).setDepth(DEPTH_BASE + 4);
    g.setName('tab-indicator');
    g.fillStyle(TAB_COLORS[this.activeTab], 0.8);
    g.fillRect(indX + 8, indY, tabW - 16, 3);
  }

  // ─── Content rendering ──────────────────────────────────────────────────────

  private renderTab(): void {
    this.contentContainer.removeAll(true);
    // Clean up drag zones, remove buttons, etc. that live outside the container
    for (const obj of this.floatingObjects) obj.destroy();
    this.floatingObjects = [];

    switch (this.activeTab) {
      case 'mind': this.renderMindTab(); break;
      case 'concepts': this.renderConceptsTab(); break;
      case 'recipes': this.renderRecipesTab(); break;
      case 'pack': this.renderPackTab(); break;
    }
  }

  // ─── MIND TAB (Tinker Tray) ─────────────────────────────────────────────────

  // Drag state — tracked at scene level so event handlers can access it.
  private dragGhost: Phaser.GameObjects.Text | null = null;
  private dragSourceSlot: number | null = null;       // slot index if dragging FROM a slot
  private dragSourceItemId: string | null = null;     // item ID being dragged
  private slotDropZones: { x: number; y: number; w: number; h: number; idx: number }[] = [];
  private availableTrayFilter: 'all' | 'concepts' | 'materials' = 'all';

  private renderMindTab(): void {
    const { width } = this.scale;
    const panelW = Math.min(width - PANEL_MARGIN * 2, 720) - 32;

    // Title
    this.contentContainer.add(
      this.add.text(panelW / 2, 0, "MIND'S WORKBENCH", {
        fontSize: '14px', color: '#aaccff', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    // ── Tinker tray slots ─────────────────────────────────────────────────────
    const slotLabels = ['Primary Focus', 'Secondary Focus', 'Background', 'Distraction', 'Overload'];
    const slotColors = ['#ffdd44', '#cccccc', '#666666', '#553333', '#441111'];
    const slotStartY = 28;
    const slotSpacing = 46;
    const slotW = 240;
    const slotH = 38;

    // Reset drop zones for this render
    this.slotDropZones = [];

    // Container offset — needed to translate world coords ↔ container coords
    const cx = this.contentContainer.x;
    const cy = this.contentContainer.y;

    for (let i = 0; i < 5; i++) {
      const sy = slotStartY + i * slotSpacing;
      const slotValue = this.traySlots[i];
      const concept = slotValue ? this.concepts.find(c => c.id === slotValue) : null;
      const resource = slotValue && !concept ? this.resources.find(r => r.id === slotValue) : null;

      // Register drop zone (in world coords for hit testing)
      this.slotDropZones.push({
        x: cx + panelW / 2 - slotW / 2,
        y: cy + sy - slotH / 2,
        w: slotW,
        h: slotH,
        idx: i,
      });

      // Slot background — degradation for slots 3-5
      const slotBg = this.add.graphics();
      const alpha = i < 2 ? 0.3 : i < 3 ? 0.15 : 0.08;
      slotBg.fillStyle(TAB_COLORS.mind, alpha);
      slotBg.fillRoundedRect(panelW / 2 - slotW / 2, sy - slotH / 2, slotW, slotH, 6);
      if (i < 2) {
        slotBg.lineStyle(1.5, TAB_COLORS.mind, 0.6);
        slotBg.strokeRoundedRect(panelW / 2 - slotW / 2, sy - slotH / 2, slotW, slotH, 6);
      } else {
        // Visual degradation: dashed feel via lower opacity + muted color
        const borderAlpha = i < 3 ? 0.3 : i < 4 ? 0.2 : 0.12;
        slotBg.lineStyle(1, 0x444444, borderAlpha);
        slotBg.strokeRoundedRect(panelW / 2 - slotW / 2, sy - slotH / 2, slotW, slotH, 6);
        // Static/noise lines for slots 4-5
        if (i >= 3) {
          slotBg.lineStyle(0.5, 0x333333, 0.15);
          for (let n = 0; n < 3; n++) {
            const ny = sy - slotH / 2 + 6 + n * 12;
            slotBg.lineBetween(panelW / 2 - slotW / 2 + 8, ny, panelW / 2 + slotW / 2 - 8, ny);
          }
        }
      }
      this.contentContainer.add(slotBg);

      // Slot rank label
      this.contentContainer.add(
        this.add.text(panelW / 2 - slotW / 2 + 12, sy - 6, `${i + 1}`, {
          fontSize: '10px', color: slotColors[i],
        })
      );

      // Slot content — make it a hit zone for dragging
      const displayName = concept ? concept.name : resource ? resource.name : null;

      if (displayName && slotValue) {
        // Occupied slot — interactive, can drag to reorder or remove
        const slotText = this.add.text(panelW / 2 - slotW / 2 + 34, sy - 8, displayName, {
          fontSize: '12px',
          color: i < 2 ? '#ffffff' : '#888888',
          fontStyle: i < 2 ? 'bold' : 'normal',
        });
        this.contentContainer.add(slotText);

        if (concept) {
          this.contentContainer.add(
            this.add.text(panelW / 2 - slotW / 2 + 34, sy + 6, concept.category, {
              fontSize: '9px', color: '#555555',
            })
          );
        }

        // Drag handle — invisible rectangle over the slot for touch-friendly dragging.
        // Uses a Phaser Zone added outside the container so world coords match pointer.
        const hitZone = this.add.zone(cx + panelW / 2 - 16, cy + sy, slotW - 60, slotH)
          .setInteractive({ draggable: true, useHandCursor: true })
          .setDepth(DEPTH_BASE + 7);

        // ✕ remove button — placed outside container at higher depth so it's
        // not covered by the drag zone.
        const removeBtn = this.add.text(cx + panelW / 2 + slotW / 2 - 24, cy + sy, '✕', {
          fontSize: '14px', color: '#664444',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(DEPTH_BASE + 8);
        removeBtn.on('pointerover', () => removeBtn.setColor('#ff6644'));
        removeBtn.on('pointerout', () => removeBtn.setColor('#664444'));
        removeBtn.on('pointerdown', () => {
          this.tinkerTray.setSlot(i, null);
          this.renderTab();
        });
        this.floatingObjects.push(hitZone, removeBtn);
        hitZone.setData('slotIdx', i);
        hitZone.setData('itemId', slotValue);

        // Drag start — create ghost text
        hitZone.on('dragstart', (_p: Phaser.Input.Pointer) => {
          this.dragSourceSlot = i;
          this.dragSourceItemId = slotValue;
          this.dragGhost = this.add.text(0, 0, displayName, {
            fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
            backgroundColor: '#3a5a8c88',
            padding: { x: 6, y: 3 },
          }).setDepth(DEPTH_BASE + 20).setOrigin(0.5);
        });

        hitZone.on('drag', (p: Phaser.Input.Pointer) => {
          if (this.dragGhost) {
            this.dragGhost.setPosition(p.x, p.y);
            this.highlightDropTarget(p.x, p.y);
          }
        });

        hitZone.on('dragend', (p: Phaser.Input.Pointer) => {
          this.handleDrop(p.x, p.y);
        });

        // Don't add hitZone to container — it's in world coords already
      } else {
        // Empty slot placeholder
        this.contentContainer.add(
          this.add.text(panelW / 2, sy - 2, i < 2 ? 'Drag here...' : '( empty )', {
            fontSize: '10px', color: '#333344',
          }).setOrigin(0.5, 0)
        );
      }

      // Slot label (right side)
      this.contentContainer.add(
        this.add.text(panelW / 2 + slotW / 2 - 36, sy - 2, slotLabels[i], {
          fontSize: '8px', color: slotColors[i],
        }).setOrigin(1, 0)
      );
    }

    // ── Thought progress bar ──────────────────────────────────────────────────
    const barY = slotStartY + 5 * slotSpacing + 4;
    const barW = panelW - 120; // leave room for Rest button
    const barH = 20;
    const barX = 30;
    const progress = this.trayProgress;
    const hasSlots = this.traySlots.some(Boolean);

    const barBg = this.add.graphics();
    barBg.fillStyle(0x222233, 0.8);
    barBg.fillRoundedRect(barX, barY, barW, barH, 4);
    barBg.lineStyle(1, 0x444466, 0.5);
    barBg.strokeRoundedRect(barX, barY, barW, barH, 4);
    this.contentContainer.add(barBg);

    if (progress > 0) {
      const fillG = this.add.graphics();
      fillG.fillStyle(0x3a5a8c, 0.7);
      fillG.fillRoundedRect(barX + 2, barY + 2, (barW - 4) * progress, barH - 4, 3);
      this.contentContainer.add(fillG);
    }

    // Progress hint text from the system
    const hint = this.tinkerTray.getProgressHint();
    this.contentContainer.add(
      this.add.text(barX + barW / 2, barY + barH / 2,
        hint ? `💭 ${hint}` : (hasSlots ? '💭 Rest to begin thinking...' : ''),
        { fontSize: '9px', color: '#aabbcc' },
      ).setOrigin(0.5)
    );
    this.contentContainer.add(
      this.add.text(barX + barW - 4, barY + barH + 4, `${Math.round(progress * 100)}%`, {
        fontSize: '9px', color: '#6688aa',
      }).setOrigin(1, 0)
    );

    // ── Rest button (prototype — triggers a tick manually) ────────────────────
    const restBtnX = barX + barW + 10;
    const restBtnW = 80;
    const canRest = hasSlots && progress < 1;
    const restBg = this.add.graphics();
    restBg.fillStyle(canRest ? 0x335533 : 0x222222, 0.8);
    restBg.fillRoundedRect(restBtnX, barY - 1, restBtnW, barH + 2, 4);
    restBg.lineStyle(1, canRest ? 0x44aa44 : 0x333333, 0.5);
    restBg.strokeRoundedRect(restBtnX, barY - 1, restBtnW, barH + 2, 4);
    this.contentContainer.add(restBg);

    const restBtn = this.add.text(restBtnX + restBtnW / 2, barY + barH / 2, '🌙 Rest', {
      fontSize: '10px', color: canRest ? '#88ff88' : '#555555',
    }).setOrigin(0.5).setInteractive({ useHandCursor: canRest });

    if (canRest) {
      restBtn.on('pointerdown', () => {
        const discovery = this.tinkerTray.tick();
        if (discovery) {
          this.lastDiscovery = discovery;
        }
        this.renderTab();
      });
    }
    this.contentContainer.add(restBtn);

    // ── Discovery notification ────────────────────────────────────────────────
    if (this.lastDiscovery) {
      const dy = barY + barH + 22;
      const notifBg = this.add.graphics();
      notifBg.fillStyle(this.lastDiscovery.isFalse ? 0x3a3a2a : 0x2a3a2a, 0.9);
      notifBg.fillRoundedRect(barX, dy, panelW - 60, 40, 4);
      notifBg.lineStyle(1, 0x88cc88, 0.5);
      notifBg.strokeRoundedRect(barX, dy, panelW - 60, 40, 4);
      this.contentContainer.add(notifBg);

      this.contentContainer.add(
        this.add.text(barX + 8, dy + 4, `✨ ${this.lastDiscovery.type}: ${this.lastDiscovery.id}`, {
          fontSize: '10px', color: '#88ff88', fontStyle: 'bold',
        })
      );
      this.contentContainer.add(
        this.add.text(barX + 8, dy + 20, this.lastDiscovery.hint, {
          fontSize: '9px', color: '#aaccaa', wordWrap: { width: panelW - 90 },
        })
      );

      // Dismiss button
      const dismissBtn = this.add.text(barX + panelW - 70, dy + 4, '✕', {
        fontSize: '11px', color: '#666666',
      }).setInteractive({ useHandCursor: true });
      dismissBtn.on('pointerdown', () => {
        this.lastDiscovery = null;
        this.renderTab();
      });
      this.contentContainer.add(dismissBtn);
    }

    // ── Available items tray ──────────────────────────────────────────────────
    const trayStartY = this.lastDiscovery ? barY + barH + 68 : barY + barH + 24;
    this.renderAvailableTray(panelW, trayStartY);
  }

  /** Horizontal strip of items the player can drag into slots. */
  private renderAvailableTray(panelW: number, startY: number): void {
    // Filter tabs
    const filters: { label: string; key: 'all' | 'concepts' | 'materials' }[] = [
      { label: 'All', key: 'all' },
      { label: 'Concepts', key: 'concepts' },
      { label: 'Materials', key: 'materials' },
    ];
    let filterX = 4;
    for (const f of filters) {
      const active = this.availableTrayFilter === f.key;
      const ft = this.add.text(filterX, startY, f.label, {
        fontSize: '9px',
        color: active ? '#ffffff' : '#666666',
        backgroundColor: active ? '#333344' : undefined,
        padding: { x: 5, y: 2 },
      }).setInteractive({ useHandCursor: true });
      ft.on('pointerdown', () => {
        this.availableTrayFilter = f.key;
        this.renderTab();
      });
      this.contentContainer.add(ft);
      filterX += ft.width + 6;
    }

    // Gather available items (not already in a slot)
    const inSlots = new Set(this.traySlots.filter(Boolean));
    type TrayItem = { id: string; label: string; type: 'concept' | 'material' };
    const items: TrayItem[] = [];

    if (this.availableTrayFilter !== 'materials') {
      for (const c of this.concepts) {
        if (!inSlots.has(c.id)) items.push({ id: c.id, label: c.name, type: 'concept' });
      }
    }
    if (this.availableTrayFilter !== 'concepts') {
      for (const [itemId] of this.inventory) {
        if (!inSlots.has(itemId)) {
          const res = this.resources.find(r => r.id === itemId);
          if (res) items.push({ id: itemId, label: res.name, type: 'material' });
        }
      }
    }

    // Scrollable horizontal strip
    const trayY = startY + 22;
    const chipH = 28;
    const chipGap = 6;
    let chipX = 4;

    const cx = this.contentContainer.x;
    const cy = this.contentContainer.y;

    for (const item of items) {
      const chipW = Math.max(item.label.length * 6.5 + 16, 60);
      const chipColor = item.type === 'concept' ? 0x3a5a3a : 0x5a4a3a;

      // Chip background
      const chipBg = this.add.graphics();
      chipBg.fillStyle(chipColor, 0.5);
      chipBg.fillRoundedRect(chipX, trayY, chipW, chipH, 4);
      chipBg.lineStyle(1, item.type === 'concept' ? 0x66aa66 : 0xaa8844, 0.4);
      chipBg.strokeRoundedRect(chipX, trayY, chipW, chipH, 4);
      this.contentContainer.add(chipBg);

      // Chip label
      const chipLabel = this.add.text(chipX + chipW / 2, trayY + chipH / 2, item.label, {
        fontSize: '10px', color: '#cccccc',
      }).setOrigin(0.5);
      this.contentContainer.add(chipLabel);

      // Drag zone (world coords) for this chip
      const dragChip = this.add.zone(cx + chipX + chipW / 2, cy + trayY + chipH / 2, chipW, chipH)
        .setInteractive({ draggable: true, useHandCursor: true })
        .setDepth(DEPTH_BASE + 7);
      dragChip.setData('itemId', item.id);
      dragChip.setData('slotIdx', -1); // -1 means "from tray, not from a slot"

      dragChip.on('dragstart', () => {
        this.dragSourceSlot = null;
        this.dragSourceItemId = item.id;
        this.dragGhost = this.add.text(0, 0, item.label, {
          fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
          backgroundColor: '#3a5a8c88',
          padding: { x: 6, y: 3 },
        }).setDepth(DEPTH_BASE + 20).setOrigin(0.5);
      });

      dragChip.on('drag', (p: Phaser.Input.Pointer) => {
        if (this.dragGhost) {
          this.dragGhost.setPosition(p.x, p.y);
          this.highlightDropTarget(p.x, p.y);
        }
      });

      dragChip.on('dragend', (p: Phaser.Input.Pointer) => {
        this.handleDrop(p.x, p.y);
      });
      this.floatingObjects.push(dragChip);

      chipX += chipW + chipGap;
    }

    if (items.length === 0) {
      this.contentContainer.add(
        this.add.text(panelW / 2, trayY + chipH / 2, '( no items available )', {
          fontSize: '10px', color: '#444444',
        }).setOrigin(0.5)
      );
    }
  }

  // ── Drag-and-drop helpers ─────────────────────────────────────────────────

  /** Highlight which slot the pointer is hovering over during a drag. */
  private highlightDropTarget(px: number, py: number): void {
    // Remove old highlight
    this.children.getByName('slot-highlight')?.destroy();

    const target = this.getDropSlotAt(px, py);
    if (target === null) return;

    const zone = this.slotDropZones[target];
    const g = this.add.graphics().setDepth(DEPTH_BASE + 15);
    g.setName('slot-highlight');
    g.lineStyle(2, 0x88ccff, 0.7);
    g.strokeRoundedRect(zone.x, zone.y, zone.w, zone.h, 6);
  }

  /** Find which slot (0-4) the pointer is over, or null. */
  private getDropSlotAt(px: number, py: number): number | null {
    for (const z of this.slotDropZones) {
      if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) {
        return z.idx;
      }
    }
    return null;
  }

  /** Handle the end of a drag — drop into slot, swap, or remove. */
  private handleDrop(px: number, py: number): void {
    // Clean up ghost and highlight
    this.dragGhost?.destroy();
    this.dragGhost = null;
    this.children.getByName('slot-highlight')?.destroy();

    const targetSlot = this.getDropSlotAt(px, py);
    const itemId = this.dragSourceItemId;
    const sourceSlot = this.dragSourceSlot;

    if (!itemId) return;

    const tray = this.tinkerTray;
    if (targetSlot !== null) {
      if (sourceSlot !== null) {
        // Dragged from slot → slot: swap (resets progress via system)
        tray.swapSlots(sourceSlot, targetSlot);
      } else {
        // Dragged from available tray → slot: place (resets progress)
        tray.setSlot(targetSlot, itemId);
      }
    } else if (sourceSlot !== null) {
      // Dragged from slot → nowhere: remove (resets progress)
      tray.setSlot(sourceSlot, null);
    }

    // Reset drag state
    this.dragSourceSlot = null;
    this.dragSourceItemId = null;

    // Re-render to reflect new slot contents
    this.renderTab();
  }

  // ─── CONCEPTS TAB ───────────────────────────────────────────────────────────

  private renderConceptsTab(): void {
    const { width } = this.scale;
    const panelW = Math.min(width - PANEL_MARGIN * 2, 720) - 32;

    // Title
    this.contentContainer.add(
      this.add.text(panelW / 2, 0, 'CONCEPT PATCHES', {
        fontSize: '14px', color: '#aaffaa', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    // Category filter (horizontal)
    const categories = ['All', 'Mechanics', 'Metallurgy', 'Chemistry', 'Woodcraft', 'Alchemy', 'Arcane'];
    let catX = 0;
    categories.forEach((cat) => {
      const catText = this.add.text(catX, 24, cat, {
        fontSize: '10px', color: cat === 'All' ? '#ffffff' : '#888888',
        backgroundColor: cat === 'All' ? '#333' : undefined,
        padding: { x: 6, y: 3 },
      }).setInteractive({ useHandCursor: true });
      this.contentContainer.add(catText);
      catX += catText.width + 8;
    });

    // Node graph (simplified for prototype — grid layout)
    const startY = 56;
    const nodeSize = 52;
    const gapX = 72;
    const gapY = 68;
    const cols = Math.floor(panelW / gapX);

    // Fake mastery levels
    const mastery: Record<string, number> = {
      'heat-treatment': 2, 'friction': 1, 'tension': 1, 'rotation': 1,
      'joinery': 2, 'sharpening': 2, 'combustion': 1, 'weaving': 1,
      'tanning': 1, 'distillation': 0, 'inscription': 0,
    };

    const categoryColors: Record<string, number> = {
      mechanics: 0xc4820e, metallurgy: 0xa83232, woodcraft: 0x6b8c42,
      materials: 0x8b6914, textiles: 0x7b5ea7, alchemy: 0x2e7d6e,
      chemistry: 0x3a9e8f, arcane: 0x4a6fa5,
    };

    this.concepts.forEach((concept, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const nx = col * gapX + gapX / 2;
      const ny = startY + row * gapY;
      const rank = mastery[concept.id] ?? 0;
      const color = categoryColors[concept.category] ?? 0x666666;

      // Node circle
      const g = this.add.graphics();
      if (rank > 0) {
        g.fillStyle(color, 0.3);
        g.fillCircle(nx, ny, nodeSize / 2 - 4);
        g.lineStyle(2, color, rank >= concept.ranks ? 1 : 0.6);
        g.strokeCircle(nx, ny, nodeSize / 2 - 4);
      } else {
        g.fillStyle(0x333333, 0.3);
        g.fillCircle(nx, ny, nodeSize / 2 - 4);
        g.lineStyle(1, 0x555555, 0.4);
        g.strokeCircle(nx, ny, nodeSize / 2 - 4);
      }
      this.contentContainer.add(g);

      // Name
      this.contentContainer.add(
        this.add.text(nx, ny - 6, concept.name.split(' ')[0], {
          fontSize: '9px',
          color: rank > 0 ? '#ffffff' : '#555555',
        }).setOrigin(0.5)
      );

      // Rank stars
      const stars = '★'.repeat(rank) + '☆'.repeat(concept.ranks - rank);
      this.contentContainer.add(
        this.add.text(nx, ny + 8, stars, {
          fontSize: '8px',
          color: rank > 0 ? '#ffdd44' : '#333333',
        }).setOrigin(0.5)
      );

      // Lock icon for unlearned
      if (rank === 0) {
        this.contentContainer.add(
          this.add.text(nx, ny + 20, '🔒', { fontSize: '8px' }).setOrigin(0.5)
        );
      }
    });

    // Connection lines (simplified — just connect neighbors in same category)
    // Full implementation would use the requires/unlocks graph
  }

  // ─── RECIPES TAB ────────────────────────────────────────────────────────────

  private renderRecipesTab(): void {
    const { width, height } = this.scale;
    const panelW = Math.min(width - PANEL_MARGIN * 2, 720) - 32;
    const panelH = Math.min(height - PANEL_MARGIN * 2, 520) - TAB_HEIGHT - 40;

    // Title
    this.contentContainer.add(
      this.add.text(panelW / 2, 0, 'RECIPES', {
        fontSize: '14px', color: '#ffccaa', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    // Station filter
    const stations = ['All', 'Field', 'Smelter', 'Smithy', 'Workshop', 'Tannery'];
    let filterX = 0;
    stations.forEach((s) => {
      const sText = this.add.text(filterX, 24, s, {
        fontSize: '10px', color: s === 'All' ? '#ffffff' : '#888888',
        backgroundColor: s === 'All' ? '#333' : undefined,
        padding: { x: 6, y: 3 },
      }).setInteractive({ useHandCursor: true });
      this.contentContainer.add(sText);
      filterX += sText.width + 8;
    });

    // Split layout: list on left, detail on right
    const listW = 180;
    const detailX = listW + 20;
    const startY = 52;
    const disc = this.discoverySys;

    // Recipe list — discovered show normally, hint-visible as silhouettes,
    // fully undiscovered are hidden entirely.
    let firstDiscovered: Recipe | null = null;
    let listIdx = 0;

    this.recipes.forEach((recipe) => {
      const state = disc.getState(recipe.id);
      if (state === 'undiscovered') return; // completely hidden

      const ry = startY + listIdx * 28;
      if (ry > panelH - 20) return; // overflow guard
      listIdx++;

      if (state === 'discovered') {
        if (!firstDiscovered) firstDiscovered = recipe;
        const canCraft = this.canCraftRecipe(recipe);
        const dot = canCraft ? '●' : '○';
        const color = canCraft ? '#88ff88' : '#aa8866';

        const recipeText = this.add.text(8, ry, `${dot} ${recipe.name}`, {
          fontSize: '12px', color,
        }).setInteractive({ useHandCursor: true });

        recipeText.on('pointerdown', () => {
          this.renderRecipeDetail(detailX, startY, panelW - detailX, panelH - startY, recipe);
        });
        recipeText.on('pointerover', () => recipeText.setColor('#ffffff'));
        recipeText.on('pointerout', () => recipeText.setColor(color));
        this.contentContainer.add(recipeText);
      } else {
        // hint-visible — show as silhouette with method hint
        const method = recipe.discovery?.method ?? '?';
        const methodHints: Record<string, string> = {
          memory: '(practice more...)',
          observation: '(inspect the world...)',
          taught: '(find a teacher...)',
          experiment: '(experiment at a station...)',
          'reverse-engineer': '(disassemble to learn...)',
        };
        const hint = methodHints[method] ?? '';

        const silText = this.add.text(8, ry, `? ??? ${hint}`, {
          fontSize: '12px', color: '#444455',
        });
        this.contentContainer.add(silText);
      }
    });

    // Show first discovered recipe detail by default
    if (firstDiscovered) {
      this.renderRecipeDetail(detailX, startY, panelW - detailX, panelH - startY, firstDiscovered);
    }
  }

  private renderRecipeDetail(x: number, y: number, w: number, h: number, recipe: Recipe): void {
    // Remove old detail elements
    const existing = this.contentContainer.getAll().filter(
      (obj) => (obj as Phaser.GameObjects.GameObject & { _isDetail?: boolean })._isDetail
    );
    existing.forEach(obj => { obj.destroy(); this.contentContainer.remove(obj); });

    const makeDetail = (go: Phaser.GameObjects.Text | Phaser.GameObjects.Graphics) => {
      (go as unknown as { _isDetail: boolean })._isDetail = true;
      this.contentContainer.add(go);
      return go;
    };

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x222222, 0.5);
    bg.fillRoundedRect(x, y - 8, w, h, 4);
    makeDetail(bg as unknown as Phaser.GameObjects.Text);

    // Recipe name
    makeDetail(this.add.text(x + 12, y, recipe.name, {
      fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
    }));

    // Station
    const stationText = recipe.station ? `Station: ${recipe.station}` : 'Craft anywhere (field)';
    makeDetail(this.add.text(x + 12, y + 22, stationText, {
      fontSize: '10px', color: '#888888',
    }));

    // Inputs
    makeDetail(this.add.text(x + 12, y + 46, 'Requires:', {
      fontSize: '11px', color: '#aaaaaa',
    }));

    recipe.inputs.forEach((input, i) => {
      const have = this.inventory.get(input.item) ?? 0;
      const enough = have >= input.qty;
      const checkmark = enough ? '✓' : '✗';
      const color = enough ? '#88ff88' : '#ff6644';

      makeDetail(this.add.text(x + 20, y + 62 + i * 18, `${checkmark} ${input.item} x${input.qty} (have: ${have})`, {
        fontSize: '11px', color,
      }));
    });

    // Output
    const outputY = y + 62 + recipe.inputs.length * 18 + 12;
    makeDetail(this.add.text(x + 12, outputY, `→ ${recipe.output.item} x${recipe.output.qty}`, {
      fontSize: '12px', color: '#ffdd88', fontStyle: 'bold',
    }));

    // Concepts
    if (recipe.concepts && recipe.concepts.length > 0) {
      makeDetail(this.add.text(x + 12, outputY + 22, `Concepts: ${recipe.concepts.join(', ')}`, {
        fontSize: '10px', color: '#6688aa',
      }));
    }

    // Craft button
    const canCraft = this.canCraftRecipe(recipe);
    const btnY = outputY + 48;
    const btnG = this.add.graphics();
    btnG.fillStyle(canCraft ? 0x335533 : 0x332222, 0.8);
    btnG.fillRoundedRect(x + 12, btnY, 100, 28, 4);
    btnG.lineStyle(1, canCraft ? 0x44aa44 : 0x553333, 0.8);
    btnG.strokeRoundedRect(x + 12, btnY, 100, 28, 4);
    makeDetail(btnG as unknown as Phaser.GameObjects.Text);

    const craftBtn = this.add.text(x + 62, btnY + 14, canCraft ? 'CRAFT' : 'Missing...', {
      fontSize: '12px', color: canCraft ? '#88ff88' : '#886666', fontStyle: 'bold',
    }).setOrigin(0.5).setInteractive({ useHandCursor: canCraft });

    if (canCraft) {
      craftBtn.on('pointerdown', () => {
        const sys = this.inventorySystem;
        // Deduct inputs, add output — system handles persistence and events
        for (const input of recipe.inputs) sys.remove(input.item, input.qty);
        sys.add(recipe.output.item, recipe.output.qty);
        // Record craft action for memory-based discovery triggers
        this.discoverySys.recordAction(`craft:${recipe.id}`);
        // Re-render to reflect updated quantities
        this.renderTab();
      });
    }
    makeDetail(craftBtn);

    // Add to Mind button
    const mindBtn = this.add.text(x + 130, btnY + 14, '[Add to Mind]', {
      fontSize: '10px', color: '#6688aa',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    mindBtn.on('pointerdown', () => {
      // Add first concept to an empty slot
      const concept = recipe.concepts?.[0];
      if (concept) {
        const emptyIdx = this.traySlots.indexOf(null);
        if (emptyIdx !== -1) this.traySlots[emptyIdx] = concept;
      }
    });
    makeDetail(mindBtn);
  }

  // ─── PACK TAB (Inventory) ───────────────────────────────────────────────────

  private renderPackTab(): void {
    const { width } = this.scale;
    const panelW = Math.min(width - PANEL_MARGIN * 2, 720) - 32;

    // Title
    this.contentContainer.add(
      this.add.text(panelW / 2, 0, 'PACK', {
        fontSize: '14px', color: '#ccaaff', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    // Sub-tabs
    const subTabs = ['Resources', 'Equipment', 'Lore'];
    let stX = 0;
    subTabs.forEach((st) => {
      const stText = this.add.text(stX, 24, st, {
        fontSize: '10px', color: st === 'Resources' ? '#ffffff' : '#888888',
        backgroundColor: st === 'Resources' ? '#333' : undefined,
        padding: { x: 6, y: 3 },
      }).setInteractive({ useHandCursor: true });
      this.contentContainer.add(stText);
      stX += stText.width + 8;
    });

    // Inventory grid
    const gridStartY = 52;
    const cellSize = 64;
    const cellGap = 8;
    const cols = Math.floor(panelW / (cellSize + cellGap));
    let itemIdx = 0;

    this.inventory.forEach((qty, itemId) => {
      if (qty <= 0) return;
      const col = itemIdx % cols;
      const row = Math.floor(itemIdx / cols);
      const cx = col * (cellSize + cellGap) + cellSize / 2;
      const cy = gridStartY + row * (cellSize + cellGap) + cellSize / 2;

      // Cell background
      const cellBg = this.add.graphics();
      cellBg.fillStyle(0x222233, 0.6);
      cellBg.fillRoundedRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize, 4);
      cellBg.lineStyle(1, 0x444466, 0.4);
      cellBg.strokeRoundedRect(cx - cellSize / 2, cy - cellSize / 2, cellSize, cellSize, 4);
      this.contentContainer.add(cellBg);

      // Item name (shortened)
      const displayName = itemId.replace(/-/g, ' ').split(' ').map(w => w[0].toUpperCase()).join('');
      const resource = this.resources.find(r => r.id === itemId);
      const name = resource ? resource.name.split(' ')[0] : displayName;

      this.contentContainer.add(
        this.add.text(cx, cy - 8, name, {
          fontSize: '10px', color: '#cccccc',
        }).setOrigin(0.5)
      );

      // Quantity
      this.contentContainer.add(
        this.add.text(cx, cy + 10, `x${qty}`, {
          fontSize: '11px', color: '#88aacc', fontStyle: 'bold',
        }).setOrigin(0.5)
      );

      itemIdx++;
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private canCraftRecipe(recipe: Recipe): boolean {
    return recipe.inputs.every(input => (this.inventory.get(input.item) ?? 0) >= input.qty);
  }

  private closeMenu(): void {
    this.scene.stop();
    // Resume whatever called us — default to GameScene
    const callerKey = (this.scene.settings.data as { callerKey?: string })?.callerKey ?? 'GameScene';
    if (this.scene.isPaused(callerKey)) {
      this.scene.resume(callerKey);
    }
  }
}
