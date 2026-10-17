/**
 * #1807: the Warden's view is reached in one place, the header's icon and name. The tab row has no
 * Warden tab (on the Reach or on the road), the button is there for any Warden (named or not), it's
 * pressed while the Warden's view is open, and a kept `warden` still opens that view.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { wardenButton } from './html';
import { APP_TABS, keptTab, viewToOpen, visibleTabs } from './feature-choices';

const en = makeT('en');
const sv = makeT('sv');
const base = { portrait: null, rank: 'Novice', data: 'tab' as const };

describe('the header button is the one way into the Warden (#1807)', () => {
  it('the tab row has no Warden tab, whatever is held or shown', () => {
    expect(APP_TABS.map(d => d.id)).not.toContain('warden');
    expect(visibleTabs(APP_TABS, { dev: true, camp: true }).map(d => d.id)).not.toContain('warden');
  });

  it('a kept `warden` opens the Warden view, with the guide holding every tab back or not', () => {
    expect(keptTab('warden')).toBe('warden');
    const held = new Set(['camp', 'land', 'history', 'progress']);
    for (const view of [{ dev: false, camp: false }, { dev: false, camp: false, held }, { dev: true, camp: true }]) {
      expect(viewToOpen('warden', APP_TABS, view)).toBe('warden');
    }
    expect(viewToOpen('land', APP_TABS, { dev: false, camp: false, held })).toBe('plan');
    expect(viewToOpen('nothing', APP_TABS, { dev: false, camp: false })).toBe('plan');
  });

  it('opens the Warden view, and is pressed (with the open style) only while it shows', () => {
    const shut = wardenButton({ ...base, name: 'bob', open: false }, en);
    expect(shut).toContain('data-tab="warden"');
    expect(shut).toContain('aria-pressed="false"');
    expect(shut).toMatch(/^<button class="who" /);
    const open = wardenButton({ ...base, name: 'bob', open: true }, en);
    expect(open).toContain('aria-pressed="true"');
    expect(open).toMatch(/^<button class="who on" /);
  });

  it('on the road it opens the road\'s Warden view', () => {
    expect(wardenButton({ ...base, name: 'bob', open: false, data: 'rtab' }, en)).toContain('data-rtab="warden"');
  });

  it('shows the name as typed, and is there for an unnamed Warden too', () => {
    expect(wardenButton({ ...base, name: '  Åsa öberg ', open: false }, sv)).toContain('<b>Åsa öberg</b> · Novice');
    for (const name of [null, undefined, '', '   ']) {
      expect(wardenButton({ ...base, name, open: false }, en)).toContain(`<b>${en('top.yourWarden')}</b>`);
      expect(wardenButton({ ...base, name, open: false }, sv)).toContain(`<b>${sv('top.yourWarden')}</b>`);
    }
  });

  it('carries the guide\'s glow attributes, and escapes the name and rank', () => {
    expect(wardenButton({ ...base, name: 'bob', open: false, attrs: ' data-glow' }, en)).toContain(' data-glow ');
    const html = wardenButton({ ...base, name: '<b>"x"</b>&\'', rank: '<i>', open: false }, en);
    expect(html).toContain('&#60;b&#62;&#34;x&#34;&#60;/b&#62;&#38;&#39;');
    expect(html).toContain('&#60;i&#62;');
    expect(html).not.toContain('<i>');
  });
});
