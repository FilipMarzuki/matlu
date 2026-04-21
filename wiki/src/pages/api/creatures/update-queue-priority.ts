/**
 * POST /api/creatures/update-queue-priority
 *
 * Manually overrides queue_priority so the admin can drag-sort the queue
 * without waiting for the formula to recompute.
 *
 * Body: { id: string; queue_priority: number }
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

  let id: string, queue_priority: number;
  try {
    const body     = await request.json();
    id              = body.id;
    queue_priority  = Number(body.queue_priority);
    if (!id) throw new Error('missing id');
    if (!Number.isFinite(queue_priority)) throw new Error('queue_priority must be a number');
  } catch (e) {
    return json({ error: (e as Error).message || 'Invalid request body' }, 400);
  }

  const hdrs = serviceHeaders(serviceKey);

  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/creature_submissions?id=eq.${enc(id)}`,
    {
      method:  'PATCH',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body:    JSON.stringify({ queue_priority }),
    }
  );

  if (!updateRes.ok) return json({ error: 'Failed to update priority' }, 500);

  return json({ ok: true });
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
