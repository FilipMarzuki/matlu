/**
 * Homestead cloud save service (#851).
 *
 * Single row per user in `public.homestead_saves`. The `state` column is a
 * JSON blob — extending the shape doesn't need a migration, just a `version`
 * bump and a load-time migrator.
 *
 * Save trigger: debounced upsert. The scene calls `queueSave(state)` on every
 * inventory/node/position change, and the lib coalesces them into one upsert
 * ~SAVE_DEBOUNCE_MS after activity stops. On scene shutdown, the scene calls
 * `flushSave()` to send the last pending state immediately.
 *
 * Free-tier sanity check: ~2 KB JSON × 30 upserts/min worst case = ~90 KB/min.
 * 5 GB monthly egress covers ~900+ active hours across all users combined.
 */

import { supabase } from './supabaseClient';

export const SAVE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 2000;

export interface InventoryEntry {
  id: string;
  qty: number;
}

export interface NodeEntry {
  /** Stable per-placement id, e.g. `tree-0`. */
  id: string;
  state: 'ready' | 'depleted';
  /** Epoch ms when a depleted node should respawn. Null if ready. */
  respawnAt: number | null;
}

export interface PlayerEntry {
  x: number;
  y: number;
}

export interface HomesteadState {
  version: number;
  inventory: InventoryEntry[];
  nodes: NodeEntry[];
  player: PlayerEntry;
}

let pendingState: HomesteadState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

/**
 * Load the user's save. Returns null if there's no row yet (first visit) or
 * if Supabase isn't configured. The scene falls back to its default state
 * in either case.
 */
export async function loadSave(userId: string): Promise<HomesteadState | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('homestead_saves')
    .select('state')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[homesteadSave] load failed:', error.message);
    return null;
  }
  if (!data?.state) return null;

  // Migrate older shapes here when we bump SAVE_VERSION.
  return data.state as unknown as HomesteadState;
}

/**
 * Queue a save. The actual upsert is debounced so rapid successive calls
 * (e.g. during a gather burst) collapse to one network round-trip.
 */
export function queueSave(userId: string, state: HomesteadState): void {
  if (!supabase) return;
  pendingState = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void doSave(userId), SAVE_DEBOUNCE_MS);
}

/**
 * Force the pending save to send immediately. Call on scene shutdown / page
 * unload so the last few actions don't get lost in the debounce window.
 */
export async function flushSave(userId: string): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingState) return;
  await doSave(userId);
}

async function doSave(userId: string): Promise<void> {
  if (!supabase || !pendingState || inflight) return;
  const state = pendingState;
  pendingState = null;
  inflight = true;

  try {
    const { error } = await supabase
      .from('homestead_saves')
      .upsert(
        { user_id: userId, state: state as never },
        { onConflict: 'user_id' },
      );
    if (error) console.warn('[homesteadSave] upsert failed:', error.message);
  } catch (e) {
    console.warn('[homesteadSave] upsert threw:', e);
  } finally {
    inflight = false;
  }
}
