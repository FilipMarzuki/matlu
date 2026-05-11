import type { Json } from '../types/database.types';
import { getOrSignInAnon } from './auth';
import { supabase } from './supabaseClient';

export const HOMESTEAD_SAVE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 2_000;

export interface HomesteadInventoryItem {
  id: string;
  qty: number;
}

export interface HomesteadNodeSave {
  id: string;
  state: 'ready' | 'depleted';
  respawnAt: number | null;
}

export interface HomesteadPlayerSave {
  x: number;
  y: number;
}

export interface HomesteadSaveState {
  version: typeof HOMESTEAD_SAVE_VERSION;
  inventory: HomesteadInventoryItem[];
  nodes: HomesteadNodeSave[];
  player: HomesteadPlayerSave;
}

let pendingState: HomesteadSaveState | null = null;
let saveTimer: number | null = null;

export async function loadSave(): Promise<HomesteadSaveState | null> {
  if (!supabase) return null;

  const session = await getOrSignInAnon();
  if (!session) return null;

  const { data, error } = await supabase
    .from('homestead_saves')
    .select('state')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return parseHomesteadSaveState(data.state);
}

export function queueSave(state: HomesteadSaveState): void {
  pendingState = state;

  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void flushSave().catch((error: unknown) => {
      console.warn('[matlu] Homestead autosave failed', error);
    });
  }, SAVE_DEBOUNCE_MS);
}

export async function flushSave(): Promise<boolean> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  const state = pendingState;
  pendingState = null;
  if (!state) return false;

  return saveNow(state);
}

export async function saveNow(state: HomesteadSaveState): Promise<boolean> {
  if (!supabase) return false;

  const session = await getOrSignInAnon();
  if (!session) return false;

  const { error } = await supabase.from('homestead_saves').upsert(
    {
      user_id: session.user.id,
      state: serializeHomesteadSaveState(state),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) throw error;
  return true;
}

function serializeHomesteadSaveState(state: HomesteadSaveState): Json {
  return {
    version: state.version,
    inventory: state.inventory.map((item) => ({
      id: item.id,
      qty: item.qty,
    })),
    nodes: state.nodes.map((node) => ({
      id: node.id,
      state: node.state,
      respawnAt: node.respawnAt,
    })),
    player: {
      x: state.player.x,
      y: state.player.y,
    },
  };
}

function parseHomesteadSaveState(value: Json): HomesteadSaveState | null {
  if (!isJsonRecord(value)) return null;
  if (value.version !== HOMESTEAD_SAVE_VERSION) return null;
  if (!isJsonRecord(value.player)) return null;

  const playerX = value.player.x;
  const playerY = value.player.y;
  if (typeof playerX !== 'number' || typeof playerY !== 'number') return null;

  return {
    version: HOMESTEAD_SAVE_VERSION,
    inventory: parseInventory(value.inventory),
    nodes: parseNodes(value.nodes),
    player: { x: playerX, y: playerY },
  };
}

function parseInventory(value: Json | undefined): HomesteadInventoryItem[] {
  if (!Array.isArray(value)) return [];

  const items: HomesteadInventoryItem[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    const id = entry.id;
    const qty = entry.qty;
    if (typeof id !== 'string' || typeof qty !== 'number' || qty <= 0) continue;
    items.push({ id, qty: Math.floor(qty) });
  }
  return items;
}

function parseNodes(value: Json | undefined): HomesteadNodeSave[] {
  if (!Array.isArray(value)) return [];

  const nodes: HomesteadNodeSave[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    const id = entry.id;
    const state = entry.state;
    const respawnAt = entry.respawnAt;
    if (typeof id !== 'string') continue;
    if (state !== 'ready' && state !== 'depleted') continue;
    if (respawnAt !== null && typeof respawnAt !== 'number') continue;
    nodes.push({ id, state, respawnAt });
  }
  return nodes;
}

function isJsonRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
