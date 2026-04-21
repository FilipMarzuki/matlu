/**
 * POST /api/creatures/rating — #340 (B2 pipeline redesign).
 *
 * Body: { id: string, graphics_difficulty: number (1-5), graphics_notes?: string }
 * Auth: admin_session cookie
 * Key:  SUPABASE_SERVICE_ROLE_KEY
 *
 * Saves the 1–5 graphics difficulty rating and transitions status to 'queued'
 * (the queue-priority trigger from #341 fires at the DB level on status update).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let id: string;
  let graphics_difficulty: number;
  let graphics_notes: string;
  try {
    const body = await request.json();
    id = body.id;
    graphics_difficulty = Number(body.graphics_difficulty);
    graphics_notes = body.graphics_notes?.toString().trim() ?? '';
    if (!id) throw new Error('missing id');
    if (!Number.isInteger(graphics_difficulty) || graphics_difficulty < 1 || graphics_difficulty > 5) {
      throw new Error('graphics_difficulty must be 1–5');
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Fetch current status so we can record history
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}&limit=1&select=id,status`,
    { headers: sbHeaders }
  );
  const rows = fetchRes.ok ? await fetchRes.json() : [];
  const fromStatus: string = rows[0]?.status ?? 'lore-ready';

  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        graphics_difficulty,
        graphics_notes,
        status: 'queued',
      }),
    }
  );
  if (!patchRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to save rating' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Record history
  await fetch(
    `${supabaseUrl}/rest/v1/creature_status_history`,
    {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        creature_id: id,
        from_status: fromStatus,
        to_status: 'queued',
        notes: `Graphics rated ${graphics_difficulty}/5`,
      }),
    }
  ).catch(() => { /* non-fatal */ });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
