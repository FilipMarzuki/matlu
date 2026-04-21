/**
 * POST /api/creatures/transition
 *
 * Moves a creature to the next valid pipeline status.
 * The DB trigger (creature_queue_update) writes a row to creature_status_history
 * and refreshes queued_at / shipped_at / queue_priority automatically.
 *
 * Body: { id: string; to_status: string; note?: string }
 * Auth: admin_session cookie
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

// Valid transitions — mirrors creature_status_transition_allowed() in Postgres
const ALLOWED: Record<string, string[]> = {
  submitted:        ['approved', 'rejected'],
  approved:         ['balanced', 'rejected'],
  balanced:         ['lore-ready', 'rejected'],
  'lore-ready':     ['queued', 'rejected'],
  queued:           ['spriting', 'rejected'],
  spriting:         ['in-game', 'queued'],
  'in-game':        ['balanced'],
};

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

  let id: string, to_status: string, note: string;
  try {
    const body  = await request.json();
    id           = body.id;
    to_status    = body.to_status;
    note         = body.note?.toString().trim() ?? '';
    if (!id || !to_status) throw new Error('missing fields');
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const hdrs = serviceHeaders(serviceKey);

  // Fetch current status to validate transition
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${enc(id)}&limit=1&select=id,status`,
    { headers: hdrs }
  );
  if (!fetchRes.ok) return json({ error: 'Failed to fetch creature' }, 500);

  const rows: Array<{ id: string; status: string }> = await fetchRes.json();
  if (!rows.length) return json({ error: 'Creature not found' }, 404);

  const from_status = rows[0].status;
  if (!(ALLOWED[from_status] ?? []).includes(to_status)) {
    return json(
      { error: `Transition '${from_status}' → '${to_status}' is not allowed` },
      400
    );
  }

  // Build update payload
  const patch: Record<string, unknown> = { status: to_status };
  if (to_status === 'approved') {
    patch.approved    = true;
    patch.approved_at = new Date().toISOString();
  }
  if (to_status === 'rejected') {
    patch.rejected_at = new Date().toISOString();
    if (note) patch.moderation_note = note;
  }
  // queue_priority is computed by the DB trigger when status = 'queued'

  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${enc(id)}`,
    {
      method:  'PATCH',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body:    JSON.stringify(patch),
    }
  );
  if (!updateRes.ok) return json({ error: 'Failed to update status' }, 500);

  // If a note was supplied, append it to the history row just written by the trigger
  if (note) {
    await fetch(
      `${supabaseUrl}/rest/v1/creature_status_history?creature_id=eq.${enc(id)}&order=changed_at.desc&limit=1`,
      {
        method:  'PATCH',
        headers: { ...hdrs, Prefer: 'return=minimal' },
        body:    JSON.stringify({ note }),
      }
    ).catch(() => { /* non-fatal */ });
  }

  return json({ ok: true, from_status, to_status });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function serviceHeaders(key: string) {
  return {
    apikey:          key,
    Authorization:   `Bearer ${key}`,
    'Content-Type':  'application/json',
  };
}

function enc(s: string) { return encodeURIComponent(s); }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
