/**
 * MapForgeScene — clean-room map generation testbed.
 *
 * No game mechanics, no player, no HUD, no NPCs. Just terrain rendering
 * with camera controls and a settlement footprint overlay.
 *
 * Access: /mf or /mapforge in the URL.
 *
 * Controls:
 *   WASD / Arrow keys   Pan camera
 *   Scroll / +/-        Zoom
 *   T                   Toggle settlement overlay
 *   Shift+Left/Right    Cycle settlement seed
 *   Shift+Up/Down       Cycle settlement tier (1–5)
 */

import * as Phaser from 'phaser';
import { FbmNoise } from '../lib/noise';
import { worldToIso, ISO_WORLD_W, ISO_WORLD_H, ISO_TILE_W, ISO_TILE_H } from '../lib/IsoTransform';
import { isoTileFrame, ISO_RIVER_FRAME } from '../world/IsoTileMap';
import { CUSTOM_TILE_PACKS, preloadTilePacks } from '../world/TilePacks';
import { generateSettlement, initSettlementData } from '../world/SettlementGenerator';
import { placeBuildings } from '../world/SettlementPlacement';
import type { SettlementSite, Geography } from '../world/SettlementSpec';
import { SETTLEMENTS } from '../world/Level1';

// ── Noise constants — match GameScene exactly ────────────────────────────────
const WORLD_W    = 4500;
const WORLD_H    = 3000;
const TILE_SIZE  = 32;
const BASE_SCALE   = 0.07;
const DETAIL_SCALE = 0.18;
const TEMP_SCALE   = 0.04;
const MOIST_SCALE  = 0.06;

function tileBiomeIdx(elev: number, temp: number, moist: number): number {
  if (elev < 0.25) return 0; // Sea
  if (elev < 0.30) return (temp < 0.45 || moist > 0.50) ? 1 : 2; // Rocky/Sandy Shore
  if (elev < 0.45 && moist > 0.72) return 3; // Marsh / Bog
  if (elev < 0.68) {
    // Mid-altitude band — ~45% meadow, ~55% forest.
    if (moist > 0.55) return 7; // Forest
    return 6;                   // Meadow
  }
  if (elev < 0.80) return temp > 0.50 ? 8 : 9; // Spruce / Cold Granite
  return temp < 0.40 ? 11 : 10;                 // Snow Field / Bare Summit
}

// ── Category colors for settlement overlay ───────────────────────────────────
const CATEGORY_COLORS: Record<string, number> = {
  civic: 0x4488ff, military: 0xff4444, religious: 0xffcc00,
  commerce: 0x44cc44, industry: 0xff8800, residential: 0x999999,
  infrastructure: 0x886644, anomaly: 0xaa44ff,
};

export class MapForgeScene extends Phaser.Scene {
  static readonly KEY = 'MapForgeScene';

  private seed = Math.floor(Math.random() * 0xffffffff);

  // ── Settlement overlay state ──────────────────────────────────────────────
  private settlementSeed = 1;
  private settlementTier: 1|2|3|4|5 = 3;
  private settlementVisible = false;
  private settlementGfx?: Phaser.GameObjects.Graphics;
  private settlementLabels: Phaser.GameObjects.Text[] = [];
  private settlementHud?: Phaser.GameObjects.Text;
  private settlementDataReady = false;

  constructor() { super({ key: MapForgeScene.KEY }); }

  preload(): void {
    this.load.spritesheet('iso-tiles',
      '/assets/packs/isometric tileset/spritesheet.png',
      { frameWidth: 32, frameHeight: 32 });
    preloadTilePacks(this);
    // Cliff block tiles for elevation rendering.
    this.load.image('cliff-earthy', '/assets/packs/cliff-iso-gen/earthy_0.png');
    this.load.image('cliff-snow',   '/assets/packs/cliff-iso-gen/snow_0.png');
    this.load.image('cliff-peat',   '/assets/packs/cliff-iso-gen/peat_0.png');
    this.load.image('cliff-stone',  '/assets/packs/cliff-iso-gen/stone_iso_0.png');
    // Waterfall tiles — stacked where rivers cross cliff edges.
    for (let i = 0; i < 5; i++) {
      this.load.image(`waterfall-${i}`, `/assets/packs/waterfall-tiles/${i}.png`);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#111111');
    this.cameras.main.setBounds(0, 0, ISO_WORLD_W, ISO_WORLD_H);
    this.cameras.main.setZoom(1.5);
    // Start centred on the map.
    this.cameras.main.centerOn(ISO_WORLD_W / 2, ISO_WORLD_H / 2);

    this.drawTerrain();
    this.setupControls();

    // Info label.
    this.add.text(8, 8,
      'MapForge v0.3 — WASD pan, scroll zoom, T settlement overlay, Shift+arrows seed/tier', {
        fontSize: '11px', color: '#aaaaaa', fontFamily: 'monospace',
        backgroundColor: '#000000cc', padding: { x: 4, y: 2 },
      }).setScrollFactor(0).setDepth(9000);
  }

  update(): void {
    // Camera pan via WASD / arrows.
    const speed = 6 / this.cameras.main.zoom;
    const kb = this.input.keyboard!;
    if (kb.addKey('W').isDown || kb.addKey('UP').isDown)    this.cameras.main.scrollY -= speed;
    if (kb.addKey('S').isDown || kb.addKey('DOWN').isDown)  this.cameras.main.scrollY += speed;
    if (kb.addKey('A').isDown || kb.addKey('LEFT').isDown)  this.cameras.main.scrollX -= speed;
    if (kb.addKey('D').isDown || kb.addKey('RIGHT').isDown) this.cameras.main.scrollX += speed;
  }

  // ── Terrain ───────────────────────────────────────────────────────────────

  /** Map biome index to cliff block texture key. */
  private static cliffKey(biomeIdx: number): string {
    if (biomeIdx === 1)  return 'cliff-stone';
    if (biomeIdx === 3)  return 'cliff-peat';
    if (biomeIdx >= 9 && biomeIdx <= 10) return 'cliff-stone';
    if (biomeIdx === 11) return 'cliff-snow';
    return 'cliff-earthy';
  }

  /** Quantize biome elevation value to 0–3 discrete levels. */
  private static getElev(val: number): number {
    if (val < 0.45) return 0;
    if (val < 0.62) return 1;
    if (val < 0.78) return 2;
    return 3;
  }

  private drawTerrain(): void {
    const baseNoise  = new FbmNoise(this.seed);
    const detNoise   = new FbmNoise(this.seed ^ 0xb5ad4ecb);
    const tempNoise  = new FbmNoise(this.seed ^ 0x74656d70);
    const moistNoise = new FbmNoise(this.seed ^ 0x6d6f6973);

    const tilesX = Math.ceil(WORLD_W / TILE_SIZE);
    const tilesY = Math.ceil(WORLD_H / TILE_SIZE);

    // Height of one cliff level in screen pixels.
    const CLIFF_H = ISO_TILE_H;

    // ── Two-pass elevation: natural for biome assignment, visual for rendering ──
    // Pass 1: full elevation gradient with varied terrain — mountains, slopes,
    // valleys. This drives biome assignment so placement feels natural (forest
    // on slopes, marsh in dips, meadow on plateaus).
    const naturalElev = new Float32Array(tilesX * tilesY);
    const biomeGrid   = new Uint8Array(tilesX * tilesY);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const base   = baseNoise.warped(tx * BASE_SCALE, ty * BASE_SCALE, 4, 0.5);
        const detail = detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE, 2, 0.6);
        const temp   = tempNoise.fbm(tx * TEMP_SCALE, ty * TEMP_SCALE, 3, 0.5);
        const moist  = moistNoise.fbm(tx * MOIST_SCALE, ty * MOIST_SCALE, 3, 0.5);

        const perpDiag     = (tx / tilesX - (1 - ty / tilesY)) / 2;
        const mountainBias = Math.pow(Math.max(0, -perpDiag - 0.15), 1.8) * 5.0;
        const rightEdge    = Math.pow(Math.max(0, tx / tilesX - 0.75), 1.5) * 2.0;
        const bottomEdge   = Math.pow(Math.max(0, ty / tilesY - 0.80), 1.5) * 2.5;
        const oceanBias    = Math.pow(Math.max(0, perpDiag - 0.12), 1.2) * 3.5
                           + rightEdge + bottomEdge;
        // Full-range elevation for biome diversity
        const baseVal = base * 0.65 + mountainBias - oceanBias;
        const val = Math.max(0, Math.min(1.2, baseVal + detail * 0.25));

        const idx = ty * tilesX + tx;
        naturalElev[idx] = val;
        biomeGrid[idx]   = tileBiomeIdx(val, temp, moist);
      }
    }

    // Pass 2: visual elevation — flatten the corridor, only mountains get height.
    // Sea stays at 0, corridor is flat at level 0, mountains rise steeply.
    const elevGrid = new Uint8Array(tilesX * tilesY);
    const valGrid  = new Float32Array(tilesX * tilesY);
    for (let i = 0; i < naturalElev.length; i++) {
      const nat = naturalElev[i];
      let visual: number;
      if (nat < 0.25) {
        visual = nat;               // sea stays sea
      } else if (nat < 0.68) {
        visual = 0.35;              // entire corridor → flat level 0
      } else {
        // Mountains: remap 0.68–1.2 → 0.50–1.2 for gentle cliff steps
        visual = 0.50 + (nat - 0.68) * (0.70 / 0.52);
      }
      valGrid[i]  = visual;
      elevGrid[i] = MapForgeScene.getElev(visual);
    }

    // ── Rivers: gradient descent from mountain to ocean ──────────────────────
    // Trace 2 winding rivers by following the steepest downhill path from
    // source tiles in the mountain zone. Mark river tiles + neighbours as water.
    const isRiver = new Uint8Array(tilesX * tilesY);
    const RIVER_HALF_W = 1; // river is 3 tiles wide (centre ± 1)

    // Trace a river toward a target point, meandering along the way.
    const traceRiverTo = (
      startTx: number, startTy: number,
      goalTx: number, goalTy: number,
      noiseSeed: number,
    ): void => {
      const rNoise = new FbmNoise(this.seed ^ noiseSeed);
      let cx = startTx, cy = startTy;
      const visited = new Set<number>();
      for (let step = 0; step < 800; step++) {
        const ci = cy * tilesX + cx;
        if (visited.has(ci)) break;
        visited.add(ci);
        // Mark river band
        for (let dx = -RIVER_HALF_W; dx <= RIVER_HALF_W; dx++) {
          for (let dy = -RIVER_HALF_W; dy <= RIVER_HALF_W; dy++) {
            const rx = cx + dx, ry = cy + dy;
            if (rx >= 0 && rx < tilesX && ry >= 0 && ry < tilesY) {
              isRiver[ry * tilesX + rx] = 1;
            }
          }
        }
        // Reached goal?
        if (Math.abs(cx - goalTx) <= 2 && Math.abs(cy - goalTy) <= 2) break;
        // Reached ocean?
        if (valGrid[ci] < 0.25) break;

        // Direction toward goal
        const dx = goalTx - cx;
        const dy = goalTy - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) break;
        const dirX = dx / dist;
        const dirY = dy / dist;

        // Meander: lateral offset perpendicular to flow
        const meander = (rNoise.fbm(step * 0.07, cy * 0.04) - 0.5) * 4;
        const perpX = -dirY; // perpendicular
        const perpY = dirX;

        let bestX = Math.round(cx + dirX * 1.2 + perpX * meander);
        let bestY = Math.round(cy + dirY * 1.2 + perpY * meander);
        bestX = Math.max(0, Math.min(tilesX - 1, bestX));
        bestY = Math.max(0, Math.min(tilesY - 1, bestY));

        if (visited.has(bestY * tilesX + bestX)) {
          // Fallback: step directly toward goal
          bestX = Math.max(0, Math.min(tilesX - 1, Math.round(cx + dirX)));
          bestY = Math.max(0, Math.min(tilesY - 1, Math.round(cy + dirY)));
        }
        cx = bestX; cy = bestY;
      }
    };

    // Confluence point — centre of the map
    const conflTx = Math.floor(tilesX * 0.5);
    const conflTy = Math.floor(tilesY * 0.5);

    // River 1: flows in from the top edge (N), winds down to confluence
    traceRiverTo(Math.floor(tilesX * 0.35), 0, conflTx, conflTy, 0xaabb);
    // River 2: flows in from the left edge (NW), winds to confluence
    traceRiverTo(0, Math.floor(tilesY * 0.2), conflTx, conflTy, 0xccdd);
    // Merged river: from confluence out through the bottom-right edge to ocean
    traceRiverTo(conflTx, conflTy, tilesX - 1, tilesY - 1, 0xeeff);

    // River tiles keep their surrounding terrain elevation — no deep trenches.
    // Just mark the biome as sea so the river frame is used.
    for (let i = 0; i < isRiver.length; i++) {
      if (isRiver[i]) {
        biomeGrid[i] = 0; // sea biome for rendering
      }
    }

    // Render tiles with elevation offsets + cliff block stacking.
    const getE = (tx: number, ty: number) =>
      tx >= 0 && tx < tilesX && ty >= 0 && ty < tilesY
        ? elevGrid[ty * tilesX + tx] : 0;

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const idx = ty * tilesX + tx;
        const biomeIdx  = biomeGrid[idx];
        const tileElev  = elevGrid[idx];
        const detail    = detNoise.fbm(tx * DETAIL_SCALE, ty * DETAIL_SCALE, 2, 0.6);

        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const { x: isoX, y: isoY } = worldToIso(wx, wy);
        // Raise tile by its elevation level.
        const posY = isoY - tileElev * CLIFF_H;

        // Floor tile.
        let texKey: string;
        let frame: number | undefined;

        if (isRiver[idx]) {
          texKey = 'iso-tiles';
          frame = ISO_RIVER_FRAME;
        } else if (biomeIdx in CUSTOM_TILE_PACKS) {
          const packName = CUSTOM_TILE_PACKS[biomeIdx];
          const px = Math.floor(tx / 6), py = Math.floor(ty / 6);
          const qx = Math.floor((tx + 3) / 6), qy = Math.floor((ty + 2) / 6);
          const coarse  = ((px * 3571 ^ py * 2297 ^ px * py * 53) >>> 0) % 3;
          const coarse2 = ((qx * 4733 ^ qy * 1867 ^ qx * qy * 97) >>> 0) % 3;
          const fine    = ((tx * 1597 ^ ty * 2833 ^ (tx + ty) * 743) >>> 0) % 7;
          const tileHash = fine === 0 ? 3 : (fine <= 2 ? coarse2 : coarse);
          texKey = `${packName}-${tileHash}`;
        } else {
          texKey = 'iso-tiles';
          frame = isoTileFrame(biomeIdx, detail);
        }

        const img = frame != null
          ? this.add.image(isoX, posY, texKey, frame)
          : this.add.image(isoX, posY, texKey);
        img.setOrigin(0.5, 0).setDepth(ty * 10 + 5);

        // Cliff edges: stack cliff block tiles where this tile drops to a lower neighbour.
        // River tiles get waterfall blocks instead of rock cliff blocks.
        const southDrop = tileElev - getE(tx, ty + 1);
        const eastDrop  = tileElev - getE(tx + 1, ty);
        if (southDrop > 0 || eastDrop > 0) {
          const maxDrop = Math.max(southDrop, eastDrop);
          const isWaterfall = isRiver[idx] && southDrop > 0;
          const wallTex = isWaterfall
            ? `waterfall-${((tx * 3 + ty * 7) >>> 0) % 5}`
            : MapForgeScene.cliffKey(biomeIdx);
          for (let step = maxDrop * 2; step >= 1; step--) {
            this.add.image(isoX, posY + step * (CLIFF_H / 2), wallTex)
              .setOrigin(0.5, 0).setDepth(ty * 10 + 4);
          }
        }
      }
    }
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  private setupControls(): void {
    // Zoom.
    this.input.on('wheel',
      (_: Phaser.Input.Pointer, __: unknown, ___: unknown, deltaY: number) => {
        const cam = this.cameras.main;
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * (deltaY > 0 ? 0.9 : 1.1), 0.3, 8));
      });
    this.input.keyboard!.on('keydown-PLUS',         () => this.cameras.main.setZoom(Math.min(8, this.cameras.main.zoom * 1.15)));
    this.input.keyboard!.on('keydown-NUMPAD_ADD',    () => this.cameras.main.setZoom(Math.min(8, this.cameras.main.zoom * 1.15)));
    this.input.keyboard!.on('keydown-MINUS',         () => this.cameras.main.setZoom(Math.max(0.3, this.cameras.main.zoom / 1.15)));
    this.input.keyboard!.on('keydown-NUMPAD_MINUS',  () => this.cameras.main.setZoom(Math.max(0.3, this.cameras.main.zoom / 1.15)));

    // Middle-click / right-click drag to pan.
    let dragPrev: { x: number; y: number } | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown() || p.middleButtonDown()) dragPrev = { x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragPrev) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - dragPrev.x) / cam.zoom;
      cam.scrollY -= (p.y - dragPrev.y) / cam.zoom;
      dragPrev = { x: p.x, y: p.y };
    });
    this.input.on('pointerup', () => { dragPrev = null; });

    // Settlement overlay.
    this.input.keyboard!.on('keydown-T', () => this.toggleSettlementOverlay());
    this.input.keyboard!.on('keydown-LEFT',  (e: KeyboardEvent) => { if (e.shiftKey) { this.settlementSeed = Math.max(1, this.settlementSeed - 1); this.rebuildSettlementOverlay(); } });
    this.input.keyboard!.on('keydown-RIGHT', (e: KeyboardEvent) => { if (e.shiftKey) { this.settlementSeed++; this.rebuildSettlementOverlay(); } });
    this.input.keyboard!.on('keydown-UP',    (e: KeyboardEvent) => { if (e.shiftKey) { this.settlementTier = Math.min(5, this.settlementTier + 1) as 1|2|3|4|5; this.rebuildSettlementOverlay(); } });
    this.input.keyboard!.on('keydown-DOWN',  (e: KeyboardEvent) => { if (e.shiftKey) { this.settlementTier = Math.max(1, this.settlementTier - 1) as 1|2|3|4|5; this.rebuildSettlementOverlay(); } });

    // Disable right-click context menu.
    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── Settlement overlay ────────────────────────────────────────────────────

  private async toggleSettlementOverlay(): Promise<void> {
    this.settlementVisible = !this.settlementVisible;
    if (this.settlementVisible) {
      if (!this.settlementDataReady) {
        await initSettlementData();
        this.settlementDataReady = true;
      }
      this.rebuildSettlementOverlay();
    } else {
      this.clearSettlementOverlay();
    }
  }

  private rebuildSettlementOverlay(): void {
    if (!this.settlementVisible) return;
    this.clearSettlementOverlay();

    const gfx = this.add.graphics().setDepth(200);
    this.settlementGfx = gfx;
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;

    let totalBuildings = 0;

    for (const s of SETTLEMENTS) {
      let seed = (this.settlementSeed * 2654435761 + s.x * 7 + s.y * 13) | 0;
      const rng = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

      const geo: Geography = s.type === 'hamlet' ? 'coastal' : 'forest';
      const site: SettlementSite = {
        x: s.x, y: s.y, geography: geo,
        features: ['crossroads'], adjacentResources: ['timber', 'fertile-soil'],
        nearCorruption: false, tradeRouteCount: 1, nearbySettlements: 1,
        cultureId: 'ikibeki',
      };

      const { spec, buildings } = generateSettlement(site, s.name, rng, this.settlementTier);
      const gridSize = Math.max(20, Math.ceil(spec.radius / TILE_SIZE) * 2 + 4);
      const radiusTiles = Math.floor(gridSize / 2) - 1;

      const result = placeBuildings({
        buildings, radiusTiles, gridSize, tileSize: TILE_SIZE,
        seed: this.settlementSeed,
        zoneFracs: { inner: { min: 0, max: 0.35 }, middle: { min: 0.3, max: 0.7 }, outer: { min: 0.65, max: 1.0 } },
        streetPattern: 'radial',
      });

      totalBuildings += result.buildings.length;
      const gridCx = Math.floor(gridSize / 2);
      const gridCy = Math.floor(gridSize / 2);

      const tileToIso = (tx: number, ty: number) => {
        const wx = s.x + (tx - gridCx) * TILE_SIZE;
        const wy = s.y + (ty - gridCy) * TILE_SIZE;
        return worldToIso(wx, wy);
      };

      // Roads.
      for (const r of result.roads) {
        const { x, y } = tileToIso(r.tx, r.ty);
        gfx.fillStyle(r.main ? 0xc8a870 : 0xb09060, r.main ? 0.45 : 0.3);
        gfx.beginPath();
        gfx.moveTo(x, y); gfx.lineTo(x + hw, y + hh);
        gfx.lineTo(x, y + hh * 2); gfx.lineTo(x - hw, y + hh);
        gfx.closePath(); gfx.fillPath();
      }

      // Buildings.
      for (const pb of result.buildings) {
        const color = CATEGORY_COLORS[pb.building.category] ?? 0xcccccc;
        const halfW = Math.floor(pb.widthT / 2);
        const halfD = Math.floor(pb.depthT / 2);

        for (let dy = -halfD; dy < pb.depthT - halfD; dy++) {
          for (let dx = -halfW; dx < pb.widthT - halfW; dx++) {
            const { x, y } = tileToIso(pb.tx + dx, pb.ty + dy);
            gfx.fillStyle(color, 0.5);
            gfx.beginPath();
            gfx.moveTo(x, y); gfx.lineTo(x + hw, y + hh);
            gfx.lineTo(x, y + hh * 2); gfx.lineTo(x - hw, y + hh);
            gfx.closePath(); gfx.fillPath();
            gfx.lineStyle(1, color, 0.8); gfx.strokePath();
          }
        }

        // Entrance dot.
        if (pb.entranceTx != null && pb.entranceTy != null) {
          const ep = tileToIso(pb.entranceTx, pb.entranceTy);
          gfx.fillStyle(0x00ff00, 0.9);
          gfx.fillCircle(ep.x, ep.y + hh, 3);
        }

        // Label.
        const cp = tileToIso(pb.tx, pb.ty);
        const label = this.add.text(cp.x, cp.y + hh - 4, pb.building.id, {
          fontSize: '7px', color: '#ffffff', fontFamily: 'monospace',
          backgroundColor: '#00000088', padding: { x: 1, y: 0 },
        }).setOrigin(0.5, 1).setDepth(201);
        this.settlementLabels.push(label);
      }

      // Settlement name.
      const sIso = worldToIso(s.x, s.y);
      const nameLabel = this.add.text(sIso.x, sIso.y - 12, s.name, {
        fontSize: '10px', color: '#ffcc00', fontFamily: 'monospace',
        backgroundColor: '#000000aa', padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1).setDepth(202);
      this.settlementLabels.push(nameLabel);
    }

    this.settlementHud = this.add.text(8, 28,
      `Settlement  seed:${this.settlementSeed}  tier:${this.settlementTier}  (${totalBuildings} buildings)`, {
        fontSize: '11px', color: '#ffcc00', fontFamily: 'monospace',
        backgroundColor: '#000000cc', padding: { x: 4, y: 2 },
      }).setScrollFactor(0).setDepth(9000);
  }

  private clearSettlementOverlay(): void {
    this.settlementGfx?.destroy();
    this.settlementGfx = undefined;
    for (const t of this.settlementLabels) t.destroy();
    this.settlementLabels = [];
    this.settlementHud?.destroy();
    this.settlementHud = undefined;
  }
}
