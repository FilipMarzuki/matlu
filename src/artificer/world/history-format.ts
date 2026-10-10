/**
 * A told history of the Reach as plain data (#1540): what the worker posts back and what the page
 * keeps in storage, so a reload doesn't tell it again.
 *
 * Kept apart from history.ts so the page can read a kept history without importing the history
 * engine: only the worker (src/artificer-app/history.worker.ts) loads `storytelling/`.
 */

/** Bump when a change makes the same seed tell a different history, so kept histories are told again. */
export const HISTORY_VERSION = 2;

export interface HistoryLine {
  year: number;
  text: string;
}

export interface ProvinceHistory {
  id: string;
  name: string;
  culture: string;
  /** The lordship seated there, e.g. "Hundred of Ravenford". */
  title: string;
  /** Who holds it at the end, e.g. "Ivar of Hedlund" (null if it lies vacant). */
  holder: string | null;
  /** Its most significant events, oldest first. */
  lines: HistoryLine[];
}

export interface ReachHistory {
  version: number;
  seed: number;
  /** The year the history ends: the present, when the Warden arrives. */
  year: number;
  provinces: ProvinceHistory[];
  /** The whole chronicle as text: the chronicle's threads, then living memory year by year. */
  chronicle: string;
  /** Events the engine logged, and how many were worth telling. */
  logged: number;
  told: number;
}

/** A kept history, if it's this seed's and from this version of the generator. */
export function keptHistory(raw: string | null, seed: number): ReachHistory | null {
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Partial<ReachHistory>;
    return h.version === HISTORY_VERSION && h.seed === seed && Array.isArray(h.provinces) && typeof h.chronicle === 'string' ? h as ReachHistory : null;
  } catch {
    return null;
  }
}
