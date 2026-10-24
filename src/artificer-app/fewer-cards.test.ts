/**
 * Fewer cards (#1925, ui feature `fewer-cards`). The look is exempt (screenshots, ui-hud), but the
 * split is pure and checked here: which cards stay, which fold and with what reason, the guide's
 * suggestion first, the fold's words in both languages, and that with the switch off the palette
 * draws none of it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { paletteBlock } from './camp-blocks';
import { makeWarden, previewQueue, type AppState } from './controller';
import { resetFolds, setFold } from './fold';
import { FEWER_CARDS_FEATURE, cantYetFold, cantYetId, cantYetLine, splitCards } from './fewer-cards';

const en = makeT('en');
const sv = makeT('sv');

/** The palette for a Warden, with the switch on or off. */
const palette = (a: AppState, fewer: boolean, suggest: 'explore' | 'scout' | null = null): string =>
  paletteBlock(a, previewQueue(a), { dev: false, t: en, suggest, fewer });
/** Each drawn card's action (from its tap) and whether it's greyed. */
const cardsIn = (html: string): { id: string; greyed: boolean }[] =>
  [...html.matchAll(/<button class="act ([^"]*)" (?:data-chooser="(\w+)"|data-q="(\w+)(?:@\d)?")/g)].map(m => ({ id: m[2] ?? m[3], greyed: / greyed\b/.test(m[1]) }));
/** Each greyed card's reason, as its card says it. */
const reasonsIn = (html: string): string[] => [...html.matchAll(/<span class="gate">([^<]*)<\/span>/g)].map(m => m[1]);

beforeEach(() => resetFolds());

describe('the fewer-cards ui feature (#1925)', () => {
  it('is a ui feature, experimental, on by default, and no run saves it', () => {
    expect(featureById(FEWER_CARDS_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1925 });
    expect(FEATURES.filter(f => f.id === FEWER_CARDS_FEATURE)).toHaveLength(1);
    expect(uiFeatureOn({}, FEWER_CARDS_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [FEWER_CARDS_FEATURE]: false }, FEWER_CARDS_FEATURE)).toBe(false);
    expect(FEWER_CARDS_FEATURE in ruleFeatures()).toBe(false);
  });
});

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

  it('Given a new Warden, When the switch is off, Then the palette is as before: greyed cards drawn, no fold, nothing lifted', () => {
    const off = palette(day1, false, 'explore');
    expect(cardsIn(off).some(c => c.greyed)).toBe(true);
    expect(off).not.toContain('cantyet');
    expect(off).not.toContain(' lifted');
    expect(paletteBlock(day1, previewQueue(day1), { dev: false, t: en })).toBe(off.replace(' guide-suggest', ''));
  });

  it('Given a new Warden, When the switch is on, Then only cards you can do are drawn, and every greyed one is in a fold with the same reason', () => {
    const off = palette(day1, false);
    const on = palette(day1, true);
    const before = cardsIn(off);
    const after = cardsIn(on);
    expect(after.every(c => !c.greyed)).toBe(true);
    expect(after.map(c => c.id)).toEqual(before.filter(c => !c.greyed).map(c => c.id));
    // Every greyed card's reason is in a fold, in the same order, and each group's line counts its own.
    expect(reasonsIn(on)).toEqual(reasonsIn(off));
    const counts = [...on.matchAll(/<span class="cantline">(\d+) more/g)].map(m => Number(m[1]));
    expect(counts.reduce((x, y) => x + y, 0)).toBe(before.filter(c => c.greyed).length);
    expect(on.match(/<details/g)?.length).toBe(counts.length);
  });

  it('Given a group with something folded, When the switch is on, Then its fold line sits in the heading row, before the cards (#1965)', () => {
    const on = palette(day1, true);
    expect(on).toMatch(/<div class="group"><div class="ghead"><h4>[^<]*<\/h4><details class="fold cantyet"[^>]*>.*?<\/details><\/div>(?:<div class="acts">|<\/div>)/);
    expect(on).not.toMatch(/<\/div><details class="fold cantyet"/); // not its own row under the cards
  });

  it('Given a group with nothing folded, When the switch is on, Then its heading is a plain h4 with no empty ghead wrapper', () => {
    // EXPLORE has nothing to fold on a fresh Warden's first morning: its own group div has no ghead.
    const on = palette(day1, true);
    const exploreGroup = on.match(/<div class="group"><h4>EXPLORE<\/h4>.*?<\/div><\/div>/)?.[0];
    expect(exploreGroup).not.toContain('ghead');
    expect(exploreGroup).not.toContain('cantyet');
  });

  it('Given the guide suggests Explore, When the switch is on, Then Explore is the first card, glowing and wide', () => {
    const on = palette(day1, true, 'explore');
    expect(cardsIn(on)[0].id).toBe('explore');
    expect(on).toMatch(/<button class="act[^"]* guide-suggest lifted[^"]*" data-chooser="explore"/);
    expect(on.match(/ lifted/g)).toHaveLength(1);
  });

  it('Given a run with action-visibility off, When the switch is on, Then the dashed cards that would be skipped fold too', () => {
    const old = makeWarden({ id: 'w-1925-old' }, undefined, { 'action-visibility': false });
    const off = palette(old, false, 'scout');
    const on = palette(old, true, 'scout');
    expect(cardsIn(off).some(c => c.greyed)).toBe(false);
    expect(off).toContain('class="act soft');
    expect(on).not.toContain('class="act soft');
    expect(reasonsIn(on)).toEqual(reasonsIn(off));
  });
});
