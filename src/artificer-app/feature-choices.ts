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
 * Dev mode is off for players (#1688): it opens with the game's own Dev mode switch, or `?dev` in the
 * address. It was on for everyone while the whole game was an experiment (#1579); the owner turned
 * that round once the told history became a tab players could stumble on.
 */
export const DEV_BY_DEFAULT = false;

/**
 * Whether dev mode is on: `?dev=0` in the address turns it off and remembers it, `?dev` (or any other
 * `?dev=…`, such as `?dev=truths`) turns it on and remembers it; with neither, what the in-game switch
 * last kept (`setDevMode`); with nothing kept, `DEV_BY_DEFAULT`. Dev mode only shows or hides views
 * (the features panel, the HISTORY tab, actions' Vigor/Clarity costs); it never changes play.
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

/** The in-game Dev mode switch (#1688): remembered in this browser under `artificer.dev`, like `?dev`. */
export function setDevMode(on: boolean, store: Store | null = storage()): void {
  try {
    store?.setItem(DEV_KEY, on ? '1' : '0');
  } catch {
    // Not remembered; the switch still holds until the page reloads.
  }
}

/** A tab that only dev mode shows carries `dev: true` (#1688), and wears a DEV tag. */
export interface TabDef<T extends string> { id: T; label: string; dev?: boolean }

/** The tabs to draw: every tab in dev mode, only the players' tabs without it. */
export function visibleTabs<T extends string>(tabs: readonly TabDef<T>[], dev: boolean): TabDef<T>[] {
  return tabs.filter(t => dev || !t.dev);
}

/**
 * The tab to open: `wanted` if it's a tab that shows now, otherwise the first tab that does (a kept
 * HISTORY tab after dev mode turned off, or a stored id that's no tab at all).
 */
export function tabToOpen<T extends string>(wanted: string | null, tabs: readonly TabDef<T>[], dev: boolean): T {
  const shown = visibleTabs(tabs, dev);
  return (shown.find(t => t.id === wanted) ?? shown[0]).id;
}

/**
 * An action card's body cost (#1688): which vitals it spends ("vigor + clarity"), or "restores". Only
 * dev mode shows it; players read their Vigor and Clarity from the bars and plan by hours. Null hides it.
 */
export function vitalCostLabel(rates: { vigorRate: number; clarityRate: number }, dev: boolean): string | null {
  if (!dev) return null;
  return [rates.vigorRate < 0 ? 'vigor' : '', rates.clarityRate < 0 ? 'clarity' : ''].filter(Boolean).join(' + ') || 'restores';
}

/**
 * Whether dev mode also shows the truths the game hides from players (#1578): the true trust beside
 * each felt word, and each skill's true level. Only `?dev=truths` turns this on (and it's remembered);
 * any other `?dev…` turns it off again. Dev mode alone never shows them: hidden information stays
 * hidden from players (the owner's call). `?dev=truths` also turns dev mode on (devMode reads it as
 * on), and the truths show only while dev mode is on: the game reads `dev && devTruths()` (#1688).
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
