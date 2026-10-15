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

// ── Dev mode (#1579, #1688, #1735) ──────────────────────────────────────────
//
// Dev mode only shows or hides views; it never changes play. It's off until someone turns it on with
// the faint ⚙ in the help panel, and it's open to anyone testing the game (the owner's call, #1735):
// with no password configured, the ⚙ turns it on at once. One setting closes it again:
// `VITE_DEV_PASSWORD_HASH`, the SHA-256 (lowercase hex) of a password, set in the Artificer's Vercel
// project; then the ⚙ asks for that password (#1688). `?dev` in the address never opens it on its
// own (it did while the whole game was an experiment, #1579).
//
// The password is a gate against curious players, not security: it runs in the browser, so anyone
// reading the bundle can get past it. The code holds no password and no hash. To try the password
// locally, put the hash in `.env.local` (gitignored) and run `npm run dev` or `npm run build:artificer`:
//
//   VITE_DEV_PASSWORD_HASH=<output of: printf %s 'your password' | sha256sum>
//
// AI players never get dev mode (#1735): it lives only in this page. The play API, the MCP server,
// the text console and the AI benchmark have none, and no parameter turns one on. dev-only.ts lists
// the dev-only words, and src/artificer-play/dev-mode-ai.test.ts checks none of them reaches an AI.

/**
 * Where an unlocked dev mode is remembered. A new key (the old one was `artificer.dev`): anyone who
 * opened dev mode with `?dev` before the password gate starts locked again.
 */
const DEV_KEY = 'artificer.devUnlocked';

/**
 * Whether dev mode is on: turned on at the ⚙ in this browser before (remembered), and not
 * left since. `?dev=0` (or `?dev=off`) in the address leaves it, and that's remembered too. `?dev`
 * or `?dev=truths` alone never opens it.
 */
export function devMode(search = globalThis.location?.search ?? '', store: Store | null = storage()): boolean {
  const asked = new URLSearchParams(search).get('dev');
  try {
    if (asked === '0' || asked === 'off') {
      store?.setItem(DEV_KEY, '0');
      return false;
    }
    return store?.getItem(DEV_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember dev mode as on (turned on at the ⚙, #1735) or left ("Leave dev mode"). */
export function setDevMode(on: boolean, store: Store | null = storage()): void {
  try {
    store?.setItem(DEV_KEY, on ? '1' : '0');
  } catch {
    // Not remembered; dev mode still holds (or stays shut) until the page reloads.
  }
}

/** SHA-256 of a string, as lowercase hex, with the browser's Web Crypto (also in Node 20, for tests). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether a typed password matches the expected hash (`VITE_DEV_PASSWORD_HASH`). Surrounding spaces
 * are dropped (a phone keyboard likes to add one). No hash, or not a SHA-256 hex string: never. No
 * Web Crypto (a page served over plain http that isn't localhost): never, rather than throwing.
 */
export async function devPasswordMatches(typed: string, expectedHex: string | undefined): Promise<boolean> {
  const want = expectedHex?.trim().toLowerCase() ?? '';
  if (!/^[0-9a-f]{64}$/.test(want) || !typed.trim()) return false;
  try {
    return (await sha256Hex(typed.trim())) === want;
  } catch {
    return false;
  }
}

/**
 * Whether this build asks for a password before dev mode opens (#1735): only when a hash is
 * configured. Unset or blank, dev mode is open to anyone who taps the ⚙. Anything else set, even
 * something that isn't a SHA-256 hex string, closes it: a mistyped setting fails shut, never open.
 */
export function devNeedsPassword(expectedHex: string | undefined): boolean {
  return (expectedHex?.trim() ?? '') !== '';
}

/**
 * Whether the dev gate opens for what was typed (#1735): with no hash configured, always (nothing
 * needs typing); with one, only for the right password (`devPasswordMatches`).
 */
export async function devUnlocks(typed: string, expectedHex: string | undefined): Promise<boolean> {
  return !devNeedsPassword(expectedHex) || devPasswordMatches(typed, expectedHex);
}

/**
 * A tab and when it shows (#1688, #1691): `dev` tabs only in dev mode; `needsCamp` tabs once the Warden
 * has made camp, or early in dev mode (for testing), tagged DEV while that's the only reason.
 */
export interface TabDef<T extends string> { id: T; label: string; dev?: boolean; needsCamp?: boolean }

/** What decides which tabs show: dev mode, and whether the Warden has made camp yet. */
export interface TabView { dev: boolean; camp: boolean }

/** Whether a tab shows now. */
export function tabShown<T extends string>(t: TabDef<T>, v: TabView): boolean {
  if (t.dev && !v.dev) return false;
  if (t.needsCamp && !v.camp && !v.dev) return false;
  return true;
}

/** Whether a shown tab wears the DEV tag: it shows only because dev mode is on. */
export function tabIsDev<T extends string>(t: TabDef<T>, v: TabView): boolean {
  return !!t.dev || (!!t.needsCamp && !v.camp);
}

/** The tabs to draw, in order. */
export function visibleTabs<T extends string>(tabs: readonly TabDef<T>[], v: TabView): TabDef<T>[] {
  return tabs.filter(t => tabShown(t, v));
}

/**
 * The tab to open: `wanted` if it shows now, otherwise the first tab that does (a kept HISTORY tab
 * after dev mode was left, a kept CAMP tab in a new run, or a stored id that's no tab at all).
 */
export function tabToOpen<T extends string>(wanted: string | null, tabs: readonly TabDef<T>[], v: TabView): T {
  const shown = visibleTabs(tabs, v);
  return (shown.find(t => t.id === wanted) ?? shown[0]).id;
}

/** The game's tabs (main.ts draws them). The MAP tab is part of LAND now (#1730). */
export type AppTab = 'plan' | 'camp' | 'land' | 'history' | 'warden' | 'progress';
// `label` is the English name; the page draws each tab's label from the catalog (`tab.<id>`, #1704).
export const APP_TABS: readonly TabDef<AppTab>[] = [
  { id: 'plan', label: 'PLAN' }, { id: 'camp', label: 'CAMP', needsCamp: true }, { id: 'land', label: 'LAND' }, { id: 'history', label: 'HISTORY', dev: true }, { id: 'warden', label: 'WARDEN' }, { id: 'progress', label: 'PROGRESS' },
];

/** A kept tab id from before its tab was folded into another, as the tab it's in now: the old MAP tab opens LAND (#1730). */
export const keptTab = (id: string | null): string | null => (id === 'map' ? 'land' : id);

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
 * hidden from players (the owner's call). `?dev=truths` no longer opens dev mode on its own (#1688):
 * it's an extra inside dev mode, and the game reads `dev && devTruths()`.
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
