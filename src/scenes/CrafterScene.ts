/**
 * CrafterScene — the crafting sim prototype (#1137). Route: /crafter
 *
 * A text-based sim with a visual crafting board: there is no world to walk
 * around. The player queues actions ("Harvest Oak Tree", "Craft Rope") from a
 * menu; a tick timer advances the queue; results land in a text feed and the
 * pack grid. Everything that decides *what happens* lives in the Phaser-free
 * modules under src/crafting (ActionQueue, Inventory, resolveHarvest), which
 * Core Warden shares — this scene only draws state and forwards clicks.
 *
 * Layout: a fixed 800×600 design canvas inside a root container, scaled to
 * fit the viewport (same approach as CraftForgeScene). Every element is
 * rebuilt by renderAll() whenever state changes — simpler than diffing for
 * a prototype, and cheap at this element count.
 *
 * Saves live under their own localStorage keys (matlu_crafter_*) so the sim
 * never touches Core Warden's player saves.
 */

import * as Phaser from 'phaser';
import { ActionQueue, type HarvestSource, type Recipe, type QueuedAction } from '../crafting/ActionQueue';
import { Inventory, type ResourceDef } from '../crafting/Inventory';
import { localStorageStore, nullEmitter, type SaveStore } from '../crafting/ports';
import { playerItems, itemIconPath, type RegistryItem } from '../lib/items';
import { Color, TextColor, Font } from '../ui/theme';
import recipesData from '../../macro-world/recipes.json';
import itemRegistryData from '../../macro-world/item-registry.json';

// ── Design canvas ───────────────────────────────────────────────────────────

const DW = 800;
const DH = 600;
const HEADER_H = 44;
const PACK_Y = 440;              // top of the pack grid
const COL = { actions: 0, queue: 240, log: 500 } as const;
const TICK_MS = 500;             // real time per sim tick while running
const LOG_KEEP = 200;            // lines kept in memory / saved
const LOG_SHOW = 17;             // lines that fit in the feed panel

/** Shape of public/macro-world/resource-nodes.json (loaded at runtime). */
interface NodeTypeJson {
  id: string;
  label: string;
  yields: { itemId: string; min: number; max: number }[];
  respawnMs: number;
}

/** What we persist besides the inventory (which saves itself). */
interface SimSave {
  entries: QueuedAction[];
  log: string[];
  tick: number;
  seed: number;
}

// Stored as matlu_crafter_sim once crafterStore applies its prefix.
const SIM_SAVE_KEY = 'matlu_sim';

// Heading colours as CSS strings (theme only exposes these as 0x numbers).
const ACCENT_TEAL = '#4dd4f0';
const ACCENT_GOLD = '#c8922a';

/** Any entry of the theme's Font table (they differ only in their literal sizes). */
type FontSpec = { fontFamily: string; fontSize: string; fontStyle: string };

/**
 * Prefix every key the crafting modules use so the sim's saves
 * (matlu_crafter_inventory, …) never collide with Core Warden's
 * (matlu_inventory, …). Same localStorage underneath.
 */
const crafterStore: SaveStore = {
  load: key => localStorageStore.load(`matlu_crafter_${key.replace(/^matlu_/, '')}`),
  save: (key, value) => localStorageStore.save(`matlu_crafter_${key.replace(/^matlu_/, '')}`, value),
};

/** Seeded PRNG so a run is reproducible from its seed (same as the tests use). */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CrafterScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private letterbox!: Phaser.GameObjects.Graphics;

  private inventory!: Inventory;
  private queue!: ActionQueue;
  private sources: HarvestSource[] = [];
  private recipes: Recipe[] = [];
  private items = new Map<string, RegistryItem>();

  private log: string[] = [];
  private tick = 0;
  private seed = 0;
  private paused = false;

  constructor() {
    super('CrafterScene');
  }

  preload(): void {
    this.load.json('resource-nodes', '/macro-world/resource-nodes.json');
    // Item icons: every player-obtainable item that has one. Keyed "icon:<id>".
    for (const item of itemRegistryData.items as RegistryItem[]) {
      const path = itemIconPath(item);
      if (item.playerObtainable && path) this.load.image(`icon:${item.id}`, path);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor(Color.panelBg);
    this.letterbox = this.add.graphics().setDepth(-1);
    this.root = this.add.container(0, 0);

    this.buildData();
    this.buildSim();

    this.layout();
    this.renderAll();

    // Sim clock. Ticks are what the queue understands; real time only decides
    // how often we tick, so pausing or skipping never desyncs anything.
    this.time.addEvent({ delay: TICK_MS, loop: true, callback: () => { if (!this.paused) this.step(1); } });

    const kb = this.input.keyboard;
    kb?.on('keydown-SPACE', () => this.skip());
    kb?.on('keydown-P', () => this.togglePause());
    kb?.on('keydown-ESC', () => this.scene.start('MainMenuScene'));

    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.layout, this));
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  private buildData(): void {
    for (const item of itemRegistryData.items as RegistryItem[]) this.items.set(item.id, item);

    const nodes = (this.cache.json.get('resource-nodes') as { nodeTypes: NodeTypeJson[] } | undefined)?.nodeTypes ?? [];
    this.sources = nodes.map(n => ({
      id: n.id,
      label: n.label,
      yields: n.yields,
      // Respawn time stands in for "how long a trip takes" — 1 tick ≈ 20 s.
      durationTicks: Math.max(2, Math.round(n.respawnMs / 20_000)),
    }));

    // Only offer recipes the player can actually reach from what the nodes
    // yield (directly or via other craftable items) — the rest would just be
    // permanently greyed-out noise in a prototype.
    const all = (recipesData.recipes as Recipe[]);
    const reachable = new Set(this.sources.flatMap(s => s.yields.map(y => y.itemId)));
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of all) {
        if (!reachable.has(r.output.item) && r.inputs.every(i => reachable.has(i.item))) {
          reachable.add(r.output.item);
          grew = true;
        }
      }
    }
    this.recipes = all.filter(r => reachable.has(r.output.item) && r.inputs.every(i => reachable.has(i.item)));
  }

  private buildSim(): void {
    const saved = this.loadSim();
    this.seed = saved?.seed ?? (Date.now() & 0x7fffffff);
    this.tick = saved?.tick ?? 0;
    this.log = saved?.log ?? ['Welcome to the crafter. Queue an action to begin.'];

    // nullEmitter: nothing listens for inventory events here — the whole
    // board is redrawn after every change instead.
    this.inventory = new Inventory({ emitter: nullEmitter, store: crafterStore });
    this.inventory.loadResourceDefs(playerItems(itemRegistryData.items as RegistryItem[]) as ResourceDef[]);

    this.queue = new ActionQueue({
      inventory: this.inventory,
      rng: mulberry32(this.seed + this.tick),
      sources: this.sources,
      recipes: this.recipes,
      initialEntries: saved?.entries,
    });
  }

  private loadSim(): SimSave | null {
    try {
      const raw = crafterStore.load(SIM_SAVE_KEY);
      return raw ? (JSON.parse(raw) as SimSave) : null;
    } catch {
      return null;
    }
  }

  private saveSim(): void {
    const save: SimSave = { entries: [...this.queue.entries], log: this.log.slice(-LOG_KEEP), tick: this.tick, seed: this.seed };
    crafterStore.save(SIM_SAVE_KEY, JSON.stringify(save));
  }

  // ── Sim controls (also the API the buttons and tests drive) ───────────────

  enqueueHarvest(sourceId: string): void {
    if (this.queue.enqueueHarvest(sourceId)) this.commit();
  }

  enqueueCraft(recipeId: string): void {
    if (this.queue.enqueueCraft(recipeId)) this.commit();
    else this.pushLog('Not enough materials.');
  }

  /** Advance the sim by n ticks and feed any outcomes into the log. */
  step(n: number): void {
    if (this.queue.entries.length === 0) return;
    this.tick += n;
    for (const outcome of this.queue.tick(n)) this.log.push(...outcome.log);
    this.commit();
  }

  skip(): void {
    for (const outcome of this.queue.skipToNextCompletion()) this.log.push(...outcome.log);
    this.commit();
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.renderAll();
  }

  reset(): void {
    crafterStore.save(SIM_SAVE_KEY, '');
    crafterStore.save('matlu_inventory', '');
    this.scene.restart();
  }

  private pushLog(line: string): void {
    this.log.push(line);
    this.commit();
  }

  private commit(): void {
    if (this.log.length > LOG_KEEP) this.log = this.log.slice(-LOG_KEEP);
    this.saveSim();
    this.renderAll();
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  /** Fit the 800×600 design canvas into the viewport, letterboxing the rest. */
  private layout(): void {
    const vw = this.scale.width;
    const vh = this.scale.height;
    const s = Math.min(vw / DW, vh / DH);
    const ox = (vw - DW * s) / 2;
    const oy = (vh - DH * s) / 2;
    this.root.setScale(s).setPosition(ox, oy);
    this.letterbox.clear();
    this.letterbox.fillStyle(0x000000, 1).fillRect(0, 0, vw, vh);
    this.letterbox.fillStyle(Color.panelBg, 1).fillRect(ox, oy, DW * s, DH * s);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private renderAll(): void {
    this.root.removeAll(true);
    this.renderHeader();
    this.renderActions();
    this.renderQueue();
    this.renderLog();
    this.renderPack();
  }

  private renderHeader(): void {
    this.panel(0, 0, DW, HEADER_H, Color.panelBgSub);
    this.text(12, 12, 'CRAFTER', Font.heading, ACCENT_GOLD);
    this.text(118, 16, `text sim · tick ${this.tick}${this.paused ? ' · PAUSED' : ''}`, Font.body, TextColor.secondary);

    let x = DW - 12;
    for (const [label, fn] of [
      ['Reset', () => this.reset()],
      ['Menu (Esc)', () => this.scene.start('MainMenuScene')],
      ['Skip ▶▶ (Space)', () => this.skip()],
      [this.paused ? 'Run (P)' : 'Pause (P)', () => this.togglePause()],
    ] as const) {
      const b = this.button(x, 10, label, fn, { alignRight: true });
      x -= b.width + 8;
    }
  }

  private renderActions(): void {
    const w = COL.queue - COL.actions;
    this.panel(COL.actions, HEADER_H, w, PACK_Y - HEADER_H, Color.panelBg);
    this.text(COL.actions + 12, HEADER_H + 10, 'ACTIONS', Font.heading, ACCENT_TEAL);

    let y = HEADER_H + 36;
    this.text(COL.actions + 12, y, 'Harvest', Font.label, TextColor.secondary);
    y += 20;
    for (const src of this.sources) {
      this.button(COL.actions + 12, y, `${src.label}  ·${src.durationTicks}t`, () => this.enqueueHarvest(src.id), { width: w - 24 });
      y += 26;
    }

    y += 8;
    this.text(COL.actions + 12, y, 'Craft', Font.label, TextColor.secondary);
    y += 20;
    for (const r of this.recipes) {
      if (y > PACK_Y - 44) break; // prototype: no scrolling yet
      const can = this.queue.canCraft(r.id);
      const needs = r.inputs.map(i => `${i.qty} ${this.name(i.item)}`).join(', ');
      this.button(COL.actions + 12, y, `${r.name}  ·${r.timeBase}t`, () => this.enqueueCraft(r.id), { width: w - 24, disabled: !can, hint: needs });
      y += 38;
    }
  }

  private renderQueue(): void {
    const w = COL.log - COL.queue;
    this.panel(COL.queue, HEADER_H, w, PACK_Y - HEADER_H, Color.panelBgWarm);
    this.text(COL.queue + 12, HEADER_H + 10, 'QUEUE', Font.heading, ACCENT_TEAL);

    const entries = this.queue.entries;
    if (entries.length === 0) {
      this.text(COL.queue + 12, HEADER_H + 40, 'Nothing queued.\nPick an action on the left.', Font.body, TextColor.secondary);
      return;
    }

    let y = HEADER_H + 38;
    entries.forEach((e, i) => {
      if (y > PACK_Y - 40) return;
      const head = i === 0;
      this.text(COL.queue + 12, y, `${i + 1}. ${e.label}`, Font.label, head ? TextColor.primary : TextColor.secondary);
      // Progress bar: only the head action advances, the rest show empty.
      const bx = COL.queue + 12;
      const by = y + 18;
      const bw = w - 24;
      const g = this.add.graphics();
      g.fillStyle(Color.slotBg, 1).fillRoundedRect(bx, by, bw, 8, 2);
      g.fillStyle(head ? Color.accentFantasy : Color.slotBorder, 1).fillRoundedRect(bx, by, bw * (e.elapsed / e.durationTicks), 8, 2);
      g.lineStyle(1, Color.slotBorder, 1).strokeRoundedRect(bx, by, bw, 8, 2);
      this.root.add(g);
      this.text(bx + bw - 44, y, `${e.elapsed}/${e.durationTicks}t`, Font.small, TextColor.secondary);
      y += 36;
    });
  }

  private renderLog(): void {
    const w = DW - COL.log;
    this.panel(COL.log, HEADER_H, w, PACK_Y - HEADER_H, Color.panelBg);
    this.text(COL.log + 12, HEADER_H + 10, 'LOG', Font.heading, ACCENT_TEAL);
    const lines = this.log.slice(-LOG_SHOW);
    lines.forEach((line, i) => {
      const latest = i === lines.length - 1;
      this.text(COL.log + 12, HEADER_H + 36 + i * 21, `› ${line}`, Font.body, latest ? TextColor.primary : TextColor.secondary, w - 24);
    });
  }

  private renderPack(): void {
    this.panel(0, PACK_Y, DW, DH - PACK_Y, Color.panelBgSub);
    this.text(12, PACK_Y + 10, 'PACK', Font.heading, ACCENT_TEAL);
    this.text(76, PACK_Y + 14, `${this.inventory.slotCount}/${this.inventory.maxSlots} slots`, Font.small, TextColor.secondary);

    const cell = 56;
    const perRow = Math.floor((DW - 24) / cell);
    this.inventory.entries().forEach(([id, qty], i) => {
      const x = 12 + (i % perRow) * cell;
      const y = PACK_Y + 34 + Math.floor(i / perRow) * cell;
      const g = this.add.graphics();
      g.fillStyle(Color.slotBg, 1).fillRoundedRect(x, y, cell - 6, cell - 6, 4);
      g.lineStyle(1, Color.slotBorder, 1).strokeRoundedRect(x, y, cell - 6, cell - 6, 4);
      this.root.add(g);

      const key = `icon:${id}`;
      if (this.textures.exists(key)) {
        this.root.add(this.add.image(x + (cell - 6) / 2, y + 20, key).setDisplaySize(28, 28));
      } else {
        // No icon generated yet — show a two-letter stand-in so the slot still reads.
        this.text(x + 14, y + 10, id.slice(0, 2).toUpperCase(), Font.label, TextColor.secondary);
      }
      this.text(x + 4, y + cell - 22, `×${qty}`, Font.small, TextColor.primary);
    });
  }

  // ── Drawing helpers (everything goes into this.root) ──────────────────────

  private name(itemId: string): string {
    return this.items.get(itemId)?.name ?? itemId;
  }

  private panel(x: number, y: number, w: number, h: number, fill: number): void {
    const g = this.add.graphics();
    g.fillStyle(fill, 1).fillRect(x, y, w, h);
    g.lineStyle(1, Color.borderOuter, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    this.root.add(g);
  }

  private text(x: number, y: number, s: string, font: FontSpec, color: string, wrap?: number): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, { ...font, color, ...(wrap ? { wordWrap: { width: wrap } } : {}) });
    this.root.add(t);
    return t;
  }

  /**
   * A text button with a background. Hit areas inside a scaled container
   * still work because Phaser resolves input through the container's
   * transform. `hint` renders a muted second line (recipe inputs).
   */
  private button(
    x: number, y: number, label: string, onClick: () => void,
    opts: { width?: number; disabled?: boolean; alignRight?: boolean; hint?: string } = {},
  ): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, label, {
      ...Font.label,
      color: opts.disabled ? TextColor.disabled : TextColor.primary,
      backgroundColor: opts.disabled ? '#141520' : '#1a1c2e',
      padding: { x: 8, y: 4 },
      ...(opts.width ? { fixedWidth: opts.width } : {}),
    });
    if (opts.alignRight) t.setX(x - t.width);
    this.root.add(t);
    if (opts.hint) {
      // Inputs needed, on their own line beneath the button.
      const h = this.add.text(t.x + 8, y + t.height + 1, opts.hint, { ...Font.small, color: TextColor.secondary });
      this.root.add(h);
    }
    if (!opts.disabled) {
      t.setInteractive({ useHandCursor: true })
        .on('pointerover', () => t.setStyle({ backgroundColor: '#222438' }))
        .on('pointerout', () => t.setStyle({ backgroundColor: '#1a1c2e' }))
        .on('pointerdown', onClick);
    }
    return t;
  }
}
