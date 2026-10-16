/**
 * #1787: the WARDEN tab wears the Warden's own name, exactly as typed (no uppercasing), with the
 * catalog's name only until there is one. The full name rides in title / aria-label (CSS cuts a
 * long one short), and the name is escaped like all player text.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { tabLabel } from './html';

const en = makeT('en');
const sv = makeT('sv');

describe('tabLabel (#1787)', () => {
  it('shows the Warden\'s name as typed, with the full name as title and aria-label', () => {
    const l = tabLabel('warden', 'bob', en);
    expect(l.label).toBe('<span class="tabname">bob</span>');
    expect(l.attrs).toBe(' title="bob" aria-label="bob"');
  });

  it('keeps the case the name was typed in, Swedish letters included', () => {
    expect(tabLabel('warden', 'Åsa öberg', sv).label).toBe('<span class="tabname">Åsa öberg</span>');
  });

  it('trims surrounding whitespace', () => {
    expect(tabLabel('warden', '  bob ', en).label).toBe('<span class="tabname">bob</span>');
  });

  it('falls back to the catalog name before a name exists or when it is blank', () => {
    for (const name of [null, undefined, '', '   ']) {
      expect(tabLabel('warden', name, en)).toEqual({ attrs: '', label: 'WARDEN' });
      expect(tabLabel('warden', name, sv)).toEqual({ attrs: '', label: 'VÄKTAREN' });
    }
  });

  it('leaves the other tabs as the catalog names them', () => {
    expect(tabLabel('plan', 'bob', en)).toEqual({ attrs: '', label: en('tab.plan') });
    expect(tabLabel('journal', 'bob', sv)).toEqual({ attrs: '', label: sv('tab.journal') });
  });

  it('escapes the name in the label and the attributes', () => {
    const l = tabLabel('warden', '<b>"x"</b>&\'', en);
    const escaped = '&#60;b&#62;&#34;x&#34;&#60;/b&#62;&#38;&#39;';
    expect(l.label).toBe(`<span class="tabname">${escaped}</span>`);
    expect(l.attrs).toBe(` title="${escaped}" aria-label="${escaped}"`);
  });
});
