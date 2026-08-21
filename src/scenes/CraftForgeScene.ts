import * as Phaser from 'phaser';
import {
  CraftState, cfTitle,
  CF_CATS, CF_CONCEPTS, CF_ITEMS, CF_RECIPES, CF_PROCS, CF_LOCKED_PROCS, CF_REFINE_BAYS,
  CF_STATIONS, CF_LOCS, CF_TRAY_POOL, CF_REAL_DISCOVERIES, CF_FALSE_DISCOVERIES,
  type CFConcept, type CFRecipe, type CFDiscovery, type CFPoolEntry,
} from './craftForgeData';

/**
 * CraftForgeScene — standalone testbed for the redesigned crafting + knowledge UI.
 *
 * A four-tab "Tech-Rune" workbench (⌬ Mind · ✦ Concepts · ⚒ Recipes · ♨ Refine)
 * ported from the Claude design-tool mockups. Deliberately SEPARATE from the
 * shipped CraftingMenuScene so the new look can be evaluated in-engine without
 * touching the existing prototype. Route: /craftforge (alias /cf).
 *
 * ## Layout strategy
 * The mockups are authored at a fixed 1024×640. Rather than re-flow every widget
 * for the RESIZE canvas, we draw everything into a single "design canvas"
 * container (this.root) at 1024×640 and scale-to-fit + centre it in the viewport.
 * One number (the fit scale) handles all responsiveness.
 *
 * ## Render model — immediate mode
 * Every tab is a pure function of state: renderAll() clears the root and redraws
 * the header + active tab from `this.st` (+ per-tab UI state). Interaction
 * handlers just mutate state and call renderAll(). This mirrors the reactive
 * mockups without needing a diffing framework, and keeps each screen readable.
 */

// ── Design-canvas constants ──────────────────────────────────────────────────
const DW = 1024;      // design width
const DH = 640;       // design height
const HEADER_H = 48;

const PIXEL = '"Silkscreen", monospace';   // headings / labels (loaded in index.html)
const BODY = '"Chakra Petch", sans-serif'; // body copy

// Tech-Rune palette (mirrors src/ui/theme.ts, as 0x numbers + #hex where needed)
const C = {
  bg: 0x0d0e1a, header: 0x10111f, panel: 0x1a1c2e, sub: 0x151628, subDark: 0x141522,
  border: 0x2a2c3e, border2: 0x33344a, teal: 0x4dd4f0, gold: 0xffe066, amber: 0xc8922a,
  ink: 0xf0f0e8, dim: 0x9090a8, faint: 0x606078, green: 0x88ff88, warn: 0xffaa33, danger: 0xff4444,
};
const H = {
  ink: '#f0f0e8', dim: '#9090a8', faint: '#606078', gold: '#ffe066', teal: '#4dd4f0',
  amber: '#c8922a', green: '#88ff88', warn: '#ffaa33', danger: '#ff4444', white: '#c0c0d0',
};

type TabId = 'mind' | 'concepts' | 'recipes' | 'refine';
interface Job { bay: number; rid: string; batch: number; t0: number; dur: number; }

export class CraftForgeScene extends Phaser.Scene {
  private st = new CraftState();
  private root!: Phaser.GameObjects.Container;   // the 1024×640 design canvas
  private fx!: Phaser.GameObjects.Graphics;      // full-viewport scanline/vignette overlay
  /** Text render resolution — matched to the fit-scale × DPR so glyphs stay
   *  crisp when the design canvas is upscaled (see layout()). */
  private textRes = 2;

  // UI state ------------------------------------------------------------------
  private tab: TabId = 'mind';
  // recipes
  private rFilter = 'all';
  private rSel = CF_RECIPES[0]?.id ?? '';
  private rView: 'list' | 'forge' = 'list';
  private forgeId = CF_RECIPES[0]?.id ?? '';
  private rScroll = 0;
  // mind
  private mSel: string | null = null;
  private mFilter: 'all' | 'concept' | 'material' | 'recipe' = 'all';
  private mCard: (CFDiscovery & { real: boolean }) | null = null;
  private mResting = false;
  private realIdx = 0;
  private falseIdx = 0;
  // concepts
  private cFilter = 'all';
  private cSel = 'inscription';
  // refine
  private jobs: Job[] = [];
  private log: { n: number; name: string }[] = [];
  private lastRefineTick = 0;

  constructor() { super('CraftForgeScene'); }

  create(): void {
    this.cameras.main.setBackgroundColor(C.bg);
    this.root = this.add.container(0, 0);
    this.fx = this.add.graphics().setDepth(1000);

    this.layout();
    this.renderAll();

    this.scale.on('resize', this.onResize, this);
    this.input.keyboard?.on('keydown-ESC', () => this.toMenu());
    // Mouse-wheel scrolls the recipe list (touch users get the ▲/▼ buttons).
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.tab !== 'recipes' || this.rView !== 'list') return;
      this.rScroll = Math.max(0, this.rScroll + (dy > 0 ? 1 : -1));
      this.renderAll();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.onResize, this));
  }

  /** Return to the main menu — a no-op in the standalone /crafting.html entry
   *  where MainMenuScene isn't registered. */
  private toMenu(): void {
    if (this.scene.get('MainMenuScene')) this.scene.start('MainMenuScene');
  }

  update(time: number): void {
    // Refinery bays run on timers — refresh ~5×/sec while that tab is open and busy.
    if (this.tab === 'refine' && this.jobs.length && time - this.lastRefineTick > 200) {
      this.lastRefineTick = time;
      this.renderAll();
    }
  }

  /** Fit the fixed 1024×640 canvas into the current viewport and repaint FX. */
  private layout(): void {
    const vw = this.scale.width, vh = this.scale.height;
    const s = Math.min(vw / DW, vh / DH);
    this.root.setScale(s).setPosition((vw - DW * s) / 2, (vh - DH * s) / 2);
    // Render glyph textures at (upscale × device-pixel-ratio) so text stays sharp
    // when the canvas is blown up to fill the screen. Capped to keep textures sane.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.textRes = Math.min(4, Math.max(2, s * dpr));

    this.fx.clear();
    this.fx.fillStyle(0x000000, 1).fillRect(0, 0, vw, vh);                 // letterbox
    // (re-fill the design area so the letterbox doesn't cover the canvas)
    this.fx.fillStyle(C.bg, 1).fillRect((vw - DW * s) / 2, (vh - DH * s) / 2, DW * s, DH * s);
    // subtle scanlines over the whole viewport
    this.fx.fillStyle(0x000000, 0.16);
    for (let y = 0; y < vh; y += 3) this.fx.fillRect(0, y, vw, 1);
    this.fx.setDepth(-1); // behind the root content
  }

  /** Re-fit and repaint on viewport resize (repaint so text picks up the new
   *  resolution — a pure rescale would leave old glyph textures blurry). */
  private onResize(): void {
    this.layout();
    this.renderAll();
  }

  // ── Drawing helpers ────────────────────────────────────────────────────────
  private rr(cx: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, r: number,
             fill?: number, fillA = 1, stroke?: number, sw = 1, strokeA = 1): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    if (fill != null) { g.fillStyle(fill, fillA); g.fillRoundedRect(x, y, w, h, r); }
    if (stroke != null) { g.lineStyle(sw, stroke, strokeA); g.strokeRoundedRect(x, y, w, h, r); }
    cx.add(g); return g;
  }
  private t(cx: Phaser.GameObjects.Container, x: number, y: number, s: string,
            opts: { size?: number; color?: string; pixel?: boolean; bold?: boolean; origin?: number; ox?: number; oy?: number; wrap?: number } = {})
            : Phaser.GameObjects.Text {
    const txt = this.add.text(x, y, s, {
      fontFamily: opts.pixel ? PIXEL : BODY,
      fontSize: `${opts.size ?? 12}px`,
      color: opts.color ?? H.ink,
      fontStyle: opts.bold ? 'bold' : 'normal',
      ...(opts.wrap ? { wordWrap: { width: opts.wrap } } : {}),
    });
    txt.setOrigin(opts.ox ?? opts.origin ?? 0, opts.oy ?? opts.origin ?? 0);
    txt.setResolution(this.textRes);   // render the glyph texture crisp for the current upscale
    cx.add(txt); return txt;
  }
  private hit(cx: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, cb: () => void): void {
    const z = this.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    z.on('pointerdown', cb);
    cx.add(z);
  }
  /** Small filled arrowhead at (x2,y2) pointing along (x1,y1)->(x2,y2). */
  private arrow(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number, alpha: number): void {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    g.fillStyle(color, alpha);
    g.fillTriangle(x2, y2, x2 - ux * 9 - uy * 5, y2 - uy * 9 + ux * 5, x2 - ux * 9 + uy * 5, y2 - uy * 9 - ux * 5);
  }

  // ── Top-level render ────────────────────────────────────────────────────────
  private renderAll(): void {
    this.root.removeAll(true);
    this.rr(this.root, 0, 0, DW, DH, 0, C.bg, 1);
    this.drawHeader();
    if (this.tab === 'mind') this.drawMind();
    else if (this.tab === 'concepts') this.drawConcepts();
    else if (this.tab === 'recipes') this.rView === 'forge' ? this.drawForge() : this.drawRecipes();
    else this.drawRefine();
    // vignette on top of the canvas (non-interactive)
    const v = this.add.graphics();
    v.fillStyle(0x000000, 0.28);
    v.fillRect(0, 0, DW, 3); v.fillRect(0, DH - 3, DW, 3);
    this.root.add(v);
  }

  private drawHeader(): void {
    const cx = this.root;
    this.rr(cx, 0, 0, DW, HEADER_H, 0, C.header, 1);
    this.rr(cx, 0, HEADER_H - 1, DW, 1, 0, C.border, 1);
    this.t(cx, 16, 15, '⚒ CRAFT-FORGE', { pixel: true, size: 16, color: H.gold });

    const tabs: [TabId, string, number][] = [
      ['mind', '⌬ MIND', C.teal], ['concepts', '✦ CONCEPTS', C.green],
      ['recipes', '⚒ RECIPES', C.amber], ['refine', '♨ REFINE', C.warn],
    ];
    let x = 200;
    for (const [id, label, col] of tabs) {
      const on = this.tab === id;
      const w = 128;
      this.rr(cx, x, 10, w, 28, 6, on ? col : C.subDark, on ? 0.14 : 1, on ? col : C.border, 1);
      this.t(cx, x + w / 2, 24, label, { pixel: true, size: 8, color: on ? H.ink : H.dim, ox: 0.5, oy: 0.5 });
      this.hit(cx, x, 10, w, 28, () => { this.tab = id; this.rView = 'list'; this.renderAll(); });
      x += w + 6;
    }
    this.t(cx, DW - 16, 24, 'ESC · MENU', { pixel: true, size: 7, color: H.faint, ox: 1, oy: 0.5 });
    this.hit(cx, DW - 90, 12, 74, 24, () => this.toMenu());
  }

  // ── RECIPES tab ─────────────────────────────────────────────────────────────
  private stnLabel(r: CFRecipe): string { return `${CF_STATIONS[r.station] ?? r.station.toUpperCase()} · T${r.tier}`; }
  private loc() { return CF_LOCS[this.st.atIdx]; }
  private stationOk(r: CFRecipe): boolean { const l = this.loc(); return l.id === r.station && r.tier <= l.tier; }
  private matsOk(r: CFRecipe): boolean { return r.inputs.every(([id, n]) => (this.st.inv[id] || 0) >= n); }
  private unmet(r: CFRecipe): string | null {
    const g = r.concepts.find(([id, lv]) => this.st.rank(id) < lv);
    return g ? `${this.st.concept(g[0])?.name ?? cfTitle(g[0])} ${g[1]}` : null;
  }
  private recipe(id: string): CFRecipe | undefined { return CF_RECIPES.find(r => r.id === id); }

  private drawRecipes(): void {
    const cx = this.root;
    const y0 = HEADER_H + 10;
    // "AT" (current station) — cycles through every real station.
    this.t(cx, DW - 16, y0 + 17, `◈ AT: ${this.loc().label}`, { pixel: true, size: 8, color: H.teal, ox: 1, oy: 0.5 });
    this.hit(cx, DW - 200, y0, 184, 34, () => { this.st.atIdx = (this.st.atIdx + 1) % CF_LOCS.length; this.renderAll(); });

    // Station filter chips — data-driven from the real station set, wrapping to
    // multiple rows so every one of the 12 stations is reachable.
    const chips: [string, string][] = [['all', 'ALL'], ...Object.entries(CF_STATIONS).map(([id, l]) => [id, l] as [string, string])];
    let cxp = 16, cy = y0;
    for (const [id, label] of chips) {
      const on = this.rFilter === id, w = 14 + label.length * 7;
      const rightLimit = cy === y0 ? DW - 210 : DW - 16;   // keep row 0 clear of the AT toggle
      if (cxp + w > rightLimit) { cxp = 16; cy += 40; }
      this.rr(cx, cxp, cy, w, 34, 8, on ? C.gold : C.subDark, on ? 0.1 : 1, on ? C.gold : C.border, 1);
      this.t(cx, cxp + w / 2, cy + 17, label, { pixel: true, size: 7.5, color: on ? H.gold : H.white, ox: 0.5, oy: 0.5 });
      this.hit(cx, cxp, cy, w, 34, () => { this.rFilter = id; this.rScroll = 0; this.renderAll(); });
      cxp += w + 6;
    }

    // Recipe list (left) — windowed + scrollable so every recipe is reachable.
    const listX = 16, listY = cy + 44, listW = 584, rowH = 40, area = DH - listY - 12;
    const rows = CF_RECIPES.filter(r => this.rFilter === 'all' || r.station === this.rFilter);
    const maxRows = Math.floor(area / (rowH + 6)) - 1;   // reserve a row for the scroll bar
    const maxScroll = Math.max(0, rows.length - maxRows);
    if (this.rScroll > maxScroll) this.rScroll = maxScroll;
    let ry = listY;
    for (const r of rows.slice(this.rScroll, this.rScroll + maxRows)) {
      const ok = this.matsOk(r) && !this.unmet(r);
      const sel = this.rSel === r.id;
      this.rr(cx, listX, ry, listW, rowH, 10, C.sub, 1, sel ? C.gold : C.border, sel ? 2 : 1);
      const dot = this.add.graphics(); dot.fillStyle(ok ? C.green : C.warn, 1); dot.fillCircle(listX + 18, ry + rowH / 2, 5); cx.add(dot);
      this.t(cx, listX + 34, ry + 8, CF_ITEMS[r.id].name, { size: 14, bold: true });
      this.t(cx, listX + 34, ry + 25, this.stnLabel(r), { pixel: true, size: 7, color: H.dim });
      const tag = ok ? 'READY' : this.unmet(r) ? 'LOCKED' : 'MISSING MATS';
      this.t(cx, listX + listW - 12, ry + rowH / 2, tag, { pixel: true, size: 7, color: ok ? H.green : this.unmet(r) ? H.amber : H.warn, ox: 1, oy: 0.5 });
      const rid = r.id;
      this.hit(cx, listX, ry, listW, rowH, () => { this.rSel = rid; this.renderAll(); });
      ry += rowH + 6;
    }
    // Scroll bar: "X–Y of N" + ▲/▼ (touch/click); mouse wheel also scrolls.
    if (rows.length > maxRows) {
      const from = this.rScroll + 1, to = Math.min(this.rScroll + maxRows, rows.length);
      this.t(cx, listX, ry + 5, `${from}–${to} of ${rows.length}  ·  scroll / ▲ ▼`, { size: 10, color: H.faint });
      const bw = 34, upX = listX + listW - bw * 2 - 6, dnX = listX + listW - bw;
      const canUp = this.rScroll > 0, canDn = this.rScroll < maxScroll;
      this.rr(cx, upX, ry, bw, 24, 6, C.subDark, 1, canUp ? C.teal : C.border2, 1);
      this.t(cx, upX + bw / 2, ry + 12, '▲', { size: 11, color: canUp ? H.teal : H.faint, ox: 0.5, oy: 0.5 });
      if (canUp) this.hit(cx, upX, ry, bw, 24, () => { this.rScroll = Math.max(0, this.rScroll - maxRows); this.renderAll(); });
      this.rr(cx, dnX, ry, bw, 24, 6, C.subDark, 1, canDn ? C.teal : C.border2, 1);
      this.t(cx, dnX + bw / 2, ry + 12, '▼', { size: 11, color: canDn ? H.teal : H.faint, ox: 0.5, oy: 0.5 });
      if (canDn) this.hit(cx, dnX, ry, bw, 24, () => { this.rScroll = Math.min(maxScroll, this.rScroll + maxRows); this.renderAll(); });
    }

    // Detail (right)
    this.drawRecipeDetail(616, listY, 392, DH - listY - 12);
  }

  private drawRecipeDetail(x: number, y: number, w: number, h: number): void {
    const cx = this.root;
    this.rr(cx, x, y, w, h, 12, C.panel, 1, C.border, 1);
    const r = this.recipe(this.rSel);
    const pad = 16;
    if (r) {
      const stOk = this.stationOk(r), lock = this.unmet(r);
      this.t(cx, x + pad, y + pad, CF_ITEMS[r.id].name, { pixel: true, size: 16 });
      this.t(cx, x + pad, y + pad + 24, `${this.stnLabel(r)} ${stOk ? '— YOU ARE HERE' : '— TRAVEL THERE'}`, { pixel: true, size: 7, color: stOk ? H.green : H.warn });
      this.t(cx, x + pad, y + pad + 38, `ORIGIN — ${r.origin}`, { pixel: true, size: 6.5, color: H.faint });
      let yy = y + pad + 62;
      this.t(cx, x + pad, yy, 'INGREDIENTS', { pixel: true, size: 7.5, color: H.dim }); yy += 16;
      for (const [id, n] of r.inputs) {
        const have = this.st.inv[id] || 0, good = have >= n;
        this.rr(cx, x + pad, yy, w - pad * 2, 32, 8, C.sub, 1, 0x23243a, 1);
        this.t(cx, x + pad + 10, yy + 16, good ? '✓' : '✗', { size: 13, color: good ? H.green : H.danger, oy: 0.5 });
        this.t(cx, x + pad + 30, yy + 16, `${CF_ITEMS[id]?.name ?? cfTitle(id)}  ×${n}`, { size: 13, oy: 0.5 });
        this.t(cx, x + w - pad - 10, yy + 16, `HAVE ${have}`, { pixel: true, size: 7.5, color: good ? H.green : H.danger, ox: 1, oy: 0.5 });
        yy += 38;
      }
      this.rr(cx, x + pad, yy, w - pad * 2, 32, 8, C.amber, 0.06, C.amber, 1, 0.35);
      this.t(cx, x + pad + 10, yy + 16, '→', { size: 13, color: H.gold, oy: 0.5 });
      this.t(cx, x + pad + 30, yy + 16, `${CF_ITEMS[r.id].name}  ×${r.outN}`, { size: 13, bold: true, oy: 0.5 });
      this.t(cx, x + w - pad - 10, yy + 16, 'OUTPUT', { pixel: true, size: 7, color: H.amber, ox: 1, oy: 0.5 });
      yy += 44;
      this.t(cx, x + pad, yy, 'CONCEPTS', { pixel: true, size: 7.5, color: H.dim }); yy += 16;
      let ccx = x + pad;
      for (const [id, lv] of r.concepts) {
        const know = this.st.rank(id) >= lv, label = `${know ? '' : '🔒 '}${(this.st.concept(id)?.name ?? cfTitle(id)).toUpperCase()} ${lv}`;
        const cw = 16 + label.length * 6.2;
        this.rr(cx, ccx, yy, cw, 26, 13, know ? C.teal : C.amber, know ? 0.05 : 0.07, know ? C.teal : C.amber, 1);
        this.t(cx, ccx + cw / 2, yy + 13, label, { pixel: true, size: 6.5, color: know ? H.teal : H.amber, ox: 0.5, oy: 0.5 });
        ccx += cw + 6;
      }
      yy += 34;
      if (lock) {
        this.rr(cx, x + pad, yy, w - pad * 2, 34, 8, C.amber, 0.08, C.amber, 1);
        this.t(cx, x + pad + 12, yy + 17, `🔒 REQUIRES ${lock.toUpperCase()}`, { pixel: true, size: 8, color: H.gold, oy: 0.5 });
      }
      // Buttons pinned near the bottom
      const by = y + h - 16 - 54;
      const ok = this.matsOk(r) && !lock && stOk;
      this.rr(cx, x + pad, by, 220, 54, 10, ok ? C.gold : C.border2, ok ? 0.14 : 1, ok ? C.gold : C.border2, 2);
      this.t(cx, x + pad + 110, by + (ok ? 27 : 20), ok ? '⚒ CRAFT' : 'CRAFT', { pixel: true, size: 12, color: ok ? H.gold : H.faint, ox: 0.5, oy: 0.5 });
      if (!ok) this.t(cx, x + pad + 110, by + 38, lock ? 'CONCEPT LOCKED' : !stOk ? 'GO TO ' + (CF_STATIONS[r.station] ?? r.station) : 'MISSING MATERIALS', { pixel: true, size: 6, color: lock ? H.amber : !stOk ? H.teal : H.danger, ox: 0.5, oy: 0.5 });
      if (ok) this.hit(cx, x + pad, by, 220, 54, () => this.craft(r));
      const fx = x + pad + 232, fw = w - pad * 2 - 232;
      this.rr(cx, fx, by, fw, 54, 10, C.teal, 0.06, C.teal, 2, 0.55);
      this.t(cx, fx + fw / 2, by + 27, '⛓ FORGE', { pixel: true, size: 10, color: H.teal, ox: 0.5, oy: 0.5 });
      this.hit(cx, fx, by, fw, 54, () => { this.rView = 'forge'; this.forgeId = r.id; this.renderAll(); });
    }
  }

  private craft(r: CFRecipe): void {
    const delta: Record<string, number> = { [r.id]: r.outN };
    for (const [id, n] of r.inputs) delta[id] = (delta[id] || 0) - n;
    this.st.invAdd(delta);
    this.renderAll();
  }

  // ── FORGE (dependency pipeline) view ─────────────────────────────────────────
  private depth(id: string): number { const r = this.recipe(id); return r ? 1 + Math.max(...r.inputs.map(([i]) => this.depth(i))) : 0; }

  private drawForge(): void {
    const cx = this.root;
    const target = this.forgeId;
    this.rr(cx, 16, HEADER_H + 10, 160, 40, 8, C.subDark, 1, C.border, 1);
    this.t(cx, 96, HEADER_H + 30, '◀ RECIPES', { pixel: true, size: 8, color: H.white, ox: 0.5, oy: 0.5 });
    this.hit(cx, 16, HEADER_H + 10, 160, 40, () => { this.rView = 'list'; this.renderAll(); });
    this.t(cx, 190, HEADER_H + 22, `FORGE — ${CF_ITEMS[target].name.toUpperCase()}`, { pixel: true, size: 12, color: H.gold });
    this.t(cx, 190, HEADER_H + 38, `TARGET · ${this.stnLabel(this.recipe(target)!)}`, { pixel: true, size: 6.5, color: H.dim });

    // Build the dependency graph (leaf-first counts) — ported from the mockup.
    const INV = this.st.inv;
    const need: Record<string, number> = {}, crafts: Record<string, number> = {}, depths: Record<string, number> = {};
    const all = new Set<string>();
    const collect = (id: string): void => { if (all.has(id)) return; all.add(id); depths[id] = this.depth(id); const r = this.recipe(id); if (r) r.inputs.forEach(([i]) => collect(i)); };
    collect(target);
    const ids = [...all].sort((a, b) => depths[b] - depths[a]);
    ids.forEach(id => { need[id] = 0; });
    need[target] = 1;
    ids.forEach(id => {
      const r = this.recipe(id); if (!r) return;
      const short = Math.max(0, need[id] - (id === target ? 0 : (INV[id] || 0)));
      const c = Math.ceil(short / r.outN); crafts[id] = c;
      if (c > 0) r.inputs.forEach(([i, n]) => { need[i] = (need[i] || 0) + c * n; });
    });
    const maxD = depths[target];
    const colRows: Record<number, number> = {};
    const pos: Record<string, { x: number; y: number }> = {};
    // Columns shrink to fit the left area so deep chains never slide under the
    // summary panel (which starts at x=688).
    const panelX = 16, panelY = HEADER_H + 58, nodeH = 82;
    const availW = 688 - panelX - 24;
    const colW = Math.min(210, Math.floor(availW / (maxD + 1)));
    const nodeW = Math.max(118, colW - 18);
    interface FNode { id: string; x: number; y: number; bc: number; bg: number; tag: string; have: number; need: number; }
    const fnodes: FNode[] = [];
    for (const id of ids) {
      if (!(need[id] > 0 || id === target)) continue;
      const d = depths[id]; const row = (colRows[d] = (colRows[d] || 0)); colRows[d] = row + 1;
      const x = panelX + 12 + d * colW, y = panelY + 34 + row * 96;
      pos[id] = { x, y };
      const r = this.recipe(id), have = INV[id] || 0, nd = need[id], lock = r ? this.unmet(r) : null;
      let bc = C.border2, bg = C.subDark, tag = 'BLOCKED';
      if (!r) { if (have >= nd) { bc = C.green; bg = 0x122016; tag = 'READY'; } else { bc = C.danger; bg = 0x201014; tag = `SHORT ${nd - have}`; } }
      else if (have >= nd && id !== target) { bc = C.green; bg = 0x122016; tag = 'READY'; }
      else if (lock) { bc = C.border2; bg = C.subDark; tag = '🔒 LOCKED'; }
      else if (r.inputs.every(([i, n]) => (INV[i] || 0) >= n)) { bc = C.warn; bg = 0x2a2113; tag = 'CRAFT NOW'; }
      fnodes.push({ id, x, y, bc, bg, tag, have, need: nd });
    }
    // edges first (under nodes)
    const g = this.add.graphics(); cx.add(g);
    for (const n of fnodes) {
      const r = this.recipe(n.id); if (!r) continue;
      for (const [i] of r.inputs) {
        const a = pos[i], b = pos[n.id]; if (!a || !b) continue;
        const x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x, y2 = b.y + nodeH / 2;
        const src = fnodes.find(m => m.id === i); const col = src ? src.bc : C.faint;
        g.lineStyle(2, col, 0.5); g.lineBetween(x1, y1, x2 - 2, y2);
        this.arrow(g, x1, y1, x2, y2, col, 0.7);
      }
    }
    // column labels + nodes
    const label = (d: number) => d === 0 ? 'RAW' : d === maxD ? 'FINAL' : d === 1 ? 'REFINED' : d === 2 ? 'COMPONENT' : 'ASSEMBLY';
    for (let d = 0; d <= maxD; d++) if (colRows[d]) this.t(cx, panelX + 12 + d * colW + nodeW / 2, panelY + 8, label(d), { pixel: true, size: 7, color: H.faint, ox: 0.5 });
    for (const n of fnodes) {
      this.rr(cx, n.x, n.y, nodeW, nodeH, 10, n.bg, 1, n.bc, 2);
      this.t(cx, n.x + 10, n.y + 8, CF_ITEMS[n.id].name, { size: 12.5, bold: true });
      const r = this.recipe(n.id);
      this.t(cx, n.x + 10, n.y + 26, r ? this.stnLabel(r) : 'GATHERED IN THE WORLD', { pixel: true, size: 6, color: H.dim });
      this.t(cx, n.x + 10, n.y + nodeH - 14, `HAVE ${n.have} · NEED ${n.need}`, { pixel: true, size: 7, color: n.have >= n.need ? H.green : H.warn });
      this.t(cx, n.x + nodeW - 10, n.y + nodeH - 14, n.tag, { pixel: true, size: 6, color: `#${n.bc.toString(16).padStart(6, '0')}`, ox: 1 });
    }

    // Summary panel (right)
    const sx = 688, sy = HEADER_H + 58, sw = DW - sx - 16, sh = DH - sy - 12;
    this.rr(cx, sx, sy, sw, sh, 12, C.panel, 1, C.border, 1);
    const raws = fnodes.filter(n => !this.recipe(n.id));
    let yy = sy + 14;
    this.t(cx, sx + 14, yy, 'RAW MATERIALS', { pixel: true, size: 8, color: H.teal }); yy += 18;
    for (const rw of raws) {
      this.rr(cx, sx + 14, yy, sw - 28, 30, 8, C.sub, 1, 0x23243a, 1);
      this.t(cx, sx + 24, yy + 15, CF_ITEMS[rw.id].name, { size: 12, oy: 0.5 });
      this.t(cx, sx + sw - 24, yy + 15, `${rw.have}/${rw.need}`, { pixel: true, size: 7, color: rw.have >= rw.need ? H.green : H.danger, ox: 1, oy: 0.5 });
      yy += 36;
    }
    yy += 6;
    const chain = fnodes.filter(n => crafts[n.id] > 0);
    const steps = chain.reduce((s, n) => s + crafts[n.id], 0);
    this.t(cx, sx + 14, yy, `${steps}`, { pixel: true, size: 14, color: H.gold }); this.t(cx, sx + 44, yy + 4, 'CRAFT STEPS', { pixel: true, size: 7, color: H.dim }); yy += 22;
    this.t(cx, sx + 14, yy, `${chain.length}`, { pixel: true, size: 14, color: H.teal }); this.t(cx, sx + 44, yy + 4, 'RECIPES IN CHAIN', { pixel: true, size: 7, color: H.dim }); yy += 26;
    const avail = fnodes.filter(n => n.tag === 'CRAFT NOW').length;
    const by = sy + sh - 16 - 52;
    if (avail > 0) {
      this.rr(cx, sx + 14, by, sw - 28, 52, 10, C.gold, 0.14, C.gold, 2);
      this.t(cx, sx + sw / 2, by + 20, `CRAFT AVAILABLE (${avail})`, { pixel: true, size: 10, color: H.gold, ox: 0.5, oy: 0.5 });
      this.t(cx, sx + sw / 2, by + 38, 'RUNS EVERY READY STEP ONCE', { pixel: true, size: 6, color: H.amber, ox: 0.5, oy: 0.5 });
      this.hit(cx, sx + 14, by, sw - 28, 52, () => {
        for (const n of fnodes.filter(fn => fn.tag === 'CRAFT NOW')) {
          const r = this.recipe(n.id)!; const delta: Record<string, number> = { [r.id]: r.outN };
          r.inputs.forEach(([i, nn]) => { delta[i] = (delta[i] || 0) - nn; });
          this.st.invAdd(delta);
        }
        this.renderAll();
      });
    } else {
      this.rr(cx, sx + 14, by, sw - 28, 52, 10, C.subDark, 1, C.border2, 2);
      this.t(cx, sx + sw / 2, by + 26, 'NOTHING READY', { pixel: true, size: 9, color: H.faint, ox: 0.5, oy: 0.5 });
    }
  }

  // ── MIND (Tinker Tray) tab ───────────────────────────────────────────────────
  private poolView(e: CFPoolEntry): { id: string; name: string; sub: string; glyph: string; color: number } {
    if (e.kind === 'concept') {
      const c = this.st.concept(e.ref)!, cat = this.st.cat(c.category)!, r = this.st.rank(c.id);
      return { id: e.id, name: c.name, sub: `${cat.name.toUpperCase()} · ${r > 0 ? 'R' + r : 'NEW'}`, glyph: '◈', color: cat.color };
    }
    if (e.kind === 'material') return { id: e.id, name: CF_ITEMS[e.ref].name, sub: 'MATERIAL', glyph: '▣', color: 0xb08050 };
    return { id: e.id, name: CF_ITEMS[e.ref].name, sub: 'KNOWN RECIPE', glyph: '✦', color: 0xffd45c };
  }
  private entry(id: string): CFPoolEntry | undefined { return CF_TRAY_POOL.find(p => p.id === id); }
  private mix(): { sig: number; noi: number } {
    const W = [[1, 0], [0.7, 0.1], [0.3, 0.5], [0.15, 0.75], [0.05, 0.95]];
    let sig = 0, noi = 0;
    this.st.tray.forEach((id, i) => { if (id) { sig += W[i][0]; noi += W[i][1]; } });
    return { sig, noi };
  }

  private drawMind(): void {
    const cx = this.root;
    const slotDefs = [
      { label: 'PRIMARY FOCUS', sub: 'STRONG · FAST', col: C.gold, chex: H.gold },
      { label: 'SECONDARY FOCUS', sub: 'GOOD INSIGHT', col: C.teal, chex: H.teal },
      { label: 'BACKGROUND', sub: 'WEAK · ADDS NOISE', col: C.border2, chex: H.dim },
      { label: 'DISTRACTION', sub: 'NOISY · FALSE TRAILS', col: C.warn, chex: H.warn },
      { label: 'OVERLOAD', sub: 'UNRELIABLE · FALSE FREQ.', col: C.danger, chex: H.danger },
    ];
    const sx = 16, sw = 600, sy0 = HEADER_H + 12, slotH = 62, gap = 8;
    for (let i = 0; i < 5; i++) {
      const y = sy0 + i * (slotH + gap), d = slotDefs[i];
      const alpha = i < 2 ? 1 : i === 2 ? 0.82 : i === 3 ? 0.68 : 0.55;
      const holder = this.add.container(0, 0); holder.setAlpha(alpha); cx.add(holder);
      this.rr(holder, sx, y, sw, slotH, 10, i < 2 ? d.col : C.subDark, i < 2 ? 0.08 : 1, d.col, 2, i < 2 ? 1 : 0.5);
      this.t(holder, sx + 14, y + slotH / 2 - 9, `${i + 1}`, { pixel: true, size: 18, color: d.chex, oy: 0.5 });
      this.t(holder, sx + 40, y + 14, d.label, { pixel: true, size: 9 });
      this.t(holder, sx + 40, y + 34, d.sub, { pixel: true, size: 7.5, color: d.chex });
      const cellX = sx + 150, cellW = sw - 150 - 10;
      const filled = this.st.tray[i];
      if (!filled) {
        this.rr(holder, cellX, y + 12, cellW, slotH - 24, 8, undefined, 1, d.col, 1, 0.4);
        this.t(holder, cellX + cellW / 2, y + slotH / 2, i < 2 ? 'DROP A LEAD HERE' : 'ADDS NOISE — LEAVE EMPTY', { pixel: true, size: 8, color: H.dim, ox: 0.5, oy: 0.5 });
        const idx = i;
        this.hit(holder, cellX, y + 12, cellW, slotH - 24, () => this.placeSel(idx));
      } else {
        const v = this.poolView(this.entry(filled)!);
        const sel = this.mSel === filled;
        this.rr(holder, cellX, y + 9, cellW, slotH - 18, 8, C.sub, 1, sel ? C.gold : v.color, sel ? 3 : 2);
        this.t(holder, cellX + 14, y + slotH / 2, v.glyph, { size: 15, color: `#${v.color.toString(16).padStart(6, '0')}`, oy: 0.5 });
        this.t(holder, cellX + 34, y + slotH / 2 - 8, v.name, { size: 13, bold: true });
        this.t(holder, cellX + 34, y + slotH / 2 + 8, v.sub, { pixel: true, size: 7, color: H.dim, oy: 0.5 });
        // remove ✕
        this.rr(holder, cellX + cellW - 40, y + slotH / 2 - 16, 32, 32, 6, undefined, 1, C.border, 1);
        this.t(holder, cellX + cellW - 24, y + slotH / 2, '✕', { size: 13, color: H.dim, ox: 0.5, oy: 0.5 });
        const idx = i, fid = filled;
        this.hit(holder, cellX + cellW - 40, y + slotH / 2 - 16, 32, 32, () => { this.st.tray[idx] = null; this.mSel = null; this.renderAll(); });
        this.hit(holder, cellX, y + 9, cellW - 44, slotH - 18, () => { this.mSel = this.mSel === fid ? null : fid; this.renderAll(); });
      }
    }

    // Thought panel (right)
    this.drawThought(628, sy0, DW - 628 - 16, 5 * (slotH + gap) - gap);
    // Available items tray (bottom)
    this.drawTrayPool(sy0 + 5 * (slotH + gap) + 4);
    // Discovery card overlay
    if (this.mCard) this.drawDiscoveryCard();
    if (this.mResting) {
      this.rr(cx, 0, 0, DW, DH, 0, 0x06070e, 0.74);
      this.t(cx, DW / 2, DH / 2, '🌙  RESTING…', { pixel: true, size: 14, color: H.dim, ox: 0.5, oy: 0.5 });
    }
  }

  private drawThought(x: number, y: number, w: number, h: number): void {
    const cx = this.root;
    this.rr(cx, x, y, w, h, 12, C.panel, 1, C.border, 1);
    const p = this.st.mindProgress;
    const { sig, noi } = this.mix(); const any = sig + noi > 0;
    const signalPct = any ? Math.round(sig / (sig + noi) * 100) : 0;
    this.t(cx, x + 14, y + 16, 'THOUGHT', { pixel: true, size: 11, color: H.teal });
    this.t(cx, x + w - 40, y + 12, `${p}`, { pixel: true, size: 24, color: H.gold, ox: 1 });
    this.t(cx, x + w - 14, y + 20, '%', { pixel: true, size: 12, color: H.teal, ox: 1 });
    // progress bar
    this.rr(cx, x + 14, y + 46, w - 28, 18, 9, C.bg, 1, C.border, 1);
    if (p > 0) this.rr(cx, x + 15, y + 47, (w - 30) * p / 100, 16, 8, C.teal, 1);
    // signal/noise
    this.t(cx, x + 14, y + 76, `SIGNAL ${signalPct}%`, { pixel: true, size: 8, color: H.green });
    this.t(cx, x + w - 14, y + 76, `NOISE ${any ? 100 - signalPct : 0}%`, { pixel: true, size: 8, color: H.warn, ox: 1 });
    this.rr(cx, x + 14, y + 92, w - 28, 8, 4, C.bg, 1, C.border, 1);
    if (any) this.rr(cx, x + 15, y + 93, (w - 30) * signalPct / 100, 6, 3, C.green, 0.85);
    const hint = this.mCard ? 'It crystallizes — commit it to memory.' :
      p < 25 ? 'A loose thread of an idea drifts by…' :
      p < 55 ? 'Something’s forming but not quite there…' :
      p < 85 ? 'The shape of it is almost clear now…' : 'One more night’s rest might do it…';
    this.t(cx, x + 14, y + 112, `💭  ${hint}`, { size: 12, color: H.dim, wrap: w - 28 });
    if (any && signalPct < 65) this.t(cx, x + 14, y + 150, '⚠ FOCUS IS SCATTERED — CONCLUSIONS MAY BE FALSE', { pixel: true, size: 7.5, color: H.warn, wrap: w - 28 });
    // REST button
    const by = y + h - 16 - 56;
    this.rr(cx, x + 14, by, w - 28, 56, 10, C.amber, 0.14, C.amber, 2);
    this.t(cx, x + w / 2, by + 28, '🌙  REST', { pixel: true, size: 13, color: H.gold, ox: 0.5, oy: 0.5 });
    this.hit(cx, x + 14, by, w - 28, 56, () => this.rest());
  }

  private drawTrayPool(y: number): void {
    const cx = this.root;
    const h = DH - y - 12;
    this.rr(cx, 16, y, DW - 32, h, 12, 0x12131f, 1, C.border, 1);
    this.t(cx, 28, y + 10, 'TINKER TRAY', { pixel: true, size: 10, color: H.amber });
    this.t(cx, 28, y + 26, 'TAP TO SELECT · TAP A SLOT TO PLACE', { pixel: true, size: 6.5, color: H.faint });
    const chips: [typeof this.mFilter, string][] = [['all', 'ALL'], ['concept', 'CONCEPTS'], ['material', 'MATERIALS'], ['recipe', 'RECIPES']];
    let cxp = DW - 32 - 4;
    for (let i = chips.length - 1; i >= 0; i--) {
      const [id, label] = chips[i]; const w = 20 + label.length * 7; cxp -= w + 6;
      const on = this.mFilter === id;
      this.rr(cx, cxp, y + 8, w, 30, 8, on ? C.gold : C.subDark, on ? 0.08 : 1, on ? C.gold : C.border, 1);
      this.t(cx, cxp + w / 2, y + 23, label, { pixel: true, size: 8, color: on ? H.gold : H.white, ox: 0.5, oy: 0.5 });
      this.hit(cx, cxp, y + 8, w, 30, () => { this.mFilter = id; this.renderAll(); });
    }
    // item chips
    const pool = CF_TRAY_POOL.filter(p => !this.st.tray.includes(p.id) && (this.mFilter === 'all' || p.kind === this.mFilter));
    let ix = 28, iy = y + 48; const rowMax = DW - 44;
    for (const p of pool) {
      const v = this.poolView(p); const cw = 30 + v.name.length * 8; if (ix + cw > rowMax) { ix = 28; iy += 50; }
      if (iy + 44 > y + h) break;
      const sel = this.mSel === p.id;
      this.rr(cx, ix, iy, cw, 44, 8, C.sub, 1, sel ? C.gold : v.color, sel ? 3 : 2);
      this.t(cx, ix + 12, iy + 22, v.glyph, { size: 14, color: `#${v.color.toString(16).padStart(6, '0')}`, oy: 0.5 });
      this.t(cx, ix + 30, iy + 14, v.name, { size: 12.5, bold: true });
      this.t(cx, ix + 30, iy + 30, v.sub, { pixel: true, size: 6.5, color: H.dim });
      const pid = p.id;
      this.hit(cx, ix, iy, cw, 44, () => { this.mSel = this.mSel === pid ? null : pid; this.renderAll(); });
      ix += cw + 8;
    }
  }

  private placeSel(idx: number): void {
    if (!this.mSel) return;
    const cur = this.st.tray.indexOf(this.mSel);
    if (cur >= 0) this.st.tray[cur] = this.st.tray[idx]; // swap out of old slot
    this.st.tray[idx] = this.mSel;
    this.mSel = null;
    this.renderAll();
  }

  private rest(): void {
    if (this.mResting || this.mCard) return;
    const { sig, noi } = this.mix();
    this.mResting = true; this.mSel = null; this.renderAll();
    this.time.delayedCall(700, () => {
      const gain = sig + noi === 0 ? 4 : Math.round(10 + sig * 14);
      const p = this.st.mindProgress + gain;
      if (p >= 100) {
        const noiseFrac = sig + noi === 0 ? 0.5 : noi / (sig + noi);
        const isFalse = Math.random() < noiseFrac;
        this.mCard = isFalse
          ? { ...CF_FALSE_DISCOVERIES[this.falseIdx++ % CF_FALSE_DISCOVERIES.length], real: false }
          : { ...CF_REAL_DISCOVERIES[this.realIdx++ % CF_REAL_DISCOVERIES.length], real: true };
        this.st.mindProgress = 100;
      } else this.st.mindProgress = p;
      this.mResting = false; this.renderAll();
    });
  }

  private drawDiscoveryCard(): void {
    const cx = this.root; const c = this.mCard!;
    this.rr(cx, 0, 0, DW, DH, 0, 0x06080e, 0.78);
    const w = 420, h = 268, x = (DW - w) / 2, y = (DH - h) / 2;
    const accent = c.real ? C.green : 0xb8b83a, ahex = c.real ? H.green : '#b8b83a';
    this.rr(cx, x, y, w, h, 14, 0x121424, 1, accent, 2);
    this.t(cx, x + 22, y + 22, '✨  DISCOVERY', { pixel: true, size: 11, color: ahex });
    this.rr(cx, x + 22, y + 46, w - 44, 1, 0, accent, 0.6);
    this.t(cx, x + 22, y + 56, c.kind, { pixel: true, size: 9, color: H.dim });
    this.t(cx, x + 22, y + 74, c.title, { pixel: true, size: 18, color: H.ink, wrap: w - 44 });
    this.t(cx, x + 22, y + 118, c.desc, { size: 13, color: H.white, wrap: w - 44 });
    const by = y + h - 22 - 50;
    this.rr(cx, x + 22, by, w - 44, 50, 10, accent, 0.1, accent, 2);
    this.t(cx, x + w / 2, by + 25, 'COMMIT TO MEMORY', { pixel: true, size: 11, color: ahex, ox: 0.5, oy: 0.5 });
    this.hit(cx, x + 22, by, w - 44, 50, () => {
      if (c.real && /Capacitor/i.test(c.title)) this.st.discovered.add('capacitor2');
      this.mCard = null; this.st.mindProgress = 9; this.st.insights += 1; this.renderAll();
    });
  }

  // ── CONCEPTS tab ─────────────────────────────────────────────────────────────
  private drawConcepts(): void {
    const cx = this.root;
    // filter chips
    const y0 = HEADER_H + 8;
    let cxp = 16;
    const chips = [{ id: 'all', label: 'ALL', color: C.ink }, ...CF_CATS.map(c => ({ id: c.id, label: c.name.toUpperCase(), color: c.color }))];
    for (const ch of chips) {
      const on = this.cFilter === ch.id, w = 16 + ch.label.length * 6.4;
      this.rr(cx, cxp, y0, w, 30, 8, on ? C.gold : C.subDark, on ? 0.08 : 1, on ? C.gold : C.border, 1);
      const dot = this.add.graphics(); dot.fillStyle(ch.color, 1); dot.fillCircle(cxp + 10, y0 + 15, 4); cx.add(dot);
      this.t(cx, cxp + 18, y0 + 15, ch.label, { pixel: true, size: 6.5, color: on ? H.gold : H.white, oy: 0.5 });
      const cid = ch.id;
      this.hit(cx, cxp, y0, w, 30, () => { this.cFilter = cid; this.renderAll(); });
      cxp += w + 6;
      if (cxp > DW - 120) { cxp = 16; } // (single row is enough at this size; overflow wraps to origin)
    }

    // Node field (left) + detail (right). Compute the mockup's cluster-grid
    // layout, then FIT the whole thing into the field area (no pan needed).
    const fieldX = 16, fieldY = y0 + 40, fieldW = 688, fieldH = DH - fieldY - 12;
    this.rr(cx, fieldX, fieldY, fieldW, fieldH, 12, 0x101120, 1, C.border, 1);

    const CELL = 118, CELLH = 116, HEAD = 30, GAP = 30, MAXW = 1400;
    interface Cluster { cat: typeof CF_CATS[number]; ns: CFConcept[]; cols: number; rows: number; w: number; h: number; x: number; y: number; }
    const clusters: Cluster[] = CF_CATS.map(cat => {
      const ns = CF_CONCEPTS.filter(c => c.category === cat.id).sort((a, b) => (a.requires.length - b.requires.length) || a.name.localeCompare(b.name));
      const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(ns.length)))), rows = Math.ceil(ns.length / cols);
      return { cat, ns, cols, rows, w: cols * CELL + 20, h: rows * CELLH + HEAD + 14, x: 0, y: 0 };
    });
    let lx = GAP, ly = GAP, rowH = 0; const pos: Record<string, { x: number; y: number }> = {};
    for (const cl of clusters) {
      if (lx + cl.w > MAXW) { lx = GAP; ly += rowH + GAP; rowH = 0; }
      cl.x = lx; cl.y = ly; rowH = Math.max(rowH, cl.h);
      cl.ns.forEach((c, i) => { const col = i % cl.cols, row = Math.floor(i / cl.cols); pos[c.id] = { x: cl.x + 10 + col * CELL + CELL / 2, y: cl.y + HEAD + row * CELLH + 40 }; });
      lx += cl.w + GAP;
    }
    const canvasW = Math.max(...clusters.map(c => c.x + c.w)) + GAP;
    const canvasH = ly + rowH + GAP;
    const fit = Math.min((fieldW - 24) / canvasW, (fieldH - 24) / canvasH);
    const ox = fieldX + 12 + ((fieldW - 24) - canvasW * fit) / 2, oy = fieldY + 12 + ((fieldH - 24) - canvasH * fit) / 2;
    const TX = (x: number) => ox + x * fit, TY = (y: number) => oy + y * fit;
    const dim = (cat: string) => this.cFilter !== 'all' && cat !== this.cFilter;

    // cluster backgrounds + labels
    for (const cl of clusters) {
      const faded = dim(cl.cat.id);
      this.rr(cx, TX(cl.x), TY(cl.y), cl.w * fit, cl.h * fit, 12 * fit, cl.cat.color, faded ? 0.03 : 0.05, cl.cat.color, 1, faded ? 0.1 : 0.25);
      this.t(cx, TX(cl.x + 14), TY(cl.y + 12), `${cl.cat.glyph} ${cl.cat.name.toUpperCase()}`, { pixel: true, size: Math.max(6, 8 * fit), color: `#${cl.cat.color.toString(16).padStart(6, '0')}` }).setAlpha(faded ? 0.3 : 1);
    }
    // prerequisite edges
    const g = this.add.graphics(); cx.add(g);
    for (const c of CF_CONCEPTS) for (const q of c.requires) {
      const [srcId, lv] = q.split(':'); const a = pos[srcId], b = pos[c.id]; if (!a || !b) continue;
      const met = this.st.rank(srcId) >= +lv;
      const faded = dim(c.category) && dim(srcId ? (this.st.concept(srcId)?.category ?? '') : '');
      const col = this.st.cat(c.category)!.color, alpha = faded ? 0.05 : met ? 0.7 : 0.2;
      const ax = TX(a.x), ay = TY(a.y), bx = TX(b.x), by = TY(b.y);
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, rad = 30 * fit;
      g.lineStyle(2, col, alpha); g.lineBetween(ax + ux * rad, ay + uy * rad, bx - ux * rad, by - uy * rad);
      if (met) this.arrow(g, ax, ay, bx - ux * rad, by - uy * rad, col, alpha);
    }
    // nodes
    const R = 34 * fit;
    for (const c of CF_CONCEPTS) {
      const p = pos[c.id], cat = this.st.cat(c.category)!, s = this.st.conceptState(c), r = this.st.rank(c.id);
      const faded = dim(c.category);
      const bc = s === 'mastered' ? C.gold : s === 'unlocked' ? cat.color : s === 'available' ? cat.color : C.border2;
      const node = this.add.graphics(); cx.add(node);
      node.fillStyle(0x12131f, 1); node.fillCircle(TX(p.x), TY(p.y), R);
      node.lineStyle(3 * fit, bc, s === 'available' ? 0.6 : 1); node.strokeCircle(TX(p.x), TY(p.y), R);
      if (this.cSel === c.id) { node.lineStyle(2, C.gold, 1); node.strokeCircle(TX(p.x), TY(p.y), R + 5); }
      node.setAlpha(faded ? 0.16 : 1);
      const glyph = s === 'locked' ? '🔒' : cat.glyph;
      this.t(cx, TX(p.x), TY(p.y), glyph, { size: Math.max(10, 20 * fit), color: s === 'locked' ? H.faint : `#${bc.toString(16).padStart(6, '0')}`, ox: 0.5, oy: 0.5 }).setAlpha(faded ? 0.16 : 1);
      this.t(cx, TX(p.x), TY(p.y) + R + 2, c.name.toUpperCase(), { pixel: true, size: Math.max(5, 7 * fit), color: s === 'locked' ? H.faint : H.white, ox: 0.5 }).setAlpha(faded ? 0.16 : 1);
      const pips = '★'.repeat(r) + '☆'.repeat(Math.max(0, c.ranks - r));
      this.t(cx, TX(p.x), TY(p.y) + R + 2 + Math.max(7, 9 * fit), pips, { size: Math.max(6, 9 * fit), color: s === 'mastered' ? H.gold : r === 0 ? '#3f4058' : `#${cat.color.toString(16).padStart(6, '0')}`, ox: 0.5 }).setAlpha(faded ? 0.16 : 1);
      const cid = c.id;
      this.hit(cx, TX(p.x) - R, TY(p.y) - R, R * 2, R * 2 + 24, () => { this.cSel = cid; this.renderAll(); });
    }

    // Detail panel (right)
    this.drawConceptDetail(720, fieldY, DW - 720 - 16, fieldH);
  }

  private drawConceptDetail(x: number, y: number, w: number, h: number): void {
    const cx = this.root;
    this.rr(cx, x, y, w, h, 12, C.panel, 1, C.border, 1);
    const c = this.st.concept(this.cSel)!; const cat = this.st.cat(c.category)!;
    const s = this.st.conceptState(c), r = this.st.rank(c.id);
    const pad = 16; let yy = y + pad;
    const stateHex = s === 'mastered' ? H.gold : s === 'unlocked' ? H.green : s === 'available' ? H.teal : H.faint;
    this.rr(cx, x + pad, yy, 96, 22, 11, undefined, 1, s === 'mastered' ? C.gold : s === 'unlocked' ? C.green : s === 'available' ? C.teal : C.faint, 1);
    this.t(cx, x + pad + 48, yy + 11, s.toUpperCase(), { pixel: true, size: 6.5, color: stateHex, ox: 0.5, oy: 0.5 });
    this.t(cx, x + w - pad, yy + 11, cat.name.toUpperCase(), { pixel: true, size: 7, color: `#${cat.color.toString(16).padStart(6, '0')}`, ox: 1, oy: 0.5 });
    yy += 34;
    this.t(cx, x + pad, yy, c.name.toUpperCase(), { pixel: true, size: 14, wrap: w - pad * 2 }); yy += 30;
    this.t(cx, x + pad, yy, '★'.repeat(r) + '☆'.repeat(Math.max(0, c.ranks - r)), { size: 14, color: s === 'mastered' ? H.gold : r === 0 ? '#3f4058' : `#${cat.color.toString(16).padStart(6, '0')}` });
    this.t(cx, x + pad + 90, yy + 4, `RANK ${r} / ${c.ranks}`, { pixel: true, size: 6.5, color: H.faint }); yy += 26;
    this.t(cx, x + pad, yy, c.description, { size: 12, color: H.dim, wrap: w - pad * 2 }); yy += 70;
    this.t(cx, x + pad, yy, 'REQUIRES', { pixel: true, size: 7.5, color: H.dim }); yy += 16;
    if (!c.requires.length) { this.t(cx, x + pad, yy, 'Nothing — a root principle.', { size: 11.5, color: H.faint }); yy += 22; }
    for (const q of c.requires) {
      const [id, lv] = q.split(':'); const met = this.st.rank(id) >= +lv;
      this.rr(cx, x + pad, yy, w - pad * 2, 28, 8, C.sub, 1, 0x23243a, 1);
      this.t(cx, x + pad + 10, yy + 14, `${this.st.concept(id)?.name ?? cfTitle(id)} · Rank ${lv}`, { size: 12, color: H.white, oy: 0.5 });
      this.t(cx, x + w - pad - 10, yy + 14, met ? 'MET' : `RANK ${this.st.rank(id)}`, { pixel: true, size: 6.5, color: met ? H.green : H.danger, ox: 1, oy: 0.5 });
      yy += 34;
    }
    yy += 4;
    this.t(cx, x + pad, yy, 'UNLOCKS RECIPES', { pixel: true, size: 7.5, color: H.dim }); yy += 16;
    let ux = x + pad;
    for (const u of c.unlocks) {
      const label = cfTitle(u).toUpperCase(), uw = 20 + label.length * 6; if (ux + uw > x + w - pad) { ux = x + pad; yy += 30; }
      const know = r > 0;
      this.rr(cx, ux, yy, uw, 26, 13, know ? C.amber : undefined, know ? 0.07 : 1, know ? C.amber : C.border2, 1);
      this.t(cx, ux + uw / 2, yy + 13, `${know ? '⚒' : '🔒'} ${label}`, { pixel: true, size: 6.5, color: know ? H.amber : H.faint, ox: 0.5, oy: 0.5 });
      ux += uw + 6;
    }
    // Add to Mind
    const by = y + h - 16 - 52;
    if (s !== 'locked') {
      this.rr(cx, x + pad, by, w - pad * 2, 52, 10, C.gold, 0.12, C.gold, 2);
      this.t(cx, x + w / 2, by + 26, `⌬ ${r > 0 ? 'ADD TO MIND' : 'STUDY IN MIND'}`, { pixel: true, size: 10, color: H.gold, ox: 0.5, oy: 0.5 });
      this.hit(cx, x + pad, by, w - pad * 2, 52, () => {
        // add a matching tray-pool concept entry if one exists
        const pe = CF_TRAY_POOL.find(p => p.kind === 'concept' && p.ref === c.id);
        if (pe) this.st.trayAdd(pe.id);
        this.tab = 'mind'; this.renderAll();
      });
    } else {
      this.rr(cx, x + pad, by, w - pad * 2, 52, 10, C.subDark, 1, C.border2, 2);
      this.t(cx, x + w / 2, by + 20, '🔒 ADD TO MIND', { pixel: true, size: 10, color: H.faint, ox: 0.5, oy: 0.5 });
      this.t(cx, x + w / 2, by + 36, 'MEET THE PREREQUISITES FIRST', { pixel: true, size: 6, color: H.faint, ox: 0.5, oy: 0.5 });
    }
  }

  // ── REFINE tab ───────────────────────────────────────────────────────────────
  private maxRuns(p: typeof CF_PROCS[number]): number {
    return Math.max(0, Math.min(...p.ins.map(([id, n]) => Math.floor((this.st.inv[id] || 0) / n))));
  }
  private drawRefine(): void {
    const cx = this.root;
    const y0 = HEADER_H + 12;
    this.t(cx, 16, y0, 'PROCESSES', { pixel: true, size: 8, color: H.teal });
    let py = y0 + 18;
    const listW = 600;
    for (const p of CF_PROCS) {
      const mx = this.maxRuns(p);
      const bayFree = CF_REFINE_BAYS.some((b, i) => b.station === p.station && !this.jobs.some(j => j.bay === i));
      const ok = mx > 0 && bayFree;
      this.rr(cx, 16, py, listW, 78, 10, C.sub, 1, C.border, 1);
      this.t(cx, 28, py + 12, p.name, { size: 13.5, bold: true });
      this.t(cx, 28, py + 32, this.bayLabelFor(p.station), { pixel: true, size: 6.5, color: H.teal });
      const io = p.ins.map(([id, n]) => `${n} ${CF_ITEMS[id].name.toUpperCase()}`).join(' + ') + ` → ${p.outN} ${CF_ITEMS[p.id].name.toUpperCase()}`;
      this.t(cx, listW + 4, py + 12, io, { pixel: true, size: 7, color: H.dim, ox: 1 });
      this.t(cx, 28, py + 52, `CAN RUN ×${mx}`, { pixel: true, size: 6.5, color: mx > 0 ? H.green : H.danger });
      // run buttons
      const btns: [string, number][] = [['×1', 1], ['×5', 5], ['MAX', -1]];
      let bx = listW - 4;
      for (let i = btns.length - 1; i >= 0; i--) {
        const [label, n] = btns[i]; const w = 44; bx -= w + 6;
        this.rr(cx, bx, py + 44, w, 26, 6, C.subDark, 1, ok ? C.amber : C.border2, 1);
        this.t(cx, bx + w / 2, py + 57, label, { pixel: true, size: 8, color: ok ? H.gold : H.faint, ox: 0.5, oy: 0.5 });
        if (ok) { const pp = p, nn = n; this.hit(cx, bx, py + 44, w, 26, () => this.runProc(pp, nn)); }
      }
      if (!bayFree) this.t(cx, 120, py + 52, 'BAY BUSY', { pixel: true, size: 6.5, color: H.warn });
      else if (mx === 0) this.t(cx, 120, py + 52, 'NOT ENOUGH STOCK', { pixel: true, size: 6.5, color: H.danger });
      py += 86;
    }
    for (const lp of CF_LOCKED_PROCS) {
      this.rr(cx, 16, py, listW, 44, 10, 0x131422, 0.6, C.border2, 1);
      this.t(cx, 30, py + 22, '🔒', { size: 13, color: H.faint, oy: 0.5 });
      this.t(cx, 52, py + 14, lp.name, { size: 13, color: H.dim });
      this.t(cx, 52, py + 30, lp.io, { pixel: true, size: 6.5, color: H.faint });
      this.t(cx, listW + 4, py + 22, lp.why, { pixel: true, size: 7, color: H.warn, ox: 1, oy: 0.5 });
      py += 50;
    }

    // Bays (right)
    const bx = 632, bw = DW - bx - 16;
    this.t(cx, bx, y0, 'PROCESSING BAYS', { pixel: true, size: 8, color: H.amber });
    let byy = y0 + 18;
    for (let i = 0; i < CF_REFINE_BAYS.length; i++) {
      const j = this.jobs.find(x => x.bay === i);
      const bh = 92;
      const done = j ? (this.time.now - j.t0 >= j.dur) : false;
      const bc = !j ? C.border : done ? C.gold : C.warn;
      this.rr(cx, bx, byy, bw, bh, 12, !j ? C.subDark : done ? 0x201d0e : 0x201a10, 1, bc, 2);
      this.t(cx, bx + 12, byy + 12, this.bayLabel(i), { pixel: true, size: 9, color: !j ? H.dim : done ? H.gold : H.warn });
      if (!j) {
        this.t(cx, bx + bw / 2, byy + bh / 2 + 6, 'IDLE — ASSIGN A PROCESS', { pixel: true, size: 7.5, color: H.faint, ox: 0.5, oy: 0.5 });
      } else {
        const p = CF_PROCS.find(pp => pp.id === j.rid)!;
        if (done) {
          this.rr(cx, bx + 10, byy + 34, bw - 20, bh - 44, 8, C.gold, 0.12, C.gold, 2);
          this.t(cx, bx + bw / 2, byy + 34 + (bh - 44) / 2, `▼ COLLECT ${p.outN * j.batch} ${CF_ITEMS[j.rid].name.toUpperCase()}`, { pixel: true, size: 9, color: H.gold, ox: 0.5, oy: 0.5 });
          const bay = i; this.hit(cx, bx + 10, byy + 34, bw - 20, bh - 44, () => this.collect(bay));
        } else {
          this.t(cx, bx + 12, byy + 34, `${p.name}  ×${j.batch}`, { size: 13, bold: true });
          const pct = Math.min(100, Math.round((this.time.now - j.t0) / j.dur * 100));
          this.t(cx, bx + bw - 12, byy + 34, `${Math.ceil((j.dur - (this.time.now - j.t0)) / 1000)}s`, { pixel: true, size: 8, color: H.teal, ox: 1 });
          this.rr(cx, bx + 12, byy + 56, bw - 24, 12, 6, C.bg, 1, C.border, 1);
          if (pct > 0) this.rr(cx, bx + 13, byy + 57, (bw - 26) * pct / 100, 10, 5, C.warn, 1);
        }
      }
      byy += bh + 8;
    }
    // yield log
    const lh = DH - byy - 12;
    this.rr(cx, bx, byy, bw, lh, 12, C.panel, 1, C.border, 1);
    this.t(cx, bx + 12, byy + 10, 'YIELD LOG', { pixel: true, size: 7.5, color: H.green });
    if (!this.log.length) this.t(cx, bx + 12, byy + 28, 'Nothing refined yet this session.', { size: 11.5, color: H.faint });
    let ly2 = byy + 28;
    for (const e of this.log.slice(0, 4)) { this.t(cx, bx + 12, ly2, `+${e.n}  ${e.name}`, { size: 11.5, color: H.green }); ly2 += 18; }
  }
  private bayLabel(i: number): string { return CF_REFINE_BAYS[i]?.label ?? ''; }
  private bayLabelFor(station: string): string { return CF_REFINE_BAYS.find(b => b.station === station)?.label ?? station.toUpperCase(); }

  private runProc(p: typeof CF_PROCS[number], n: number): void {
    const bay = CF_REFINE_BAYS.findIndex((b, i) => b.station === p.station && !this.jobs.some(j => j.bay === i));
    const mx = this.maxRuns(p);
    if (bay < 0 || mx === 0) return;
    const runs = n === -1 ? Math.min(mx, 9) : Math.min(n, mx);
    const delta: Record<string, number> = {}; p.ins.forEach(([id, q]) => { delta[id] = -q * runs; });
    this.st.invAdd(delta);
    this.jobs.push({ bay, rid: p.id, batch: runs, t0: this.time.now, dur: Math.round(p.dur * Math.pow(runs, 0.7)) });
    this.renderAll();
  }
  private collect(bay: number): void {
    const j = this.jobs.find(x => x.bay === bay); if (!j || this.time.now - j.t0 < j.dur) return;
    const p = CF_PROCS.find(pp => pp.id === j.rid)!; const got = p.outN * j.batch;
    this.st.invAdd({ [j.rid]: got });
    this.jobs = this.jobs.filter(x => x !== j);
    this.log.unshift({ n: got, name: CF_ITEMS[j.rid].name });
    this.renderAll();
  }
}
