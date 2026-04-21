/**
 * GET /api/drafts/get?kid_id=<uuid>
 *
 * Returns the cloud draft for (user_id, kid_id).
 * Returns null if no draft exists.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { verifyUserToken, serviceHeaders } from '../../../lib/supabase-auth';

export const GET: APIRoute = async ({ request }) => {
  const user = await verifyUserToken(request.headers.get('Authorization'));
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  if (!supabaseUrl) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url    = new URL(request.url);
  const kidId  = url.searchParams.get('kid_id');
  const kidFilter = kidId
    ? `kid_id=eq.${encodeURIComponent(kidId)}`
    : 'kid_id=is.null';

  const res = await fetch(
    `${supabaseUrl}/rest/v1/creature_drafts?user_id=eq.${encodeURIComponent(user.id)}&${kidFilter}&select=draft_data,updated_at&limit=1`,
    { headers: serviceHeaders() }
  );

  if (!res.ok) {
    return new Response(JSON.stringify(null), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows: Array<{ draft_data: Record<string, unknown>; updated_at: string }> = await res.json();
  const draft = rows[0] ?? null;

  return new Response(JSON.stringify(draft), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
