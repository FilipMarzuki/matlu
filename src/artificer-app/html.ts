/**
 * Small helpers for drawing HTML strings, shared by main.ts and the view modules that draw in the
 * viewer's language (opening-view.ts, camp-blocks.ts, #1707). Pure: no DOM, so the views can be
 * drawn in a unit test.
 */

import { portraitById, portraitStyle } from './portraits';
import { localNum, type T } from '../artificer/i18n';

/** Escape text for innerHTML — sim text is ours today, but a save could be edited. */
export const esc = (t: string | number): string => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/**
 * Hours for display: snow and blizzards stretch work into fractions, so show at most one decimal.
 * With `t`, in the viewer's language (#1711): "1,5" in Swedish.
 */
export const hrs = (h: number, t?: T): string => { const s = String(Math.round(h * 10) / 10); return t ? localNum(s, t) : s; };
/** A fraction as a CSS percentage, held to 0–100. */
export const pct = (x: number): number => Math.max(0, Math.min(100, x * 100));
/** A pool's colour band from how full it is. */
export const band = (ratio: number): string => (ratio > 0.75 ? 'fresh' : ratio > 0.45 ? 'ok' : ratio > 0.2 ? 'warn' : 'low');

/** A portrait frame (or a blank silhouette for an unnamed quick-start Warden). */
export function portraitEl(id: string | null, size: number, cls = ''): string {
  const p = portraitById(id);
  return p ? `<span class="portrait ${cls}" role="img" aria-label="${esc(p.label)}" style="${portraitStyle(p, size)}"></span>` : `<span class="portrait blank ${cls}" style="width:${size}px;height:${size}px" aria-hidden="true">?</span>`;
}
