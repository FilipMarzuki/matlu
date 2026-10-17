/**
 * The art pipeline's data (#1673, epic #1672): every Artificer item has a visual brief and a tier
 * in content/art-briefs.json, every icon it names is on disk at 32 px, and content/art-style.json
 * (what the PixelLab icon pass reads) is well-formed. `art` work is exempt from ATDD; this is the
 * guard that keeps the briefs in step with the items as the Artificer grows.
 *
 * The item list is built from the Artificer's own data (it's the master for materials and items,
 * #1531), not re-listed here, so a new recipe, kit item or manual fails this test until it has a
 * brief. See docs/art-pipeline.md for how to write one.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REGION1_RECIPES, GEAR_RECIPES, HUNTING_RECIPES, COLD_PIT_RECIPE, COLD_GEAR_RECIPE, HIDE_PARKA_RECIPE, SHELTER_TYPES, WALL_TYPES,
  STARTING_RECIPES, DISCOVERIES, CRAFT_WORLD, type Stores,
} from './region1';
import { DEFAULT_EFFECTS } from './crafting';
import { BASE_VALUE, KIND_OF } from './trade';
import { KIT_IDS, startFromPack } from './kit';
import { MANUALS } from './techniques';
import briefsFile from './content/art-briefs.json';
import style from './content/art-style.json';

const root = join(__dirname, '..', '..');

// Typed as a Record over every Stores key, so a new store good fails `tsc` until it's listed here
// (Stores is a type, so there's no runtime list of its keys to import).
const STORE_GOODS: Record<keyof Stores, true> = { rawFood: true, water: true, firewood: true, materials: true, rations: true, stone: true, hides: true };

/** Every item id the Artificer has: store goods, recipe results, items with effects, the kit, the manuals. */
function artificerItemIds(): string[] {
  const recipes = [
    // The hunting gear (#1821) too: its bow takes sinew, an item of its own (kept beside the stores).
    ...Object.values(REGION1_RECIPES), ...Object.values(GEAR_RECIPES), ...Object.values(HUNTING_RECIPES), COLD_PIT_RECIPE, COLD_GEAR_RECIPE, HIDE_PARKA_RECIPE,
    ...Object.values(SHELTER_TYPES).map(t => t.recipe), ...Object.values(WALL_TYPES).map(w => w.recipe),
  ];
  const ids = [
    ...Object.keys(STORE_GOODS),
    ...recipes.flatMap(r => [r.id, r.output.item, ...r.inputs.map(i => i.item)]),
    ...STARTING_RECIPES, ...DISCOVERIES.map(d => d.recipe),
    ...Object.keys(DEFAULT_EFFECTS), ...Object.keys(CRAFT_WORLD.effects),
    ...Object.keys(BASE_VALUE), ...Object.keys(KIND_OF),
    ...KIT_IDS, ...startFromPack(KIT_IDS).tools.map(t => t.item),
    ...MANUALS.map(m => m.id),
  ];
  return [...new Set(ids)].sort();
}

interface Brief { brief: string; tier: number; icon?: string }
const briefs = briefsFile.items as Record<string, Brief>;

/** A PNG's width and height, from its IHDR chunk (bytes 16–23), without an image library. */
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const publicFile = (url: string): string => join(root, 'public', url);

describe('Art briefs (#1673)', () => {
  const ids = artificerItemIds();

  it('finds the Artificer items (sanity: the list is built from the code, not empty)', () => {
    expect(ids.length).toBeGreaterThan(40);
    expect(ids).toEqual(expect.arrayContaining(['water', 'stone-knife', 'cold-gear', 'shelter-stone', 'mora-knife', 'tally-book']));
  });

  it('gives every Artificer item a brief and a tier', () => {
    const missing = ids.filter(id => !briefs[id]);
    expect(missing).toEqual([]);
    for (const id of ids) {
      const b = briefs[id]!;
      expect(typeof b.brief, id).toBe('string');
      expect(b.brief.length, `${id}: a brief says silhouette, material, colour and one detail`).toBeGreaterThanOrEqual(40);
      expect(b.brief.length, `${id}: keep a brief short`).toBeLessThanOrEqual(220);
      // Items are tier 0 (an icon) or 1 (a card first); tier 2 is world things, not items.
      expect([0, 1], id).toContain(b.tier);
    }
  });

  it('has no briefs for items the Artificer no longer has', () => {
    expect(Object.keys(briefs).filter(id => !ids.includes(id))).toEqual([]);
  });

  it('names only icons that exist, as 32 px PNGs under public/', () => {
    for (const [id, b] of Object.entries(briefs)) {
      if (b.icon === undefined) continue;
      expect(b.icon, id).toMatch(/^\/assets\/sprites\/icons\/.+\.png$/);
      expect(existsSync(publicFile(b.icon)), `${id}: ${b.icon}`).toBe(true);
      expect(pngSize(publicFile(b.icon)), id).toEqual({ w: style.icon.size, h: style.icon.size });
    }
  });
});

describe('Art style (#1673)', () => {
  it('sets the sizes: 32 px icons, ~128 px cards', () => {
    expect(style.icon.size).toBe(32);
    expect(style.card.size).toBeGreaterThanOrEqual(96);
    expect(style.card.size).toBeLessThanOrEqual(160);
    expect(style.actionIcon.frames.min).toBeGreaterThanOrEqual(2);
    expect(style.actionIcon.frames.max).toBeGreaterThanOrEqual(style.actionIcon.frames.min);
    expect(style.portrait.size).toBeGreaterThan(style.icon.size);
  });

  it('has a fixed palette of distinct hex colours, the outline among them', () => {
    const hex = /^#[0-9a-f]{6}$/;
    expect(style.palette.length).toBeGreaterThanOrEqual(16);
    expect(style.palette.length).toBeLessThanOrEqual(48);
    for (const c of style.palette) expect(c).toMatch(hex);
    expect(new Set(style.palette).size).toBe(style.palette.length);
    expect(style.outline.width).toBe(1);
    expect(style.palette).toContain(style.outline.color);
  });

  it('lights from the top left on a transparent background', () => {
    expect(style.light).toBe('top-left');
    expect(style.background).toBe('transparent');
  });

  it('names 3–5 reference icons that exist at icon size', () => {
    expect(style.references.length).toBeGreaterThanOrEqual(3);
    expect(style.references.length).toBeLessThanOrEqual(5);
    for (const r of style.references) {
      expect(existsSync(publicFile(r)), r).toBe(true);
      expect(pngSize(publicFile(r)), r).toEqual({ w: style.icon.size, h: style.icon.size });
    }
  });
});
