/**
 * Make camp's picker (#1986): when Make camp opens it, what it lists, and the card's tap. How it
 * looks is checked by screenshot (the issue is `ui-menus`).
 */

import { describe, it, expect } from 'vitest';
import { makeT } from '../artificer/i18n';
import { featureById, uiFeatureOn } from '../artificer/features';
import { knownSpots } from '../artificer/camp-sites';
import { endDay, runAction, type QueueItem, type Region1State } from '../artificer/region1';
import { makeWarden, previewQueue, type AppState } from './controller';
import { paletteBlock } from './camp-blocks';
import { spotReading } from './sim-words';
import { CAMP_PICKER_FEATURE, campPicker, pickerFor } from './camp-picker';

const en = makeT('en'), sv = makeT('sv');

/** A Warden who knows two places to camp: close by, then a little further out (as the browser test's save). */
function explored(features?: Record<string, boolean>): AppState {
  const a = makeWarden({ id: 'w-camp-picker' }, undefined, features);
  let s: Region1State = a.sim;
  for (const q of ['scout', 'survey', 'explore', 'scout', 'explore', 'scout@2', 'explore@2'] as QueueItem[]) {
    s = runAction(s, q);
    if (s.hoursToday >= 12) s = endDay(s);
  }
  return { ...a, sim: { ...s, canPlan: true } };
}

describe('the camp picker switch (#1986)', () => {
  it('is a ui switch, on by default, that a player can turn off', () => {
    expect(featureById(CAMP_PICKER_FEATURE)).toMatchObject({ kind: 'ui', default: true, issue: 1986 });
    expect(uiFeatureOn({}, CAMP_PICKER_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [CAMP_PICKER_FEATURE]: false }, CAMP_PICKER_FEATURE)).toBe(false);
  });

  it('Make camp opens it only with the switch on, where camp is an action', () => {
    expect(pickerFor(explored().sim, true)).toBe(true);
    expect(pickerFor(explored().sim, false)).toBe(false);
    expect(pickerFor(explored({ 'camp-as-action': false }).sim, true)).toBe(false);
  });
});

describe('what the picker lists (#1986)', () => {
  const s = explored().sim;
  const spots = knownSpots(s);

  it('every place to camp you know, each with what you can tell of its surroundings, in en and sv', () => {
    expect(spots.length).toBeGreaterThanOrEqual(2);
    for (const [t, title, cancel] of [[en, 'Where will you make camp?', 'Cancel'], [sv, 'Var slår du läger?', 'Avbryt']] as const) {
      const html = campPicker(s, t);
      expect(html).toContain(`<h2 id="campick-title">${title}</h2>`);
      expect(html).toContain(`data-cmd="campickclose">${cancel}</button>`);
      expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="campick-title"/);
      for (const p of spots) {
        expect(html).toContain(`data-camp="${p.id}"`);
        // The reading (wind, damp, water and wood), escaped as the page draws it.
        expect(html).toContain(spotReading(s, p, t).replace(/'/g, '&#39;'));
      }
    }
  });

  it('the camp you\'re at is in the list, and can\'t be picked', () => {
    const at = spots[1];
    const camped = runAction(s, { q: 'camp', opts: { spot: at.id } } as QueueItem);
    const here = knownSpots(camped).find(p => p.here);
    expect(here?.id).toBe(at.id);
    expect(campPicker(camped, en)).toMatch(new RegExp(`class="siteopt chosen" data-camp="${at.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" disabled`));
  });
});

describe('the Make camp card\'s tap (#1986)', () => {
  const a = explored();
  const opts = { dev: false, t: en, fewer: false };

  it('opens the picker with it on, and queues Make camp itself with it off, as before', () => {
    const on = paletteBlock(a, previewQueue(a), { ...opts, campPick: true });
    expect(on).toContain('data-campick aria-haspopup="dialog"');
    expect(on).not.toContain('data-q="camp"');
    const off = paletteBlock(a, previewQueue(a), { ...opts, campPick: false });
    expect(off).toContain('data-q="camp"');
    expect(off).not.toContain('data-campick');
  });
});
