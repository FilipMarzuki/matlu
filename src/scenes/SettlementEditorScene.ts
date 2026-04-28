/**
 * SettlementEditorScene — manual settlement authoring tool.
 *
 * Lets designers start from a generator output or a blank canvas, then
 * hand-craft the layout: drag buildings, paint roads, resize the plaza,
 * pick buildings from the registry catalogue, and export the result as JSON.
 *
 * The exported JSON can be loaded directly by the game, bypassing the
 * procedural generator — useful for story-critical or unique settlements.
 *
 * Access: /se or /settlement-editor
 *
 * ## Keyboard shortcuts
 *   S             Select / move tool
 *   A             Add Building tool
 *   R             Road (main) paint tool
 *   Q             Road (secondary) paint tool
 *   E             Erase tool
 *   Tab           Rotate selected building's entrance (n→e→s→w→none)
 *   Delete        Remove selected building
 *   Ctrl+Z        Undo
 *   Ctrl+Shift+Z  Redo (also Ctrl+Y)
 *   Scroll / +/-  Zoom
 *   Middle drag   Pan
 *   ESC           Back to main menu
 *
 * ## Relation to SettlementForgeScene
 * The forge is a parameter-tuning preview. The editor is a hand-authoring
 * tool. Both share iso rendering math via src/lib/IsoRenderer.ts.
 *
 * ## Save format (game integration)
 * JSON matching SavedLayout: buildings(id,tx,ty,widthT,entranceSide?),
 * roads(tx,ty,main), plaza(tx,ty,size). The game can load this directly.
 */

import * as Phaser from 'phaser';
import {
  isoPos, screenToTile,
  drawIsoDiamond, drawIsoBox,
  type IsoConfig, type IsoBoxCorners,
} from '../lib/IsoRenderer';
import {
  getAllCultures, getAllBuildings, generateSettlement, initSettlementData,
} from '../world/SettlementGenerator';
import { placeBuildings } from '../world/SettlementPlacement';
import type { SettlementSite, SettlementTier } from '../world/SettlementSpec';
import type { EntranceSide } from '../world/SettlementPlacement';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Runtime building — includes display fields derived from the registry. */
interface EditorBuilding {
  id: string;
  name: string;       // from registry; not saved to JSON
  category: string;   // from registry; drives colour; not saved
  tx: number;
  ty: number;
  widthT: number;
  entranceSide?: EntranceSide;
}

interface EditorState {
  buildings: EditorBuilding[];
  roads: Array<{ tx: number; ty: number; main: boolean }>;
  plaza: { tx: number; ty: number; size: number };
}

/**
 * The JSON format saved to disk and consumed by the game.
 * name/category are intentionally omitted — the game looks them up by id.
 */
interface SavedLayout {
  version: 1;
  buildings: Array<{
    id: string;
    tx: number;
    ty: number;
    widthT: number;
    entranceSide?: EntranceSide;
  }>;
  roads: Array<{ tx: number; ty: number; main: boolean }>;
  plaza: { tx: number; ty: number; size: number };
}

type EditorTool = 'select' | 'add' | 'road-main' | 'road-secondary' | 'erase';

type CatalogueEntry = ReturnType<typeof getAllBuildings>[number];

// ── Constants ─────────────────────────────────────────────────────────────────

const PANEL_W = 260;

const CAT_COLORS: Record<string, number> = {
  civic:          0x4488cc,
  residential:    0x88aa44,
  commerce:       0xcc8844,
  industry:       0x999999,
  military:       0xcc4444,
  religious:      0xaa66cc,
  infrastructure: 0x777777,
  anomaly:        0xff44ff,
};

/** Zone fractions — must match SettlementPlacement / SettlementForgeScene. */
const ZONE_FRAC: Record<string, { min: number; max: number }> = {
  inner:  { min: 0.10, max: 0.38 },
  middle: { min: 0.38, max: 0.65 },
  outer:  { min: 0.65, max: 0.90 },
};

const ENTRANCE_CYCLE: Array<EntranceSide | undefined> = ['n', 'e', 's', 'w', undefined];

// ── PRNG ──────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export class SettlementEditorScene extends Phaser.Scene {

  // ── Iso constants ──────────────────────────────────────────────────────────
  private readonly TILE = 32; // pixels per iso tile in world-space

  private zoomFactor = 1.0;
  private get isoW() { return 24 * this.zoomFactor; }
  private get isoH() { return 12 * this.zoomFactor; }
  private originX = 0;
  private originY = 0;
  private gridSize = 40; // total tiles across the working grid

  // ── Editor state + undo history ────────────────────────────────────────────
  private state: EditorState = {
    buildings: [],
    roads: [],
    plaza: { tx: 20, ty: 20, size: 2 },
  };
  private history: EditorState[] = [];
  private historyIndex = -1;

  // ── Interaction ────────────────────────────────────────────────────────────
  private activeTool: EditorTool = 'select';
  private selectedBuildingIdx: number | null = null;

  // add tool: which building from the catalogue is queued for placement
  private pendingBuildingId: string | null = null;

  // drag state (select tool)
  private isDragging = false;
  private dragOrigTx = 0;
  private dragOrigTy = 0;

  // paint state (road / erase tools)
  private isPainting = false;

  // cursor tile — updated on every pointermove for ghost rendering
  private cursorTx = 0;
  private cursorTy = 0;

  // ── Display layers ─────────────────────────────────────────────────────────
  // Three separate graphics objects so we can update the cursor cheaply
  // without destroying all ground/building graphics.
  private groundGfx: Phaser.GameObjects.Graphics | null = null;
  private stateGfx: Phaser.GameObjects.Graphics | null = null;
  private cursorGfx: Phaser.GameObjects.Graphics | null = null;
  private labelObjs: Phaser.GameObjects.Text[] = [];

  // HUD text fixed to the camera
  private hudText: Phaser.GameObjects.Text | null = null;

  // ── DOM panel ──────────────────────────────────────────────────────────────
  private panel: HTMLDivElement | null = null;

  // forge params (persisted between forge loads)
  private forgeTier: SettlementTier = 3;
  private forgeCultureIdx = 0;
  private forgeSeed = 42;

  constructor() { super({ key: 'SettlementEditorScene' }); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  create(): void {
    // Load culture data from Supabase (JSON fallback works immediately)
    initSettlementData();
    this.cameras.main.setBackgroundColor('#1a1a2e');

    this.computeOrigin();
    this.pushUndo(); // initial state always in history

    this.buildPanel();
    this.setupInput();
    this.rebuild();
  }

  shutdown(): void {
    this.panel?.remove();
    this.panel = null;
  }

  // ── Iso helpers ────────────────────────────────────────────────────────────

  private get isoCfg(): IsoConfig {
    return { originX: this.originX, originY: this.originY, isoW: this.isoW, isoH: this.isoH };
  }

  /** Recompute origin so the iso grid is centred in the non-panel area. */
  private computeOrigin(): void {
    const { width: W, height: H } = this.scale;
    const gameAreaW = W - PANEL_W;
    const diamondH  = this.gridSize * this.isoH;
    this.originX = PANEL_W + gameAreaW / 2;
    this.originY = Math.round((H - diamondH) / 2 + this.isoH / 2);
  }

  /** Convert world coords (accounting for camera scroll) to nearest tile. */
  private tileAt(wx: number, wy: number): { tx: number; ty: number } {
    const { tx, ty } = screenToTile(this.isoCfg, wx, wy);
    return { tx: Math.round(tx), ty: Math.round(ty) };
  }

  // ── History ────────────────────────────────────────────────────────────────

  private cloneState(s: EditorState): EditorState {
    return JSON.parse(JSON.stringify(s)) as EditorState;
  }

  private pushUndo(): void {
    // Truncate any redo entries after the current index
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.cloneState(this.state));
    this.historyIndex = this.history.length - 1;
  }

  private undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this.state = this.cloneState(this.history[this.historyIndex]);
    this.selectedBuildingIdx = null;
    this.rebuildAll();
    this.updatePanel();
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this.state = this.cloneState(this.history[this.historyIndex]);
    this.selectedBuildingIdx = null;
    this.rebuildAll();
    this.updatePanel();
  }

  // ── Hit testing ───────────────────────────────────────────────────────────

  /** Index of building whose footprint contains tile (tx, ty), or -1. */
  private hitBuilding(tx: number, ty: number): number {
    for (let i = 0; i < this.state.buildings.length; i++) {
      const b = this.state.buildings[i];
      const half = Math.ceil(b.widthT / 2);
      if (Math.abs(tx - b.tx) <= half && Math.abs(ty - b.ty) <= half) return i;
    }
    return -1;
  }

  /** Index of road tile at (tx, ty), or -1. */
  private hitRoad(tx: number, ty: number): number {
    return this.state.roads.findIndex(r => r.tx === tx && r.ty === ty);
  }

  // ── Input setup ────────────────────────────────────────────────────────────

  private setupInput(): void {
    const kb = this.input.keyboard!;

    // Tool shortcuts
    kb.on('keydown-S', () => this.setTool('select'));
    kb.on('keydown-A', () => this.setTool('add'));
    kb.on('keydown-R', () => this.setTool('road-main'));
    kb.on('keydown-Q', () => this.setTool('road-secondary'));
    kb.on('keydown-E', () => this.setTool('erase'));

    // Entrance rotate / delete
    kb.on('keydown-TAB',    (e: KeyboardEvent) => { e.preventDefault(); this.rotateEntrance(); });
    kb.on('keydown-DELETE', () => this.deleteSelected());

    // Undo / redo
    kb.on('keydown-Z', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.shiftKey ? this.redo() : this.undo();
      }
    });
    kb.on('keydown-Y', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) this.redo();
    });

    // Zoom
    const zoom = (factor: number) => {
      this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor * factor, 0.3, 5.0);
      this.computeOrigin();
      this.rebuildAll();
    };
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, dy: number) =>
      zoom(dy > 0 ? 0.88 : 1 / 0.88));
    kb.on('keydown-PLUS',         () => zoom(1.15));
    kb.on('keydown-NUMPAD_ADD',   () => zoom(1.15));
    kb.on('keydown-MINUS',        () => zoom(1 / 1.15));
    kb.on('keydown-NUMPAD_MINUS', () => zoom(1 / 1.15));

    // Middle-click pan (same as SettlementForgeScene)
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (ptr.isDown && (ptr.button === 1 || ptr.button === 2)) {
        const cam = this.cameras.main;
        cam.scrollX -= (ptr.x - ptr.prevPosition.x) / cam.zoom;
        cam.scrollY -= (ptr.y - ptr.prevPosition.y) / cam.zoom;
      }
    });
    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Pointer tool events
    this.input.on('pointerdown',  this.onPointerDown,  this);
    this.input.on('pointermove',  this.onPointerMove,  this);
    this.input.on('pointerup',    this.onPointerUp,    this);

    // Exit
    kb.on('keydown-ESC', () => this.scene.start('MainMenuScene'));
  }

  // ── Pointer events ─────────────────────────────────────────────────────────

  private onPointerDown(ptr: Phaser.Input.Pointer): void {
    // Ignore clicks inside the DOM panel area and non-left-button
    if (ptr.x < PANEL_W + 4 || ptr.button !== 0) return;

    const { tx, ty } = this.tileAt(ptr.worldX, ptr.worldY);
    this.cursorTx = tx;
    this.cursorTy = ty;

    switch (this.activeTool) {
      case 'select':
        this.handleSelectDown(tx, ty);
        break;
      case 'add':
        this.handleAddDown(tx, ty);
        break;
      case 'road-main':
        this.isPainting = true;
        this.paintRoad(tx, ty, true);
        break;
      case 'road-secondary':
        this.isPainting = true;
        this.paintRoad(tx, ty, false);
        break;
      case 'erase':
        this.isPainting = true;
        this.eraseAt(tx, ty);
        break;
    }
  }

  private onPointerMove(ptr: Phaser.Input.Pointer): void {
    if (ptr.x < PANEL_W + 4) return;

    const { tx, ty } = this.tileAt(ptr.worldX, ptr.worldY);
    const tileChanged = tx !== this.cursorTx || ty !== this.cursorTy;
    this.cursorTx = tx;
    this.cursorTy = ty;

    // Middle/right drag → pan (handled in pan listener above)
    if (ptr.button === 1 || ptr.button === 2) return;

    if (this.isDragging && this.selectedBuildingIdx !== null) {
      this.state.buildings[this.selectedBuildingIdx].tx = tx;
      this.state.buildings[this.selectedBuildingIdx].ty = ty;
      this.rebuildAll();
      return;
    }

    if (!tileChanged) return; // cursor ghost only needs repaint on tile change

    if (this.isPainting) {
      switch (this.activeTool) {
        case 'road-main':      this.paintRoad(tx, ty, true);  break;
        case 'road-secondary': this.paintRoad(tx, ty, false); break;
        case 'erase':          this.eraseAt(tx, ty);          break;
        default: break;
      }
    }

    this.renderCursor();
  }

  private onPointerUp(ptr: Phaser.Input.Pointer): void {
    if (ptr.button !== 0) return;

    if (this.isDragging) {
      this.isDragging = false;
      const b = this.selectedBuildingIdx !== null ? this.state.buildings[this.selectedBuildingIdx] : null;
      // Only push undo if the building actually moved
      if (b && (b.tx !== this.dragOrigTx || b.ty !== this.dragOrigTy)) {
        this.pushUndo();
      }
      this.rebuildAll();
    }

    if (this.isPainting) {
      this.isPainting = false;
      this.pushUndo();
    }
  }

  // ── Tool handlers ──────────────────────────────────────────────────────────

  private handleSelectDown(tx: number, ty: number): void {
    const bIdx = this.hitBuilding(tx, ty);
    if (bIdx >= 0) {
      this.selectedBuildingIdx = bIdx;
      const b = this.state.buildings[bIdx];
      this.dragOrigTx = b.tx;
      this.dragOrigTy = b.ty;
      this.isDragging = true;
      this.updatePanel();
      this.rebuildAll();
    } else {
      this.selectedBuildingIdx = null;
      this.updatePanel();
      this.rebuildAll();
    }
  }

  private handleAddDown(tx: number, ty: number): void {
    if (!this.pendingBuildingId) return;

    const catalogue = this.buildCatalogueMap();
    const entry = catalogue.get(this.pendingBuildingId);
    if (!entry) return;

    const widthT = entry.baseSizeRange[0];

    const building: EditorBuilding = {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      tx,
      ty,
      widthT,
    };

    this.state.buildings.push(building);
    this.pushUndo();
    this.rebuildAll();
    this.updatePanel();
  }

  // ── Building operations ────────────────────────────────────────────────────

  private rotateEntrance(): void {
    if (this.selectedBuildingIdx === null) return;
    const b = this.state.buildings[this.selectedBuildingIdx];
    const idx = ENTRANCE_CYCLE.indexOf(b.entranceSide);
    b.entranceSide = ENTRANCE_CYCLE[(idx + 1) % ENTRANCE_CYCLE.length];
    this.pushUndo();
    this.rebuildAll();
    this.updatePanel();
  }

  private deleteSelected(): void {
    if (this.selectedBuildingIdx === null) return;
    this.state.buildings.splice(this.selectedBuildingIdx, 1);
    this.selectedBuildingIdx = null;
    this.pushUndo();
    this.rebuildAll();
    this.updatePanel();
  }

  // ── Road operations ────────────────────────────────────────────────────────

  private paintRoad(tx: number, ty: number, main: boolean): void {
    const idx = this.hitRoad(tx, ty);
    if (idx >= 0) {
      // Toggle off if same type, or change type if different
      if (this.state.roads[idx].main === main) {
        this.state.roads.splice(idx, 1);
      } else {
        this.state.roads[idx].main = main;
      }
    } else {
      this.state.roads.push({ tx, ty, main });
    }
    this.rebuildState();
  }

  private eraseAt(tx: number, ty: number): void {
    // Erase road first
    const rIdx = this.hitRoad(tx, ty);
    if (rIdx >= 0) {
      this.state.roads.splice(rIdx, 1);
      this.rebuildState();
      return;
    }
    // Then erase building
    const bIdx = this.hitBuilding(tx, ty);
    if (bIdx >= 0) {
      if (this.selectedBuildingIdx === bIdx) this.selectedBuildingIdx = null;
      this.state.buildings.splice(bIdx, 1);
      this.rebuildState();
    }
  }

  // ── Tool switching ─────────────────────────────────────────────────────────

  private setTool(tool: EditorTool): void {
    this.activeTool = tool;
    if (tool !== 'select') this.selectedBuildingIdx = null;
    if (tool !== 'add') this.pendingBuildingId = null;
    this.updatePanel();
    this.renderCursor();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** Full rebuild — ground + state layers + HUD. */
  private rebuildAll(): void {
    this.renderGround();
    this.rebuildState();
    this.renderCursor();
    this.renderHUD();
  }

  /** Alias for full rebuild (called externally where name clarity helps). */
  private rebuild(): void {
    this.rebuildAll();
  }

  /** Rebuild only the state layer (buildings + roads). Cheaper than full rebuild. */
  private rebuildState(): void {
    this.stateGfx?.destroy();
    for (const l of this.labelObjs) l.destroy();
    this.labelObjs = [];

    const gfx = this.add.graphics();
    this.stateGfx = gfx;

    this.renderRoads(gfx);
    this.renderPlaza(gfx);
    this.renderBuildings(gfx);
  }

  private renderGround(): void {
    this.groundGfx?.destroy();
    const gfx = this.add.graphics().setDepth(0);
    this.groundGfx = gfx;

    const G = this.gridSize;
    const cfg = this.isoCfg;

    // Draw ground tiles in painter's order (back → front) for correct iso overlap
    for (let sum = 0; sum < G * 2 - 1; sum++) {
      const txMin = Math.max(0, sum - (G - 1));
      const txMax = Math.min(sum, G - 1);
      for (let tx = txMin; tx <= txMax; tx++) {
        const ty = sum - tx;
        drawIsoDiamond(gfx, cfg, tx, ty, 0x2a3d2a, 0.4, 0x000000, 0.08);
      }
    }
  }

  private renderPlaza(gfx: Phaser.GameObjects.Graphics): void {
    const { plaza } = this.state;
    const cfg = this.isoCfg;
    for (let px = -plaza.size; px <= plaza.size; px++) {
      for (let py = -plaza.size; py <= plaza.size; py++) {
        drawIsoDiamond(gfx, cfg, plaza.tx + px, plaza.ty + py, 0xd4b483, 0.45);
      }
    }
  }

  private renderRoads(gfx: Phaser.GameObjects.Graphics): void {
    const cfg = this.isoCfg;
    for (const road of this.state.roads) {
      const color = road.main ? 0xd4b87a : 0xc9a050;
      const alpha = road.main ? 0.7 : 0.55;
      drawIsoDiamond(gfx, cfg, road.tx, road.ty, color, alpha);
    }
  }

  private renderBuildings(gfx: Phaser.GameObjects.Graphics): void {
    const cfg = this.isoCfg;

    // Painter's sort: back tiles first so front buildings overlap correctly
    const sorted = this.state.buildings
      .map((b, i) => ({ b, i }))
      .sort((a, b) => (a.b.tx + a.b.ty) - (b.b.tx + b.b.ty));

    for (const { b, i } of sorted) {
      const isSelected = i === this.selectedBuildingIdx;
      const base = CAT_COLORS[b.category] ?? 0x888888;
      const color = isSelected ? 0xffffff : base;
      const alpha = isSelected ? 0.95 : 0.85;

      gfx.setDepth(2 + (b.tx + b.ty) * 0.01);

      const corners: IsoBoxCorners = drawIsoBox(gfx, cfg, b.tx, b.ty, b.widthT, b.widthT, 0, color, alpha);

      // Draw entrance side marker in red
      if (b.entranceSide) {
        const { topN, topE, topS, topW } = corners;
        gfx.lineStyle(3, 0xff2222, 0.9);
        switch (b.entranceSide) {
          case 'n': gfx.lineBetween(topN.x, topN.y, topE.x, topE.y); break;
          case 'e': gfx.lineBetween(topE.x, topE.y, topS.x, topS.y); break;
          case 's': gfx.lineBetween(topS.x, topS.y, topW.x, topW.y); break;
          case 'w': gfx.lineBetween(topW.x, topW.y, topN.x, topN.y); break;
        }
      }

      // Selection highlight: yellow diamond outline on top face
      if (isSelected) {
        const { topN, topE, topS, topW } = corners;
        gfx.lineStyle(2, 0xffee00, 1.0);
        gfx.beginPath();
        gfx.moveTo(topN.x, topN.y);
        gfx.lineTo(topE.x, topE.y);
        gfx.lineTo(topS.x, topS.y);
        gfx.lineTo(topW.x, topW.y);
        gfx.closePath();
        gfx.strokePath();
      }

      // Building name label
      const { x, y } = isoPos(cfg, b.tx, b.ty);
      const label = this.add.text(x, y + cfg.isoH / 2, b.name, {
        fontSize: '8px',
        color: isSelected ? '#ffee00' : '#eeeeee',
        fontFamily: 'monospace',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5, 0.5).setDepth(10 + (b.tx + b.ty) * 0.01);
      this.labelObjs.push(label);
    }
  }

  /** Lightweight cursor ghost — redrawn on every pointer-move tile change. */
  private renderCursor(): void {
    this.cursorGfx?.destroy();
    const gfx = this.add.graphics().setDepth(50);
    this.cursorGfx = gfx;

    const cfg = this.isoCfg;
    const tx = this.cursorTx;
    const ty = this.cursorTy;

    switch (this.activeTool) {
      case 'select': {
        // Highlight the tile under the cursor in white if hovering a building
        const idx = this.hitBuilding(tx, ty);
        if (idx >= 0 && idx !== this.selectedBuildingIdx) {
          drawIsoDiamond(gfx, cfg, tx, ty, 0xffffff, 0.15);
        }
        break;
      }
      case 'add': {
        if (this.pendingBuildingId) {
          const catalogue = this.buildCatalogueMap();
          const entry = catalogue.get(this.pendingBuildingId);
          if (entry) {
            // Ghost building at cursor
            drawIsoBox(gfx, cfg, tx, ty, entry.baseSizeRange[0], entry.baseSizeRange[0], 0,
              CAT_COLORS[entry.category] ?? 0x888888, 0.45);
          }
        }
        break;
      }
      case 'road-main':
        drawIsoDiamond(gfx, cfg, tx, ty, 0xd4b87a, 0.5);
        break;
      case 'road-secondary':
        drawIsoDiamond(gfx, cfg, tx, ty, 0xc9a050, 0.5);
        break;
      case 'erase': {
        // Red X tile
        drawIsoDiamond(gfx, cfg, tx, ty, 0xff3333, 0.35);
        break;
      }
    }
  }

  private renderHUD(): void {
    this.hudText?.destroy();
    const toolLabels: Record<EditorTool, string> = {
      'select':         'S  Select/Move',
      'add':            'A  Add Building',
      'road-main':      'R  Road (main)',
      'road-secondary': 'Q  Road (secondary)',
      'erase':          'E  Erase',
    };
    const lines = [
      `Tool: ${toolLabels[this.activeTool]}`,
      'Tab: rotate entrance  Del: remove',
      'Ctrl+Z: undo  Ctrl+Shift+Z: redo',
    ];
    this.hudText = this.add.text(
      PANEL_W + 8, this.scale.height - 8,
      lines.join('\n'),
      {
        fontSize: '10px',
        color: '#aaaacc',
        fontFamily: 'monospace',
        backgroundColor: '#1a1a2ecc',
        padding: { x: 6, y: 4 },
        lineSpacing: 2,
      },
    ).setOrigin(0, 1).setDepth(100).setScrollFactor(0);
  }

  // ── Forge loader ───────────────────────────────────────────────────────────

  /**
   * Generate a settlement via SettlementGenerator + placeBuildings, then
   * import the result as the current editor state.
   * Same parameter pipeline as SettlementForgeScene.
   */
  private loadFromForge(): void {
    const cultures = getAllCultures();
    const culture = cultures[this.forgeCultureIdx];

    const site: SettlementSite = {
      x: 400, y: 400,
      geography: 'plains',
      features: [],
      adjacentResources: [],
      nearCorruption: false,
      tradeRouteCount: this.forgeTier * 2,
      nearbySettlements: this.forgeTier,
      cultureId: culture.id,
    };

    const rng = mulberry32(this.forgeSeed);
    const { spec, buildings } = generateSettlement(
      site,
      'Editor Import',
      rng,
      this.forgeTier,
    );

    // Recalculate grid size to fit the settlement (same formula as SettlementForgeScene)
    this.gridSize = Math.ceil(spec.radius / this.TILE) * 3 + 8;
    this.computeOrigin();

    const { buildings: placed, roads } = placeBuildings({
      buildings,
      radiusTiles: spec.radius / this.TILE,
      gridSize: this.gridSize,
      tileSize: this.TILE,
      seed: this.forgeSeed,
      zoneFracs: ZONE_FRAC,
      streetPattern: (culture.streetPattern ?? 'none') as
        'grid' | 'radial' | 'organic' | 'linear' | 'none' | 'branching',
    });

    // Map PlacedBuilding → EditorBuilding (buildings have names from ResolvedBuilding)
    const editorBuildings: EditorBuilding[] = placed.map(p => ({
      id: p.building.id,
      name: p.building.id,
      category: p.building.category,
      tx: p.tx,
      ty: p.ty,
      widthT: p.widthT,
      entranceSide: p.entranceSide,
    }));

    // Plaza: centre of grid, size proportional to tier
    const mid = Math.floor(this.gridSize / 2);
    const plazaSize = [0, 0, 1, 2, 3, 4][this.forgeTier] ?? 2;

    this.state = {
      buildings: editorBuildings,
      roads,
      plaza: { tx: mid, ty: mid, size: plazaSize },
    };

    this.selectedBuildingIdx = null;
    this.pushUndo();
    this.rebuildAll();
    this.updatePanel();
  }

  // ── Save / Load ────────────────────────────────────────────────────────────

  private toSavedLayout(): SavedLayout {
    return {
      version: 1,
      buildings: this.state.buildings.map(b => ({
        id: b.id,
        tx: b.tx,
        ty: b.ty,
        widthT: b.widthT,
        ...(b.entranceSide !== undefined ? { entranceSide: b.entranceSide } : {}),
      })),
      roads: [...this.state.roads],
      plaza: { ...this.state.plaza },
    };
  }

  private fromSavedLayout(layout: SavedLayout): void {
    const registryMap = this.buildCatalogueMap();

    const buildings: EditorBuilding[] = layout.buildings.map(b => {
      const entry = registryMap.get(b.id);
      return {
        id: b.id,
        name: entry?.name ?? b.id,
        category: entry?.category ?? 'unknown',
        tx: b.tx,
        ty: b.ty,
        widthT: b.widthT,
        entranceSide: b.entranceSide,
      };
    });

    this.state = {
      buildings,
      roads: layout.roads ?? [],
      plaza: layout.plaza ?? { tx: 20, ty: 20, size: 2 },
    };

    this.selectedBuildingIdx = null;
    this.pushUndo();
    this.rebuildAll();
    this.updatePanel();
  }

  private saveJSON(): void {
    const json = JSON.stringify(this.toSavedLayout(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'settlement-layout.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private loadJSONFromString(text: string): void {
    try {
      const layout = JSON.parse(text) as SavedLayout;
      if (!Array.isArray(layout.buildings) || !Array.isArray(layout.roads)) {
        throw new Error('Invalid layout format');
      }
      this.fromSavedLayout(layout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to load layout: ${msg}`);
    }
  }

  // ── Catalogue helper ───────────────────────────────────────────────────────

  private buildCatalogueMap(): Map<string, CatalogueEntry> {
    const map = new Map<string, CatalogueEntry>();
    for (const entry of getAllBuildings()) map.set(entry.id, entry);
    return map;
  }

  // ── DOM Panel ──────────────────────────────────────────────────────────────

  private buildPanel(): void {
    document.getElementById('se-control-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'se-control-panel';

    const cultures = getAllCultures();

    panel.innerHTML = `
      <style>
        #se-control-panel {
          position: fixed; top: 0; left: 0; bottom: 0; width: ${PANEL_W}px;
          background: #12121eee; border-right: 1px solid #334;
          font-family: monospace; font-size: 12px; color: #ccd;
          padding: 10px; overflow-y: auto; z-index: 500;
          display: flex; flex-direction: column; gap: 6px;
          box-sizing: border-box;
        }
        #se-control-panel h3 { margin: 0; color: #aaccff; font-size: 13px; }
        #se-control-panel label { color: #889; font-size: 11px; display: block; margin-bottom: 2px; }
        #se-control-panel select, #se-control-panel input[type="number"],
        #se-control-panel input[type="text"] {
          width: 100%; background: #1a1a2e; color: #dde; border: 1px solid #446;
          border-radius: 4px; padding: 3px 6px; font-family: monospace; font-size: 11px;
          box-sizing: border-box;
        }
        .se-divider { border-top: 1px solid #334; margin: 2px 0; }
        .se-tool-row { display: flex; flex-wrap: wrap; gap: 4px; }
        .se-btn {
          background: #2a2a4e; color: #aab; border: 1px solid #446;
          border-radius: 3px; padding: 4px 7px; cursor: pointer;
          font-family: monospace; font-size: 11px; flex: 1; text-align: center;
          white-space: nowrap;
        }
        .se-btn:hover { background: #3a3a5e; color: #fff; }
        .se-btn.active { background: #334477; color: #aaccff; border-color: #6688bb; }
        .se-btn-full { width: 100%; box-sizing: border-box; }
        .se-cat-list {
          max-height: 180px; overflow-y: auto;
          border: 1px solid #334; border-radius: 3px; background: #0d0d1a;
        }
        .se-cat-item {
          padding: 3px 6px; cursor: pointer; color: #aab; font-size: 11px;
          display: flex; align-items: center; gap: 4px;
        }
        .se-cat-item:hover { background: #1a1a2e; color: #fff; }
        .se-cat-item.selected { background: #223355; color: #aaccff; }
        .se-cat-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
        .se-info { font-size: 11px; color: #889; padding: 2px 0; }
        #se-selected-info { color: #aaccff; font-size: 11px; }
      </style>

      <h3>Settlement Editor</h3>

      <div class="se-divider"></div>
      <h3>Tools</h3>
      <div class="se-tool-row" id="se-tool-row"></div>

      <div class="se-divider"></div>
      <div id="se-add-section" style="display:none">
        <h3>Add Building</h3>
        <input type="text" id="se-cat-filter" placeholder="Filter…" />
        <div class="se-cat-list" id="se-cat-list"></div>
      </div>

      <div class="se-divider"></div>
      <div id="se-selected-section">
        <h3>Selected</h3>
        <div id="se-selected-info" class="se-info">Nothing selected</div>
        <div id="se-selected-btns" style="display:none; margin-top:4px; display:flex; gap:4px;">
          <button class="se-btn" id="se-rotate-btn">↻ Rotate entrance (Tab)</button>
          <button class="se-btn" id="se-delete-btn">✕ Delete</button>
        </div>
      </div>

      <div class="se-divider"></div>
      <h3>Plaza</h3>
      <div style="display:flex; gap:4px; align-items:center;">
        <label style="margin:0;white-space:nowrap">Size:</label>
        <input type="number" id="se-plaza-size" value="${this.state.plaza.size}" min="0" max="10" style="width:50px" />
        <label style="margin:0;white-space:nowrap">tx:</label>
        <input type="number" id="se-plaza-tx" value="${this.state.plaza.tx}" min="0" style="width:50px" />
        <label style="margin:0;white-space:nowrap">ty:</label>
        <input type="number" id="se-plaza-ty" value="${this.state.plaza.ty}" min="0" style="width:50px" />
      </div>
      <button class="se-btn se-btn-full" id="se-apply-plaza">Apply Plaza</button>

      <div class="se-divider"></div>
      <h3>Load from Forge</h3>
      <div>
        <label>Tier</label>
        <input type="number" id="se-forge-tier" value="${this.forgeTier}" min="1" max="5" />
      </div>
      <div>
        <label>Culture</label>
        <select id="se-forge-culture">
          ${cultures.map((c, i) => `<option value="${i}"${i === this.forgeCultureIdx ? ' selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Seed</label>
        <input type="number" id="se-forge-seed" value="${this.forgeSeed}" />
      </div>
      <button class="se-btn se-btn-full" id="se-forge-load">⚡ Generate &amp; Import</button>

      <div class="se-divider"></div>
      <h3>Layout</h3>
      <button class="se-btn se-btn-full" id="se-save-btn">💾 Export JSON</button>
      <button class="se-btn se-btn-full" id="se-load-btn">📂 Load JSON…</button>
      <input type="file" id="se-file-input" accept=".json" style="display:none" />

      <div class="se-divider"></div>
      <button class="se-btn se-btn-full" id="se-back-btn">← Back to Menu (ESC)</button>
    `;

    document.body.appendChild(panel);
    this.panel = panel;

    this.buildToolButtons();
    this.refreshCatalogueList('');
    this.wirePanel();
  }

  private buildToolButtons(): void {
    const row = document.getElementById('se-tool-row')!;
    const tools: Array<{ key: EditorTool; label: string }> = [
      { key: 'select',         label: 'S Select' },
      { key: 'add',            label: 'A Add' },
      { key: 'road-main',      label: 'R Road' },
      { key: 'road-secondary', label: 'Q Road2' },
      { key: 'erase',          label: 'E Erase' },
    ];
    row.innerHTML = '';
    for (const t of tools) {
      const btn = document.createElement('button');
      btn.className = 'se-btn' + (this.activeTool === t.key ? ' active' : '');
      btn.dataset.tool = t.key;
      btn.textContent = t.label;
      btn.addEventListener('click', () => this.setTool(t.key));
      row.appendChild(btn);
    }
  }

  private refreshCatalogueList(filter: string): void {
    const list = document.getElementById('se-cat-list');
    if (!list) return;
    const term = filter.toLowerCase();
    const entries = getAllBuildings().filter(e =>
      !term || e.name.toLowerCase().includes(term) || e.category.toLowerCase().includes(term),
    );
    list.innerHTML = entries.map(e => {
      const hex = (CAT_COLORS[e.category] ?? 0x888888).toString(16).padStart(6, '0');
      const size = e.baseSizeRange[0] === e.baseSizeRange[1]
        ? `${e.baseSizeRange[0]}×${e.baseSizeRange[0]}`
        : `${e.baseSizeRange[0]}–${e.baseSizeRange[1]}`;
      const sel = this.pendingBuildingId === e.id ? ' selected' : '';
      return `<div class="se-cat-item${sel}" data-id="${e.id}" title="${e.loreHook}">
        <span class="se-cat-dot" style="background:#${hex}"></span>
        <span>${e.name}</span>
        <span style="color:#556;margin-left:auto">${size}</span>
      </div>`;
    }).join('');
    list.querySelectorAll('.se-cat-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id!;
        this.pendingBuildingId = id;
        this.refreshCatalogueList((document.getElementById('se-cat-filter') as HTMLInputElement).value);
        this.renderCursor();
      });
    });
  }

  private wirePanel(): void {
    // Catalogue filter
    document.getElementById('se-cat-filter')!.addEventListener('input', (e) => {
      this.refreshCatalogueList((e.target as HTMLInputElement).value);
    });

    // Selected building actions
    document.getElementById('se-rotate-btn')!.addEventListener('click', () => this.rotateEntrance());
    document.getElementById('se-delete-btn')!.addEventListener('click', () => this.deleteSelected());

    // Plaza
    document.getElementById('se-apply-plaza')!.addEventListener('click', () => {
      const size = parseInt((document.getElementById('se-plaza-size') as HTMLInputElement).value, 10);
      const tx   = parseInt((document.getElementById('se-plaza-tx')   as HTMLInputElement).value, 10);
      const ty   = parseInt((document.getElementById('se-plaza-ty')   as HTMLInputElement).value, 10);
      if (!isNaN(size) && !isNaN(tx) && !isNaN(ty)) {
        this.state.plaza = { tx, ty, size: Math.max(0, Math.min(10, size)) };
        this.pushUndo();
        this.rebuildAll();
      }
    });

    // Forge
    document.getElementById('se-forge-tier')!.addEventListener('change', (e) => {
      this.forgeTier = Math.max(1, Math.min(5, parseInt((e.target as HTMLInputElement).value, 10) || 3)) as SettlementTier;
    });
    document.getElementById('se-forge-culture')!.addEventListener('change', (e) => {
      this.forgeCultureIdx = parseInt((e.target as HTMLSelectElement).value, 10);
    });
    document.getElementById('se-forge-seed')!.addEventListener('change', (e) => {
      this.forgeSeed = parseInt((e.target as HTMLInputElement).value, 10) || 42;
    });
    document.getElementById('se-forge-load')!.addEventListener('click', () => this.loadFromForge());

    // Save / Load
    document.getElementById('se-save-btn')!.addEventListener('click', () => this.saveJSON());
    document.getElementById('se-load-btn')!.addEventListener('click', () => {
      document.getElementById('se-file-input')!.click();
    });
    document.getElementById('se-file-input')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => this.loadJSONFromString(ev.target?.result as string);
      reader.readAsText(file);
    });

    // Back button
    document.getElementById('se-back-btn')!.addEventListener('click', () => {
      this.scene.start('MainMenuScene');
    });
  }

  /** Sync the DOM panel UI state after any state change. */
  private updatePanel(): void {
    // Highlight active tool button
    document.querySelectorAll('#se-tool-row .se-btn').forEach(el => {
      const btn = el as HTMLElement;
      btn.classList.toggle('active', btn.dataset.tool === this.activeTool);
    });

    // Show/hide add section
    const addSection = document.getElementById('se-add-section');
    if (addSection) addSection.style.display = this.activeTool === 'add' ? '' : 'none';

    // Selected building info
    const info = document.getElementById('se-selected-info');
    const btns = document.getElementById('se-selected-btns');
    if (this.selectedBuildingIdx !== null && this.activeTool === 'select') {
      const b = this.state.buildings[this.selectedBuildingIdx];
      if (info) info.textContent = `${b.name} (${b.category})\n(${b.tx}, ${b.ty}) entrance: ${b.entranceSide ?? 'none'}`;
      if (btns) btns.style.display = 'flex';
    } else {
      if (info) info.textContent = 'Nothing selected';
      if (btns) btns.style.display = 'none';
    }

    // Plaza fields
    const { plaza } = this.state;
    const psz = document.getElementById('se-plaza-size') as HTMLInputElement | null;
    const ptx = document.getElementById('se-plaza-tx')   as HTMLInputElement | null;
    const pty = document.getElementById('se-plaza-ty')   as HTMLInputElement | null;
    if (psz) psz.value = String(plaza.size);
    if (ptx) ptx.value = String(plaza.tx);
    if (pty) pty.value = String(plaza.ty);
  }
}
