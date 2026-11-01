/**
 * The action categories (#2020). The look is exempt (screenshots, ui-hud), but which group is open,
 * what a tap does, what the row says and the pick kept in the browser are pure and checked here.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { GROUPS, groupOf, paletteBlock } from './camp-blocks';
import { makeWarden, previewQueue, type AppState } from './controller';
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

describe('openGroup (#2020)', () => {
  const known = ['explore', 'provision', 'build'] as const;

  it('Given no pick yet, Then the first group there is open (Explore)', () => {
    expect(openGroup(known, undefined)).toBe('explore');
  });

  it('Given a pick of a group that is there, Then that group is open', () => {
    expect(openGroup(known, 'build')).toBe('build');
  });

  it('Given everything shut on purpose, Then none is open', () => {
    expect(openGroup(known, null)).toBeNull();
  });

  it('Given a pick of a group not there yet (nothing in it known), Then the first group is open instead', () => {
    expect(openGroup(known, 'carry')).toBe('explore');
  });

  it('Given an open chooser, Then its group is open whatever was picked, even all shut', () => {
    expect(openGroup(known, 'build', 'provision')).toBe('provision');
    expect(openGroup(known, null, 'explore')).toBe('explore');
  });

  it('Given no groups, Then none is open', () => {
    expect(openGroup([], undefined)).toBeNull();
  });
});

describe('tapGroup (#2020)', () => {
  it('Given a shut category tapped, Then it opens (and the last one shuts)', () => {
    expect(tapGroup('explore', 'build')).toBe('build');
    expect(tapGroup(null, 'build')).toBe('build');
  });

  it('Given the open category tapped, Then it shuts and none is open', () => {
    expect(tapGroup('build', 'build')).toBeNull();
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
    expect(catsRow([{ key: 'build', can: 0, suggested: false }], null, en)).toMatch(/<button type="button" class="cat none"/);
  });

  it('Given the guide suggests something in a shut category, Then it glows; open, it does not (the card glows)', () => {
    expect(catsRow([{ key: 'explore', can: 1, suggested: true }], null, en)).toMatch(/class="cat guide-suggest"/);
    expect(catsRow([{ key: 'explore', can: 1, suggested: true }], 'explore', en)).not.toContain('guide-suggest');
  });

  it('Given Swedish, Then the short names are Swedish and every group has one in both languages', () => {
    const html = catsRow(GROUPS.map(g => ({ key: g.key, can: 1, suggested: false })), null, sv);
    expect([...html.matchAll(/<span class="catname">([^<]*)<\/span>/g)].map(m => m[1])).toEqual(['Utforska', 'Samla', 'Bygga', 'Tillverka', 'Bära', 'Tänka']);
    expect(html).toContain('aria-label="Samla: 1 som du kan göra nu"');
    expect([...catsRow(GROUPS.map(g => ({ key: g.key, can: 1, suggested: false })), null, en).matchAll(/<span class="catname">([^<]*)<\/span>/g)].map(m => m[1]))
      .toEqual(['Explore', 'Gather', 'Build', 'Craft', 'Carry', 'Think']);
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
    const html = palette(day1, { group: 'build' });
    expect(panels(html).filter(p => !p.hidden).map(p => p.key)).toEqual(['build']);
    expect(cats(html).filter(c => c.on).map(c => c.key)).toEqual(['build']);
  });

  it('Given everything shut, Then just the row shows', () => {
    const html = palette(day1, { group: null });
    expect(panels(html).every(p => p.hidden)).toBe(true);
    expect(cats(html).some(c => c.on)).toBe(false);
  });

  it('Given a chooser open on a card, Then its group shows whatever was picked', () => {
    const html = palette(day1, { group: 'build', chooser: 'gather' });
    expect(panels(html).filter(p => !p.hidden).map(p => p.key)).toEqual(['provision']);
    expect(html).toContain('class="ringpick');
  });

  it('Given the counts, Then each is the number of cards you can do now in that group (not the folded ones)', () => {
    const html = palette(day1);
    for (const c of cats(html)) expect(c.n).toBe(cardsOf(html, c.key).length);
    expect(cats(html).some(c => c.n > 0)).toBe(true);
  });

  it('Given the guide suggests Explore while another group is open, Then the Explore category glows', () => {
    const html = palette(day1, { group: 'build', suggest: 'explore' });
    expect(html).toMatch(/class="cat guide-suggest" id="cat-explore"/);
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
    expect(loadGroupPick(memory())).toBeUndefined();
  });

  it('Given a pick saved, Then it comes back; all shut comes back as null', () => {
    const s = memory();
    saveGroupPick('craft', s);
    expect(s.getItem(GROUP_KEY)).toBe('craft');
    expect(loadGroupPick(s)).toBe('craft');
    saveGroupPick(null, s);
    expect(loadGroupPick(s)).toBeNull();
  });

  it('Given junk kept, or storage that refuses, Then no pick and no throw', () => {
    const s = memory();
    s.setItem(GROUP_KEY, 'everything');
    expect(loadGroupPick(s)).toBeUndefined();
    const refuses = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(loadGroupPick(refuses)).toBeUndefined();
    expect(() => saveGroupPick('build', refuses)).not.toThrow();
    expect(loadGroupPick(null)).toBeUndefined();
  });
});
