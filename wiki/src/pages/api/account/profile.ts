/**
 * GET /api/account/profile
 *
 * Returns the account_profiles row for the authenticated user.
 * Used by the settings page to populate handle and paused state.
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

  const res = await fetch(
    `${supabaseUrl}/rest/v1/account_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=handle,paused,created_at&limit=1`,
    { headers: serviceHeaders() }
  );

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch profile' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows: Array<{ handle: string; paused: boolean; created_at: string }> = await res.json();
  if (!rows.length) {
    return new Response(JSON.stringify(null), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(rows[0]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
