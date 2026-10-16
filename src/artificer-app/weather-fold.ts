/**
 * How the weather box on Plan is folded (#1788): a big card the first time, then a row of icon chips
 * the player can open into the full box.
 *
 * - **intro** — the first time this device shows the box: the full box as a wide card at the top of
 *   Plan, ending in "Got it". Not a modal; the game under it still works.
 * - **condensed** — after "Got it", and the default from then on: one row of icon chips. Until the
 *   player has opened the box once, a hint says the row can be tapped for the details.
 * - **open** — the full box, as the player last left it.
 *
 * The page redraws by replacing its HTML, so the state lives here (and in `localStorage`, per
 * device) rather than in the DOM. Presentation only: not in the save, not in the sim. Storage can be
 * missing or refuse (a private window, blocked site data); then the box starts condensed with the
 * hint, rather than greeting the player with the big card on every visit, and the player's taps
 * hold until the page is closed.
 */

export const WEATHER_FOLD_KEY = 'artificer.weatherFold';

/** What's remembered: the intro acknowledged, the box left open, and the box opened at least once. */
export interface WeatherFold { acked: boolean; open: boolean; hintSeen: boolean }

export type WeatherFoldMode = 'intro' | 'open' | 'condensed';

/** A device that has never shown the box. */
export const FIRST_VISIT: WeatherFold = { acked: false, open: false, hintSeen: false };
/** No storage to read: condensed with the hint, never the intro card on every visit. */
export const NO_STORAGE: WeatherFold = { acked: true, open: false, hintSeen: false };

/** What the box shows for a remembered state, and whether the "tap here" hint goes with it. */
export function weatherFoldState(f: WeatherFold): { mode: WeatherFoldMode; hint: boolean } {
  if (!f.acked) return { mode: 'intro', hint: false };
  if (f.open) return { mode: 'open', hint: false };
  return { mode: 'condensed', hint: !f.hintSeen };
}

/** "Got it" on the intro card: the box condenses (the hint shows, as it hasn't been opened yet). */
export const ackWeather = (f: WeatherFold): WeatherFold => ({ ...f, acked: true, open: false });

/** The heading tapped: open or condense it. Opening it once retires the hint for good. */
export const toggleWeather = (f: WeatherFold): WeatherFold => ({ ...f, acked: true, open: !f.open, hintSeen: f.hintSeen || !f.open });

/** The stored state, or the first visit's when there's nothing (or junk) stored. */
export function readWeatherFold(raw: string | null): WeatherFold {
  if (raw === null) return FIRST_VISIT;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return FIRST_VISIT;
    const o = v as Record<string, unknown>;
    return { acked: o.acked === true, open: o.open === true, hintSeen: o.hintSeen === true };
  } catch {
    return FIRST_VISIT;
  }
}

/** Enough of `localStorage` to read and write one key. */
export type WeatherFoldStore = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): WeatherFoldStore | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Read the device's state; with no storage (or one that throws), condensed with the hint. */
export function loadWeatherFold(store: WeatherFoldStore | null = storage()): WeatherFold {
  if (!store) return NO_STORAGE;
  try {
    return readWeatherFold(store.getItem(WEATHER_FOLD_KEY));
  } catch {
    return NO_STORAGE;
  }
}

/** Keep the state for the next visit; if it can't be kept, the caller's copy still holds for this one. */
export function saveWeatherFold(f: WeatherFold, store: WeatherFoldStore | null = storage()): void {
  try { store?.setItem(WEATHER_FOLD_KEY, JSON.stringify(f)); } catch { /* this visit only */ }
}
