/**
 * The distance each land action was last aimed at (#1814), kept per Warden and per action.
 *
 * The palette has no row of distance tabs any more: tapping a ringed action (wood, water, explore…)
 * opens a small chooser under its card, and the distance picked there is remembered, so next time
 * that action opens with it preselected ("last time"). Each action keeps its own: far for wood
 * doesn't move water.
 *
 * The page redraws by replacing its HTML, so this lives in module state and `localStorage` (per
 * device), as the weather fold does (weather-fold.ts). Presentation only: not in the save, not in
 * the sim (the queue id already carries the distance, `queueId(id, ring)`). Storage can be missing
 * or refuse (a private window, blocked site data); then every action starts at the nearest distance
 * it can go to, and the choices hold until the page is closed.
 */

import { ACTIONS, type ActionId } from '../artificer/region1';
import type { Ring } from '../artificer/exploration';

export const RING_DEFAULTS_KEY = 'artificer.ringDefaults';

/** One Warden's remembered distances, by action. */
export type RingDefaults = Partial<Record<ActionId, Ring>>;
/** Every Warden's, by character id. */
export type RingDefaultsStore = Readonly<Record<string, RingDefaults>>;

const isRing = (x: unknown): x is Ring => x === 1 || x === 2 || x === 3;
/** Only actions that go out on the land have a distance to remember. */
const isRinged = (id: string): id is ActionId => Object.prototype.hasOwnProperty.call(ACTIONS, id) && !!ACTIONS[id as ActionId].ringed;

/** The stored choices, or none when there's nothing (or junk) stored. Junk entries are dropped one by one. */
export function readRingDefaults(raw: string | null): RingDefaultsStore {
  if (raw === null) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, RingDefaults> = {};
    for (const [warden, per] of Object.entries(v as Record<string, unknown>)) {
      if (!per || typeof per !== 'object' || Array.isArray(per)) continue;
      const kept: RingDefaults = {};
      for (const [id, r] of Object.entries(per as Record<string, unknown>)) if (isRinged(id) && isRing(r)) kept[id] = r;
      if (Object.keys(kept).length) out[warden] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

/** One Warden's choices (none yet: an empty record). */
export const defaultsFor = (store: RingDefaultsStore, wardenId: string): RingDefaults => store[wardenId] ?? {};

/** Remember that this Warden aimed this action at this distance. A new store; the old one is untouched. */
export const rememberRing = (store: RingDefaultsStore, wardenId: string, id: ActionId, ring: Ring): RingDefaultsStore =>
  ({ ...store, [wardenId]: { ...defaultsFor(store, wardenId), [id]: ring } });

/**
 * Which distance the chooser preselects: the one remembered, if the Warden can go there now;
 * otherwise (the first time, or a remembered distance not open today) the nearest that is open.
 * With none open, the remembered one (or the nearest) is still shown as the card's, greyed.
 * `last` says the preselection is the remembered one, so the chooser can mark it "last time".
 */
export function preselect(open: readonly { ring: Ring; open: boolean }[], remembered: Ring | undefined): { ring: Ring; last: boolean } {
  if (remembered !== undefined && open.some(o => o.ring === remembered && o.open)) return { ring: remembered, last: true };
  const nearest = open.find(o => o.open);
  if (nearest) return { ring: nearest.ring, last: false };
  return { ring: remembered ?? open[0]?.ring ?? 1, last: false };
}

/** Enough of `localStorage` to read and write one key. */
export type RingDefaultsStorage = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): RingDefaultsStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Read the device's choices; with no storage (or one that throws), none. */
export function loadRingDefaults(store: RingDefaultsStorage | null = storage()): RingDefaultsStore {
  if (!store) return {};
  try {
    return readRingDefaults(store.getItem(RING_DEFAULTS_KEY));
  } catch {
    return {};
  }
}

/** Keep the choices for the next visit; if they can't be kept, the caller's copy still holds for this one. */
export function saveRingDefaults(d: RingDefaultsStore, store: RingDefaultsStorage | null = storage()): void {
  try { store?.setItem(RING_DEFAULTS_KEY, JSON.stringify(d)); } catch { /* this visit only */ }
}
