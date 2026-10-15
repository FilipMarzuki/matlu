/**
 * Collapsible sections (#1730): a `<details>` with a remembered open/closed state, per viewer.
 *
 * The page redraws by replacing its HTML (main.ts drawPage), which would snap every `<details>`
 * back to how it was written. So each fold has an id, the page tells this module when the viewer
 * opens or shuts one (`setFold`, from a `toggle` listener), and the next draw writes it that way.
 *
 * Presentation only, like the open tab: it isn't in the save or the sim. Storage can be missing or
 * refuse (a private window, blocked site data, a unit test), so every touch is wrapped: without it,
 * folds start as their defaults and keep their state until the page is closed.
 */

import { esc } from './html';

export const FOLDS_KEY = 'artificer.folds';

/** Enough of `localStorage` to read and write one key. */
export type FoldStore = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): FoldStore | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The folds the viewer has opened or shut (id → open), read from storage on first use. */
let folds: Record<string, boolean> | null = null;

function loaded(store: FoldStore | null): Record<string, boolean> {
  if (folds) return folds;
  folds = {};
  try {
    const raw: unknown = JSON.parse(store?.getItem(FOLDS_KEY) ?? '{}');
    if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') folds[k] = v;
  } catch { /* junk or no storage: defaults */ }
  return folds;
}

/** Whether a fold is open: as the viewer last left it, or its default. */
export const foldOpen = (id: string, byDefault: boolean, store: FoldStore | null = storage()): boolean => loaded(store)[id] ?? byDefault;

/** Remember that the viewer opened or shut a fold; if it can't be kept, it still holds for this visit. */
export function setFold(id: string, open: boolean, store: FoldStore | null = storage()): void {
  loaded(store)[id] = open;
  try { store?.setItem(FOLDS_KEY, JSON.stringify(folds)); } catch { /* kept for this visit only */ }
}

/** Forget every remembered fold (tests). */
export const resetFolds = (): void => { folds = null; };

/**
 * A collapsible section: `summary` is HTML (always shown), `body` the HTML it opens to. `data-fold`
 * carries the id back to the page's toggle listener.
 */
export function fold(id: string, summary: string, body: string, byDefault: boolean, cls = ''): string {
  return `<details class="fold${cls ? ` ${cls}` : ''}" data-fold="${esc(id)}"${foldOpen(id, byDefault) ? ' open' : ''}><summary>${summary}</summary>${body}</details>`;
}
