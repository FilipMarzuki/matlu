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
const TRUTHS_KEY = 'artificer.truths';

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
 * Dev mode is on unless a player turns it off, while the whole game is still an experiment (the
 * owner's call, #1579). Turn this to false when the Artificer settles: then only `?dev` opens it.
 */
export const DEV_BY_DEFAULT = true;

/**
 * Whether dev mode is on: `?dev=0` in the address turns it off and remembers it, `?dev` turns it on
 * and remembers it; with neither remembered, `DEV_BY_DEFAULT`. Dev mode shows the features panel and
 * the truths the game hides from players.
 */
export function devMode(search = globalThis.location?.search ?? '', store: Store | null = storage()): boolean {
  const asked = new URLSearchParams(search).get('dev');
  try {
    // Asked in the address: that, and remembered for the next visit.
    if (asked !== null) {
      const on = asked !== '0' && asked !== 'off';
      store?.setItem(DEV_KEY, on ? '1' : '0');
      return on;
    }
    const kept = store?.getItem(DEV_KEY);
    return kept === '1' ? true : kept === '0' ? false : DEV_BY_DEFAULT;
  } catch {
    return asked === null ? DEV_BY_DEFAULT : asked !== '0' && asked !== 'off';
  }
}

/**
 * Whether dev mode also shows the truths the game hides from players (#1578): the true trust beside
 * each felt word, and each skill's true level. Only `?dev=truths` turns this on (and it's remembered);
 * any other `?dev…` turns it off again. Dev mode alone, on for everyone while the game is an
 * experiment, never shows them: hidden information stays hidden from players (the owner's call).
 * `?dev=truths` also turns dev mode on (devMode reads it as on).
 */
export function devTruths(search = globalThis.location?.search ?? '', store: Store | null = storage()): boolean {
  const asked = new URLSearchParams(search).get('dev');
  try {
    if (asked !== null) {
      const on = asked === 'truths';
      store?.setItem(TRUTHS_KEY, on ? '1' : '0');
      return on;
    }
    return store?.getItem(TRUTHS_KEY) === '1';
  } catch {
    return asked === 'truths';
  }
}
