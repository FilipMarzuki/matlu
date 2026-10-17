/**
 * Rations with the Warden (#1848): how much the Warden eats each evening (the eating plan, #1305)
 * leaves the status bar. It isn't shown at all until the first evening meal is behind you; the
 * morning after, a small note says how that meal went and that the setting is now with the Warden;
 * from then on it's a row in the Warden's view (the header's Warden button, #1818).
 *
 * Pure, like warden-view.ts: everything here is read from the run's state as it already is, so the
 * sim, the save and the golden hashes don't change. main.ts draws it and keeps the note's
 * dismissal in `localStorage` (per run). A ui feature: off, the chip stays in the status bar as before.
 */

import type { Key, T } from '../artificer/i18n';
import type { EatingPlan, Region1State } from '../artificer/region1';
import { esc } from './html';

/** The ui switch (features.ts). Off: the RATIONS chip stays in the status bar, as before #1848. */
export const RATIONS_FEATURE = 'rations-warden';

type Sim = Pick<Region1State, 'day' | 'eating' | 'log' | 'outcome'>;

/** The plans in the order the status bar's chip cycles through them. */
export const EATING_PLANS: readonly EatingPlan[] = ['full', 'half', 'none'];

/**
 * The first evening meal is behind you: the first night has been slept (day 2 or later). The night
 * is when the sim eats (region1.ts, the night pass), so this is read from the day alone, no new state.
 */
export const firstMealHad = (s: Pick<Region1State, 'day'>): boolean => s.day >= 2;

/**
 * Where the eating setting is drawn: in the status bar (switch off: always, as before), in the
 * Warden's view (switch on, once the first meal is behind you), or nowhere (switch on, day 1).
 */
export function rationsPlace(s: Pick<Region1State, 'day'>, on: boolean): 'status' | 'warden' | null {
  if (!on) return 'status';
  return firstMealHad(s) ? 'warden' : null;
}

/** How the first evening's meal went. */
export type MealVerdict = 'justRight' | 'tooMuch' | 'tooLittle';

/**
 * The night's own journal lines when the Warden didn't have a full meal (region1.ts, the night pass):
 * half rations' lean night, fasting, or no food at all. The sim's English, read as it's written.
 */
const SHORT_MEAL = /^(Half rations — a lean night|Fasting — |Hungry — no food)/;

/**
 * How the first evening's meal went, from what the sim wrote that night (day 1's journal):
 * - **too little:** no full meal: a lean night on half rations, fasting, or nothing to eat;
 * - **too much:** a full meal after a first day with no work in it (no work line, the ones the sim
 *   stamps with the hour they started): more than an idle day asked for;
 * - **just right:** a full meal after a day's work.
 * The sim knows one meal a night as the need; this only puts words on what it already did.
 */
export function firstMealVerdict(s: Pick<Region1State, 'log'>): MealVerdict {
  const night = s.log.filter(l => l.day === 1);
  if (night.some(l => l.kind === 'hardship' && SHORT_MEAL.test(l.text))) return 'tooLittle';
  return night.some(l => l.at) ? 'justRight' : 'tooMuch';
}

/** The note is due: switch on, the morning after the first night (day 2), the run going, not dismissed. */
export const rationsNoteDue = (s: Sim, on: boolean, dismissed: boolean): boolean =>
  on && s.day === 2 && !s.outcome && !dismissed;

/** The one-time note (#1848): how the first meal went, and where the setting is now. OK dismisses it. */
export function rationsNote(s: Sim, t: T): string {
  const v = firstMealVerdict(s);
  return `<section class="box rationsnote" role="note" aria-label="${esc(t('rations.noteLabel'))}">`
    + `<p class="eyebrow">${esc(t('rations.head'))}</p>`
    + `<p class="rnline">${esc(t(`rations.verdict.${v}` as Key))}</p>`
    + `<p class="rnwhere">${esc(t('rations.where'))}</p>`
    + `<button class="pill guideok" data-cmd="rationsok">${esc(t('guide.ok'))}</button></section>`;
}

const planLabel = (p: EatingPlan, t: T): string => t(p === 'full' ? 'status.full' : p === 'half' ? 'status.half' : 'status.none');
const planTip = (p: EatingPlan, t: T): string => t(p === 'full' ? 'status.fullTip' : p === 'half' ? 'status.halfTip' : 'status.noneTip');

/** The status bar's chip (#1305), as it was: tap to cycle full → half → none. */
export function eatingChip(s: Pick<Region1State, 'eating'>, t: T): string {
  const plan = s.eating ?? 'full';
  return `<button class="focuschip ${plan === 'full' ? 'none' : ''}" data-cmd="eat" title="${esc(t('status.tapToChange', { tip: planTip(plan, t) }))}">${esc(t('status.rations'))} <b>${esc(planLabel(plan, t))}</b></button>`;
}

/**
 * The Warden view's row (#1848): the same three plans as the chip, each a button that sets it
 * (`data-eat`, the same move as the chip's), with the current one pressed and what it means below.
 */
export function rationsRow(s: Pick<Region1State, 'eating'>, t: T): string {
  const plan = s.eating ?? 'full';
  const chips = EATING_PLANS.map(p => `<button class="fchip" data-eat="${p}" aria-pressed="${p === plan}" title="${esc(planTip(p, t))}">${esc(planLabel(p, t))}</button>`).join('');
  return `<div class="rationsrow"><p class="eyebrow" style="margin-top:16px">${esc(t('rations.row'))}</p>`
    + `<div class="fchips">${chips}</div><p class="mood" style="margin:6px 0 0">${esc(planTip(plan, t))}</p></div>`;
}
