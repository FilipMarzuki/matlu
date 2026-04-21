/**
 * POST /api/creatures/rate-graphics
 *
 * Records the graphics difficulty score and notes.
 * If the creature is in 'lore-ready' status, automatically transitions it to
 * 'queued' — the DB trigger then computes queue_priority.
 *
 * Body:
 *   id:                   string
 *   graphics_difficulty:  1 | 2 | 3 | 4 | 5
 *   graphics_notes:       string (optional)
 *
 * Auth: admin_session cookie
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthorized } from '../../../lib/admin-session';

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie');
  if (!isAuthorized(cookieHeader)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const serviceKey  = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

  let id: string, graphics_difficulty: number, graphics_notes: string;
  try {
    const body          = await request.json();
    id                   = body.id;
    graphics_difficulty  = Number(body.graphics_difficulty);
    graphics_notes       = body.graphics_notes?.toString().trim() ?? '';
    if (!id) throw new Error('missing id');
    if (
      !Number.isInteger(graphics_difficulty) ||
      graphics_difficulty < 1 ||
      graphics_difficulty > 5
    ) {
      throw new Error('graphics_difficulty must be an integer 1–5');
    }
  } catch (e) {
    return json({ error: (e as Error).message || 'Invalid request body' }, 400);
  }

  const hdrs = serviceHeaders(serviceKey);

  // Fetch current status to determine whether auto-queue applies
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${enc(id)}&limit=1&select=id,status`,
    { headers: hdrs }
  );
  if (!fetchRes.ok) return json({ error: 'Failed to fetch creature' }, 500);

  const rows: Array<{ id: string; status: string }> = await fetchRes.json();
  if (!rows.length) return json({ error: 'Creature not found' }, 404);

  // Rating while in 'lore-ready' auto-queues the creature
  const newStatus = rows[0].status === 'lore-ready' ? 'queued' : rows[0].status;

  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${enc(id)}`,
    {
      method:  'PATCH',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body:    JSON.stringify({
        graphics_difficulty,
        graphics_notes: graphics_notes || null,
        status:         newStatus,
      }),
    }
  );

  if (!updateRes.ok) return json({ error: 'Failed to update creature' }, 500);

  return json({ ok: true, queued: newStatus === 'queued' });
};

function serviceHeaders(key: string) {
  return {
    apikey:         key,
    Authorization:  `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function enc(s: string) { return encodeURIComponent(s); }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
