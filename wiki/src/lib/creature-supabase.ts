/**
 * Build-time Supabase helpers for the creature wiki pages.
 * All functions run at Astro build time (static output mode).
 * Returns empty arrays or null on missing credentials or query errors,
 * so the build succeeds in CI with placeholder env vars.
 */

import { createClient } from '@supabase/supabase-js';

/** Public-safe fields from creature_submissions. */
export interface CreaturePublic {
  id: string;
  slug: string;
  creature_name: string;
  creator_name: string;
  status: string;
  status_changed_at: string | null;
  queue_priority: number | null;
  moderation_note: string | null;
  art_path: string | null;
  world_name: string | null;
  kind_size: string | null;
  kind_movement: string[] | null;
  kind_diet: string | null;
  lore_description: string | null;
  special_ability: string | null;
  habitat_biome: string[] | null;
}

export interface HistoryEntry {
  id: string;
  creature_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

function makeClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!url || !key) return null;
  // Untyped client — wiki doesn't import the game's database.types.ts
  return createClient(url, key);
}

/** Fetch all approved creatures that have a slug (i.e. have detail pages). */
export async function fetchAllCreaturesWithSlugs(): Promise<CreaturePublic[]> {
  const client = makeClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('creature_submissions')
      .select(
        'id, slug, creature_name, creator_name, status, status_changed_at, queue_priority, moderation_note, art_path, world_name, kind_size, kind_movement, kind_diet, lore_description, special_ability, habitat_biome'
      )
      .not('slug', 'is', null)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data ?? []) as CreaturePublic[];
  } catch {
    return [];
  }
}

/** Fetch all status history rows, sorted oldest-first for ETA computation. */
export async function fetchAllStatusHistory(): Promise<HistoryEntry[]> {
  const client = makeClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('creature_status_history')
      .select('id, creature_id, from_status, to_status, changed_at')
      .order('changed_at', { ascending: true });
    if (error) return [];
    return (data ?? []) as HistoryEntry[];
  } catch {
    return [];
  }
}

/**
 * Compute 1-based queue position for a creature among all 'queued' creatures.
 * Lower queue_priority value = earlier in the queue.
 */
export function computeQueuePosition(
  creatures: CreaturePublic[],
  creatureId: string
): number | null {
  const queued = creatures
    .filter((c) => c.status === 'queued' && c.queue_priority !== null)
    .sort((a, b) => (a.queue_priority ?? 0) - (b.queue_priority ?? 0));
  const idx = queued.findIndex((c) => c.id === creatureId);
  return idx === -1 ? null : idx + 1;
}

/**
 * Compute median days creatures historically spend in `state`.
 * Returns null when sample size < 3 (too few data points to be meaningful).
 */
export function computeEtaDays(history: HistoryEntry[], state: string): number | null {
  // Group history by creature, already ordered oldest-first
  const byCreature = new Map<string, HistoryEntry[]>();
  for (const row of history) {
    const rows = byCreature.get(row.creature_id) ?? [];
    rows.push(row);
    byCreature.set(row.creature_id, rows);
  }

  const durations: number[] = [];
  for (const rows of byCreature.values()) {
    // Find when this creature entered the state (to_status = state)
    const entryIdx = rows.findIndex((r) => r.to_status === state);
    if (entryIdx === -1) continue;
    // Find when it left the state (from_status = state, after the entry)
    const exitRow = rows.slice(entryIdx + 1).find((r) => r.from_status === state);
    if (!exitRow) continue; // still in this state, can't measure
    const entryMs = new Date(rows[entryIdx].changed_at).getTime();
    const exitMs = new Date(exitRow.changed_at).getTime();
    const days = (exitMs - entryMs) / (1000 * 60 * 60 * 24);
    if (days >= 0) durations.push(days);
  }

  if (durations.length < 3) return null;

  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Format a date string as a human-readable relative time (computed at build time). */
export function relativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
