/**
 * The two-row header's resources (#1824): Vigor, Clarity and Condition as a word for how full each
 * is ("Energized", "Drowsy", "Hurt"…), in a pill whose border carries the level's colour. The first
 * week shows only the words; from day 8 the old bars come back, labelled with the same word.
 *
 * Pure: no DOM and no state of the page's own, so the levels, the words and the switch to bars are
 * checked in a unit test (vital-words.test.ts) without a browser.
 */

import type { T, Key } from '../artificer/i18n';
import { CAP_CEIL } from '../artificer/vitality';
import type { Region1State } from '../artificer/region1';
import { band, esc, pct } from './html';

/** The ui switch (features.ts). Off, the header is the one-row header of #1808. */
export const TWO_ROW_FEATURE = 'two-row-header';

/** The day the bars take over from the bare words: the first week is words only. */
export const BARS_FROM_DAY = 8;

export type VitalId = 'vigor' | 'clarity' | 'reserve';
/** 0 is the best (full), 3 the worst. */
export type VitalLevel = 0 | 1 | 2 | 3;

/**
 * How full a resource is, as one of four levels: above 75% of its cap, above 45%, above 20%, or
 * less. These are the status bar's colour bands (`band` in html.ts), so a bar's colour and its word
 * never disagree. A cap of 0 (it can't happen today) reads as empty.
 */
export function vitalLevel(current: number, cap: number): VitalLevel {
  const b = band(cap > 0 ? current / cap : 0);
  return b === 'fresh' ? 0 : b === 'ok' ? 1 : b === 'warn' ? 2 : 3;
}

/** The band names the bars' CSS already uses, by level. */
const BAND: readonly string[] = ['fresh', 'ok', 'warn', 'low'];

/** The resource's word at a level, in the viewer's language (`vital.word.*`, i18n/*\/meny.ts). */
export const vitalWord = (id: VitalId, level: VitalLevel, t: T): string => t(`vital.word.${id}.${level}` as Key);

/** The resource's full name (the catalog's VIGOR / KRAFT…), for its aria-label. */
const NAME: Record<VitalId, Key> = { vigor: 'vital.vigor', clarity: 'vital.clarity', reserve: 'vital.reserve' };
/** The short label the bars have always had (VIG / KRA…). */
const SHORT: Record<VitalId, Key> = { vigor: 'status.vig', clarity: 'status.cla', reserve: 'status.res' };

export interface VitalReading {
  id: VitalId;
  current: number;
  /** The level is judged against this (today's cap). */
  cap: number;
  /** The bar's full width (the highest a cap can grow to): as the old bars drew it. */
  max: number;
}

/**
 * The three resources as a run has them: Vigor and Clarity each against today's cap, Reserve (the
 * Warden's condition) out of 100, and the bars as wide as the old ones (`CAP_CEIL`).
 */
export const vitalReadings = (s: Pick<Region1State, 'vitals'>): VitalReading[] => [
  { id: 'vigor', current: s.vitals.vigor.current, cap: s.vitals.vigor.cap, max: CAP_CEIL },
  { id: 'clarity', current: s.vitals.clarity.current, cap: s.vitals.clarity.cap, max: CAP_CEIL },
  { id: 'reserve', current: s.vitals.condition, cap: 100, max: 100 },
];

/** Whether the bars show on this day: from `BARS_FROM_DAY` on. */
export const barsOn = (day: number): boolean => day >= BARS_FROM_DAY;

/**
 * One resource: the word in its coloured border (`lv-0`…`lv-3`, the colour is the border's, the
 * word keeps the ink), and from day 8 the bar beside it. The colour never says it alone: the word
 * does, and the whole is labelled for a screen reader with the resource's name and word (and the
 * number, once there's a bar).
 */
export function vitalChip(r: VitalReading, day: number, t: T): string {
  const lv = vitalLevel(r.current, r.cap);
  const word = vitalWord(r.id, lv, t);
  const name = t(NAME[r.id]);
  const bars = barsOn(day);
  const label = bars ? `${name}: ${word}, ${Math.round(r.current)}` : `${name}: ${word}`;
  const bar = bars ? `<span class="mt" aria-hidden="true"><span class="mf ${BAND[lv]}" style="width:${pct(r.current / r.max)}%"></span></span>` : '';
  return `<span class="vital${bars ? ' bars' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}">`
    + `<span class="vl" aria-hidden="true">${esc(t(SHORT[r.id]))}</span><span class="vword lv-${lv}" aria-hidden="true">${esc(word)}</span>${bar}</span>`;
}

/**
 * One resource as a dot (#1924, the compact status line): the level's colour, no word or bar, so
 * three resources fit beside the day and the key box on one line. The word and the number still
 * reach a screen reader (and a hover), exactly as `vitalChip`'s label does.
 */
export function vitalDot(r: VitalReading, t: T): string {
  const lv = vitalLevel(r.current, r.cap);
  const label = `${t(NAME[r.id])}: ${vitalWord(r.id, lv, t)}, ${Math.round(r.current)}`;
  return `<span class="vdot ${BAND[lv]}" role="img" aria-label="${esc(label)}" title="${esc(label)}"></span>`;
}

/**
 * The three dots with their labels (#1995, the Warden view): each dot in its level's colour, then
 * the resource's name and its word, and from day 8 the number, as the header's bars show it. The
 * same levels and words as the status bar's dots (`vitalDot`), so the two never disagree. The dot
 * is decoration here: the words beside it say everything it does.
 */
export function vitalsLabelled(rs: readonly VitalReading[], day: number, t: T): string {
  const bars = barsOn(day);
  const name = (id: VitalId): string => { const n = t(NAME[id]); return n.charAt(0) + n.slice(1).toLocaleLowerCase(); };
  return `<ul class="wvitals">${rs.map(r => {
    const lv = vitalLevel(r.current, r.cap);
    return `<li><span class="vdot ${BAND[lv]}" aria-hidden="true"></span><span class="wvn">${esc(name(r.id))}</span> <b>${esc(vitalWord(r.id, lv, t))}</b>`
      + `${bars ? ` <span class="wvnum">${Math.round(r.current)}</span>` : ''}</li>`;
  }).join('')}</ul>`;
}

/**
 * Row 2 of the header: the Warden's button on the left, then the three resources. The guide (#1813)
 * holds the resources back until the first action (`shown`), but never the Warden (#1818). `attrs`
 * is the guide's mark on the resources (its glow and what a tap on them dismisses).
 */
export function wardenRow(o: { warden: string; vitals: readonly VitalReading[]; day: number; shown: boolean; attrs?: string }, t: T): string {
  const vitals = o.shown && o.vitals.length ? `<div class="hvitals"${o.attrs ?? ''}>${o.vitals.map(v => vitalChip(v, o.day, t)).join('')}</div>` : '';
  return `<div class="hrow hrow2">${o.warden}${vitals}</div>`;
}
