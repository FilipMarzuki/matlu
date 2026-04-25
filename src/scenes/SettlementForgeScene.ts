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
import type { SettlementSpec } from '../world/SettlementSpec';

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
  // and scale buildings into it. TILE = 16 matches SettlementLayout.ts.
  private readonly TILE = 16;

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
    this.regenerate();
  }

  private cyclePurpose(dir: number): void {
    this.currentPurposeIdx = (this.currentPurposeIdx + dir + PURPOSES.length) % PURPOSES.length;
    this.regenerate();
  }

  private cycleGeo(): void {
    this.currentGeoIdx = (this.currentGeoIdx + 1) % GEOGRAPHIES.length;
    this.regenerate();
  }

  private setTier(t: SettlementTier): void {
    this.currentTier = t;
    this.regenerate();
  }

  private reroll(): void {
    this.currentSeed = Math.floor(Math.random() * 0xffffffff);
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

    const mid = Math.floor(this.gridSize / 2);
    const radiusTiles = this.spec.radius / this.TILE;
    const placeRng = mulberry32(this.currentSeed + 13);

    // Track placed positions for collision avoidance
    const placed: Array<{ tx: number; ty: number; size: number }> = [];

    // Sort buildings: inner civic first (already sorted by generator)
    // Render in painter's order: we collect all placements first, then
    // draw back-to-front (sorted by tx+ty).
    const placements: Array<{
      tx: number; ty: number;
      widthT: number; depthT: number; heightPx: number;
      color: number; building: ResolvedBuilding;
    }> = [];

    for (const building of this.buildings) {
      const frac = ZONE_FRAC[building.zone] ?? ZONE_FRAC.middle;
      const color = CAT_COLORS[building.category] ?? 0x888888;

      // Building size in tiles (width from registry, proportional)
      const widthT = Math.max(1, Math.round(building.w / this.TILE));
      const depthT = widthT; // square footprint
      const hMult = HEIGHT_MULT[building.heightHint] ?? 0.6;
      const heightPx = Math.round(building.w * hMult * this.zoomFactor * 0.5);

      // Try up to 40 positions in the zone ring
      let success = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const angle = placeRng() * Math.PI * 2;
        const dist = radiusTiles * (frac.min + placeRng() * (frac.max - frac.min));
        const tx = Math.round(mid + Math.cos(angle) * dist);
        const ty = Math.round(mid + Math.sin(angle) * dist);

        // Bounds check
        if (tx < 1 || ty < 1 || tx >= this.gridSize - 1 || ty >= this.gridSize - 1) continue;

        // Overlap check
        const overlaps = placed.some(p => {
          const minDist = (widthT + p.size) / 2 + 0.8;
          const ddx = tx - p.tx;
          const ddy = ty - p.ty;
          return ddx * ddx + ddy * ddy < minDist * minDist;
        });

        if (!overlaps) {
          placed.push({ tx, ty, size: widthT });
          placements.push({ tx, ty, widthT, depthT, heightPx, color, building });
          success = true;
          break;
        }
      }

      // Fallback: place at ring midpoint (may overlap)
      if (!success) {
        const angle = placeRng() * Math.PI * 2;
        const dist = radiusTiles * (frac.min + frac.max) / 2;
        const tx = Math.round(mid + Math.cos(angle) * dist);
        const ty = Math.round(mid + Math.sin(angle) * dist);
        placements.push({ tx, ty, widthT, depthT, heightPx, color: this.darken(color, 0.6), building });
      }
    }

    // Sort by iso depth (tx + ty) so back buildings render first
    placements.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));

    // Draw
    for (const p of placements) {
      const gfx = this.add.graphics().setDepth(2 + (p.tx + p.ty) * 0.01);
      this.buildingObjects.push(gfx);

      this.drawIsoBox(gfx, p.tx, p.ty, p.widthT, p.depthT, p.heightPx, p.color, 0.85);

      // Label
      const { x, y } = this.isoPos(p.tx, p.ty);
      const labelY = y + this.ISO_H / 2 - p.heightPx - 4;
      const label = this.add.text(x, labelY, p.building.id, {
        fontSize: '7px', color: '#ffffff', fontFamily: 'monospace',
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

    // ── Top-left: settlement info + controls ─────────────────────────────
    const lines = [
      'Settlement Forge',
      '',
      `Tier:      ${this.spec.tier} - ${TIER_NAMES[this.spec.tier]}`,
      `Geography: ${GEOGRAPHIES[this.currentGeoIdx]}`,
      `Purpose:   ${PURPOSES[this.currentPurposeIdx]}`,
      `Culture:   ${culture.name} (${culture.id})`,
      `Seed:      ${this.currentSeed}`,
      `Radius:    ${this.spec.radius}px  (${Math.ceil(this.spec.radius / this.TILE)} tiles)`,
      '',
      `Secondary: ${this.spec.secondary.length ? this.spec.secondary.join(', ') : 'none'}`,
      `Anomalies: ${this.spec.anomalies.length ? this.spec.anomalies.map(a => a.type).join(', ') : 'none'}`,
      `Buildings: ${this.buildings.length}`,
      '',
      '-- Controls --',
      'A/D  L/R     Culture',
      'W/S  U/D     Purpose',
      '1-5          Tier',
      'G            Geography',
      'R            Re-roll seed',
      'Scroll +/-   Zoom',
      'Right-drag   Pan',
    ];

    this.hudText = this.add.text(10, 10, lines.join('\n'), {
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
  }
}
