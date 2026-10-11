/**
 * A player's own feature switches and dev mode (#1579), kept in this browser. The game page and the
 * text console share them (same site, same storage), so a feature switched off in one is off for
 * the next game started in either.
 *
 * Storage can be missing or refuse (a private window, blocked site data): every read and write is
 * wrapped, and the game plays with the defaults when it can't remember.
 */

import { validFeatures, type FeatureSwitches } from '../artificer/features';

const CHOICES_KEY = 'artificer.features';
const DEV_KEY = 'artificer.dev';

/** What storage looks like to this file: enough of `localStorage` to read and write. */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storage = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The player's switches, by feature id: only what they changed; the rest keep their defaults. */
export function loadChoices(store: Store | null = storage()): Record<string, boolean> {
  try {
    const v = JSON.parse(store?.getItem(CHOICES_KEY) ?? '{}') as unknown;
    return validFeatures(v) ? v : {};
  } catch {
    return {};
  }
}

export function saveChoices(choices: FeatureSwitches, store: Store | null = storage()): void {
  try {
    store?.setItem(CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // Not remembered; the switch still holds until the page reloads.
  }
}

/**
 * Whether dev mode is on: `?dev` in the address turns it on and remembers it, `?dev=0` turns it off.
 * Dev mode shows the features panel and the truths the game hides from players.
 */
export function devMode(search = globalThis.location?.search ?? '', store: Store | null = storage()): boolean {
  const asked = new URLSearchParams(search).get('dev');
  try {
    if (asked === '0' || asked === 'off') store?.removeItem(DEV_KEY);
    else if (asked !== null) store?.setItem(DEV_KEY, '1');
    return store?.getItem(DEV_KEY) === '1';
  } catch {
    return asked !== null && asked !== '0' && asked !== 'off';
  }
}
