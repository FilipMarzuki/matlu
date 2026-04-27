/**
 * BuildingForgeScene — isometric block-stacking tool for designing
 * individual buildings. Each block is one iso cube, stacked vertically
 * like the combat scene's cliff walls.
 *
 * Access: navigate to /bf or /buildingforge in the URL.
 *
 * ## Controls
 *   Left click         Place block on top of hovered column
 *   Right click        Remove top block from hovered column
 *   A / D              Cycle building from registry
 *   R                  Reset to default fill
 *   Scroll / +/-       Zoom
 *   Middle-drag        Pan camera
 */

import * as Phaser from 'phaser';

// ── Registry types (minimal — just what we need) ────────────────────────────

interface RegistryEntry {
  id: string;
  name: string;
  category: string;
  baseSizeRange: [number, number];
  heightHint: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const HEIGHT_BLOCKS: Record<string, number> = {
  low: 1, standard: 4, tall: 6, tower: 8,
};

const WALL_BLOCKS: Record<string, number> = {
  low: 1, standard: 3, tall: 5, tower: 7,
};

// ── Architecture style type ──────────────────────────────────────────────────

interface ArchitectureStyle {
  id: string;
  name: string;
  primaryMaterial: string;
  constructionMethod: string;
  formLanguage: string;
  groundRelation: string;
  windowStyle: string;
  ornamentLevel: string;
  structuralPrinciple: string;
  climateResponse: string;
  description?: string;
  promptKeywords?: string;
  realWorldInspiration?: string;
}

/** Wall block colour per primary material. */
const WALL_COLORS: Record<string, number> = {
  stone:   0x777777,  // grey stone
  wood:    0x9a7a5a,  // warm timber
  bone:    0xbbaa99,  // pale ivory
  crystal: 0x7799bb,  // ice blue
  living:  0x557744,  // living wood
  metal:   0x667788,  // dark steel
  hide:    0x6a4a33,  // leather brown
  earth:   0x8a7a5a,  // packed earth
  coral:   0xbb8877,  // coral pink
  salvage: 0x888866,  // scrap mix
};

/** Roof block colour per primary material. */
/** Map building IDs to arrays of sprite variants for cycling. */
const BLOCK_SPRITE_VARIANTS: Record<string, string[]> = {
  campfire: [
    'campfire-obj-32', 'campfire-obj-48a', 'campfire-obj-48b',
    'campfire-markfolk-v1', 'campfire-markfolk-v2', 'campfire-markfolk-v3',
  ],
};

const ROOF_COLORS: Record<string, number> = {
  stone:   0x556666,  // slate grey
  wood:    0x8b7332,  // golden thatch
  bone:    0xccbbaa,  // pale bone
  crystal: 0x88aacc,  // crystal shimmer
  living:  0x447744,  // mossy green
  metal:   0x556677,  // dark metal
  hide:    0x7a5533,  // hide brown
  earth:   0x7a6a4a,  // clay
  coral:   0xcc7766,  // coral orange
  salvage: 0x777755,  // rusty mix
};

// ── Scene ───────────────────────────────────────────────────────────────────

export class BuildingForgeScene extends Phaser.Scene {

  // Iso grid
  private zoomFactor = 2.0;
  private get ISO_W() { return 24 * this.zoomFactor; }
  private get ISO_H() { return 12 * this.zoomFactor; }
  private originX = 0;
  private originY = 0;

  // Registry
  private entries: RegistryEntry[] = [];
  private currentIdx = 0;

  // Architecture styles (from Notion)
  private archStyles: ArchitectureStyle[] = [];
  private currentArchIdx = 0;

  // Block model: blocks[x][y][z] = true if filled
  private blocks: boolean[][][] = [];
  private gridW = 4; // footprint width in blocks
  private gridD = 4; // footprint depth in blocks
  private maxH = 8;  // max height

  // Render objects
  private blockGfx: Phaser.GameObjects.Graphics | null = null;
  private groundGfx: Phaser.GameObjects.Graphics | null = null;
  private blockSprites: Phaser.GameObjects.Image[] = [];
  private showSprites = true;
  private spriteVariantIdx = 0;

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;

  // Hover
  private hoverTx = -1;
  private hoverTy = -1;

  constructor() {
    super({ key: 'BuildingForgeScene' });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    this.load.json('building-registry', '/macro-world/building-registry.json');
    this.load.json('architecture', '/macro-world/architecture.json');

    // Block sprite tiles — multiple variants per building for comparison
    // Map objects (transparent bg, no iso base — best for ground objects)
    this.load.image('campfire-obj-32', '/assets/packs/building-forge/campfire_obj_32.png');
    this.load.image('campfire-obj-48a', '/assets/packs/building-forge/campfire_obj_48a.png');
    this.load.image('campfire-obj-48b', '/assets/packs/building-forge/campfire_obj_48b.png');
    // Iso block tiles (for comparison)
    this.load.image('campfire-markfolk-v1', '/assets/packs/building-forge/campfire_markfolk_v1.png');
    this.load.image('campfire-markfolk-v2', '/assets/packs/building-forge/campfire_markfolk_v2.png');
    this.load.image('campfire-markfolk-v3', '/assets/packs/building-forge/campfire_markfolk_v3_48px.png');
  }

  create(): void {
    // Parse registry
    const data = this.cache.json.get('building-registry') as { buildings: Array<RegistryEntry & { _section?: string }> };
    this.entries = data.buildings.filter(b => b.id && b.baseSizeRange) as RegistryEntry[];

    // Parse architecture styles — default to Markfolk Timber-frame
    const archData = this.cache.json.get('architecture') as { styles: ArchitectureStyle[] };
    this.archStyles = archData.styles;
    const markfolkIdx = this.archStyles.findIndex(a => a.id === 'ARCH-5');
    if (markfolkIdx >= 0) this.currentArchIdx = markfolkIdx;

    // URL param: ?building=smithy
    const params = new URLSearchParams(window.location.search);
    const bid = params.get('building');
    if (bid) {
      const idx = this.entries.findIndex(e => e.id === bid);
      if (idx >= 0) this.currentIdx = idx;
    }

    // Centre origin
    this.originX = this.scale.width / 2;
    this.originY = this.scale.height * 0.35;

    // Load current building
    this.loadBuilding();
    this.buildControlPanel();

    // ── Input ──────────────────────────────────────────────────────────────

    // Keyboard
    const kb = this.input.keyboard!;
    kb.on('keydown-A', () => this.cycleBuilding(-1));
    kb.on('keydown-D', () => this.cycleBuilding(1));
    kb.on('keydown-R', () => { this.fillDefault(); this.rebuild(); });
    kb.on('keydown-T', () => { this.showSprites = !this.showSprites; this.syncSpriteToggle(); this.rebuild(); });
    kb.on('keydown-V', () => this.cycleSpriteVariant());

    // Zoom
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, dy: number) => {
      this.zoomFactor *= dy > 0 ? 0.9 : 1.1;
      this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor, 0.5, 6.0);
      this.rebuild();
    });
    kb.on('keydown-PLUS',  () => { this.zoomFactor = Math.min(6, this.zoomFactor * 1.15); this.rebuild(); });
    kb.on('keydown-MINUS', () => { this.zoomFactor = Math.max(0.5, this.zoomFactor / 1.15); this.rebuild(); });

    // Pan (middle or right drag)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.middleButtonDown() || (p.rightButtonDown() && p.event.shiftKey)) {
        this.isPanning = true;
        this.panStartX = p.x;
        this.panStartY = p.y;
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.isPanning) {
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - this.panStartX);
        cam.scrollY -= (p.y - this.panStartY);
        this.panStartX = p.x;
        this.panStartY = p.y;
      } else {
        // Update hover tile
        this.updateHover(p);
      }
    });
    this.input.on('pointerup', () => { this.isPanning = false; });

    // Click to place/remove blocks
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.isPanning) return;
      this.updateHover(p);
      if (this.hoverTx < 0) return;

      if (p.leftButtonDown()) {
        this.placeBlock(this.hoverTx, this.hoverTy);
      } else if (p.rightButtonDown()) {
        this.removeBlock(this.hoverTx, this.hoverTy);
      }
    });

    // Disable context menu
    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.rebuild();
  }

  // ── Building management ───────────────────────────────────────────────────

  private loadBuilding(): void {
    const entry = this.entries[this.currentIdx];
    if (!entry) return;

    // Use max of size range for footprint
    const size = entry.baseSizeRange[1];
    this.gridW = size;
    this.gridD = size;
    this.maxH = HEIGHT_BLOCKS[entry.heightHint] ?? 4;

    // Init empty grid
    this.blocks = [];
    for (let x = 0; x < this.gridW; x++) {
      this.blocks[x] = [];
      for (let y = 0; y < this.gridD; y++) {
        this.blocks[x][y] = new Array(this.maxH).fill(false);
      }
    }

    this.fillDefault();
  }

  private fillDefault(): void {
    const entry = this.entries[this.currentIdx];
    if (!entry) return;
    const wallH = WALL_BLOCKS[entry.heightHint] ?? 3;
    const totalH = HEIGHT_BLOCKS[entry.heightHint] ?? 4;

    for (let x = 0; x < this.gridW; x++) {
      for (let y = 0; y < this.gridD; y++) {
        for (let z = 0; z < this.maxH; z++) {
          this.blocks[x][y][z] = z < totalH;
        }
      }
    }

    // Leave the interior hollow for standard+ buildings (walls only)
    if (wallH >= 3 && this.gridW >= 3 && this.gridD >= 3) {
      for (let x = 1; x < this.gridW - 1; x++) {
        for (let y = 1; y < this.gridD - 1; y++) {
          for (let z = 0; z < wallH; z++) {
            this.blocks[x][y][z] = false;
          }
        }
      }
    }
  }

  private cycleBuilding(dir: number): void {
    this.currentIdx = (this.currentIdx + dir + this.entries.length) % this.entries.length;
    this.spriteVariantIdx = 0;
    this.loadBuilding();
    this.rebuild();
  }


  // ── Control panel (DOM) ───────────────────────────────────────────────────

  private buildControlPanel(): void {
    document.getElementById('bf-control-panel')?.remove();

    // Group entries by category for the dropdown
    const categories = [...new Set(this.entries.map(e => e.category))];

    const panel = document.createElement('div');
    panel.id = 'bf-control-panel';
    panel.innerHTML = `
      <style>
        #bf-control-panel {
          position: fixed; top: 0; left: 0; bottom: 0; width: 220px;
          background: #12121eee; border-right: 1px solid #334;
          font-family: monospace; font-size: 12px; color: #ccd;
          padding: 12px; overflow-y: auto; z-index: 500;
          display: flex; flex-direction: column; gap: 8px;
        }
        #bf-control-panel h3 { margin: 0; color: #ffcc88; font-size: 14px; }
        #bf-control-panel label { color: #889; font-size: 11px; display: block; margin-bottom: 2px; }
        #bf-control-panel select {
          width: 100%; background: #1a1a2e; color: #dde; border: 1px solid #446;
          border-radius: 4px; padding: 4px 6px; font-family: monospace; font-size: 12px;
        }
        #bf-control-panel select:focus, #bf-control-panel input:focus { outline: none; border-color: #ffcc88; }
        #bf-control-panel input[type=number] {
          width: 100%; background: #1a1a2e; color: #dde; border: 1px solid #446;
          border-radius: 4px; padding: 4px 6px; font-family: monospace; font-size: 12px;
          box-sizing: border-box;
        }
        .bf-dim-row { display: flex; gap: 6px; align-items: center; }
        .bf-dim-row label { flex: 1; margin: 0; }
        .bf-dim-row input { width: 50px !important; flex: 0 0 50px; text-align: center; }
        #bf-control-panel .bf-btn {
          background: #2a2a4e; color: #aab; border: 1px solid #446;
          border-radius: 4px; padding: 5px 10px; cursor: pointer;
          font-family: monospace; font-size: 11px; width: 100%;
        }
        #bf-control-panel .bf-btn:hover { background: #3a3a5e; color: #fff; }
        #bf-control-panel .bf-divider { border-top: 1px solid #334; margin: 4px 0; }
        #bf-control-panel .bf-info { color: #778; font-size: 10px; line-height: 1.4; }
        #bf-control-panel .bf-stat { color: #aab; }
        #bf-control-panel .bf-stat span { color: #ffcc88; }
        #bf-control-panel .bf-desc {
          color: #99aabb; font-size: 10px; line-height: 1.5;
          background: #1a1a2e; border: 1px solid #334; border-radius: 4px;
          padding: 6px 8px; max-height: 120px; overflow-y: auto;
        }
        #bf-control-panel .bf-keywords {
          color: #887766; font-size: 9px; font-style: italic;
          margin-top: 4px; line-height: 1.3;
        }
      </style>
      <h3>Building Forge</h3>

      <div>
        <label>Architecture</label>
        <select id="bf-arch">
          ${this.archStyles.map((a, i) => `<option value="${i}"${i === this.currentArchIdx ? ' selected' : ''}>${a.name} — ${a.primaryMaterial}</option>`).join('')}
        </select>
      </div>

      <div class="bf-divider"></div>

      <div>
        <label>Category</label>
        <select id="bf-category">
          <option value="all">All</option>
          ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>

      <div>
        <label>Building</label>
        <select id="bf-building">
          ${this.entries.map((e, i) => `<option value="${i}"${i === this.currentIdx ? ' selected' : ''}>${e.name} (${e.id})</option>`).join('')}
        </select>
      </div>

      <div>
        <label>Dimensions (W × L × H)</label>
        <div class="bf-dim-row">
          <input type="number" id="bf-w" min="1" max="12" value="${this.gridW}">
          <span style="color:#556">×</span>
          <input type="number" id="bf-l" min="1" max="12" value="${this.gridD}">
          <span style="color:#556">×</span>
          <input type="number" id="bf-h" min="1" max="12" value="${this.maxH}">
        </div>
      </div>


      <div class="bf-divider"></div>

      <button class="bf-btn" id="bf-reset">Reset (R)</button>

      <div style="display:flex; align-items:center; gap:6px;">
        <input type="checkbox" id="bf-sprites" ${this.showSprites ? 'checked' : ''} style="accent-color:#ffcc88;">
        <label for="bf-sprites" style="margin:0; cursor:pointer;">Show sprites (T)</label>
      </div>
      <div id="bf-variant-label" style="color:#99aabb; font-size:10px; display:none;"></div>

      <div class="bf-divider"></div>

      <div id="bf-stats"></div>

      <div class="bf-divider"></div>

      <div class="bf-info">
        LMB: place block<br>
        RMB: remove block<br>
        A/D: prev/next building<br>
        Scroll: zoom<br>
        Middle-drag: pan
      </div>
    `;
    document.body.appendChild(panel);

    const sel = (id: string) => document.getElementById(id) as HTMLSelectElement;

    // Category filter
    sel('bf-category').addEventListener('change', (e) => {
      const cat = (e.target as HTMLSelectElement).value;
      this.updateBuildingDropdown(cat);
    });

    // Building selection
    sel('bf-building').addEventListener('change', (e) => {
      this.currentIdx = parseInt((e.target as HTMLSelectElement).value, 10);
      this.loadBuilding();
      this.syncPanel();
      this.rebuild();
    });

    // Dimension inputs (W × L × H)
    const dimChange = () => {
      const w = Phaser.Math.Clamp(parseInt((document.getElementById('bf-w') as HTMLInputElement).value, 10) || 1, 1, 12);
      const l = Phaser.Math.Clamp(parseInt((document.getElementById('bf-l') as HTMLInputElement).value, 10) || 1, 1, 12);
      const h = Phaser.Math.Clamp(parseInt((document.getElementById('bf-h') as HTMLInputElement).value, 10) || 1, 1, 12);
      this.resizeGrid(w, l, h);
    };
    document.getElementById('bf-w')!.addEventListener('change', dimChange);
    document.getElementById('bf-l')!.addEventListener('change', dimChange);
    document.getElementById('bf-h')!.addEventListener('change', dimChange);

    // Architecture selection
    sel('bf-arch').addEventListener('change', (e) => {
      this.currentArchIdx = parseInt((e.target as HTMLSelectElement).value, 10);
      this.rebuild();
    });

    // Reset button
    document.getElementById('bf-reset')!.addEventListener('click', () => {
      this.fillDefault();
      this.rebuild();
    });

    // Sprite toggle
    document.getElementById('bf-sprites')!.addEventListener('change', (e) => {
      this.showSprites = (e.target as HTMLInputElement).checked;
      this.rebuild();
    });

    this.syncPanel();
  }

  private updateBuildingDropdown(category: string): void {
    const select = document.getElementById('bf-building') as HTMLSelectElement;
    if (!select) return;

    const filtered = category === 'all'
      ? this.entries
      : this.entries.filter(e => e.category === category);

    select.innerHTML = filtered.map(e => {
      const idx = this.entries.indexOf(e);
      return `<option value="${idx}"${idx === this.currentIdx ? ' selected' : ''}>${e.name} (${e.id})</option>`;
    }).join('');

    // If current building not in filtered list, switch to first
    if (filtered.length > 0 && !filtered.includes(this.entries[this.currentIdx])) {
      this.currentIdx = this.entries.indexOf(filtered[0]);
      select.value = String(this.currentIdx);
      this.loadBuilding();
      this.rebuild();
    }
  }

  private syncPanel(): void {
    const entry = this.entries[this.currentIdx];
    if (!entry) return;

    // Sync dimension inputs
    const wIn = document.getElementById('bf-w') as HTMLInputElement;
    const lIn = document.getElementById('bf-l') as HTMLInputElement;
    const hIn = document.getElementById('bf-h') as HTMLInputElement;
    if (wIn) wIn.value = String(this.gridW);
    if (lIn) lIn.value = String(this.gridD);
    if (hIn) hIn.value = String(this.maxH);

    const buildingSel = document.getElementById('bf-building') as HTMLSelectElement;
    if (buildingSel) buildingSel.value = String(this.currentIdx);

    // Count filled blocks
    let blockCount = 0;
    for (let x = 0; x < this.gridW; x++)
      for (let y = 0; y < this.gridD; y++)
        for (let z = 0; z < this.maxH; z++)
          if (this.blocks[x][y][z]) blockCount++;

    const arch = this.archStyles[this.currentArchIdx];

    const stats = document.getElementById('bf-stats');
    if (stats) {
      stats.innerHTML = `
        <div class="bf-stat">Name: <span>${entry.name}</span></div>
        <div class="bf-stat">Category: <span>${entry.category}</span></div>
        <div class="bf-stat">Footprint: <span>${this.gridW} x ${this.gridD}</span></div>
        <div class="bf-stat">Height: <span>${this.maxH} blocks</span></div>
        <div class="bf-stat">Blocks used: <span>${blockCount}</span></div>
        <div class="bf-divider"></div>
        <div class="bf-stat">Architecture: <span>${arch?.name ?? '—'}</span></div>
        <div class="bf-stat">Material: <span>${arch?.primaryMaterial ?? '—'}</span></div>
        <div class="bf-stat">Method: <span>${arch?.constructionMethod ?? '—'}</span></div>
        <div class="bf-stat">Form: <span>${arch?.formLanguage ?? '—'}</span></div>
        <div class="bf-stat">Ground: <span>${arch?.groundRelation ?? '—'}</span></div>
        <div class="bf-stat">Windows: <span>${arch?.windowStyle ?? '—'}</span></div>
        <div class="bf-stat">Ornament: <span>${arch?.ornamentLevel ?? '—'}</span></div>
        ${arch?.description ? `<div class="bf-divider"></div><div class="bf-desc">${arch.description}</div>` : ''}
        ${arch?.realWorldInspiration ? `<div class="bf-stat" style="margin-top:4px;">Inspiration: <span style="color:#99bbaa;">${arch.realWorldInspiration}</span></div>` : ''}
        ${arch?.promptKeywords ? `<div class="bf-keywords">${arch.promptKeywords}</div>` : ''}
      `;
    }
  }

  /** Resize the grid to new dimensions, preserving existing blocks where possible. */
  private resizeGrid(w: number, l: number, h: number): void {
    const oldBlocks = this.blocks;
    const oldW = this.gridW;
    const oldD = this.gridD;
    const oldH = this.maxH;

    this.gridW = w;
    this.gridD = l;
    this.maxH = h;

    // Create new grid, copy what fits
    this.blocks = [];
    for (let x = 0; x < w; x++) {
      this.blocks[x] = [];
      for (let y = 0; y < l; y++) {
        this.blocks[x][y] = new Array(h).fill(false);
        for (let z = 0; z < h; z++) {
          if (x < oldW && y < oldD && z < oldH) {
            this.blocks[x][y][z] = oldBlocks[x]?.[y]?.[z] ?? false;
          }
        }
      }
    }

    this.syncPanel();
    this.rebuild();
  }

  private syncSpriteToggle(): void {
    const cb = document.getElementById('bf-sprites') as HTMLInputElement;
    if (cb) cb.checked = this.showSprites;
    // Update variant label
    const entry = this.entries[this.currentIdx];
    const variants = entry ? BLOCK_SPRITE_VARIANTS[entry.id] : undefined;
    const label = document.getElementById('bf-variant-label');
    if (label) {
      if (variants && variants.length > 1 && this.showSprites) {
        label.textContent = `Variant ${this.spriteVariantIdx + 1}/${variants.length} (V)`;
        label.style.display = 'block';
      } else {
        label.style.display = 'none';
      }
    }
  }

  private cycleSpriteVariant(): void {
    const entry = this.entries[this.currentIdx];
    const variants = entry ? BLOCK_SPRITE_VARIANTS[entry.id] : undefined;
    if (!variants || variants.length <= 1) return;
    this.spriteVariantIdx = (this.spriteVariantIdx + 1) % variants.length;
    this.syncSpriteToggle();
    this.rebuild();
  }

  // ── Block editing ─────────────────────────────────────────────────────────

  private placeBlock(tx: number, ty: number): void {
    if (tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridD) return;
    // Find first empty z
    for (let z = 0; z < this.maxH; z++) {
      if (!this.blocks[tx][ty][z]) {
        this.blocks[tx][ty][z] = true;
        this.rebuild();
        return;
      }
    }
  }

  private removeBlock(tx: number, ty: number): void {
    if (tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridD) return;
    // Find highest filled z
    for (let z = this.maxH - 1; z >= 0; z--) {
      if (this.blocks[tx][ty][z]) {
        this.blocks[tx][ty][z] = false;
        this.rebuild();
        return;
      }
    }
  }

  // ── Hover / screen-to-tile ────────────────────────────────────────────────

  private updateHover(p: Phaser.Input.Pointer): void {
    const cam = this.cameras.main;
    const wx = p.x + cam.scrollX;
    const wy = p.y + cam.scrollY;

    // Inverse iso: solve for tx, ty from screen coords
    const dx = wx - this.originX;
    const dy = wy - this.originY;
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;

    const tx = Math.round((dx / hw + dy / hh) / 2);
    const ty = Math.round((dy / hh - dx / hw) / 2);

    if (tx >= 0 && ty >= 0 && tx < this.gridW && ty < this.gridD) {
      this.hoverTx = tx;
      this.hoverTy = ty;
    } else {
      this.hoverTx = -1;
      this.hoverTy = -1;
    }
  }

  // ── Iso helpers ───────────────────────────────────────────────────────────

  private isoPos(tx: number, ty: number): { x: number; y: number } {
    return {
      x: this.originX + (tx - ty) * (this.ISO_W / 2),
      y: this.originY + (tx + ty) * (this.ISO_H / 2),
    };
  }

  /** Draw an iso diamond (ground tile) at tile coords — same as settlement forge. */
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

  private darken(color: number, factor: number): number {
    const r = Math.floor(((color >> 16) & 0xff) * factor);
    const g = Math.floor(((color >> 8) & 0xff) * factor);
    const b = Math.floor((color & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
  }

  private drawBlock(
    gfx: Phaser.GameObjects.Graphics,
    tx: number, ty: number, tz: number,
    color: number, alpha: number,
  ): void {
    const { x, y } = this.isoPos(tx, ty);
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;
    // Each block is hh pixels tall on screen. z=0 sits on the ground,
    // so lift pushes the top face up by (tz+1)*hh from ground level.
    const topLift = (tz + 1) * hh;
    const baseLift = tz * hh;

    // Top face corners (elevated above ground)
    const topN = { x: x,      y: y - topLift };
    const topE = { x: x + hw, y: y + hh - topLift };
    const topS = { x: x,      y: y + hh * 2 - topLift };
    const topW = { x: x - hw, y: y + hh - topLift };

    // Bottom corners of this block (base sits on the block below or ground)
    const baseE = { x: x + hw, y: y + hh - baseLift };
    const baseS = { x: x,      y: y + hh * 2 - baseLift };
    const baseW = { x: x - hw, y: y + hh - baseLift };

    const fillQuad = (c: number, a: number,
      p1: {x:number;y:number}, p2: {x:number;y:number},
      p3: {x:number;y:number}, p4: {x:number;y:number}) => {
      gfx.fillStyle(c, a);
      gfx.beginPath();
      gfx.moveTo(p1.x, p1.y);
      gfx.lineTo(p2.x, p2.y);
      gfx.lineTo(p3.x, p3.y);
      gfx.lineTo(p4.x, p4.y);
      gfx.closePath();
      gfx.fillPath();
    };

    // Right face (east-facing)
    fillQuad(this.darken(color, 0.7), alpha, topE, topS, baseS, baseE);
    // Left face (south-facing)
    fillQuad(this.darken(color, 0.5), alpha, topS, topW, baseW, baseS);
    // Top face
    fillQuad(color, alpha, topN, topE, topS, topW);

    // Outline
    gfx.lineStyle(1, 0x000000, 0.3);
    gfx.beginPath();
    gfx.moveTo(topN.x, topN.y);
    gfx.lineTo(topE.x, topE.y);
    gfx.lineTo(topS.x, topS.y);
    gfx.lineTo(topW.x, topW.y);
    gfx.closePath();
    gfx.strokePath();
    gfx.lineBetween(topE.x, topE.y, baseE.x, baseE.y);
    gfx.lineBetween(topS.x, topS.y, baseS.x, baseS.y);
    gfx.lineBetween(topW.x, topW.y, baseW.x, baseW.y);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private rebuild(): void {
    // Clean up
    this.groundGfx?.destroy();
    this.blockGfx?.destroy();
    for (const s of this.blockSprites) s.destroy();
    this.blockSprites = [];

    const entry = this.entries[this.currentIdx];
    if (!entry) return;

    const wallH = WALL_BLOCKS[entry.heightHint] ?? 3;
    const arch = this.archStyles[this.currentArchIdx];
    const mat = arch?.primaryMaterial ?? 'wood';
    const wallColor = WALL_COLORS[mat] ?? 0x9a7a5a;
    const roofColor = ROOF_COLORS[mat] ?? 0x8b7332;

    // ── Ground grid — same iso diamond style as settlement/world forges ──
    // Draw a ground area larger than the building footprint so the building
    // sits in context, like it would in a settlement.
    const pad = 3; // tiles of ground around the building
    const groundMin = -pad;
    const groundMaxW = this.gridW + pad;
    const groundMaxD = this.gridD + pad;

    this.groundGfx = this.add.graphics().setDepth(0);

    // Painter sort: back to front (sum of tx+ty ascending)
    const totalSpan = groundMaxW + groundMaxD;
    for (let sum = groundMin * 2; sum < totalSpan; sum++) {
      for (let tx = groundMin; tx < groundMaxW; tx++) {
        const ty = sum - tx;
        if (ty < groundMin || ty >= groundMaxD) continue;

        const inFootprint = tx >= 0 && ty >= 0 && tx < this.gridW && ty < this.gridD;
        const isHover = inFootprint && tx === this.hoverTx && ty === this.hoverTy;

        // Geography-tinted ground (forest green default, brighter inside footprint)
        let tileColor = 0x2a4a2a;
        let tileAlpha = 0.25;
        if (inFootprint) {
          tileColor = isHover ? 0x44ff44 : 0x3a5a3a;
          tileAlpha = isHover ? 0.5 : 0.4;
        }

        this.drawIsoDiamond(this.groundGfx, tx, ty, tileColor, tileAlpha, 0x000000, 0.15);
      }
    }

    // ── Blocks (painter sort: back to front, bottom to top) ─────────────
    this.blockGfx = this.add.graphics().setDepth(1);

    // Collect all filled blocks with sort key
    const draws: Array<{ tx: number; ty: number; tz: number; sortKey: number }> = [];
    for (let tx = 0; tx < this.gridW; tx++) {
      for (let ty = 0; ty < this.gridD; ty++) {
        for (let tz = 0; tz < this.maxH; tz++) {
          if (this.blocks[tx][ty][tz]) {
            draws.push({ tx, ty, tz, sortKey: (tx + ty) * 100 + tz });
          }
        }
      }
    }
    draws.sort((a, b) => a.sortKey - b.sortKey);

    // Check if this building has sprite variants
    const variants = BLOCK_SPRITE_VARIANTS[entry.id];
    const spriteKey = variants?.[this.spriteVariantIdx % (variants?.length ?? 1)];
    const hasSprite = this.showSprites && spriteKey && this.textures.exists(spriteKey);

    // Low buildings with sprites = ground objects (campfire, well, etc.)
    // Render as a single free sprite on the ground, not per-block cubes.
    const isGroundObject = hasSprite && entry.heightHint === 'low';

    if (isGroundObject) {
      const { x, y } = this.isoPos(0, 0);
      const hw = this.ISO_W / 2;
      const hh = this.ISO_H / 2;

      // Red diamond outline showing the tile footprint
      this.blockGfx.lineStyle(2, 0xff0000, 0.6);
      this.blockGfx.beginPath();
      this.blockGfx.moveTo(x, y);
      this.blockGfx.lineTo(x + hw, y + hh);
      this.blockGfx.lineTo(x, y + 2 * hh);
      this.blockGfx.lineTo(x - hw, y + hh);
      this.blockGfx.closePath();
      this.blockGfx.strokePath();

      // Sprite bottom at the diamond's south point, sits on the tile
      const sy = y + 2 * hh;
      const img = this.add.image(x, sy, spriteKey!);
      const scale = this.ISO_W / img.width;
      img.setScale(scale);
      img.setOrigin(0.5, 1);
      img.setDepth(2);
      this.blockSprites.push(img);
    } else {
      for (const d of draws) {
        if (hasSprite) {
          // Render as sprite image per block, lifted by z.
          // isoPos gives the north apex; diamond centre is at (x, y+hh).
          // Each block lifts by (tz+1)*hh (top) — place sprite centre
          // at the top face centre of this block.
          const { x, y } = this.isoPos(d.tx, d.ty);
          const hh = this.ISO_H / 2;
          const lift = d.tz * hh;
          const img = this.add.image(x, y - lift, spriteKey!);
          const scale = this.ISO_W / img.width;
          img.setScale(scale);
          img.setOrigin(0.5, 0);
          img.setDepth(1 + (d.tx + d.ty) * 0.01 + d.tz * 0.001);
          this.blockSprites.push(img);
        } else {
          // Fallback: coloured iso cube
          const isRoof = d.tz >= wallH;
          const color = isRoof ? roofColor : wallColor;
          this.drawBlock(this.blockGfx, d.tx, d.ty, d.tz, color, 0.9);
        }
      }
    }

    // Update stats in the DOM control panel
    this.syncPanel();
  }
}
