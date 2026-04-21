/**
 * POST /api/creatures/update-status — FIL-333.
 *
 * Body: { id: string; status: string }
 * Auth: admin_session cookie
 * Key: SUPABASE_SERVICE_ROLE_KEY
 *
 * Advances a creature through the pipeline state machine and, if a GitHub
 * tracker issue exists, posts a bot comment and swaps the status:* label.
 * Closing the tracker issue (in-game) and GDPR scrubbing (FIL-331) are also
 * wired through this endpoint / github-tracker.ts.
 *
 * Valid pipeline order (one-way):
 *   submitted → approved → balanced → lore-ready → graphics-rated
 *               → queued → spriting → in-game
 *   Any state → rejected
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';
import { notifyStatusChange } from '../../../lib/github-tracker';

// States that require moving forward in sequence (rejected is valid from any state).
const VALID_TRANSITIONS: Record<string, string[]> = {
  submitted:        ['approved', 'rejected'],
  approved:         ['balanced', 'rejected'],
  balanced:         ['lore-ready', 'rejected'],
  'lore-ready':     ['graphics-rated', 'rejected'],
  'graphics-rated': ['queued', 'rejected'],
  queued:           ['spriting', 'rejected'],
  spriting:         ['in-game', 'rejected'],
};

export const POST: APIRoute = async ({ request }) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let id: string;
  let newStatus: string;
  try {
    const body = await request.json();
    id        = body.id;
    newStatus = body.status;
    if (!id || !newStatus) throw new Error('missing fields');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body — need id and status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // ── Fetch current creature row ───────────────────────────────────────────
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}&select=id,creature_name,status,tracker_issue_number,entity_id&limit=1`,
    { headers: dbHeaders },
  );
  if (!fetchRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch creature' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const rows: Array<{
    id: string;
    creature_name: string;
    status: string;
    tracker_issue_number: number | null;
    entity_id: string | null;
  }> = await fetchRes.json();

  if (!rows.length) {
    return new Response(JSON.stringify({ error: 'Creature not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const creature = rows[0];
  const currentStatus = creature.status;

  // ── Validate transition ──────────────────────────────────────────────────
  const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    return new Response(
      JSON.stringify({
        error: `Cannot transition from "${currentStatus}" to "${newStatus}"`,
        allowed,
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Update DB ────────────────────────────────────────────────────────────
  const updatePayload: Record<string, unknown> = {
    status: newStatus,
    status_changed_at: new Date().toISOString(),
  };
  if (newStatus === 'in-game') {
    updatePayload.shipped_at = new Date().toISOString();
  }

  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...dbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(updatePayload),
    },
  );
  if (!updateRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to update creature' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Post GitHub comment + update labels (best-effort) ───────────────────
  const githubToken = import.meta.env.GITHUB_TOKEN ?? '';
  if (githubToken && creature.tracker_issue_number !== null) {
    await notifyStatusChange(
      githubToken,
      creature.tracker_issue_number,
      currentStatus,
      newStatus,
      creature.entity_id,
      creature.creature_name,
    );
  }

  return new Response(
    JSON.stringify({ ok: true, from: currentStatus, to: newStatus }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
