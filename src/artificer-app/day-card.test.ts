/**
 * The day's result as a card (#1929): what the card says, worked out from the plays the timer ends
 * with, and its markup in en and sv. How it looks is checked by screenshot (the issue is `ui-hud`).
 */

import { describe, it, expect } from 'vitest';
import { makeT } from '../artificer/i18n';
import { featureById, uiFeatureOn } from '../artificer/features';
import { keyMetrics } from '../artificer/key-metrics';
import { chooseSite, createRegion1, runAction, type LogEntry, type QueueItem, type Region1State } from '../artificer/region1';
import { theftLine } from '../artificer/camp-scavengers';
import { FLAT_WORLD } from '../artificer/world';
import { enqueue, makeWarden, type AppState } from './controller';
import { playAct, playDay, playStopped, playWholeQueue, type DayPlay } from './playback';
import { CARD_HARDSHIPS, DAY_CARD_FEATURE, dayCardHtml, dayCardOf, journalButton, journalSheet, skyTomorrow } from './day-card';

function ready(id: string, features?: Record<string, boolean>): AppState {
  // Scouting and surveying straight away, then camp in the cave: as playback.test.ts sets a day up.
  const a = makeWarden({ id }, undefined, { 'action-visibility': false, ...features });
  let s = runAction(a.sim, 'scout');
  s = runAction(s, 'survey');
  s = chooseSite(s, 'cave');
  return { ...a, sim: { ...s, canPlan: true } };
}
const queued = (a: AppState, items: QueueItem[]): AppState => items.reduce(enqueue, a);
const value = (s: Region1State, id: 'food' | 'water' | 'firewood'): number => keyMetrics(s, { needs: false }).find(m => m.id === id)!.value;
const dusk = (p: DayPlay): Region1State => p.steps.at(-1)!.sim;
const en = makeT('en'), sv = makeT('sv');

describe('the day card switch (#1929)', () => {
  it('is a ui switch, on by default, that a player can turn off', () => {
    expect(featureById(DAY_CARD_FEATURE)).toMatchObject({ kind: 'ui', default: true, issue: 1929 });
    expect(uiFeatureOn({}, DAY_CARD_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [DAY_CARD_FEATURE]: false }, DAY_CARD_FEATURE)).toBe(false);
  });
});

describe('what the card says (#1929)', () => {
  const p = playDay(queued(ready('w-1929-day'), ['wood', 'water', 'gather', 'wood', 'water']));

  it('brought back is each store that rose from morning to dusk, and the night each that moved by morning', () => {
    expect(p.night).toBe(true);
    const c = dayCardOf([p], false)!;
    expect(c.from).toBe(p.before.sim.day);
    expect(c.to).toBe(p.before.sim.day);
    expect(c.morning).toBe(p.after.sim);
    for (const id of ['food', 'water', 'firewood'] as const) {
      const day = value(dusk(p), id) - value(p.before.sim, id);
      const night = value(p.after.sim, id) - value(dusk(p), id);
      expect(c.brought.find(x => x.id === id)?.n ?? 0).toBe(Math.max(0, day));
      expect(c.night.find(x => x.id === id)?.n ?? 0).toBe(night);
    }
    // A day of wood and water brings both back, and the night eats and burns.
    expect(c.brought.map(x => x.id)).toEqual(expect.arrayContaining(['water', 'firewood']));
    expect(c.night.some(x => x.n < 0)).toBe(true);
  });

  it('lists the night\'s hardships as the sim wrote them, and only the night\'s', () => {
    // A fox at the meat, written into the night as the sim words it (camp-scavengers.ts theftLine).
    const fox: LogEntry = { day: p.before.sim.day, text: theftLine({ thief: 'fox', taken: 2 } as Parameters<typeof theftLine>[0], true), kind: 'hardship' };
    const robbed: DayPlay = { ...p, after: { ...p.after, sim: { ...p.after.sim, log: [...p.after.sim.log, fox] } } };
    const c = dayCardOf([robbed], false)!;
    expect(c.hardships).toContainEqual(fox);
    // The day's own lines (before dusk) aren't the night's.
    expect(c.hardships.every(l => !dusk(p).log.includes(l))).toBe(true);
    expect(dayCardHtml(c, en)).toContain('A fox got at the meat in the night: 2 raw food gone');
    // In Swedish the line is read back as the journal reads it, not left in English.
    expect(dayCardHtml(c, sv)).not.toContain('A fox got at the meat');
  });

  it('shows at most four hardships and says how many more are in the journal', () => {
    const extra: LogEntry[] = Array.from({ length: CARD_HARDSHIPS + 2 }, (_, i) => ({ day: 1, text: `${i + 1} raw food went bad.`, kind: 'hardship' }));
    const bad: DayPlay = { ...p, after: { ...p.after, sim: { ...p.after.sim, log: [...p.after.sim.log, ...extra] } } };
    const html = dayCardHtml(dayCardOf([bad], false)!, en);
    expect(html.match(/<li class="bad">/g)?.length).toBe(CARD_HARDSHIPS);
    expect(html).toMatch(/…and \d+ more in the journal\./);
  });

  it('several days of a whole queue make one card: their gains and their nights added up', () => {
    const days = playWholeQueue(queued(ready('w-1929-days'), ['wood', 'wood', 'wood', 'water', 'wood', 'wood', 'wood', 'water', 'wood', 'wood', 'wood']));
    const nights = days.filter(d => d.night);
    expect(nights.length).toBeGreaterThan(1);
    const c = dayCardOf(days, false)!;
    expect(c.from).toBe(days[0].before.sim.day);
    expect(c.to).toBe(days.at(-1)!.before.sim.day);
    const fw = nights.reduce((n, d) => n + value(d.after.sim, 'firewood') - value(dusk(d), 'firewood'), 0);
    expect(c.night.find(x => x.id === 'firewood')?.n ?? 0).toBe(fw);
    expect(dayCardHtml(c, en)).toContain(`Days ${c.from}–${c.to} are done`);
    expect(dayCardHtml(c, sv)).toContain(`Dag ${c.from}–${c.to} är slut`);
  });

  it('no card when no day ended: a day stopped partway, one thing done by hand, or a run that\'s over', () => {
    const a = queued(ready('w-1929-none'), ['wood', 'water']);
    expect(dayCardOf([playStopped(a, { action: 0, hours: 1 })], false)).toBeNull();
    expect(dayCardOf([playAct(ready('w-1929-hand'), 'water')], false)).toBeNull();
    const over: DayPlay = { ...p, after: { ...p.after, sim: { ...p.after.sim, outcome: { choice: 'collapse', kind: 'collapsed', vitals: p.after.sim.vitals } } } };
    expect(dayCardOf([over], false)).toBeNull();
    expect(dayCardOf([], false)).toBeNull();
  });
});

describe('the card\'s markup (#1929)', () => {
  const p = playDay(queued(ready('w-1929-html'), ['wood', 'water', 'gather']));
  const c = dayCardOf([p], false)!;

  it('says the day, the three parts and the two buttons, in en and sv', () => {
    const html = dayCardHtml(c, en);
    expect(html).toContain(`Day ${c.to} is done`);
    for (const head of ['Brought back', 'The night', 'Tomorrow']) expect(html).toContain(head);
    expect(html).toContain('data-cmd="daycardjournal">Journal</button>');
    expect(html).toContain(`data-cmd="daycardok">On to day ${p.after.sim.day} ▸</button>`);
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="daycard-title"/);
    const s = dayCardHtml(c, sv);
    expect(s).toContain(`Dag ${c.to} är slut`);
    for (const head of ['Det du bar hem', 'Natten', 'I morgon']) expect(s).toContain(head);
    expect(s).toContain(`Vidare till dag ${p.after.sim.day} ▸`);
  });

  it('a change reads "+3 firewood" or "−1 food", with a real minus', () => {
    const html = dayCardHtml({ ...c, brought: [{ id: 'firewood', n: 3 }], night: [{ id: 'food', n: -1 }] }, en);
    expect(html).toContain('+3 firewood');
    expect(html).toContain('−1 food');
    expect(dayCardHtml({ ...c, brought: [{ id: 'water', n: 2 }], night: [{ id: 'firewood', n: -4 }] }, sv)).toMatch(/\+2 vatten[\s\S]*−4 ved/);
  });

  it('a day with nothing brought back, and a night with nothing taken, say so', () => {
    const html = dayCardHtml({ ...c, brought: [], trips: [], night: [], hardships: [] }, en);
    expect(html).toContain('Nothing brought back today.');
    expect(html).toContain('A quiet night.');
  });
});

describe('tomorrow\'s sky (#1929)', () => {
  it('is the morning\'s sky and how it feels, as the weather box says them', () => {
    const s = playDay(queued(ready('w-1929-sky'), ['wood'])).after.sim;
    const line = skyTomorrow(s, en)!;
    expect(line.length).toBeGreaterThan(4);
    expect(line).toContain(en(`wx.sky.${s.weatherToday}` as Parameters<typeof en>[0]).split(' ')[0]);
  });

  it('with the weather in words off, the weather\'s name; in a world with no weather, nothing', () => {
    const s = playDay(queued(ready('w-1929-num', { 'weather-words': false }), ['wood'])).after.sim;
    expect(skyTomorrow(s, en)).toMatch(/^\S+ \S/);
    expect(skyTomorrow(createRegion1({ world: FLAT_WORLD }), en)).toBeNull();
  });
});

describe('the journal one tap away (#1929)', () => {
  it('the status bar\'s button and the sheet, in en and sv', () => {
    expect(journalButton(en)).toContain('data-cmd="jsheet"');
    expect(journalButton(en)).toContain('aria-label="Journal"');
    expect(journalButton(sv)).toContain('aria-label="Dagbok"');
    const sheet = journalSheet('<li>a line</li>', en);
    expect(sheet).toContain('<ul class="full"><li>a line</li></ul>');
    expect(sheet).toContain('data-cmd="jsheetclose">Close</button>');
    expect(journalSheet('', sv)).toContain('>Stäng</button>');
  });
});
