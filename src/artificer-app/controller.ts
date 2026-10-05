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

import { ACTIONS, DAY_HOURS, setFocus, chooseSite, choose, createRegion1, runAction, runDay, parseQueueId, parseItem, queueHours, type QueueId, type QueueItem, type Region1State, type SiteId } from '../artificer/region1';
import type { Choice } from '../artificer/winter';
import { summarizeRun, legacyOf, addRun, canContinue, runNumberFor, type RunRecord } from '../artificer/legacy';
import { validTraits, type TraitId } from '../artificer/traits';
import { parseFocus, type Focus } from '../artificer/focus';

export interface AppState {
  sim: Region1State;
  /** The player's plan: runs in order, spilling over day boundaries. */
  queue: QueueItem[];
}

/** Bump the version (and the key) whenever the saved shape changes incompatibly. */
export const SAVE_VERSION = 7;
export const SAVE_KEY = 'artificer.region1.v7';

/** Long enough for any real plan; stops a runaway loop if the sim ever stalls. */
const MAX_DAYS_PER_RUN = 60;

/** A fresh character id. App-level (not in the sim) because it needs randomness; the sim stays deterministic. */
export const newCharacterId = (): string => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A brand-new Warden: a new character, knowing nothing. */
export function newGame(): AppState {
  return { sim: createRegion1({}, undefined, { id: newCharacterId() }), queue: [] };
}

/**
 * Start the next run. If `from` is a resolved run whose character lived, that
 * same character goes on — same id, name, portrait and traits — keeping what
 * they learned (#1242). Otherwise (no run, unfinished, or the character died)
 * it's a new Warden with nothing carried.
 */
export function newRun(from?: Region1State): AppState {
  if (!from || !canContinue(from)) return newGame();
  const c = from.character;
  return { sim: createRegion1({}, legacyOf(from), { id: c.id || newCharacterId(), name: c.name, portrait: c.portrait, traits: c.traits }), queue: [] };
}

// ── Run history (saved separately from the game, so starting over keeps it) ──

export const HISTORY_KEY = 'artificer.history.v1';

/**
 * Record a run once it has resolved. Calling it again for the same resolved
 * run is a no-op, so the page can call it after every update.
 */
export function recordRun(history: readonly RunRecord[], before: AppState, after: AppState): RunRecord[] {
  if (!after.sim.outcome || before.sim.outcome) return [...history];
  return addRun(history, summarizeRun(after.sim, runNumberFor(history, after.sim.character.id)));
}

export function serializeHistory(h: readonly RunRecord[]): string {
  return JSON.stringify({ version: 1, runs: h });
}

/** Parse saved history; anything malformed is simply an empty history. */
export function deserializeHistory(raw: string | null | undefined): RunRecord[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObj(data) || data.version !== 1 || !Array.isArray(data.runs)) return [];
    const ok = data.runs.every(r => isObj(r) && isNum(r.run) && isNum(r.day) && typeof r.kind === 'string' && typeof r.choice === 'string' && Array.isArray(r.tools));
    return ok ? (data.runs as RunRecord[]) : [];
  } catch { return []; }
}

export function enqueue(a: AppState, id: QueueItem): AppState {
  if (a.sim.outcome) return a;
  return { ...a, queue: [...a.queue, id] };
}

export function dequeueAt(a: AppState, index: number): AppState {
  if (index < 0 || index >= a.queue.length) return a;
  return { ...a, queue: a.queue.filter((_, i) => i !== index) };
}

/**
 * Choose an option on one queued action (e.g. the location of a build). The
 * entry becomes `{ q, opts }`; other entries are untouched.
 */
export function setOption(a: AppState, index: number, key: string, value: string): AppState {
  if (index < 0 || index >= a.queue.length) return a;
  const { opts } = parseItem(a.queue[index]);
  const item = a.queue[index];
  const q = typeof item === 'string' ? item : item.q;
  const queue = a.queue.map((it, i) => (i === index ? { q, opts: { ...opts, [key]: value } } : it));
  return { ...a, queue };
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

/** Set (or clear) the Warden's focus (#1238). Free: no hours, no queue entry. */
export function chooseFocus(a: AppState, focus: Focus | null): AppState {
  return { ...a, sim: setFocus(a.sim, focus) };
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
  /** The state each entry would run in — what its options are judged against. */
  before: Region1State[];
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
  const before: Region1State[] = [];
  for (const item of a.queue) {
    if (hours >= DAY_HOURS) { day += 1; hours = 0; }
    dayOffset.push(day);
    before.push(projected);
    const { id, ring, opts } = parseItem(item);
    const reason = ACTIONS[id].gate?.(projected, ring, opts) ?? null;
    warnings.push(reason);
    // A refused action costs no time in the sim, so it costs none here either.
    if (!reason) hours += queueHours(item, projected);
    projected = runAction(projected, item);
  }
  return { dayOffset, warnings, projected, before };
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
  const validQ = (item: unknown): boolean => {
    const q = isObj(item) ? item.q : item;
    if (isObj(item) && (!isObj(item.opts) || !Object.values(item.opts).every(v => typeof v === 'string'))) return false;
    if (typeof q !== 'string') return false;
    const { id, ring } = parseQueueId(q as QueueId);
    return id in ACTIONS && [1, 2, 3].includes(ring) && (ring === 1 || ACTIONS[id].ringed === true);
  };
  if (!Array.isArray(queue) || !queue.every(validQ)) return null;
  if (!isObj(sim)) return null;
  const v = sim.vitals;
  if (!isNum(sim.day) || !isNum(sim.hoursToday) || !isObj(v) || !isPool(v.vigor) || !isPool(v.clarity) || !isNum(v.condition)) return null;
  if (!isObj(sim.stores) || typeof sim.stores.hides !== 'number' || !isObj(sim.explore) || !isObj(sim.flags) || !isObj(sim.today) || !isObj(sim.config)) return null;
  if (!Array.isArray(sim.known) || !isObj(sim.studiedToday)) return null;
  if (!Array.isArray(sim.milestones) || !Array.isArray(sim.log) || !Array.isArray(sim.tools) || !isObj(sim.concepts)) return null;
  if (sim.shelterGrade !== null && typeof sim.shelterGrade !== 'string') return null;

  // Saves from before food/water streaks (#1233) start with none, rather than being thrown away.
  const d = sim.deprivation;
  const deprivation = isObj(d) && isNum(d.hungry) && isNum(d.thirsty) ? { hungry: d.hungry, thirsty: d.thirsty } : { hungry: 0, thirsty: 0 };

  // The shape checks above cover what the sim reads; trust the rest.
  // …and saves from before skills (#1236) start with no practice.
  const skills = isObj(sim.skills) && Object.values(sim.skills).every(isNum) ? sim.skills as Region1State['skills'] : {};
  // …and saves from before character creation (#1237/#1239) get an unnamed Warden with no traits.
  const ch = sim.character;
  const character = isObj(ch) && typeof ch.name === 'string' && Array.isArray(ch.traits) && validTraits(ch.traits as string[])
    ? { id: typeof ch.id === 'string' ? ch.id : '', name: ch.name, portrait: typeof ch.portrait === 'string' ? ch.portrait : null, traits: ch.traits as TraitId[], lastStandUsed: ch.lastStandUsed === true }
    : { id: '', name: '', portrait: null, traits: [], lastStandUsed: false };
  // …and saves from before focus (#1238) have none; a stored focus is re-validated.
  const f = sim.focus;
  const focus = isObj(f) && typeof f.kind === 'string' && typeof f.id === 'string' ? parseFocus(`${f.kind}:${f.id}`) : null;
  // …and saves from before techniques/manuals (#1243) start with none.
  const strings = (x: unknown): string[] => (Array.isArray(x) && x.every(v => typeof v === 'string') ? [...x] : []);
  return { sim: { ...(sim as unknown as Region1State), deprivation, skills, character, focus, techniques: strings(sim.techniques), manuals: strings(sim.manuals) }, queue: queue as QueueItem[] };
}
