/**
 * BuildingForgeScene — sprite assignment tool for buildings in the
 * building registry. Assign a sprite from the gallery, configure its
 * footprint grid, offset, flip, and exit markers.
 *
 * Access: navigate to /bf or /buildingforge in the URL.
 *
 * ## Controls
 *   A / D              Cycle building from registry
 *   M                  Cycle comparison sprite variant
 *   F                  Flip sprite east↔west
 *   G                  Toggle exit-edit mode
 *   Q / E              Footprint width -/+
 *   Z / X              Footprint depth -/+
 *   Shift+Arrows       Nudge sprite offset
 *   C                  Reset offset
 *   Scroll / +/-       Zoom
 *   Middle-drag        Pan camera
 *   Left click         Toggle footprint tile (or exit marker in G mode)
 */

import * as Phaser from 'phaser';
import { loadMacroWorld } from '../lib/macroWorld';
import type { ArchitectureStyle as DbArchStyle, Building as DbBuilding } from '../lib/macroWorld';

// ── Registry types (minimal — just what we need) ────────────────────────────

interface SpriteConfig {
  key: string;
  footprintW: number;
  footprintD: number;
  offsetX: number;
  offsetY: number;
  flipped?: boolean;
  /** Exit/entrance tiles on the footprint grid where roads should connect. */
  exits?: { tx: number; ty: number }[];
  /** Marked as done — sprite assignment, footprint, exits all finalized. */
  done?: boolean;
  /** Needs manual touch-up in a graphics editor or re-render via PixelLab. */
  needsEdit?: boolean;
}

interface RegistryEntry {
  id: string;
  name: string;
  category: string;
  baseSizeRange: [number, number];
  baseDepthRange?: [number, number];
  heightHint: string;
  /** Legacy single sprite config — migrated to sprites[] on load. */
  sprite?: SpriteConfig;
  /** Multiple sprite variants, each with independent footprint/offset/exits. */
  sprites?: SpriteConfig[];
}

// ── Constants ───────────────────────────────────────────────────────────────

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

/** All building sprite keys loaded in preload(), grouped by pack for gallery filtering. */
const GALLERY_SPRITES: { key: string; pack: 'iki' | 'markfolk' | 'mw' | 'misc' }[] = [
  // Ikibeki
  { key: 'iki-campfire', pack: 'iki' }, { key: 'iki-well', pack: 'iki' },
  { key: 'iki-guard-post', pack: 'iki' }, { key: 'iki-shrine', pack: 'iki' },
  { key: 'iki-spirit-shrine', pack: 'iki' }, { key: 'iki-watchtower', pack: 'iki' },
  { key: 'iki-cottage', pack: 'iki' }, { key: 'iki-ger-cottage', pack: 'iki' },
  { key: 'iki-ger-dwelling', pack: 'iki' }, { key: 'iki-ger-smithy', pack: 'iki' },
  { key: 'iki-smithy', pack: 'iki' }, { key: 'iki-farmstead', pack: 'iki' },
  { key: 'iki-longhouse', pack: 'iki' }, { key: 'iki-clan-lodge', pack: 'iki' },
  { key: 'iki-shelter-hut', pack: 'iki' }, { key: 'iki-merchant-stall', pack: 'iki' },
  { key: 'iki-tavern', pack: 'iki' }, { key: 'iki-warehouse', pack: 'iki' },
  { key: 'iki-stables', pack: 'iki' }, { key: 'iki-sawmill', pack: 'iki' },
  { key: 'iki-smokehouse', pack: 'iki' }, { key: 'iki-yurt-small', pack: 'iki' },
  { key: 'iki-yurt-large', pack: 'iki' }, { key: 'iki-ancestor-stone', pack: 'iki' },
  { key: 'iki-market-hall', pack: 'iki' }, { key: 'iki-granary', pack: 'iki' },
  { key: 'iki-temple', pack: 'iki' }, { key: 'iki-root-cellar', pack: 'iki' },
  { key: 'iki-barracks', pack: 'iki' }, { key: 'iki-town-hall', pack: 'iki' },
  { key: 'iki-inn', pack: 'iki' }, { key: 'iki-brewery', pack: 'iki' },
  { key: 'iki-barn', pack: 'iki' }, { key: 'iki-armory', pack: 'iki' },
  { key: 'iki-palisade-gate', pack: 'iki' },
  // Markfolk Timber-frame
  { key: 'bld-campfire', pack: 'markfolk' }, { key: 'bld-well', pack: 'markfolk' },
  { key: 'bld-guard-post', pack: 'markfolk' }, { key: 'bld-shrine', pack: 'markfolk' },
  { key: 'bld-watchtower', pack: 'markfolk' }, { key: 'bld-cottage', pack: 'markfolk' },
  { key: 'bld-smithy', pack: 'markfolk' }, { key: 'bld-farmstead', pack: 'markfolk' },
  { key: 'bld-longhouse', pack: 'markfolk' },
  // MW-buildings
  { key: 'mw-cottage', pack: 'mw' }, { key: 'mw-dwelling', pack: 'mw' },
  { key: 'mw-smokehouse', pack: 'mw' }, { key: 'mw-workshop', pack: 'mw' },
  { key: 'mw-longhouse', pack: 'mw' }, { key: 'mw-market-hall', pack: 'mw' },
];

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

  // Grid dimensions (kept for footprint defaults from registry)
  private gridW = 4;
  private gridD = 4;

  // Render objects
  private gridGfx: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];

  // ── Sprite placement preview ────────────────────────────────────────────────
  private comparisonSprite?: Phaser.GameObjects.Image;
  private comparisonLabel?: Phaser.GameObjects.Text;
  private comparisonBorder?: Phaser.GameObjects.Graphics;
  private comparisonIdx = 0;
  private showComparison = true;
  /** Editable footprint in tiles — initialised from building registry on load. */
  private footprintW = 3;
  private footprintD = 3;
  /**
   * Freeform footprint mask — `fpTiles[row * fpMaxCols + col]` = true if tile is active.
   * Grid coords are relative to the placement grid (col 0..fpMaxCols-1, row 0..fpMaxRows-1).
   * Initialised as a full W×D rectangle; click tiles to toggle individual cells.
   */
  private fpTiles: boolean[] = [];
  private fpMaxCols = 8;
  private fpMaxRows = 8;
  /** Screen-space origin of the placement grid — set during rebuild, read by click handler. */
  private fpGridOx = 0;
  private fpGridOy = 0;
  /** Sprite offset relative to grid centre, in screen pixels (before zoom). */
  private spriteOffX = 0;
  private spriteOffY = 0;
  /** Mirror sprite east↔west. */
  private spriteFlipped = false;
  /** Exit/entrance tiles on the footprint grid (col,row indices into fpTiles).
   *  Always stored in canonical (unflipped) orientation. */
  private fpExits: Set<number> = new Set();
  /** When true, clicking footprint tiles toggles exits instead of active/inactive. */
  private exitEditMode = true;

  /** Mirror a grid index across the width axis (for flip E↔W). */
  private mirrorGridIdx(idx: number): number {
    const r = Math.floor(idx / this.fpMaxCols);
    const c = idx % this.fpMaxCols;
    // Mirror column within the grid: margin(1) + footprint + margin(1)
    const mirroredC = this.fpMaxCols - 1 - c;
    return r * this.fpMaxCols + mirroredC;
  }

  /** Check if a grid index has an exit, accounting for flip. */
  private isExitAt(idx: number): boolean {
    // Exits are stored canonical. When flipped, check the mirrored position.
    const canonIdx = this.spriteFlipped ? this.mirrorGridIdx(idx) : idx;
    return this.fpExits.has(canonIdx);
  }

  // Sprite gallery — user-assignable sprite per building
  private selectedSpriteKey: string | null = null;
  private galleryFilter: 'all' | 'iki' | 'markfolk' | 'mw' = 'all';
  /** Current sprite variant index within the building's sprites array. */
  private variantIdx = 0;
  /** Filter buildings list: all, todo (not done), done, or needs-edit. */
  private buildingFilter: 'all' | 'todo' | 'done' | 'needs-edit' = 'todo';

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;

  constructor() {
    super({ key: 'BuildingForgeScene' });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    this.load.json('building-registry', '/macro-world/building-registry.json');
    this.load.json('architecture', '/macro-world/architecture.json');

    // Building object sprites (Markfolk Timber-frame)
    const bldBase = '/assets/packs/building-objects/markfolk-timber';
    this.load.image('bld-campfire',    `${bldBase}/campfire.png`);
    this.load.image('bld-well',        `${bldBase}/well.png`);
    this.load.image('bld-guard-post',  `${bldBase}/guard-post.png`);
    this.load.image('bld-shrine',      `${bldBase}/shrine.png`);
    this.load.image('bld-watchtower',  `${bldBase}/watchtower.png`);
    this.load.image('bld-cottage',     `${bldBase}/cottage.png`);
    this.load.image('bld-smithy',      `${bldBase}/smithy.png`);
    this.load.image('bld-farmstead',   `${bldBase}/farmstead.png`);
    this.load.image('bld-longhouse',   `${bldBase}/longhouse.png`);

    // MW-buildings pack — macro-world scale PixelLab building sprites
    const mwBase = '/assets/packs/mw-buildings';
    this.load.image('mw-cottage',      `${mwBase}/mw-cottage.png`);
    this.load.image('mw-dwelling',     `${mwBase}/mw-dwelling.png`);
    this.load.image('mw-smokehouse',   `${mwBase}/mw-smokehouse.png`);
    this.load.image('mw-workshop',     `${mwBase}/mw-workshop.png`);
    this.load.image('mw-longhouse',    `${mwBase}/mw-longhouse.png`);
    this.load.image('mw-market-hall',  `${mwBase}/mw-market-hall.png`);

    // Ikibeki Dencraft building sprites — dome/burrow architecture
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
    // New Ikibeki dome/burrow buildings
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
    // Parse registry
    const data = this.cache.json.get('building-registry') as { buildings: Array<RegistryEntry & { _section?: string }> };
    this.entries = data.buildings.filter(b => b.id && b.baseSizeRange) as RegistryEntry[];
    // Migrate legacy single sprite → sprites array
    for (const e of this.entries) {
      if (e.sprite && !e.sprites) {
        e.sprites = [e.sprite];
      }
      // Always clear legacy field after migration
      if (e.sprites) delete e.sprite;
    }

    // Parse architecture styles from JSON fallback; Supabase upgrade below
    const archData = this.cache.json.get('architecture') as { styles: ArchitectureStyle[] };
    this.archStyles = archData.styles;
    // Default to Ikibeki Dencraft if available, else ARCH-6
    const defaultArchIdx = this.archStyles.findIndex(a =>
      a.id === 'IKIBEKI-DENCRAFT' || a.name === 'Ikibeki Dencraft');
    if (defaultArchIdx >= 0) this.currentArchIdx = defaultArchIdx;
    else {
      const fallback = this.archStyles.findIndex(a => a.id === 'ARCH-6');
      if (fallback >= 0) this.currentArchIdx = fallback;
    }

    // Async: upgrade to Supabase data when available
    this.loadFromSupabase();

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

    // Jump to first building with a sprite if comparison mode is on.
    if (this.showComparison) this.jumpToNextSpriteBuilding();

    // Load current building
    this.loadBuilding();
    this.buildControlPanel();
    this.buildGalleryPanel();

    // ── Input ──────────────────────────────────────────────────────────────

    const kb = this.input.keyboard!;
    kb.on('keydown-A', () => this.cycleBuilding(-1));
    kb.on('keydown-D', () => this.cycleBuilding(1));
    kb.on('keydown-M', () => { this.comparisonIdx++; this.rebuild(); });
    kb.on('keydown-F', () => { this.spriteFlipped = !this.spriteFlipped; this.syncFlipCheckbox(); this.rebuild(); });
    kb.on('keydown-G', () => { this.exitEditMode = !this.exitEditMode; this.syncExitModeUI(); this.rebuild(); });
    // Footprint adjust: Q/E = width -/+, Z/X = depth -/+
    kb.on('keydown-Q', () => { this.footprintW = Math.max(1, this.footprintW - 1); this.resetFootprintMask(); this.rebuild(); });
    kb.on('keydown-E', () => { this.footprintW++; this.resetFootprintMask(); this.rebuild(); });
    kb.on('keydown-Z', () => { this.footprintD = Math.max(1, this.footprintD - 1); this.resetFootprintMask(); this.rebuild(); });
    kb.on('keydown-X', () => { this.footprintD++; this.resetFootprintMask(); this.rebuild(); });
    // Shift+Arrow keys nudge the sprite offset
    kb.on('keydown-LEFT',  (e: KeyboardEvent) => { if (e.shiftKey) { this.spriteOffX -= 1; this.rebuild(); } });
    kb.on('keydown-RIGHT', (e: KeyboardEvent) => { if (e.shiftKey) { this.spriteOffX += 1; this.rebuild(); } });
    kb.on('keydown-UP',    (e: KeyboardEvent) => { if (e.shiftKey) { this.spriteOffY -= 1; this.rebuild(); } });
    kb.on('keydown-DOWN',  (e: KeyboardEvent) => { if (e.shiftKey) { this.spriteOffY += 1; this.rebuild(); } });
    kb.on('keydown-C', () => { this.spriteOffX = 0; this.spriteOffY = 0; this.rebuild(); });

    // Zoom
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, dy: number) => {
      this.zoomFactor *= dy > 0 ? 0.9 : 1.1;
      this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor, 0.5, 6.0);
      this.rebuild();
    });
    kb.on('keydown-PLUS',  () => { this.zoomFactor = Math.min(6, this.zoomFactor * 1.15); this.rebuild(); });
    kb.on('keydown-MINUS', () => { this.zoomFactor = Math.max(0.5, this.zoomFactor / 1.15); this.rebuild(); });

    // Pan (middle drag)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.middleButtonDown()) {
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
      }
    });
    this.input.on('pointerup', () => { this.isPanning = false; });

    // Click on footprint grid tiles to toggle footprint cells or exit markers
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) return;
      const cam = this.cameras.main;
      const tile = this.screenToFootprintTile(p.x + cam.scrollX, p.y + cam.scrollY);
      if (!tile) return;
      const idx = tile.r * this.fpMaxCols + tile.c;
      if (this.exitEditMode) {
        // Convert to canonical (unflipped) index for storage
        const canonIdx = this.spriteFlipped ? this.mirrorGridIdx(idx) : idx;
        if (this.fpTiles[idx]) {
          if (this.fpExits.has(canonIdx)) this.fpExits.delete(canonIdx);
          else this.fpExits.add(canonIdx);
        }
      } else {
        this.fpTiles[idx] = !this.fpTiles[idx];
        // Remove canonical exit if tile is deactivated
        const canonIdx = this.spriteFlipped ? this.mirrorGridIdx(idx) : idx;
        if (!this.fpTiles[idx]) this.fpExits.delete(canonIdx);
      }
      this.rebuild();
    });

    this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.rebuild();
  }

  // ── Building management ───────────────────────────────────────────────────

  /** Try to upgrade architecture styles and buildings from Supabase (non-blocking). */
  private async loadFromSupabase(): Promise<void> {
    const mw = await loadMacroWorld();
    if (!mw) return;
    this.archStyles = mw.architectureStyles.map((s: DbArchStyle) => ({
      id: s.slug.toUpperCase(),
      name: s.name,
      primaryMaterial: s.primary_material ?? 'stone',
      constructionMethod: s.construction_method ?? 'built',
      formLanguage: s.form_language ?? 'rectilinear',
      groundRelation: s.ground_relation ?? 'on-ground',
      windowStyle: s.window_style ?? 'arch',
      ornamentLevel: s.ornament_level ?? 'minimal',
      structuralPrinciple: s.structural_principle ?? 'load-bearing',
      climateResponse: s.climate_response ?? 'heated',
      description: s.description ?? undefined,
      promptKeywords: s.prompt_keywords ?? undefined,
      realWorldInspiration: s.real_world_inspiration ?? undefined,
    } satisfies ArchitectureStyle));
    // Build a map of existing sprite configs so Supabase upgrade preserves them
    const spritesMap = new Map<string, SpriteConfig[]>();
    for (const e of this.entries) {
      if (e.sprites?.length) spritesMap.set(e.id, e.sprites);
    }
    this.entries = mw.buildings.map((b: DbBuilding) => ({
      id: b.slug,
      name: b.name,
      category: b.category ?? 'residential',
      baseSizeRange: [b.base_size_min ?? 2, b.base_size_max ?? 3] as [number, number],
      baseDepthRange: b.base_depth_min != null ? [b.base_depth_min, b.base_depth_max ?? b.base_depth_min] as [number, number] : undefined,
      heightHint: b.height_hint ?? 'standard',
      sprites: spritesMap.get(b.slug),
    }));
    const ikiCheck = (a: ArchitectureStyle) =>
      a.id === 'IKIBEKI-DENCRAFT' || a.name === 'Ikibeki Dencraft';
    this.archStyles.sort((a, b) => (ikiCheck(b) ? 1 : 0) - (ikiCheck(a) ? 1 : 0));
    this.currentArchIdx = 0;
    this.rebuild();
  }

  private loadBuilding(): void {
    const entry = this.entries[this.currentIdx];
    if (!entry) return;

    this.gridW = entry.baseSizeRange[1];
    this.gridD = (entry.baseDepthRange ?? entry.baseSizeRange)[1];
    // Don't reset variantIdx here — it may have been set by gallery click
    this.loadSpriteConfig(entry);
  }

  /** Load sprite config from current variant, or fall back to defaults. */
  private loadSpriteConfig(e: RegistryEntry): void {
    // Clamp variant index
    const numVariants = e.sprites?.length ?? 0;
    if (this.variantIdx >= numVariants) this.variantIdx = Math.max(0, numVariants - 1);
    const v = e.sprites?.[this.variantIdx];
    if (v) {
      this.footprintW = v.footprintW;
      this.footprintD = v.footprintD;
      this.spriteOffX = v.offsetX;
      this.spriteOffY = v.offsetY;
      this.spriteFlipped = v.flipped ?? false;
      this.selectedSpriteKey = v.key || null;
    } else {
      this.footprintW = e.baseSizeRange?.[1] ?? 3;
      this.footprintD = e.baseDepthRange?.[1] ?? this.footprintW;
      this.spriteOffX = 0;
      this.spriteOffY = 0;
      this.spriteFlipped = false;
      this.selectedSpriteKey = null;
    }
    // Reset footprint mask first (this clears fpExits), then restore exits
    this.resetFootprintMask();
    if (v?.exits) {
      for (const ex of v.exits) {
        const idx = (ex.ty + 1) * (this.footprintW + 2) + (ex.tx + 1);
        this.fpExits.add(idx);
      }
    }
    this.comparisonIdx = 0;
    this.syncGalleryHighlight();
  }

  /** Jump currentIdx to the nearest building (forward) that has comparison sprites. */
  private jumpToNextSpriteBuilding(): void {
    const n = this.entries.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.currentIdx + i) % n;
      if (BuildingForgeScene.comparisonKeysFor(this.entries[idx].id).length > 0) {
        this.currentIdx = idx;
        this.loadSpriteConfig(this.entries[idx]);
        return;
      }
    }
  }

  private cycleBuilding(dir: number): void {
    const filtered = this.getFilteredEntries();
    if (filtered.length === 0) return;
    // Find current position in filtered list
    const curFilteredIdx = filtered.findIndex(f => f.origIdx === this.currentIdx);
    const nextFilteredIdx = curFilteredIdx < 0
      ? 0
      : (curFilteredIdx + dir + filtered.length) % filtered.length;
    this.currentIdx = filtered[nextFilteredIdx].origIdx;
    this.variantIdx = 0;
    this.loadSpriteConfig(this.entries[this.currentIdx]);
    this.loadBuilding();
    this.rebuild();
  }

  // ── Control panel (left, DOM) ──────────────────────────────────────────────

  private buildControlPanel(): void {
    document.getElementById('bf-control-panel')?.remove();

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
      <h3>BuildingForge v0.6</h3>

      <div>
        <label>Architecture</label>
        <select id="bf-arch">
          ${this.archStyles.map((a, i) => `<option value="${i}"${i === this.currentArchIdx ? ' selected' : ''}>${a.name} — ${a.primaryMaterial}</option>`).join('')}
        </select>
      </div>

      <div class="bf-divider"></div>

      <div>
        <label>Building</label>
        <div style="display:flex; gap:4px; margin-bottom:4px;">
          <select id="bf-done-filter" style="width:70px; font-size:10px;">
            <option value="all"${this.buildingFilter === 'all' ? ' selected' : ''}>All</option>
            <option value="todo"${this.buildingFilter === 'todo' ? ' selected' : ''}>Todo</option>
            <option value="done"${this.buildingFilter === 'done' ? ' selected' : ''}>Done</option>
            <option value="needs-edit"${this.buildingFilter === 'needs-edit' ? ' selected' : ''}>Needs Edit</option>
          </select>
          <span id="bf-filter-count" style="color:#667; font-size:10px; line-height:24px;"></span>
        </div>
        <select id="bf-building">
          ${this.getFilteredEntries().map(({ entry, origIdx }) => `<option value="${origIdx}"${origIdx === this.currentIdx ? ' selected' : ''}>${BuildingForgeScene.isBuildingDone(entry) ? '✓ ' : BuildingForgeScene.hasNeedsEdit(entry) ? '✎ ' : ''}${entry.name} (${entry.id})</option>`).join('')}
        </select>
      </div>

      <div id="bf-variant-bar" style="display:flex; align-items:center; gap:4px;">
        <button class="bf-btn" id="bf-var-prev" style="width:24px; padding:2px;">◀</button>
        <span id="bf-var-label" style="color:#aab; font-size:11px; flex:1; text-align:center;"></span>
        <button class="bf-btn" id="bf-var-next" style="width:24px; padding:2px;">▶</button>
        <button class="bf-btn" id="bf-var-add" style="width:24px; padding:2px; color:#88ff88;">+</button>
      </div>

      <div style="display:flex; align-items:center; gap:6px;">
        <input type="checkbox" id="bf-done" ${this.getCurrentVariant()?.done ? 'checked' : ''} style="accent-color:#44cc44;">
        <label for="bf-done" style="margin:0; cursor:pointer; color:${this.getCurrentVariant()?.done ? '#44cc44' : '#889'};">Done</label>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <input type="checkbox" id="bf-needs-edit" ${this.getCurrentVariant()?.needsEdit ? 'checked' : ''} style="accent-color:#ffaa00;">
        <label for="bf-needs-edit" style="margin:0; cursor:pointer; color:${this.getCurrentVariant()?.needsEdit ? '#ffaa00' : '#889'};">Needs Edit</label>
      </div>

      <div>
        <label>Sprite Offset (X, Y)</label>
        <div class="bf-dim-row">
          <input type="number" id="bf-off-x" value="${this.spriteOffX}" style="width:56px">
          <span style="color:#556">,</span>
          <input type="number" id="bf-off-y" value="${this.spriteOffY}" style="width:56px">
        </div>
      </div>

      <div>
        <label>Footprint (W × D)</label>
        <div class="bf-dim-row">
          <input type="number" id="bf-fp-w" min="1" max="20" value="${this.footprintW}" style="width:56px">
          <span style="color:#556">×</span>
          <input type="number" id="bf-fp-d" min="1" max="20" value="${this.footprintD}" style="width:56px">
        </div>
      </div>

      <div class="bf-divider"></div>

      <div style="display:flex; gap:4px;">
        <button class="bf-btn" id="bf-save-sprite" style="background:#2a4a2a; color:#88ff88; flex:1;">Save</button>
        <button class="bf-btn" id="bf-unassign" style="background:#4a2a2a; color:#ff8888; flex:0 0 auto; width: 70px;">Unassign</button>
      </div>
      <div id="bf-save-status" style="color:#66aa66; font-size:10px; display:none;"></div>

      <div class="bf-divider"></div>

      <div style="display:flex; align-items:center; gap:6px;">
        <input type="checkbox" id="bf-flip" ${this.spriteFlipped ? 'checked' : ''} style="accent-color:#ffcc88;">
        <label for="bf-flip" style="margin:0; cursor:pointer;">Flip E↔W (F)</label>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <input type="checkbox" id="bf-exit-mode" ${this.exitEditMode ? 'checked' : ''} style="accent-color:#ff8844;">
        <label for="bf-exit-mode" style="margin:0; cursor:pointer; color:${this.exitEditMode ? '#ff8844' : '#889'};">Mark Exits (G)</label>
      </div>

      <div class="bf-divider"></div>

      <div id="bf-stats"></div>

      <div class="bf-divider"></div>

      <div class="bf-info">
        A/D: prev/next building<br>
        M: cycle variant<br>
        F: flip sprite<br>
        G: toggle exit mode<br>
        Q/E: width -/+<br>
        Z/X: depth -/+<br>
        Shift+Arrows: nudge offset<br>
        C: reset offset<br>
        Scroll: zoom<br>
        Middle-drag: pan
      </div>
    `;
    document.body.appendChild(panel);

    const sel = (id: string) => document.getElementById(id) as HTMLSelectElement;

    // Building selection
    sel('bf-building').addEventListener('change', (e) => {
      this.currentIdx = parseInt((e.target as HTMLSelectElement).value, 10);
      this.variantIdx = 0;
      this.loadBuilding();
      this.syncPanel();
      this.rebuild();
    });

    // Architecture selection
    sel('bf-arch').addEventListener('change', (e) => {
      this.currentArchIdx = parseInt((e.target as HTMLSelectElement).value, 10);
      this.rebuild();
    });

    // Done filter
    sel('bf-done-filter').addEventListener('change', (e) => {
      this.buildingFilter = (e.target as HTMLSelectElement).value as typeof this.buildingFilter;
      this.rebuildBuildingDropdown();
    });

    // Done checkbox — mark current building as done and auto-save
    document.getElementById('bf-done')!.addEventListener('change', async (e) => {
      const entry = this.entries[this.currentIdx];
      if (!entry) return;
      const isDone = (e.target as HTMLInputElement).checked;
      // Build exits from current state
      const exits: { tx: number; ty: number }[] = [];
      const gridCols = this.footprintW + 2;
      for (const idx of this.fpExits) {
        const r = Math.floor(idx / gridCols);
        const c = idx % gridCols;
        exits.push({ tx: c - 1, ty: r - 1 });
      }
      // Save current variant
      const variantConfig: SpriteConfig = {
        key: this.selectedSpriteKey ?? '',
        footprintW: this.footprintW,
        footprintD: this.footprintD,
        offsetX: this.spriteOffX,
        offsetY: this.spriteOffY,
        flipped: this.spriteFlipped || undefined,
        exits: exits.length > 0 ? exits : undefined,
        done: isDone || undefined,
        needsEdit: this.getCurrentVariant()?.needsEdit || undefined,
      };
      if (!entry.sprites) entry.sprites = [];
      entry.sprites[this.variantIdx] = variantConfig;
      // Auto-save to disk
      try {
        await fetch('/__save-registry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ buildings: this.entries }, null, 2),
        });
      } catch { /* ignore — will save on next explicit save */ }
      // If the current building no longer matches the filter, advance to next
      const filtered = this.getFilteredEntries();
      if (filtered.length > 0 && !filtered.some(f => f.origIdx === this.currentIdx)) {
        this.currentIdx = filtered[0].origIdx;
        this.loadBuilding();
        this.rebuild();
      }
      this.rebuildBuildingDropdown();
      this.syncPanel();
    });

    // Needs Edit checkbox
    document.getElementById('bf-needs-edit')!.addEventListener('change', (e) => {
      const entry = this.entries[this.currentIdx];
      if (!entry) return;
      const checked = (e.target as HTMLInputElement).checked;
      if (!entry.sprites) entry.sprites = [];
      if (!entry.sprites[this.variantIdx]) {
        entry.sprites[this.variantIdx] = {
          key: this.selectedSpriteKey ?? '', footprintW: this.footprintW,
          footprintD: this.footprintD, offsetX: this.spriteOffX, offsetY: this.spriteOffY,
        };
      }
      entry.sprites[this.variantIdx].needsEdit = checked || undefined;
      // Auto-save
      fetch('/__save-registry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildings: this.entries }, null, 2),
      }).catch(() => {});
      const lbl = (e.target as HTMLInputElement).nextElementSibling as HTMLLabelElement | null;
      if (lbl) lbl.style.color = checked ? '#ffaa00' : '#889';
      this.rebuildBuildingDropdown();
    });

    // Variant navigation
    document.getElementById('bf-var-prev')!.addEventListener('click', () => {
      const entry = this.entries[this.currentIdx];
      const n = entry.sprites?.length ?? 0;
      if (n > 1) {
        this.variantIdx = (this.variantIdx - 1 + n) % n;
        this.loadSpriteConfig(entry);
        this.syncPanel();
        this.rebuild();
      }
    });
    document.getElementById('bf-var-next')!.addEventListener('click', () => {
      const entry = this.entries[this.currentIdx];
      const n = entry.sprites?.length ?? 0;
      if (n > 1) {
        this.variantIdx = (this.variantIdx + 1) % n;
        this.loadSpriteConfig(entry);
        this.syncPanel();
        this.rebuild();
      }
    });
    document.getElementById('bf-var-add')!.addEventListener('click', () => {
      const entry = this.entries[this.currentIdx];
      if (!entry.sprites) entry.sprites = [];
      // Add a new empty variant
      entry.sprites.push({
        key: '',
        footprintW: entry.baseSizeRange?.[1] ?? 3,
        footprintD: (entry.baseDepthRange ?? entry.baseSizeRange)?.[1] ?? 3,
        offsetX: 0,
        offsetY: 0,
      });
      this.variantIdx = entry.sprites.length - 1;
      this.loadSpriteConfig(entry);
      this.syncPanel();
      this.rebuild();
    });

    // Flip toggle
    document.getElementById('bf-flip')!.addEventListener('change', (e) => {
      this.spriteFlipped = (e.target as HTMLInputElement).checked;
      this.rebuild();
    });

    // Exit edit mode toggle
    document.getElementById('bf-exit-mode')!.addEventListener('change', (e) => {
      this.exitEditMode = (e.target as HTMLInputElement).checked;
      this.syncExitModeUI();
      this.rebuild();
    });

    // Save sprite config to registry entry + write to disk via dev server
    document.getElementById('bf-save-sprite')!.addEventListener('click', async () => {
      const entry = this.entries[this.currentIdx];
      const key = this.getActiveSpriteKey() ?? '';
      // Convert exit grid indices to footprint-relative coords for storage
      const exits: { tx: number; ty: number }[] = [];
      const gridCols = this.footprintW + 2;
      for (const idx of this.fpExits) {
        const r = Math.floor(idx / gridCols);
        const c = idx % gridCols;
        exits.push({ tx: c - 1, ty: r - 1 }); // remove margin offset
      }
      const existing = this.getCurrentVariant();
      const variantConfig: SpriteConfig = {
        key,
        footprintW: this.footprintW,
        footprintD: this.footprintD,
        offsetX: this.spriteOffX,
        offsetY: this.spriteOffY,
        flipped: this.spriteFlipped || undefined,
        exits: exits.length > 0 ? exits : undefined,
        done: existing?.done || undefined,
        needsEdit: existing?.needsEdit || undefined,
      };
      if (!entry.sprites) entry.sprites = [];
      entry.sprites[this.variantIdx] = variantConfig;
      const fullData = { buildings: this.entries };
      const status = document.getElementById('bf-save-status');
      try {
        const res = await fetch('/__save-registry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fullData, null, 2),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (status) {
          status.textContent = `✓ Saved ${entry.id}: ${key} ${this.footprintW}×${this.footprintD} offset(${this.spriteOffX},${this.spriteOffY})`;
          status.style.color = '#66aa66';
          status.style.display = 'block';
        }
      } catch {
        // Fallback: download as file if dev server endpoint unavailable (production)
        const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'building-registry.json';
        a.click();
        URL.revokeObjectURL(url);
        if (status) {
          status.textContent = `Downloaded ${entry.id} (dev server unavailable)`;
          status.style.color = '#aaaa66';
          status.style.display = 'block';
        }
      }
    });

    // Unassign sprite from current building
    document.getElementById('bf-unassign')!.addEventListener('click', async () => {
      const entry = this.entries[this.currentIdx];
      if (!entry) return;
      // Remove current variant
      if (entry.sprites) {
        entry.sprites.splice(this.variantIdx, 1);
        if (entry.sprites.length === 0) delete entry.sprites;
      }
      this.variantIdx = 0;
      this.selectedSpriteKey = null;
      this.spriteOffX = 0;
      this.spriteOffY = 0;
      this.spriteFlipped = false;
      this.resetFootprintMask();
      // Save to disk
      try {
        await fetch('/__save-registry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ buildings: this.entries }, null, 2),
        });
      } catch { /* ignore */ }
      this.syncGalleryHighlight();
      this.syncPanel();
      this.rebuild();
      const status = document.getElementById('bf-save-status');
      if (status) {
        status.textContent = `Unassigned sprite from ${entry.id}`;
        status.style.color = '#ff8888';
        status.style.display = 'block';
      }
    });

    // Sprite offset inputs
    const offChange = () => {
      this.spriteOffX = parseInt((document.getElementById('bf-off-x') as HTMLInputElement).value, 10) || 0;
      this.spriteOffY = parseInt((document.getElementById('bf-off-y') as HTMLInputElement).value, 10) || 0;
      this.rebuild();
    };
    document.getElementById('bf-off-x')!.addEventListener('change', offChange);
    document.getElementById('bf-off-y')!.addEventListener('change', offChange);

    // Footprint inputs
    const fpChange = () => {
      this.footprintW = Phaser.Math.Clamp(parseInt((document.getElementById('bf-fp-w') as HTMLInputElement).value, 10) || 1, 1, 20);
      this.footprintD = Phaser.Math.Clamp(parseInt((document.getElementById('bf-fp-d') as HTMLInputElement).value, 10) || 1, 1, 20);
      this.resetFootprintMask();
      this.rebuild();
    };
    document.getElementById('bf-fp-w')!.addEventListener('change', fpChange);
    document.getElementById('bf-fp-d')!.addEventListener('change', fpChange);

    this.syncPanel();
  }

  /** Get entries filtered by done status, with original indices preserved. */
  private getFilteredEntries(): { entry: RegistryEntry; origIdx: number }[] {
    return this.entries
      .map((entry, origIdx) => ({ entry, origIdx }))
      .filter(({ entry }) => {
        if (this.buildingFilter === 'todo') return !BuildingForgeScene.isBuildingDone(entry);
        if (this.buildingFilter === 'done') return BuildingForgeScene.isBuildingDone(entry);
        if (this.buildingFilter === 'needs-edit') return BuildingForgeScene.hasNeedsEdit(entry);
        return true;
      });
  }

  /** Rebuild the building dropdown to reflect current filter. */
  private rebuildBuildingDropdown(): void {
    const sel = document.getElementById('bf-building') as HTMLSelectElement;
    if (!sel) return;
    const filtered = this.getFilteredEntries();
    sel.innerHTML = filtered.map(({ entry, origIdx }) =>
      `<option value="${origIdx}"${origIdx === this.currentIdx ? ' selected' : ''}>${BuildingForgeScene.isBuildingDone(entry) ? '✓ ' : BuildingForgeScene.hasNeedsEdit(entry) ? '✎ ' : ''}${entry.name} (${entry.id})</option>`
    ).join('');
    const countEl = document.getElementById('bf-filter-count');
    if (countEl) {
      const doneCount = this.entries.filter(e => BuildingForgeScene.isBuildingDone(e)).length;
      countEl.textContent = `${doneCount}/${this.entries.length} done`;
    }
  }

  private syncPanel(): void {
    const entry = this.entries[this.currentIdx];
    if (!entry) return;

    // Sync offset + footprint inputs
    const offX = document.getElementById('bf-off-x') as HTMLInputElement;
    const offY = document.getElementById('bf-off-y') as HTMLInputElement;
    const fpWIn = document.getElementById('bf-fp-w') as HTMLInputElement;
    const fpDIn = document.getElementById('bf-fp-d') as HTMLInputElement;
    if (offX) offX.value = String(this.spriteOffX);
    if (offY) offY.value = String(this.spriteOffY);
    if (fpWIn) fpWIn.value = String(this.footprintW);
    if (fpDIn) fpDIn.value = String(this.footprintD);

    const buildingSel = document.getElementById('bf-building') as HTMLSelectElement;
    if (buildingSel) buildingSel.value = String(this.currentIdx);

    const arch = this.archStyles[this.currentArchIdx];
    const spriteKey = this.getActiveSpriteKey();

    const stats = document.getElementById('bf-stats');
    if (stats) {
      stats.innerHTML = `
        <div class="bf-stat">Name: <span>${entry.name}</span></div>
        <div class="bf-stat">Category: <span>${entry.category}</span></div>
        <div class="bf-stat">Base size: <span>${this.gridW} × ${this.gridD}</span></div>
        <div class="bf-stat">Sprite: <span>${spriteKey ?? '(none)'}</span></div>
        <div class="bf-divider"></div>
        <div class="bf-stat">Architecture: <span>${arch?.name ?? '—'}</span></div>
        <div class="bf-stat">Material: <span>${arch?.primaryMaterial ?? '—'}</span></div>
        <div class="bf-stat">Form: <span>${arch?.formLanguage ?? '—'}</span></div>
        <div class="bf-stat">Ground: <span>${arch?.groundRelation ?? '—'}</span></div>
        ${arch?.description ? `<div class="bf-divider"></div><div class="bf-desc">${arch.description}</div>` : ''}
        ${arch?.promptKeywords ? `<div class="bf-keywords">${arch.promptKeywords}</div>` : ''}
      `;
    }

    // Sync done checkbox
    const doneCb = document.getElementById('bf-done') as HTMLInputElement;
    if (doneCb) {
      doneCb.checked = !!BuildingForgeScene.isBuildingDone(entry);
      const lbl = doneCb.nextElementSibling as HTMLLabelElement | null;
      if (lbl) lbl.style.color = this.getCurrentVariant()?.done ? '#44cc44' : '#889';
    }

    // Sync needs-edit checkbox
    const editCb = document.getElementById('bf-needs-edit') as HTMLInputElement;
    if (editCb) {
      editCb.checked = !!this.getCurrentVariant()?.needsEdit;
      const lbl = editCb.nextElementSibling as HTMLLabelElement | null;
      if (lbl) lbl.style.color = this.getCurrentVariant()?.needsEdit ? '#ffaa00' : '#889';
    }

    this.rebuildBuildingDropdown();
    this.syncVariantBar();
    this.syncFlipCheckbox();
    this.syncExitModeUI();
  }

  private syncVariantBar(): void {
    const entry = this.entries[this.currentIdx];
    const n = entry?.sprites?.length ?? 0;
    const label = document.getElementById('bf-var-label');
    if (label) {
      if (n > 0) {
        const v = this.getCurrentVariant();
        const keyName = v?.key ? v.key.replace(/^(iki|bld|mw)-/, '') : '(empty)';
        label.textContent = `Variant ${this.variantIdx + 1}/${n}: ${keyName}`;
      } else {
        label.textContent = 'No variants';
      }
    }
  }

  // ── Sprite gallery panel (bottom, DOM) ─────────────────────────────────────

  private buildGalleryPanel(): void {
    document.getElementById('bf-gallery-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'bf-gallery-panel';
    panel.innerHTML = `
      <style>
        #bf-gallery-panel {
          position: fixed; bottom: 0; left: 220px; right: 0; height: 130px;
          background: #12121eee; border-top: 1px solid #334;
          font-family: monospace; font-size: 11px; color: #ccd;
          padding: 6px 10px; z-index: 500;
          display: flex; flex-direction: column; gap: 4px;
        }
        #bf-gallery-panel .bf-gallery-header {
          display: flex; align-items: center; gap: 6px; flex-shrink: 0;
        }
        #bf-gallery-panel .bf-gallery-header h4 { margin: 0; color: #ffcc88; font-size: 12px; }
        #bf-gallery-panel .bf-gal-filter {
          background: #2a2a4e; color: #aab; border: 1px solid #446;
          border-radius: 3px; padding: 2px 8px; cursor: pointer;
          font-family: monospace; font-size: 10px;
        }
        #bf-gallery-panel .bf-gal-filter:hover { background: #3a3a5e; color: #fff; }
        #bf-gallery-panel .bf-gal-filter.active { background: #4a3a2e; color: #ffcc88; border-color: #ffcc88; }
        #bf-gallery-strip {
          display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden;
          flex: 1; align-items: flex-start; padding: 4px 0;
        }
        #bf-gallery-strip::-webkit-scrollbar { height: 6px; }
        #bf-gallery-strip::-webkit-scrollbar-track { background: #1a1a2e; }
        #bf-gallery-strip::-webkit-scrollbar-thumb { background: #446; border-radius: 3px; }
        .bf-gal-item {
          flex-shrink: 0; display: flex; flex-direction: column; align-items: center;
          gap: 2px; cursor: pointer; padding: 3px; border: 2px solid transparent;
          border-radius: 4px; min-width: 64px;
        }
        .bf-gal-item:hover { background: #2a2a4e; }
        .bf-gal-item.selected { border-color: #ffcc88; background: #1e1e3a; }
        .bf-gal-item canvas { image-rendering: pixelated; }
        .bf-gal-item .bf-gal-label {
          font-size: 9px; color: #889; text-align: center; max-width: 72px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .bf-gal-item.selected .bf-gal-label { color: #ffcc88; }
        .bf-gal-clear {
          flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          width: 64px; height: 64px; cursor: pointer; padding: 3px;
          border: 2px dashed #446; border-radius: 4px; color: #667;
          font-size: 10px; text-align: center;
        }
        .bf-gal-clear:hover { background: #2a2a4e; border-color: #889; color: #aab; }
        .bf-gal-clear.selected { border-color: #ffcc88; color: #ffcc88; }
      </style>
      <div class="bf-gallery-header">
        <h4>Sprite Gallery</h4>
        <button class="bf-gal-filter active" data-filter="all">All</button>
        <button class="bf-gal-filter" data-filter="iki">Ikibeki</button>
        <button class="bf-gal-filter" data-filter="markfolk">Markfolk</button>
        <button class="bf-gal-filter" data-filter="mw">MW</button>
        <span style="color:#556; margin-left:auto; font-size:10px;">Click to assign → building</span>
        <button class="bf-gal-filter bf-gal-scroll" id="bf-gal-scroll-left" style="margin-left:8px;">◀</button>
        <button class="bf-gal-filter bf-gal-scroll" id="bf-gal-scroll-right">▶</button>
      </div>
      <div id="bf-gallery-strip"></div>
    `;
    document.body.appendChild(panel);

    // Filter buttons (exclude scroll buttons)
    panel.querySelectorAll('.bf-gal-filter:not(.bf-gal-scroll)').forEach(btn => {
      btn.addEventListener('click', () => {
        this.galleryFilter = (btn as HTMLElement).dataset.filter as typeof this.galleryFilter;
        panel.querySelectorAll('.bf-gal-filter:not(.bf-gal-scroll)').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.populateGalleryStrip();
      });
    });

    // Gallery scroll buttons
    const strip = document.getElementById('bf-gallery-strip')!;
    document.getElementById('bf-gal-scroll-left')!.addEventListener('click', () => {
      strip.scrollBy({ left: -300, behavior: 'smooth' });
    });
    document.getElementById('bf-gal-scroll-right')!.addEventListener('click', () => {
      strip.scrollBy({ left: 300, behavior: 'smooth' });
    });

    this.populateGalleryStrip();
  }

  /** Fill the gallery strip with sprite thumbnails based on current filter. */
  private populateGalleryStrip(): void {
    const strip = document.getElementById('bf-gallery-strip');
    if (!strip) return;
    strip.innerHTML = '';

    // "None" option to clear assignment
    const clearEl = document.createElement('div');
    clearEl.className = 'bf-gal-clear' + (this.selectedSpriteKey === null ? ' selected' : '');
    clearEl.textContent = '(none)';
    clearEl.addEventListener('click', () => {
      this.selectedSpriteKey = null;
      this.syncGalleryHighlight();
      this.rebuild();
    });
    strip.appendChild(clearEl);

    const filtered = GALLERY_SPRITES.filter(s =>
      this.galleryFilter === 'all' || s.pack === this.galleryFilter
    );

    for (const sprite of filtered) {
      if (!this.textures.exists(sprite.key)) continue;
      const tex = this.textures.get(sprite.key);
      const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;

      const item = document.createElement('div');
      item.className = 'bf-gal-item' + (this.selectedSpriteKey === sprite.key ? ' selected' : '');
      item.dataset.spriteKey = sprite.key;

      // Render a small thumbnail canvas
      const thumbSize = 56;
      const canvas = document.createElement('canvas');
      canvas.width = thumbSize;
      canvas.height = thumbSize;
      const ctx = canvas.getContext('2d')!;
      // Scale to fit, maintaining aspect ratio
      const scale = Math.min(thumbSize / src.width, thumbSize / src.height);
      const w = src.width * scale;
      const h = src.height * scale;
      ctx.drawImage(src, (thumbSize - w) / 2, (thumbSize - h) / 2, w, h);

      const label = document.createElement('div');
      label.className = 'bf-gal-label';
      label.textContent = sprite.key;
      label.title = sprite.key;

      item.appendChild(canvas);
      item.appendChild(label);

      item.addEventListener('click', () => {
        this.selectedSpriteKey = sprite.key;
        // Auto-select the building that has this sprite assigned (saved or legacy map)
        let matchIdx = this.entries.findIndex(e => e.sprites?.some(s => s.key === sprite.key));
        if (matchIdx < 0) {
          // Check legacy comparison map
          matchIdx = this.entries.findIndex(e =>
            BuildingForgeScene.comparisonKeysFor(e.id).includes(sprite.key)
          );
        }
        if (matchIdx >= 0 && matchIdx !== this.currentIdx) {
          this.currentIdx = matchIdx;
          // Jump to the correct variant
          const vIdx = BuildingForgeScene.findVariantByKey(this.entries[matchIdx], sprite.key);
          if (vIdx >= 0) this.variantIdx = vIdx;
          // Temporarily switch filter to 'all' if the matched building is filtered out
          const filtered = this.getFilteredEntries();
          if (!filtered.some(f => f.origIdx === matchIdx)) {
            this.buildingFilter = 'all';
            const filterSel = document.getElementById('bf-done-filter') as HTMLSelectElement;
            if (filterSel) filterSel.value = 'all';
          }
          this.loadBuilding();
          this.syncPanel();
        }
        this.syncGalleryHighlight();
        this.rebuild();
      });

      strip.appendChild(item);
    }
  }

  /** Update gallery highlight to match current selectedSpriteKey. */
  private syncGalleryHighlight(): void {
    const strip = document.getElementById('bf-gallery-strip');
    if (!strip) return;
    strip.querySelectorAll('.bf-gal-item').forEach(el => {
      const key = (el as HTMLElement).dataset.spriteKey;
      el.classList.toggle('selected', key === this.selectedSpriteKey);
    });
    const clearEl = strip.querySelector('.bf-gal-clear');
    if (clearEl) clearEl.classList.toggle('selected', this.selectedSpriteKey === null);
  }

  // ── UI sync helpers ──────────────────────────────────────────────────────

  private syncFlipCheckbox(): void {
    const cb = document.getElementById('bf-flip') as HTMLInputElement;
    if (cb) cb.checked = this.spriteFlipped;
  }

  private syncExitModeUI(): void {
    const cb = document.getElementById('bf-exit-mode') as HTMLInputElement;
    if (cb) cb.checked = this.exitEditMode;
    const label = cb?.nextElementSibling as HTMLLabelElement | null;
    if (label) label.style.color = this.exitEditMode ? '#ff8844' : '#889';
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private rebuild(): void {
    // Clean up old graphics and labels
    this.gridGfx?.destroy();
    this.gridGfx = null;
    this.comparisonSprite?.destroy();
    this.comparisonSprite = undefined;
    this.comparisonLabel?.destroy();
    this.comparisonLabel = undefined;
    this.comparisonBorder?.destroy();
    this.comparisonBorder = undefined;
    for (const l of this.labels) l.destroy();
    this.labels = [];

    const entry = this.entries[this.currentIdx];
    if (!entry) return;

    // Centre the origin
    this.originX = this.scale.width / 2;
    this.originY = this.scale.height * 0.35;

    // ── Sprite placement preview — footprint grid with sprite overlay ────

    // Use gallery-selected sprite, or fall back to legacy cycling
    const activeKey = this.getActiveSpriteKey();
    const spriteKeys = activeKey ? [activeKey] : BuildingForgeScene.comparisonKeysFor(entry.id);

    if (spriteKeys.length > 0) {
      const key = activeKey ?? spriteKeys[this.comparisonIdx % spriteKeys.length];
      if (this.textures.exists(key)) {
        const hw = this.ISO_W / 2;
        const hh = this.ISO_H / 2;
        const fpW = this.footprintW;
        const fpD = this.footprintD;

        // Ensure mask is initialised
        if (this.fpTiles.length === 0) this.resetFootprintMask();

        const gridCols = this.fpMaxCols;
        const gridRows = this.fpMaxRows;

        // Grid origin: centred in the scene
        const gridOx = this.originX;
        const gridOy = this.originY - hh;
        this.fpGridOx = gridOx;
        this.fpGridOy = gridOy;

        // Iso position within the placement grid
        const gIso = (tx: number, ty: number) => ({
          x: gridOx + (tx - ty) * hw,
          y: gridOy + (tx + ty) * hh,
        });

        const gfx = this.add.graphics().setDepth(11);
        this.gridGfx = gfx;

        // 1. Draw grid — active footprint tiles filled, exit tiles in orange, others outlined.
        let activeCount = 0;
        let exitCount = 0;
        for (let r = 0; r < gridRows; r++) {
          for (let c = 0; c < gridCols; c++) {
            const { x, y } = gIso(c, r);
            const idx = r * gridCols + c;
            const active = this.fpTiles[idx];
            const isExit = this.isExitAt(idx);
            if (active) activeCount++;
            if (isExit) exitCount++;

            if (active) {
              const fillColor = isExit ? 0xff6600 : 0x4488ff;
              const fillAlpha = isExit ? 0.6 : 0.25;
              gfx.fillStyle(fillColor, fillAlpha);
              gfx.beginPath();
              gfx.moveTo(x, y); gfx.lineTo(x + hw, y + hh);
              gfx.lineTo(x, y + hh * 2); gfx.lineTo(x - hw, y + hh);
              gfx.closePath(); gfx.fillPath();
            }

            const strokeColor = isExit ? 0xff8800 : (active ? 0x88aaff : 0x444466);
            const strokeAlpha = (active || isExit) ? 0.8 : 0.3;
            gfx.lineStyle(isExit ? 2 : 1, strokeColor, strokeAlpha);
            gfx.beginPath();
            gfx.moveTo(x, y); gfx.lineTo(x + hw, y + hh);
            gfx.lineTo(x, y + hh * 2); gfx.lineTo(x - hw, y + hh);
            gfx.closePath(); gfx.strokePath();

            // Draw a bright exit marker icon on exit tiles
            if (isExit) {
              const cx = x;
              const cy = y + hh; // centre of the diamond
              // Solid orange circle
              gfx.fillStyle(0xff6600, 1);
              gfx.fillCircle(cx, cy, Math.max(3, hw * 0.25));
              // White outline ring
              gfx.lineStyle(2, 0xffffff, 0.9);
              gfx.strokeCircle(cx, cy, Math.max(4, hw * 0.3));
            }
          }
        }

        // 2. Place sprite at the grid centre, at a fixed scale (1 iso tile = 32px).
        // The sprite size is independent of the footprint — the footprint is the
        // building's collision/placement base, the sprite is the visual.
        const centreApex = gIso(
          Math.floor(gridCols / 2),
          Math.floor(gridRows / 2),
        );
        const anchorX = centreApex.x;
        const anchorY = centreApex.y + hh; // centre of the diamond, not north apex

        // Scale: one game pixel = ISO_W/32 screen pixels (32px = 1 tile in the sprite).
        const scale = this.ISO_W / 32;
        const img = this.add.image(
          anchorX + this.spriteOffX * scale,
          anchorY + this.spriteOffY * scale,
          key,
        );
        img.setScale(scale).setOrigin(0.5, 0.5).setDepth(10);
        if (this.spriteFlipped) img.setFlipX(true);
        this.comparisonSprite = img;

        // 3. Anchor point marker
        gfx.fillStyle(0xff3333, 1);
        gfx.fillCircle(anchorX, anchorY, 4);
        gfx.lineStyle(2, 0xff3333, 0.6);
        gfx.strokeCircle(anchorX, anchorY, 7);

        this.comparisonBorder = gfx;

        // 4. Info label
        const labelY = gridOy + (gridCols + gridRows) * hh + 8;
        this.comparisonLabel = this.add.text(
          gridOx, labelY,
          `${key}  (${img.width}×${img.height}px)  offset: ${this.spriteOffX},${this.spriteOffY}${this.spriteFlipped ? '  [FLIPPED]' : ''}\n` +
          `Footprint: ${fpW}×${fpD} grid  ${activeCount} active  ${exitCount} exit${exitCount !== 1 ? 's' : ''}` +
          `${this.exitEditMode ? '  [EXIT MODE]' : ''}\n` +
          `Click tiles  Q/E width  Z/X depth  Shift+Arrows nudge  C reset  M variant  F flip  G exits`,
          { fontSize: '10px', color: '#ffcc00', fontFamily: 'monospace',
            backgroundColor: '#000000aa', padding: { x: 4, y: 2 } },
        ).setOrigin(0.5, 0).setDepth(12);
      }
    }

    // Update stats in the DOM control panel
    this.syncPanel();
  }

  /** Reset footprint mask to a full W×D rectangle. */
  private resetFootprintMask(): void {
    this.fpMaxCols = this.footprintW + 2;
    this.fpMaxRows = this.footprintD + 2;
    this.fpTiles = new Array(this.fpMaxCols * this.fpMaxRows).fill(false);
    this.fpExits = new Set();
    // Fill the inner rectangle (skip 1-tile margin)
    for (let r = 1; r <= this.footprintD; r++) {
      for (let c = 1; c <= this.footprintW; c++) {
        this.fpTiles[r * this.fpMaxCols + c] = true;
      }
    }
  }

  /** Convert screen coords to placement grid tile (col, row), or null if outside. */
  private screenToFootprintTile(px: number, py: number): { c: number; r: number } | null {
    const hw = this.ISO_W / 2;
    const hh = this.ISO_H / 2;
    // Inverse iso: a = (px - ox) / hw, b = (py - oy) / hh
    const a = (px - this.fpGridOx) / hw;
    const b = (py - this.fpGridOy) / hh;
    const c = Math.round((a + b) / 2);
    const r = Math.round((b - a) / 2);
    if (c < 0 || c >= this.fpMaxCols || r < 0 || r >= this.fpMaxRows) return null;
    return { c, r };
  }

  /** Get the current variant's sprite config (or undefined). */
  private getCurrentVariant(): SpriteConfig | undefined {
    const entry = this.entries[this.currentIdx];
    return entry?.sprites?.[this.variantIdx];
  }

  /** Check if a building is fully done (all variants marked done, and has at least one). */
  private static isBuildingDone(e: RegistryEntry): boolean {
    // Check sprites array (new format)
    if (e.sprites?.length) return e.sprites.every(s => s.done);
    // Fallback: check legacy sprite field (old format, pre-migration)
    if (e.sprite?.done) return true;
    return false;
  }

  /** Check if any variant of a building is flagged as needing manual editing. */
  private static hasNeedsEdit(e: RegistryEntry): boolean {
    return !!e.sprites?.some(s => s.needsEdit) || !!e.sprite?.needsEdit;
  }

  /** Find which variant of a building has a given sprite key. Returns -1 if not found. */
  private static findVariantByKey(e: RegistryEntry, key: string): number {
    return e.sprites?.findIndex(s => s.key === key) ?? -1;
  }

  /** Get the active comparison sprite key for the current building. */
  private getActiveSpriteKey(): string | null {
    // 1. User-selected from gallery takes priority
    if (this.selectedSpriteKey) return this.selectedSpriteKey;
    // 2. Current variant in registry
    const variant = this.getCurrentVariant();
    if (variant?.key) return variant.key;
    return null;
  }

  /** Legacy fallback — all known sprite variants for a building (used for M-key cycling). */
  private static comparisonKeysFor(buildingId: string): string[] {
    const map: Record<string, string[]> = {
      'campfire':       ['bld-campfire', 'iki-campfire'],
      'well':           ['bld-well', 'iki-well'],
      'guard-post':     ['bld-guard-post', 'iki-guard-post'],
      'shrine':         ['bld-shrine', 'iki-shrine', 'iki-spirit-shrine'],
      'watchtower':     ['bld-watchtower', 'iki-watchtower'],
      'cottage':        ['bld-cottage', 'mw-cottage', 'iki-cottage', 'iki-ger-cottage'],
      'smithy':         ['bld-smithy', 'iki-smithy', 'iki-ger-smithy'],
      'farmstead':      ['bld-farmstead', 'iki-farmstead'],
      'longhouse':      ['bld-longhouse', 'mw-longhouse', 'iki-longhouse', 'iki-clan-lodge'],
      'market-hall':    ['mw-market-hall', 'iki-market-hall'],
      'dwelling':       ['mw-dwelling', 'iki-ger-dwelling'],
      'smokehouse':     ['mw-smokehouse', 'iki-smokehouse'],
      'workshop':       ['mw-workshop'],
      'shelter-hut':    ['iki-shelter-hut', 'iki-yurt-small'],
      'merchant-stall': ['iki-merchant-stall'],
      'tavern':         ['iki-tavern'],
      'warehouse':      ['iki-warehouse'],
      'stables':        ['iki-stables'],
      'sawmill':        ['iki-sawmill'],
      'granary':        ['iki-granary'],
      'temple':         ['iki-temple'],
      'root-cellar':    ['iki-root-cellar'],
      'barracks':       ['iki-barracks'],
      'town-hall':      ['iki-town-hall'],
      'inn':            ['iki-inn'],
      'brewery':        ['iki-brewery'],
      'barn':           ['iki-barn'],
      'armory':         ['iki-armory'],
      'palisade-gate':  ['iki-palisade-gate'],
    };
    return map[buildingId] ?? [];
  }
}
