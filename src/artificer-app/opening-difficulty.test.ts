/**
 * #1728 on the creation screen: points left unspent and talent picks left unchosen get no nudge,
 * just how many and the difficulty multiplier they make, in both languages.
 */

import { describe, it, expect } from 'vitest';
import { createForm, statsForm, type DraftView } from './opening-view';
import { makeT } from '../artificer/i18n';
import { DEFAULT_STATS } from '../artificer/stats';
import { talentOffer, seedOf } from '../artificer/talents';

const ID = 'w-opening-difficulty';
const draft = (over: Partial<DraftView> = {}): DraftView => ({ id: ID, name: 'Vega', portrait: 'loke', talents: [], stats: { ...DEFAULT_STATS, str: 13 }, age: 12, ...over });

describe('The creation screen shows the difficulty, not a nudge (#1728)', () => {
  it('the stats step says what is unspent and the multiplier, in English and Swedish', () => {
    const one = talentOffer(seedOf(ID)).slice(0, 1);
    const en = statsForm(draft({ talents: one }), makeT('en'));
    expect(en).toContain('Unspent: 3 · difficulty ×1.55');
    expect(en).not.toMatch(/wasted/);
    const sv = statsForm(draft({ talents: one }), makeT('sv'));
    expect(sv).toContain('Oanvända: 3 · svårighetsgrad ×1.55');
    expect(sv).not.toMatch(/förlorade/);
  });

  it('the talent step says what is unchosen and the multiplier', () => {
    expect(createForm(draft(), makeT('en'))).toContain('Unchosen: 2 · difficulty ×1.80');
    expect(createForm(draft({ talents: talentOffer(seedOf(ID)).slice(0, 2), stats: { ...DEFAULT_STATS, str: 13, con: 13 } }), makeT('en'))).toContain('Unchosen: 0 · difficulty ×1.00');
    expect(createForm(draft(), makeT('sv'))).toContain('Ovalda: 2 · svårighetsgrad ×1.80');
  });
});
