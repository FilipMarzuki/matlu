/**
 * The phone's queue as day bars (#2011). Unfolded on a phone, each queued activity used to be a card
 * of its own, two or three lines tall with its own load bar, so two activities and the Run bar filled
 * most of the screen. The owner: "We can share one bar. And have the activities under or over it on
 * one row. Separate them on the time/day bar by a line or color instead."
 *
 * So each day of the queue is one bar over the day's hours:
 *
 *   TODAY                        6 / 14h
 *   [● 💧 Water 2h] [● 🪵 Wood 4h]          ← the activities in one row; tap one for its details
 *   ▓▓▓▓|████████|·····················     ← one segment each, as long as its hours
 *
 * The segments take turns at four colors (`tone`), each chip has a dot in its segment's color, and a
 * line separates them (a gap in the bar). Hours already gone today are greyed at the start. A day
 * planned past its hours (the sim lets it run on into the dark) draws to scale with a tick where the
 * day's hours end. An activity that will be skipped has no segment and no color: its chip is struck
 * through. A chip says ? while its activity needs a choice, and ⚠ while its row warns.
 *
 * Pure: the model (`dayBars`) from plain numbers, and its HTML (`dayBarsHtml`), so a test can check
 * both without a browser. main.ts gathers the numbers from the queue's preview and draws the chosen
 * activity's details (its full row) under the bars.
 */

import type { T } from '../artificer/i18n';
import { esc, hrs } from './html';

/** One queued activity, as the bars need it. */
export interface BarItem {
  /** Its place in the queue. */
  i: number;
  icon: string;
  /** Its short name (and distance word), as the compact queue says it. */
  name: string;
  /** Its hours. */
  hours: number;
  /** Which day of the queue it runs on: 0 today, 1 tomorrow… */
  day: number;
  /** It will be skipped (the preview says why), so it takes no time. */
  skip: boolean;
  /** Something on its row warns: danger, strain, unease, a load too heavy. Its chip is marked ⚠. */
  warn: boolean;
  /** It needs a choice before it can run (an option left open). Its chip is marked ?. */
  need: boolean;
}

/** One segment of a bar: where it starts and how long, in hours. */
export interface BarSeg { i: number; from: number; hours: number; tone: number }

/** One day's bar. */
export interface DayBar {
  day: number;
  /** Hours already gone before the first activity (today only). */
  spent: number;
  segs: BarSeg[];
  /** Every activity that day, in order, skipped ones too: the row of chips. `tone` is its segment's color; null without one. */
  items: (BarItem & { tone: number | null })[];
  /** Where the day's planned time ends, in hours. */
  end: number;
  /** The bar's length in hours: the day's hours, or longer when the plan runs past them. */
  scale: number;
}

/** How many colors the segments take turns at (style.css `.dbt0`…`.dbt3`). */
export const TONES = 4;

/**
 * The bars, one per day of the queue (days with nothing queued between two that have something get
 * an empty bar, so the days read in order). `spentToday`: hours already gone today. `dayHours`: the
 * working day (region1.ts `DAY_HOURS`).
 */
export function dayBars(items: readonly BarItem[], spentToday: number, dayHours: number): DayBar[] {
  const days = items.length ? Math.max(...items.map(x => x.day)) + 1 : 0;
  return Array.from({ length: days }, (_, day) => {
    const spent = day === 0 ? Math.max(0, spentToday) : 0;
    let at = spent;
    let k = 0;
    const segs: BarSeg[] = [];
    // Only activities that take time get a color, so two segments side by side never share one.
    const chips = items.filter(x => x.day === day).map(x => {
      if (x.skip || x.hours <= 0) return { ...x, tone: null };
      const tone = k++ % TONES;
      segs.push({ i: x.i, from: at, hours: x.hours, tone });
      at += x.hours;
      return { ...x, tone };
    });
    return { day, spent, segs, items: chips, end: at, scale: Math.max(dayHours, at) };
  });
}

/** A length on the bar as a CSS percentage, rounded so the HTML stays short and stable. */
const pc = (h: number, scale: number): string => `${Math.round((h / scale) * 1000) / 10}%`;

/** What the bars' HTML needs besides the model. */
export interface BarsView {
  /** The activity whose details are open, or null. */
  sel: number | null;
  /** A day's name: TODAY, DAY 15. */
  dayName: (day: number) => string;
  /** The working day's hours, for "6 / 14h". */
  dayHours: number;
  t: T;
}

/**
 * The bars' HTML. Each chip is a button (`data-qsel`, the activity's place in the queue) that opens or
 * shuts that activity's details (one that needs a choice stays open until it has one), which main.ts draws under the bars as `#qseldetail`. The bar itself
 * is a picture of what the chips say, so it's hidden from screen readers.
 */
export function dayBarsHtml(bars: readonly DayBar[], v: BarsView): string {
  const { t } = v;
  return bars.map(b => {
    const chips = b.items.map(x => {
      const on = v.sel === x.i;
      const cls = `dbchip ${x.tone === null ? 'dbtnone' : `dbt${x.tone}`}${on ? ' on' : ''}${x.skip ? ' skip' : ''}`;
      return `<button class="${cls}" data-qsel="${x.i}" aria-pressed="${on}" aria-controls="qseldetail">`
        + `<i class="dbdot" aria-hidden="true"></i><span class="qci">${x.icon}</span> ${esc(x.name)} <b>${esc(`${hrs(x.hours, t)}h`)}</b>`
        + `${x.need ? ' <span class="dbneed" aria-hidden="true">?</span>' : ''}${x.warn && !x.skip ? ' <span class="dbwarn" aria-hidden="true">⚠</span>' : ''}</button>`;
    }).join('');
    const spent = b.spent > 0 ? `<i class="dbspent" style="width:${pc(b.spent, b.scale)}"></i>` : '';
    const segs = b.segs.map(s => `<i class="dbseg dbt${s.tone}${v.sel === s.i ? ' on' : ''}" style="left:${pc(s.from, b.scale)};width:${pc(s.hours, b.scale)}"></i>`).join('');
    const dusk = b.scale > v.dayHours ? `<i class="dbdusk" style="left:${pc(v.dayHours, b.scale)}"></i>` : '';
    const total = esc(t('qc.total', { h: hrs(b.end, t), max: v.dayHours }));
    return `<div class="dayb" data-day="${b.day}"><div class="dbhead"><span class="dbname">${esc(v.dayName(b.day))}</span><span class="dbtot">${total}</span></div>`
      + `<div class="dbchips">${chips}</div><div class="dbbar" aria-hidden="true">${spent}${segs}${dusk}</div></div>`;
  }).join('');
}
