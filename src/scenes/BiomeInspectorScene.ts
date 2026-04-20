/**
 * BiomeInspectorScene — dev tool for visually inspecting biome tile sets,
 * biome-boundary feathering, and decoration scatter.
 *
 * Access: navigate to /biome in the URL.
 *
 * ## Layout
 *   top 25% = prev biome / feather / centre 50% = selected / feather / bottom 25% = next
 *
 * ## Controls
 *   LEFT / RIGHT or A / D   Cycle through all 12 biomes
 *   Click palette box        Jump directly to that biome
 *   E                        Remove the placed entity
 *   C                        Clear all placed objects
 */

import * as Phaser from 'phaser';
import { isoTileFrame, ISO_RIVER_FRAME } from '../world/IsoTileMap';
import { BIOMES } from '../world/biomes';

const BIOME_NAMES          = BIOMES.map(b => b.name);
const BIOME_OVERLAY_COLORS = BIOMES.map(b => b.overlayColor);

const ENTITY_TYPES = [
  { key: 'MC',     color: 0x44aaff, label: 'MC'     },
  { key: 'Enemy',  color: 0xff4444, label: 'Enemy'  },
  { key: 'NPC',    color: 0x44dd44, label: 'NPC'    },
  { key: 'Animal', color: 0xffaa22, label: 'Animal' },
] as const;

type EntityKey = typeof ENTITY_TYPES[number]['key'];

// `height` drives how tall the placeholder box is (px) — taller objects grow upward.
const OBJECT_TYPES = [
  { key: 'Tree',    color: 0x226622, label: 'Tree',    height: 28 },
  { key: 'Stone',   color: 0x999999, label: 'Stone',   height: 12 },
  { key: 'Boulder', color: 0x777777, label: 'Boulder', height: 16 },
  { key: 'Shrub',   color: 0x55bb44, label: 'Shrub',   height: 10 },
] as const;

type ObjectKey = typeof OBJECT_TYPES[number]['key'];

export class BiomeInspectorScene extends Phaser.Scene {
  // Default to biome 6 (Meadow). The ?biome=<idx> URL param overrides this so
  // the wiki's per-card "View in World Forge" links land on the right biome.
  private selectedBiome = (() => {
    const p = parseInt(new URLSearchParams(window.location.search).get('biome') ?? '', 10);
    return (!isNaN(p) && p >= 0 && p < 12) ? p : 6;
  })();

  // Layout constants lifted to class level so screenToTile() can access them.
  private readonly GRID      = 30;
  private readonly ISO_SCALE = 0.75;
  private readonly ISO_W     = 24;
  private readonly ISO_H     = 12;
  private readonly PAL_AREA  = 68;

  // Computed in buildDisplay(), referenced by screenToTile() + isoPos().
  private originX = 0;
  private originY = 0;

  // Terrain layers (rebuilt on biome change).
  private terrainRt?:   Phaser.GameObjects.RenderTexture;
  private blendGfx?:    Phaser.GameObjects.Graphics;
  private gridGfx?:     Phaser.GameObjects.Graphics;
  private decorSprites: Phaser.GameObjects.Image[] = [];
  private bandLabels:   Phaser.GameObjects.Text[]  = [];

  // Palette UI (built once).
  private paletteBoxes:    Phaser.GameObjects.Graphics[] = [];
  private selectionBorder?: Phaser.GameObjects.Graphics;
  private biomeLabel?:      Phaser.GameObjects.Text;

  // Entity spawner state (FIL-463) — one entity at a time.
  private selectedEntityKey: EntityKey | null = null;
  private placedEntity?:     Phaser.GameObjects.Graphics;
  private placedEntityLabel?: Phaser.GameObjects.Text;
  private entitySelBorder?:  Phaser.GameObjects.Graphics;

  // Object placer state (FIL-464) — multiple objects across tiles.
  private selectedObjectKey: ObjectKey | null = null;
  private placedObjects = new Map<string, { gfx: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  private objectSelBorder?: Phaser.GameObjects.Graphics;

  // Decoration painter state (FIL-465) — per-biome scatter on tiles.
  private selectedDecorKey: string | null = null;
  private placedDecors = new Map<string, { gfx: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  // Decor toolbar buttons rebuilt on biome change (zone, gfx, text per type).
  private decorRowObjs: Phaser.GameObjects.GameObject[] = [];
  private decorSelBorder?: Phaser.GameObjects.Graphics;

  constructor() { super({ key: 'BiomeInspectorScene' }); }

  preload(): void {
    this.load.spritesheet('iso-tiles',
      'assets/packs/isometric tileset/spritesheet.png',
      { frameWidth: 32, frameHeight: 32 });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');

    this.buildDisplay();
    this.buildPalette();
    this.buildSpawnerToolbar();

    this.input.keyboard!.on('keydown-LEFT',  () => this.cycleBiome(-1));
    this.input.keyboard!.on('keydown-RIGHT', () => this.cycleBiome(+1));
    this.input.keyboard!.on('keydown-A',     () => this.cycleBiome(-1));
    this.input.keyboard!.on('keydown-D',     () => this.cycleBiome(+1));
    this.input.keyboard!.on('keydown-E',     () => this.clearEntity());
    this.input.keyboard!.on('keydown-C',     () => { this.clearObjects(); this.clearDecors(); });

    // Click a tile to place entity or object. Palette / toolbar clicks produce
    // out-of-bounds tile coords, so screenToTile() returns null and nothing fires.
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      const tile = this.screenToTile(ptr.x, ptr.y);
      if (!tile) return;
      if (this.selectedEntityKey !== null) {
        this.placeEntity(tile.tx, tile.ty);
      } else if (this.selectedObjectKey !== null) {
        this.toggleObject(tile.tx, tile.ty);
      } else if (this.selectedDecorKey !== null) {
        this.toggleDecor(tile.tx, tile.ty);
      }
    });
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────────

  /** Screen position of the north apex of tile (tx, ty). Centre = (x, y + ISO_H/2). */
  private isoPos(tx: number, ty: number): { x: number; y: number } {
    return {
      x: this.originX + (tx - ty) * (this.ISO_W / 2),
      y: this.originY + (tx + ty) * (this.ISO_H / 2),
    };
  }

  /**
   * Inverse of isoPos. Converts screen (px, py) to nearest tile coords.
   * Returns null when the result falls outside [0, GRID).
   *
   * From the iso equations:
   *   a = tx - ty = (px - originX) * 2 / ISO_W
   *   b = tx + ty = (py - originY) * 2 / ISO_H
   *   tx = round((a + b) / 2),  ty = round((b - a) / 2)
   */
  private screenToTile(px: number, py: number): { tx: number; ty: number } | null {
    const a = (px - this.originX) * 2 / this.ISO_W;
    const b = (py - this.originY) * 2 / this.ISO_H;
    const tx = Math.round((a + b) / 2);
    const ty = Math.round((b - a) / 2);
    if (tx < 0 || ty < 0 || tx >= this.GRID || ty >= this.GRID) return null;
    return { tx, ty };
  }

  // ── Biome selection ───────────────────────────────────────────────────────────

  private cycleBiome(delta: number): void {
    this.selectedBiome = (this.selectedBiome + 12 + delta) % 12;
    this.refreshDisplay();
  }

  private selectBiome(idx: number): void {
    if (idx === this.selectedBiome) return;
    this.selectedBiome = idx;
    this.refreshDisplay();
  }

  /** Tears down terrain/blend/decor layers and rebuilds. Entity/object Graphics persist. */
  private refreshDisplay(): void {
    this.terrainRt?.destroy();
    this.terrainRt = undefined;
    this.blendGfx?.destroy();
    this.blendGfx = undefined;
    this.gridGfx?.destroy();
    this.gridGfx = undefined;
    for (const s of this.decorSprites) s.destroy();
    this.decorSprites = [];
    for (const t of this.bandLabels) t.destroy();
    this.bandLabels = [];
    this.buildDisplay();
    this.updatePalette();
    this.refreshDecorRow();
  }

  // ── Terrain ───────────────────────────────────────────────────────────────────

  private buildDisplay(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    const topRows    = Math.max(2, Math.floor(this.GRID * 0.25));
    const bottomRows = Math.max(2, Math.floor(this.GRID * 0.25));
    const centerRows = this.GRID - topRows - bottomRows;

    const prevBiome = (this.selectedBiome + 11) % 12;
    const nextBiome = (this.selectedBiome + 1)  % 12;

    const showRiver     = this.selectedBiome !== 0;
    const riverMidRow   = topRows + Math.floor(centerRows / 2);
    const riverStartRow = riverMidRow - 1;
    const riverEndRow   = riverMidRow + 1;

    const usableH  = H - this.PAL_AREA;
    const diamondH = this.GRID * this.ISO_H + this.ISO_H;

    // Store for screenToTile() — layout is fixed for a given screen size.
    this.originX = W / 2;
    this.originY = Math.round((usableH - diamondH) / 2 + this.ISO_H / 2);

    this.terrainRt = this.add.renderTexture(0, 0, W, H - this.PAL_AREA).setDepth(0);

    // Single reused Image avoids 900 allocations.
    const tileImg = this.add.image(-9999, -9999, 'iso-tiles', 0)
      .setScale(this.ISO_SCALE)
      .setOrigin(0.5, 0)
      .setVisible(false);

    for (let ty = 0; ty < this.GRID; ty++) {
      const biomeIdx = ty < topRows
        ? prevBiome
        : ty < topRows + centerRows
          ? this.selectedBiome
          : nextBiome;

      const isRiver = showRiver && ty >= riverStartRow && ty < riverEndRow;

      for (let tx = 0; tx < this.GRID; tx++) {
        const elev  = ((tx * 3 + ty * 7) % 10) / 10;
        const frame = isRiver ? ISO_RIVER_FRAME : isoTileFrame(biomeIdx, elev);
        const { x, y } = this.isoPos(tx, ty);
        tileImg.setTexture('iso-tiles', frame).setPosition(x, y - this.ISO_H / 2);
        this.terrainRt.draw(tileImg);
      }
    }
    tileImg.destroy();

    // Grid outline
    this.gridGfx = this.add.graphics().setDepth(2);
    this.gridGfx.lineStyle(1, 0x000000, 0.20);
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;
    for (let ty = 0; ty < this.GRID; ty++) {
      for (let tx = 0; tx < this.GRID; tx++) {
        const { x: cx, y: cy } = this.isoPos(tx, ty);
        this.gridGfx.beginPath();
        this.gridGfx.moveTo(cx,      cy - hh);
        this.gridGfx.lineTo(cx + hw, cy);
        this.gridGfx.lineTo(cx,      cy + hh);
        this.gridGfx.lineTo(cx - hw, cy);
        this.gridGfx.closePath();
        this.gridGfx.strokePath();
      }
    }

    // Band labels
    const labelRx     = W - 8;
    const topMidTy    = Math.floor(topRows / 2);
    const centerMidTy = topRows + Math.floor(centerRows / 2);
    const bottomMidTy = topRows + centerRows + Math.floor(bottomRows / 2);

    const { y: topLabelY    } = this.isoPos(this.GRID - 1, topMidTy);
    const { y: centerLabelY } = this.isoPos(this.GRID - 1, centerMidTy);
    const { y: bottomLabelY } = this.isoPos(this.GRID - 1, bottomMidTy);

    this.bandLabels.push(
      this.add.text(labelRx, topLabelY,
        `[${prevBiome}] ${BIOME_NAMES[prevBiome]}`,
        { fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 },
      ).setOrigin(1, 0.5).setDepth(11),

      this.add.text(labelRx, centerLabelY,
        `[${this.selectedBiome}] ${BIOME_NAMES[this.selectedBiome]} \u2014 selected`,
        { fontSize: '15px', color: '#ffe84d', stroke: '#000000', strokeThickness: 3 },
      ).setOrigin(1, 0.5).setDepth(11),

      this.add.text(labelRx, bottomLabelY,
        `[${nextBiome}] ${BIOME_NAMES[nextBiome]}`,
        { fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 },
      ).setOrigin(1, 0.5).setDepth(11),
    );

    if (showRiver) {
      const { y: riverLabelY } = this.isoPos(0, riverMidRow);
      this.bandLabels.push(
        this.add.text(8, riverLabelY, '~ river ~',
          { fontSize: '11px', color: '#88ccff', stroke: '#000000', strokeThickness: 2 },
        ).setOrigin(0, 0.5).setDepth(11),
      );
    }
  }

  // ── Palette UI ────────────────────────────────────────────────────────────────

  private buildPalette(): void {
    const W      = this.scale.width;
    const H      = this.scale.height;
    const PAD    = 4;
    const BOX_W  = Math.min(90, Math.floor((W - 13 * PAD) / 12));
    const BOX_H  = 44;
    const startY = H - BOX_H - PAD;

    for (let i = 0; i < 12; i++) {
      const bx  = PAD + i * (BOX_W + PAD);
      const gfx = this.add.graphics({ x: bx, y: startY }).setDepth(10);
      gfx.fillStyle(BIOME_OVERLAY_COLORS[i], 1);
      gfx.fillRect(0, 0, BOX_W, BOX_H);
      this.paletteBoxes.push(gfx);

      this.add.zone(bx + BOX_W / 2, startY + BOX_H / 2, BOX_W, BOX_H)
        .setDepth(12).setInteractive()
        .on('pointerdown', () => this.selectBiome(i));

      const abbrev = BIOME_NAMES[i].length > 9 ? BIOME_NAMES[i].slice(0, 8) + '.' : BIOME_NAMES[i];
      this.add.text(bx + 3, startY + 3,          `${i}`,  { fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setDepth(13);
      this.add.text(bx + 3, startY + BOX_H - 14, abbrev,  { fontSize: '9px',  color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setDepth(13);
    }

    this.selectionBorder = this.add.graphics().setDepth(14);
    this.biomeLabel = this.add.text(8, 8, '', {
      fontSize: '18px', color: '#ffe84d', stroke: '#000000', strokeThickness: 3,
    }).setDepth(11);

    this.add.text(PAD, startY - 20,
      'A/D: cycle biomes   click swatch: jump   E: clear entity   C: clear objects',
      { fontSize: '11px', color: '#aaaaaa', stroke: '#000000', strokeThickness: 2 },
    ).setDepth(11);

    this.updatePalette();
  }

  private updatePalette(): void {
    const H      = this.scale.height;
    const PAD    = 4;
    const BOX_W  = Math.min(90, Math.floor((this.scale.width - 13 * PAD) / 12));
    const BOX_H  = 44;
    const bx     = PAD + this.selectedBiome * (BOX_W + PAD);
    const by     = H - BOX_H - PAD;

    this.selectionBorder!.clear();
    this.selectionBorder!.lineStyle(3, 0xffffff, 1);
    this.selectionBorder!.strokeRect(bx - 2, by - 2, BOX_W + 4, BOX_H + 4);

    this.biomeLabel!.setText(`World Forge \u2014 [${this.selectedBiome}]  ${BIOME_NAMES[this.selectedBiome]}`);
  }

  // ── Spawner toolbar ───────────────────────────────────────────────────────────

  /**
   * Two toolbars above the controls hint:
   *   Left  — entity types (MC / Enemy / NPC / Animal)
   *   Right — object types (Tree / Stone / Boulder / Shrub)
   * Only one tool active at a time; re-clicking the active button deselects it.
   */
  private buildSpawnerToolbar(): void {
    const W      = this.scale.width;
    const H      = this.scale.height;
    const PAD    = 4;
    const BOX_H  = 44;
    const startY = H - BOX_H - PAD;
    const TOOL_Y = startY - 58;
    const BTN_W  = 54;
    const BTN_H  = 24;
    const BTN_G  = 3;

    this.add.text(PAD, TOOL_Y - 13, 'Entities:', {
      fontSize: '10px', color: '#88aaff', stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);

    for (let i = 0; i < ENTITY_TYPES.length; i++) {
      const et = ENTITY_TYPES[i];
      const bx = PAD + i * (BTN_W + BTN_G);
      const gfx = this.add.graphics({ x: bx, y: TOOL_Y }).setDepth(10);
      gfx.fillStyle(et.color, 0.7);
      gfx.fillRect(0, 0, BTN_W, BTN_H);
      this.add.text(bx + BTN_W / 2, TOOL_Y + BTN_H / 2, et.label, {
        fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(13);
      this.add.zone(bx + BTN_W / 2, TOOL_Y + BTN_H / 2, BTN_W, BTN_H)
        .setDepth(15).setInteractive()
        .on('pointerdown', () => this.selectEntityType(et.key));
    }

    const objStartX = W - OBJECT_TYPES.length * (BTN_W + BTN_G) - PAD + BTN_G;
    this.add.text(objStartX, TOOL_Y - 13, 'Objects:', {
      fontSize: '10px', color: '#aaffaa', stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);

    for (let i = 0; i < OBJECT_TYPES.length; i++) {
      const ot = OBJECT_TYPES[i];
      const bx = objStartX + i * (BTN_W + BTN_G);
      const gfx = this.add.graphics({ x: bx, y: TOOL_Y }).setDepth(10);
      gfx.fillStyle(ot.color, 0.7);
      gfx.fillRect(0, 0, BTN_W, BTN_H);
      this.add.text(bx + BTN_W / 2, TOOL_Y + BTN_H / 2, ot.label, {
        fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(13);
      this.add.zone(bx + BTN_W / 2, TOOL_Y + BTN_H / 2, BTN_W, BTN_H)
        .setDepth(15).setInteractive()
        .on('pointerdown', () => this.selectObjectType(ot.key));
    }

    this.entitySelBorder = this.add.graphics().setDepth(14);
    this.objectSelBorder = this.add.graphics().setDepth(14);
    this.decorSelBorder  = this.add.graphics().setDepth(14);

    this.buildDecorRow();
  }

  // ── Entity spawner (FIL-463) ──────────────────────────────────────────────────

  private selectEntityType(key: EntityKey): void {
    this.selectedEntityKey = this.selectedEntityKey === key ? null : key;
    if (this.selectedEntityKey !== null) this.selectedObjectKey = null;
    this.updateToolbarBorders();
  }

  /**
   * Places (or moves) the entity placeholder onto tile (tx, ty).
   * Visual: a filled iso diamond in the entity colour + label above.
   * Depth 5 — above terrain (0) and grid (2), below palette UI (10+).
   */
  private placeEntity(tx: number, ty: number): void {
    this.clearEntity();
    if (this.selectedEntityKey === null) return;
    const et = ENTITY_TYPES.find(e => e.key === this.selectedEntityKey)!;

    const { x: cx, y: cy } = this.isoPos(tx, ty);
    const sx = cx;
    const sy = cy + this.ISO_H / 2; // centre on tile surface, not north apex
    const hw = this.ISO_W / 2 + 1;
    const hh = this.ISO_H / 2 + 1;

    const gfx = this.add.graphics().setDepth(5);
    gfx.fillStyle(et.color, 0.88);
    gfx.beginPath();
    gfx.moveTo(sx,      sy - hh);
    gfx.lineTo(sx + hw, sy);
    gfx.lineTo(sx,      sy + hh);
    gfx.lineTo(sx - hw, sy);
    gfx.closePath();
    gfx.fillPath();
    gfx.lineStyle(2, 0xffffff, 0.9);
    gfx.strokePath();

    const label = this.add.text(sx, sy - hh - 3, et.label, {
      fontSize: '9px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(6);

    this.placedEntity = gfx;
    this.placedEntityLabel = label;
  }

  private clearEntity(): void {
    this.placedEntity?.destroy();
    this.placedEntity = undefined;
    this.placedEntityLabel?.destroy();
    this.placedEntityLabel = undefined;
  }

  // ── Object placer (FIL-464) ───────────────────────────────────────────────────

  private selectObjectType(key: ObjectKey): void {
    this.selectedObjectKey = this.selectedObjectKey === key ? null : key;
    if (this.selectedObjectKey !== null) this.selectedEntityKey = null;
    this.updateToolbarBorders();
  }

  /**
   * Toggle object at tile (tx, ty):
   *   Occupied tile → remove (regardless of selected type)
   *   Empty tile    → place selected object type
   *
   * Placeholder: rect anchored at tile south tip, growing upward.
   * Depth = 3 + ty*10 + tx*0.1 for painter-order depth sorting.
   */
  private toggleObject(tx: number, ty: number): void {
    const key = `${tx},${ty}`;
    const existing = this.placedObjects.get(key);
    if (existing) {
      existing.gfx.destroy();
      existing.label.destroy();
      this.placedObjects.delete(key);
      return;
    }
    if (this.selectedObjectKey === null) return;
    const ot = OBJECT_TYPES.find(o => o.key === this.selectedObjectKey)!;

    const { x: cx, y: cy } = this.isoPos(tx, ty);
    const bx    = cx;
    const by    = cy + this.ISO_H; // south tip of tile diamond
    const depth = 3 + ty * 10 + tx * 0.1;
    const rectW = 14;
    const rectH = ot.height;

    const gfx = this.add.graphics().setDepth(depth);
    gfx.fillStyle(ot.color, 0.88);
    gfx.fillRect(bx - rectW / 2, by - rectH, rectW, rectH);
    gfx.lineStyle(1, 0xffffff, 0.7);
    gfx.strokeRect(bx - rectW / 2, by - rectH, rectW, rectH);

    const label = this.add.text(bx, by - rectH - 2, ot.label, {
      fontSize: '8px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(depth + 0.1);

    this.placedObjects.set(key, { gfx, label });
  }

  private clearObjects(): void {
    for (const { gfx, label } of this.placedObjects.values()) {
      gfx.destroy();
      label.destroy();
    }
    this.placedObjects.clear();
  }

  // ── Toolbar selection highlight ───────────────────────────────────────────────

  private updateToolbarBorders(): void {
    const H      = this.scale.height;
    const W      = this.scale.width;
    const PAD    = 4;
    const BOX_H  = 44;
    const startY = H - BOX_H - PAD;
    const TOOL_Y = startY - 58;
    const BTN_W  = 54;
    const BTN_H  = 24;
    const BTN_G  = 3;

    this.entitySelBorder!.clear();
    const eIdx = ENTITY_TYPES.findIndex(e => e.key === this.selectedEntityKey);
    if (eIdx >= 0) {
      const bx = PAD + eIdx * (BTN_W + BTN_G);
      this.entitySelBorder!.lineStyle(2, 0xffffff, 1);
      this.entitySelBorder!.strokeRect(bx - 2, TOOL_Y - 2, BTN_W + 4, BTN_H + 4);
    }

    this.objectSelBorder!.clear();
    const oIdx = OBJECT_TYPES.findIndex(o => o.key === this.selectedObjectKey);
    if (oIdx >= 0) {
      const objStartX = W - OBJECT_TYPES.length * (BTN_W + BTN_G) - PAD + BTN_G;
      const bx = objStartX + oIdx * (BTN_W + BTN_G);
      this.objectSelBorder!.lineStyle(2, 0xffffff, 1);
      this.objectSelBorder!.strokeRect(bx - 2, TOOL_Y - 2, BTN_W + 4, BTN_H + 4);
    }

    // Decor border — buttons are positioned by buildDecorRow() at DECOR_Y
    this.decorSelBorder!.clear();
    const DECOR_Y = TOOL_Y - BTN_H - BTN_G - 14;
    const decorTypes = BIOMES[this.selectedBiome].decorTypes ?? [];
    const dIdx = decorTypes.indexOf(this.selectedDecorKey ?? '');
    if (dIdx >= 0) {
      const bx = PAD + dIdx * (BTN_W + BTN_G);
      this.decorSelBorder!.lineStyle(2, 0xffffff, 1);
      this.decorSelBorder!.strokeRect(bx - 2, DECOR_Y - 2, BTN_W + 4, BTN_H + 4);
    }
  }

  // ── Decoration painter (FIL-465) ──────────────────────────────────────────────

  /**
   * Builds the decor toolbar row for the currently selected biome.
   * Called once by buildSpawnerToolbar() and on every biome change via refreshDecorRow().
   * Each decor type gets a button sized identically to entity/object buttons.
   */
  private buildDecorRow(): void {
    const H      = this.scale.height;
    const PAD    = 4;
    const BOX_H  = 44;
    const startY = H - BOX_H - PAD;
    const TOOL_Y = startY - 58;
    const BTN_W  = 54;
    const BTN_H  = 24;
    const BTN_G  = 3;
    const DECOR_Y = TOOL_Y - BTN_H - BTN_G - 14;

    const decorTypes = BIOMES[this.selectedBiome].decorTypes ?? [];
    if (decorTypes.length === 0) return;

    const header = this.add.text(PAD, DECOR_Y - 13, 'Decor:', {
      fontSize: '10px', color: '#ffddaa', stroke: '#000000', strokeThickness: 2,
    }).setDepth(11);
    this.decorRowObjs.push(header);

    // Use an earthy palette that shifts across button index
    const DECOR_COLORS = [0x8b6914, 0x6b8b14, 0x14698b, 0x8b1468, 0x8b4514, 0x148b45];

    for (let i = 0; i < decorTypes.length; i++) {
      const dKey = decorTypes[i];
      const bx   = PAD + i * (BTN_W + BTN_G);
      const col  = DECOR_COLORS[i % DECOR_COLORS.length];

      const gfx = this.add.graphics({ x: bx, y: DECOR_Y }).setDepth(10);
      gfx.fillStyle(col, 0.7);
      gfx.fillRect(0, 0, BTN_W, BTN_H);
      this.decorRowObjs.push(gfx);

      // Abbreviate long decor names to fit the button
      const abbrev = dKey.length > 9 ? dKey.slice(0, 8) + '.' : dKey;
      const lbl = this.add.text(bx + BTN_W / 2, DECOR_Y + BTN_H / 2, abbrev, {
        fontSize: '9px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(13);
      this.decorRowObjs.push(lbl);

      const zone = this.add.zone(bx + BTN_W / 2, DECOR_Y + BTN_H / 2, BTN_W, BTN_H)
        .setDepth(15).setInteractive()
        .on('pointerdown', () => this.selectDecorType(dKey));
      this.decorRowObjs.push(zone);
    }
  }

  /** Destroys the current decor row and rebuilds it for the new biome. */
  private refreshDecorRow(): void {
    for (const obj of this.decorRowObjs) {
      (obj as Phaser.GameObjects.GameObject).destroy();
    }
    this.decorRowObjs = [];
    this.selectedDecorKey = null;
    this.decorSelBorder?.clear();
    this.buildDecorRow();
  }

  private selectDecorType(key: string): void {
    this.selectedDecorKey = this.selectedDecorKey === key ? null : key;
    if (this.selectedDecorKey !== null) {
      this.selectedEntityKey = null;
      this.selectedObjectKey = null;
    }
    this.updateToolbarBorders();
  }

  /**
   * Toggles a decor placeholder on tile (tx, ty).
   * Decor is flat surface scatter — no painter-order depth sorting needed.
   * Placeholder: a small dot (4 px radius) in the decor type's button colour.
   */
  private toggleDecor(tx: number, ty: number): void {
    const key = `${tx},${ty}`;
    const existing = this.placedDecors.get(key);
    if (existing) {
      existing.gfx.destroy();
      existing.label.destroy();
      this.placedDecors.delete(key);
      return;
    }
    if (this.selectedDecorKey === null) return;

    const { x: cx, y: cy } = this.isoPos(tx, ty);
    const sx = cx;
    const sy = cy + this.ISO_H / 2; // tile surface centre

    const DECOR_COLORS = [0x8b6914, 0x6b8b14, 0x14698b, 0x8b1468, 0x8b4514, 0x148b45];
    const decorTypes = BIOMES[this.selectedBiome].decorTypes ?? [];
    const dIdx = decorTypes.indexOf(this.selectedDecorKey);
    const col  = DECOR_COLORS[dIdx >= 0 ? dIdx % DECOR_COLORS.length : 0];

    // Flat scatter — depth 4, between terrain (0) and entity (5)
    const gfx = this.add.graphics().setDepth(4);
    gfx.fillStyle(col, 0.9);
    gfx.fillCircle(sx, sy, 4);
    gfx.lineStyle(1, 0xffffff, 0.6);
    gfx.strokeCircle(sx, sy, 4);

    const label = this.add.text(sx, sy - 7, this.selectedDecorKey, {
      fontSize: '7px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(4.1);

    this.placedDecors.set(key, { gfx, label });
  }

  private clearDecors(): void {
    for (const { gfx, label } of this.placedDecors.values()) {
      gfx.destroy();
      label.destroy();
    }
    this.placedDecors.clear();
  }
}
