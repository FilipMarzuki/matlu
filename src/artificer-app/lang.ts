/**
 * The viewer's language (#1704): which catalog the page draws in, remembered in this browser.
 *
 * Presentation only, like the open tab or the timer's speed: it isn't in the save, the run's log or
 * the sim, so the same seed plays the same game in Swedish or English. A viewer who hasn't chosen
 * yet (or whose stored value is junk) gets the language picker as the very first screen.
 *
 * Storage can be missing or refuse (a private window, blocked site data), and even touching
 * `localStorage` can throw, so every read and write is wrapped: without storage the picker simply
 * shows on each visit, and the choice holds until the page is closed.
 */

import { parseLang, type Lang } from '../artificer/i18n';

export const LANG_KEY = 'artificer.lang';

/** Enough of `localStorage` to read and write one key. */
export type LangStore = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): LangStore | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The language this viewer chose, or null when there's none (or it isn't one we have): show the picker. */
export function storedLang(store: LangStore | null = storage()): Lang | null {
  try {
    return parseLang(store?.getItem(LANG_KEY));
  } catch {
    return null;
  }
}

/** Remember the choice; if it can't be kept, it still holds for this visit. */
export function storeLang(lang: Lang, store: LangStore | null = storage()): void {
  try {
    store?.setItem(LANG_KEY, lang);
  } catch {
    // Not remembered: the picker comes back next visit.
  }
}

/** Whether the picker comes first: nothing usable stored. */
export const pickerNeeded = (store: LangStore | null = storage()): boolean => storedLang(store) === null;
