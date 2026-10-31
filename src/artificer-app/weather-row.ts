/**
 * The weather and the time of day in one row (#1825, with the two-row header's switch,
 * `two-row-header`): "🌧 Rain · Chilly · early morning" at the top of Plan, in place of the folded
 * weather box's chips (#1788) and the status bar's TODAY chip. A tap on the row unfolds the full
 * weather lines under it, a tap again folds them: the same fold as #1788 (weather-fold.ts), so it
 * remembers the same way, and the first morning's big card (with "Got it", which the guide waits
 * on) is untouched.
 *
 * Pure: the page passes in the weather's chips (camp-blocks.ts `weatherChips`), the time of day it
 * already worked out for the TODAY chip, and the full box to unfold; this file draws the row, so a
 * unit test can check its text and its fold without a browser.
 */

import type { T } from '../artificer/i18n';
import { esc } from './html';
import { chevron } from './fold';

/** One piece of the row: what the folded box's chip said (camp-blocks.ts `WeatherChip`). */
export interface RowChip { id: string; icon: string; text: string; full: string }

/**
 * The row's pieces, in order: the sky (with its icon), the cold as felt, the snow underfoot when
 * there is some, then the time of day. The season stays in the unfolded box (and the header's
 * day). `time` is plain text, as the TODAY chip showed it ("EARLY MORNING", or "6/14H" while the
 * hours are shown); it is lowered to sit in the sentence ("early morning").
 */
export function weatherRowText(chips: readonly RowChip[], time: string): string {
  const byId = (id: string) => chips.find(c => c.id === id);
  const sky = byId('sky');
  const parts = [
    sky ? `${sky.icon} ${sky.text}` : '',
    byId('felt')?.text ?? '',
    byId('ground') ? `${byId('ground')!.icon} ${byId('ground')!.text}` : '',
    // English and Swedish lower the same way (Å, Ä, Ö included), so no locale is needed.
    time.toLowerCase(),
  ].filter(Boolean);
  return parts.join(' · ');
}

/** The full sentences the row stands for, for its tooltip and screen readers. */
const rowLabel = (chips: readonly RowChip[], time: string, t: T): string =>
  [t('wx.chips'), ...chips.filter(c => c.id !== 'season').map(c => c.full), time ? `${t('status.today')} ${time}` : ''].filter(Boolean).join('. ');

type RowOpts = { chips: readonly RowChip[]; time: string; open: boolean; hint: boolean; banner?: string; details: string };

/**
 * The row's button: the sky, the cold and the time of day in one line, which opens and folds the box
 * (`data-wxfold`, as #1788's heading is, so the page's one handler takes it). `cls`: more classes.
 */
export function weatherToggle(o: Pick<RowOpts, 'chips' | 'time' | 'open'>, t: T, cls = ''): string {
  const text = weatherRowText(o.chips, o.time);
  const label = rowLabel(o.chips, o.time, t);
  return `<button type="button" class="foldhead wxtoggle wxonerow${cls ? ` ${cls}` : ''}" data-wxfold aria-expanded="${o.open}" title="${esc(label)}">`
    + `${chevron()}<span class="wxonetext">${esc(text)}</span></button>`;
}

/**
 * The box: one row that is its own fold's button (`weatherToggle`), and while open the full box
 * under it. `hint` is #1788's "tap here" until the box has been opened once; `banner` a blizzard's
 * warning, shown either way.
 */
export function weatherRow(o: RowOpts, t: T): string {
  return `<div class="wxbox wxone${o.open ? ' open' : ''}">`
    + weatherToggle(o, t)
    + (o.hint && !o.open ? `<span class="wxhint">${esc(t('wx.hint'))}</span>` : '')
    + (o.open ? `<div class="wxonedetails">${o.details}</div>` : (o.banner ?? ''))
    + `</div>`;
}

/**
 * With the row's button in the tab row (#1998, wide-top.ts): what's left under the tabs. The full box
 * while it's open, else a blizzard's warning, else nothing. No "tap here": the button sits among the
 * tabs, a button like them.
 */
export function weatherUnder(o: Pick<RowOpts, 'open' | 'banner' | 'details'>): string {
  if (o.open) return `<div class="wxbox wxone open"><div class="wxonedetails">${o.details}</div></div>`;
  return o.banner ? `<div class="wxbox wxone">${o.banner}</div>` : '';
}
