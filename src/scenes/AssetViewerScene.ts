/**
 * AssetViewerScene — browsable grid of all sprite assets in the game.
 *
 * Scans preloaded textures and displays them in categorized rows.
 * Useful for reviewing PixelLab-generated art, spotting missing sprites,
 * and discussing specific assets by name.
 *
 * Route: /assets
 * Controls:
 *   Scroll / Arrow keys — scroll vertically
 *   Click sprite        — shows details (key, size, source path)
 */

import * as Phaser from 'phaser';

// ── Asset categories to display ─────────────────────────────────────────────

interface AssetGroup {
  label: string;
  prefix: string;   // load path prefix
  assets: { key: string; path: string }[];
}

// ── Scene ───────────────────────────────────────────────────────────────────

export class AssetViewerScene extends Phaser.Scene {
  static readonly KEY = 'AssetViewerScene';

  constructor() { super({ key: AssetViewerScene.KEY }); }

  private scrollY = 0;
  private contentHeight = 0;
  private container!: Phaser.GameObjects.Container;
  private detailText!: Phaser.GameObjects.Text;

  preload(): void {
    // ── Trees ──────────────────────────────────────────────────────────
    for (let i = 0; i < 14; i++) {
      this.load.image(`tree-oak-${i}`, `/assets/sprites/trees/oak/mature/${i}.png`);
    }
    for (let i = 0; i < 5; i++) {
      this.load.image(`tree-oak-sapling-${i}`, `/assets/sprites/trees/oak/sapling/${i}.png`);
      this.load.image(`tree-oak-young-${i}`, `/assets/sprites/trees/oak/young/${i}.png`);
    }

    // ── Concept icons ─────────────────────────────────────────────────
    const conceptIcons = [
      'patch-flame','patch-spark','patch-bow','patch-gear','patch-circle',
      'patch-lever','patch-scales','patch-blade','patch-merge','patch-dovetail',
      'patch-hide','patch-shield','patch-knot','patch-droplet','patch-explosion',
      'patch-bubbles','patch-dissolve',
    ];
    for (const k of conceptIcons) {
      this.load.image(k, `/assets/sprites/icons/concepts/${k}.png`);
    }

    // ── Item icons ────────────────────────────────────────────────────
    const itemIcons = [
      'item-bronze-ingot','item-feather','item-rubber-sap','item-lodite-ore',
      'item-amber','item-crystal-shard','item-beeswax','item-peat',
      'item-sulfur','item-quartz',
    ];
    for (const k of itemIcons) {
      this.load.image(k, `/assets/sprites/icons/items/${k}.png`);
    }

    // ── Buildings ─────────────────────────────────────────────────────
    const ikiBase = '/assets/packs/building-objects/ikibeki';
    const buildings = [
      'campfire','well','guard-post','shrine','spirit-shrine','watchtower',
      'cottage','ger-cottage','ger-dwelling','ger-smithy','smithy','farmstead',
      'longhouse','clan-lodge','shelter-hut','merchant-stall','tavern',
      'warehouse','stables','sawmill','smokehouse','yurt-small','yurt-large',
      'ancestor-stone','market-hall','granary','temple','root-cellar',
      'barracks','town-hall','inn','brewery','barn','armory','palisade-gate',
    ];
    for (const b of buildings) {
      this.load.image(`iki-${b}`, `${ikiBase}/${b}.png`);
    }

    // ── Biome tile packs ──────────────────────────────────────────────
    const biomes = [
      'rocky-shore','sandy-shore','marsh','dry-heath','coastal-heath',
      'meadow','forest','cold-granite','bare-summit','snow-field',
    ];
    for (const b of biomes) {
      for (let i = 0; i < 4; i++) {
        this.load.image(`${b}-${i}`, `/assets/packs/${b}-tiles/${i}.png`);
      }
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#111118');

    this.container = this.add.container(0, 0);

    // Build asset groups from what we loaded
    const groups: AssetGroup[] = [
      {
        label: 'Oak Trees — Mature (14)',
        prefix: 'tree-oak-',
        assets: Array.from({ length: 14 }, (_, i) => ({
          key: `tree-oak-${i}`, path: `sprites/trees/oak/mature/${i}.png`,
        })),
      },
      {
        label: 'Oak Trees — Young (5)',
        prefix: 'tree-oak-young-',
        assets: Array.from({ length: 5 }, (_, i) => ({
          key: `tree-oak-young-${i}`, path: `sprites/trees/oak/young/${i}.png`,
        })),
      },
      {
        label: 'Oak Trees — Sapling (5)',
        prefix: 'tree-oak-sapling-',
        assets: Array.from({ length: 5 }, (_, i) => ({
          key: `tree-oak-sapling-${i}`, path: `sprites/trees/oak/sapling/${i}.png`,
        })),
      },
      {
        label: 'Concept Patch Icons',
        prefix: 'patch-',
        assets: [
          'patch-flame','patch-spark','patch-bow','patch-gear','patch-circle',
          'patch-lever','patch-scales','patch-blade','patch-merge','patch-dovetail',
          'patch-hide','patch-shield','patch-knot','patch-droplet','patch-explosion',
          'patch-bubbles','patch-dissolve',
        ].map(k => ({ key: k, path: `sprites/icons/concepts/${k}.png` })),
      },
      {
        label: 'Item Icons',
        prefix: 'item-',
        assets: [
          'item-bronze-ingot','item-feather','item-rubber-sap','item-lodite-ore',
          'item-amber','item-crystal-shard','item-beeswax','item-peat',
          'item-sulfur','item-quartz',
        ].map(k => ({ key: k, path: `sprites/icons/items/${k}.png` })),
      },
      {
        label: 'Ikibeki Buildings',
        prefix: 'iki-',
        assets: [
          'campfire','well','guard-post','shrine','spirit-shrine','watchtower',
          'cottage','ger-cottage','ger-dwelling','ger-smithy','smithy','farmstead',
          'longhouse','clan-lodge','shelter-hut','merchant-stall','tavern',
          'warehouse','stables','sawmill','smokehouse','yurt-small','yurt-large',
          'ancestor-stone','market-hall','granary','temple','root-cellar',
          'barracks','town-hall','inn','brewery','barn','armory','palisade-gate',
        ].map(b => ({ key: `iki-${b}`, path: `packs/building-objects/ikibeki/${b}.png` })),
      },
      {
        label: 'Biome Tiles',
        prefix: '',
        assets: [
          'rocky-shore','sandy-shore','marsh','dry-heath','coastal-heath',
          'meadow','forest','cold-granite','bare-summit','snow-field',
        ].flatMap(b => Array.from({ length: 4 }, (_, i) => ({
          key: `${b}-${i}`, path: `packs/${b}-tiles/${i}.png`,
        }))),
      },
    ];

    let y = 20;
    const PAD = 12;
    const CELL = 72;
    const COLS = Math.floor((this.cameras.main.width - PAD * 2) / CELL);

    for (const group of groups) {
      // Section header
      const header = this.add.text(PAD, y, group.label, {
        fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
        backgroundColor: '#222233', padding: { x: 6, y: 3 },
      });
      this.container.add(header);
      y += 28;

      // Asset grid
      let col = 0;
      for (const asset of group.assets) {
        if (!this.textures.exists(asset.key)) continue;

        const cx = PAD + col * CELL + CELL / 2;
        const cy = y + CELL / 2;

        // Cell background
        const bg = this.add.rectangle(cx, cy, CELL - 4, CELL - 4, 0x222233, 0.6)
          .setStrokeStyle(1, 0x333355, 0.4);
        this.container.add(bg);

        // Sprite — fit to cell
        const img = this.add.image(cx, cy - 6, asset.key);
        const maxDim = Math.max(img.width, img.height);
        const scale = maxDim > 0 ? Math.min((CELL - 16) / maxDim, 2) : 1;
        img.setScale(scale);
        this.container.add(img);

        // Label
        const shortName = asset.key.length > 10
          ? asset.key.slice(asset.key.lastIndexOf('-') + 1)
          : asset.key;
        const label = this.add.text(cx, cy + CELL / 2 - 14, shortName, {
          fontSize: '7px', color: '#888888',
        }).setOrigin(0.5, 0);
        this.container.add(label);

        // Click to show details
        bg.setInteractive();
        bg.on('pointerdown', () => this.showDetail(asset.key, asset.path, img.width, img.height));

        col++;
        if (col >= COLS) { col = 0; y += CELL; }
      }
      if (col > 0) y += CELL; // finish partial row
      y += 10; // gap between sections
    }

    this.contentHeight = y;

    // Detail panel (bottom, hidden until click)
    this.detailText = this.add.text(
      this.cameras.main.width / 2, this.cameras.main.height - 8,
      'Click a sprite to see details', {
        fontSize: '11px', color: '#aaaaaa', backgroundColor: '#000000cc',
        padding: { x: 10, y: 6 },
      },
    ).setOrigin(0.5, 1).setScrollFactor(0).setDepth(100);

    // Title
    this.add.text(this.cameras.main.width / 2, 4, 'Asset Viewer', {
      fontSize: '13px', color: '#ffffff', fontStyle: 'bold',
      backgroundColor: '#000000aa', padding: { x: 8, y: 3 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    // Scroll
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, dy: number) => {
      this.scrollY = Phaser.Math.Clamp(
        this.scrollY + dy * 0.5,
        0, Math.max(0, this.contentHeight - this.cameras.main.height + 40),
      );
      this.container.setY(-this.scrollY);
    });

    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => {
      this.scrollY = Math.max(0, this.scrollY - 40);
      this.container.setY(-this.scrollY);
    });
    kb.on('keydown-DOWN', () => {
      this.scrollY = Math.min(this.contentHeight - this.cameras.main.height + 40, this.scrollY + 40);
      this.container.setY(-this.scrollY);
    });
  }

  private showDetail(key: string, path: string, w: number, h: number): void {
    this.detailText.setText(`${key}  |  ${w}×${h}px  |  /assets/${path}`);
    this.detailText.setColor('#ffffff');
  }
}
