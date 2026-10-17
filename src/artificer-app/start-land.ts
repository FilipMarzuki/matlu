/**
 * A new Warden starts on LAND (#1853, ui feature `start-on-land`): after the intro the first view is
 * the land close by, with the patrol leader's advice remembered ("scout first: find shelter and
 * water") and one button, Explore, that goes to PLAN with the Explore card highlighted and its
 * distance chooser (#1814) open at the nearest distance.
 *
 * What's here is pure (the page's state is main.ts's): whether the note is due, what the button
 * leads to, and the one-shot "this run has had its first view" record per run, in `localStorage`.
 * Presentation only: no rule reads it, and no random number is drawn, so a run plays the same with
 * it on or off. The play API, the console and AI players never see it.
 */

import type { T } from '../artificer/i18n';
import { RINGS, domainsOf, level, reachable } from '../artificer/exploration';
import { ACTIONS, type ActionId, type Region1State } from '../artificer/region1';
import { visibilityOf } from '../artificer/action-visibility';
import { esc } from './html';
import { ICON_LEVEL } from './land-icons';
import { suitableSiteKnown } from './reveal';
import type { RingDefaults } from './distance-defaults';

export const START_LAND_FEATURE = 'start-on-land';

/** Water seen clearly somewhere you can go: the 💧 icon on LAND (land-icons.ts). */
export const waterSeen = (s: Region1State): boolean =>
  RINGS.some(r => reachable(s.explore, r) && domainsOf(r).includes('water') && level(s.explore, r, 'water') >= ICON_LEVEL);

/**
 * The note is due: day 1 of a run still going, until both things the leader said to find are found,
 * water (💧) and a good place for shelter (⛺, or camp already made: reveal.ts `suitableSiteKnown`).
 */
export const startNoteDue = (s: Region1State): boolean =>
  s.day === 1 && s.outcome === null && !(waterSeen(s) && suitableSiteKnown(s));

/** The action the note's button leads to. */
export const START_ACTION: ActionId = 'explore';

/** Whether the run has an Explore action to lead to (a run with action visibility off may not). */
export const canLeadToExplore = (s: Region1State): boolean => visibilityOf(s, START_ACTION, 1).status !== 'hidden';

/**
 * Where the button goes: PLAN, with Explore highlighted and, Explore being ringed, its chooser open.
 * Before planning is learned the chooser's tap does it at once (main.ts's `ringpick`), as any action.
 */
export interface StartTarget { tab: 'plan'; highlight: ActionId; chooser: ActionId | null }
export const startTarget = (): StartTarget => ({ tab: 'plan', highlight: START_ACTION, chooser: ACTIONS[START_ACTION].ringed ? START_ACTION : null });

/**
 * The chooser's remembered distances while the start's highlight holds: Explore's left out, so it
 * opens at the nearest distance it can go to (distance-defaults.ts `preselect`).
 */
export function nearestFirst(defaults: RingDefaults): RingDefaults {
  if (!(START_ACTION in defaults)) return defaults;
  const { [START_ACTION]: _drop, ...rest } = defaults;
  return rest;
}

/** The note, at the top of LAND: the leader's advice and the one button. '' when not due. */
export function startNoteBlock(s: Region1State, t: T): string {
  if (!startNoteDue(s)) return '';
  const go = canLeadToExplore(s) ? `<button class="btn go landstartgo" data-startexplore="1">${esc(t('land.start.go'))}</button>` : '';
  return `<section class="box landstart" role="note"><p class="mood" style="margin:0 0 10px">${esc(t('land.start.note'))}</p>${go}</section>`;
}

// ── The one-shot first view, per run ─────────────────────────────────────────

export const START_LAND_KEY = 'artificer.startLand.';

export type StartStore = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): StartStore | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

/** This run has had its first view on LAND (so a reload never forces it again). */
export function startLandUsed(runId: string, store: StartStore | null = storage()): boolean {
  try { return store?.getItem(START_LAND_KEY + runId) === '1'; } catch { return false; }
}

/**
 * The first open of a new Warden: true once per run (and then recorded), false after. With storage
 * missing or refusing, `pageClaimed` (main.ts's own memory) keeps it to once for this visit.
 */
export function claimStartLand(runId: string, pageClaimed: Set<string>, store: StartStore | null = storage()): boolean {
  if (pageClaimed.has(runId) || startLandUsed(runId, store)) return false;
  pageClaimed.add(runId);
  try { store?.setItem(START_LAND_KEY + runId, '1'); } catch { /* this visit only */ }
  return true;
}

/**
 * The view the intro ends on: LAND for a new Warden's first open with the switch on, else null
 * (the stored tab, as before). `began` is reveal.ts's: no hour worked and still day 1.
 */
export const firstView = (on: boolean, notBegun: boolean, claimed: boolean): 'land' | null => (on && notBegun && claimed ? 'land' : null);
