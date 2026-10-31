/**
 * #1998: fewer rows on top on a wide screen (ui switch `wide-top`, wide-top.ts). Where the rows go is
 * checked in a real browser (tests/artificer-wide-top.spec.ts) and by screenshot (`ui-hud`); here,
 * the switch and the weather row's two halves: its button, which goes in the tab row, and what it
 * opens, which stays under the tabs.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { weatherRow, weatherToggle, weatherUnder, type RowChip } from './weather-row';
import { WIDE_TOP_FEATURE, WIDE_TOP_QUERY } from './wide-top';

const en = makeT('en');
const chips: RowChip[] = [
  { id: 'sky', icon: '🌫', text: 'Fog', full: 'Fog lies over the land.' },
  { id: 'felt', icon: '', text: 'Chilly', full: 'Chilly in the morning.' },
];
const head = { chips, time: en('time.short.early') };

describe('fewer rows on top on a wide screen (#1998)', () => {
  it('is a ui switch, on by default, after the other ui switches, that no run saves', () => {
    expect(featureById(WIDE_TOP_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1998 });
    expect(uiFeatureOn({}, WIDE_TOP_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [WIDE_TOP_FEATURE]: false }, WIDE_TOP_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(WIDE_TOP_FEATURE);
    expect(FEATURES.findIndex(f => f.id === WIDE_TOP_FEATURE)).toBeGreaterThan(FEATURES.findIndex(f => f.id === 'day-forecast'));
  });

  it('is wide where the tabs stay at the top: past the bottom bar\'s 900px', () => {
    expect(WIDE_TOP_QUERY).toBe('(min-width: 901px)');
  });

  it('the row\'s button is the row\'s own, with the class it carries in the tab row', () => {
    const b = weatherToggle({ ...head, open: false }, en, 'wxtab');
    expect(b).toMatch(/^<button type="button" class="foldhead wxtoggle wxonerow wxtab" data-wxfold aria-expanded="false"/);
    expect(b).toContain('🌫 Fog · Chilly · early morning');
    // The same button the one-row box has (#1825), without the class.
    expect(weatherRow({ ...head, open: false, hint: false, details: '' }, en)).toContain(weatherToggle({ ...head, open: false }, en));
  });

  it('under the tabs: the full box while it\'s open, else a blizzard\'s warning, else nothing, and never the "tap here"', () => {
    const details = '<p>the full box</p>';
    const banner = '<p class="lockbanner">A blizzard.</p>';
    expect(weatherUnder({ open: true, banner, details })).toBe(`<div class="wxbox wxone open"><div class="wxonedetails">${details}</div></div>`);
    expect(weatherUnder({ open: false, banner, details })).toBe(`<div class="wxbox wxone">${banner}</div>`);
    expect(weatherUnder({ open: false, banner: '', details })).toBe('');
    expect(weatherUnder({ open: false, details })).toBe('');
    expect(weatherUnder({ open: false, banner, details })).not.toContain(en('wx.hint'));
  });
});
