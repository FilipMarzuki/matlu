/**
 * The focus picker on the status bar (#1758): tapping the FOCUS chip opens the Warden tab's picker
 * right under it, on whatever tab you're on, so you can change what your mind works on without
 * leaving the plan.
 *
 * Pure functions of the game state and `t`, so they can be drawn in a unit test. The choices are
 * the Warden tab's own (`focusBlock` in warden-view.ts), so the two pickers can't drift apart; only
 * the frame around them is new. Whether it's open is the page's (main.ts `focusPopOpen`): UI only,
 * never saved and never a move.
 */

import type { T } from '../artificer/i18n';
import { survivalLockOf, type Region1State } from '../artificer/region1';
import { statEffects } from '../artificer/stats';
import { esc } from './html';
import { focusName, lockText } from './sim-words';
import { focusBlock } from './warden-view';

/** The popover's element id, which the chip names in `aria-controls`. */
export const FOCUS_POP_ID = 'focuspop';

/** What can happen to the picker: the chip tapped, a tap elsewhere, Esc, or a focus chosen. */
export type FocusPopEvent = 'chip' | 'outside' | 'escape' | 'pick';

/** Whether the picker is open after `ev`: the chip toggles it, and everything else closes it. */
export function focusPopAfter(open: boolean, ev: FocusPopEvent): boolean {
  return ev === 'chip' ? !open : false;
}

/**
 * The status bar's FOCUS chip (#1238): the focus, or SURVIVAL in red with the reason when locked.
 * A button that opens the picker (#1758), with the ARIA a screen reader needs to say so.
 */
export function focusChip(s: Region1State, t: T, open: boolean): string {
  const aria = `data-cmd="focuspop" aria-haspopup="dialog" aria-expanded="${open}" aria-controls="${FOCUS_POP_ID}"`;
  const lock = survivalLockOf(s);
  if (lock) return `<button class="focuschip locked" ${aria} title="${esc(t('status.survivalTip'))}">${esc(t('status.focus'))} <b>${esc(t('status.survival'))}</b> <span>${esc(lockText(lock, t))}</span></button>`;
  // Willpower moves the line where focus frays (#1256).
  const below = statEffects(s.character.stats).unreliableBelow;
  const frayed = s.focus && s.vitals.clarity.current < below;
  return `<button class="focuschip ${s.focus ? '' : 'none'}" ${aria} title="${esc(frayed ? t('status.frayedTip', { n: below }) : t('status.focusTip'))}">${esc(t('status.focus'))} <b>${esc(focusName(s.focus, t))}</b>${frayed ? ` <span>${esc(t('status.frayed'))}</span>` : ''}</button>`;
}

/**
 * The picker itself, drawn only while open: a heading, a close button, and the Warden tab's
 * choices, disabled while survival has taken over (the lock banner says why).
 */
export function focusPopover(s: Region1State, t: T): string {
  return `<div class="focuspop" id="${FOCUS_POP_ID}" role="dialog" aria-modal="false" aria-labelledby="${FOCUS_POP_ID}-h">
    <div class="fphead"><p class="eyebrow" id="${FOCUS_POP_ID}-h">${esc(t('head.focus'))}</p><button class="fpclose" data-cmd="focuspopclose" aria-label="${esc(t('status.focusClose'))}" title="${esc(t('status.focusClose'))}">✕</button></div>
    ${focusBlock(s, t, undefined, { disableWhenLocked: true })}
  </div>`;
}
