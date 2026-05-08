/**
 * PlotForgeScene — interactive preview tool for plot compounds.
 *
 * A plot is a compound: main building + yard objects + fencing + path anchor.
 * This scene lets you cycle through plot templates and see how they look
 * on an isometric grid. It's the design tool for the plot system.
 *
 * Routes: /pf, /plotforge
 * Controls: A/D cycle plots, scroll zoom, right-drag pan
 */

import * as Phaser from 'phaser';

// ── Interfaces ──────────────────────────────────────────────────────────────

interface YardObject {
  id: string;
  type: 'building' | 'craft-station' | 'decorative';
  pos: { tx: number; ty: number };
  spriteKey: string | null;
  footprint: { w: number; d: number };
}

interface FencingConfig {
  type: 'none' | 'wooden-fence' | 'palisade' | 'stone-wall' | 'hedge';
  gatePos: { tx: number; ty: number };
}

interface PlotEntry {
  id: string;
  name: string;
  tier: number;
  purposes: string[];
  mainBuilding: string;
  mainBuildingPos: { tx: number; ty: number };
  plotSize: { w: number; d: number };
  yardObjects: YardObject[];
  fencing: FencingConfig;
  pathAnchor: { tx: number; ty: number };
}

interface SpriteConfig {
  key: string;
  footprintW: number;
  footprintD: number;
  offsetX: number;
  offsetY: number;
  flipped?: boolean;
  exits?: { tx: number; ty: number }[];
  done?: boolean;
  needsEdit?: boolean;
}

interface RegistryEntry {
  id: string;
  name: string;
  category: string;
  baseSizeRange: [number, number];
  baseDepthRange?: [number, number];
  heightHint: string;
  sprite?: SpriteConfig;
  sprites?: SpriteConfig[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const YARD_COLORS: Record<string, number> = {
  'building':      0x4488cc,
  'craft-station': 0xcc8844,
  'decorative':    0x88aa44,
};

const FENCE_COLORS: Record<string, number> = {
  'wooden-fence': 0x8b6914,
  'palisade':     0x5a3a1a,
  'stone-wall':   0x777777,
  'hedge':        0x3a7a3a,
};

const FENCE_WIDTH: Record<string, number> = {
  'wooden-fence': 1,
  'palisade':     2,
  'stone-wall':   2,
  'hedge':        1,
};

// ── Scene ───────────────────────────────────────────────────────────────────

export class PlotForgeScene extends Phaser.Scene {
  static readonly KEY = 'PlotForgeScene';

  constructor() { super({ key: PlotForgeScene.KEY }); }

  // ── Iso grid ────────────────────────────────────────────────────────────
  private zoomFactor = 2.0;
  private get ISO_W() { return 24 * this.zoomFactor; }
  private get ISO_H() { return 12 * this.zoomFactor; }
  private originX = 0;
  private originY = 0;

  // ── Data ────────────────────────────────────────────────────────────────
  private plots: PlotEntry[] = [];
  private currentIdx = 0;
  private spriteConfigs = new Map<string, SpriteConfig>();
  private buildingCategories = new Map<string, string>();

  // ── Display objects (destroyed on rebuild) ──────────────────────────────
  private groundGfx: Phaser.GameObjects.Graphics | null = null;
  private plotObjects: Phaser.GameObjects.GameObject[] = [];
  private labelObjects: Phaser.GameObjects.Text[] = [];

  // ── DOM ─────────────────────────────────────────────────────────────────
  private controlPanel: HTMLDivElement | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    this.load.json('plot-registry', '/macro-world/plot-registry.json');
    this.load.json('building-registry', '/macro-world/building-registry.json');

    // Building sprite images (same keys as SettlementForgeScene/BuildingForgeScene)
    const ikiBase = '/assets/packs/building-objects/ikibeki';
    this.load.image('iki-campfire',       `${ikiBase}/campfire.png`);
    this.load.image('iki-well',           `${ikiBase}/well.png`);
    this.load.image('iki-guard-post',     `${ikiBase}/guard-post.png`);
    this.load.image('iki-shrine',         `${ikiBase}/shrine.png`);
    this.load.image('iki-spirit-shrine',  `${ikiBase}/spirit-shrine.png`);
    this.load.image('iki-watchtower',     `${ikiBase}/watchtower.png`);
    this.load.image('iki-cottage',        `${ikiBase}/cottage.png`);
    this.load.image('iki-ger-cottage',    `${ikiBase}/ger-cottage.png`);
    this.load.image('iki-ger-dwelling',   `${ikiBase}/ger-dwelling.png`);
    this.load.image('iki-ger-smithy',     `${ikiBase}/ger-smithy.png`);
    this.load.image('iki-smithy',         `${ikiBase}/smithy.png`);
    this.load.image('iki-farmstead',      `${ikiBase}/farmstead.png`);
    this.load.image('iki-longhouse',      `${ikiBase}/longhouse.png`);
    this.load.image('iki-clan-lodge',     `${ikiBase}/clan-lodge.png`);
    this.load.image('iki-shelter-hut',    `${ikiBase}/shelter-hut.png`);
    this.load.image('iki-merchant-stall', `${ikiBase}/merchant-stall.png`);
    this.load.image('iki-tavern',         `${ikiBase}/tavern.png`);
    this.load.image('iki-warehouse',      `${ikiBase}/warehouse.png`);
    this.load.image('iki-stables',        `${ikiBase}/stables.png`);
    this.load.image('iki-sawmill',        `${ikiBase}/sawmill.png`);
    this.load.image('iki-smokehouse',     `${ikiBase}/smokehouse.png`);
    this.load.image('iki-yurt-small',     `${ikiBase}/yurt-small.png`);
    this.load.image('iki-yurt-large',     `${ikiBase}/yurt-large.png`);
    this.load.image('iki-ancestor-stone', `${ikiBase}/ancestor-stone.png`);
    this.load.image('iki-market-hall',    `${ikiBase}/market-hall.png`);
    this.load.image('iki-granary',        `${ikiBase}/granary.png`);
    this.load.image('iki-temple',         `${ikiBase}/temple.png`);
    this.load.image('iki-root-cellar',    `${ikiBase}/root-cellar.png`);
    this.load.image('iki-barracks',       `${ikiBase}/barracks.png`);
    this.load.image('iki-town-hall',      `${ikiBase}/town-hall.png`);
    this.load.image('iki-inn',            `${ikiBase}/inn.png`);
    this.load.image('iki-brewery',        `${ikiBase}/brewery.png`);
    this.load.image('iki-barn',           `${ikiBase}/barn.png`);
    this.load.image('iki-armory',         `${ikiBase}/armory.png`);
    this.load.image('iki-palisade-gate',  `${ikiBase}/palisade-gate.png`);
  }

  create(): void {
    // Parse building registry for sprite configs + categories
    const regData = this.cache.json.get('building-registry') as { buildings: RegistryEntry[] } | undefined;
    if (regData?.buildings) {
      for (const entry of regData.buildings) {
        const variants = entry.sprites ?? (entry.sprite ? [entry.sprite] : []);
        const usable = variants.find(v => v.done && v.key);
        if (usable) this.spriteConfigs.set(entry.id, usable);
        this.buildingCategories.set(entry.id, entry.category);
      }
    }

    // Parse plot registry
    const plotData = this.cache.json.get('plot-registry') as { plots: PlotEntry[] } | undefined;
    if (plotData?.plots) this.plots = plotData.plots;

    this.cameras.main.setBackgroundColor('#1a1a2e');

    // URL param: ?plot=smithy-compound
    const params = new URLSearchParams(window.location.search);
    const plotParam = params.get('plot');
    if (plotParam) {
      const idx = this.plots.findIndex(p => p.id === plotParam);
      if (idx >= 0) this.currentIdx = idx;
    }

    // ── Keyboard ──────────────────────────────────────────────────────────
    const kb = this.input.keyboard!;
    kb.on('keydown-A',     () => this.cyclePlot(-1));
    kb.on('keydown-D',     () => this.cyclePlot(+1));
    kb.on('keydown-LEFT',  () => this.cyclePlot(-1));
    kb.on('keydown-RIGHT', () => this.cyclePlot(+1));

    // ── Zoom ──────────────────────────────────────────────────────────────
    const applyZoom = (factor: number) => {
      this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor * factor, 0.5, 6.0);
      this.rebuild();
    };
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, dy: number) =>
      applyZoom(dy > 0 ? 0.88 : 1.0 / 0.88));
    kb.on('keydown-PLUS',         () => applyZoom(1.15));
    kb.on('keydown-NUMPAD_ADD',   () => applyZoom(1.15));
    kb.on('keydown-MINUS',        () => applyZoom(1 / 1.15));
    kb.on('keydown-NUMPAD_MINUS', () => applyZoom(1 / 1.15));

    // ── Pan ───────────────────────────────────────────────────────────────
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!ptr.isDown) return;
      if (ptr.button === 2 || ptr.button === 1) {
        const cam = this.cameras.main;
        cam.scrollX -= (ptr.x - ptr.prevPosition.x) / cam.zoom;
        cam.scrollY -= (ptr.y - ptr.prevPosition.y) / cam.zoom;
      }
    });
    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.buildControlPanel();
    this.rebuild();
  }

  shutdown(): void {
    if (this.controlPanel) {
      this.controlPanel.remove();
      this.controlPanel = null;
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  private cyclePlot(dir: number): void {
    if (this.plots.length === 0) return;
    this.currentIdx = (this.currentIdx + dir + this.plots.length) % this.plots.length;
    this.rebuild();
    this.updateControlPanel();
  }

  // ── Iso helpers ─────────────────────────────────────────────────────────

  private isoPos(tx: number, ty: number): { x: number; y: number } {
    return {
      x: this.originX + (tx - ty) * (this.ISO_W / 2),
      y: this.originY + (tx + ty) * (this.ISO_H / 2),
    };
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

  // ── Rebuild ─────────────────────────────────────────────────────────────

  private rebuild(): void {
    // Clean up previous render
    this.groundGfx?.destroy();
    this.groundGfx = null;
    for (const obj of this.plotObjects) obj.destroy();
    this.plotObjects = [];
    for (const lbl of this.labelObjects) lbl.destroy();
    this.labelObjects = [];

    if (this.plots.length === 0) return;
    const plot = this.plots[this.currentIdx];

    // Centre the plot grid on screen
    const { width, height } = this.cameras.main;
    this.originX = width / 2;
    this.originY = height * 0.25;

    const gfx = this.add.graphics();
    this.groundGfx = gfx;

    this.renderGround(gfx, plot);
    this.renderFencing(gfx, plot);
    this.renderMainBuilding(plot);
    this.renderYardObjects(gfx, plot);
    this.renderPathAnchor(gfx, plot);
    this.renderHUD(plot);
  }

  // ── Ground grid ─────────────────────────────────────────────────────────

  private renderGround(gfx: Phaser.GameObjects.Graphics, plot: PlotEntry): void {
    const { w, d } = plot.plotSize;
    for (let ty = 0; ty < d; ty++) {
      for (let tx = 0; tx < w; tx++) {
        this.drawIsoDiamond(gfx, tx, ty, 0x2d6b2e, 0.4, 0x1a4a1a, 0.3);
      }
    }
  }

  // ── Fencing ─────────────────────────────────────────────────────────────

  private renderFencing(gfx: Phaser.GameObjects.Graphics, plot: PlotEntry): void {
    if (plot.fencing.type === 'none') return;

    const color = FENCE_COLORS[plot.fencing.type] ?? 0x8b6914;
    const lineW = FENCE_WIDTH[plot.fencing.type] ?? 1;
    const { w, d } = plot.plotSize;
    const gate = plot.fencing.gatePos;

    gfx.lineStyle(lineW, color, 0.8);

    // Walk the perimeter and draw edges, skipping the gate tile
    const edges: [number, number, number, number][] = [];

    // Top edge (ty=0): tiles (0,0) to (w-1,0)
    for (let tx = 0; tx < w; tx++) {
      if (tx === gate.tx && gate.ty === 0) continue;
      const a = this.isoPos(tx, 0);
      const hw = this.ISO_W / 2;
      const hh = this.ISO_H / 2;
      edges.push([a.x - hw, a.y + hh, a.x, a.y]);
    }
    // Right edge (tx=w-1): tiles (w-1,0) to (w-1,d-1)
    for (let ty = 0; ty < d; ty++) {
      if (gate.tx === w - 1 && ty === gate.ty) continue;
      const a = this.isoPos(w - 1, ty);
      const hw = this.ISO_W / 2;
      const hh = this.ISO_H / 2;
      edges.push([a.x + hw, a.y + hh, a.x, a.y]);
    }
    // Bottom edge (ty=d-1): tiles (0,d-1) to (w-1,d-1)
    for (let tx = 0; tx < w; tx++) {
      if (tx === gate.tx && gate.ty === d - 1) continue;
      const a = this.isoPos(tx, d - 1);
      const hw = this.ISO_W / 2;
      const hh = this.ISO_H / 2;
      edges.push([a.x, a.y + hh * 2, a.x + hw, a.y + hh]);
    }
    // Left edge (tx=0): tiles (0,0) to (0,d-1)
    for (let ty = 0; ty < d; ty++) {
      if (gate.tx === 0 && ty === gate.ty) continue;
      const a = this.isoPos(0, ty);
      const hw = this.ISO_W / 2;
      const hh = this.ISO_H / 2;
      edges.push([a.x - hw, a.y + hh, a.x, a.y + hh * 2]);
    }

    for (const [x1, y1, x2, y2] of edges) {
      gfx.beginPath();
      gfx.moveTo(x1, y1);
      gfx.lineTo(x2, y2);
      gfx.strokePath();
    }
  }

  // ── Main building ───────────────────────────────────────────────────────

  private renderMainBuilding(plot: PlotEntry): void {
    const cfg = this.spriteConfigs.get(plot.mainBuilding);
    const { tx, ty } = plot.mainBuildingPos;

    if (cfg?.key && this.textures.exists(cfg.key)) {
      // Stamp the sprite at the building position
      const { x, y } = this.isoPos(tx, ty);
      const spriteScale = this.ISO_W / 32;
      const img = this.add.image(
        x + (cfg.offsetX * spriteScale),
        y + (cfg.offsetY * spriteScale),
        cfg.key,
      );
      img.setScale(spriteScale);
      img.setDepth(10 + tx + ty);
      if (cfg.flipped) img.setFlipX(true);
      this.plotObjects.push(img);
    } else {
      // Placeholder: colored iso diamond
      const color = YARD_COLORS['building'] ?? 0x4488cc;
      const gfx = this.add.graphics();
      this.plotObjects.push(gfx);
      this.drawIsoDiamond(gfx, tx, ty, color, 0.6, 0xffffff, 0.5);
    }

    // Label
    const { x: lx, y: ly } = this.isoPos(tx, ty);
    const label = this.add.text(lx, ly + this.ISO_H, plot.mainBuilding, {
      fontSize: '10px', color: '#ffffff', backgroundColor: '#00000088',
      padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 0).setDepth(100);
    this.labelObjects.push(label);
  }

  // ── Yard objects ────────────────────────────────────────────────────────

  private renderYardObjects(gfx: Phaser.GameObjects.Graphics, plot: PlotEntry): void {
    for (const obj of plot.yardObjects) {
      const { tx, ty } = obj.pos;
      const color = YARD_COLORS[obj.type] ?? 0x888888;

      if (obj.spriteKey && this.textures.exists(obj.spriteKey)) {
        const { x, y } = this.isoPos(tx, ty);
        const spriteScale = this.ISO_W / 32;
        const img = this.add.image(x, y + this.ISO_H / 2, obj.spriteKey);
        img.setScale(spriteScale);
        img.setDepth(10 + tx + ty);
        this.plotObjects.push(img);
      } else {
        // Render footprint as colored diamonds
        for (let dy = 0; dy < obj.footprint.d; dy++) {
          for (let dx = 0; dx < obj.footprint.w; dx++) {
            this.drawIsoDiamond(gfx, tx + dx, ty + dy, color, 0.5, 0xffffff, 0.3);
          }
        }
      }

      // Label
      const { x: lx, y: ly } = this.isoPos(tx, ty);
      const label = this.add.text(lx, ly + this.ISO_H, obj.id, {
        fontSize: '9px', color: '#cccccc', backgroundColor: '#00000088',
        padding: { x: 2, y: 1 },
      }).setOrigin(0.5, 0).setDepth(100);
      this.labelObjects.push(label);
    }
  }

  // ── Path anchor ─────────────────────────────────────────────────────────

  private renderPathAnchor(gfx: Phaser.GameObjects.Graphics, plot: PlotEntry): void {
    this.drawIsoDiamond(gfx, plot.pathAnchor.tx, plot.pathAnchor.ty, 0xffaa33, 0.6, 0xffffff, 0.5);
    const { x, y } = this.isoPos(plot.pathAnchor.tx, plot.pathAnchor.ty);
    const label = this.add.text(x, y + this.ISO_H, '→ road', {
      fontSize: '9px', color: '#ffaa33', backgroundColor: '#00000088',
      padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 0).setDepth(100);
    this.labelObjects.push(label);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────

  private renderHUD(plot: PlotEntry): void {
    const lines = [
      `Plot: ${plot.name} (${plot.id})`,
      `Tier: ${plot.tier}`,
      `Main: ${plot.mainBuilding}`,
      `Size: ${plot.plotSize.w}×${plot.plotSize.d}`,
      `Yard: ${plot.yardObjects.length} objects`,
      `Fence: ${plot.fencing.type}`,
      `Purposes: ${plot.purposes.join(', ')}`,
      '',
      'A/D — cycle plots',
      'Scroll — zoom',
      'Right-drag — pan',
    ];
    const hud = this.add.text(8, 8, lines.join('\n'), {
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 8, y: 6 },
      lineSpacing: 4,
    }).setDepth(200).setScrollFactor(0);
    this.labelObjects.push(hud);

    // Plot index indicator (bottom-centre)
    const idx = this.add.text(
      this.cameras.main.width / 2, this.cameras.main.height - 20,
      `${this.currentIdx + 1} / ${this.plots.length}`,
      { fontSize: '14px', color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 6, y: 3 } },
    ).setOrigin(0.5, 1).setDepth(200).setScrollFactor(0);
    this.labelObjects.push(idx);
  }

  // ── DOM control panel ───────────────────────────────────────────────────

  private buildControlPanel(): void {
    if (this.controlPanel) return;
    const panel = document.createElement('div');
    panel.id = 'pf-control-panel';
    panel.style.cssText = `
      position: fixed; top: 8px; right: 8px; width: 200px;
      background: #1a1a2eee; color: #ccc; font: 12px monospace;
      padding: 10px; border-radius: 6px; z-index: 1000;
      border: 1px solid #333;
    `;
    this.controlPanel = panel;
    document.body.appendChild(panel);
    this.updateControlPanel();
  }

  private updateControlPanel(): void {
    if (!this.controlPanel || this.plots.length === 0) return;
    const plot = this.plots[this.currentIdx];

    const yardList = plot.yardObjects.map(o => {
      const typeTag = o.type === 'craft-station' ? '⚙' : o.type === 'building' ? '🏠' : '🌿';
      const sprite = o.spriteKey ? '✓' : '○';
      return `<li>${typeTag} ${o.id} [${o.footprint.w}×${o.footprint.d}] ${sprite}</li>`;
    }).join('');

    this.controlPanel.innerHTML = `
      <h3 style="margin:0 0 8px 0; color:#fff; font-size:13px;">Plot Forge</h3>
      <select id="pf-plot-select" style="width:100%; margin-bottom:8px; background:#222; color:#ccc; border:1px solid #555; padding:3px;">
        ${this.plots.map((p, i) => `<option value="${i}" ${i === this.currentIdx ? 'selected' : ''}>${p.name}</option>`).join('')}
      </select>
      <div style="margin-bottom:6px;"><b>Tier:</b> ${plot.tier}</div>
      <div style="margin-bottom:6px;"><b>Main:</b> ${plot.mainBuilding}</div>
      <div style="margin-bottom:6px;"><b>Size:</b> ${plot.plotSize.w}×${plot.plotSize.d}</div>
      <div style="margin-bottom:6px;"><b>Fence:</b> ${plot.fencing.type}</div>
      <div style="margin-bottom:4px;"><b>Yard objects:</b></div>
      <ul style="margin:0; padding-left:16px; font-size:11px;">${yardList}</ul>
      <hr style="border-color:#333; margin:8px 0;">
      <div style="font-size:10px; color:#888;">
        ⚙ = craft-station<br>
        🏠 = building<br>
        🌿 = decorative<br>
        ✓ = has sprite<br>
        ○ = placeholder
      </div>
    `;

    document.getElementById('pf-plot-select')?.addEventListener('change', (e) => {
      this.currentIdx = parseInt((e.target as HTMLSelectElement).value, 10);
      this.rebuild();
    });
  }
}
