import { describe, expect, it } from 'vitest';
import { CATALOGS, LANGS, makeT, parseLang, translate, varsOf, type Catalogs, type Key } from './index';
import { en } from './en';
import { sv } from './sv';

// #1704 acceptance: the catalog is complete in Swedish, and `t` falls back and fills vars.

describe('the string catalog (#1704)', () => {
  it('has every English key in Swedish, with the same {vars}', () => {
    const keys = Object.keys(en) as Key[];
    const missing = keys.filter(k => typeof sv[k] !== 'string' || !sv[k]!.trim());
    expect(missing).toEqual([]);
    const varsDiffer = keys.filter(k => sv[k] !== undefined && varsOf(sv[k]!).join(',') !== varsOf(en[k]).join(','));
    expect(varsDiffer).toEqual([]);
    // And nothing in Swedish that English doesn't have (a key renamed in one catalog only).
    expect(Object.keys(sv).filter(k => !(k in en))).toEqual([]);
  });

  it('falls back to English for a key a language lacks, and fills {vars}', () => {
    // A Swedish catalog still being written: it has the tab label but not the day counter.
    const partial: Catalogs = { en: CATALOGS.en, sv: { 'tab.plan': 'PLAN-SV' } };
    const t = makeT('sv', partial);
    expect(t('tab.plan')).toBe('PLAN-SV');
    expect(t('queue.day', { n: 7 })).toBe('DAY 7');
    expect(translate('sv', 'btn.enter', { name: 'HOLLOWFORD' }, partial)).toBe('ENTER HOLLOWFORD');
    // With the real catalogs, the Swedish string with its vars filled.
    expect(makeT('sv')('timer.days', { n: 2, total: 3 })).toBe(' · 2 AV 3 DAGAR');
    // A var left out stays visible, so the mistake shows on screen.
    expect(makeT('en')('queue.day')).toBe('DAY {n}');
  });

  it('knows its languages, and nothing else', () => {
    expect(LANGS).toEqual(['sv', 'en']);
    expect(parseLang('sv')).toBe('sv');
    expect(parseLang('en')).toBe('en');
    for (const bad of ['', 'SV', 'de', 'english', null, undefined, 3, {}]) expect(parseLang(bad)).toBeNull();
  });
});
