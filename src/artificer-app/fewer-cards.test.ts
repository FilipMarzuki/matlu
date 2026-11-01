/**
 * Fewer cards (#1925). The look is exempt (screenshots, ui-hud), but the split is pure and checked
 * here: which cards stay, which fold and with what reason, the guide's suggestion first, and the
 * fold's words in both languages.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { paletteBlock } from './camp-blocks';
import { makeWarden, previewQueue, type AppState } from './controller';
import { resetFolds, setFold } from './fold';
import { cantYetFold, cantYetId, cantYetLine, splitCards } from './fewer-cards';

const en = makeT('en');
const sv = makeT('sv');

/** The palette for a Warden. */
const palette = (a: AppState, suggest: 'explore' | 'scout' | null = null): string =>
  paletteBlock(a, previewQueue(a), { dev: false, t: en, suggest });
/** Each drawn card's action (from its tap) and whether it's greyed. */
const cardsIn = (html: string): { id: string; greyed: boolean }[] =>
  [...html.matchAll(/<button class="act ([^"]*)" (?:data-chooser="(\w+)"|data-q="(\w+)(?:@\d)?")/g)].map(m => ({ id: m[2] ?? m[3], greyed: / greyed\b/.test(m[1]) }));
/** Each greyed card's reason, as its card says it. */
const reasonsIn = (html: string): string[] => [...html.matchAll(/<span class="gate">([^<]*)<\/span>/g)].map(m => m[1]);

beforeEach(() => resetFolds());

describe('splitCards (#1925)', () => {
  const slots = [
    { id: 'scout' as const, why: null },
    { id: 'explore' as const, why: null },
    { id: 'survey' as const, why: 'needs the near ring scouted' },
    { id: 'lookout' as const, why: null },
    { id: 'track' as const, why: 'too dark' },
  ];

  it('Given a group, When split, Then the cards you can do stay in order and the rest fold, each with its reason', () => {
    expect(splitCards(slots)).toEqual({
      shown: ['scout', 'explore', 'lookout'],
      folded: [{ id: 'survey', why: 'needs the near ring scouted' }, { id: 'track', why: 'too dark' }],
    });
  });

  it('Given the guide suggests a card you can do, Then it comes first and the rest keep their order', () => {
    expect(splitCards(slots, 'lookout').shown).toEqual(['lookout', 'scout', 'explore']);
    expect(splitCards(slots, 'scout').shown).toEqual(['scout', 'explore', 'lookout']);
  });

  it('Given the guide suggests a card you can\'t do, or one in another group, Then nothing moves and it folds like the others', () => {
    expect(splitCards(slots, 'survey')).toEqual(splitCards(slots));
    expect(splitCards(slots, 'wood')).toEqual(splitCards(slots));
  });

  it('Given nothing can be done in a group, Then no card stays and all fold', () => {
    const none = splitCards([{ id: 'knife', why: 'needs 2 stone' }, { id: 'bow', why: 'needs a knife' }]);
    expect(none.shown).toEqual([]);
    expect(none.folded.map(f => f.id)).toEqual(['knife', 'bow']);
  });
});

describe('the folded line (#1925)', () => {
  it('says how many more, in English and Swedish, one or several', () => {
    expect(cantYetLine(1, en)).toBe('1 more you can\'t do yet');
    expect(cantYetLine(4, en)).toBe('4 more you can\'t do yet');
    expect(cantYetLine(1, sv)).toBe('1 till som du inte kan göra än');
    expect(cantYetLine(4, sv)).toBe('4 till som du inte kan göra än');
  });

  it('is one <details> per group, shut at first, listing each action with its reason; nothing when nothing is folded', () => {
    expect(cantYetFold('craft', [], en)).toBe('');
    const html = cantYetFold('craft', [{ icon: '🔪', name: 'Make a knife', why: 'needs 2 stone (have 0)' }, { icon: '🏹', name: 'Make a bow', why: 'needs a knife' }], en);
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).toContain(`data-fold="${cantYetId('craft')}"`);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('<summary><span class="cantline">2 more you can&#39;t do yet</span></summary>');
    expect(reasonsIn(html)).toEqual(['needs 2 stone (have 0)', 'needs a knife']);
    expect(html).toContain('Make a knife');
  });

  it('opens again on the next draw once the viewer opened it (fold.ts keeps it), and only that group\'s', () => {
    setFold(cantYetId('craft'), true, null);
    expect(cantYetFold('craft', [{ icon: '🔪', name: 'Make a knife', why: 'needs 2 stone' }], en)).toMatch(/<details[^>]* open>/);
    expect(cantYetFold('build', [{ icon: '⛺', name: 'Build', why: 'make camp first' }], en)).not.toMatch(/<details[^>]* open/);
  });
});

describe('the palette with fewer cards (#1925)', () => {
  const day1 = makeWarden({ id: 'w-1925' });

  it('Given a new Warden, Then only cards you can do are drawn, and the rest are in a fold per group, each with its reason', () => {
    const html = palette(day1);
    const cards = cardsIn(html);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every(c => !c.greyed)).toBe(true);
    // Each fold's line counts its own, and together they hold every reason.
    const counts = [...html.matchAll(/<span class="cantline">(\d+) more/g)].map(m => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.reduce((x, y) => x + y, 0)).toBe(reasonsIn(html).length);
    expect(html.match(/<details/g)?.length).toBe(counts.length);
  });

  it('Given a group with something folded, Then its fold line comes after its cards, with no heading over them (#2020)', () => {
    // The category over the cards names the group now (action-cats.ts), so the heading row (#1965) is gone.
    const html = palette(day1);
    expect(html).toMatch(/<div class="group" id="grp-provision"[^>]*><div class="acts">.*?<\/div><details class="fold cantyet"[^>]*>.*?<\/details><\/div>/);
    expect(html).not.toContain('<h4>');
    expect(html).not.toContain('ghead');
  });

  it('Given a group with nothing folded, Then it holds just its cards', () => {
    // EXPLORE has nothing to fold on a fresh Warden's first morning.
    const exploreGroup = palette(day1).match(/<div class="group" id="grp-explore".*?<\/div><\/div>/)?.[0];
    expect(exploreGroup).toBeDefined();
    expect(exploreGroup).not.toContain('cantyet');
  });

  it('Given the guide suggests Explore, Then Explore is the first card, glowing and wide', () => {
    const html = palette(day1, 'explore');
    expect(cardsIn(html)[0].id).toBe('explore');
    expect(html).toMatch(/<button class="act[^"]* guide-suggest lifted[^"]*" data-chooser="explore"/);
    expect(html.match(/ lifted/g)).toHaveLength(1);
  });

  it('Given a run with action-visibility off, Then the dashed cards that would be skipped fold too', () => {
    const old = makeWarden({ id: 'w-1925-old' }, undefined, { 'action-visibility': false });
    const html = palette(old, 'scout');
    expect(html).not.toContain('class="act soft');
    expect(reasonsIn(html).length).toBeGreaterThan(0);
  });
});
