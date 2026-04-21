/**
 * Build-time Supabase fetcher for creature_submissions.
 *
 * Used by the gallery (/creatures), detail (/creatures/[slug]), and credits
 * pages. All fetches run during `astro build` — no client-side DB calls.
 *
 * Requires:
 *   VITE_SUPABASE_URL                  — project API URL
 *   VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY — publishable key (anon-equivalent for reads)
 *
 * RLS: anon role can SELECT rows where approved = true (set by FIL-431 migration).
 * Gracefully returns [] when env vars are unset or the query fails.
 */

export interface Creature {
  id: string;
  slug: string;               // slug column if set, else id
  creature_name: string;
  creator_name: string | null;
  world_name: string | null;
  kind_size: string | null;
  kind_diet: string | null;
  kind_movement: string[] | null;
  kind_solitary: boolean | null;
  habitat_biome: string[] | null;
  habitat_climate: string | null;
  habitat_notes: string | null;
  behaviour_threat: string | null;
  behaviour_notes: string | null;
  food_notes: string | null;
  special_ability: string | null;
  lore_description: string | null;
  lore_origin: string | null;
  art_path: string | null;
  art_credit: string | null;
  credits_opt_in: boolean;
  tracker_issue_number: number | null;
  created_at: string;
  // Tracker fields (FIL-440 / C1)
  status: string | null;
  moderation_note: string | null;  // shown publicly only for rejected status
}

/**
 * One row from creature_status_history — intentionally omits the `note` column
 * (internal moderator notes; never surfaced to the public).
 */
export interface StatusHistoryEntry {
  id: string;
  creature_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

const SELECT_COLS = [
  'id','slug','creature_name','creator_name','world_name',
  'kind_size','kind_diet','kind_movement','kind_solitary',
  'habitat_biome','habitat_climate','habitat_notes',
  'behaviour_threat','behaviour_notes','food_notes',
  'special_ability','lore_description','lore_origin',
  'art_path','art_credit','credits_opt_in','tracker_issue_number','created_at',
  'status','moderation_note',
].join(',');

function getClient(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function query(client: { url: string; key: string }, params: string): Promise<Creature[]> {
  const res = await fetch(
    `${client.url}/rest/v1/creature_submissions?${params}&select=${SELECT_COLS}`,
    {
      headers: {
        apikey: client.key,
        Authorization: `Bearer ${client.key}`,
      },
    }
  );
  if (!res.ok) return [];
  const rows: (Creature & { slug: string | null })[] = await res.json();
  // Normalise: if slug column is null, fall back to id
  return rows.map(r => ({ ...r, slug: r.slug ?? r.id }));
}

/** All approved creatures, newest first. */
export async function fetchApprovedCreatures(): Promise<Creature[]> {
  const client = getClient();
  if (!client) return [];
  try {
    return await query(client, 'approved=eq.true&order=created_at.desc');
  } catch {
    return [];
  }
}

/** All approved creatures that opted into credits and have a creator name. */
export async function fetchCreditedCreatures(): Promise<Creature[]> {
  const client = getClient();
  if (!client) return [];
  try {
    return await query(
      client,
      'approved=eq.true&credits_opt_in=eq.true&creator_name=not.is.null&order=creator_name.asc,created_at.asc'
    );
  } catch {
    return [];
  }
}

/**
 * Returns the public URL for a creature's image.
 * The creature-art bucket is public, so no signed URL needed.
 */
export function imageUrl(supabaseUrl: string, artPath: string | null): string | null {
  if (!artPath) return null;
  return `${supabaseUrl}/storage/v1/object/public/creature-art/${artPath}`;
}

// ── Tracker: status history + queue ───────────────────────────────────────────

/**
 * Fetches all status history entries, ordered chronologically.
 * The `note` column (internal moderator note) is intentionally excluded from
 * the select — it must never be surfaced publicly.
 */
export async function fetchAllStatusHistory(): Promise<StatusHistoryEntry[]> {
  const client = getClient();
  if (!client) return [];
  try {
    const res = await fetch(
      `${client.url}/rest/v1/creature_status_history?select=id,creature_id,from_status,to_status,changed_at&order=changed_at.asc`,
      {
        headers: {
          apikey: client.key,
          Authorization: `Bearer ${client.key}`,
        },
      }
    );
    if (!res.ok) return [];
    return await res.json() as StatusHistoryEntry[];
  } catch {
    return [];
  }
}

/**
 * Fetches all creatures currently in the drawing queue, ordered by
 * queue_priority ascending (position 1 = next to be drawn).
 * Returns only id + queue_priority — no sensitive fields.
 */
export async function fetchQueuedPositions(): Promise<Array<{ id: string; queue_priority: number | null }>> {
  const client = getClient();
  if (!client) return [];
  try {
    const res = await fetch(
      `${client.url}/rest/v1/creature_submissions?approved=eq.true&status=eq.queued&select=id,queue_priority&order=queue_priority.asc`,
      {
        headers: {
          apikey: client.key,
          Authorization: `Bearer ${client.key}`,
        },
      }
    );
    if (!res.ok) return [];
    return await res.json() as Array<{ id: string; queue_priority: number | null }>;
  } catch {
    return [];
  }
}

/**
 * Computes the median number of days creatures spend in each status,
 * based on all available history transitions.
 *
 * Returns an empty object for any status with fewer than 3 data points
 * (too little data to be meaningful per spec).
 */
export function computeMedianEtaDays(history: StatusHistoryEntry[]): Record<string, number> {
  // Group entries by creature, sorted by changed_at
  const byCreature = new Map<string, StatusHistoryEntry[]>();
  for (const entry of history) {
    const arr = byCreature.get(entry.creature_id) ?? [];
    arr.push(entry);
    byCreature.set(entry.creature_id, arr);
  }

  // For each creature, compute how many days it spent in each state
  const durations: Record<string, number[]> = {};
  for (const entries of byCreature.values()) {
    entries.sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    for (let i = 0; i < entries.length - 1; i++) {
      const status = entries[i].to_status;
      const startMs = new Date(entries[i].changed_at).getTime();
      const endMs = new Date(entries[i + 1].changed_at).getTime();
      const days = (endMs - startMs) / 86_400_000;
      (durations[status] ??= []).push(days);
    }
  }

  // Compute median per status; skip if sample < 3
  const result: Record<string, number> = {};
  for (const [status, vals] of Object.entries(durations)) {
    if (vals.length < 3) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    result[status] = sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  }
  return result;
}
