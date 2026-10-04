/**
 * SettlementScene — a settlement loaded from a map file (#1170, #1168).
 *
 * This scene draws whatever `public/assets/maps/<id>.json` says: a generated
 * settlement (`npm run map:settlement`), a hand-authored one from LDtk, or an
 * export from SettlementEditorScene are all the same to it. It reads the
 * parsed `LdtkLevel` — Collision cells, PathSegments cells and Building /
 * Entrance / SpawnPoint entities — and never calls the generator itself.
 *
 * Same architectural pattern as `WorldForgeScene` / `DungeonForgeScene`: own
 * scene, own input, own UI, so build-mode concerns stay out of `GameScene`.
 *
 * Access: `/settlement` or `/build`, optionally `?map=<id>` (default
 * `settlement-demo`). Entering from the region map lands in #1174.
 */

import * as Phaser from 'phaser';
import { SimpleJoystick } from '../lib/SimpleJoystick';
import { WORLD_TILE_SIZE } from '../lib/IsoTransform';
import { preloadTilePacks } from '../world/TilePacks';
import { parseLdtkLevel, entitiesOfType, intGridGet, type LdtkLevel, type IntGridLayer } from '../world/MapData';
import { PATH_SEGMENT } from '../world/SettlementMapEmitter';
import { overviewTexture } from '../world/MapOverview';

/** Ground tile pack for cells that aren't road or building. */
const GROUND_PACK = 'meadow';
const DEFAULT_MAP_ID = 'settlement-demo';
/** Iso diamond size for one cell — 2:1 projection of a WORLD_TILE_SIZE square. */
const ISO_W = WORLD_TILE_SIZE * 2;
const ISO_H = WORLD_TILE_SIZE;
/** Building box height in px per block of heightHint; flat footprints + a lid is enough here. */
const BOX_H = 28;

const COLOR_ROAD_MAIN = 0x8a7a5a;
const COLOR_ROAD_MINOR = 0x6e6250;
const COLOR_BUILDING = 0xc8922a;
const COLOR_BUILDING_SIDE = 0x8a6418;
const COLOR_ENTRANCE = 0x4dd4f0;
const COLOR_RESOURCE = 0x7fd36b;

export class SettlementScene extends Phaser.Scene {
  private level!: LdtkLevel;
  private originX = 0;
  private originY = 0;

  constructor() {
    super({ key: 'SettlementScene' });
  }

  preload(): void {
    preloadTilePacks(this);
    // The map id comes from the URL so a freshly generated file can be viewed
    // without a code change: /settlement?map=settlement-42
    const id = new URLSearchParams(window.location.search).get('map') ?? DEFAULT_MAP_ID;
    this.load.json('settlement-map', `/assets/maps/${id}.json`);
  }

  create(): void {
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor(0x1a1a22);

    this.level = parseLdtkLevel(this.cache.json.get('settlement-map'));
    const collision = this.level.intGrids.Collision;
    const paths = this.level.intGrids.PathSegments;
    if (!collision) {
      this.add.text(W / 2, H / 2, 'Map has no Collision layer', { fontSize: '16px', color: '#ff8080', fontFamily: 'monospace' }).setOrigin(0.5);
      this.buildExitButton();
      return;
    }

    // Centre the grid's iso diamond on screen: the iso origin is the north
    // apex of cell (0,0), and the grid's visual centre is cell (n/2, n/2).
    const n = collision.cols;
    this.originX = W / 2;
    this.originY = H / 2 - (n * ISO_H) / 2;

    this.drawGround(collision, paths);
    this.drawBuildings();
    this.drawEntrances();
    this.drawResourceNodes();

    const { identifier, scale } = this.level;
    this.add.text(W / 2, 20, `${identifier} · ${scale.label} · 1 tile = ${scale.metersPerTile} m · ${n}×${n}`, {
      fontSize: '14px', color: '#ffe066', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(9999);

    this.buildMinimap();
    this.buildExitButton();
    this.buildTouchJoystick();
    this.input.keyboard?.on('keydown-ESC', this.exitToMainMenu, this);
    this.input.keyboard?.on('keydown-BACKSPACE', this.exitToMainMenu, this);
  }

  /** North apex of cell (tx, ty) in screen space. */
  private isoPos(tx: number, ty: number): { x: number; y: number } {
    return {
      x: this.originX + (tx - ty) * (ISO_W / 2),
      y: this.originY + (tx + ty) * (ISO_H / 2),
    };
  }

  /** Ground tiles, with road cells tinted by their PathSegments value. */
  private drawGround(collision: IntGridLayer, paths?: IntGridLayer): void {
    const gfx = this.add.graphics();
    for (let ty = 0; ty < collision.rows; ty++) {
      for (let tx = 0; tx < collision.cols; tx++) {
        const { x, y } = this.isoPos(tx, ty);
        const variant = (tx * 7 + ty * 13) & 3;
        this.add.image(x, y, `${GROUND_PACK}-${variant}`).setOrigin(0.5, 0).setDepth(ty + tx);
        const path = paths ? intGridGet(paths, tx, ty) : 0;
        if (path !== PATH_SEGMENT.none) {
          this.diamond(gfx, tx, ty, path === PATH_SEGMENT.paved ? COLOR_ROAD_MAIN : COLOR_ROAD_MINOR, 0.85);
        }
      }
    }
    gfx.setDepth(collision.cols + collision.rows);
  }

  /** One iso box per Building entity, sized from its pixel bounds. */
  private drawBuildings(): void {
    const entities = entitiesOfType(this.level.entityLayers.Entities ?? { identifier: 'Entities', entities: [] }, 'Building');
    const cell = WORLD_TILE_SIZE;
    for (const b of entities) {
      const x0 = b.x / cell, y0 = b.y / cell;
      const w = b.width / cell, d = b.height / cell;
      const gfx = this.add.graphics();
      const gN = this.isoPos(x0, y0), gE = this.isoPos(x0 + w, y0), gS = this.isoPos(x0 + w, y0 + d), gW = this.isoPos(x0, y0 + d);
      const lift = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - BOX_H });
      const tN = lift(gN), tE = lift(gE), tS = lift(gS), tW = lift(gW);
      // Two visible walls (SE, SW) then the lid, back to front.
      this.quad(gfx, COLOR_BUILDING_SIDE, 1, tE, gE, gS, tS);
      this.quad(gfx, COLOR_BUILDING_SIDE, 0.8, tS, gS, gW, tW);
      this.quad(gfx, COLOR_BUILDING, 1, tN, tE, tS, tW);
      // Depth-sort by the footprint's far corner so nearer boxes draw on top.
      gfx.setDepth(x0 + w + y0 + d + 100);
      const slug = String(b.fields.slug ?? b.identifier);
      this.add.text(tS.x, tS.y - BOX_H / 2 - 6, slug, { fontSize: '10px', color: '#1a1a22', fontFamily: 'monospace' })
        .setOrigin(0.5).setDepth(x0 + w + y0 + d + 101);
    }
  }

  private drawEntrances(): void {
    const entrances = entitiesOfType(this.level.entityLayers.Entities ?? { identifier: 'Entities', entities: [] }, 'Entrance');
    const gfx = this.add.graphics().setDepth(5000);
    for (const e of entrances) {
      this.diamond(gfx, e.x / WORLD_TILE_SIZE, e.y / WORLD_TILE_SIZE, COLOR_ENTRANCE, 0.6);
    }
  }

  /** Gatherable nodes from the map file (#1178), labelled by type until real sprites land. */
  private drawResourceNodes(): void {
    const nodes = entitiesOfType(this.level.entityLayers.Entities ?? { identifier: 'Entities', entities: [] }, 'ResourceNode');
    const gfx = this.add.graphics().setDepth(5000);
    for (const nd of nodes) {
      const tx = nd.x / WORLD_TILE_SIZE, ty = nd.y / WORLD_TILE_SIZE;
      this.diamond(gfx, tx, ty, COLOR_RESOURCE, 0.75);
      const { x, y } = this.isoPos(tx, ty);
      this.add.text(x, y + ISO_H / 2, String(nd.fields.nodeType ?? '?'), { fontSize: '9px', color: '#0f2a0a', fontFamily: 'monospace' })
        .setOrigin(0.5).setDepth(5001);
    }
  }

  private diamond(gfx: Phaser.GameObjects.Graphics, tx: number, ty: number, color: number, alpha: number): void {
    const { x, y } = this.isoPos(tx, ty);
    gfx.fillStyle(color, alpha);
    gfx.beginPath();
    gfx.moveTo(x, y);
    gfx.lineTo(x + ISO_W / 2, y + ISO_H / 2);
    gfx.lineTo(x, y + ISO_H);
    gfx.lineTo(x - ISO_W / 2, y + ISO_H / 2);
    gfx.closePath();
    gfx.fillPath();
  }

  private quad(gfx: Phaser.GameObjects.Graphics, color: number, alpha: number, ...p: { x: number; y: number }[]): void {
    gfx.fillStyle(color, alpha);
    gfx.beginPath();
    gfx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) gfx.lineTo(p[i].x, p[i].y);
    gfx.closePath();
    gfx.fillPath();
  }

  /** Top-down minimap in the top-right corner, from the same level the iso view draws (#1177). */
  private buildMinimap(): void {
    const CELL_PX = 4;
    const PAD = 12;
    const key = `overview-${this.level.identifier}`;
    const overview = overviewTexture(this, key, this.level, CELL_PX);
    const w = overview.cols * CELL_PX;
    const h = overview.rows * CELL_PX;
    const x = this.scale.width - PAD - w;
    const y = PAD;
    this.add.rectangle(x - 2, y - 2, w + 4, h + 4, 0x000000, 0.6).setOrigin(0).setScrollFactor(0).setDepth(9998);
    this.add.image(x, y, key).setOrigin(0).setScrollFactor(0).setDepth(9999);
  }

  private buildExitButton(): void {
    const padding = 16;
    const btn = this.add.text(padding, padding, '← Back', {
      fontSize: '16px', color: '#ffffff', fontFamily: 'monospace',
      backgroundColor: '#222244', padding: { x: 10, y: 6 },
    }).setScrollFactor(0).setDepth(9999).setInteractive({ useHandCursor: true });
    btn.on('pointerup', () => { this.exitToMainMenu(); });
  }

  /** Touch joystick so the scene is reachable on the tablet; movement itself lands with #1174. */
  private buildTouchJoystick(): void {
    if (navigator.maxTouchPoints === 0) return;
    const cx = 120, cy = this.scale.height - 120, r = 50, DEPTH = 9999;
    this.add.circle(cx, cy, r, 0x444444, 0.45).setScrollFactor(0).setDepth(DEPTH);
    const thumb = this.add.circle(cx, cy, 22, 0xcccccc, 0.60).setScrollFactor(0).setDepth(DEPTH);
    new SimpleJoystick(this, cx, cy, r, thumb);
  }

  private exitToMainMenu(): void {
    this.scene.start('MainMenuScene');
  }
}
