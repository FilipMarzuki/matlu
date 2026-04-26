/**
 * SettlementForgeScene — isometric preview tool for the settlement
 * generation system. Same rendering approach as WorldForgeScene.
 *
 * Access: navigate to /sf or /settlementforge in the URL.
 *
 * ## What it does
 * Runs the SettlementGenerator with configurable inputs and renders the
 * result on an isometric tile grid. Buildings are coloured iso boxes sized
 * proportionally to their world-pixel dimensions. Zone rings, streets, and
 * plaza are drawn on the ground plane.
 *
 * ## Controls
 *   LEFT / RIGHT or A / D   Cycle culture
 *   UP / DOWN or W / S      Cycle purpose
 *   1-5                     Set tier directly
 *   G                       Cycle geography
 *   R                       Re-roll seed
 *   Scroll wheel / +/-      Zoom
 *   Right-click drag        Pan camera
 *
 * ## URL params
 *   ?tier=3&purpose=mining&culture=dvergr-hold&seed=12345&geo=mountain
 */

import * as Phaser from 'phaser';
import type {
  SettlementSite, SettlementTier, SettlementPurpose, Geography,
} from '../world/SettlementSpec';
import {
  generateSettlement,
  getAllCultures,
  type ResolvedBuilding,
} from '../world/SettlementGenerator';
import { placeBuildings } from '../world/SettlementPlacement';
import type { SettlementSpec } from '../world/SettlementSpec';
import { insertFeedback, GAME_VERSION } from '../lib/feedback';

// ── Constants ────────────────────────────────────────────────────────────────

const GEOGRAPHIES: Geography[] = [
  'coastal', 'forest', 'mountain', 'plains', 'tundra', 'desert', 'wetland', 'volcanic',
];

const PURPOSES: SettlementPurpose[] = [
  'fishing', 'logging', 'mining', 'trading-hub', 'frontier',
  'refuge', 'shrine', 'farming', 'herding', 'port', 'garrison',
];

const TIER_NAMES = ['', 'Outpost', 'Hamlet', 'Village', 'Town', 'Stronghold'];

/** Colours for building categories. */
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

/** Zone ring radial fractions (of settlement radius in tiles). */
const ZONE_FRAC: Record<string, { min: number; max: number }> = {
  inner:  { min: 0.10, max: 0.38 },
  middle: { min: 0.38, max: 0.65 },
  outer:  { min: 0.65, max: 0.90 },
};

/** Height multiplier per heightHint — drives the box height in iso space. */
const HEIGHT_MULT: Record<string, number> = {
  low: 0.3, standard: 0.6, tall: 0.9, tower: 1.4,
};

// ── PRNG ─────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Scene ────────────────────────────────────────────────────────────────────

export class SettlementForgeScene extends Phaser.Scene {

  // ── Iso grid constants ─────────────────────────────────────────────────────
  // Settlement radius in world-px maps to a tile grid. We use a fixed grid
  // and scale buildings into it. TILE = 32 matches WORLD_TILE_SIZE so one
  // tile ≈ one character standing spot.
  private readonly TILE = 32;

  // Zoom and iso helpers — mirrors WorldForgeScene pattern.
  private zoomFactor = 1.0;
  private get ISO_W() { return 24 * this.zoomFactor; }
  private get ISO_H() { return 12 * this.zoomFactor; }
  private originX = 0;
  private originY = 0;
  private gridSize = 20;   // recalculated per settlement radius

  // ── Current generation parameters ──────────────────────────────────────────
  private currentTier: SettlementTier = 3;
  private currentGeoIdx = 1;
  private currentPurposeIdx = 1;
  private currentCultureIdx = 0;
  private currentSeed = 42;

  // ── Generated state ────────────────────────────────────────────────────────
  private spec: SettlementSpec | null = null;
  private buildings: ResolvedBuilding[] = [];

  // ── Display objects (rebuilt on regenerate) ─────────────────────────────────
  private groundGfx: Phaser.GameObjects.Graphics | null = null;
  private buildingObjects: Phaser.GameObjects.GameObject[] = [];
  private labelObjects: Phaser.GameObjects.Text[] = [];

  // ── HUD (fixed to camera) ─────────────────────────────────────────────────
  private hudText: Phaser.GameObjects.Text | null = null;
  private cultureText: Phaser.GameObjects.Text | null = null;
  private buildingSummaryText: Phaser.GameObjects.Text | null = null;
  private legendGfx: Phaser.GameObjects.Graphics | null = null;
  private legendLabels: Phaser.GameObjects.Text[] = [];

  // ── Feedback overlay ───────────────────────────────────────────────────────
  private feedbackOverlay: HTMLDivElement | null = null;
  private feedbackBtn: Phaser.GameObjects.Text | null = null;

  // ── Control panel (DOM) ───────────────────────────────────────────────────
  private controlPanel: HTMLDivElement | null = null;

  constructor() { super({ key: 'SettlementForgeScene' }); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  create(): void {
    this.cameras.main.setBackgroundColor('#1a1a2e');

    // Parse URL params
    const params = new URLSearchParams(window.location.search);
    const t = parseInt(params.get('tier') ?? '', 10);
    if (t >= 1 && t <= 5) this.currentTier = t as SettlementTier;

    const p = params.get('purpose');
    if (p) { const i = PURPOSES.indexOf(p as SettlementPurpose); if (i >= 0) this.currentPurposeIdx = i; }

    const c = params.get('culture');
    if (c) { const i = getAllCultures().findIndex(x => x.id === c); if (i >= 0) this.currentCultureIdx = i; }

    const s = parseInt(params.get('seed') ?? '', 10);
    if (!isNaN(s)) this.currentSeed = s;

    const g = params.get('geo');
    if (g) { const i = GEOGRAPHIES.indexOf(g as Geography); if (i >= 0) this.currentGeoIdx = i; }

    // ── Keyboard ─────────────────────────────────────────────────────────────
    const kb = this.input.keyboard!;
    kb.on('keydown-A',     () => this.cycleCulture(-1));
    kb.on('keydown-D',     () => this.cycleCulture(+1));
    kb.on('keydown-LEFT',  () => this.cycleCulture(-1));
    kb.on('keydown-RIGHT', () => this.cycleCulture(+1));
    kb.on('keydown-W',     () => this.cyclePurpose(-1));
    kb.on('keydown-S',     () => this.cyclePurpose(+1));
    kb.on('keydown-UP',    () => this.cyclePurpose(-1));
    kb.on('keydown-DOWN',  () => this.cyclePurpose(+1));
    kb.on('keydown-G',     () => this.cycleGeo());
    kb.on('keydown-R',     () => this.reroll());
    kb.on('keydown-ONE',   () => this.setTier(1));
    kb.on('keydown-TWO',   () => this.setTier(2));
    kb.on('keydown-THREE', () => this.setTier(3));
    kb.on('keydown-FOUR',  () => this.setTier(4));
    kb.on('keydown-FIVE',  () => this.setTier(5));
    kb.on('keydown-F',     () => this.toggleFeedback());

    // ── Zoom ─────────────────────────────────────────────────────────────────
    const applyZoom = (factor: number) => {
      this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor * factor, 0.3, 5.0);
      this.rebuild();
    };
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, dy: number) =>
      applyZoom(dy > 0 ? 0.88 : 1.0 / 0.88));
    kb.on('keydown-PLUS',         () => applyZoom(1.15));
    kb.on('keydown-NUMPAD_ADD',   () => applyZoom(1.15));
    kb.on('keydown-MINUS',        () => applyZoom(1 / 1.15));
    kb.on('keydown-NUMPAD_MINUS', () => applyZoom(1 / 1.15));

    // ── DOM control panel ─────────────────────────────────────────────────────
    this.buildControlPanel();

    // ── Pan ──────────────────────────────────────────────────────────────────
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!ptr.isDown) return;
      if (ptr.button === 2 || ptr.button === 1) {
        const cam = this.cameras.main;
        cam.scrollX -= (ptr.x - ptr.prevPosition.x) / cam.zoom;
        cam.scrollY -= (ptr.y - ptr.prevPosition.y) / cam.zoom;
      }
    });
    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.regenerate();
  }

  // ── Favorites (localStorage) ────────────────────────────────────────────────

  private static readonly FAV_KEY = 'sf-favorites';

  private loadFavorites(): Array<{ name: string; tier: number; geoIdx: number; purposeIdx: number; cultureIdx: number; seed: number }> {
    try {
      return JSON.parse(localStorage.getItem(SettlementForgeScene.FAV_KEY) ?? '[]');
    } catch { return []; }
  }

  private saveFavorites(favs: Array<{ name: string; tier: number; geoIdx: number; purposeIdx: number; cultureIdx: number; seed: number }>): void {
    localStorage.setItem(SettlementForgeScene.FAV_KEY, JSON.stringify(favs));
  }

  private addFavorite(name: string): void {
    const favs = this.loadFavorites();
    favs.push({
      name,
      tier: this.currentTier,
      geoIdx: this.currentGeoIdx,
      purposeIdx: this.currentPurposeIdx,
      cultureIdx: this.currentCultureIdx,
      seed: this.currentSeed,
    });
    this.saveFavorites(favs);
    this.refreshFavoritesList();
  }

  private loadFavorite(idx: number): void {
    const favs = this.loadFavorites();
    const f = favs[idx];
    if (!f) return;
    this.currentTier = f.tier as SettlementTier;
    this.currentGeoIdx = f.geoIdx;
    this.currentPurposeIdx = f.purposeIdx;
    this.currentCultureIdx = f.cultureIdx;
    this.currentSeed = f.seed;
    this.syncControlPanel();
    this.regenerate();
  }

  private deleteFavorite(idx: number): void {
    const favs = this.loadFavorites();
    favs.splice(idx, 1);
    this.saveFavorites(favs);
    this.refreshFavoritesList();
  }

  // ── DOM Control Panel ─────────────────────────────────────────────────────

  private buildControlPanel(): void {
    // Remove previous if scene restarts
    document.getElementById('sf-control-panel')?.remove();

    const cultures = getAllCultures();
    const panel = document.createElement('div');
    panel.id = 'sf-control-panel';
    panel.innerHTML = `
      <style>
        #sf-control-panel {
          position: fixed; top: 0; left: 0; bottom: 0; width: 240px;
          background: #12121eee; border-right: 1px solid #334;
          font-family: monospace; font-size: 12px; color: #ccd;
          padding: 12px; overflow-y: auto; z-index: 500;
          display: flex; flex-direction: column; gap: 8px;
        }
        #sf-control-panel h3 { margin: 0; color: #aaccff; font-size: 14px; }
        #sf-control-panel label { color: #889; font-size: 11px; display: block; margin-bottom: 2px; }
        #sf-control-panel select, #sf-control-panel input {
          width: 100%; background: #1a1a2e; color: #dde; border: 1px solid #446;
          border-radius: 4px; padding: 4px 6px; font-family: monospace; font-size: 12px;
        }
        #sf-control-panel select:focus, #sf-control-panel input:focus {
          outline: none; border-color: #aaccff;
        }
        #sf-control-panel .sf-btn {
          background: #2a2a4e; color: #aab; border: 1px solid #446;
          border-radius: 4px; padding: 5px 10px; cursor: pointer;
          font-family: monospace; font-size: 11px; width: 100%;
        }
        #sf-control-panel .sf-btn:hover { background: #3a3a5e; color: #fff; }
        #sf-control-panel .sf-btn-primary { background: #446688; color: #fff; }
        #sf-control-panel .sf-btn-primary:hover { background: #5577aa; }
        #sf-control-panel .sf-divider { border-top: 1px solid #334; margin: 4px 0; }
        #sf-control-panel .sf-fav-item {
          display: flex; align-items: center; gap: 4px; padding: 3px 0;
        }
        #sf-control-panel .sf-fav-name {
          flex: 1; color: #aaccff; cursor: pointer; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        #sf-control-panel .sf-fav-name:hover { text-decoration: underline; }
        #sf-control-panel .sf-fav-del {
          color: #664; cursor: pointer; font-size: 14px; line-height: 1;
        }
        #sf-control-panel .sf-fav-del:hover { color: #c66; }
        #sf-fav-list { max-height: 180px; overflow-y: auto; }
      </style>
      <h3>Settlement Forge</h3>

      <div>
        <label>Culture</label>
        <select id="sf-culture">
          ${cultures.map((c, i) => `<option value="${i}"${i === this.currentCultureIdx ? ' selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </div>

      <div>
        <label>Tier</label>
        <select id="sf-tier">
          ${[1,2,3,4,5].map(t => `<option value="${t}"${t === this.currentTier ? ' selected' : ''}>${t} — ${TIER_NAMES[t]}</option>`).join('')}
        </select>
      </div>

      <div>
        <label>Purpose</label>
        <select id="sf-purpose">
          ${PURPOSES.map((p, i) => `<option value="${i}"${i === this.currentPurposeIdx ? ' selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>

      <div>
        <label>Geography</label>
        <select id="sf-geo">
          ${GEOGRAPHIES.map((g, i) => `<option value="${i}"${i === this.currentGeoIdx ? ' selected' : ''}>${g}</option>`).join('')}
        </select>
      </div>

      <div>
        <label>Seed</label>
        <input type="number" id="sf-seed" value="${this.currentSeed}" />
      </div>

      <button class="sf-btn" id="sf-reroll">Re-roll seed (R)</button>

      <div class="sf-divider"></div>

      <h3>Favorites</h3>
      <div style="display:flex;gap:4px;">
        <input type="text" id="sf-fav-name" placeholder="Name this preset" style="flex:1" />
        <button class="sf-btn sf-btn-primary" id="sf-fav-save" style="width:auto;padding:4px 8px;">Save</button>
      </div>
      <div id="sf-fav-list"></div>
    `;

    document.body.appendChild(panel);
    this.controlPanel = panel;

    // Wire up change handlers
    const sel = (id: string) => document.getElementById(id) as HTMLSelectElement;
    const inp = (id: string) => document.getElementById(id) as HTMLInputElement;

    sel('sf-culture').addEventListener('change', (e) => {
      this.currentCultureIdx = parseInt((e.target as HTMLSelectElement).value, 10);
      this.regenerate();
    });
    sel('sf-tier').addEventListener('change', (e) => {
      this.currentTier = parseInt((e.target as HTMLSelectElement).value, 10) as SettlementTier;
      this.regenerate();
    });
    sel('sf-purpose').addEventListener('change', (e) => {
      this.currentPurposeIdx = parseInt((e.target as HTMLSelectElement).value, 10);
      this.regenerate();
    });
    sel('sf-geo').addEventListener('change', (e) => {
      this.currentGeoIdx = parseInt((e.target as HTMLSelectElement).value, 10);
      this.regenerate();
    });
    inp('sf-seed').addEventListener('change', (e) => {
      this.currentSeed = parseInt((e.target as HTMLInputElement).value, 10) || 42;
      this.regenerate();
    });
    document.getElementById('sf-reroll')!.addEventListener('click', () => {
      this.reroll();
      inp('sf-seed').value = String(this.currentSeed);
    });

    // Favorites
    document.getElementById('sf-fav-save')!.addEventListener('click', () => {
      const nameInput = inp('sf-fav-name');
      const name = nameInput.value.trim();
      if (!name) return;
      this.addFavorite(name);
      nameInput.value = '';
    });

    this.refreshFavoritesList();
  }

  /** Keep dropdowns in sync after loading a favorite or keyboard cycling. */
  private syncControlPanel(): void {
    const sel = (id: string) => document.getElementById(id) as HTMLSelectElement | null;
    const inp = (id: string) => document.getElementById(id) as HTMLInputElement | null;
    const s1 = sel('sf-culture'); if (s1) s1.value = String(this.currentCultureIdx);
    const s2 = sel('sf-tier');    if (s2) s2.value = String(this.currentTier);
    const s3 = sel('sf-purpose'); if (s3) s3.value = String(this.currentPurposeIdx);
    const s4 = sel('sf-geo');     if (s4) s4.value = String(this.currentGeoIdx);
    const i1 = inp('sf-seed');    if (i1) i1.value = String(this.currentSeed);
  }

  private refreshFavoritesList(): void {
    const list = document.getElementById('sf-fav-list');
    if (!list) return;
    const favs = this.loadFavorites();
    if (favs.length === 0) {
      list.innerHTML = '<div style="color:#556;font-size:11px;padding:4px 0;">No favorites saved yet.</div>';
      return;
    }
    list.innerHTML = favs.map((f, i) => `
      <div class="sf-fav-item">
        <span class="sf-fav-name" data-idx="${i}" title="${TIER_NAMES[f.tier]} / ${PURPOSES[f.purposeIdx]} / ${GEOGRAPHIES[f.geoIdx]}">${f.name}</span>
        <span class="sf-fav-del" data-idx="${i}" title="Delete">×</span>
      </div>
    `).join('');

    // Click handlers
    list.querySelectorAll('.sf-fav-name').forEach(el => {
      el.addEventListener('click', () => this.loadFavorite(parseInt((el as HTMLElement).dataset.idx!, 10)));
    });
    list.querySelectorAll('.sf-fav-del').forEach(el => {
      el.addEventListener('click', () => this.deleteFavorite(parseInt((el as HTMLElement).dataset.idx!, 10)));
    });
  }

  /** Clean up DOM elements when scene shuts down. */
  shutdown(): void {
    this.controlPanel?.remove();
    this.controlPanel = null;
    this.feedbackOverlay?.remove();
    this.feedbackOverlay = null;
  }

  // ── Iso coordinate helpers ─────────────────────────────────────────────────

  /** Screen position of the north apex of tile (tx, ty). */
  private isoPos(tx: number, ty: number): { x: number; y: number } {
    return {
      x: this.originX + (tx - ty) * (this.ISO_W / 2),
      y: this.originY + (tx + ty) * (this.ISO_H / 2),
    };
  }

  /** Draw an iso diamond (ground tile) at tile coords. */
  private drawIsoDiamond(
    gfx: Phaser.GameObjects.Graphics,
    tx: number, ty: number,
    fillColor: number, fillAlpha: number,
    strokeColor?: number, strokeAlpha?: number,
  ): void {
    const { x, y } = this.isoPos(tx, ty);
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;
    // Fill diamond: N → E → S → W
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

  /**
   * Draw an isometric box (building) at tile position.
   * The box has a top diamond face and two visible side faces.
   */
  private drawIsoBox(
    gfx: Phaser.GameObjects.Graphics,
    tx: number, ty: number,
    widthTiles: number, depthTiles: number, heightPx: number,
    color: number, alpha: number,
  ): void {
    const { x, y } = this.isoPos(tx, ty);
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;

    // Scale by building footprint
    const sw = hw * widthTiles;
    const sh = hh * depthTiles;

    // Corners of the top face (elevated by heightPx)
    const topN = { x: x,      y: y - heightPx };
    const topE = { x: x + sw, y: y + sh - heightPx };
    const topS = { x: x,      y: y + sh * 2 - heightPx };
    const topW = { x: x - sw, y: y + sh - heightPx };

    // Bottom corners (ground level)
    const botE = { x: x + sw, y: y + sh };
    const botS = { x: x,      y: y + sh * 2 };
    const botW = { x: x - sw, y: y + sh };

    // Helper to fill a quad
    const fillQuad = (c: number, a: number, p1: {x:number;y:number}, p2: {x:number;y:number}, p3: {x:number;y:number}, p4: {x:number;y:number}) => {
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
    fillQuad(this.darken(color, 0.7), alpha, topE, topS, botS, botE);

    // Left face (south-facing)
    fillQuad(this.darken(color, 0.5), alpha, topS, topW, botW, botS);

    // Top face
    fillQuad(color, alpha, topN, topE, topS, topW);

    // Outline
    gfx.lineStyle(1, 0x000000, 0.4);
    gfx.beginPath();
    gfx.moveTo(topN.x, topN.y);
    gfx.lineTo(topE.x, topE.y);
    gfx.lineTo(topS.x, topS.y);
    gfx.lineTo(topW.x, topW.y);
    gfx.closePath();
    gfx.strokePath();
    gfx.lineBetween(topE.x, topE.y, botE.x, botE.y);
    gfx.lineBetween(topS.x, topS.y, botS.x, botS.y);
    gfx.lineBetween(topW.x, topW.y, botW.x, botW.y);
  }

  /** Darken a colour by a factor. */
  private darken(color: number, factor: number): number {
    const r = Math.floor(((color >> 16) & 0xff) * factor);
    const g = Math.floor(((color >> 8) & 0xff) * factor);
    const b = Math.floor((color & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
  }

  // ── Parameter cycling ──────────────────────────────────────────────────────

  private cycleCulture(dir: number): void {
    const n = getAllCultures().length;
    this.currentCultureIdx = (this.currentCultureIdx + dir + n) % n;
    this.syncControlPanel();
    this.regenerate();
  }

  private cyclePurpose(dir: number): void {
    this.currentPurposeIdx = (this.currentPurposeIdx + dir + PURPOSES.length) % PURPOSES.length;
    this.syncControlPanel();
    this.regenerate();
  }

  private cycleGeo(): void {
    this.currentGeoIdx = (this.currentGeoIdx + 1) % GEOGRAPHIES.length;
    this.syncControlPanel();
    this.regenerate();
  }

  private setTier(t: SettlementTier): void {
    this.currentTier = t;
    this.syncControlPanel();
    this.regenerate();
  }

  private reroll(): void {
    this.currentSeed = Math.floor(Math.random() * 0xffffffff);
    this.syncControlPanel();
    this.regenerate();
  }

  // ── Generation ─────────────────────────────────────────────────────────────

  private regenerate(): void {
    const cultures = getAllCultures();
    const culture = cultures[this.currentCultureIdx];
    const purpose = PURPOSES[this.currentPurposeIdx];
    const geography = GEOGRAPHIES[this.currentGeoIdx];

    const site: SettlementSite = {
      x: 400, y: 400,
      geography,
      features: this.featuresForPurpose(purpose),
      adjacentResources: this.resourcesForPurpose(purpose),
      nearCorruption: purpose === 'garrison' || purpose === 'frontier',
      tradeRouteCount: purpose === 'trading-hub' || purpose === 'port' ? 3 : 1,
      nearbySettlements: Math.min(this.currentTier, 3),
      cultureId: culture.id,
    };

    // Inflate site value so generator tier lands near our target.
    const rng = mulberry32(this.currentSeed);
    const { spec, buildings } = generateSettlement(
      { ...site, tradeRouteCount: this.currentTier * 2, nearbySettlements: this.currentTier },
      'Forge Preview',
      rng,
    );
    (spec as { tier: SettlementTier }).tier = this.currentTier;

    this.spec = spec;
    this.buildings = buildings;

    // Grid size: settlement radius in tiles, padded
    this.gridSize = Math.ceil(spec.radius / this.TILE) * 2 + 4;

    this.rebuild();
  }

  private featuresForPurpose(p: SettlementPurpose): SettlementSite['features'] {
    switch (p) {
      case 'garrison':    return ['corruption-boundary'];
      case 'frontier':    return ['wilderness-edge'];
      case 'shrine':      return ['sacred-site'];
      case 'port':        return ['harbour'];
      case 'trading-hub': return ['crossroads', 'trade-route'];
      case 'fishing':     return ['harbour'];
      case 'mining':      return ['resource-deposit'];
      case 'refuge':      return ['earth-ruin'];
      default:            return [];
    }
  }

  private resourcesForPurpose(p: SettlementPurpose): SettlementSite['adjacentResources'] {
    switch (p) {
      case 'fishing':  return ['fish'];
      case 'mining':   return ['ore', 'stone'];
      case 'logging':  return ['timber'];
      case 'farming':  return ['fertile-soil'];
      case 'herding':  return ['game'];
      default:         return [];
    }
  }

  // ── Full rebuild ───────────────────────────────────────────────────────────

  private rebuild(): void {
    // Destroy previous
    this.groundGfx?.destroy();
    for (const obj of this.buildingObjects) obj.destroy();
    this.buildingObjects = [];
    for (const l of this.labelObjects) l.destroy();
    this.labelObjects = [];

    if (!this.spec) return;

    // Compute origin so diamond is centred on screen
    const W = this.scale.width;
    const H = this.scale.height;
    const diamondH = this.gridSize * this.ISO_H + this.ISO_H;
    this.originX = W / 2;
    this.originY = Math.round((H - diamondH) / 2 + this.ISO_H / 2);

    this.renderGround();
    this.renderBuildings();
    this.renderHUD();
  }

  // ── Ground layer ───────────────────────────────────────────────────────────

  private renderGround(): void {
    const gfx = this.add.graphics().setDepth(0);
    this.groundGfx = gfx;

    const G = this.gridSize;
    const mid = Math.floor(G / 2);
    const radiusTiles = (this.spec?.radius ?? 100) / this.TILE;

    // Ground biome colour (muted)
    const geoColors: Record<string, number> = {
      coastal: 0x3a5a6a, forest: 0x2a4a2a, mountain: 0x4a4a4a,
      plains: 0x5a6a3a, tundra: 0x5a5a6a, desert: 0x6a5a3a,
      wetland: 0x3a4a4a, volcanic: 0x4a3a3a,
    };
    const groundColor = geoColors[this.spec?.geography ?? 'forest'] ?? 0x2a4a2a;

    // Draw ground tiles — painter's order (back to front)
    for (let sum = 0; sum < G * 2 - 1; sum++) {
      const txMin = Math.max(0, sum - (G - 1));
      const txMax = Math.min(sum, G - 1);
      for (let tx = txMin; tx <= txMax; tx++) {
        const ty = sum - tx;

        // Distance from centre in tile space
        const dx = tx - mid;
        const dy = ty - mid;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > radiusTiles + 2) continue; // skip tiles outside settlement + margin

        // Tile colour: darker outside settlement radius
        const inside = dist <= radiusTiles;
        const alpha = inside ? 0.5 : 0.2;

        this.drawIsoDiamond(gfx, tx, ty, groundColor, alpha, 0x000000, 0.15);
      }
    }

    // ── Zone ring outlines ─────────────────────────────────────────────────
    // Draw iso-space ring approximations using diamond outlines
    const ringColors: Record<string, number> = {
      inner: 0x6688aa, middle: 0x66aa66, outer: 0xaa6666,
    };
    for (const [zone, frac] of Object.entries(ZONE_FRAC)) {
      const r = radiusTiles * (frac.min + frac.max) / 2;
      const color = ringColors[zone] ?? 0x888888;
      // Draw an approximate ring using iso diamonds at the ring radius
      const steps = 32;
      gfx.lineStyle(1, color, 0.4);
      gfx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const rtx = mid + Math.cos(angle) * r;
        const rty = mid + Math.sin(angle) * r;
        const { x, y } = this.isoPos(rtx, rty);
        const sy = y + this.ISO_H / 2; // centre of tile
        if (i === 0) gfx.moveTo(x, sy);
        else gfx.lineTo(x, sy);
      }
      gfx.strokePath();

      // Zone label
      const labelPos = this.isoPos(mid + r, mid);
      const label = this.add.text(labelPos.x + 4, labelPos.y + this.ISO_H / 2, zone, {
        fontSize: '9px', color: `#${color.toString(16).padStart(6, '0')}`,
        fontFamily: 'monospace',
      }).setOrigin(0, 0.5).setDepth(1);
      this.labelObjects.push(label);
    }

    // ── Plaza (iso diamond cluster) ────────────────────────────────────────
    if (this.currentTier >= 2) {
      const plazaTiles = [0, 0, 2, 3, 4, 5][this.currentTier];
      const halfPlaza = Math.floor(plazaTiles / 2);
      for (let px = -halfPlaza; px <= halfPlaza; px++) {
        for (let py = -halfPlaza; py <= halfPlaza; py++) {
          this.drawIsoDiamond(gfx, mid + px, mid + py, 0xd4b483, 0.4);
        }
      }
    }
  }

  // ── Building placement + rendering ─────────────────────────────────────────

  private renderBuildings(): void {
    if (!this.spec) return;

    const cultures = getAllCultures();
    const culture = cultures[this.currentCultureIdx];

    // Use the extracted pure placement algorithm (now returns roads + buildings)
    const { buildings: placements, roads } = placeBuildings({
      buildings: this.buildings,
      radiusTiles: this.spec.radius / this.TILE,
      gridSize: this.gridSize,
      tileSize: this.TILE,
      seed: this.currentSeed,
      zoneFracs: ZONE_FRAC,
      streetPattern: (culture.streetPattern ?? 'none') as 'grid' | 'radial' | 'organic' | 'linear' | 'none' | 'branching',
    });

    // Debug: log placement stats
    const mainRoadCount = roads.filter(r => r.main).length;
    const connectorCount = roads.filter(r => !r.main).length;
    console.log(`[SF] buildings: ${placements.length}, roads: ${roads.length} (main: ${mainRoadCount}, connectors: ${connectorCount}), culture: ${culture.id}, pattern: ${culture.streetPattern}, seed: ${this.currentSeed}, gridSize: ${this.gridSize}, radiusTiles: ${(this.spec.radius / this.TILE).toFixed(1)}`);
    // Log first 5 buildings + their nearest connector
    for (let i = 0; i < Math.min(5, placements.length); i++) {
      const b = placements[i];
      const nearbyRoads = roads.filter(r => Math.abs(r.tx - b.tx) <= 4 && Math.abs(r.ty - b.ty) <= 4);
      console.log(`  [B${i+1}] ${b.building.id} @(${b.tx},${b.ty}) w=${b.widthT} | ${nearbyRoads.length} road tiles within 4`);
    }

    // Build a set of tiles occupied by building base footprints
    const baseTiles = new Set<string>();
    for (const p of placements) {
      const bh = Math.ceil(p.widthT / 2);
      for (let dx = -bh; dx <= bh; dx++) {
        for (let dy = -bh; dy <= bh; dy++) {
          baseTiles.add(`${p.tx + dx},${p.ty + dy}`);
        }
      }
    }

    // Render roads with tile numbers for debugging
    if (roads.length > 0) {
      const roadGfx = this.add.graphics().setDepth(0.5);
      this.buildingObjects.push(roadGfx);
      for (let ri = 0; ri < roads.length; ri++) {
        const road = roads[ri];
        const underBuilding = baseTiles.has(`${road.tx},${road.ty}`);
        const roadColor = road.main ? 0xd4b87a : 0xc9a050;
        const alpha = underBuilding ? 0.15 : (road.main ? 0.7 : 0.55);
        this.drawIsoDiamond(roadGfx, road.tx, road.ty, roadColor, alpha);

        // Number label on every road tile (high depth so always visible)
        const { x, y } = this.isoPos(road.tx, road.ty);
        const roadLabel = this.add.text(x, y + this.ISO_H / 2, `${ri}`, {
          fontSize: '6px',
          color: road.main ? '#ffee88' : '#ffaa44',
          fontFamily: 'monospace',
          stroke: '#000000',
          strokeThickness: 2,
        }).setOrigin(0.5, 0.5).setDepth(100);
        this.labelObjects.push(roadLabel);
      }
    }

    // Tag each placement with its original placement order before sorting
    const tagged = placements.map((p, idx) => ({ ...p, placementOrder: idx + 1 }));

    // Sort by iso depth (tx + ty) so back buildings render first
    tagged.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));

    // Draw
    for (const p of tagged) {
      const color = p.fallback
        ? this.darken(CAT_COLORS[p.building.category] ?? 0x888888, 0.6)
        : CAT_COLORS[p.building.category] ?? 0x888888;
      const hMult = HEIGHT_MULT[p.building.heightHint] ?? 0.6;
      const heightPx = Math.round(p.building.w * hMult * this.zoomFactor * 0.5);

      const gfx = this.add.graphics().setDepth(2 + (p.tx + p.ty) * 0.01);
      this.buildingObjects.push(gfx);

      this.drawIsoBox(gfx, p.tx, p.ty, p.widthT, p.depthT, heightPx, color, 0.85);

      // Number = placement order (not render order)
      const { x, y } = this.isoPos(p.tx, p.ty);
      const numY = y + this.ISO_H / 2 - heightPx * 0.5;
      const numLabel = this.add.text(x, numY, `${p.placementOrder}`, {
        fontSize: '11px', color: '#ffffff', fontFamily: 'monospace',
        stroke: '#000000', strokeThickness: 3, fontStyle: 'bold',
      }).setOrigin(0.5, 0.5).setDepth(10 + (p.tx + p.ty) * 0.01 + 0.001);
      this.labelObjects.push(numLabel);

      // Name label above
      const labelY = y + this.ISO_H / 2 - heightPx - 6;
      const label = this.add.text(x, labelY, p.building.id, {
        fontSize: '7px', color: '#cccccc', fontFamily: 'monospace',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 1).setDepth(10 + (p.tx + p.ty) * 0.01);
      this.labelObjects.push(label);
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  private renderHUD(): void {
    this.hudText?.destroy();
    this.cultureText?.destroy();
    this.buildingSummaryText?.destroy();
    this.legendGfx?.destroy();
    for (const l of this.legendLabels) l.destroy();
    this.legendLabels = [];

    if (!this.spec) return;

    const cultures = getAllCultures();
    const culture = cultures[this.currentCultureIdx];

    // ── Top-left: generated stats (compact — controls are in the DOM panel) ─
    const lines = [
      `Radius:    ${this.spec.radius}px  (${Math.ceil(this.spec.radius / this.TILE)} tiles)`,
      `Secondary: ${this.spec.secondary.length ? this.spec.secondary.join(', ') : 'none'}`,
      `Anomalies: ${this.spec.anomalies.length ? this.spec.anomalies.map(a => a.type).join(', ') : 'none'}`,
      `Buildings: ${this.buildings.length}`,
    ];

    this.hudText = this.add.text(250, 10, lines.join('\n'), {
      fontSize: '11px', color: '#ccccdd', fontFamily: 'monospace',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 6 }, lineSpacing: 2,
    }).setDepth(100).setScrollFactor(0);

    // ── Top-right: culture modifiers ─────────────────────────────────────
    const cLines = [
      `-- ${culture.name} --`,
      `spacing:     ${culture.spacing}`,
      `organicness: ${culture.organicness}`,
      `hierarchy:   ${culture.hierarchyScale}`,
      `perimeter:   ${culture.perimeterAwareness}`,
      `facing:      ${culture.facingBias}`,
      `verticality: ${culture.verticality}`,
      `shapes:      ${culture.preferredShapes.join(', ')}`,
      `roof:        ${culture.roofStyle}`,
      `streets:     ${culture.streetPattern}`,
      `traits:      ${culture.traits.length ? culture.traits.join(', ') : 'none'}`,
    ];

    this.cultureText = this.add.text(this.scale.width - 10, 10, cLines.join('\n'), {
      fontSize: '10px', color: '#aaaacc', fontFamily: 'monospace',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 6 }, lineSpacing: 2,
    }).setOrigin(1, 0).setDepth(100).setScrollFactor(0);

    // ── Bottom-left: building breakdown ──────────────────────────────────
    const cats: Record<string, number> = {};
    for (const b of this.buildings) cats[b.category] = (cats[b.category] ?? 0) + 1;

    const bLines = [
      `-- Buildings (${this.buildings.length}) --`,
      ...Object.entries(cats).map(([c, n]) => `  ${c}: ${n}`),
    ];

    this.buildingSummaryText = this.add.text(10, this.scale.height - 10, bLines.join('\n'), {
      fontSize: '10px', color: '#aaaacc', fontFamily: 'monospace',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 6 }, lineSpacing: 2,
    }).setOrigin(0, 1).setDepth(100).setScrollFactor(0);

    // ── Bottom-right: category colour legend ─────────────────────────────
    this.legendGfx = this.add.graphics().setDepth(100).setScrollFactor(0);
    let ly = this.scale.height - 20;
    const lx = this.scale.width - 140;

    for (const [cat, color] of Object.entries(CAT_COLORS).reverse()) {
      this.legendGfx.fillStyle(color, 0.8);
      this.legendGfx.fillRect(lx, ly - 8, 12, 12);
      this.legendGfx.lineStyle(1, color, 1);
      this.legendGfx.strokeRect(lx, ly - 8, 12, 12);

      const label = this.add.text(lx + 18, ly - 2, cat, {
        fontSize: '10px', color: '#aaaacc', fontFamily: 'monospace',
      }).setOrigin(0, 0.5).setDepth(100).setScrollFactor(0);
      this.legendLabels.push(label);

      ly -= 18;
    }

    // ── Feedback button (prominent, bottom-centre) ────────────────────────
    this.feedbackBtn?.destroy();
    this.feedbackBtn = this.add.text(
      this.scale.width / 2, this.scale.height - 10,
      'Send Feedback / Report Bug  (F)',
      {
        fontSize: '16px', color: '#1a1a2e', fontFamily: 'monospace',
        backgroundColor: '#aaccff', padding: { x: 24, y: 10 },
        fontStyle: 'bold',
      },
    ).setOrigin(0.5, 1).setDepth(100).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.feedbackBtn.on('pointerdown', () => this.toggleFeedback());
    this.feedbackBtn.on('pointerover', () => {
      this.feedbackBtn?.setBackgroundColor('#ffffff');
    });
    this.feedbackBtn.on('pointerout', () => {
      this.feedbackBtn?.setBackgroundColor('#aaccff');
    });
  }

  // ── Feedback overlay (DOM) ─────────────────────────────────────────────────

  /** Build the current settlement params as a compact JSON string for context. */
  private settlementContext(): string {
    const cultures = getAllCultures();
    const culture = cultures[this.currentCultureIdx];
    return JSON.stringify({
      source: 'settlement-forge',
      tier: this.currentTier,
      tierName: TIER_NAMES[this.currentTier],
      geography: GEOGRAPHIES[this.currentGeoIdx],
      purpose: PURPOSES[this.currentPurposeIdx],
      culture: culture.id,
      cultureName: culture.name,
      seed: this.currentSeed,
      buildings: this.buildings.length,
      secondary: this.spec?.secondary ?? [],
      anomalies: this.spec?.anomalies.map(a => a.type) ?? [],
    });
  }

  private toggleFeedback(): void {
    if (this.feedbackOverlay) {
      this.closeFeedback();
    } else {
      this.openFeedback();
    }
  }

  /** Capture the Phaser canvas as a data URL (PNG). */
  private captureScreenshot(): string {
    try {
      return this.game.canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  /** Build a human-readable summary of the current settlement for the form. */
  private buildingSummary(): string {
    const cats: Record<string, string[]> = {};
    for (const b of this.buildings) {
      if (!cats[b.category]) cats[b.category] = [];
      cats[b.category].push(b.id);
    }
    return Object.entries(cats)
      .map(([cat, ids]) => `${cat}: ${ids.join(', ')}`)
      .join('\n');
  }

  private openFeedback(): void {
    if (this.feedbackOverlay) return;

    // Capture screenshot BEFORE the overlay covers the canvas
    const screenshot = this.captureScreenshot();
    const culture = getAllCultures()[this.currentCultureIdx];
    const summary = this.buildingSummary();

    const overlay = document.createElement('div');
    overlay.id = 'sf-feedback-overlay';
    overlay.innerHTML = `
      <style>
        #sf-feedback-overlay {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.7); font-family: 'Outfit', sans-serif;
        }
        #sf-feedback-box {
          background: #1a1a2e; border: 1px solid #556; border-radius: 10px;
          padding: 24px; max-width: 560px; width: 94%; color: #ccccdd;
          max-height: 90vh; overflow-y: auto;
        }
        #sf-feedback-box h3 { margin: 0 0 12px; color: #aaccff; font-size: 18px; }

        .sf-screenshot {
          width: 100%; border-radius: 6px; border: 1px solid #334;
          margin-bottom: 12px;
        }

        .sf-params {
          display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px;
          font-size: 12px; font-family: monospace; color: #999;
          background: #0d0d1a; padding: 10px 12px; border-radius: 6px;
          margin-bottom: 12px;
        }
        .sf-params .label { color: #667; }
        .sf-params .value { color: #aab; }

        .sf-buildings-detail {
          font-size: 11px; font-family: monospace; color: #778;
          background: #0d0d1a; padding: 8px 12px; border-radius: 6px;
          margin-bottom: 12px; white-space: pre-wrap; line-height: 1.5;
          max-height: 100px; overflow-y: auto;
        }

        #sf-feedback-box textarea {
          width: 100%; min-height: 80px; background: #0d0d1a; border: 1px solid #446;
          border-radius: 6px; color: #dde; padding: 10px; font-size: 14px;
          font-family: 'Outfit', sans-serif; resize: vertical;
        }
        #sf-feedback-box textarea:focus { outline: none; border-color: #aaccff; }
        #sf-feedback-box textarea::placeholder { color: #556; }

        .sf-btn-row { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }
        #sf-feedback-box button {
          padding: 8px 20px; border-radius: 6px; cursor: pointer;
          font-family: 'Outfit', sans-serif; font-size: 14px; border: none;
        }
        .sf-submit-btn { background: #aaccff; color: #1a1a2e; font-weight: 700; }
        .sf-submit-btn:hover { background: #ccddff; }
        .sf-submit-btn:disabled { opacity: 0.5; cursor: default; }
        .sf-cancel-btn { background: #2a2a3e; color: #888; border: 1px solid #444 !important; }
        .sf-cancel-btn:hover { color: #ccc; background: #333; }
        .sf-status { font-size: 13px; margin-top: 10px; min-height: 20px; text-align: center; }
        .sf-status.ok { color: #66cc66; }
        .sf-status.err { color: #cc6666; }
        .sf-attached-note { font-size: 11px; color: #556; margin-top: 8px; text-align: center; }
      </style>
      <div id="sf-feedback-box">
        <h3>Send Feedback / Report a Bug</h3>

        ${screenshot ? `<img src="${screenshot}" class="sf-screenshot" alt="Settlement preview" />` : ''}

        <div class="sf-params">
          <span class="label">Tier</span>    <span class="value">${this.currentTier} ${TIER_NAMES[this.currentTier]}</span>
          <span class="label">Geography</span> <span class="value">${GEOGRAPHIES[this.currentGeoIdx]}</span>
          <span class="label">Purpose</span> <span class="value">${PURPOSES[this.currentPurposeIdx]}</span>
          <span class="label">Culture</span> <span class="value">${culture.name}</span>
          <span class="label">Seed</span>    <span class="value">${this.currentSeed}</span>
          <span class="label">Buildings</span> <span class="value">${this.buildings.length}</span>
          <span class="label">Secondary</span> <span class="value">${this.spec?.secondary.length ? this.spec.secondary.join(', ') : 'none'}</span>
          <span class="label">Anomalies</span> <span class="value">${this.spec?.anomalies.length ? this.spec.anomalies.map(a => a.type).join(', ') : 'none'}</span>
        </div>

        <div class="sf-buildings-detail">${summary}</div>

        <textarea id="sf-feedback-text" placeholder="What do you think? Does the layout make sense for this type of settlement? Anything missing or out of place?"></textarea>

        <div class="sf-btn-row">
          <button class="sf-cancel-btn" id="sf-cancel">Cancel</button>
          <button class="sf-submit-btn" id="sf-submit">Send Feedback</button>
        </div>
        <div class="sf-status" id="sf-status"></div>
        <div class="sf-attached-note">Screenshot and settlement data are automatically attached.</div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.feedbackOverlay = overlay;

    const textarea = document.getElementById('sf-feedback-text') as HTMLTextAreaElement;
    setTimeout(() => textarea?.focus(), 50);

    document.getElementById('sf-cancel')!.addEventListener('click', () => this.closeFeedback());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeFeedback();
    });
    document.getElementById('sf-submit')!.addEventListener('click', () => this.submitFeedback());

    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { this.closeFeedback(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }

  private closeFeedback(): void {
    this.feedbackOverlay?.remove();
    this.feedbackOverlay = null;
    // Re-focus the Phaser canvas so keyboard controls work again
    this.game.canvas.focus();
  }

  private async submitFeedback(): Promise<void> {
    const textarea = document.getElementById('sf-feedback-text') as HTMLTextAreaElement | null;
    const statusEl = document.getElementById('sf-status');
    const submitBtn = document.getElementById('sf-submit') as HTMLButtonElement | null;
    const text = textarea?.value.trim();

    if (!text) {
      if (statusEl) { statusEl.textContent = 'Please write something first.'; statusEl.className = 'status err'; }
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) { statusEl.textContent = 'Sending...'; statusEl.className = 'status'; }

    try {
      // Pack settlement context + building list into session_id
      const ctx = JSON.parse(this.settlementContext());
      ctx.buildingList = this.buildings.map(b => b.id);
      await insertFeedback(
        `[Settlement Forge] ${text}`,
        GAME_VERSION,
        JSON.stringify(ctx),
      );
      if (statusEl) { statusEl.textContent = 'Thanks! Feedback sent.'; statusEl.className = 'status ok'; }
      setTimeout(() => this.closeFeedback(), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (statusEl) { statusEl.textContent = `Failed: ${msg}`; statusEl.className = 'status err'; }
      if (submitBtn) submitBtn.disabled = false;
    }
  }
}
