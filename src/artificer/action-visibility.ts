/**
 * What the actions area shows (#1690, switch `action-visibility`): for every action, one of
 *
 * - **hidden** — the Warden doesn't know how to do it (a skill, technique, level or recipe they
 *   haven't got). Not listed at all; it appears when learned. Experiment (and focus) is how a
 *   hidden action is found through play (the owner's comment).
 * - **greyed** — they know how, but can't right now: a missing tool, materials, the weather, the
 *   dark, the ring not reached… Listed, with the reason, and not tappable or queueable.
 * - **available** — as today.
 *
 * One pure split, read by the app's actions area, the API's view and moves, and the AI's
 * observation, so all of them see the same thing. With the switch off nothing is hidden but the
 * two actions that only exist with it (Explore and Experiment), and every blocked action reads as
 * it does today.
 */

import { ACTIONS, blockedReason, skillLockOf, visibilityOn, type ActionId, type ActionOpts, type Region1State } from './region1';
import type { Ring } from './exploration';

export type Visibility =
  | { id: ActionId; status: 'hidden'; reason: string }
  | { id: ActionId; status: 'greyed'; reason: string }
  | { id: ActionId; status: 'available'; reason: null };

/** One action's place in the actions area, in a ring (land actions) with these choices. */
export function visibilityOf(s: Region1State, id: ActionId, ring: Ring = 1, opts: ActionOpts = {}): Visibility {
  const lock = skillLockOf(s, id, opts);
  // With the switch off `skillLockOf` locks only Explore and Experiment, which don't exist then.
  if (lock) return { id, status: 'hidden', reason: lock };
  const why = blockedReason(s, id, ring, opts);
  return why ? { id, status: 'greyed', reason: why } : { id, status: 'available', reason: null };
}

/** Every action's place in the actions area, in `ACTIONS` order. */
export const actionVisibility = (s: Region1State, ring: Ring = 1): Visibility[] =>
  (Object.keys(ACTIONS) as ActionId[]).map(id => visibilityOf(s, id, ACTIONS[id].ringed ? ring : 1));

/** Is this action shown at all? */
export const shown = (s: Region1State, id: ActionId): boolean => skillLockOf(s, id) === null;

/** Whether a greyed action can still be tapped and queued: only with the switch off, as today (it'd be skipped). */
export const greyedTappable = (s: Region1State): boolean => !visibilityOn(s);
