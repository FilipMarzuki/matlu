/**
 * Artificer web frontend — the app controller (#1209).
 *
 * A thin, pure layer between the DOM and the Region 1 sim core
 * (`src/artificer/`). The sim knows nothing about a player's *plan*; this adds
 * the one piece of UI-owned state — the action queue — plus save/load.
 *
 * Kept free of `document` / `localStorage` on purpose so every rule here can be
 * unit-tested in Node (see controller.test.ts); `main.ts` does the rendering
 * and the browser storage.
 */

import { ACTIONS, DAY_HOURS, chooseSite, choose, createRegion1, runAction, runDay, type ActionId, type Region1State, type SiteId } from '../artificer/region1';
import type { Choice } from '../artificer/winter';

export interface AppState {
  sim: Region1State;
  /** The player's plan: runs in order, spilling over day boundaries. */
  queue: ActionId[];
}

/** Bump the version (and the key) whenever the saved shape changes incompatibly. */
export const SAVE_VERSION = 1;
export const SAVE_KEY = 'artificer.region1.v1';

/** Long enough for any real plan; stops a runaway loop if the sim ever stalls. */
const MAX_DAYS_PER_RUN = 60;

export function newGame(): AppState {
  return { sim: createRegion1(), queue: [] };
}

export function enqueue(a: AppState, id: ActionId): AppState {
  if (a.sim.outcome) return a;
  return { ...a, queue: [...a.queue, id] };
}

export function dequeueAt(a: AppState, index: number): AppState {
  if (index < 0 || index >= a.queue.length) return a;
  return { ...a, queue: a.queue.filter((_, i) => i !== index) };
}

export function clearQueue(a: AppState): AppState {
  return { ...a, queue: [] };
}

/** Run today: as much of the queue as fits, then sleep. The rest waits for tomorrow. */
export function runQueuedDay(a: AppState): AppState {
  if (a.sim.outcome) return a;
  const r = runDay(a.sim, a.queue);
  return { sim: r.state, queue: r.remaining };
}

/** Run day after day until the queue is empty (or the region resolves). */
export function runWholeQueue(a: AppState): AppState {
  let s = a;
  for (let i = 0; i < MAX_DAYS_PER_RUN && s.queue.length > 0 && !s.sim.outcome; i++) {
    s = runQueuedDay(s);
  }
  return s;
}

export function settle(a: AppState, site: SiteId): AppState {
  return { ...a, sim: chooseSite(a.sim, site) };
}

/**
 * Take an exit. Throws (via the sim) if the calendar hasn't opened it — the
 * UI only offers open exits, so a throw here means a bug, not a player error.
 */
export function takeExit(a: AppState, choice: Choice): AppState {
  return { sim: choose(a.sim, choice), queue: [] };
}

// ── Planning previews ───────────────────────────────────────────────────────

export interface QueuePreview {
  /** Days from now each queued action will run on (0 = today). */
  dayOffset: number[];
  /**
   * Why each action would be skipped, judged against the state after the
   * actions before it — or null if it should run. An approximation: it
   * ignores the nightly meal, so it can miss a skip caused by eating.
   */
  warnings: (string | null)[];
  /** The state after every queued action has run (no nights in between). */
  projected: Region1State;
}

/**
 * Preview the queue without committing it. Uses the same day-splitting rule
 * as `runDay`: an action starts only if the day still has hours left.
 */
export function previewQueue(a: AppState): QueuePreview {
  const dayOffset: number[] = [];
  const warnings: (string | null)[] = [];
  let hours = a.sim.hoursToday;
  let day = 0;
  let projected = a.sim;
  for (const id of a.queue) {
    if (hours >= DAY_HOURS) { day += 1; hours = 0; }
    dayOffset.push(day);
    const reason = ACTIONS[id].gate?.(projected) ?? null;
    warnings.push(reason);
    // A refused action costs no time in the sim, so it costs none here either.
    if (!reason) hours += ACTIONS[id].hours;
    projected = runAction(projected, id);
  }
  return { dayOffset, warnings, projected };
}

// ── Save / load ─────────────────────────────────────────────────────────────

export function serialize(a: AppState): string {
  return JSON.stringify({ version: SAVE_VERSION, sim: a.sim, queue: a.queue });
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isPool = (x: unknown): boolean => isObj(x) && isNum(x.current) && isNum(x.cap);

/**
 * Parse a save. Returns null — never throws — for anything that isn't a
 * well-formed save of this version, so a corrupt or stale save just means
 * "start fresh" instead of a broken page.
 */
export function deserialize(raw: string | null | undefined): AppState | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!isObj(data) || data.version !== SAVE_VERSION) return null;

  const { sim, queue } = data;
  if (!Array.isArray(queue) || !queue.every(q => typeof q === 'string' && q in ACTIONS)) return null;
  if (!isObj(sim)) return null;
  const v = sim.vitals;
  if (!isNum(sim.day) || !isNum(sim.hoursToday) || !isObj(v) || !isPool(v.vigor) || !isPool(v.clarity) || !isNum(v.condition)) return null;
  if (!isObj(sim.stores) || !isObj(sim.knowledge) || !isObj(sim.flags) || !isObj(sim.today) || !isObj(sim.config)) return null;
  if (!Array.isArray(sim.milestones) || !Array.isArray(sim.log)) return null;

  // The shape checks above cover what the sim reads; trust the rest.
  return { sim: sim as unknown as Region1State, queue: queue as ActionId[] };
}
