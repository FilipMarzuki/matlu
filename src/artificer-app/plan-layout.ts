/**
 * The PLAN tab's layout (#1826, ui feature `side-queue`): the actions on the left and the queue on
 * the right on every width, phones included, with the queue's column frozen (CSS `position:
 * sticky`, style.css `.plan.sideq`) so it stays in view while the actions scroll. The latest
 * journal and the camp-site picker sit in their own box below, never in the frozen column.
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
}

/**
 * The PLAN tab's body. On: a grid of the actions (`.planacts`), the frozen queue column (`.planq`)
 * and the box below (`.planmore`); with no queue to show yet (the guide), the actions alone take
 * the width (`.noq`). Off: as before.
 */
export function planLayout(p: PlanParts, sideQueue: boolean, t: T): string {
  if (!sideQueue) {
    const side = p.queue || p.journal || p.camp ? `<section class="box planside">${p.queue}${p.journal}${p.camp}</section>` : '';
    return p.actions || side ? `<div class="plan">${p.actions}${side}</div>` : '';
  }
  // The frozen column sits in a zone of its own (`.planqzone`), as tall as the actions: a sticky box
  // only travels inside its parent, so the box below starts where the actions end and is never covered.
  const queue = p.queue ? `<div class="planqzone"><section class="box planq" aria-label="${esc(t('qc.label'))}">${p.queue}</section></div>` : '';
  const more = p.journal || p.camp ? `<section class="box planmore">${p.journal}${p.camp}</section>` : '';
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

/** The day's total under the compact queue ("6 / 14h · ends 12:00"); without an end when nothing runs today. */
export function compactTotal(today: number, end: string | null, t: T): string {
  const total = t('qc.total', { h: hrs(today, t), max: DAY_HOURS });
  return end ? `${total} · ${t('qc.ends', { when: end })}` : total;
}
