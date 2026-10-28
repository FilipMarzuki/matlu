/**
 * #1995: the three vital dots on the Warden view, each with its label: the resource's name and its
 * word, and from day 8 the number, in the status bar's colours and words. Held back while the
 * first-morning guide hasn't shown the vitals. How it looks is checked by screenshot (`ui-hud`).
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { CAP_CEIL } from '../artificer/vitality';
import { makeWarden } from './controller';
import { BARS_FROM_DAY, vitalDot, vitalLevel, vitalReadings, vitalWord, vitalsLabelled, type VitalId, type VitalReading } from './vital-words';
import { wardenTab } from './warden-view';

const en = makeT('en');
const sv = makeT('sv');

const reading = (id: VitalId, current: number, cap = 100): VitalReading => ({ id, current, cap, max: 100 });
/** One resource at each of three levels: full, halfway, nearly empty. */
const mixed: VitalReading[] = [reading('vigor', 90), reading('clarity', 50), reading('reserve', 10)];
const items = (html: string): string[] => [...html.matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1]);
const text = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('the labelled vitals (#1995)', () => {
  it('each dot has its name and word beside it, in the status bar\'s colour and word', () => {
    const html = vitalsLabelled(mixed, 1, en);
    const li = items(html);
    expect(li).toHaveLength(3);
    expect(li.map(text)).toEqual(['Vigor Energized', 'Clarity Clear', 'Reserve Failing']);
    for (const [i, r] of mixed.entries()) {
      const lv = vitalLevel(r.current, r.cap);
      // The same band class the status bar's dot has (vitalDot), so the colours match.
      const band = /class="vdot (\w+)"/.exec(vitalDot(r, en))![1];
      expect(li[i]).toContain(`class="vdot ${band}"`);
      expect(li[i]).toContain(`<b>${vitalWord(r.id, lv, en)}</b>`);
    }
    // The words say it all, so the dot isn't read out on its own.
    expect(html).not.toContain('role="img"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('in Swedish', () => {
    expect(items(vitalsLabelled(mixed, 1, sv)).map(text)).toEqual(['Kraft Pigg', 'Klarhet Ok', 'Reserv Svag']);
  });

  it('the first week the words only; from day 8 the number too, as the header\'s bars', () => {
    expect(vitalsLabelled(mixed, BARS_FROM_DAY - 1, en)).not.toContain('wvnum');
    const later = items(vitalsLabelled(mixed, BARS_FROM_DAY, en)).map(text);
    expect(later).toEqual(['Vigor Energized 90', 'Clarity Clear 50', 'Reserve Failing 10']);
  });

  it('read from the run as the status bar reads it: Vigor and Clarity against today\'s cap, Reserve out of 100', () => {
    const s = makeWarden({ id: 'w-1995' }).sim;
    expect(vitalReadings(s)).toEqual([
      { id: 'vigor', current: s.vitals.vigor.current, cap: s.vitals.vigor.cap, max: CAP_CEIL },
      { id: 'clarity', current: s.vitals.clarity.current, cap: s.vitals.clarity.cap, max: CAP_CEIL },
      { id: 'reserve', current: s.vitals.condition, cap: 100, max: 100 },
    ]);
  });

  it('on the Warden view under the name and rank, unless the guide hasn\'t shown the vitals yet', () => {
    const a = makeWarden({ id: 'w-1995', name: 'Saga' });
    const shown = wardenTab(a, en, false, '', true);
    expect(shown).toContain('<ul class="wvitals">');
    expect(shown.indexOf('class="wrank"')).toBeLessThan(shown.indexOf('class="wvitals"'));
    expect(shown.indexOf('class="wvitals"')).toBeLessThan(shown.indexOf('</div></div>'));
    expect(wardenTab(a, en, false, '')).not.toContain('wvitals');
    expect(wardenTab(a, en, false, '', false)).not.toContain('wvitals');
  });
});
