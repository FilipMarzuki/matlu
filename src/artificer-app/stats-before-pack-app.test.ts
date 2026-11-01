/**
 * Who you are, then what you pack (#1872): the intro's order (acceptance 1) and the pack screen
 * drawn for the Warden just made (acceptance 2), in English and Swedish.
 */

import { describe, it, expect } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1 } from '../artificer/region1';
import { ruleFeatures } from '../artificer/features';
import { DEFAULT_STATS } from '../artificer/stats';
import { SUGGESTED_PACK, suggestedPack, offeredKit, carryLimit } from '../artificer/kit';
import { makeWarden } from './controller';
import { introBeats } from './intro';
import { packForm } from './opening-view';

// Change on the quick start's card (#1928), the intro's only creation and pack screens since #2009.
const CHANGE = { step: 'change' as const, age: 12 };
const ids = (s: Parameters<typeof introBeats>[0], lang: 'en' | 'sv' = 'en') => introBeats(s, makeT(lang), CHANGE).map(b => b.id);

describe('the create screen comes before the pack (#1872, acceptance 1)', () => {
  it('with the switch on: the story page, create, pack, then the card, in en and sv', () => {
    const s = makeWarden({ id: 'w-1872-intro' }).sim;
    for (const lang of ['en', 'sv'] as const) expect(ids(s, lang)).toEqual(['fall', 'create', 'pack', 'ready']);
    // Asked in the scout's own voice.
    expect(introBeats(s, makeT('en'), CHANGE).find(b => b.id === 'create')!.lines).toEqual(['Who are you?']);
    expect(introBeats(s, makeT('sv'), CHANGE).find(b => b.id === 'create')!.lines).toEqual(['Vem är du?']);
  });

  it('with the switch off, or for a run from before it, the pack comes first', () => {
    for (const lang of ['en', 'sv'] as const) {
      expect(ids(makeWarden({ id: 'w-1872-off' }, undefined, { 'stats-before-pack': false }).sim, lang)).toEqual(['fall', 'pack', 'create', 'ready']);
      expect(ids(createRegion1(), lang)).toEqual(['fall', 'pack', 'create', 'ready']);
    }
  });

  it('a Warden who follows someone still hears what was left, on the card', () => {
    const s = makeWarden({ id: 'w-1872-left' }, { known: [], concepts: {}, heirlooms: [{ item: 'stone-knife', grade: 'masterwork' }] }).sim;
    expect(ids(s)).toEqual(['fall', 'create', 'pack', 'ready']);
    expect(introBeats(s, makeT('en'), CHANGE).at(-1)!.lines).toContain('Someone was here before you.');
  });
});

describe('the pack screen for the Warden just made (#1872, acceptance 2)', () => {
  // The weight's screen: `pack-volume` (#1871) off, where the carry weight is the pack's limit. The
  // volume's screen with this switch on is in artificer/stats-before-pack.test.ts.
  const features = ruleFeatures({ 'pack-volume': false });
  const list = offeredKit(features);

  it('says what this Warden carries, ticks their list, and its button resets to it, in en and sv', () => {
    // STR 12 chosen is STR 8 at 12 (growing.ts): 11 kg, read off the Strength they have now.
    const strong = makeWarden({ id: 'w-1872-pf', stats: { ...DEFAULT_STATS, str: 12 } }, undefined, features).sim;
    const pack = suggestedPack(features, strong.character.stats, []);
    const limit = carryLimit(strong);
    const en = packForm(pack, makeT('en'), false, {}, list, { limit, forYou: true });
    expect(en).toContain('With your strength, everything else has to fit in 11 kg.');
    expect(en).toContain('TICKED FOR YOU');
    expect(en).toContain('/ 11 kg');
    const sv = packForm(pack, makeT('sv'), false, {}, list, { limit, forYou: true });
    expect(sv).toContain('Med din styrka måste allt annat rymmas i 11 kg.');
    expect(sv).toContain('FÖRBOCKAD FÖR DIG');
    // Ticked, and every item still a button the player can press (the ticked ones to take out).
    for (const id of pack) expect(en).toMatch(new RegExp(`data-kit="${id}" aria-pressed="true" `));
    expect(en).toMatch(/data-kit="comic" aria-pressed="false" /);
  });

  it('a heavier item fits a strong Warden\'s screen and not an average one\'s', () => {
    const full = [...SUGGESTED_PACK, 'tarp', 'trangia'] as const; // 8.32 kg
    const tent = /data-kit="family-tent" aria-pressed="false" disabled/;
    // A 4.5 kg tent: no for 9 kg, no for 11 kg either (12.82 kg) — but the 0.6 kg thermos fits 11 kg, not 9.
    expect(packForm([...full], makeT('en'), false, {}, list, { limit: 11, forYou: true })).toMatch(tent);
    expect(packForm([...full, 'spare-socks'], makeT('en'), false, {}, list, { limit: 11, forYou: true })).not.toMatch(/data-kit="thermos" aria-pressed="false" disabled/);
    expect(packForm([...full, 'spare-socks'], makeT('en'), false, {}, list)).toMatch(/data-kit="thermos" aria-pressed="false" disabled/);
  });

  it('off, the screen is as before: 9 kg and the leader\'s list', () => {
    const html = packForm([...SUGGESTED_PACK], makeT('en'), false, {}, list);
    expect(html).toContain('Everything else has to fit in 9 kg.');
    expect(html).toContain('THE LEADER&#39;S LIST');
    expect(html).not.toContain('TICKED FOR YOU');
  });
});
