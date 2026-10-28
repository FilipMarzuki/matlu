/**
 * The PLAN tab's layout (#1826, ui feature `side-queue`): on a tablet or desktop the actions on the
 * left and the queue on the right, the queue's column frozen (CSS `position: sticky`, style.css
 * `.plan.sideq`) so it stays in view while the actions scroll. On a phone in portrait (under 700px)
 * the queue is a frozen strip over the actions instead (queueStrip), which unfolds to the whole
 * queue, and the actions take the full width. The latest journal and the camp-site picker sit in
 * their own box below, never in the frozen part.
 *
 * At 1000px wide and up (#1931, `JOURNAL_BESIDE_QUERY`) the journal moves into the frozen column,
 * under the queue: a landscape tablet then shows the choice (the actions), the plan (the queue) and
 * the result (the journal) on one screen, and the page no longer ends in a journal box under the
 * cards. The camp-site picker stays below.
 *
 * With the switch off it draws exactly what the page drew before: the actions, then one side
 * column (`.planside`) with the queue, the journal and the site picker.
 *
 * Also the compact queue's words: a narrow queue column (a CSS container query) shows each task as
 * its icon, a short name, the distance in one word and the hours, and under them the day's total
 * and when it ends. Pure: strings in, HTML out, so a test can draw them without a browser.
 */

import type { Key, T } from '../artificer/i18n';
import { DAY_HOURS, type ActionId } from '../artificer/region1';
import type { Ring } from '../artificer/exploration';
import { DAY_START } from '../artificer/clock';
import { esc, hrs } from './html';

export const SIDE_QUEUE_FEATURE = 'side-queue';

/**
 * The screens where the journal sits under the queue (#1931). main.ts watches it with `matchMedia`
 * and redraws when the width crosses it, as the journal is drawn in one place or the other (it holds
 * the notes' ids, so it can't be drawn twice and one copy hidden). style.css lays the column out
 * with the same media query: plan-layout.test.ts checks the two say the same width.
 */
export const JOURNAL_BESIDE_QUERY = '(min-width: 1000px)';

/** The PLAN tab's parts, each already drawn (empty when the guide hasn't brought it in yet). */
export interface PlanParts {
  /** The actions' box (a whole `<section class="box">`). */
  actions: string;
  /** The queue (queueBlock), or the one-at-a-time note before planning is learned. */
  queue: string;
  /** The latest journal (`<div class="log">`). */
  journal: string;
  /** The camp-site picker and the tools, before camp is made. */
  camp: string;
  /** The phone's folded strip over the actions (queueStrip); only drawn with the switch on. */
  strip?: string;
  /** The strip unfolded: the whole queue shows under it on a phone. */
  stripOpen?: boolean;
}

/**
 * The PLAN tab's body. On: a grid of the actions (`.planacts`), the frozen queue column (`.planq`)
 * and the box below (`.planmore`); with no queue to show yet (the guide), the actions alone take
 * the width (`.noq`). Off: as before.
 *
 * `journalBeside` (on a screen that matches JOURNAL_BESIDE_QUERY, #1931): the journal goes under the
 * queue, the two frozen together (`.planstick`), and the box below holds only the camp-site picker.
 * Only with a queue to sit under; without one (the guide's first steps) the journal stays below.
 * Not passed (or false), the HTML is exactly what it was before.
 */
export function planLayout(p: PlanParts, sideQueue: boolean, t: T, journalBeside = false): string {
  if (!sideQueue) {
    const side = p.queue || p.journal || p.camp ? `<section class="box planside">${p.queue}${p.journal}${p.camp}</section>` : '';
    return p.actions || side ? `<div class="plan">${p.actions}${side}</div>` : '';
  }
  // The frozen column sits in a zone of its own (`.planqzone`), as tall as the actions: a sticky box
  // only travels inside its parent, so the box below starts where the actions end and is never covered.
  // On a phone (style.css, under 700px) the zone steps aside and the queue is a strip over the actions:
  // the folded strip shows, and the whole queue (`.planqfull`) only once it's unfolded.
  const open = p.stripOpen ? ' stripopen' : '';
  const qbox = p.queue
    ? `<section class="box planq${open}" aria-label="${esc(t('qc.label'))}">${p.strip ?? ''}<div class="planqfull">${p.queue}</div></section>`
    : '';
  // The journal joins the frozen column: one sticky box (`.planstick`) holds both, so the journal
  // travels with the queue instead of sticking on its own at a height it can't know.
  const beside = journalBeside && !!qbox && !!p.journal;
  const queue = !qbox ? ''
    : beside ? `<div class="planqzone"><div class="planstick">${qbox}<section class="box planlog">${p.journal}</section></div></div>`
    : `<div class="planqzone">${qbox}</div>`;
  const below = beside ? p.camp : p.journal + p.camp;
  const more = below ? `<section class="box planmore">${below}</section>` : '';
  if (!p.actions && !queue && !more) return '';
  return `<div class="plan sideq${queue ? '' : ' noq'}"><div class="planacts">${p.actions}</div>${queue}${more}</div>`;
}

// ── The compact queue ───────────────────────────────────────────────────────

/** One task as the compact queue says it. */
export interface CompactItem { icon: string; name: string; dist: string; hours: string }

/**
 * A task in a few words: its icon, its short name, how far out (one short word, for a land action
 * past the near ring, as the full row tags it) and its hours. `t` is the run's (sim-words.ts
 * distanceT), so with `distance-not-rings` on the word is a distance.
 */
export function compactItem(id: ActionId, ring: Ring, ringed: boolean, hours: number, icon: string, t: T): CompactItem {
  return {
    icon,
    name: t(`actshort.${id}` as Key),
    dist: ringed && ring > 1 ? t(`ring.short.${ring}` as Key) : '',
    hours: `${hrs(hours, t)}h`,
  };
}

/** The task as one line of text ("🪵 Wood far 4h"): what a test reads. */
export const compactItemText = (c: CompactItem): string => [c.icon, c.name, c.dist, c.hours].filter(Boolean).join(' ');

/** The task's compact part of its row: shown instead of the full name, notes and length when the column is narrow. */
export const compactItemHtml = (c: CompactItem): string =>
  `<span class="qc"><span class="qci">${c.icon}</span><span class="qcn">${esc(c.name)}</span>${c.dist ? `<span class="qcd">${esc(c.dist)}</span>` : ''}<span class="qch">${esc(c.hours)}</span></span>`;

/**
 * When today's plan ends: the clock ("14:00") as the hours are shown, or (time words, #1740) the
 * part of the day it ends in, which the caller passes as `part`.
 */
export const compactEnd = (today: number, part: string | null): string => part ?? clock(DAY_START + today);

const clock = (h: number): string => {
  const mins = Math.floor(h * 60 + 1e-6);
  return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

/** What the phone's strip holds: the tasks (none before planning is learned), a note in their place, the total and its button. */
export interface StripParts {
  items: readonly CompactItem[];
  /** Said instead of the tasks when there are none ("Nothing queued", or one-at-a-time play's note). */
  note: string;
  /** The day's total and when it ends (compactTotal). */
  total: string;
  /** Run the day (or pass it), or End the day before planning is learned. */
  button: { cmd: string; label: string; disabled: boolean };
  open: boolean;
  /**
   * Where the day ends, in words (#1930, day-forecast.ts `dayEndText`): said in the total's place.
   * Absent (or empty): the total, as before.
   */
  line?: string;
}

/**
 * The phone's strip over the actions (#1826): the queue folded to chips (icon, short name, hours),
 * the day's total and when it ends, and the Run / End day button. A tap on the chips (▾) unfolds
 * the whole queue under it, where tasks are removed and moved; another tap folds it. With
 * `day-forecast` (#1930), where the day ends takes the total's place under the chips: the sentence
 * says when you're done, which the total's hours only hinted at, and the strip grows no taller
 * (folded, it keeps to one line; the unfolded queue under it has the hours).
 */
export function queueStrip(p: StripParts, t: T): string {
  const chips = p.items.length
    ? p.items.map(c => `<span class="qschip"><span class="qci">${c.icon}</span> ${esc(c.name)} <b>${esc(c.hours)}</b></span>`).join('')
    : `<span class="qsnote">${esc(p.note)}</span>`;
  const total = p.line ? `<span class="qsline">${esc(p.line)}</span>` : `<span class="qstot">${esc(p.total)}</span>`;
  return `<div class="qstrip"><button class="qsbar" data-cmd="qstrip" aria-expanded="${p.open}" title="${esc(t(p.open ? 'qc.fold' : 'qc.unfold'))}">`
    + `<span class="qschips">${chips}</span>${total}<span class="qsfold" aria-hidden="true">${p.open ? '▴' : '▾'}</span></button>`
    + `<button class="btn go" data-cmd="${p.button.cmd}"${p.button.disabled ? ' disabled' : ''}>${esc(p.button.label)}</button></div>`;
}

/** The day's total under the compact queue ("6 / 14h · ends 12:00"); without an end when nothing runs today. */
export function compactTotal(today: number, end: string | null, t: T): string {
  const total = t('qc.total', { h: hrs(today, t), max: DAY_HOURS });
  return end ? `${total} · ${t('qc.ends', { when: end })}` : total;
}
