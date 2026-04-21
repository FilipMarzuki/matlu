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
  created_at: string;
  // Pipeline fields added by #332
  status: string;
  tracker_issue_number: number | null;
  moderation_note: string | null;
}

/** One row from creature_status_history — public fields only. */
export interface CreatureStatusEntry {
  id: string;
  changed_at: string;
  from_status: string | null;
  to_status: string;
}

const SELECT_COLS = [
  'id','slug','creature_name','creator_name','world_name',
  'kind_size','kind_diet','kind_movement','kind_solitary',
  'habitat_biome','habitat_climate','habitat_notes',
  'behaviour_threat','behaviour_notes','food_notes',
  'special_ability','lore_description','lore_origin',
  'art_path','art_credit','credits_opt_in','created_at',
  'status','tracker_issue_number','moderation_note',
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
  const rows: (Omit<Creature, 'slug'> & { slug: string | null })[] = await res.json();
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
 * Fetch status history for all creatures in one query, grouped by creature_id.
 * Used by getStaticPaths in [slug].astro to avoid N+1 DB calls at build time.
 */
export async function fetchAllCreatureHistory(): Promise<Record<string, CreatureStatusEntry[]>> {
  const client = getClient();
  if (!client) return {};
  try {
    const res = await fetch(
      `${client.url}/rest/v1/creature_status_history?order=changed_at.asc&select=id,changed_at,from_status,to_status,creature_id`,
      {
        headers: {
          apikey: client.key,
          Authorization: `Bearer ${client.key}`,
        },
      }
    );
    if (!res.ok) return {};
    const rows: (CreatureStatusEntry & { creature_id: string })[] = await res.json();
    const grouped: Record<string, CreatureStatusEntry[]> = {};
    for (const { creature_id, ...entry } of rows) {
      if (!grouped[creature_id]) grouped[creature_id] = [];
      grouped[creature_id].push(entry);
    }
    return grouped;
  } catch {
    return {};
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

// ── Status display helpers ────────────────────────────────────────────────────
// Translate internal pipeline status values into kid-friendly copy.
// Used both in Astro pages and in API routes that build GitHub issue content.

interface StatusDisplay {
  label: string;
  copy: string;
  eta: string;
  icon: string;
}

const STATUS_DISPLAY: Record<string, StatusDisplay> = {
  submitted:       { label: 'Waiting for review',    icon: '⏳', copy: 'The Matlu team is reading your creature!',                         eta: 'Usually takes about 1–3 days at this stage.' },
  approved:        { label: 'Accepted!',              icon: '✅', copy: 'Your creature made it in. Next up: powers and story.',              eta: 'Usually takes about 1–2 days at this stage.' },
  balanced:        { label: 'Getting its powers',     icon: '⚔️',  copy: 'Figuring out what your creature can do in battle.',               eta: 'Usually takes about 2–3 days at this stage.' },
  'lore-ready':    { label: 'Getting its story',      icon: '📖', copy: 'Writing where your creature fits in the world.',                   eta: 'Usually takes about 2–3 days at this stage.' },
  'graphics-rated':{ label: 'Ready for drawing',      icon: '🎨', copy: 'Waiting its turn to be drawn.',                                   eta: 'Usually takes about 1–2 days at this stage.' },
  queued:          { label: 'In line to be drawn',    icon: '📋', copy: 'In the drawing queue — check back soon!',                         eta: 'Queue size varies — usually a few days to a week.' },
  spriting:        { label: 'Being drawn right now!', icon: '✏️',  copy: 'The pixel artist is working on your creature.',                  eta: 'Usually takes about 1–2 weeks.' },
  'in-game':       { label: 'In the game!',           icon: '🎮', copy: 'Play Matlu to find your creature.',                               eta: '' },
  rejected:        { label: 'Not going to the game',  icon: '❌', copy: 'The Matlu team decided this one won\'t ship. Thank you for submitting!', eta: '' },
};

export function getStatusDisplay(status: string): StatusDisplay {
  return STATUS_DISPLAY[status] ?? {
    label: status,
    icon: '🔵',
    copy: '',
    eta: '',
  };
}

/** Label colors for GitHub status labels. */
export const STATUS_LABEL_COLORS: Record<string, string> = {
  submitted:        'ededed',
  approved:         '2da44e',
  balanced:         'e69138',
  'lore-ready':     '9065b0',
  'graphics-rated': 'e4b429',
  queued:           '5319e7',
  spriting:         'd93f0b',
  'in-game':        '0e8a16',
  rejected:         'b60205',
};
