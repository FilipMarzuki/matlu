/**
 * The phone's queue as day bars (#2011, day-bar.ts). The look is exempt (`ui-hud`: screenshots and
 * a browser spec, tests/artificer-day-bar.spec.ts); what can be checked without a browser is the
 * model: each day's segments follow the hours, skipped activities take none, the colors take turns,
 * a day planned past its hours draws to scale with a tick, and the HTML says what the model does.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { dayBars, dayBarsHtml, TONES, type BarItem } from './day-bar';
import { PHONE_QUEUE_QUERY } from './plan-layout';

const en = makeT('en');
const sv = makeT('sv');
const item = (i: number, hours: number, day = 0, more: Partial<BarItem> = {}): BarItem =>
  ({ i, icon: '💧', name: `Task ${i}`, hours, day, skip: false, warn: false, need: false, ...more });
const view = (sel: number | null = null, t = en) => ({ sel, dayName: (d: number) => (d === 0 ? 'TODAY' : `DAY ${14 + d}`), dayHours: 14, t });

describe('the day bars (#2011)', () => {
  it('Given two activities today, Then one bar with a segment each, end to end, as long as their hours', () => {
    const [b, ...rest] = dayBars([item(0, 2), item(1, 4)], 0, 14);
    expect(rest).toEqual([]);
    expect(b.segs).toEqual([{ i: 0, from: 0, hours: 2, tone: 0 }, { i: 1, from: 2, hours: 4, tone: 1 }]);
    expect(b.end).toBe(6);
    expect(b.scale).toBe(14);
  });

  it('Given hours already gone today, Then the segments start after them, and only today has them', () => {
    const [today, tomorrow] = dayBars([item(0, 3), item(1, 5, 1)], 4, 14);
    expect(today.spent).toBe(4);
    expect(today.segs[0].from).toBe(4);
    expect(tomorrow.spent).toBe(0);
    expect(tomorrow.segs[0]).toEqual({ i: 1, from: 0, hours: 5, tone: 0 });
  });

  it('Given a queue over two days with nothing on the first, Then the empty day still gets its bar, in order', () => {
    expect(dayBars([item(0, 3, 1)], 0, 14).map(b => [b.day, b.segs.length])).toEqual([[0, 0], [1, 1]]);
    expect(dayBars([], 0, 14)).toEqual([]);
  });

  it('Given an activity that will be skipped, Then it keeps its chip but takes no time or color on the bar', () => {
    const [b] = dayBars([item(0, 2), item(1, 3, 0, { skip: true }), item(2, 4)], 0, 14);
    expect(b.items.map(x => x.i)).toEqual([0, 1, 2]);
    expect(b.segs.map(s => [s.i, s.from])).toEqual([[0, 0], [2, 2]]);
    // Only segments take colors, so the two either side of the skipped one still differ.
    expect(b.items.map(x => x.tone)).toEqual([0, null, 1]);
    const [c] = dayBars([item(0, 1), ...[1, 2, 3].map(i => item(i, 1, 0, { skip: true })), item(4, 1)], 0, 14);
    expect(c.segs.map(s => s.tone)).toEqual([0, 1]);
  });

  it(`takes the ${TONES} colors in turn, starting again each day`, () => {
    const [today, tomorrow] = dayBars([...[0, 1, 2, 3, 4].map(i => item(i, 1)), item(5, 1, 1)], 0, 14);
    expect(today.items.map(x => x.tone)).toEqual([0, 1, 2, 3, 0]);
    expect(tomorrow.items[0].tone).toBe(0);
  });

  it('Given a day planned past its hours, Then it draws to scale, with a tick where the hours end', () => {
    const [b] = dayBars([item(0, 10), item(1, 6)], 2, 14);
    expect(b.end).toBe(18);
    expect(b.scale).toBe(18);
    const html = dayBarsHtml([b], view());
    expect(html).toContain('<i class="dbdusk" style="left:77.8%"></i>');
    expect(dayBarsHtml(dayBars([item(0, 3)], 0, 14), view())).not.toContain('dbdusk');
  });
});

describe('the day bars\' HTML (#2011)', () => {
  const bars = dayBars([item(0, 2), item(1, 4, 0, { warn: true }), item(2, 3, 0, { skip: true }), item(3, 1, 0, { need: true })], 0, 14);

  it('a chip per activity that opens its details, pressed when open; the bar hidden from screen readers', () => {
    const html = dayBarsHtml(bars, view(1));
    expect(html.match(/<button class="dbchip/g)).toHaveLength(4);
    expect(html).toContain('<button class="dbchip dbt1 on" data-qsel="1" aria-pressed="true" aria-controls="qseldetail">');
    expect(html).toContain('data-qsel="0" aria-pressed="false"');
    expect(html).toContain('<div class="dbbar" aria-hidden="true">');
    expect(html).toContain('<i class="dbseg dbt1 on" style="left:14.3%;width:28.6%"></i>');
  });

  it('says each day, its hours, and marks a warning, a skip and a choice still to make', () => {
    const html = dayBarsHtml(bars, view());
    expect(html).toContain('<span class="dbname">TODAY</span><span class="dbtot">7 / 14h</span>');
    expect(html).toMatch(/data-qsel="1"[^]*?4h<\/b> <span class="dbwarn" aria-hidden="true">⚠<\/span><\/button>/);
    expect(html).toContain('class="dbchip dbtnone skip"');
    expect(html).toMatch(/data-qsel="3"[^]*?1h<\/b> <span class="dbneed" aria-hidden="true">\?<\/span><\/button>/);
    // A skipped activity is struck through; it doesn't also get a warning.
    expect(html).not.toMatch(/data-qsel="2"[^]*?dbwarn/);
  });

  it('in Swedish, the hours in its own words', () => {
    const html = dayBarsHtml(dayBars([item(0, 2.5)], 0, 14), view(null, sv));
    expect(html).toContain('<b>2,5h</b>');
    expect(html).toContain('2,5 / 14 h');
  });

  it('greys the hours already gone today', () => {
    expect(dayBarsHtml(dayBars([item(0, 2)], 7, 14), view())).toContain('<i class="dbspent" style="width:50%"></i>');
    expect(dayBarsHtml(dayBars([item(0, 2)], 0, 14), view())).not.toContain('dbspent');
  });
});

describe('the phone\'s width (#2011)', () => {
  it('is the width where style.css puts the queue in a strip over the actions', () => {
    expect(PHONE_QUEUE_QUERY).toBe('(max-width: 699px)');
    const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf(`@media ${PHONE_QUEUE_QUERY} {\n  .plan.sideq, .plan.sideq.noq`);
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf('\n}\n', at))).toContain('.plan.sideq .qstrip { display: flex;');
  });
});
