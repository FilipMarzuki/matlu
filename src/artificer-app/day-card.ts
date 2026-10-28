/**
 * The day's result as a card (#1929, roadmap item 7 of #1914, ui switch `day-card`): when the timer
 * ends a day, a short card says what was brought back, what the night took and tomorrow's sky. And
 * the journal as a sheet, one tap from the status bar, instead of at the foot of PLAN.
 *
 * Presentation only. The card is read off the plays the timer already holds (playback.ts): each
 * day's morning (`before`), its dusk (the last step's sim) and the next morning (`after`). It counts
 * the stores the status bar shows (key-metrics.ts) and quotes the night's hardships as the sim wrote
 * them, so it can't tell a different story from the journal. No rule reads it, and no save keeps it.
 * Pure: plays in, HTML out, so the tests draw it without a browser.
 */

import type { T } from '../artificer/i18n';
import { keyMetrics, keyMetricsOf, type KeyMetricId } from '../artificer/key-metrics';
import type { LogEntry, Region1State } from '../artificer/region1';
import { weatherReport } from '../artificer/weather-words';
import { nightLines, type DayPlay } from './playback';
import { playFinds, tripSummary, type TripFinds } from './explore-finds';
import { logClass, logText } from './journal-view';
import { METRIC_ICON } from './key-box';
import { WEATHER_ICON } from './camp-blocks';
import { itemIcon } from './item-icons';
import { weatherWord } from './sim-words';
import { esc } from './html';

/** The card's ui switch (#1929): read with `uiFeatureOn`. */
export const DAY_CARD_FEATURE = 'day-card';

/** The most hardships the card lists; the rest are a tap away, in the journal. */
export const CARD_HARDSHIPS = 4;

/** A key metric's change: food in meals, water and firewood as the stores count them. */
export interface Change { id: KeyMetricId; n: number }

/** What the card says, worked out from the plays. */
export interface DayCard {
  /** The first and the last day played: the same day, unless a whole queue ran several. */
  from: number;
  to: number;
  /** What the days brought in, morning to dusk: each key metric that rose, by how much. */
  brought: Change[];
  /** What each land trip turned up (#1869, `explore-finds`), when that switch is on. */
  trips: TripFinds[];
  /** The nights, dusk to morning: each key metric that moved, signed (eaten and burnt are below 0). */
  night: Change[];
  /** The nights' hardships (spoiled, stolen, the cold), as the sim wrote them. */
  hardships: LogEntry[];
  /** The morning after, whose weather the card says. */
  morning: Region1State;
}

/** The sim at dusk: the last step's, or the morning's when nothing was done. */
const duskOf = (p: DayPlay): Region1State => (p.steps.length ? p.steps[p.steps.length - 1].sim : p.before.sim);

/** The key metrics as the status bar counts them (no winter needs: only the values), each once per state. */
const valuesOf = (s: Region1State): Record<KeyMetricId, number> =>
  Object.fromEntries(keyMetrics(s, { needs: false }).map(m => [m.id, m.value])) as Record<KeyMetricId, number>;

/**
 * The card for the plays the timer just ended, or null when no day ended: a day stopped partway, an
 * encounter waiting, one thing done by hand (no night in any of those), or a run that's over (its
 * end screen says the rest). A whole queue's several days make one card: the gains of each day and
 * the changes of each night, added up. A whole queue whose last day stops partway (an encounter, or
 * Stop) still has the days before it that ended with their nights: the card says those. `finds` is
 * the `explore-finds` switch.
 */
export function dayCardOf(plays: readonly DayPlay[], finds: boolean): DayCard | null {
  const last = plays[plays.length - 1];
  if (!last || last.after.sim.outcome) return null;
  // The days that ended: up to the last one with its night.
  const end = plays.map(p => p.night).lastIndexOf(true);
  if (end < 0) return null;
  const done = plays.slice(0, end + 1);
  const nights = done.filter(p => p.night);
  const ids = keyMetricsOf();
  const at = done.map(p => ({ morning: valuesOf(p.before.sim), dusk: valuesOf(duskOf(p)), after: valuesOf(p.after.sim) }));
  // A day's gains only: water drunk on the way, say, isn't "brought back" as a minus.
  const brought = ids.map(id => ({ id, n: at.reduce((n, v) => n + Math.max(0, v.dusk[id] - v.morning[id]), 0) })).filter(c => c.n > 0);
  const night = ids.map(id => ({ id, n: at.reduce((n, v, i) => n + (done[i].night ? v.after[id] - v.dusk[id] : 0), 0) })).filter(c => c.n !== 0);
  // The night's lines, as the timer reads them (playback.ts `nightLines`).
  const hardships = nights.flatMap(nightLines).filter(l => l.kind === 'hardship');
  const trips = done.flatMap(p => playFinds(p, finds)).filter((f): f is TripFinds => f !== null);
  return { from: done[0].before.sim.day, to: done[end].before.sim.day, brought, trips, night, hardships, morning: done[end].after.sim };
}

/** "+3 food", "−4 firewood": a change with its icon, the minus a real one. */
function changeText(c: Change, t: T): string {
  const ic = METRIC_ICON[c.id];
  const n = `${c.n > 0 ? '+' : '−'}${Math.abs(c.n)}`;
  return `<span class="dcchange ${c.n > 0 ? 'up' : 'down'}">${itemIcon(ic.store, { fallback: ic.emoji })} ${esc(t(`daycard.${c.id}`, { n }))}</span>`;
}

/**
 * Tomorrow's sky, as the weather box will say it in the morning: the sky and how it feels (#1729), or
 * with the weather in words off, the weather's name as the status bar has it. Null where the weather
 * isn't seeded (the flat world has no sky to speak of).
 */
export function skyTomorrow(s: Region1State, t: T): string | null {
  if (s.config.world.weather !== 'seeded') return null;
  const icon = WEATHER_ICON[s.weatherToday];
  const r = weatherReport(s);
  if (r.view === 'numbers' || !r.sky) return `${icon} ${weatherWord(s.weatherToday, s.day, s.config.calendar, t)}`;
  return `${icon} ${[t(`wx.sky.${r.sky}`), ...(r.felt ? [t(`wx.felt.${r.felt}`)] : [])].join(' ')}`;
}

/** The card's markup: a dialog over the page, on the encounters' backdrop (style.css `.enc-backdrop`); main.ts focuses its OK. */
export function dayCardHtml(c: DayCard, t: T): string {
  const title = c.from === c.to ? t('daycard.title', { n: c.to }) : t('daycard.titleDays', { from: c.from, to: c.to });
  const brought = c.brought.length ? `<p class="dcrow">${c.brought.map(x => changeText(x, t)).join('')}</p>` : '';
  const trips = c.trips.length ? `<ul class="dctrips">${c.trips.map(f => `<li>${esc(tripSummary(f, t))}</li>`).join('')}</ul>` : '';
  const nothing = !brought && !trips ? `<p class="dcnone">${esc(t('daycard.nothing'))}</p>` : '';
  const night = c.night.length ? `<p class="dcrow">${c.night.map(x => changeText(x, t)).join('')}</p>` : '';
  const shown = c.hardships.slice(0, CARD_HARDSHIPS);
  const more = c.hardships.length - shown.length;
  const hard = shown.length
    ? `<ul class="dchard">${shown.map(l => `<li class="${logClass(l)}">${esc(logText(l, t))}</li>`).join('')}${more > 0 ? `<li class="dcmore">${esc(t('daycard.more', { n: more }))}</li>` : ''}</ul>`
    : '';
  const quiet = !night && !hard ? `<p class="dcnone">${esc(t('daycard.quiet'))}</p>` : '';
  const sky = skyTomorrow(c.morning, t);
  return `<div class="enc-backdrop daycardwrap" data-daycard>
    <section class="box daycard" role="dialog" aria-modal="true" aria-labelledby="daycard-title">
      <h2 id="daycard-title">${esc(title)}</h2>
      <div class="dcsec"><p class="eyebrow">${esc(t('daycard.brought'))}</p>${brought}${trips}${nothing}</div>
      <div class="dcsec"><p class="eyebrow">${esc(t('daycard.night'))}</p>${night}${hard}${quiet}</div>
      ${sky ? `<div class="dcsec"><p class="eyebrow">${esc(t('daycard.tomorrow'))}</p><p class="dcsky">${esc(sky)}</p></div>` : ''}
      <div class="dcbtns">
        <button class="pill" data-cmd="daycardjournal">${esc(t('daycard.journal'))}</button>
        <button class="btn go" data-cmd="daycardok">${esc(t('daycard.ok', { n: c.morning.day }))}</button>
      </div>
    </section>
  </div>`;
}

/** The status bar's journal button (#1929): opens the journal sheet from any tab. */
export const journalButton = (t: T): string =>
  `<button class="jbtn" data-cmd="jsheet" aria-label="${esc(t('jsheet.open'))}" title="${esc(t('jsheet.open'))}">📓</button>`;

/** The journal as a sheet over the page (#1929): the full journal's lines (main.ts draws them), and Close. */
export function journalSheet(items: string, t: T): string {
  return `<div class="enc-backdrop jsheetwrap" data-jsheet>
    <section class="box log jsheet" role="dialog" aria-modal="true" aria-labelledby="jsheet-title">
      <div class="jshead"><h2 id="jsheet-title">${esc(t('jsheet.title'))}</h2><button class="pill" data-cmd="jsheetclose">${esc(t('jsheet.close'))}</button></div>
      <ul class="full">${items}</ul>
    </section>
  </div>`;
}
