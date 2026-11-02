/**
 * The action categories (#2020). The look is exempt (screenshots, ui-hud), but which group is open,
 * what a tap does, what the row says and the pick kept in the browser are pure and checked here.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { GROUPS, groupOf, paletteBlock } from './camp-blocks';
import { makeWarden, previewQueue, type AppState } from './controller';
import { cantYetFold } from './fewer-cards';
import { resetFolds } from './fold';
import { CAT_ICON, GROUP_KEY, catsRow, isGroupKey, loadGroupPick, openGroup, saveGroupPick, tapGroup, type GroupPick } from './action-cats';

const en = makeT('en');
const sv = makeT('sv');

const palette = (a: AppState, o: { group?: GroupPick; chooser?: 'explore' | 'gather' | null; suggest?: 'explore' | null; t?: typeof en } = {}): string =>
  paletteBlock(a, previewQueue(a), { dev: false, t: o.t ?? en, group: o.group, chooser: o.chooser ?? null, suggest: o.suggest ?? null });

/** Each group panel as drawn: its key and whether it's hidden. */
const panels = (html: string): { key: string; hidden: boolean }[] =>
  [...html.matchAll(/<div class="group" id="grp-(\w+)"[^>]*?( hidden)?>/g)].map(m => ({ key: m[1], hidden: !!m[2] }));
/** Each category button: its key, whether it's open, and its count. */
const cats = (html: string): { key: string; on: boolean; n: number }[] =>
  [...html.matchAll(/<button type="button" class="cat([^"]*)"[^>]*data-group="(\w+)"[^>]*>.*?<b class="catnum"[^>]*>(\d+)<\/b><\/button>/g)]
    .map(m => ({ key: m[2], on: /\bon\b/.test(m[1]), n: Number(m[3]) }));
/** The cards in one group's panel: their actions. */
const cardsOf = (html: string, key: string): string[] => {
  const panel = html.match(new RegExp(`<div class="group" id="grp-${key}"[^>]*>(.*?)(?=<div class="group" |$)`))?.[1] ?? '';
  const acts = panel.match(/<div class="acts">.*?<\/div>(?=<details|<\/div>$|$)/)?.[0] ?? panel;
  return [...acts.matchAll(/<button class="act [^"]*" (?:data-chooser="(\w+)"|data-q="(\w+)(?:@\d)?"|data-campick)/g)].map(m => m[1] ?? m[2] ?? 'camp');
};

const day1 = makeWarden({ id: 'w-2020' });

beforeEach(() => resetFolds());

describe('openGroup (#2020)', () => {
  const known = ['explore', 'provision', 'make'] as const;

  it('Given no pick yet, Then the first group there is open (Explore)', () => {
    expect(openGroup(known, undefined)).toBe('explore');
  });

  it('Given a pick of a group that is there, Then that group is open', () => {
    expect(openGroup(known, 'make')).toBe('make');
  });

  it('Given everything shut on purpose, Then none is open', () => {
    expect(openGroup(known, null)).toBeNull();
  });

  it('Given a pick of a group not there yet (nothing in it known), Then the first group is open instead', () => {
    expect(openGroup(known, 'think')).toBe('explore');
  });

  it('Given an open chooser, Then its group is open whatever was picked, even all shut', () => {
    expect(openGroup(known, 'make', 'provision')).toBe('provision');
    expect(openGroup(known, null, 'explore')).toBe('explore');
  });

  it('Given no groups, Then none is open', () => {
    expect(openGroup([], undefined)).toBeNull();
  });
});

describe('tapGroup (#2020)', () => {
  it('Given a shut category tapped, Then it opens (and the last one shuts)', () => {
    expect(tapGroup('make', false)).toBe('make');
  });

  it('Given the open category tapped, Then it shuts and none is open', () => {
    expect(tapGroup('make', true)).toBeNull();
  });
});

describe('the row (#2020)', () => {
  it('Given the categories, Then each is a button with its icon, short name and count, the open one pressed', () => {
    const html = catsRow([{ key: 'explore', can: 1, suggested: false }, { key: 'provision', can: 4, suggested: false }], 'provision', en);
    expect(html).toContain('style="--cats:2"');
    expect(html).toMatch(/<button type="button" class="cat" id="cat-explore" data-group="explore" aria-expanded="false" aria-controls="grp-explore" aria-label="Explore: 1 you can do now"/);
    expect(html).toMatch(/<button type="button" class="cat on" id="cat-provision" data-group="provision" aria-expanded="true" aria-controls="grp-provision" aria-label="Gather: 4 you can do now" title="Provision: 4 you can do now">/);
    expect(html).toContain(`<span class="caticon" aria-hidden="true">${CAT_ICON.provision}</span><span class="catname">Gather</span><b class="catnum" aria-hidden="true">4</b>`);
  });

  it('Given a category with nothing you can do now, Then it is dim but still a button', () => {
    expect(catsRow([{ key: 'make', can: 0, suggested: false }], null, en)).toMatch(/<button type="button" class="cat none"/);
  });

  it('Given the guide suggests something in a shut category, Then it glows; open, it does not (the card glows)', () => {
    expect(catsRow([{ key: 'explore', can: 1, suggested: true }], null, en)).toMatch(/class="cat guide-suggest"/);
    expect(catsRow([{ key: 'explore', can: 1, suggested: true }], 'explore', en)).not.toContain('guide-suggest');
  });

  it('Given Swedish, Then the short names are Swedish and every group has one in both languages', () => {
    const html = catsRow(GROUPS.map(g => ({ key: g.key, can: 1, suggested: false })), null, sv);
    expect([...html.matchAll(/<span class="catname">([^<]*)<\/span>/g)].map(m => m[1])).toEqual(['Utforska', 'Samla', 'Tillverka', 'Tänka']);
    expect(html).toContain('aria-label="Samla: 1 som du kan göra nu"');
    expect([...catsRow(GROUPS.map(g => ({ key: g.key, can: 1, suggested: false })), null, en).matchAll(/<span class="catname">([^<]*)<\/span>/g)].map(m => m[1]))
      .toEqual(['Explore', 'Gather', 'Craft', 'Think']);
  });

  it('Given no categories, Then no row', () => {
    expect(catsRow([], null, en)).toBe('');
  });
});

describe('the palette with categories (#2020)', () => {
  it('Given no pick yet, Then the row comes first, Explore is open and every other group is drawn hidden', () => {
    const html = palette(day1);
    expect(html.startsWith('<div class="cats"')).toBe(true);
    const ps = panels(html);
    expect(ps[0]).toEqual({ key: 'explore', hidden: false });
    expect(ps.slice(1).every(p => p.hidden)).toBe(true);
    expect(cats(html).map(c => c.key)).toEqual(ps.map(p => p.key));
    expect(cats(html).filter(c => c.on).map(c => c.key)).toEqual(['explore']);
  });

  it('Given a pick, Then only that group shows', () => {
    const html = palette(day1, { group: 'make' });
    expect(panels(html).filter(p => !p.hidden).map(p => p.key)).toEqual(['make']);
    expect(cats(html).filter(c => c.on).map(c => c.key)).toEqual(['make']);
  });

  it('Given everything shut, Then just the row shows', () => {
    const html = palette(day1, { group: null });
    expect(panels(html).every(p => p.hidden)).toBe(true);
    expect(cats(html).some(c => c.on)).toBe(false);
  });

  it('Given a chooser open on a card, Then its group shows whatever was picked', () => {
    const html = palette(day1, { group: 'make', chooser: 'gather' });
    expect(panels(html).filter(p => !p.hidden).map(p => p.key)).toEqual(['provision']);
    expect(html).toContain('class="ringpick');
  });

  it('Given the counts, Then each is the number of cards you can do now in that group (not the folded ones)', () => {
    const html = palette(day1);
    for (const c of cats(html)) expect(c.n).toBe(cardsOf(html, c.key).length);
    expect(cats(html).some(c => c.n > 0)).toBe(true);
  });

  it('Given the guide suggests Explore while another group is open, Then the Explore category glows', () => {
    const html = palette(day1, { group: 'make', suggest: 'explore' });
    expect(html).toMatch(/class="cat guide-suggest" id="cat-explore"/);
  });

  it('Given a category with cards you can do, Then its fold of the rest starts shut', () => {
    const html = palette(day1, { group: null });
    const folds = cats(html).flatMap(c => {
      const panel = html.match(new RegExp(`<div class="group" id="grp-${c.key}"[^>]*>(.*?)(?=<div class="group" |$)`))?.[1] ?? '';
      const fold = panel.match(/<details class="fold cantyet"[^>]*>/)?.[0];
      return fold ? [{ n: c.n, open: fold.includes(' open') }] : [];
    });
    expect(folds.length).toBeGreaterThan(0);
    for (const f of folds) expect(f).toEqual({ n: f.n, open: f.n === 0 });
  });

  it('Given a category with no card you can do now, Then its fold opens on the reasons (they are all there is to see)', () => {
    const items = [{ icon: '🎒', name: 'Craft backpack', why: 'make camp first' }];
    expect(cantYetFold('make', items, en, true)).toMatch(/^<details class="fold cantyet" data-fold="cantyet-make" open>/);
    expect(cantYetFold('make', items, en)).not.toContain(' open>');
  });

  it('Given Make (#2025), Then it holds the building, the tools and the carrying gear, in that order, and there are four categories', () => {
    const make = GROUPS.find(g => g.key === 'make')!.ids;
    expect(make.indexOf('camp')).toBe(0);
    expect(make.indexOf('build')).toBeLessThan(make.indexOf('knife'));
    expect(make.indexOf('knife')).toBeLessThan(make.indexOf('backpack'));
    expect(GROUPS.map(g => g.key)).toEqual(['explore', 'provision', 'make', 'think']);
    expect(groupOf('sled')).toBe('make');
    expect(groupOf('coldPit')).toBe('make');
  });

  it('Given every group, Then each action is in exactly one, which groupOf names', () => {
    const all = GROUPS.flatMap(g => g.ids);
    expect(new Set(all).size).toBe(all.length);
    for (const g of GROUPS) for (const id of g.ids) expect(groupOf(id)).toBe(g.key);
    expect(GROUPS.every(g => isGroupKey(g.key))).toBe(true);
  });
});

describe('the pick in the browser (#2020)', () => {
  const memory = (): Storage => {
    const m = new Map<string, string>();
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } as Storage;
  };

  it('Given nothing kept, Then no pick', () => {
    expect(loadGroupPick('w-a', memory())).toBeUndefined();
  });

  it('Given a pick saved, Then it comes back for that Warden; all shut comes back as null', () => {
    const s = memory();
    saveGroupPick('w-a', 'think', s);
    expect(JSON.parse(s.getItem(GROUP_KEY)!)).toEqual({ id: 'w-a', pick: 'think' });
    expect(loadGroupPick('w-a', s)).toBe('think');
    saveGroupPick('w-a', null, s);
    expect(loadGroupPick('w-a', s)).toBeNull();
  });

  it('Given a pick made for another Warden, Then a new Warden has none (Explore opens, where the guide points)', () => {
    const s = memory();
    saveGroupPick('w-old', 'make', s);
    expect(loadGroupPick('w-new', s)).toBeUndefined();
    expect(openGroup(['explore', 'provision', 'make'], loadGroupPick('w-new', s))).toBe('explore');
  });

  it('Given a pick of Build, Craft or Carry kept from before they were one (#2025), Then Make opens', () => {
    const s = memory();
    for (const old of ['build', 'craft', 'carry']) {
      s.setItem(GROUP_KEY, JSON.stringify({ id: 'w-a', pick: old }));
      expect(loadGroupPick('w-a', s)).toBe('make');
    }
  });

  it('Given junk kept, or storage that refuses, Then no pick and no throw', () => {
    const s = memory();
    for (const junk of ['everything', '"build"', '{"id":"w-a","pick":"everything"}', '{"pick":"build"}', '{']) {
      s.setItem(GROUP_KEY, junk);
      expect(loadGroupPick('w-a', s)).toBeUndefined();
    }
    const refuses = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(loadGroupPick('w-a', refuses)).toBeUndefined();
    expect(() => saveGroupPick('w-a', 'make', refuses)).not.toThrow();
    expect(loadGroupPick('w-a', null)).toBeUndefined();
  });
});
