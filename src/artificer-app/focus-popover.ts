/**
 * The focus picker on the status bar (#1758): tapping the FOCUS chip opens the Warden tab's picker
 * right under it, on whatever tab you're on, so you can change what your mind works on without
 * leaving the plan.
 *
 * Pure functions of the game state and `t`, so they can be drawn in a unit test. The choices are
 * the Warden tab's own (`focusBlock` in warden-view.ts), so the two pickers can't drift apart; only
 * the frame around them is new. Whether it's open is the page's (main.ts `focusPopOpen`): UI only,
 * never saved and never a move.
 *
 * With the `guide` ui feature (#1793) both also show the Survival path (survival-path.ts): the chip
 * names the current step instead of an empty or goal focus, and the picker lists the steps with the
 * goal focus that helps as a button. That button is an ordinary choice (`data-focus`, the same move
 * as the chips below it), so play only changes when the player picks it. With the switch off, both
 * are drawn exactly as before.
 */

import type { T } from '../artificer/i18n';
import { focusKey } from '../artificer/focus';
import { survivalLockOf, winterOutlook, type Region1State } from '../artificer/region1';
import { statEffects } from '../artificer/stats';
import { esc } from './html';
import { focusName, lockText } from './sim-words';
import { focusBlock } from './warden-view';
import { FOOD_LAID_BY, PATH_STEPS, stepGoal, survivalPath, type PathOptions } from './survival-path';

/**
 * What the page's switches say about the chip and picker: the `guide` ui feature (survival-path.ts),
 * and `standing-line` (#1926), with which the picker's path reads step 5 against the winter outlook
 * too, as the "where you stand" line that opens it does.
 */
export interface FocusUi { guide?: boolean; standing?: boolean }

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
export function focusChip(s: Region1State, t: T, open: boolean, ui: FocusUi = {}): string {
  const aria = `data-cmd="focuspop" aria-haspopup="dialog" aria-expanded="${open}" aria-controls="${FOCUS_POP_ID}"`;
  const lock = survivalLockOf(s);
  if (lock) return `<button class="focuschip locked" ${aria} title="${esc(t('status.survivalTip'))}">${esc(t('status.focus'))} <b>${esc(t('status.survival'))}</b> <span>${esc(lockText(lock, t))}</span></button>`;
  // The Survival path (#1793): with no focus or a goal one, the chip says the step you're on. A
  // skill or concept focus is the player's own study and keeps its name; so does everything once
  // the path is done.
  const cur = ui.guide && (!s.focus || s.focus.kind === 'goal') ? survivalPath(s).current : null;
  if (cur !== null) {
    const v = { n: cur + 1, total: PATH_STEPS.length, step: t(`path.step.${PATH_STEPS[cur]}`) };
    return `<button class="focuschip path" ${aria} title="${esc(t('path.chipTip', v))}">${esc(t('status.focus'))} <b>${esc(t('path.chip', v))}</b> <span>${esc(v.step)}</span></button>`;
  }
  // Willpower moves the line where focus frays (#1256).
  const below = statEffects(s.character.stats).unreliableBelow;
  const frayed = s.focus && s.vitals.clarity.current < below;
  return `<button class="focuschip ${s.focus ? '' : 'none'}" ${aria} title="${esc(frayed ? t('status.frayedTip', { n: below }) : t('status.focusTip'))}">${esc(t('status.focus'))} <b>${esc(focusName(s.focus, t))}</b>${frayed ? ` <span>${esc(t('status.frayed'))}</span>` : ''}</button>`;
}

/**
 * The picker itself, drawn only while open: a heading, a close button, and the Warden tab's
 * choices, disabled while survival has taken over (the lock banner says why).
 */
export function focusPopover(s: Region1State, t: T, ui: FocusUi = {}): string {
  return `<div class="focuspop" id="${FOCUS_POP_ID}" role="dialog" aria-modal="false" aria-labelledby="${FOCUS_POP_ID}-h">
    <div class="fphead"><p class="eyebrow" id="${FOCUS_POP_ID}-h">${esc(t('head.focus'))}</p><button class="fpclose" data-cmd="focuspopclose" aria-label="${esc(t('status.focusClose'))}" title="${esc(t('status.focusClose'))}">✕</button></div>
    ${ui.guide ? pathBlock(s, t, { outlook: ui.standing }) : ''}${focusBlock(s, t, undefined, { disableWhenLocked: true })}
  </div>`;
}

/**
 * The Survival path's checklist (#1793), at the top of the picker until the path is done: each
 * step ticked or not, the current one marked with what it asks and, when a goal focus helps with
 * it, a button that sets that focus. The button is the same `data-focus` choice as the goal chips
 * below, so main.ts sets it with the same move and closes the picker. Disabled, like them, while
 * survival has taken over; replaced by a note when that goal is already the focus. With
 * `opts.outlook` (#1926) step 5 stays the current one while the winter outlook falls short.
 */
export function pathBlock(s: Region1State, t: T, opts: PathOptions = {}): string {
  const path = survivalPath(s, opts);
  if (path.current === null) return '';
  const lock = survivalLockOf(s);
  const items = path.steps.map((st, i) => {
    const now = i === path.current;
    const mark = st.done ? '✓' : now ? '▸' : '·';
    const state = st.done ? t('path.done') : now ? t('path.now') : '';
    let extra = '';
    if (now) {
      const hint = st.id === 'food' ? t('path.hint.food', { n: FOOD_LAID_BY, have: winterOutlook(s).foodDays }) : t(`path.hint.${st.id}`);
      const goal = stepGoal(s, st.id, opts);
      const key = goal ? focusKey({ kind: 'goal', id: goal }) : '';
      const name = goal ? t(`goal.${goal}`) : '';
      const act = !goal ? ''
        : s.focus && focusKey(s.focus) === key ? `<span class="fpfocused">✓ ${esc(t('path.focused', { goal: name }))}</span>`
        : `<button class="fchip fpsuggest" data-focus="${key}" title="${esc(t('path.suggestTip', { goal: name }))}"${lock ? ' disabled' : ''}>${esc(t('path.suggest', { goal: name }))}</button>`;
      extra = `<div class="fpnow"><span class="mood">${esc(hint)}</span>${act}</div>`;
    }
    return `<li class="${st.done ? 'done' : now ? 'now' : ''}"${now ? ' aria-current="step"' : ''}><span class="fpmark" aria-hidden="true">${mark}</span> ${i + 1}. ${esc(t(`path.step.${st.id}`))}${state ? ` <span class="sr-only">(${esc(state)})</span>` : ''}${extra}</li>`;
  }).join('');
  return `<div class="fppath"><p class="fgroup">${esc(t('path.head'))} ${path.current + 1}/${PATH_STEPS.length}</p><ol>${items}</ol></div>`;
}
