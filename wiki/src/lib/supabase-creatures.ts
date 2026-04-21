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
}

const SELECT_COLS = [
  'id','slug','creature_name','creator_name','world_name',
  'kind_size','kind_diet','kind_movement','kind_solitary',
  'habitat_biome','habitat_climate','habitat_notes',
  'behaviour_threat','behaviour_notes','food_notes',
  'special_ability','lore_description','lore_origin',
  'art_path','art_credit','credits_opt_in','tracker_issue_number','created_at',
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
