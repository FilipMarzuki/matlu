import * as Phaser from 'phaser';
import { InventorySystem } from '../systems/InventorySystem';

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

  // Prototype data (loaded at create)
  private concepts: Concept[] = [];
  private recipes: Recipe[] = [];
  private resources: Resource[] = [];

  // Tinker tray state (prototype — in real game this would be in a system)
  private traySlots: (string | null)[] = [null, null, null, null, null];
  private trayProgress = 0.58; // fake progress for demo

  /**
   * Shared inventory system. If GameScene already created one (normal play),
   * we reuse it. If we're running standalone (/craft route), we create one
   * on the fly and seed it with starter items so the prototype works.
   */
  private get inventorySystem(): InventorySystem {
    let sys = this.game.registry.get('inventorySystem') as InventorySystem | undefined;
    if (!sys) {
      sys = new InventorySystem(this);
      // Seed starter items for standalone prototype
      const starterKit: [string, number][] = [
        ['iron-ore', 12], ['coal', 8], ['wood-log', 8], ['hide-raw', 4],
        ['plant-fiber', 14], ['herb-green', 7], ['salt', 5], ['iron-ingot', 3],
        ['leather', 3], ['rope', 2], ['cloth', 3], ['charcoal', 4],
      ];
      for (const [id, qty] of starterKit) sys.add(id, qty);
    }
    return sys;
  }

  /** Shorthand — the inventory map for read-only display. */
  private get inventory(): ReadonlyMap<string, number> {
    return this.inventorySystem.getMap();
  }

  constructor() {
    super({ key: 'CraftingMenuScene' });
  }

  async create(): Promise<void> {
    // Load data files
    await this.loadData();

    // Pre-populate tinker tray for demo
    this.traySlots = ['tension', 'iron-ingot', null, null, null];

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

    switch (this.activeTab) {
      case 'mind': this.renderMindTab(); break;
      case 'concepts': this.renderConceptsTab(); break;
      case 'recipes': this.renderRecipesTab(); break;
      case 'pack': this.renderPackTab(); break;
    }
  }

  // ─── MIND TAB (Tinker Tray) ─────────────────────────────────────────────────

  private renderMindTab(): void {
    const { width } = this.scale;
    const panelW = Math.min(width - PANEL_MARGIN * 2, 720) - 32;

    // Title
    this.contentContainer.add(
      this.add.text(panelW / 2, 0, "MIND'S WORKBENCH", {
        fontSize: '14px', color: '#aaccff', fontStyle: 'bold',
      }).setOrigin(0.5, 0)
    );

    // Tinker tray slots (vertical hierarchy)
    const slotLabels = ['Primary Focus', 'Secondary Focus', 'Background', 'Distraction', 'Overload'];
    const slotColors = ['#ffdd44', '#cccccc', '#666666', '#553333', '#441111'];
    const slotStartY = 36;
    const slotSpacing = 56;

    for (let i = 0; i < 5; i++) {
      const sy = slotStartY + i * slotSpacing;
      const slotValue = this.traySlots[i];
      const concept = slotValue ? this.concepts.find(c => c.id === slotValue) : null;
      const resource = slotValue && !concept ? this.resources.find(r => r.id === slotValue) : null;

      // Slot background
      const slotBg = this.add.graphics();
      const alpha = i < 2 ? 0.3 : i < 3 ? 0.15 : 0.08;
      slotBg.fillStyle(TAB_COLORS.mind, alpha);
      slotBg.fillRoundedRect(panelW / 2 - 120, sy - 16, 240, 44, 6);
      if (i < 2) {
        slotBg.lineStyle(1.5, TAB_COLORS.mind, 0.6);
        slotBg.strokeRoundedRect(panelW / 2 - 120, sy - 16, 240, 44, 6);
      } else {
        slotBg.lineStyle(1, 0x444444, 0.3);
        slotBg.strokeRoundedRect(panelW / 2 - 120, sy - 16, 240, 44, 6);
      }
      this.contentContainer.add(slotBg);

      // Slot rank label
      this.contentContainer.add(
        this.add.text(panelW / 2 - 108, sy - 8, `${i + 1}`, {
          fontSize: '10px', color: slotColors[i],
        })
      );

      // Slot content
      if (concept) {
        this.contentContainer.add(
          this.add.text(panelW / 2 - 86, sy - 10, concept.name, {
            fontSize: '13px', color: i < 2 ? '#ffffff' : '#888888', fontStyle: i < 2 ? 'bold' : 'normal',
          })
        );
        this.contentContainer.add(
          this.add.text(panelW / 2 - 86, sy + 6, concept.category, {
            fontSize: '10px', color: '#666666',
          })
        );
      } else if (resource) {
        this.contentContainer.add(
          this.add.text(panelW / 2 - 86, sy - 4, resource.name, {
            fontSize: '13px', color: i < 2 ? '#ffffff' : '#888888',
          })
        );
      } else {
        this.contentContainer.add(
          this.add.text(panelW / 2, sy - 4, i < 2 ? 'Drag here...' : '( empty )', {
            fontSize: '11px', color: '#444444',
          }).setOrigin(0.5, 0)
        );
      }

      // Slot type label (right side)
      this.contentContainer.add(
        this.add.text(panelW / 2 + 104, sy - 4, slotLabels[i], {
          fontSize: '9px', color: slotColors[i],
        }).setOrigin(1, 0)
      );
    }

    // ── Thought progress bar ──────────────────────────────────────────────────
    const barY = slotStartY + 5 * slotSpacing + 10;
    const barW = panelW - 60;
    const barH = 24;
    const barX = 30;

    // Bar background
    const barBg = this.add.graphics();
    barBg.fillStyle(0x222233, 0.8);
    barBg.fillRoundedRect(barX, barY, barW, barH, 4);
    barBg.lineStyle(1, 0x444466, 0.5);
    barBg.strokeRoundedRect(barX, barY, barW, barH, 4);
    this.contentContainer.add(barBg);

    // Bar fill
    const fillG = this.add.graphics();
    fillG.fillStyle(0x3a5a8c, 0.7);
    fillG.fillRoundedRect(barX + 2, barY + 2, (barW - 4) * this.trayProgress, barH - 4, 3);
    this.contentContainer.add(fillG);

    // Progress text
    this.contentContainer.add(
      this.add.text(barX + barW / 2, barY + barH / 2, `💭 "The iron wants to move... but something holds it back..."`, {
        fontSize: '10px', color: '#aabbcc',
      }).setOrigin(0.5)
    );

    // Percentage
    this.contentContainer.add(
      this.add.text(barX + barW - 4, barY + barH + 6, `${Math.round(this.trayProgress * 100)}%`, {
        fontSize: '10px', color: '#6688aa',
      }).setOrigin(1, 0)
    );
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
    // Recipe list
    this.recipes.forEach((recipe, i) => {
      const ry = startY + i * 28;
      if (ry > panelH - 20) return; // overflow guard

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
    });

    // Show first recipe detail by default
    if (this.recipes.length > 0) {
      this.renderRecipeDetail(detailX, startY, panelW - detailX, panelH - startY, this.recipes[0]);
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
